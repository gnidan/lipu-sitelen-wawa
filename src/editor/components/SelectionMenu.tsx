import React, {
  useEffect,
  useState,
  useCallback,
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
  asciiToUcsurControl,
  ucsurControlToAscii,
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
  // word name of the first UCSUR glyph in selection
  firstGlyphWord: string | null;
  hasStackingJoiner: boolean;
  hasScalingJoiner: boolean;

  insideCartouche: WrapInfo | null;
  insideLongGlyph: WrapInfo | null;
  // set when an END/START long glyph marker is
  // immediately adjacent to the selection
  adjacentLongGlyph: AdjacentLongGlyph | null;
  // the word glyph immediately before the
  // selection, if it has a long form
  precedingLongGlyph: {
    word: string;
    glyphFrom: number;
  } | null;

  verbatimPreview: string | null;
  sitelenPonaPreview: string | null;
}

/**
 * Iterate codepoints in a string, yielding each
 * codepoint and its JS string offset.
 */
function* codepoints(
  text: string
): Generator<[number, number]> {
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    yield [cp, i];
    i += cp > 0xffff ? 2 : 1;
  }
}

/**
 * Check if a codepoint is a UCSUR word glyph (not a
 * control character like a joiner or cartouche marker).
 */
function isWordGlyph(cp: number): boolean {
  return (
    isUcsurChar(String.fromCodePoint(cp)) &&
    !isControlChar(cp)
  );
}

/**
 * Check if a codepoint is a Latin letter (a-z/A-Z).
 */
function isLatinLetter(cp: number): boolean {
  return (
    (cp >= 0x41 && cp <= 0x5a) ||
    (cp >= 0x61 && cp <= 0x7a)
  );
}

/**
 * Convert UCSUR text to verbatim ASCII
 * representation. Word glyphs become word names,
 * control chars become ASCII equivalents (e.g. ")"
 * for END_OF_LONG_GLYPH), variation selectors are
 * stripped.
 */
function toVerbatim(text: string): string {
  const result: string[] = [];
  let needsSpace = false;

  for (const [cp] of codepoints(text)) {
    if (isVariationSelector(cp)) continue;

    const ascii = ucsurControlToAscii(cp);
    if (ascii !== undefined) {
      needsSpace = false;
      result.push(ascii);
      continue;
    }

    if (isWordGlyph(cp)) {
      const word = codepointToWord[cp];
      if (word) {
        if (needsSpace) result.push(" ");
        result.push(word);
        needsSpace = true;
        continue;
      }
    }

    needsSpace = false;
    result.push(String.fromCodePoint(cp));
  }

  return result.join("");
}

/**
 * Convert verbatim ASCII text back to UCSUR.
 * Word names become UCSUR glyphs, ASCII structural
 * chars become UCSUR control chars, spaces between
 * UCSUR tokens are stripped (font handles spacing).
 */
function fromVerbatim(text: string): string {
  const tokens: Array<{
    ucsur: boolean;
    value: string;
  }> = [];
  let wordBuf = "";

  const flush = () => {
    if (!wordBuf) return;
    const cp =
      wordToCodepoint[wordBuf.toLowerCase()];
    if (cp !== undefined) {
      tokens.push({
        ucsur: true,
        value: codepointToChar(cp),
      });
    } else {
      tokens.push({
        ucsur: false,
        value: wordBuf,
      });
    }
    wordBuf = "";
  };

  for (const ch of text) {
    const ctrl = asciiToUcsurControl(ch);
    if (ctrl !== undefined) {
      flush();
      tokens.push({ ucsur: true, value: ctrl });
      continue;
    }

    const cp = ch.codePointAt(0)!;
    if (isLatinLetter(cp)) {
      wordBuf += ch;
      continue;
    }

    flush();
    tokens.push({
      ucsur: false,
      value: ch,
    });
  }
  flush();

  // Strip spaces between UCSUR-producing tokens
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (
      t.value === " " &&
      i > 0 &&
      i < tokens.length - 1 &&
      tokens[i - 1].ucsur &&
      tokens[i + 1].ucsur
    ) {
      continue;
    }
    result.push(t.value);
  }

  return result.join("");
}

/**
 * Detect wrapper markers in selected text.
 * Returns WrapInfo with kind "selected" if start
 * and end markers are both in the text.
 */
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

/**
 * Detect if the selection is inside a wrapper by
 * scanning outward in the parent textblock.
 */
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
  let hasStackingJoiner = false;
  let hasScalingJoiner = false;

  for (const [cp] of codepoints(text)) {
    if (isWordGlyph(cp)) {
      containsUcsur = true;
      glyphCount++;
      if (!firstGlyphWord) {
        firstGlyphWord =
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

  if ($to.parent.isTextblock && !adjacentLongGlyph) {
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

  const insideLongGlyph =
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
    hasStackingJoiner,
    hasScalingJoiner,
    insideCartouche,
    insideLongGlyph,
    adjacentLongGlyph,
    precedingLongGlyph,
    verbatimPreview,
    sitelenPonaPreview,
  };
}

// ── ProseMirror plugin ──────────────────────────

export function createSelectionMenuPlugin() {
  return new Plugin<SelectionAnalysis | null>({
    key: selectionMenuPluginKey,

    state: {
      init() {
        return null;
      },
      apply(tr, _prev, _oldState, newState) {
        const meta = tr.getMeta(
          selectionMenuPluginKey
        );
        if (meta !== undefined) return meta;
        return analyzeSelection(newState);
      },
    },

    props: {
      handleKeyDown(view, event) {
        const st =
          selectionMenuPluginKey.getState(
            view.state
          ) as SelectionAnalysis | null;
        if (!st) return false;

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
        if (st.singleGlyphWithVariants) {
          const digit = parseInt(event.key, 10);
          if (!isNaN(digit)) {
            const { word } =
              st.singleGlyphWithVariants;
            const variations = getVariations(word);
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
              st.from,
              st.to
            );
            tr.setMeta(
              selectionMenuPluginKey,
              null
            );
            view.dispatch(tr);
            return true;
          }
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

  // Extract UCSUR word glyphs (+ optional VS),
  // skipping control chars
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

  if (glyphs.length === 0) return;

  const start = String.fromCodePoint(
    START_OF_CARTOUCHE
  );
  const ext = String.fromCodePoint(
    CARTOUCHE_EXTENSION
  );
  const end = String.fromCodePoint(
    END_OF_CARTOUCHE
  );

  const result =
    start + glyphs.join(ext) + end;

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

function convertToVerbatim(
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
    tr.insertText(verbatim, block.from, block.to);
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

function convertFromVerbatim(
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

export function SelectionMenu({
  editor,
}: SelectionMenuProps) {
  const [analysis, setAnalysis] =
    useState<SelectionAnalysis | null>(null);
  const [coords, setCoords] = useState<{
    left: number;
    top: number;
  } | null>(null);

  useEffect(() => {
    const update = () => {
      const st =
        selectionMenuPluginKey.getState(
          editor.state
        ) as SelectionAnalysis | null;
      if (!st) {
        setCoords(null);
        setAnalysis(null);
        return;
      }
      try {
        const cFrom =
          editor.view.coordsAtPos(st.from);
        const cTo =
          editor.view.coordsAtPos(st.to);
        setCoords({
          left: cFrom.left,
          top: cTo.bottom,
        });
      } catch {
        setCoords(null);
      }
      setAnalysis(st);
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

  useEffect(() => {
    const onBlur = () => {
      requestAnimationFrame(() => {
        if (!editor.isFocused) {
          setAnalysis(null);
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
    from,
    to,
    text,
  } = analysis;

  const showVariants =
    singleGlyphWithVariants !== null;
  const showWrapCartouche =
    !insideCartouche &&
    containsUcsur &&
    glyphCount >= 1;
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
  const showUnstack = hasStackingJoiner;
  const showUnscale = hasScalingJoiner;
  const showConvertToVerbatim =
    verbatimPreview !== null;
  const showConvertToSP =
    containsLatin && sitelenPonaPreview !== null;

  const hasActions =
    showWrapCartouche ||
    showUnwrapCartouche ||
    showWrapLongGlyph ||
    showUnwrapLongGlyph ||
    showStack ||
    showScale ||
    showUnstack ||
    showUnscale;

  const hasConvert =
    showConvertToVerbatim || showConvertToSP;

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

      {hasActions && (
        <div className="selection-menu__section">
          <div className="selection-menu__actions">
            {showWrapCartouche && (
              <button
                className={
                  "selection-menu__action-btn"
                }
                onMouseDown={preventBlur}
                onClick={() =>
                  wrapInCartouche(
                    editor,
                    from,
                    to
                  )
                }
                title="Wrap in cartouche"
                type="button"
              >
                Cartouche
              </button>
            )}
            {showUnwrapCartouche && (
              <button
                className={
                  "selection-menu__action-btn"
                }
                onMouseDown={preventBlur}
                onClick={() =>
                  unwrapCartouche(
                    editor,
                    insideCartouche!.wrapFrom,
                    insideCartouche!.wrapTo
                  )
                }
                title="Unwrap cartouche"
                type="button"
              >
                Unwrap cartouche
              </button>
            )}
            {showWrapLongGlyph && (
              <button
                className={
                  "selection-menu__action-btn"
                }
                onMouseDown={preventBlur}
                onClick={() =>
                  wrapInLongGlyph(
                    editor,
                    from,
                    to,
                    adjacentLongGlyph,
                    precedingLongGlyph
                      ?.glyphFrom ?? null
                  )
                }
                title={
                  adjacentLongGlyph
                    ? "Extend long glyph"
                    : "Wrap in long glyph"
                }
                type="button"
              >
                {adjacentLongGlyph
                  ? "Extend long glyph"
                  : "Long glyph"}
              </button>
            )}
            {showUnwrapLongGlyph && (
              <button
                className={
                  "selection-menu__action-btn"
                }
                onMouseDown={preventBlur}
                onClick={() =>
                  unwrapLongGlyph(
                    editor,
                    insideLongGlyph!.wrapFrom,
                    insideLongGlyph!.wrapTo
                  )
                }
                title="Unwrap long glyph"
                type="button"
              >
                Unwrap long glyph
              </button>
            )}
            {showStack && (
              <button
                className={
                  "selection-menu__action-btn"
                }
                onMouseDown={preventBlur}
                onClick={() =>
                  joinWithJoiner(
                    editor,
                    from,
                    to,
                    STACKING_JOINER
                  )
                }
                title="Stack glyphs"
                type="button"
              >
                Stack
              </button>
            )}
            {showScale && (
              <button
                className={
                  "selection-menu__action-btn"
                }
                onMouseDown={preventBlur}
                onClick={() =>
                  joinWithJoiner(
                    editor,
                    from,
                    to,
                    SCALING_JOINER
                  )
                }
                title="Scale glyphs"
                type="button"
              >
                Scale
              </button>
            )}
            {showUnstack && (
              <button
                className={
                  "selection-menu__action-btn"
                }
                onClick={() =>
                  removeJoiners(
                    editor,
                    from,
                    to
                  )
                }
                onMouseDown={preventBlur}
                title="Unstack"
                type="button"
              >
                Unstack
              </button>
            )}
            {showUnscale && (
              <button
                className={
                  "selection-menu__action-btn"
                }
                onClick={() =>
                  removeJoiners(
                    editor,
                    from,
                    to
                  )
                }
                onMouseDown={preventBlur}
                title="Unscale"
                type="button"
              >
                Unscale
              </button>
            )}
          </div>
        </div>
      )}

      {hasConvert && (
        <div className="selection-menu__section">
          {showConvertToVerbatim && (
            <div
              className={
                "selection-menu__convert"
              }
            >
              <div
                className={
                  "selection-menu__convert-header"
                }
              >
                <span
                  className={
                    "selection-menu__convert-label"
                  }
                >
                  Verbatim:
                </span>
                <button
                  className={
                    "selection-menu__convert-btn"
                  }
                  onClick={() =>
                    convertToVerbatim(
                      editor,
                      from,
                      to
                    )
                  }
                  onMouseDown={preventBlur}
                  title="Convert to verbatim"
                  type="button"
                >
                  &rarr;
                </button>
              </div>
              <div
                className={
                  "selection-menu__convert-preview"
                }
                style={{ whiteSpace: "pre" }}
                title={verbatimPreview!}
              >
                {truncatePreview(verbatimPreview!)}
              </div>
            </div>
          )}
          {showConvertToSP && (
            <div
              className={
                "selection-menu__convert"
              }
            >
              <div
                className={
                  "selection-menu__convert-header"
                }
              >
                <span
                  className={
                    "selection-menu__convert-label"
                  }
                >
                  sitelen pona:
                </span>
                <button
                  className={
                    "selection-menu__convert-btn"
                  }
                  onClick={() =>
                    convertFromVerbatim(
                      editor,
                      from,
                      to
                    )
                  }
                  onMouseDown={preventBlur}
                  title={
                    "Convert to sitelen pona"
                  }
                  type="button"
                >
                  &rarr;
                </button>
              </div>
              <div
                className={
                  "selection-menu__convert-preview"
                  + " selection-menu"
                  + "__convert-preview--sp"
                }
                style={{ whiteSpace: "pre" }}
                title={sitelenPonaPreview!}
              >
                {truncatePreview(
                  sitelenPonaPreview!
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
