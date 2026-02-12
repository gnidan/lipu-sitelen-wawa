import { Extension } from "@tiptap/core";
import {
  hasVariations,
  wordToCodepoint,
  codepointToWord,
  isUcsurChar,
} from "../../data";
import {
  isVariationSelector,
} from "../../data/structural-map";
import {
  VARIATION_SELECTOR_BASE,
} from "../../data/variations";
import {
  autocompletePluginKey,
} from "./autocomplete";
import type {
  AutocompleteState,
} from "./autocomplete";

/**
 * Find a UCSUR character before the cursor,
 * possibly followed by a variation selector.
 * Returns the word and the position range
 * (including any existing VS), or null.
 */
function ucsurCharBeforeCursor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any
): {
  word: string;
  from: number;
  to: number;
} | null {
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

  // Check if last char is a variation selector
  if (endIdx > 0) {
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

function makeVariantHandler(
  variation: number | null
) {
  return ({
    editor,
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor: any;
  }) => {
    // If autocomplete has active prefix, digits
    // should go to autocomplete first
    const acState =
      autocompletePluginKey.getState(
        editor.state
      ) as AutocompleteState | undefined;
    if (acState && acState.prefix.length > 0) {
      return false;
    }

    // Find UCSUR char before cursor
    const before = ucsurCharBeforeCursor(editor);
    if (!before) return false;

    if (
      variation !== null &&
      !hasVariations(before.word)
    ) {
      return false;
    }

    const baseCp = wordToCodepoint[before.word];
    if (baseCp === undefined) return false;

    let newText = String.fromCodePoint(baseCp);
    if (variation !== null && variation > 0) {
      newText += String.fromCodePoint(
        VARIATION_SELECTOR_BASE + (variation - 1)
      );
    }

    const { state } = editor.view;
    const tr = state.tr.insertText(
      newText,
      before.from,
      before.to
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
