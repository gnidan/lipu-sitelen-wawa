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
} from "@tiptap/pm/state";
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
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
  START_OF_LONG_GLYPH,
  END_OF_LONG_GLYPH,
  STACKING_JOINER,
  SCALING_JOINER,
} from "../../data";
import {
  VARIATION_SELECTOR_BASE,
} from "../../data/variations";
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

export const selectionMenuPluginKey = new PluginKey(
  "selectionMenu"
);

// Words whose glyphs have a long form in nasin
// nanpa v4. The first glyph in a long glyph
// sequence is the container that stretches.
// (la is reversed: content comes before it)
const LONG_GLYPH_WORDS = new Set([
  "a",
  "alasa",
  "anu",
  "awen",
  "kama",
  "ken",
  "kepeken",
  "la",
  "lon",
  "nanpa",
  "open",
  "pi",
  "pini",
  "sona",
  "tawa",
  "wile",
  "n",
]);

// ── Selection analysis ──────────────────────────

interface WrapInfo {
  kind: "selected" | "surrounding";
  wrapFrom: number;
  wrapTo: number;
}

interface AdjacentLongGlyph {
  side: "before" | "after";
  markerPos: number; // doc position of the marker
}

interface SelectionAnalysis {
  text: string;
  from: number;
  to: number;

  singleGlyphWithVariants: {
    word: string;
  } | null;
  containsUcsur: boolean;
  containsLatin: boolean;
  isSingleParagraph: boolean;
  glyphCount: number;
  firstGlyphWord: string | null;
  secondGlyphWord: string | null;
  hasStackingJoiner: boolean;
  hasScalingJoiner: boolean;
  hasLongGlyphMarkers: boolean;

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
  | "unstack"
  | "unscale"
  | "convertToVerbatim"
  | "convertToSP";

export interface SelectionMenuPluginState {
  analysis: SelectionAnalysis | null;
  actions: ActionId[];
  activeActionIndex: number;
}

const ACTION_HINTS: Record<ActionId, string> = {
  wrapCartouche: "[",
  unwrapCartouche: "[",
  wrapLongGlyph: "(",
  unwrapLongGlyph: "(",
  stack: "-",
  scale: "+",
  unstack: "-",
  unscale: "+",
  convertToVerbatim: "\u21E5",
  convertToSP: "\u21E5",
};

// ── Wrapper detection helpers ───────────────────

function detectSelectedWrap(
  text: string,
  from: number,
  startCp: number,
  endCp: number
): WrapInfo | null {
  let hasStart = false;
  let hasEnd = false;
  for (const [cp] of codepoints(text)) {
    if (cp === startCp) hasStart = true;
    if (cp === endCp) hasEnd = true;
  }
  if (hasStart && hasEnd) {
    return {
      kind: "selected",
      wrapFrom: from,
      wrapTo: from + text.length,
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
  const blockText = parent.textContent;
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

// ── Selection analysis ──────────────────────────

function analyzeSelection(
  state: EditorState
): SelectionAnalysis | null {
  const { from, to } = state.selection;
  if (from === to) return null;

  const text = state.doc.textBetween(from, to);
  if (text.length === 0) return null;

  // Single glyph with variants check
  let singleGlyphWithVariants: {
    word: string;
  } | null = null;
  {
    let idx = 0;
    const cp = text.codePointAt(idx);
    if (
      cp !== undefined &&
      isUcsurChar(String.fromCodePoint(cp))
    ) {
      const charLen = cp > 0xffff ? 2 : 1;
      let end = charLen;
      if (end < text.length) {
        const nextCp = text.codePointAt(end);
        if (
          nextCp !== undefined &&
          isVariationSelector(nextCp)
        ) {
          end += 1;
        }
      }
      if (end === text.length) {
        const word = codepointToWord[cp];
        if (word && hasVariations(word)) {
          singleGlyphWithVariants = { word };
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
  let hasLongGlyphMarkers = false;

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
    if (
      cp === START_OF_LONG_GLYPH ||
      cp === END_OF_LONG_GLYPH
    ) {
      hasLongGlyphMarkers = true;
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
    const blockText = $from.parent.textContent;
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

    // Check glyph immediately before selection
    // (skip trailing VS to reach the glyph)
    let idx = cpsBefore.length - 1;
    if (
      idx >= 0 &&
      isVariationSelector(cpsBefore[idx][0])
    ) {
      idx--;
    }
    if (idx >= 0) {
      const [cp, off] = cpsBefore[idx];
      if (isWordGlyph(cp)) {
        const w = codepointToWord[cp];
        if (w && LONG_GLYPH_WORDS.has(w)) {
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
    const blockText = $to.parent.textContent;
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
  const insideCartouche =
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
    );

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
        const bt = $lwf.parent.textContent;
        const before =
          bt.substring(0, lwf - bs);
        const cps = [...codepoints(before)];
        for (
          let i = cps.length - 1;
          i >= 0;
          i--
        ) {
          const [c] = cps[i];
          if (isVariationSelector(c)) continue;
          if (isWordGlyph(c)) {
            longGlyphContainerWord =
              codepointToWord[c] ?? null;
          }
          break;
        }
      }
    }
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

  return {
    text,
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
    hasLongGlyphMarkers,
    insideCartouche,
    insideLongGlyph,
    adjacentLongGlyph,
    precedingLongGlyph,
    longGlyphContainerWord,
    verbatimPreview,
    sitelenPonaPreview,
  };
}

// ── Visible actions ─────────────────────────────

function getVisibleActions(
  analysis: SelectionAnalysis
): ActionId[] {
  const actions: ActionId[] = [];
  const {
    containsUcsur,
    containsLatin,
    isSingleParagraph,
    glyphCount,
    firstGlyphWord,
    hasStackingJoiner,
    hasScalingJoiner,
    insideCartouche,
    insideLongGlyph,
    adjacentLongGlyph,
    precedingLongGlyph,
    verbatimPreview,
    sitelenPonaPreview,
  } = analysis;

  const showWrapCartouche =
    !insideCartouche &&
    containsUcsur &&
    glyphCount >= 1 &&
    !analysis.hasLongGlyphMarkers;
  const showUnwrapCartouche =
    insideCartouche !== null;
  const firstGlyphHasLongForm =
    firstGlyphWord !== null &&
    LONG_GLYPH_WORDS.has(firstGlyphWord);
  const showWrapLongGlyph =
    !insideLongGlyph &&
    containsUcsur &&
    (
      adjacentLongGlyph !== null ||
      (firstGlyphHasLongForm &&
        glyphCount >= 2) ||
      precedingLongGlyph !== null
    );
  const showUnwrapLongGlyph =
    insideLongGlyph !== null;
  const showStack =
    glyphCount === 2 &&
    isSingleParagraph &&
    !hasStackingJoiner;
  const showScale =
    glyphCount === 2 &&
    isSingleParagraph &&
    !hasScalingJoiner;
  const showUnstack =
    glyphCount === 2 && hasStackingJoiner;
  const showUnscale =
    glyphCount === 2 && hasScalingJoiner;
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
  if (showUnstack) actions.push("unstack");
  if (showUnscale) actions.push("unscale");
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

        // Navigate active action index
        if (
          meta !== undefined &&
          typeof meta === "object" &&
          "activeActionIndex" in meta &&
          !("executeAction" in meta)
        ) {
          return {
            ...prev,
            activeActionIndex:
              meta.activeActionIndex,
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
          return {
            analysis,
            actions,
            activeActionIndex: 0,
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
        const idx = arraysEqual(
          actions,
          prev.actions
        )
          ? Math.min(
              prev.activeActionIndex,
              Math.max(actions.length - 1, 0)
            )
          : 0;
        return {
          analysis,
          actions,
          activeActionIndex: idx,
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

        // Digit keys: apply variant when single
        // glyph with variants is selected
        if (st.analysis.singleGlyphWithVariants) {
          const digit = parseInt(event.key, 10);
          if (!isNaN(digit)) {
            const { word } =
              st.analysis
                .singleGlyphWithVariants;
            const variations =
              getVariations(word);
            if (
              digit !== 0 &&
              !variations.some(
                (v) => v.index === digit
              )
            ) {
              return false;
            }

            const cp = wordToCodepoint[word];
            if (cp === undefined) return false;

            let newText = codepointToChar(cp);
            if (digit > 0) {
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

        // Arrow keys + Enter (action navigation)
        if (
          event.key === "ArrowDown" &&
          st.actions.length > 0
        ) {
          const next =
            (st.activeActionIndex + 1) %
            st.actions.length;
          view.dispatch(
            view.state.tr.setMeta(
              selectionMenuPluginKey,
              { activeActionIndex: next }
            )
          );
          return true;
        }

        if (
          event.key === "ArrowUp" &&
          st.actions.length > 0
        ) {
          const next =
            (st.activeActionIndex -
              1 +
              st.actions.length) %
            st.actions.length;
          view.dispatch(
            view.state.tr.setMeta(
              selectionMenuPluginKey,
              { activeActionIndex: next }
            )
          );
          return true;
        }

        if (
          event.key === "Enter" &&
          st.actions.length > 0
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

function wrapInCartouche(
  editor: Editor,
  from: number,
  to: number
): void {
  const text = editor.state.doc.textBetween(
    from,
    to
  );

  // Preserve internal structure (joiners, long
  // glyph markers, VS). Strip existing cartouche
  // markers and non-UCSUR chars (spaces).
  const inner: string[] = [];
  let hasContent = false;
  for (const [cp] of codepoints(text)) {
    if (isVariationSelector(cp)) {
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

  const tr = editor.state.tr.insertText(
    result,
    from,
    to
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
    to
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
      const tr = editor.state.tr.insertText(
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
    const tr = editor.state.tr.insertText(
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
        from
      );
    const tr = editor.state.tr.insertText(
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
    // include trailing variation selector
    if (i + 1 < cpList.length) {
      const [nextCp] = cpList[i + 1];
      if (isVariationSelector(nextCp)) {
        containerEnd += 1;
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

  const tr = editor.state.tr.insertText(
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
    to
  );
  const joiner = String.fromCodePoint(joinerCp);

  // Extract UCSUR word glyphs (+ optional VS),
  // stripping existing joiners/control chars
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
      }
    }
    glyphs.push(glyph);
  }

  if (glyphs.length < 2) return;

  const result = glyphs.join(joiner);
  const tr = editor.state.tr.insertText(
    result,
    from,
    to
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
    wrapTo
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

  const tr = editor.state.tr.insertText(
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
    wrapTo
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

  const tr = editor.state.tr.insertText(
    cleaned.join(""),
    wrapFrom,
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
    to
  );
  const cleaned: string[] = [];
  for (const [cp] of codepoints(text)) {
    if (isJoiner(cp)) continue;
    cleaned.push(String.fromCodePoint(cp));
  }

  const tr = editor.state.tr.insertText(
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
          blockTo
        ),
      });
    }
  );

  // Process in reverse to preserve positions
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const verbatim = toVerbatim(block.text);
    tr.insertText(
      verbatim, block.from, block.to
    );
  }

  // Add mark across the full mapped range
  const mappedFrom = tr.mapping.map(from);
  const mappedTo = tr.mapping.map(to);
  tr.addMark(
    mappedFrom,
    mappedTo,
    markType.create()
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
          blockTo
        ),
      });
    }
  );

  // Process in reverse to preserve positions
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const sp = fromVerbatim(block.text);
    tr.insertText(sp, block.from, block.to);
  }

  // Remove mark across the full mapped range
  const mappedFrom = tr.mapping.map(from);
  const mappedTo = tr.mapping.map(to);
  tr.removeMark(mappedFrom, mappedTo, markType);
  tr.setMeta(selectionMenuPluginKey, null);
  editor.view.dispatch(tr);
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
    return applyVariation(base, variation);
  }
  return base;
}

/**
 * Strip structural marker characters from a
 * verbatim string (parens, brackets, joiners,
 * cartouche extension) and normalize whitespace.
 */
function stripMarkers(v: string): string {
  return v
    .replace(/[[\](){}=_+\-]/g, " ")
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

  switch (actionId) {
    case "wrapCartouche":
      if (singleLine && preview) {
        return (
          <span className={cls}>
            <SP>{`[${preview}]`}</SP>
          </span>
        );
      }
      return (
        <span className={cls}>
          <SP>[</SP>
          {"..."}
          <SP>]</SP>
        </span>
      );
    case "unwrapCartouche": {
      if (singleLine && preview) {
        const stripped = stripMarkers(preview);
        return (
          <span className={cls}>
            <SP>{stripped}</SP>
          </span>
        );
      }
      return (
        <span className={cls}>
          {"..."}
        </span>
      );
    }
    case "wrapLongGlyph": {
      if (singleLine && preview) {
        if (analysis.precedingLongGlyph) {
          const c =
            analysis.precedingLongGlyph.word;
          return (
            <span className={cls}>
              <SP>{`${c}(${preview})`}</SP>
            </span>
          );
        }
        if (!analysis.adjacentLongGlyph) {
          // First glyph is container; split
          // preview at first space
          const idx = preview.indexOf(" ");
          if (idx >= 0) {
            const c = preview.slice(0, idx);
            const rest = preview.slice(idx + 1);
            return (
              <span className={cls}>
                <SP>{`${c}(${rest})`}</SP>
              </span>
            );
          }
        }
      }
      return (
        <span className={cls}>
          <SP>{`${first}(`}</SP>
          {"..."}
          <SP>)</SP>
        </span>
      );
    }
    case "unwrapLongGlyph": {
      const container =
        analysis.longGlyphContainerWord ?? first;
      if (singleLine && preview) {
        const content = stripMarkers(preview);
        // If container word appears as the first
        // word in content (selected kind includes
        // the container), don't duplicate it
        const words = content.split(" ");
        const inner =
          words[0] === container
            ? words.slice(1).join(" ")
            : content;
        return (
          <span className={cls}>
            <SP>{`${container} ${inner}`}</SP>
          </span>
        );
      }
      return (
        <span className={cls}>
          <SP>{`${container}`}</SP>
          {" ..."}
        </span>
      );
    }
    case "stack":
      return (
        <span className={cls}>
          <SP>{`${first}-${second}`}</SP>
        </span>
      );
    case "scale":
      return (
        <span className={cls}>
          <SP>{`${first}+${second}`}</SP>
        </span>
      );
    case "unstack":
      return (
        <span className={cls}>
          <SP>{`${first} ${second}`}</SP>
        </span>
      );
    case "unscale":
      return (
        <span className={cls}>
          <SP>{`${first} ${second}`}</SP>
        </span>
      );
    case "convertToVerbatim":
      return (
        <span className={cls}>
          <SP>sitelen+pona ala</SP>
          {analysis.verbatimPreview && (
            <span
              className={
                "selection-menu__action-preview"
              }
            >
              {truncatePreview(
                analysis.verbatimPreview
              )}
            </span>
          )}
        </span>
      );
    case "convertToSP":
      return (
        <span className={cls}>
          <SP>sitelen+pona</SP>
          {analysis.sitelenPonaPreview && (
            <span
              className={
                "selection-menu__action-preview"
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
  const [coords, setCoords] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const executeAction = useCallback(
    (actionId: ActionId) => {
      if (!analysis) return;
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
            unwrapLongGlyph(
              editor,
              insideLongGlyph.wrapFrom,
              insideLongGlyph.wrapTo
            );
          }
          break;
        case "stack":
          joinWithJoiner(
            editor,
            from,
            to,
            STACKING_JOINER
          );
          break;
        case "scale":
          joinWithJoiner(
            editor,
            from,
            to,
            SCALING_JOINER
          );
          break;
        case "unstack":
        case "unscale":
          removeJoiners(editor, from, to);
          break;
        case "convertToVerbatim":
          convertToVerbatimAction(
            editor,
            from,
            to
          );
          break;
        case "convertToSP":
          convertFromVerbatimAction(
            editor,
            from,
            to
          );
          break;
      }
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
        executeAction(meta.executeAction);
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
    };

    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor, executeAction]);

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

      let newText = codepointToChar(cp);
      if (variation > 0) {
        newText += String.fromCodePoint(
          VARIATION_SELECTOR_BASE +
            (variation - 1)
        );
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

  useEffect(() => {
    const onBlur = () => {
      requestAnimationFrame(() => {
        if (!editor.isFocused) {
          setAnalysis(null);
          setActions([]);
          setActiveActionIndex(0);
          setCoords(null);
        }
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
          <div className="variant-grid">
            <button
              className="variant-option"
              onMouseDown={preventBlur}
              onClick={() =>
                handleVariantSelect(0)
              }
              title="Default"
              type="button"
            >
              <span
                className="selection-menu__glyph"
              >
                {glyphChar(
                  singleGlyphWithVariants!.word
                )}
              </span>
              <span className="variant-label">
                0
              </span>
            </button>
            {getVariations(
              singleGlyphWithVariants!.word
            ).map((v) => (
              <button
                key={v.index}
                className="variant-option"
                onMouseDown={preventBlur}
                onClick={() =>
                  handleVariantSelect(v.index)
                }
                title={v.description}
                type="button"
              >
                <span
                  className={
                    "selection-menu__glyph"
                  }
                >
                  {glyphChar(
                    singleGlyphWithVariants!.word,
                    v.index
                  )}
                </span>
                <span className="variant-label">
                  {v.index}
                </span>
              </button>
            ))}
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
                    {ACTION_HINTS[actionId]}
                    {active ? " \u21B5" : ""}
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
