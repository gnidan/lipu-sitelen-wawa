import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import type { Editor } from "@tiptap/react";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Fragment } from "@tiptap/pm/model";
import type {
  Node as PmNode,
  Schema,
} from "@tiptap/pm/model";
import {
  wordToCodepoint,
  codepointToChar,
  codepointToWord,
  isUcsurChar,
  isControlChar,
  isJoiner,
  hasVariations,
  getVariations,
  applyVariation,
  isVariationSelector,
  isLongGlyphWord,
  VARIATION_SELECTOR_BASE,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
  START_OF_LONG_GLYPH,
  END_OF_LONG_GLYPH,
  STACKING_JOINER,
  SCALING_JOINER,
  ZWJ,
  isNiArrowCp,
  niDirectionByArrowCp,
  niDirectionByIndex,
  niDirStringEffective,
  parseVerbatimDirection,
} from "../../data";
import {
  codepoints,
  isWordGlyph,
  isLatinLetter,
  toVerbatim,
  fromVerbatim,
} from "../../convert/verbatim";
import {
  SP,
  Verbatim,
} from "../../components/SitelenPona";
import {
  blockText as parentBlockText,
} from "../extensions/structural-indicators";
import { focusTracker } from "../focus-tracker";

export const selectionMenuPluginKey = new PluginKey(
  "selectionMenu"
);

// ── Selection analysis ──────────────────────────

interface WrapInfo {
  kind: "selected" | "surrounding";
  wrapFrom: number;
  wrapTo: number;
}

interface AdjacentLongGlyph {
  side: "before" | "after";
  markerPos: number; // doc position of the marker
  // Full range of the adjacent expression
  // (container glyph through END/START marker),
  // used for preview rendering
  wrapFrom?: number;
  wrapTo?: number;
}

interface SelectionAnalysis {
  text: string;
  from: number;
  to: number;

  singleGlyphWithVariants: {
    word: string;
    /** Currently active variant index (0 = base) */
    currentIndex: number;
  } | null;
  containsUcsur: boolean;
  containsLatin: boolean;
  isSingleParagraph: boolean;
  glyphCount: number;
  firstGlyphWord: string | null;
  secondGlyphWord: string | null;
  hasStackingJoiner: boolean;
  hasScalingJoiner: boolean;
  hasZwjJoiner: boolean;
  hasLongGlyphMarkers: boolean;
  hasCartoucheMarkers: boolean;

  insideCartouche: WrapInfo | null;
  insideLongGlyph: WrapInfo | null;
  adjacentLongGlyph: AdjacentLongGlyph | null;
  precedingLongGlyph: {
    word: string;
    glyphFrom: number;
  } | null;
  // word name of the container glyph when inside
  // a long glyph (the glyph before START marker)
  longGlyphContainerWord: string | null;

  // Verbatim preview of the full cartouche
  // content (from wrapFrom to wrapTo), used for
  // the unwrap label when selection is partial
  cartoucheContentPreview: string | null;

  // Verbatim preview of the full long glyph
  // content (from wrapFrom to wrapTo), used for
  // the unwrap label when selection is partial
  longGlyphContentPreview: string | null;

  // True when the selection is at the tail of
  // a long glyph (content before it remains
  // inside). Unwrap shrinks instead of removing.
  longGlyphTail: boolean;

  // Doc position where the container glyph
  // starts (for surrounding long glyph)
  longGlyphContainerFrom: number | null;

  // Verbatim preview of the head portion when
  // tail-shrinking: "container(remaining)"
  longGlyphTailHeadPreview: string | null;

  // Verbatim preview of an adjacent long glyph
  // expression (container + parens + inner), used
  // for the wrap preview when extending an
  // existing long glyph
  adjacentLongGlyphPreview: string | null;

  isAllVerbatim: boolean;
  verbatimPreview: string | null;
  sitelenPonaPreview: string | null;
}

// ── Action types ────────────────────────────────

export type ActionId =
  | "wrapCartouche"
  | "unwrapCartouche"
  | "wrapLongGlyph"
  | "unwrapLongGlyph"
  | "stack"
  | "scale"
  | "join"
  | "unstack"
  | "unscale"
  | "unjoin"
  | "convertToVerbatim"
  | "convertToSP";

export interface SelectionMenuPluginState {
  analysis: SelectionAnalysis | null;
  actions: ActionId[];
  activeActionIndex: number;
  activeVariantIndex: number;
}

const ACTION_HINTS: Record<ActionId, string> = {
  wrapCartouche: "[",
  unwrapCartouche: "[",
  wrapLongGlyph: "(",
  unwrapLongGlyph: "(",
  stack: "-",
  scale: "+",
  join: "&",
  unstack: "-",
  unscale: "+",
  unjoin: "&",
  convertToVerbatim: "\u21E5",
  convertToSP: "\u21E5",
};

// ── Wrapper detection helpers ───────────────────

/**
 * Detect when the selection overlaps a wrap
 * structure — i.e. the selection contains a
 * START or END marker but not both. Find the
 * matching marker in the block text to get the
 * full wrap extent.
 */
function detectOverlappingWrap(
  state: EditorState,
  text: string,
  from: number,
  to: number,
  startCp: number,
  endCp: number
): WrapInfo | null {
  let hasStart = false;
  let hasEnd = false;
  for (const [cp] of codepoints(text)) {
    if (cp === startCp) hasStart = true;
    if (cp === endCp) hasEnd = true;
  }
  // Both → detectSelectedWrap handles it.
  // Neither → no overlap.
  if (hasStart === hasEnd) return null;

  const $from = state.doc.resolve(from);
  const parent = $from.parent;
  if (!parent.isTextblock) return null;

  const blockStart = $from.start();
  const blockText = parentBlockText(parent);

  if (hasStart && !hasEnd) {
    // Selection contains START, find END after
    const relTo = to - blockStart;
    let depth = 0;
    for (
      let i = relTo;
      i < blockText.length;

    ) {
      const cp = blockText.codePointAt(i)!;
      const len = cp > 0xffff ? 2 : 1;
      if (cp === startCp) depth++;
      if (cp === endCp) {
        if (depth > 0) {
          depth--;
        } else {
          // Find the START position in selection
          const relFrom = from - blockStart;
          let startPos = -1;
          for (
            let j = relFrom;
            j < relTo;

          ) {
            const c =
              blockText.codePointAt(j)!;
            const l = c > 0xffff ? 2 : 1;
            if (c === startCp) {
              startPos = j;
              break;
            }
            j += l;
          }
          if (startPos === -1) return null;
          return {
            kind: "selected",
            wrapFrom: blockStart + startPos,
            wrapTo: blockStart + i + len,
          };
        }
      }
      i += len;
    }
  }

  if (hasEnd && !hasStart) {
    // Selection contains END, find START before
    const relFrom = from - blockStart;
    let depth = 0;
    for (let i = relFrom - 1; i >= 0; i--) {
      const cp = blockText.codePointAt(i);
      if (cp === undefined) continue;
      if (cp >= 0xdc00 && cp <= 0xdfff) continue;
      if (cp === endCp) depth++;
      if (cp === startCp) {
        if (depth > 0) {
          depth--;
        } else {
          // Find the END position in selection
          const relTo = to - blockStart;
          let endPos = -1;
          for (
            let j = relFrom;
            j < relTo;

          ) {
            const c =
              blockText.codePointAt(j)!;
            const l = c > 0xffff ? 2 : 1;
            if (c === endCp) {
              endPos = j + l;
              // Don't break — take last END
            }
            j += l;
          }
          if (endPos === -1) return null;
          return {
            kind: "selected",
            wrapFrom: blockStart + i,
            wrapTo: blockStart + endPos,
          };
        }
      }
    }
  }

  return null;
}

/**
 * `text` must be offset-preserving relative to
 * `from` (each doc position from `from` maps to
 * exactly one `text` index) — the returned
 * `wrapFrom`/`wrapTo` are computed as `from +
 * <string offset>`. Callers must build `text` with
 * a one-char-per-leaf placeholder (see
 * `blockText` in structural-indicators.ts) so a
 * hardBreak inside the range doesn't shift doc
 * positions relative to string offsets.
 */
function detectSelectedWrap(
  text: string,
  from: number,
  startCp: number,
  endCp: number
): WrapInfo | null {
  let startOffset = -1;
  let endOffset = -1;
  for (const [cp, off] of codepoints(text)) {
    const len = cp > 0xffff ? 2 : 1;
    if (cp === startCp && startOffset === -1) {
      startOffset = off;
    }
    if (cp === endCp) {
      endOffset = off + len;
    }
  }
  if (startOffset >= 0 && endOffset > startOffset) {
    return {
      kind: "selected",
      wrapFrom: from + startOffset,
      wrapTo: from + endOffset,
    };
  }
  return null;
}

function detectSurroundingWrap(
  state: EditorState,
  from: number,
  to: number,
  startCp: number,
  endCp: number
): WrapInfo | null {
  const $from = state.doc.resolve(from);
  const parent = $from.parent;
  if (!parent.isTextblock) return null;

  const blockStart = $from.start();
  const blockText = parentBlockText(parent);
  const relFrom = from - blockStart;
  const relTo = to - blockStart;

  // Scan backward from relFrom for unmatched start
  let depth = 0;
  let foundStart = -1;
  for (let i = relFrom - 1; i >= 0; i--) {
    const cp = blockText.codePointAt(i);
    if (cp === undefined) continue;
    // Skip trailing surrogates
    if (cp >= 0xdc00 && cp <= 0xdfff) continue;
    if (cp === endCp) depth++;
    if (cp === startCp) {
      if (depth > 0) {
        depth--;
      } else {
        foundStart = i;
        break;
      }
    }
  }
  if (foundStart === -1) return null;

  // Scan forward from relTo for matching end
  depth = 0;
  let foundEnd = -1;
  for (
    let i = relTo;
    i < blockText.length;
  ) {
    const cp = blockText.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    if (cp === startCp) depth++;
    if (cp === endCp) {
      if (depth > 0) {
        depth--;
      } else {
        foundEnd = i + len;
        break;
      }
    }
    i += len;
  }
  if (foundEnd === -1) return null;

  return {
    kind: "surrounding",
    wrapFrom: blockStart + foundStart,
    wrapTo: blockStart + foundEnd,
  };
}

// ── Selection expansion ─────────────────────────

function isConnectorCp(cp: number): boolean {
  return (
    cp === CARTOUCHE_EXTENSION ||
    cp === STACKING_JOINER ||
    cp === SCALING_JOINER ||
    cp === ZWJ
  );
}

/**
 * Skip backward past glyph modifiers (VS or
 * ni arrow) in a codepoint array. Returns the
 * adjusted index pointing at the base glyph, or
 * the original index if no modifiers found.
 */
function skipGlyphModsBackward(
  cps: [number, number][],
  k: number
): number {
  if (k < 0) return k;
  if (isVariationSelector(cps[k][0])) {
    return k - 1;
  }
  if (isNiArrowCp(cps[k][0])) {
    return k - 1;
  }
  return k;
}

/**
 * Expands a selection range to include glyphs
 * connected via CART_EXT or joiners at the
 * boundaries. E.g. if the selection starts at a
 * CART_EXT, include the preceding word glyph;
 * if it ends before a joiner, include the
 * following word glyph.
 */
function expandSelectionRange(
  state: EditorState,
  from: number,
  to: number
): [number, number] {
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if (
    !$from.parent.isTextblock ||
    $from.parent !== $to.parent
  ) {
    return [from, to];
  }

  const blockStart = $from.start();
  const blockText = parentBlockText($from.parent);
  const cps = [...codepoints(blockText)];
  const relFrom = from - blockStart;
  const relTo = to - blockStart;

  // Find codepoint indices for selection bounds
  let si = cps.findIndex(
    ([, off]) => off >= relFrom
  );
  if (si === -1) si = cps.length;
  let ei = cps.findIndex(
    ([, off]) => off >= relTo
  );
  if (ei === -1) ei = cps.length;

  // Expand backward: if codepoint at si is a
  // connector or VS, or the codepoint just
  // before si is a connector, include preceding
  // content
  let moved = true;
  while (moved && si > 0) {
    moved = false;
    const [cp] = cps[si];
    const prevCp = cps[si - 1][0];

    // Arrow codepoint: expand backward to include
    // the preceding word glyph (ni + arrow)
    if (
      isNiArrowCp(cp) &&
      si > 0 &&
      isWordGlyph(prevCp)
    ) {
      si = si - 1;
      moved = true;
    } else if (
      isConnectorCp(cp) ||
      isVariationSelector(cp) ||
      isConnectorCp(prevCp)
    ) {
      let i = si - 1;
      // Skip connectors and VS
      while (
        i >= 0 &&
        (isVariationSelector(cps[i][0]) ||
          isConnectorCp(cps[i][0]))
      ) {
        i--;
      }
      if (i >= 0 && isWordGlyph(cps[i][0])) {
        si = i;
        moved = true;
      }
    }
  }

  // Expand forward: if codepoint at ei is a
  // connector, VS, or structural START marker,
  // or the codepoint just before ei is a
  // connector, include following content
  moved = true;
  while (moved && ei < cps.length) {
    moved = false;
    const [cp] = cps[ei];
    const lastCp =
      ei > 0 ? cps[ei - 1][0] : 0;
    if (isVariationSelector(cp)) {
      ei++;
      moved = true;
    } else if (
      isNiArrowCp(cp) &&
      ei > 0 && isWordGlyph(lastCp)
    ) {
      // Arrow directly after word glyph (ni+arrow)
      ei++;
      moved = true;
    } else if (cp === ZWJ) {
      ei++; // skip ZWJ
      // Also skip following word glyph
      if (
        ei < cps.length &&
        isWordGlyph(cps[ei][0])
      ) {
        ei++;
      }
      moved = true;
    } else if (
      isConnectorCp(cp) || isConnectorCp(lastCp)
    ) {
      // Skip past connector(s) and VS
      while (
        ei < cps.length &&
        (isConnectorCp(cps[ei][0]) ||
          isVariationSelector(cps[ei][0]))
      ) {
        ei++;
      }
      // Include word glyph
      if (
        ei < cps.length &&
        isWordGlyph(cps[ei][0])
      ) {
        ei++;
        moved = true;
      }
    } else if (
      cp === START_OF_LONG_GLYPH ||
      cp === START_OF_CARTOUCHE
    ) {
      // Scan forward to find matching END
      const endCp =
        cp === START_OF_LONG_GLYPH
          ? END_OF_LONG_GLYPH
          : END_OF_CARTOUCHE;
      let depth = 0;
      let j = ei;
      while (j < cps.length) {
        if (cps[j][0] === cp) depth++;
        if (cps[j][0] === endCp) {
          depth--;
          if (depth === 0) {
            ei = j + 1;
            moved = true;
            break;
          }
        }
        j++;
      }
    }
  }

  // Expand backward: if codepoint before si is
  // an END marker, include preceding structure.
  // Only do this when si starts at a structural
  // char — a standalone word glyph adjacent to a
  // closing paren should NOT absorb the structure.
  moved = true;
  while (moved && si > 0) {
    moved = false;
    const atSi = cps[si][0];
    if (isWordGlyph(atSi)) break;
    const prev = cps[si - 1][0];
    if (
      prev === END_OF_LONG_GLYPH ||
      prev === END_OF_CARTOUCHE
    ) {
      const startCp =
        prev === END_OF_LONG_GLYPH
          ? START_OF_LONG_GLYPH
          : START_OF_CARTOUCHE;
      let depth = 0;
      let j = si - 1;
      while (j >= 0) {
        if (cps[j][0] === prev) depth++;
        if (cps[j][0] === startCp) {
          depth--;
          if (depth === 0) {
            si = j;
            moved = true;
            // For long glyph, also include
            // the container glyph before START
            if (
              startCp === START_OF_LONG_GLYPH &&
              si > 0
            ) {
              let k = skipGlyphModsBackward(
                cps, si - 1
              );
              if (
                k >= 0 &&
                isWordGlyph(cps[k][0])
              ) {
                si = k;
              }
            }
            break;
          }
        }
        j--;
      }
    }
  }

  // Balance unmatched delimiters: if the range
  // contains unmatched STARTs, expand forward to
  // include their ENDs (and vice versa).
  const delimPairs: [number, number][] = [
    [START_OF_LONG_GLYPH, END_OF_LONG_GLYPH],
    [START_OF_CARTOUCHE, END_OF_CARTOUCHE],
  ];
  for (const [startCp, endCp] of delimPairs) {
    let depth = 0;
    for (let j = si; j < ei; j++) {
      if (cps[j][0] === startCp) depth++;
      if (cps[j][0] === endCp) depth--;
    }
    // Unmatched STARTs → expand forward
    while (depth > 0 && ei < cps.length) {
      if (cps[ei][0] === endCp) depth--;
      if (cps[ei][0] === startCp) depth++;
      ei++;
    }
    // Unmatched ENDs → for long glyph, strip
    // trailing END markers before expanding
    // backward (allows tail-shrink behavior)
    if (startCp === START_OF_LONG_GLYPH) {
      while (
        depth < 0 && ei > si &&
        cps[ei - 1][0] === endCp
      ) {
        ei--;
        depth++;
      }
    }
    // Unmatched ENDs → expand backward
    while (depth < 0 && si > 0) {
      si--;
      if (cps[si][0] === startCp) depth++;
      if (cps[si][0] === endCp) depth--;
    }
    // For long glyph, include container glyph
    // before START if we expanded backward
    if (
      startCp === START_OF_LONG_GLYPH &&
      si > 0 &&
      cps[si][0] === START_OF_LONG_GLYPH
    ) {
      let k = skipGlyphModsBackward(
        cps, si - 1
      );
      if (k >= 0 && isWordGlyph(cps[k][0])) {
        si = k;
      }
    }
  }

  const newFrom =
    si < cps.length
      ? blockStart + cps[si][1]
      : from;
  const newTo =
    ei < cps.length
      ? blockStart + cps[ei][1]
      : blockStart + blockText.length;

  return [newFrom, newTo];
}

// ── Selection analysis ──────────────────────────

function analyzeSelection(
  state: EditorState
): SelectionAnalysis | null {
  const sel = state.selection;
  if (sel.from === sel.to) return null;

  const [from, to] = expandSelectionRange(
    state,
    sel.from,
    sel.to
  );

  // Offset-preserving: detectSelectedWrap below
  // computes doc positions as `from + <string
  // offset into text>`, which only holds when a
  // hardBreak contributes exactly one char here
  // (matching its one doc position) instead of
  // the zero chars plain textBetween would give
  // it.
  const text = state.doc.textBetween(
    from, to, undefined, "￼"
  );
  if (text.length === 0) return null;

  // Single glyph with variants check
  let singleGlyphWithVariants: {
    word: string;
    currentIndex: number;
  } | null = null;
  {
    const cp = text.codePointAt(0);
    if (
      cp !== undefined &&
      isUcsurChar(String.fromCodePoint(cp))
    ) {
      const charLen = cp > 0xffff ? 2 : 1;
      let end = charLen;
      let curIdx = 0;
      if (end < text.length) {
        const nextCp = text.codePointAt(end);
        if (
          nextCp !== undefined &&
          isVariationSelector(nextCp)
        ) {
          curIdx = nextCp -
            VARIATION_SELECTOR_BASE + 1;
          end += 1;
        } else if (
          nextCp !== undefined &&
          isNiArrowCp(nextCp)
        ) {
          const dir =
            niDirectionByArrowCp(nextCp);
          if (dir) curIdx = dir.index;
          end += 1; // arrows are BMP
        }
      }
      if (end === text.length) {
        const word = codepointToWord[cp];
        if (word && hasVariations(word)) {
          singleGlyphWithVariants = {
            word,
            currentIndex: curIdx,
          };
        }
      }
    }
  }

  // Scan text for content classification
  let containsUcsur = false;
  let containsUcsurControl = false;
  let containsLatin = false;
  let glyphCount = 0;
  let firstGlyphWord: string | null = null;
  let secondGlyphWord: string | null = null;
  let hasStackingJoiner = false;
  let hasScalingJoiner = false;
  let hasZwjJoiner = false;
  let hasLongGlyphMarkers = false;
  let hasCartoucheMarkers = false;

  for (const [cp] of codepoints(text)) {
    if (isWordGlyph(cp)) {
      containsUcsur = true;
      glyphCount++;
      if (!firstGlyphWord) {
        firstGlyphWord =
          codepointToWord[cp] ?? null;
      } else if (!secondGlyphWord) {
        secondGlyphWord =
          codepointToWord[cp] ?? null;
      }
    }
    if (isControlChar(cp)) {
      containsUcsurControl = true;
    }
    if (isLatinLetter(cp)) {
      containsLatin = true;
    }
    if (cp === STACKING_JOINER) {
      hasStackingJoiner = true;
    }
    if (cp === SCALING_JOINER) {
      hasScalingJoiner = true;
    }
    if (cp === ZWJ) {
      hasZwjJoiner = true;
    }
    if (
      cp === START_OF_LONG_GLYPH ||
      cp === END_OF_LONG_GLYPH
    ) {
      hasLongGlyphMarkers = true;
    }
    if (
      cp === START_OF_CARTOUCHE ||
      cp === END_OF_CARTOUCHE
    ) {
      hasCartoucheMarkers = true;
    }
  }

  // Single paragraph check
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  const isSingleParagraph =
    $from.parent === $to.parent &&
    $from.parent.isTextblock;

  // Detect adjacent long glyph markers and
  // preceding glyph with long form
  let adjacentLongGlyph:
    AdjacentLongGlyph | null = null;
  let precedingLongGlyph: {
    word: string;
    glyphFrom: number;
  } | null = null;

  if ($from.parent.isTextblock) {
    const blockStart = $from.start();
    const blockText = parentBlockText($from.parent);
    const relFrom = from - blockStart;

    const textBefore = blockText.substring(
      0,
      relFrom
    );
    const cpsBefore = [...codepoints(textBefore)];

    if (cpsBefore.length > 0) {
      const [lastCp, lastOff] =
        cpsBefore[cpsBefore.length - 1];
      if (lastCp === END_OF_LONG_GLYPH) {
        adjacentLongGlyph = {
          side: "before",
          markerPos: blockStart + lastOff,
        };
      }
    }

    // Find full range of adjacent long glyph
    // (for preview): scan backward from END
    // to matching START, then container glyph
    if (
      adjacentLongGlyph?.side === "before"
    ) {
      let depth = 0;
      let startIdx = -1;
      for (
        let i = cpsBefore.length - 1;
        i >= 0;
        i--
      ) {
        const [cp] = cpsBefore[i];
        if (cp === END_OF_LONG_GLYPH) depth++;
        if (cp === START_OF_LONG_GLYPH) {
          depth--;
          if (depth === 0) {
            startIdx = i;
            break;
          }
        }
      }
      if (startIdx >= 0) {
        let ci = skipGlyphModsBackward(
          cpsBefore, startIdx - 1
        );
        if (
          ci >= 0 &&
          isWordGlyph(cpsBefore[ci][0])
        ) {
          const endLen =
            END_OF_LONG_GLYPH > 0xffff
              ? 2 : 1;
          adjacentLongGlyph.wrapFrom =
            blockStart + cpsBefore[ci][1];
          adjacentLongGlyph.wrapTo =
            adjacentLongGlyph.markerPos +
            endLen;
        }
      }
    }

    // Check glyph immediately before selection
    // (skip trailing VS or ZWJ+arrow)
    let idx = skipGlyphModsBackward(
      cpsBefore, cpsBefore.length - 1
    );
    if (idx >= 0) {
      const [cp, off] = cpsBefore[idx];
      if (isWordGlyph(cp)) {
        const w = codepointToWord[cp];
        if (w && isLongGlyphWord(w)) {
          precedingLongGlyph = {
            word: w,
            glyphFrom: blockStart + off,
          };
        }
      }
    }
  }

  if (
    $to.parent.isTextblock && !adjacentLongGlyph
  ) {
    const blockStart = $to.start();
    const blockText = parentBlockText($to.parent);
    const relTo = to - blockStart;

    const textAfter = blockText.substring(relTo);
    for (const [cp] of codepoints(textAfter)) {
      if (cp === START_OF_LONG_GLYPH) {
        adjacentLongGlyph = {
          side: "after",
          markerPos: to,
        };
      }
      break; // only check the first codepoint
    }
  }

  // Wrapper detection
  let insideCartouche =
    detectSelectedWrap(
      text,
      from,
      START_OF_CARTOUCHE,
      END_OF_CARTOUCHE
    ) ??
    detectSurroundingWrap(
      state,
      from,
      to,
      START_OF_CARTOUCHE,
      END_OF_CARTOUCHE
    ) ??
    detectOverlappingWrap(
      state,
      text,
      from,
      to,
      START_OF_CARTOUCHE,
      END_OF_CARTOUCHE
    );

  // Validate "selected" cartouche: reject if
  // extra word glyphs exist outside [...]
  if (insideCartouche?.kind === "selected") {
    let beforeStart = 0;
    let afterEnd = 0;
    let pastStart = false;
    let pastEnd = false;
    for (const [cp] of codepoints(text)) {
      if (
        !pastStart &&
        cp === START_OF_CARTOUCHE
      ) {
        pastStart = true;
      } else if (
        pastStart &&
        !pastEnd &&
        cp === END_OF_CARTOUCHE
      ) {
        pastEnd = true;
      } else if (isWordGlyph(cp)) {
        if (!pastStart) beforeStart++;
        if (pastEnd) afterEnd++;
      }
    }
    if (beforeStart > 0 || afterEnd > 0) {
      insideCartouche = null;
    }
  }

  let insideLongGlyph =
    detectSelectedWrap(
      text,
      from,
      START_OF_LONG_GLYPH,
      END_OF_LONG_GLYPH
    ) ??
    detectSurroundingWrap(
      state,
      from,
      to,
      START_OF_LONG_GLYPH,
      END_OF_LONG_GLYPH
    ) ??
    detectOverlappingWrap(
      state,
      text,
      from,
      to,
      START_OF_LONG_GLYPH,
      END_OF_LONG_GLYPH
    );

  // Validate "selected" long glyph: reject if
  // extra word glyphs exist outside the
  // container + START...END structure
  if (insideLongGlyph?.kind === "selected") {
    let beforeStart = 0;
    let afterEnd = 0;
    let pastStart = false;
    let pastEnd = false;
    for (const [cp] of codepoints(text)) {
      if (
        !pastStart &&
        cp === START_OF_LONG_GLYPH
      ) {
        pastStart = true;
      } else if (
        pastStart &&
        !pastEnd &&
        cp === END_OF_LONG_GLYPH
      ) {
        pastEnd = true;
      } else if (isWordGlyph(cp)) {
        if (!pastStart) beforeStart++;
        if (pastEnd) afterEnd++;
      }
    }
    if (beforeStart > 1 || afterEnd > 0) {
      insideLongGlyph = null;
    }
  }

  // Find the container glyph for a long glyph:
  // it's the word glyph immediately before the
  // START_OF_LONG_GLYPH marker.
  // For "selected" kind, try scanning the
  // selected text before START first; if
  // nothing found (selection starts at START),
  // fall back to the document before wrapFrom.
  let longGlyphContainerWord: string | null =
    null;
  let longGlyphContainerFrom: number | null =
    null;
  if (insideLongGlyph) {
    if (insideLongGlyph.kind === "selected") {
      // Scan selected text for the last word
      // glyph before the first START marker
      let lastWord: string | null = null;
      for (const [c] of codepoints(text)) {
        if (c === START_OF_LONG_GLYPH) break;
        if (isWordGlyph(c)) {
          lastWord =
            codepointToWord[c] ?? null;
        }
      }
      longGlyphContainerWord = lastWord;
    }

    // Fall back to scanning the document before
    // wrapFrom — used by "surrounding" kind, and
    // also by "selected" when the container
    // isn't in the selected text (e.g.,
    // selecting just "(ni)" without "lon").
    if (!longGlyphContainerWord) {
      const lwf = insideLongGlyph.wrapFrom;
      const $lwf = state.doc.resolve(lwf);
      if ($lwf.parent.isTextblock) {
        const bs = $lwf.start();
        const bt = parentBlockText($lwf.parent);
        const before =
          bt.substring(0, lwf - bs);
        const cps = [...codepoints(before)];
        const ki = skipGlyphModsBackward(
          cps, cps.length - 1
        );
        if (ki >= 0 && isWordGlyph(cps[ki][0])) {
          longGlyphContainerWord =
            codepointToWord[cps[ki][0]] ?? null;
          longGlyphContainerFrom =
            bs + cps[ki][1];
        }
      }
    }
  }

  // Check if all text is verbatim-marked
  const verbatimType =
    state.schema.marks.verbatim;
  let isAllVerbatim = false;
  if (verbatimType) {
    isAllVerbatim = true;
    state.doc.nodesBetween(from, to,
      (node) => {
        if (
          node.isText &&
          !verbatimType.isInSet(node.marks)
        ) {
          isAllVerbatim = false;
        }
      }
    );
  }

  // Conversion previews (use "\n" as block
  // separator so multi-paragraph selections
  // show line breaks)
  const previewText =
    state.doc.textBetween(from, to, "\n");
  const verbatimPreview =
    (containsUcsur || containsUcsurControl)
      ? toVerbatim(previewText)
      : null;
  const sitelenPonaPreview = containsLatin
    ? fromVerbatim(previewText)
    : null;

  // For unwrap cartouche preview: use the full
  // cartouche content (stripped of markers)
  let cartoucheContentPreview: string | null =
    null;
  if (insideCartouche) {
    const cartText = state.doc.textBetween(
      insideCartouche.wrapFrom,
      insideCartouche.wrapTo,
      "\n"
    );
    cartoucheContentPreview =
      toVerbatim(cartText);
  }

  // For unwrap long glyph preview: use the full
  // long glyph content (from wrapFrom to wrapTo)
  let longGlyphContentPreview: string | null =
    null;
  if (insideLongGlyph) {
    const lgText = state.doc.textBetween(
      insideLongGlyph.wrapFrom,
      insideLongGlyph.wrapTo,
      "\n"
    );
    longGlyphContentPreview =
      toVerbatim(lgText);
  }

  // Detect tail selection: selected content is
  // at the end of a surrounding long glyph,
  // with remaining content before it
  const endLen =
    END_OF_LONG_GLYPH > 0xffff ? 2 : 1;
  const startLen =
    START_OF_LONG_GLYPH > 0xffff ? 2 : 1;
  const longGlyphTail = !!(
    insideLongGlyph?.kind === "surrounding" &&
    to === insideLongGlyph.wrapTo - endLen &&
    from > insideLongGlyph.wrapFrom + startLen
  );

  let longGlyphTailHeadPreview: string | null =
    null;
  if (
    longGlyphTail &&
    longGlyphContainerFrom !== null &&
    insideLongGlyph
  ) {
    const headText = state.doc.textBetween(
      longGlyphContainerFrom, from
    );
    const endChar =
      String.fromCodePoint(END_OF_LONG_GLYPH);
    longGlyphTailHeadPreview =
      toVerbatim(headText + endChar);
  }

  // For wrap long glyph preview when extending
  // an adjacent expression: verbatim of the full
  // adjacent expression (container + parens)
  let adjacentLongGlyphPreview: string | null =
    null;
  if (
    adjacentLongGlyph?.wrapFrom !== undefined &&
    adjacentLongGlyph?.wrapTo !== undefined
  ) {
    const adjText = state.doc.textBetween(
      adjacentLongGlyph.wrapFrom,
      adjacentLongGlyph.wrapTo,
      "\n"
    );
    adjacentLongGlyphPreview =
      toVerbatim(adjText);
  }

  return {
    // Drop the offset-preserving placeholder
    // before this reaches any consumer — it's
    // only needed for the position arithmetic
    // above, never for display.
    text: text.replace(/￼/g, ""),
    from,
    to,
    singleGlyphWithVariants,
    containsUcsur,
    containsLatin,
    isSingleParagraph,
    glyphCount,
    firstGlyphWord,
    secondGlyphWord,
    hasStackingJoiner,
    hasScalingJoiner,
    hasZwjJoiner,
    hasLongGlyphMarkers,
    hasCartoucheMarkers,
    insideCartouche,
    insideLongGlyph,
    adjacentLongGlyph,
    precedingLongGlyph,
    longGlyphContainerWord,
    longGlyphContainerFrom,
    cartoucheContentPreview,
    longGlyphContentPreview,
    longGlyphTail,
    longGlyphTailHeadPreview,
    adjacentLongGlyphPreview,
    isAllVerbatim,
    verbatimPreview,
    sitelenPonaPreview,
  };
}

// ── Visible actions ─────────────────────────────

function getVisibleActions(
  analysis: SelectionAnalysis
): ActionId[] {
  if (analysis.isAllVerbatim) {
    if (
      analysis.containsLatin &&
      analysis.sitelenPonaPreview !== null
    ) {
      return ["convertToSP"];
    }
    return [];
  }

  const actions: ActionId[] = [];
  const {
    containsUcsur,
    containsLatin,
    isSingleParagraph,
    glyphCount,
    firstGlyphWord,
    hasStackingJoiner,
    hasScalingJoiner,
    hasZwjJoiner,
    hasLongGlyphMarkers,
    hasCartoucheMarkers,
    insideCartouche,
    insideLongGlyph,
    adjacentLongGlyph,
    precedingLongGlyph,
    verbatimPreview,
    sitelenPonaPreview,
  } = analysis;

  // Selection spans a structural boundary
  // (cartouche or long glyph marker, or
  // adjacent to a long glyph in the document)
  const spansBoundary =
    hasCartoucheMarkers ||
    hasLongGlyphMarkers ||
    adjacentLongGlyph !== null;

  const showWrapCartouche =
    !insideCartouche &&
    containsUcsur &&
    glyphCount >= 1 &&
    !spansBoundary;
  const showUnwrapCartouche =
    insideCartouche !== null;
  const firstGlyphHasLongForm =
    firstGlyphWord !== null &&
    isLongGlyphWord(firstGlyphWord);
  const showWrapLongGlyph =
    !insideLongGlyph &&
    containsUcsur &&
    !hasCartoucheMarkers &&
    (
      (adjacentLongGlyph?.side === "before") ||
      (adjacentLongGlyph?.side === "after" &&
        glyphCount === 1) ||
      (firstGlyphHasLongForm &&
        glyphCount >= 2) ||
      precedingLongGlyph !== null
    );
  const showUnwrapLongGlyph =
    insideLongGlyph !== null;
  const showStack =
    glyphCount === 2 &&
    isSingleParagraph &&
    !hasStackingJoiner &&
    !spansBoundary;
  const showScale =
    glyphCount === 2 &&
    isSingleParagraph &&
    !hasScalingJoiner &&
    !spansBoundary;
  const showJoin =
    glyphCount === 2 &&
    isSingleParagraph &&
    !hasZwjJoiner &&
    !spansBoundary;
  const showUnstack =
    glyphCount === 2 && hasStackingJoiner;
  const showUnscale =
    glyphCount === 2 && hasScalingJoiner;
  const showUnjoin =
    glyphCount === 2 && hasZwjJoiner;
  const showConvertToVerbatim =
    verbatimPreview !== null;
  const showConvertToSP =
    containsLatin && sitelenPonaPreview !== null;

  if (showWrapCartouche) {
    actions.push("wrapCartouche");
  }
  if (showUnwrapCartouche) {
    actions.push("unwrapCartouche");
  }
  if (showWrapLongGlyph) {
    actions.push("wrapLongGlyph");
  }
  if (showUnwrapLongGlyph) {
    actions.push("unwrapLongGlyph");
  }
  if (showStack) actions.push("stack");
  if (showScale) actions.push("scale");
  if (showJoin) actions.push("join");
  if (showUnstack) actions.push("unstack");
  if (showUnscale) actions.push("unscale");
  if (showUnjoin) actions.push("unjoin");
  if (showConvertToVerbatim) {
    actions.push("convertToVerbatim");
  }
  if (showConvertToSP) {
    actions.push("convertToSP");
  }

  return actions;
}

function arraysEqual(
  a: ActionId[],
  b: ActionId[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ── ProseMirror plugin ──────────────────────────

export function createSelectionMenuPlugin() {
  const emptyState: SelectionMenuPluginState = {
    analysis: null,
    actions: [],
    activeActionIndex: 0,
    activeVariantIndex: 0,
  };

  return new Plugin<SelectionMenuPluginState>({
    key: selectionMenuPluginKey,

    state: {
      init() {
        return emptyState;
      },
      apply(tr, prev, _oldState, newState) {
        const meta = tr.getMeta(
          selectionMenuPluginKey
        );

        // Explicit null: dismiss
        if (meta === null) {
          return emptyState;
        }

        // Navigate: update indices
        if (
          meta !== undefined &&
          typeof meta === "object" &&
          "navigate" in meta
        ) {
          return {
            ...prev,
            activeActionIndex:
              meta.activeActionIndex ??
                prev.activeActionIndex,
            activeVariantIndex:
              meta.activeVariantIndex ??
                prev.activeVariantIndex,
          };
        }

        // Execute action: pass through
        // (React handles it)
        if (
          meta !== undefined &&
          typeof meta === "object" &&
          "executeAction" in meta
        ) {
          if ("activeActionIndex" in meta) {
            return {
              ...prev,
              activeActionIndex:
                meta.activeActionIndex,
            };
          }
          return prev;
        }

        // Raw SelectionAnalysis meta (for tests):
        // wrap it in full state
        if (
          meta !== undefined &&
          meta !== null &&
          typeof meta === "object" &&
          "from" in meta &&
          "to" in meta &&
          "text" in meta
        ) {
          const analysis =
            meta as SelectionAnalysis;
          const actions =
            getVisibleActions(analysis);
          const hasV =
            analysis.singleGlyphWithVariants
              !== null;
          const varIdx = hasV
            ? (analysis
                .singleGlyphWithVariants!
                .currentIndex || 1)
            : 0;
          return {
            analysis,
            actions,
            activeActionIndex: hasV ? -1 : 0,
            activeVariantIndex: varIdx,
          };
        }

        // Normal state update: analyze selection
        const analysis =
          analyzeSelection(newState);
        if (!analysis) {
          return emptyState;
        }
        const actions =
          getVisibleActions(analysis);
        const hasV =
          analysis.singleGlyphWithVariants
            !== null;
        const sameActions = arraysEqual(
          actions,
          prev.actions
        );
        const idx = sameActions
          ? Math.min(
              prev.activeActionIndex,
              Math.max(actions.length - 1, 0)
            )
          : hasV ? -1 : 0;
        const varIdx = hasV
          ? (analysis
              .singleGlyphWithVariants!
              .currentIndex || 1)
          : 0;
        return {
          analysis,
          actions,
          activeActionIndex: idx,
          activeVariantIndex: varIdx,
        };
      },
    },

    props: {
      handleKeyDown(view, event) {
        const st =
          selectionMenuPluginKey.getState(
            view.state
          ) as SelectionMenuPluginState;
        if (!st.analysis) return false;

        if (event.key === "Escape") {
          view.dispatch(
            view.state.tr.setMeta(
              selectionMenuPluginKey,
              null
            )
          );
          return true;
        }

        const hasVariants =
          st.analysis.singleGlyphWithVariants
            !== null;
        const variations = hasVariants
          ? getVariations(
              st.analysis
                .singleGlyphWithVariants!.word
            )
          : [];
        const onVariantRow =
          hasVariants &&
          st.activeActionIndex === -1;

        // Total navigable rows:
        // variant row (-1) + action rows (0..N-1)
        const totalRows =
          (hasVariants ? 1 : 0) +
          st.actions.length;
        const minRow = hasVariants ? -1 : 0;

        // Digit keys: apply variant directly
        if (hasVariants) {
          const digit = parseInt(event.key, 10);
          if (
            !isNaN(digit) &&
            variations.some(
              (v) => v.index === digit
            )
          ) {
            const { word } =
              st.analysis
                .singleGlyphWithVariants!;
            const cp = wordToCodepoint[word];
            if (cp === undefined) return false;

            let newText: string;
            if (word === "ni") {
              const dir =
                niDirectionByIndex(digit);
              if (dir) {
                newText = niDirStringEffective(dir);
              } else {
                newText = codepointToChar(cp);
              }
            } else {
              newText = codepointToChar(cp);
              newText += String.fromCodePoint(
                VARIATION_SELECTOR_BASE +
                  (digit - 1)
              );
            }

            const tr = view.state.tr.insertText(
              newText,
              st.analysis.from,
              st.analysis.to
            );
            tr.setMeta(
              selectionMenuPluginKey,
              null
            );
            view.dispatch(tr);
            return true;
          }
        }

        // Arrow keys (let Shift+Arrow pass through
        // for text selection expansion)
        if (
          event.key === "ArrowDown" &&
          !event.shiftKey &&
          totalRows > 0
        ) {
          let next = st.activeActionIndex + 1;
          if (next >= st.actions.length) {
            next = minRow;
          }
          view.dispatch(
            view.state.tr.setMeta(
              selectionMenuPluginKey,
              {
                navigate: true,
                activeActionIndex: next,
              }
            )
          );
          return true;
        }

        if (
          event.key === "ArrowUp" &&
          !event.shiftKey &&
          totalRows > 0
        ) {
          let next = st.activeActionIndex - 1;
          if (next < minRow) {
            next = st.actions.length - 1;
            if (next < minRow) next = minRow;
          }
          view.dispatch(
            view.state.tr.setMeta(
              selectionMenuPluginKey,
              {
                navigate: true,
                activeActionIndex: next,
              }
            )
          );
          return true;
        }

        if (
          event.key === "ArrowLeft" &&
          !event.shiftKey &&
          onVariantRow
        ) {
          let next =
            st.activeVariantIndex - 1;
          if (next < 1) {
            next = variations.length;
          }
          view.dispatch(
            view.state.tr.setMeta(
              selectionMenuPluginKey,
              {
                navigate: true,
                activeVariantIndex: next,
              }
            )
          );
          return true;
        }

        if (
          event.key === "ArrowRight" &&
          !event.shiftKey &&
          onVariantRow
        ) {
          let next =
            st.activeVariantIndex + 1;
          if (next > variations.length) {
            next = 1;
          }
          view.dispatch(
            view.state.tr.setMeta(
              selectionMenuPluginKey,
              {
                navigate: true,
                activeVariantIndex: next,
              }
            )
          );
          return true;
        }

        // Left/right on action row: dismiss
        if (
          (event.key === "ArrowLeft" ||
            event.key === "ArrowRight") &&
          !event.shiftKey &&
          !onVariantRow
        ) {
          view.dispatch(
            view.state.tr.setMeta(
              selectionMenuPluginKey,
              null
            )
          );
          return true;
        }

        // Enter: apply active variant or action
        if (event.key === "Enter") {
          if (onVariantRow) {
            // Apply active variant
            const { word } =
              st.analysis
                .singleGlyphWithVariants!;
            const cp = wordToCodepoint[word];
            if (cp === undefined) return false;
            const idx = st.activeVariantIndex;

            let newText: string;
            if (word === "ni") {
              const dir =
                niDirectionByIndex(idx);
              if (dir) {
                newText = niDirStringEffective(dir);
              } else {
                newText = codepointToChar(cp);
              }
            } else {
              newText = codepointToChar(cp);
              if (idx > 0) {
                newText +=
                  String.fromCodePoint(
                    VARIATION_SELECTOR_BASE +
                      (idx - 1)
                  );
              }
            }

            const tr = view.state.tr.insertText(
              newText,
              st.analysis.from,
              st.analysis.to
            );
            tr.setMeta(
              selectionMenuPluginKey,
              null
            );
            view.dispatch(tr);
            return true;
          }

          if (
            st.actions.length > 0 &&
            st.activeActionIndex >= 0
          ) {
            view.dispatch(
              view.state.tr.setMeta(
                selectionMenuPluginKey,
                {
                  executeAction:
                    st.actions[
                      st.activeActionIndex
                    ],
                }
              )
            );
            return true;
          }
        }

        // Direct shortcut keys
        const shortcutMap: Array<{
          key: string;
          pair: [ActionId, ActionId];
        }> = [
          {
            key: "[",
            pair: [
              "wrapCartouche",
              "unwrapCartouche",
            ],
          },
          {
            key: "(",
            pair: [
              "wrapLongGlyph",
              "unwrapLongGlyph",
            ],
          },
          {
            key: "-",
            pair: ["stack", "unstack"],
          },
          {
            key: "+",
            pair: ["scale", "unscale"],
          },
          {
            key: "&",
            pair: ["join", "unjoin"],
          },
          {
            key: "Tab",
            pair: [
              "convertToVerbatim",
              "convertToSP",
            ],
          },
        ];

        for (const { key, pair } of shortcutMap) {
          if (event.key !== key) continue;
          const actionId = pair.find(
            (id) => st.actions.includes(id)
          );
          if (!actionId) return false;
          const idx =
            st.actions.indexOf(actionId);
          view.dispatch(
            view.state.tr.setMeta(
              selectionMenuPluginKey,
              {
                activeActionIndex: idx,
                executeAction: actionId,
              }
            )
          );
          return true;
        }

        return false;
      },
    },

  });
}

// ── Action functions ────────────────────────────
//
// Every action below rebuilds its target range as a
// plain string (extract → transform → reinsert). A
// hardBreak leaf inside that range has no character
// of its own, so a plain `textBetween` extraction
// silently drops it and the reinsert deletes it from
// the document. Each extraction here instead passes
// `BREAK` as the leafText so a hardBreak contributes
// exactly one opaque placeholder char that survives
// the string transform; `insertPreservingBreaks`
// then turns every `BREAK` back into a real hardBreak
// node when writing the result back into the doc.

/**
 * U+FFFC (object replacement character): the
 * placeholder used to keep hardBreak leaves alive
 * through a string round-trip. Matches no UCSUR
 * control char, ni arrow, word char, or Latin letter
 * (verified char class by char class), so `toVerbatim`/`fromVerbatim`
 * and the codepoint filters below all pass it through
 * unrecognized rather than mangling it.
 */
const BREAK = "￼";
const BREAK_CP = 0xfffc;

/**
 * Replace [from, to) with `text`, where `BREAK` marks
 * a hardBreak to reinsert as a real node. Keeps soft
 * breaks alive through the string-rebuild actions
 * below instead of silently deleting them.
 */
function insertPreservingBreaks(
  tr: Transaction,
  schema: Schema,
  text: string,
  from: number,
  to: number
): void {
  const parts = text.split(BREAK);
  const nodes: PmNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) {
      nodes.push(schema.nodes.hardBreak.create());
    }
    if (part.length > 0) {
      nodes.push(schema.text(part));
    }
  });
  tr.replaceWith(from, to, Fragment.from(nodes));
}

/**
 * Extract UCSUR word glyphs (+ optional VS, or ZWJ +
 * ni arrow) from `text`, stripping everything else
 * (existing joiners, control chars, `BREAK`). Used to
 * rebuild a glyph sequence joined by a stacking/
 * scaling/ZWJ joiner.
 */
function extractGlyphTokens(text: string): string[] {
  const glyphs: string[] = [];
  const cpIter = [...codepoints(text)];
  for (let i = 0; i < cpIter.length; i++) {
    const [cp] = cpIter[i];
    if (!isWordGlyph(cp)) continue;
    let glyph = String.fromCodePoint(cp);
    if (i + 1 < cpIter.length) {
      const [nextCp] = cpIter[i + 1];
      if (isVariationSelector(nextCp)) {
        glyph += String.fromCodePoint(nextCp);
        i++;
      } else if (
        nextCp === ZWJ &&
        i + 2 < cpIter.length &&
        isNiArrowCp(cpIter[i + 2][0])
      ) {
        glyph +=
          String.fromCodePoint(ZWJ) +
          String.fromCodePoint(
            cpIter[i + 2][0]
          );
        i += 2;
      }
    }
    glyphs.push(glyph);
  }
  return glyphs;
}

function wrapInCartouche(
  editor: Editor,
  from: number,
  to: number
): void {
  const text = editor.state.doc.textBetween(
    from,
    to,
    undefined,
    BREAK
  );

  // Preserve internal structure (joiners, long
  // glyph markers, VS, hardBreaks). Strip existing
  // cartouche markers and non-UCSUR chars (spaces).
  const inner: string[] = [];
  let hasContent = false;
  for (const [cp] of codepoints(text)) {
    if (cp === BREAK_CP) {
      inner.push(BREAK);
      continue;
    }
    if (
      isVariationSelector(cp) ||
      cp === ZWJ ||
      isNiArrowCp(cp)
    ) {
      inner.push(String.fromCodePoint(cp));
      continue;
    }
    if (
      cp === START_OF_CARTOUCHE ||
      cp === END_OF_CARTOUCHE ||
      cp === CARTOUCHE_EXTENSION
    ) {
      continue;
    }
    if (isWordGlyph(cp) || isControlChar(cp)) {
      inner.push(String.fromCodePoint(cp));
      if (isWordGlyph(cp)) hasContent = true;
      continue;
    }
    // skip non-UCSUR (spaces, Latin, etc.)
  }

  if (!hasContent) return;

  const start = String.fromCodePoint(
    START_OF_CARTOUCHE
  );
  const end = String.fromCodePoint(
    END_OF_CARTOUCHE
  );

  const result = start + inner.join("") + end;

  const tr = editor.state.tr;
  insertPreservingBreaks(
    tr, editor.schema, result, from, to
  );
  tr.setMeta(selectionMenuPluginKey, null);
  editor.view.dispatch(tr);
}

function wrapInLongGlyph(
  editor: Editor,
  from: number,
  to: number,
  adjacent: AdjacentLongGlyph | null,
  precedingGlyphFrom: number | null
): void {
  const text = editor.state.doc.textBetween(
    from,
    to,
    undefined,
    BREAK
  );
  const startChar = String.fromCodePoint(
    START_OF_LONG_GLYPH
  );
  const endChar = String.fromCodePoint(
    END_OF_LONG_GLYPH
  );

  // Extend an adjacent long glyph: move its
  // boundary to include the selected content
  if (adjacent) {
    if (adjacent.side === "before") {
      // END is right before selection; replace
      // END + selection with selection + END
      const tr = editor.state.tr;
      insertPreservingBreaks(
        tr,
        editor.schema,
        text + endChar,
        adjacent.markerPos,
        to
      );
      tr.setMeta(selectionMenuPluginKey, null);
      editor.view.dispatch(tr);
      return;
    }
    // START is right after selection; replace
    // selection + START with START + selection
    const markerLen =
      START_OF_LONG_GLYPH > 0xffff ? 2 : 1;
    const tr = editor.state.tr;
    insertPreservingBreaks(
      tr,
      editor.schema,
      startChar + text,
      from,
      adjacent.markerPos + markerLen
    );
    tr.setMeta(selectionMenuPluginKey, null);
    editor.view.dispatch(tr);
    return;
  }

  // Preceding glyph is the container — expand
  // the replacement range to include it.
  // Encoding: container START content END
  if (precedingGlyphFrom !== null) {
    const container =
      editor.state.doc.textBetween(
        precedingGlyphFrom,
        from,
        undefined,
        BREAK
      );
    const tr = editor.state.tr;
    insertPreservingBreaks(
      tr,
      editor.schema,
      container + startChar + text + endChar,
      precedingGlyphFrom,
      to
    );
    tr.setMeta(selectionMenuPluginKey, null);
    editor.view.dispatch(tr);
    return;
  }

  // First glyph in selection is the container.
  // Encoding: container START rest END
  const cpList = [...codepoints(text)];
  let containerEnd = 0;
  for (let i = 0; i < cpList.length; i++) {
    const [cp, off] = cpList[i];
    if (!isWordGlyph(cp)) continue;
    containerEnd = off + (cp > 0xffff ? 2 : 1);
    // include trailing VS or ZWJ+arrow
    if (i + 1 < cpList.length) {
      const [nextCp] = cpList[i + 1];
      if (isVariationSelector(nextCp)) {
        containerEnd += 1;
      } else if (
        nextCp === ZWJ &&
        i + 2 < cpList.length &&
        isNiArrowCp(cpList[i + 2][0])
      ) {
        containerEnd += 2; // ZWJ + arrow
      }
    }
    break;
  }

  if (
    containerEnd === 0 ||
    containerEnd >= text.length
  ) {
    return;
  }

  const container = text.substring(
    0,
    containerEnd
  );
  const content = text.substring(containerEnd);

  const tr = editor.state.tr;
  insertPreservingBreaks(
    tr,
    editor.schema,
    container + startChar + content + endChar,
    from,
    to
  );
  tr.setMeta(selectionMenuPluginKey, null);
  editor.view.dispatch(tr);
}

function joinWithJoiner(
  editor: Editor,
  from: number,
  to: number,
  joinerCp: number
): void {
  const text = editor.state.doc.textBetween(
    from,
    to,
    undefined,
    BREAK
  );
  const joiner = String.fromCodePoint(joinerCp);

  // Joiners never sit adjacent to a break: extract
  // and join glyphs within each line segment
  // separately, then rejoin segments on BREAK so the
  // hardBreak survives un-joined between them.
  const segments = text.split(BREAK);
  const glyphSegments = segments.map(
    extractGlyphTokens
  );
  const totalGlyphs = glyphSegments.reduce(
    (n, g) => n + g.length,
    0
  );
  if (totalGlyphs < 2) return;

  const result = glyphSegments
    .map((g) => g.join(joiner))
    .join(BREAK);

  const tr = editor.state.tr;
  insertPreservingBreaks(
    tr, editor.schema, result, from, to
  );
  tr.setMeta(selectionMenuPluginKey, null);
  editor.view.dispatch(tr);
}

function unwrapCartouche(
  editor: Editor,
  wrapFrom: number,
  wrapTo: number
): void {
  const text = editor.state.doc.textBetween(
    wrapFrom,
    wrapTo,
    undefined,
    BREAK
  );
  const cleaned: string[] = [];
  for (const [cp] of codepoints(text)) {
    if (
      cp === START_OF_CARTOUCHE ||
      cp === END_OF_CARTOUCHE ||
      cp === CARTOUCHE_EXTENSION
    ) {
      continue;
    }
    cleaned.push(String.fromCodePoint(cp));
  }

  const tr = editor.state.tr;
  insertPreservingBreaks(
    tr,
    editor.schema,
    cleaned.join(""),
    wrapFrom,
    wrapTo
  );
  tr.setMeta(selectionMenuPluginKey, null);
  editor.view.dispatch(tr);
}

function unwrapLongGlyph(
  editor: Editor,
  wrapFrom: number,
  wrapTo: number
): void {
  const text = editor.state.doc.textBetween(
    wrapFrom,
    wrapTo,
    undefined,
    BREAK
  );
  const cleaned: string[] = [];
  for (const [cp] of codepoints(text)) {
    if (
      cp === START_OF_LONG_GLYPH ||
      cp === END_OF_LONG_GLYPH
    ) {
      continue;
    }
    cleaned.push(String.fromCodePoint(cp));
  }

  const tr = editor.state.tr;
  insertPreservingBreaks(
    tr,
    editor.schema,
    cleaned.join(""),
    wrapFrom,
    wrapTo
  );
  tr.setMeta(selectionMenuPluginKey, null);
  editor.view.dispatch(tr);
}

function shrinkLongGlyphTail(
  editor: Editor,
  from: number,
  wrapTo: number
): void {
  const endChar = String.fromCodePoint(
    END_OF_LONG_GLYPH
  );
  const endLen =
    END_OF_LONG_GLYPH > 0xffff ? 2 : 1;
  const content =
    editor.state.doc.textBetween(
      from, wrapTo - endLen, undefined, BREAK
    );
  const tr = editor.state.tr;
  insertPreservingBreaks(
    tr,
    editor.schema,
    endChar + content,
    from,
    wrapTo
  );
  tr.setMeta(selectionMenuPluginKey, null);
  editor.view.dispatch(tr);
}

function removeJoiners(
  editor: Editor,
  from: number,
  to: number
): void {
  const text = editor.state.doc.textBetween(
    from,
    to,
    undefined,
    BREAK
  );
  const cleaned: string[] = [];
  for (const [cp] of codepoints(text)) {
    if (isJoiner(cp)) continue;
    cleaned.push(String.fromCodePoint(cp));
  }

  const tr = editor.state.tr;
  insertPreservingBreaks(
    tr,
    editor.schema,
    cleaned.join(""),
    from,
    to
  );
  tr.setMeta(selectionMenuPluginKey, null);
  editor.view.dispatch(tr);
}

function convertToVerbatimAction(
  editor: Editor,
  from: number,
  to: number
): void {
  const markType =
    editor.schema.marks.verbatim;
  const tr = editor.state.tr;

  // Collect per-block ranges
  const blocks: {
    from: number;
    to: number;
    text: string;
  }[] = [];
  editor.state.doc.nodesBetween(
    from,
    to,
    (node, pos) => {
      if (!node.isTextblock) return;
      const blockFrom = Math.max(
        from,
        pos + 1
      );
      const blockTo = Math.min(
        to,
        pos + 1 + node.content.size
      );
      if (blockFrom >= blockTo) return;
      blocks.push({
        from: blockFrom,
        to: blockTo,
        text: editor.state.doc.textBetween(
          blockFrom,
          blockTo,
          undefined,
          BREAK
        ),
      });
    }
  );

  // Process in reverse to preserve positions
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const verbatim = toVerbatim(block.text);
    insertPreservingBreaks(
      tr,
      editor.schema,
      verbatim,
      block.from,
      block.to
    );
  }

  // Add the mark to text nodes only. A single
  // range-wide addMark would also land on the
  // hardBreak nodes `insertPreservingBreaks` just
  // inserted above — ProseMirror's addMark checks
  // the PARENT's allowsMarkType, not the child's, so
  // it happily marks a leaf node whose type doesn't
  // even declare the mark. `lipuToContent` never
  // produces a marked hardBreak, so that would
  // desync this doc from its lipu mirror. Walk text
  // nodes individually and skip everything else.
  const mappedFrom = tr.mapping.map(from);
  const mappedTo = tr.mapping.map(to);
  tr.doc.nodesBetween(
    mappedFrom,
    mappedTo,
    (node, pos) => {
      if (!node.isText) return;
      const nodeFrom = Math.max(mappedFrom, pos);
      const nodeTo = Math.min(
        mappedTo,
        pos + node.nodeSize
      );
      if (nodeFrom < nodeTo) {
        tr.addMark(
          nodeFrom,
          nodeTo,
          markType.create()
        );
      }
    }
  );
  tr.setMeta(selectionMenuPluginKey, null);
  editor.view.dispatch(tr);
}

function convertFromVerbatimAction(
  editor: Editor,
  from: number,
  to: number
): void {
  const markType =
    editor.schema.marks.verbatim;
  const tr = editor.state.tr;

  // Collect per-block ranges
  const blocks: {
    from: number;
    to: number;
    text: string;
  }[] = [];
  editor.state.doc.nodesBetween(
    from,
    to,
    (node, pos) => {
      if (!node.isTextblock) return;
      const blockFrom = Math.max(
        from,
        pos + 1
      );
      const blockTo = Math.min(
        to,
        pos + 1 + node.content.size
      );
      if (blockFrom >= blockTo) return;
      blocks.push({
        from: blockFrom,
        to: blockTo,
        text: editor.state.doc.textBetween(
          blockFrom,
          blockTo,
          undefined,
          BREAK
        ),
      });
    }
  );

  // Process in reverse to preserve positions
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const sp = fromVerbatim(block.text);
    insertPreservingBreaks(
      tr,
      editor.schema,
      sp,
      block.from,
      block.to
    );
  }

  // Remove mark across the full mapped range
  const mappedFrom = tr.mapping.map(from);
  const mappedTo = tr.mapping.map(to);
  tr.removeMark(mappedFrom, mappedTo, markType);
  tr.setMeta(selectionMenuPluginKey, null);
  editor.view.dispatch(tr);
}

// ── Action execution ────────────────────────────

function performAction(
  editor: Editor,
  actionId: ActionId,
  analysis: SelectionAnalysis
): void {
  const {
    from,
    to,
    insideCartouche,
    insideLongGlyph,
    adjacentLongGlyph,
    precedingLongGlyph,
  } = analysis;

  switch (actionId) {
    case "wrapCartouche":
      wrapInCartouche(editor, from, to);
      break;
    case "unwrapCartouche":
      if (insideCartouche) {
        unwrapCartouche(
          editor,
          insideCartouche.wrapFrom,
          insideCartouche.wrapTo
        );
      }
      break;
    case "wrapLongGlyph":
      wrapInLongGlyph(
        editor,
        from,
        to,
        adjacentLongGlyph,
        precedingLongGlyph?.glyphFrom ?? null
      );
      break;
    case "unwrapLongGlyph":
      if (insideLongGlyph) {
        if (analysis.longGlyphTail) {
          shrinkLongGlyphTail(
            editor,
            from,
            insideLongGlyph.wrapTo
          );
        } else {
          unwrapLongGlyph(
            editor,
            insideLongGlyph.wrapFrom,
            insideLongGlyph.wrapTo
          );
        }
      }
      break;
    case "stack":
      joinWithJoiner(
        editor, from, to, STACKING_JOINER
      );
      break;
    case "scale":
      joinWithJoiner(
        editor, from, to, SCALING_JOINER
      );
      break;
    case "join":
      joinWithJoiner(
        editor, from, to, ZWJ
      );
      break;
    case "unstack":
    case "unscale":
    case "unjoin":
      removeJoiners(editor, from, to);
      break;
    case "convertToVerbatim":
      convertToVerbatimAction(
        editor, from, to
      );
      break;
    case "convertToSP":
      convertFromVerbatimAction(
        editor, from, to
      );
      break;
  }
}

// ── React component ─────────────────────────────

interface SelectionMenuProps {
  editor: Editor;
}

const MAX_PREVIEW_LINES = 5;

function truncatePreview(
  text: string
): string {
  const lines = text.split("\n");
  if (lines.length <= MAX_PREVIEW_LINES) {
    return text;
  }
  return (
    lines.slice(0, MAX_PREVIEW_LINES).join("\n")
    + "\n\u2026"
  );
}

function glyphChar(
  word: string,
  variation?: number
): string {
  const cp = wordToCodepoint[word];
  if (cp === undefined) return "";
  const base = codepointToChar(cp);
  if (variation && variation > 0) {
    if (word === "ni") {
      const dir = niDirectionByIndex(variation);
      if (dir) return niDirStringEffective(dir);
    }
    return applyVariation(base, variation);
  }
  return base;
}

/**
 * Strip structural marker characters from a
 * verbatim string (parens, brackets, joiners,
 * cartouche extension) and normalize whitespace.
 */
function stripCartoucheMarkers(
  v: string
): string {
  return v
    .replace(/[[\]=_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLongGlyphMarkers(
  v: string
): string {
  return v
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderActionLabel(
  actionId: ActionId,
  analysis: SelectionAnalysis
): React.ReactNode {
  const first = analysis.firstGlyphWord ?? "?";
  const second =
    analysis.secondGlyphWord ?? "?";
  const singleLine = analysis.isSingleParagraph;
  const preview = analysis.verbatimPreview;
  const cls = "selection-menu__action-label";

  // Convert actions keep their own layout
  if (actionId === "convertToVerbatim") {
    return (
      <span className={cls}>
        <SP>sitelen+pona ala</SP>
        {analysis.verbatimPreview && (
          <span
            className={
              "selection-menu"
              + "__action-preview"
            }
          >
            {truncatePreview(
              analysis.verbatimPreview
            )}
          </span>
        )}
      </span>
    );
  }
  if (actionId === "convertToSP") {
    return (
      <span className={cls}>
        <SP>sitelen+pona</SP>
        {analysis.sitelenPonaPreview && (
          <span
            className={
              "selection-menu"
              + "__action-preview"
              + " selection-menu"
              + "__action-preview--sp"
            }
          >
            {truncatePreview(
              analysis.sitelenPonaPreview
            )}
          </span>
        )}
      </span>
    );
  }

  // Compute "after" content for structural ops
  let afterNode: React.ReactNode;
  switch (actionId) {
    case "wrapCartouche":
      if (singleLine && preview) {
        afterNode = (
          <SP>{`[${preview}]`}</SP>
        );
      } else {
        afterNode = (
          <>
            <SP>[</SP>{"..."}<SP>]</SP>
          </>
        );
      }
      break;
    case "unwrapCartouche": {
      const cp =
        analysis.cartoucheContentPreview;
      if (cp) {
        const stripped =
          stripCartoucheMarkers(cp);
        afterNode = <SP>{stripped}</SP>;
      } else {
        afterNode = <>{"..."}</>;
      }
      break;
    }
    case "wrapLongGlyph": {
      const adjP =
        analysis.adjacentLongGlyphPreview;
      if (
        singleLine && preview && adjP &&
        analysis.adjacentLongGlyph?.side
          === "before"
      ) {
        // Extending adjacent: insert selected
        // content before closing paren
        const lp = adjP.lastIndexOf(")");
        const after = lp >= 0
          ? adjP.slice(0, lp) +
            ` ${preview})`
          : `${adjP} ${preview}`;
        afterNode = <SP>{after}</SP>;
      } else if (singleLine && preview) {
        if (analysis.precedingLongGlyph) {
          const c =
            analysis.precedingLongGlyph.word;
          afterNode = (
            <SP>{`${c}(${preview})`}</SP>
          );
        } else if (
          !analysis.adjacentLongGlyph
        ) {
          const idx = preview.indexOf(" ");
          if (idx >= 0) {
            const c = preview.slice(0, idx);
            const rest =
              preview.slice(idx + 1);
            afterNode = (
              <SP>{`${c}(${rest})`}</SP>
            );
          } else {
            afterNode = (
              <>
                <SP>{`${first}(`}</SP>
                {"..."}
                <SP>)</SP>
              </>
            );
          }
        } else {
          afterNode = (
            <>
              <SP>{`${first}(`}</SP>
              {"..."}
              <SP>)</SP>
            </>
          );
        }
      } else {
        afterNode = (
          <>
            <SP>{`${first}(`}</SP>
            {"..."}
            <SP>)</SP>
          </>
        );
      }
      break;
    }
    case "unwrapLongGlyph": {
      if (
        analysis.longGlyphTail &&
        analysis.longGlyphTailHeadPreview
      ) {
        if (singleLine && preview) {
          afterNode = (
            <SP>
              {analysis.longGlyphTailHeadPreview +
                ` ${preview}`}
            </SP>
          );
        } else {
          afterNode = (
            <>
              <SP>
                {analysis
                  .longGlyphTailHeadPreview}
              </SP>
              {" ..."}
            </>
          );
        }
        break;
      }
      const container =
        analysis.longGlyphContainerWord
        ?? first;
      const lgPreview =
        analysis.longGlyphContentPreview
        ?? preview;
      if (singleLine && lgPreview) {
        const content =
          stripLongGlyphMarkers(lgPreview);
        const words = content.split(" ");
        const inner =
          words[0] === container
            ? words.slice(1).join(" ")
            : content;
        afterNode = (
          <SP>{`${container} ${inner}`}</SP>
        );
      } else {
        afterNode = (
          <>
            <SP>{`${container}`}</SP>
            {" ..."}
          </>
        );
      }
      break;
    }
    case "stack":
      afterNode = (
        <SP>{`${first}-${second}`}</SP>
      );
      break;
    case "scale":
      afterNode = (
        <SP>{`${first}+${second}`}</SP>
      );
      break;
    case "join":
      afterNode = (
        <SP>{`${first}&${second}`}</SP>
      );
      break;
    case "unstack":
    case "unscale":
    case "unjoin":
      afterNode = (
        <SP>{`${first} ${second}`}</SP>
      );
      break;
  }

  // Show before→after for structural ops when
  // single-line preview is available
  if (singleLine && preview) {
    // Determine the before verbatim string
    let beforeStr = preview;
    if (
      actionId === "unwrapCartouche" &&
      analysis.cartoucheContentPreview
    ) {
      beforeStr =
        analysis.cartoucheContentPreview;
    } else if (
      actionId === "unwrapLongGlyph" &&
      analysis.longGlyphContainerWord &&
      analysis.insideLongGlyph?.kind
        === "surrounding"
    ) {
      const c =
        analysis.longGlyphContainerWord;
      const lgp =
        analysis.longGlyphContentPreview;
      beforeStr = lgp
        ? `${c}${lgp}`
        : `${c}(${preview})`;
    } else if (
      actionId === "wrapLongGlyph" &&
      analysis.adjacentLongGlyphPreview &&
      analysis.adjacentLongGlyph?.side
        === "before"
    ) {
      beforeStr =
        `${analysis.adjacentLongGlyphPreview}` +
        ` ${preview}`;
    }

    return (
      <span className={cls}>
        <span
          className={
            "selection-menu"
            + "__action-before"
          }
        >
          <SP>{beforeStr}</SP>
        </span>
        <span
          className={
            "selection-menu"
            + "__action-arrow"
          }
        >
          {"\u2192"}
        </span>
        {afterNode}
      </span>
    );
  }

  return (
    <span className={cls}>
      {afterNode}
    </span>
  );
}

export function SelectionMenu({
  editor,
}: SelectionMenuProps) {
  const [analysis, setAnalysis] =
    useState<SelectionAnalysis | null>(null);
  const [actions, setActions] =
    useState<ActionId[]>([]);
  const [activeActionIndex, setActiveActionIndex] =
    useState(0);
  const [activeVariantIndex, setActiveVariantIndex] =
    useState(0);
  const [coords, setCoords] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const executeAction = useCallback(
    (actionId: ActionId) => {
      if (!analysis) return;
      performAction(editor, actionId, analysis);
    },
    [editor, analysis]
  );

  useEffect(() => {
    const update = ({
      transaction: tr,
    }: {
      transaction: any;
    }) => {
      const meta = tr.getMeta(
        selectionMenuPluginKey
      );
      if (meta?.executeAction) {
        // Read analysis fresh from plugin state
        // to avoid stale closure
        const fresh =
          selectionMenuPluginKey.getState(
            editor.state
          ) as SelectionMenuPluginState;
        if (fresh.analysis) {
          performAction(
            editor,
            meta.executeAction,
            fresh.analysis
          );
        }
        return;
      }

      const st =
        selectionMenuPluginKey.getState(
          editor.state
        ) as SelectionMenuPluginState;
      if (!st.analysis) {
        setCoords(null);
        setAnalysis(null);
        setActions([]);
        setActiveActionIndex(0);
        setActiveVariantIndex(0);
        return;
      }
      try {
        const cFrom =
          editor.view.coordsAtPos(
            st.analysis.from
          );
        const cTo =
          editor.view.coordsAtPos(
            st.analysis.to
          );
        setCoords({
          left: cFrom.left,
          top: cTo.bottom,
        });
      } catch {
        setCoords(null);
      }
      setAnalysis(st.analysis);
      setActions(st.actions);
      setActiveActionIndex(
        st.activeActionIndex
      );
      setActiveVariantIndex(
        st.activeVariantIndex
      );
    };

    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  const handleVariantSelect = useCallback(
    (variation: number) => {
      if (!analysis?.singleGlyphWithVariants) {
        return;
      }
      const { word } =
        analysis.singleGlyphWithVariants;
      const { from, to } = analysis;

      const cp = wordToCodepoint[word];
      if (cp === undefined) return;

      let newText: string;
      if (word === "ni" && variation > 0) {
        const dir =
          niDirectionByIndex(variation);
        if (dir) {
          newText = niDirStringEffective(dir);
        } else {
          newText = codepointToChar(cp);
        }
      } else {
        newText = codepointToChar(cp);
        if (variation > 0) {
          newText += String.fromCodePoint(
            VARIATION_SELECTOR_BASE +
              (variation - 1)
          );
        }
      }

      const tr = editor.state.tr.insertText(
        newText,
        from,
        to
      );
      tr.setMeta(selectionMenuPluginKey, null);
      editor.view.dispatch(tr);
    },
    [editor, analysis]
  );

  const preventBlur = useCallback(
    (e: React.MouseEvent) => e.preventDefault(),
    []
  );

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector(
      ".selection-menu__action-item--active"
    );
    if (active) {
      active.scrollIntoView({
        block: "nearest",
      });
    }
  }, [activeActionIndex]);

  // The third SP blur consumer, on
  // the same deferral as the other two. The
  // retired requestAnimationFrame + isFocused
  // guess is replaced by the FocusTracker's
  // settle, which is authoritative about where
  // focus went: the menu survives a blur the SP
  // pane itself answers (a popup click that
  // refocuses the editor) and is torn down for
  // anything else — a true blur, or a hop to the
  // Latin pane, where this SP selection is no
  // longer the thing being acted on.
  useEffect(() => {
    const tearDown = () => {
      setAnalysis(null);
      setActions([]);
      setActiveActionIndex(0);
      setCoords(null);
    };
    const onBlur = () => {
      // NameInput builds its own editor out of
      // these same extensions, and it is NOT a
      // pane: its blur can never be a pane hop, so
      // it tears down synchronously (its menu is
      // portaled to the body — leaving it up hangs
      // it over the app) and never borrows the
      // pane's single pendingBlur slot.
      if (!focusTracker.isSpView(editor.view)) {
        tearDown();
        return;
      }
      focusTracker.notifyBlur("sp", (now) => {
        // The menu survives only a blur the SP pane
        // itself answered — a popup click that
        // refocuses this editor.
        if (now !== "sp") tearDown();
      });
    };
    editor.on("blur", onBlur);
    return () => {
      editor.off("blur", onBlur);
    };
  }, [editor]);

  if (!analysis || !coords) {
    return null;
  }

  const {
    singleGlyphWithVariants,
  } = analysis;

  const showVariants =
    singleGlyphWithVariants !== null;

  const style: React.CSSProperties = {
    left: `${coords.left}px`,
    top: `${coords.top + 4}px`,
    position: "fixed",
    zIndex: 100,
  };

  return (
    <div
      className="selection-menu"
      style={style}
    >
      {showVariants && (
        <div className="selection-menu__section">
          <div className="variant-row">
            {getVariations(
              singleGlyphWithVariants!.word
            ).map((v) => {
              const isActive =
                activeActionIndex === -1 &&
                activeVariantIndex === v.index;
              return (
                <button
                  key={v.index}
                  className={
                    "variant-row__btn"
                    + (isActive
                      ? " variant-row__btn"
                        + "--active"
                      : "")
                  }
                  onMouseDown={preventBlur}
                  onClick={() =>
                    handleVariantSelect(v.index)
                  }
                  title={v.description}
                  type="button"
                >
                  <span
                    className={
                      "variant-row__glyph"
                    }
                  >
                    {glyphChar(
                      singleGlyphWithVariants!
                        .word,
                      v.index
                    )}
                  </span>
                  <kbd>
                    {v.index}
                  </kbd>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {actions.length > 0 && (
        <div
          className="selection-menu__section"
          ref={listRef}
        >
          <div
            className={
              "selection-menu__action-list"
            }
          >
            {actions.map((actionId, i) => {
              const active =
                i === activeActionIndex;
              return (
                <div
                  key={actionId}
                  className={
                    "selection-menu__action-item"
                    + (active
                      ? " selection-menu"
                        + "__action-item--active"
                      : "")
                  }
                  onMouseDown={preventBlur}
                  onClick={() =>
                    executeAction(actionId)
                  }
                  onMouseEnter={() => {
                    setActiveActionIndex(i);
                    editor.view.dispatch(
                      editor.state.tr.setMeta(
                        selectionMenuPluginKey,
                        { activeActionIndex: i }
                      )
                    );
                  }}
                >
                  {renderActionLabel(
                    actionId,
                    analysis
                  )}
                  <span
                    className={
                      "selection-menu"
                      + "__action-hint"
                    }
                  >
                    <kbd>
                      {ACTION_HINTS[actionId]}
                    </kbd>
                    {active && (
                      <kbd>
                        {"\u21B5"}
                      </kbd>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
