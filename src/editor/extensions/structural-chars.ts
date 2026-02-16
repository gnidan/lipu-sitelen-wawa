import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  isWord,
  wordToCodepoint,
  codepointToChar,
  asciiToUcsurControl,
  isNiArrowCp,
  niDirectionByArrowCp,
  niDirectionByVerbatim,
} from "../../data";
import {
  selectionMenuPluginKey,
} from "../components/SelectionMenu";
import {
  verbatimTogglePluginKey,
} from "./verbatim-toggle";

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
  "=", "_", ".", ":", ",", "|", "&",
  "<", "^", ">",
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

interface ArrowInfo {
  verbatim: string;
  arrow: string;
  from: number;
  to: number;
}

/**
 * Check if the character immediately before the
 * cursor is a ni direction arrow. Returns the
 * direction info and document position, or null.
 */
function arrowBeforeCursor(
  view: EditorView
): ArrowInfo | null {
  const { from, to } = view.state.selection;
  if (from !== to) return null;

  const $from = view.state.doc.resolve(from);
  const textNode = $from.nodeBefore;
  if (!textNode?.isText || !textNode.text) {
    return null;
  }

  const text = textNode.text;
  // Arrows are BMP (single code unit)
  const lastCp = text.charCodeAt(text.length - 1);
  if (!isNiArrowCp(lastCp)) return null;

  const dir = niDirectionByArrowCp(lastCp);
  if (!dir) return null;

  return {
    verbatim: dir.verbatim,
    arrow: dir.arrow,
    from: from - 1,
    to: from,
  };
}

/**
 * Check if the character immediately after the
 * cursor is a ni direction arrow. Returns the
 * direction info and document position, or null.
 */
function arrowAfterCursor(
  view: EditorView
): ArrowInfo | null {
  const { from, to } = view.state.selection;
  if (from !== to) return null;

  const $from = view.state.doc.resolve(from);
  const textNode = $from.nodeAfter;
  if (!textNode?.isText || !textNode.text) {
    return null;
  }

  const text = textNode.text;
  // Arrows are BMP (single code unit)
  const firstCp = text.charCodeAt(0);
  if (!isNiArrowCp(firstCp)) return null;

  const dir = niDirectionByArrowCp(firstCp);
  if (!dir) return null;

  return {
    verbatim: dir.verbatim,
    arrow: dir.arrow,
    from: from,
    to: from + 1,
  };
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
            if (ch.length !== 1) return false;

            // Don't intercept if modifier keys
            // are held (Ctrl+, Alt+, Meta+)
            if (
              event.ctrlKey ||
              event.altKey ||
              event.metaKey
            ) {
              return false;
            }

            // Don't intercept in verbatim mode
            const vtState =
              verbatimTogglePluginKey.getState(
                view.state
              );
            if (vtState?.active) {
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

            // Arrow modification: combine typed
            // direction char with existing arrow
            // before or after cursor
            // (e.g. ↑ + < → ↖)
            if (
              ch === "<" ||
              ch === "^" ||
              ch === ">" ||
              ch === "v"
            ) {
              const before =
                arrowBeforeCursor(view);
              const after =
                arrowAfterCursor(view);
              const info = before ?? after;
              if (info) {
                // Try both orderings:
                // existing+new and new+existing
                const newDir =
                  niDirectionByVerbatim(
                    info.verbatim + ch
                  ) ??
                  niDirectionByVerbatim(
                    ch + info.verbatim
                  );
                if (newDir) {
                  event.preventDefault();
                  view.dispatch(
                    view.state.tr.insertText(
                      newDir.arrow,
                      info.from,
                      info.to
                    )
                  );
                  return true;
                }
              }
              // 'v' is a letter — if no valid
              // combination, fall through to
              // normal input
              if (ch === "v") return false;
            }

            // Standard structural chars
            if (!STRUCTURAL_CHARS.has(ch)) {
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
