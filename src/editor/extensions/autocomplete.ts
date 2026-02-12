import { Extension } from "@tiptap/core";
import {
  Plugin,
  PluginKey,
  type EditorState,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  isWord,
  wordsByPrefix,
  hasVariations,
  wordToCodepoint,
  codepointToChar,
  applyVariation,
} from "../../data";
import type { WordEntry } from "../../data";
import {
  isStructuralChar,
} from "./structural-chars";
import {
  asciiToUcsurControl,
} from "../../data/structural-map";

export const autocompletePluginKey = new PluginKey(
  "autocomplete"
);

export interface AutocompleteState {
  /** Current Latin prefix being typed */
  prefix: string;
  /** Filtered matches for the prefix */
  matches: WordEntry[];
  /** Index of highlighted item in popup */
  activeIndex: number;
  /** Screen coords for popup positioning */
  coords: { left: number; top: number } | null;
  /** Document position range of composing text */
  range: { from: number; to: number } | null;
  /**
   * Range of text marked verbatim (Escape-rejected).
   * Text in this range won't be auto-converted.
   */
  verbatimRange: {
    from: number;
    to: number;
  } | null;
}

const EMPTY_STATE: AutocompleteState = {
  prefix: "",
  matches: [],
  activeIndex: 0,
  coords: null,
  range: null,
  verbatimRange: null,
};

const MAX_SUGGESTIONS = 8;

/**
 * Extract the Latin word being typed at cursor.
 * Returns the word and its position range, or null.
 */
export function getComposingWord(
  state: EditorState
): {
  word: string;
  from: number;
  to: number;
} | null {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return null;

  const textNode = $from.nodeBefore;
  if (!textNode?.isText || !textNode.text) {
    return null;
  }

  const match = textNode.text.match(
    /([a-zA-Z]+)$/
  );
  if (!match) return null;

  const word = match[1].toLowerCase();
  const textStart =
    $from.pos - textNode.text.length;
  const from =
    textStart +
    textNode.text.length -
    match[1].length;
  const to = $from.pos;

  return { word, from, to };
}

/**
 * Extract a word immediately before a trailing
 * space in a text node (for appendTransaction).
 */
function extractWordBeforeSpace(
  text: string
): { word: string; start: number } | null {
  if (!text.endsWith(" ")) return null;

  const withoutSpace = text.slice(0, -1);
  const match = withoutSpace.match(
    /([a-zA-Z]+)$/
  );
  if (!match) return null;

  const word = match[1].toLowerCase();
  const start =
    withoutSpace.length - match[1].length;
  return { word, start };
}

function wordToUcsur(
  word: string,
  variation: number | null = null
): string | undefined {
  const cp = wordToCodepoint[word];
  if (cp === undefined) return undefined;
  let text = codepointToChar(cp);
  if (variation != null && variation > 0) {
    text = applyVariation(text, variation);
  }
  return text;
}

/**
 * Check if two ranges overlap.
 */
function rangesOverlap(
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number
): boolean {
  return aFrom < bTo && bFrom < aTo;
}

export const Autocomplete = Extension.create({
  name: "autocomplete",

  addProseMirrorPlugins() {
    /**
     * Commit the word at the given range as UCSUR
     * text (used by key handler). Optionally inserts
     * trailing text after the committed char (e.g.
     * structural chars).
     */
    const commitWord = (
      word: string,
      from: number,
      to: number,
      variation: number | null = null,
      trailingText: string | null = null
    ) => {
      const ucsur = wordToUcsur(word, variation);
      if (!ucsur) return;

      const { state } = this.editor.view;
      let text = ucsur;
      if (trailingText) text += trailingText;
      const tr = state.tr.insertText(
        text, from, to
      );
      this.editor.view.dispatch(tr);
    };

    return [
      new Plugin({
        key: autocompletePluginKey,

        state: {
          init(): AutocompleteState {
            return EMPTY_STATE;
          },

          apply(tr, prev, _oldState, newState) {
            // Handle dismiss meta (Escape)
            const meta = tr.getMeta(
              autocompletePluginKey
            );
            if (meta?.dismiss) {
              return {
                ...EMPTY_STATE,
                verbatimRange:
                  meta.verbatimRange ?? null,
              };
            }
            if (
              typeof meta?.activeIndex === "number"
            ) {
              return {
                ...prev,
                activeIndex: meta.activeIndex,
              };
            }

            // Remap verbatimRange through mapping.
            // Use assoc=-1 for `to` so the range
            // doesn't expand when text is inserted
            // right after it.
            let verbatimRange = prev.verbatimRange;
            if (verbatimRange && tr.docChanged) {
              const newFrom = tr.mapping.map(
                verbatimRange.from
              );
              const newTo = tr.mapping.map(
                verbatimRange.to, -1
              );
              if (newFrom >= newTo) {
                verbatimRange = null;
              } else {
                verbatimRange = {
                  from: newFrom,
                  to: newTo,
                };
              }
            }

            if (
              !tr.docChanged &&
              !tr.selectionSet
            ) {
              return { ...prev, verbatimRange };
            }

            const composing =
              getComposingWord(newState);

            if (
              !composing ||
              composing.word.length < 1
            ) {
              // If no composing word, clear
              // verbatimRange only if cursor moved
              // away (no overlap possible)
              return {
                ...EMPTY_STATE,
                verbatimRange,
              };
            }

            // Check if composing word overlaps
            // the verbatim range
            if (
              verbatimRange &&
              rangesOverlap(
                composing.from,
                composing.to,
                verbatimRange.from,
                verbatimRange.to
              )
            ) {
              // Extend verbatim range to cover
              // the growing word
              verbatimRange = {
                from: Math.min(
                  verbatimRange.from,
                  composing.from
                ),
                to: Math.max(
                  verbatimRange.to,
                  composing.to
                ),
              };
              // Suppress popup
              return {
                ...EMPTY_STATE,
                verbatimRange,
              };
            }

            const matches = wordsByPrefix(
              composing.word
            ).slice(0, MAX_SUGGESTIONS);

            if (matches.length === 0) {
              // No tp words match this prefix —
              // auto-mark as verbatim so ligatures
              // are suppressed
              const vr = verbatimRange
                ? {
                    from: Math.min(
                      verbatimRange.from,
                      composing.from
                    ),
                    to: Math.max(
                      verbatimRange.to,
                      composing.to
                    ),
                  }
                : {
                    from: composing.from,
                    to: composing.to,
                  };
              return {
                ...EMPTY_STATE,
                verbatimRange: vr,
              };
            }

            const sameRoot =
              prev.prefix.length > 0 &&
              composing.word.startsWith(
                prev.prefix
              );
            const activeIndex = sameRoot
              ? Math.min(
                  prev.activeIndex,
                  matches.length - 1
                )
              : 0;

            return {
              prefix: composing.word,
              matches,
              activeIndex,
              coords: null,
              range: {
                from: composing.from,
                to: composing.to,
              },
              verbatimRange,
            };
          },
        },

        props: {
          decorations(state) {
            const st = autocompletePluginKey
              .getState(state) as
              | AutocompleteState
              | undefined;
            if (!st) return DecorationSet.empty;

            const decos: Decoration[] = [];

            // Composing text decoration
            if (
              st.range &&
              st.prefix.length > 0
            ) {
              decos.push(
                Decoration.inline(
                  st.range.from,
                  st.range.to,
                  { class: "composing-text" }
                )
              );
            }

            // Verbatim text decoration —
            // suppress ligatures so the font
            // doesn't render Latin as glyphs
            if (st.verbatimRange) {
              decos.push(
                Decoration.inline(
                  st.verbatimRange.from,
                  st.verbatimRange.to,
                  { class: "verbatim-text" }
                )
              );
            }

            if (decos.length === 0) {
              return DecorationSet.empty;
            }
            return DecorationSet.create(
              state.doc,
              decos
            );
          },
          handleKeyDown(view, event) {
            // Escape: dismiss popup and mark
            // composing word as verbatim. Handled
            // before the matches check so it works
            // even when the popup isn't showing
            // (prevents browser from blurring the
            // editor).
            if (event.key === "Escape") {
              const composing =
                getComposingWord(view.state);
              if (composing) {
                view.dispatch(
                  view.state.tr.setMeta(
                    autocompletePluginKey,
                    {
                      dismiss: true,
                      verbatimRange: {
                        from: composing.from,
                        to: composing.to,
                      },
                    }
                  )
                );
                return true;
              }
              return false;
            }

            const pluginState =
              autocompletePluginKey.getState(
                view.state
              ) as AutocompleteState | undefined;

            if (
              !pluginState ||
              pluginState.matches.length === 0
            ) {
              return false;
            }

            const {
              matches,
              activeIndex,
              range,
            } = pluginState;

            // Space/Tab/Enter: accept highlighted
            if (
              event.key === " " ||
              event.key === "Tab" ||
              event.key === "Enter"
            ) {
              if (!range) return false;
              const word =
                matches[activeIndex]?.word;
              if (!word) return false;

              event.preventDefault();
              commitWord(
                word,
                range.from,
                range.to
              );
              return true;
            }

            // Arrow keys: navigate popup
            if (event.key === "ArrowDown") {
              event.preventDefault();
              const next =
                (activeIndex + 1) %
                matches.length;
              view.dispatch(
                view.state.tr.setMeta(
                  autocompletePluginKey,
                  { activeIndex: next }
                )
              );
              return true;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              const next =
                (activeIndex -
                  1 +
                  matches.length) %
                matches.length;
              view.dispatch(
                view.state.tr.setMeta(
                  autocompletePluginKey,
                  { activeIndex: next }
                )
              );
              return true;
            }

            // Digit keys: commit with variation
            const digit = parseInt(event.key, 10);
            if (!isNaN(digit)) {
              const word =
                matches[activeIndex]?.word;
              if (!word || !range) return false;

              if (!hasVariations(word)) {
                return false;
              }

              event.preventDefault();
              const variation =
                digit === 0 ? null : digit;
              commitWord(
                word,
                range.from,
                range.to,
                variation
              );
              return true;
            }

            // Structural chars: commit word +
            // insert UCSUR control char
            if (
              isStructuralChar(event.key) &&
              event.key.length === 1
            ) {
              if (!range) return false;
              const word =
                matches[activeIndex]?.word;
              if (!word) return false;

              const ucsurCtrl =
                asciiToUcsurControl(event.key);
              if (!ucsurCtrl) return false;

              event.preventDefault();
              commitWord(
                word,
                range.from,
                range.to,
                null,
                ucsurCtrl
              );
              return true;
            }

            return false;
          },
        },

        // appendTransaction: auto-commit word+space
        // This handles programmatic inserts and
        // any case where handleKeyDown doesn't fire
        appendTransaction(
          transactions,
          _oldState,
          newState
        ) {
          if (
            !transactions.some(
              (tr) => tr.docChanged
            )
          ) {
            return null;
          }

          const { selection } = newState;
          const { $from } = selection;

          if (!$from.parent.isTextblock) {
            return null;
          }

          const textNode = $from.nodeBefore;
          if (
            !textNode?.isText ||
            !textNode.text
          ) {
            return null;
          }

          const verbatimMark =
            newState.schema.marks.verbatim;
          if (
            verbatimMark &&
            textNode.marks.some(
              (m) => m.type === verbatimMark
            )
          ) {
            return null;
          }

          const result = extractWordBeforeSpace(
            textNode.text
          );
          if (!result) return null;

          const { word, start } = result;
          if (!isWord(word)) return null;

          const ucsur = wordToUcsur(word);
          if (!ucsur) return null;

          const textStart =
            $from.pos - textNode.text.length;
          const wordFrom = textStart + start;
          const wordTo =
            textStart + start + word.length;

          // Check if word overlaps verbatimRange
          const pluginState =
            autocompletePluginKey.getState(
              newState
            ) as AutocompleteState | undefined;
          if (pluginState?.verbatimRange) {
            const vr = pluginState.verbatimRange;
            if (
              rangesOverlap(
                wordFrom,
                wordTo,
                vr.from,
                vr.to
              )
            ) {
              return null;
            }
          }

          const tr = newState.tr.insertText(
            ucsur,
            wordFrom,
            wordTo
          );

          return tr;
        },

        view() {
          return {
            update(view) {
              const pluginState =
                autocompletePluginKey.getState(
                  view.state
                ) as
                  | AutocompleteState
                  | undefined;

              if (
                !pluginState ||
                !pluginState.range ||
                pluginState.matches.length === 0
              ) {
                return;
              }

              try {
                const coords =
                  view.coordsAtPos(
                    pluginState.range.from
                  );
                (
                  pluginState as AutocompleteState
                ).coords = {
                  left: coords.left,
                  top: coords.bottom,
                };
              } catch {
                // coordsAtPos can throw if
                // editor isn't fully mounted
              }
            },
          };
        },
      }),
    ];
  },
});
