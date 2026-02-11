import { useMemo } from "react";
import { Editor } from "@tiptap/core";
import {
  wordToCodepoint,
  codepointToChar,
  applyVariation,
} from "../../data";

export interface DocumentExport {
  latin: string;
  ucsur: string;
}

/**
 * Walk a ProseMirror doc and extract parallel Latin
 * and UCSUR representations.
 */
function extractDocument(
  editor: Editor
): DocumentExport {
  const latinParts: string[] = [];
  const ucsurParts: string[] = [];

  const { doc } = editor.state;
  let isFirstBlock = true;

  doc.forEach((block) => {
    if (!isFirstBlock) {
      latinParts.push("\n");
      ucsurParts.push("\n");
    }
    isFirstBlock = false;

    let needsSpace = false;

    block.forEach((node) => {
      if (node.type.name === "sitelenPona") {
        const word = node.attrs.word as string;
        const variation =
          node.attrs.variation as number | null;

        if (needsSpace) {
          latinParts.push(" ");
          ucsurParts.push(" ");
        }

        latinParts.push(word);

        const cp = wordToCodepoint[word];
        if (cp !== undefined) {
          const ch = codepointToChar(cp);
          if (variation != null) {
            ucsurParts.push(
              applyVariation(ch, variation)
            );
          } else {
            ucsurParts.push(ch);
          }
        } else {
          ucsurParts.push(word);
        }

        needsSpace = true;
      } else if (node.isText && node.text) {
        latinParts.push(node.text);
        ucsurParts.push(node.text);
        needsSpace = false;
      }
    });
  });

  return {
    latin: latinParts.join(""),
    ucsur: ucsurParts.join(""),
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
