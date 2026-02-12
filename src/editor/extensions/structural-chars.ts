import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import {
  isWord,
  wordToCodepoint,
  codepointToChar,
} from "../../data";
import {
  asciiToUcsurControl,
} from "../../data/structural-map";
import {
  selectionMenuPluginKey,
} from "../components/SelectionMenu";

export const structuralCharsPluginKey = new PluginKey(
  "structuralChars"
);

/**
 * Characters that represent structural operators in
 * sitelen pona. They are intercepted and inserted as
 * UCSUR control characters.
 */
export const STRUCTURAL_CHARS = new Set([
  "+", "-", "[", "]", "(", ")", "{", "}",
  "=", "_",
]);

export function isStructuralChar(ch: string): boolean {
  return STRUCTURAL_CHARS.has(ch);
}

/**
 * Extract a Latin word immediately before cursor
 * position in a text node (no trailing space needed).
 */
function extractWordBeforeCursor(
  text: string
): { word: string; start: number } | null {
  const match = text.match(/([a-zA-Z]+)$/);
  if (!match) return null;

  const word = match[1].toLowerCase();
  const start = text.length - match[1].length;
  return { word, start };
}

export const StructuralChars = Extension.create({
  name: "structuralChars",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: structuralCharsPluginKey,

        props: {
          handleKeyDown(view, event) {
            const ch = event.key;
            if (
              !STRUCTURAL_CHARS.has(ch) ||
              ch.length !== 1
            ) {
              return false;
            }

            // Don't intercept if modifier keys
            // are held (Ctrl+, Alt+, Meta+)
            if (
              event.ctrlKey ||
              event.altKey ||
              event.metaKey
            ) {
              return false;
            }

            // Defer to SelectionMenu when active
            const smState =
              selectionMenuPluginKey.getState(
                view.state
              );
            if (smState?.analysis) {
              return false;
            }

            const ucsurCtrl =
              asciiToUcsurControl(ch);
            if (!ucsurCtrl) return false;

            const { state } = view;
            const { $from } = state.selection;

            if (!$from.parent.isTextblock) {
              return false;
            }

            // Check if there's composing text
            // before cursor that should be
            // auto-committed
            const textNode = $from.nodeBefore;
            if (
              textNode?.isText &&
              textNode.text
            ) {
              const result =
                extractWordBeforeCursor(
                  textNode.text
                );
              if (
                result && isWord(result.word)
              ) {
                const cp = wordToCodepoint[
                  result.word
                ];
                if (cp !== undefined) {
                  const textStart =
                    $from.pos -
                    textNode.text.length;
                  const wordFrom =
                    textStart + result.start;
                  const wordTo =
                    textStart +
                    result.start +
                    result.word.length;
                  const ucsurWord =
                    codepointToChar(cp);
                  event.preventDefault();
                  const tr = state.tr.insertText(
                    ucsurWord + ucsurCtrl,
                    wordFrom,
                    wordTo
                  );
                  view.dispatch(tr);
                  return true;
                }
              }
            }

            // No composing text — insert the
            // UCSUR control char directly
            event.preventDefault();
            const { from, to } = state.selection;
            const tr = state.tr.insertText(
              ucsurCtrl,
              from,
              to
            );
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
