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
  niDirectionByIndex,
  niDirectionByVerbatim,
  niDirStringEffective,
} from "../../data";
import type { WordEntry } from "../../data";
import {
  isStructuralChar,
} from "./structural-chars";
import { focusTracker } from "../focus-tracker";
import {
  asciiToUcsurControl,
} from "../../data";
import {
  verbatimTogglePluginKey,
} from "./verbatim-toggle";
import { LIPU_SYNC_META } from "../lipu-sync";

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
  /** Document position range of composing text */
  range: { from: number; to: number } | null;
  /**
   * Direction chars buffered for ni input.
   * Stored in plugin state, not in the document.
   */
  niDirBuffer: string;
}

const EMPTY_STATE: AutocompleteState = {
  prefix: "",
  matches: [],
  activeIndex: 0,
  range: null,
  niDirBuffer: "",
};

const MAX_SUGGESTIONS = 8;

/**
 * Direction chars valid as the first direction
 * character after "ni". "v" is not valid as a
 * first direction char (per spec).
 */
const FIRST_DIR_CHARS = new Set(["<", "^", ">"]);

/**
 * All direction chars including "v" (valid as
 * second char in two-char directions).
 */
const ALL_DIR_CHARS = new Set([
  "<", "^", ">", "v",
]);

/**
 * Extract the Latin word being typed at cursor.
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

  const verbatimMark =
    state.schema.marks.verbatim;
  if (
    verbatimMark &&
    textNode.marks.some(
      (m) => m.type === verbatimMark
    )
  ) {
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
  if (
    word === "ni" &&
    variation != null &&
    variation > 0
  ) {
    const dir = niDirectionByIndex(variation);
    return dir
      ? niDirStringEffective(dir)
      : codepointToChar(cp);
  }
  let text = codepointToChar(cp);
  if (variation != null && variation > 0) {
    text = applyVariation(text, variation);
  }
  return text;
}

export const Autocomplete = Extension.create({
  name: "autocomplete",

  // Must run before StructuralChars so that
  // direction keys (< ^ >) are buffered for
  // ni directions instead of committing the
  // composing word as a structural char.
  priority: 110,

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
            const meta = tr.getMeta(
              autocompletePluginKey
            );

            // ni direction buffer updates
            // (meta-only, no doc change)
            if (
              typeof meta?.niDirChar === "string"
            ) {
              return {
                ...prev,
                niDirBuffer:
                  prev.niDirBuffer +
                  meta.niDirChar,
              };
            }
            if (meta?.niDirBackspace) {
              return {
                ...prev,
                niDirBuffer:
                  prev.niDirBuffer.slice(0, -1),
              };
            }

            // Handle dismiss meta (Escape)
            if (meta?.dismiss) {
              return EMPTY_STATE;
            }
            if (
              typeof meta?.activeIndex === "number"
            ) {
              // Clear niDirBuffer if navigating
              // away from "ni"
              const newActive =
                prev.matches[
                  meta.activeIndex
                ]?.word;
              return {
                ...prev,
                activeIndex: meta.activeIndex,
                niDirBuffer:
                  newActive === "ni"
                    ? prev.niDirBuffer
                    : "",
              };
            }

            if (
              !tr.docChanged &&
              !tr.selectionSet
            ) {
              return prev;
            }

            const vtState =
              verbatimTogglePluginKey.getState(
                newState
              );
            if (vtState?.active) {
              return EMPTY_STATE;
            }

            const composing =
              getComposingWord(newState);

            if (
              !composing ||
              composing.word.length < 1
            ) {
              return EMPTY_STATE;
            }

            const matches = wordsByPrefix(
              composing.word
            ).slice(0, MAX_SUGGESTIONS);

            if (matches.length === 0) {
              return EMPTY_STATE;
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

            // Preserve niDirBuffer if still
            // composing "ni" with "ni" active
            const activeWord =
              matches[activeIndex]?.word;
            const keepBuf =
              activeWord === "ni" &&
              composing.word === "ni" &&
              prev.niDirBuffer.length > 0;

            return {
              prefix: composing.word,
              matches,
              activeIndex,
              range: {
                from: composing.from,
                to: composing.to,
              },
              niDirBuffer: keepBuf
                ? prev.niDirBuffer
                : "",
            };
          },
        },

        props: {
          handleDOMEvents: {
            // The pending composing run is MARKED
            // VERBATIM (not committed as a word) and
            // the popup dismissed — but only on a
            // TRUE blur, and only at the
            // FocusTracker's settle.
            // Blur to the PEER pane leaves
            // the run pending: the writer is still
            // composing it, one pane over, and the
            // Latin pane's own edit of that text
            // must not arrive already marked.
            // Plugin state is re-read AT the settle,
            // so a range consumed meanwhile (a
            // popup click, a commit) is respected.
            //
            // isSpView is what keeps NameInput
            // whole: its editor shares this
            // extension but is NOT a pane, so its
            // blur is never a pane hop — it takes
            // the synchronous path below and keeps
            // literally today's semantics (mark,
            // dismiss; its popup is portaled to the
            // body and would otherwise hang over
            // the app).
            blur(view) {
              const markPending = (): void => {
                if (view.isDestroyed) return;
                if (view.composing) return;
                const st =
                  autocompletePluginKey
                    .getState(view.state) as
                    | AutocompleteState
                    | undefined;
                if (!st?.range) return;
                const verbatimMark =
                  view.state.schema.marks
                    .verbatim;
                if (!verbatimMark) return;
                const tr = view.state.tr;
                tr.addMark(
                  st.range.from,
                  st.range.to,
                  verbatimMark.create()
                );
                tr.setMeta(
                  autocompletePluginKey,
                  { dismiss: true }
                );
                view.dispatch(tr);
              };
              if (!focusTracker.isSpView(view)) {
                // NOT a pane: nothing to disambiguate
                // and nothing to wait for. Run
                // today's behavior synchronously and
                // stay off the pane's focus state —
                // borrowing its single pendingBlur
                // slot for an editor that is not a
                // pane buys nothing and can only
                // confuse the settle.
                markPending();
                return false;
              }
              focusTracker.notifyBlur(
                "sp",
                (now) => {
                  if (now !== null) return;
                  markPending();
                }
              );
              return false;
            },
          },
          decorations(state) {
            const st = autocompletePluginKey
              .getState(state) as
              | AutocompleteState
              | undefined;
            if (!st) return DecorationSet.empty;

            const decos: Decoration[] = [];

            // Suppress ligatures on all Latin
            // text runs so the font doesn't
            // render them as sitelen pona glyphs
            state.doc.descendants(
              (node, pos) => {
                if (
                  !node.isText ||
                  !node.text
                ) {
                  return;
                }
                const re = /[a-zA-Z]+/g;
                let m;
                while (
                  (m = re.exec(node.text)) !==
                  null
                ) {
                  decos.push(
                    Decoration.inline(
                      pos + m.index,
                      pos + m.index + m[0].length,
                      {
                        class:
                          "composing-text",
                      }
                    )
                  );
                }
              }
            );

            if (decos.length === 0) {
              return DecorationSet.empty;
            }
            return DecorationSet.create(
              state.doc,
              decos
            );
          },
          handleKeyDown(view, event) {
            // Escape: dismiss popup, apply
            // verbatim mark, enter verbatim mode.
            if (event.key === "Escape") {
              const composing =
                getComposingWord(view.state);
              if (composing) {
                const tr = view.state.tr;
                const verbatimMark =
                  view.state.schema.marks
                    .verbatim;
                if (verbatimMark) {
                  tr.addMark(
                    composing.from,
                    composing.to,
                    verbatimMark.create()
                  );
                  tr.removeStoredMark(
                    verbatimMark
                  );
                }
                tr.setMeta(
                  autocompletePluginKey,
                  { dismiss: true }
                );
                tr.setMeta(
                  verbatimTogglePluginKey,
                  {
                    active: true,
                    lastBacktickTime: 0,
                    manualOverride: false,
                  }
                );
                view.dispatch(tr);
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
              niDirBuffer,
            } = pluginState;

            const isNiActive =
              matches[activeIndex]?.word === "ni";

            // Backspace: pop last direction char
            // from buffer before touching the doc
            if (
              event.key === "Backspace" &&
              isNiActive &&
              niDirBuffer.length > 0
            ) {
              event.preventDefault();
              view.dispatch(
                view.state.tr.setMeta(
                  autocompletePluginKey,
                  { niDirBackspace: true }
                )
              );
              return true;
            }

            // ni direction input: intercept
            // direction chars, store in buffer
            if (isNiActive) {
              if (niDirBuffer.length === 0) {
                // First direction char: <, ^, >
                if (
                  FIRST_DIR_CHARS.has(event.key)
                ) {
                  event.preventDefault();
                  view.dispatch(
                    view.state.tr.setMeta(
                      autocompletePluginKey,
                      { niDirChar: event.key }
                    )
                  );
                  return true;
                }
              } else if (
                niDirBuffer.length === 1
              ) {
                // Second direction char
                if (
                  ALL_DIR_CHARS.has(event.key)
                ) {
                  const combo =
                    niDirBuffer + event.key;
                  const dir =
                    niDirectionByVerbatim(combo);
                  if (dir && range) {
                    // Valid 2-char direction:
                    // commit immediately
                    event.preventDefault();
                    commitWord(
                      "ni",
                      range.from,
                      range.to,
                      dir.index
                    );
                    return true;
                  }
                  // Invalid combo: ignore
                  event.preventDefault();
                  return true;
                }
              }
            }

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
              // Commit with direction if buffered
              let variation: number | null =
                null;
              if (
                word === "ni" &&
                niDirBuffer.length > 0
              ) {
                const dir =
                  niDirectionByVerbatim(
                    niDirBuffer
                  );
                if (dir) variation = dir.index;
              }
              commitWord(
                word,
                range.from,
                range.to,
                variation
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
            // (skip if in ni direction mode)
            if (
              !(isNiActive &&
                niDirBuffer.length > 0)
            ) {
              const digit = parseInt(
                event.key, 10
              );
              if (!isNaN(digit)) {
                const word =
                  matches[activeIndex]?.word;
                if (!word || !range) {
                  return false;
                }

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
            }

            // Structural chars: commit word +
            // insert UCSUR control char.
            // Direction chars (<^>) when ni is
            // active are handled above, not here.
            if (
              isStructuralChar(event.key) &&
              event.key.length === 1 &&
              !(isNiActive &&
                FIRST_DIR_CHARS.has(event.key))
            ) {
              if (!range) return false;
              const word =
                matches[activeIndex]?.word;
              if (!word) return false;

              // Commit with direction if buffered
              let variation: number | null =
                null;
              if (
                word === "ni" &&
                niDirBuffer.length > 0
              ) {
                const dir =
                  niDirectionByVerbatim(
                    niDirBuffer
                  );
                if (dir) variation = dir.index;
              }

              const ucsurCtrl =
                asciiToUcsurControl(event.key);
              if (!ucsurCtrl) return false;

              event.preventDefault();
              commitWord(
                word,
                range.from,
                range.to,
                variation,
                ucsurCtrl
              );
              return true;
            }

            return false;
          },
        },

        // appendTransaction: auto-commit word+space,
        // auto-commit complete ni directions, and
        // mark abandoned composing text as verbatim
        appendTransaction(
          transactions,
          oldState,
          newState
        ) {
          // FOREIGN-TRANSACTION RULE:
          // a lipuSync adoption's auto-commit branch
          // would read the STALE SP selection (the
          // sync didn't move it to track the Latin
          // edit) and could rewrite text the user
          // never asked to commit. The `apply` hook
          // (plugin state, `range` etc.) is NOT
          // gated here -- it must keep recomputing
          // on lipuSync (see `apply` above); only
          // this dispatching hook stands down.
          if (
            transactions.some(
              (t) =>
                t.getMeta(LIPU_SYNC_META) !== undefined
            )
          ) {
            return null;
          }
          // Detect abandoned composing text
          // (cursor navigated away without edit)
          if (
            !transactions.some(
              (tr) => tr.docChanged
            )
          ) {
            const oldAc =
              autocompletePluginKey.getState(
                oldState
              ) as
                | AutocompleteState
                | undefined;
            const newAc =
              autocompletePluginKey.getState(
                newState
              ) as
                | AutocompleteState
                | undefined;
            if (
              oldAc?.range && !newAc?.range
            ) {
              const vt =
                newState.schema.marks.verbatim;
              if (vt) {
                return newState.tr.addMark(
                  oldAc.range.from,
                  oldAc.range.to,
                  vt.create()
                );
              }
            }
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

          const textStart =
            $from.pos - textNode.text.length;

          // Word + space auto-commit
          const result = extractWordBeforeSpace(
            textNode.text
          );
          if (!result) return null;

          const { word, start } = result;

          if (!isWord(word)) return null;

          const ucsur = wordToUcsur(word);
          if (!ucsur) return null;

          const wordFrom = textStart + start;
          const wordTo =
            textStart + start + word.length;

          const tr = newState.tr.insertText(
            ucsur,
            wordFrom,
            wordTo
          );

          return tr;
        },

      }),
    ];
  },
});
