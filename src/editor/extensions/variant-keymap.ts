import { Extension } from "@tiptap/core";
import {
  hasVariations,
  wordToCodepoint,
  codepointToWord,
  isUcsurChar,
  ZWJ,
  isNiArrowCp,
  applyVariation,
  niDirectionByIndex,
  niDirString,
} from "../../data";
import {
  isVariationSelector,
  VARIATION_SELECTOR_BASE,
} from "../../data";
import {
  autocompletePluginKey,
} from "./autocomplete";
import type {
  AutocompleteState,
} from "./autocomplete";

interface GlyphTarget {
  word: string;
  from: number;
  to: number;
}

/**
 * Find a UCSUR character before the cursor,
 * possibly followed by a variation selector.
 * Returns the word and the position range
 * (including any existing VS), or null.
 */
function ucsurCharBeforeCursor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any
): GlyphTarget | null {
  const { $from } = editor.state.selection;
  const textNode = $from.nodeBefore;

  if (!textNode?.isText || !textNode.text) {
    return null;
  }

  const text = textNode.text;
  const textStart =
    $from.pos - text.length;

  // Parse backward from end of text
  let endIdx = text.length;

  // Check if trailing char is a ni direction
  // arrow (with or without ZWJ before it)
  let hasArrow = false;
  {
    const lastCp = text.codePointAt(endIdx - 1);
    if (
      lastCp !== undefined &&
      isNiArrowCp(lastCp)
    ) {
      endIdx--; // skip arrow
      hasArrow = true;
      // Also skip ZWJ if present (legacy)
      if (
        endIdx >= 1 &&
        text.codePointAt(endIdx - 1) === ZWJ
      ) {
        endIdx--;
      }
    }
  }

  // Check if last char is a variation selector
  if (!hasArrow && endIdx > 0) {
    const lastCp = text.codePointAt(endIdx - 1);
    if (
      lastCp !== undefined &&
      isVariationSelector(lastCp)
    ) {
      endIdx--;
    }
  }

  // Now check for a UCSUR character. These are
  // above BMP so they use surrogate pairs (2 JS
  // char units).
  if (endIdx < 2) return null;

  // Try reading a codepoint at endIdx - 2
  // (surrogate pair start)
  const cp = text.codePointAt(endIdx - 2);
  if (
    cp === undefined ||
    !isUcsurChar(String.fromCodePoint(cp))
  ) {
    return null;
  }

  const word = codepointToWord[cp];
  if (!word) return null;

  // UCSUR chars above BMP take 2 JS char units
  const from = textStart + endIdx - 2;
  const to = textStart + text.length;

  return { word, from, to };
}

/**
 * Find a single UCSUR character within the
 * current text selection, possibly followed by
 * a variation selector or ni direction arrow.
 * Returns null if the selection doesn't contain
 * exactly one glyph (with optional modifier).
 */
function ucsurCharInSelection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any
): GlyphTarget | null {
  const { from, to } = editor.state.selection;
  if (from === to) return null;

  const text = editor.state.doc.textBetween(
    from, to
  );

  // Expect a UCSUR character (above BMP →
  // surrogate pair, 2 JS char units)
  if (text.length < 2) return null;
  const cp = text.codePointAt(0);
  if (
    cp === undefined ||
    !isUcsurChar(String.fromCodePoint(cp))
  ) {
    return null;
  }

  const word = codepointToWord[cp];
  if (!word) return null;

  let idx = 2; // skip surrogate pair

  // Check for optional trailing modifier:
  // variation selector, ZWJ+arrow, or bare arrow
  if (idx < text.length) {
    const nextCp = text.codePointAt(idx);
    if (nextCp !== undefined) {
      if (isVariationSelector(nextCp)) {
        idx++;
      } else if (nextCp === ZWJ) {
        idx++;
        if (idx < text.length) {
          const arrowCp =
            text.codePointAt(idx);
          if (
            arrowCp !== undefined &&
            isNiArrowCp(arrowCp)
          ) {
            idx++;
          }
        }
      } else if (isNiArrowCp(nextCp)) {
        idx++;
      }
    }
  }

  // Must have consumed the entire selection
  if (idx !== text.length) return null;

  return { word, from, to };
}

function makeVariantHandler(
  variation: number | null
) {
  return ({
    editor,
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor: any;
  }) => {
    const { from, to } = editor.state.selection;

    let target: GlyphTarget | null;

    if (from !== to) {
      // Selection: look at the selected text
      target = ucsurCharInSelection(editor);
    } else {
      // Cursor: defer to autocomplete if active
      const acState =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState | undefined;
      if (
        acState && acState.prefix.length > 0
      ) {
        return false;
      }
      target = ucsurCharBeforeCursor(editor);
    }

    if (!target) return false;

    if (
      variation !== null &&
      !hasVariations(target.word)
    ) {
      return false;
    }

    const baseCp = wordToCodepoint[target.word];
    if (baseCp === undefined) return false;

    let newText: string;
    if (
      target.word === "ni" &&
      variation !== null &&
      variation > 0
    ) {
      const dir = niDirectionByIndex(variation);
      if (dir) {
        newText = niDirString(baseCp, dir);
      } else {
        newText = String.fromCodePoint(baseCp);
      }
    } else {
      newText = String.fromCodePoint(baseCp);
      if (variation !== null && variation > 0) {
        newText += String.fromCodePoint(
          VARIATION_SELECTOR_BASE +
            (variation - 1)
        );
      }
    }

    const { state } = editor.view;
    const tr = state.tr.insertText(
      newText,
      target.from,
      target.to
    );
    editor.view.dispatch(tr);
    return true;
  };
}

export const VariantKeymap = Extension.create({
  name: "variantKeymap",

  addKeyboardShortcuts() {
    return {
      "1": makeVariantHandler(1),
      "2": makeVariantHandler(2),
      "3": makeVariantHandler(3),
      "4": makeVariantHandler(4),
      "5": makeVariantHandler(5),
      "6": makeVariantHandler(6),
      "7": makeVariantHandler(7),
      "8": makeVariantHandler(8),
      "0": makeVariantHandler(null),
    };
  },
});
