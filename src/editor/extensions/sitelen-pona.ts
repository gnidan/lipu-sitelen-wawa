/**
 * Lightweight TipTap Extension that provides the
 * insertSitelenPona command. Inserts UCSUR text
 * characters instead of atom nodes.
 */

import { Extension } from "@tiptap/core";
import {
  wordToCodepoint,
  codepointToChar,
  applyVariation,
  niDirectionByIndex,
  niDirStringEffective,
} from "../../data";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sitelenPona: {
      insertSitelenPona: (
        word: string,
        variation?: number | null
      ) => ReturnType;
    };
  }
}

export const SitelenPona = Extension.create({
  name: "sitelenPona",

  addCommands() {
    return {
      insertSitelenPona:
        (word, variation = null) =>
        ({ tr, dispatch }) => {
          const cp = wordToCodepoint[word];
          if (cp === undefined) return false;

          let text: string;
          if (
            word === "ni" &&
            variation != null &&
            variation > 0
          ) {
            const dir =
              niDirectionByIndex(variation);
            text = dir
              ? niDirStringEffective(dir)
              : codepointToChar(cp);
          } else {
            text = codepointToChar(cp);
            if (
              variation != null && variation > 0
            ) {
              text = applyVariation(
                text, variation
              );
            }
          }

          if (dispatch) {
            tr.insertText(text);
          }
          return true;
        },
    };
  },
});
