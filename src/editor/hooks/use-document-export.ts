import { useMemo } from "react";
import { Editor } from "@tiptap/core";
import {
  codepointToWord,
  isUcsurChar,
} from "../../data";
import {
  ucsurControlToAscii,
  isVariationSelector,
} from "../../data/structural-map";
import { isControlChar } from "../../data/control-chars";

export interface DocumentExport {
  latin: string;
  ucsur: string;
}

/**
 * Walk a ProseMirror doc and extract parallel Latin
 * and UCSUR representations.
 *
 * UCSUR export: raw text content (already UCSUR).
 * Latin export: reverse-map UCSUR codepoints to
 * word names, control chars to ASCII, skip
 * variation selectors.
 */
function extractDocument(
  editor: Editor
): DocumentExport {
  const { doc } = editor.state;
  const ucsur = doc.textBetween(
    0,
    doc.content.size,
    "\n"
  );

  const latinParts: string[] = [];

  for (const ch of ucsur) {
    const cp = ch.codePointAt(0)!;

    // Variation selector -> skip
    if (isVariationSelector(cp)) {
      continue;
    }

    // Control char -> ASCII (check before
    // isUcsurChar since control chars fall in
    // the same U+F1900-F19FF range)
    if (isControlChar(cp)) {
      const ascii = ucsurControlToAscii(cp);
      if (ascii) {
        latinParts.push(ascii);
      }
      continue;
    }

    // UCSUR sitelen pona char
    if (isUcsurChar(ch)) {
      const word = codepointToWord[cp];
      if (word) {
        latinParts.push(word);
      } else {
        latinParts.push(ch);
      }
      continue;
    }

    // Everything else (spaces, Latin text,
    // newlines) -> pass through
    latinParts.push(ch);
  }

  return {
    latin: latinParts.join(""),
    ucsur,
  };
}

export function useDocumentExport(
  editor: Editor | null
): DocumentExport {
  const json = editor?.getJSON();

  return useMemo(() => {
    if (!editor || editor.isDestroyed) {
      return { latin: "", ucsur: "" };
    }
    return extractDocument(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, json]);
}
