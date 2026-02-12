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
  niZwjString,
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
  /**
   * Direction buffer for ni (null = not in
   * direction mode, "" = just pressed &).
   */
  niDirBuf: string | null;
}

const EMPTY_STATE: AutocompleteState = {
  prefix: "",
  matches: [],
  activeIndex: 0,
  coords: null,
  range: null,
  verbatimRange: null,
  niDirBuf: null,
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

  // Match "ni&" + optional direction chars
  const niDirMatch = textNode.text.match(
    /(ni&[<^>v]{0,2})$/i
  );
  if (niDirMatch) {
    const matchStr = niDirMatch[1];
    const textStart =
      $from.pos - textNode.text.length;
    return {
      word: matchStr.toLowerCase(),
      from:
        textStart +
        textNode.text.length -
        matchStr.length,
      to: $from.pos,
    };
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

  // Match ni + direction suffix
  const niDirMatch = withoutSpace.match(
    /(ni&[<^>v]{1,2})$/i
  );
  if (niDirMatch) {
    const word = niDirMatch[1].toLowerCase();
    const start =
      withoutSpace.length -
      niDirMatch[1].length;
    return { word, start };
  }

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
      ? niZwjString(cp, dir)
      : codepointToChar(cp);
  }
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

/**
 * Parse a composing prefix that may contain
 * "ni&<dir>" into base word and direction.
 */
function parseNiDirPrefix(
  prefix: string
): { base: string; dir: string } | null {
  const m = prefix.match(
    /^(ni)&([<^>v]{0,2})$/
  );
  if (!m) return null;
  return { base: m[1], dir: m[2] };
}

/**
 * Check if a ni direction string is complete
 * and unambiguous (can auto-commit).
 * 2-char directions and "v" are always final;
 * "^", "<", ">" could extend to 2-char combos.
 */
function isCompleteNiDir(
  dirStr: string
): boolean {
  if (!niDirectionByVerbatim(dirStr)) {
    return false;
  }
  if (dirStr.length === 2) return true;
  return dirStr === "v";
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

    // --- ni direction input mode ---
    // Tracks direction chars after "&" when
    // composing "ni". null = not in direction
    // mode. "" = just entered (after &).
    let niDirBuf: string | null = null;

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
              niDirBuf = null;
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
            if (meta && "niDirBuf" in meta) {
              return {
                ...prev,
                niDirBuf: meta.niDirBuf,
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
              niDirBuf = null;
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
              niDirBuf = null;
              return {
                ...EMPTY_STATE,
                verbatimRange,
              };
            }

            // Strip "ni&..." suffix for lookup
            const niDir =
              parseNiDirPrefix(composing.word);
            const lookupWord = niDir
              ? niDir.base
              : composing.word;

            const matches = wordsByPrefix(
              lookupWord
            ).slice(0, MAX_SUGGESTIONS);

            if (matches.length === 0) {
              niDirBuf = null;
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

            const prevNiDir =
              parseNiDirPrefix(prev.prefix);
            const prevLookup = prevNiDir
              ? prevNiDir.base
              : prev.prefix;
            const sameRoot =
              prevLookup.length > 0 &&
              lookupWord.startsWith(
                prevLookup
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
              niDirBuf,
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
                const re = /[a-zA-Z&]+/g;
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

            // Verbatim text decoration
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
            // ni direction input mode: intercept
            // direction chars after "&"
            if (niDirBuf !== null) {
              const ps =
                autocompletePluginKey.getState(
                  view.state
                ) as
                  | AutocompleteState
                  | undefined;
              if (
                !ps ||
                ps.matches.length === 0
              ) {
                niDirBuf = null;
              } else {
                // Ignore modifier-only keys
                // (Shift fires before ^, <, >)
                if (
                  event.key === "Shift" ||
                  event.key === "Control" ||
                  event.key === "Alt" ||
                  event.key === "Meta"
                ) {
                  return false;
                }
                const curRange = ps.range;
                if (event.key === "Escape") {
                  niDirBuf = null;
                  view.dispatch(
                    view.state.tr.setMeta(
                      autocompletePluginKey,
                      { niDirBuf: null }
                    )
                  );
                  event.preventDefault();
                  return true;
                }
                if (
                  event.key === "Backspace"
                ) {
                  if (niDirBuf.length > 0) {
                    niDirBuf =
                      niDirBuf.slice(0, -1);
                  } else {
                    niDirBuf = null;
                  }
                  view.dispatch(
                    view.state.tr.setMeta(
                      autocompletePluginKey,
                      { niDirBuf }
                    )
                  );
                  event.preventDefault();
                  return true;
                }
                const dirChars = new Set([
                  "<", "^", ">", "v",
                ]);
                if (dirChars.has(event.key)) {
                  const next =
                    niDirBuf + event.key;
                  const dir =
                    niDirectionByVerbatim(
                      next
                    );
                  if (dir) {
                    if (
                      next.length === 2 ||
                      next === "v"
                    ) {
                      // Complete: commit now
                      if (curRange) {
                        commitWord(
                          "ni",
                          curRange.from,
                          curRange.to,
                          dir.index
                        );
                      }
                      niDirBuf = null;
                    } else {
                      niDirBuf = next;
                      view.dispatch(
                        view.state.tr.setMeta(
                          autocompletePluginKey,
                          { niDirBuf: next }
                        )
                      );
                    }
                  } else {
                    // Invalid combo: commit
                    // what we have
                    const prev =
                      niDirectionByVerbatim(
                        niDirBuf
                      );
                    if (prev && curRange) {
                      commitWord(
                        "ni",
                        curRange.from,
                        curRange.to,
                        prev.index
                      );
                    }
                    niDirBuf = null;
                  }
                  event.preventDefault();
                  return true;
                }
                if (
                  event.key === " " ||
                  event.key === "Tab" ||
                  event.key === "Enter"
                ) {
                  const dir = niDirBuf
                    ? niDirectionByVerbatim(
                        niDirBuf
                      )
                    : null;
                  if (curRange) {
                    commitWord(
                      "ni",
                      curRange.from,
                      curRange.to,
                      dir ? dir.index : null
                    );
                  }
                  niDirBuf = null;
                  event.preventDefault();
                  return true;
                }
                // Other key: commit buffer
                const dir = niDirBuf
                  ? niDirectionByVerbatim(
                      niDirBuf
                    )
                  : null;
                if (curRange) {
                  commitWord(
                    "ni",
                    curRange.from,
                    curRange.to,
                    dir ? dir.index : null
                  );
                }
                niDirBuf = null;
                return false;
              }
            }

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
              prefix,
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
              // Parse ni direction from prefix
              const niDir =
                parseNiDirPrefix(prefix);
              let variation: number | null =
                null;
              if (
                niDir &&
                word === "ni" &&
                niDir.dir.length > 0
              ) {
                const dir =
                  niDirectionByVerbatim(
                    niDir.dir
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
            const niDirActive =
              parseNiDirPrefix(prefix);
            if (!niDirActive) {
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

            // & key: enter ni direction mode
            if (
              event.key === "&" &&
              matches[activeIndex]?.word ===
                "ni" &&
              range
            ) {
              niDirBuf = "";
              view.dispatch(
                view.state.tr.setMeta(
                  autocompletePluginKey,
                  { niDirBuf: "" }
                )
              );
              event.preventDefault();
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

          // Check if word overlaps verbatimRange
          const pluginState =
            autocompletePluginKey.getState(
              newState
            ) as AutocompleteState | undefined;
          const checkVerbatim = (
            wFrom: number,
            wTo: number
          ) => {
            if (!pluginState?.verbatimRange) {
              return false;
            }
            const vr =
              pluginState.verbatimRange;
            return rangesOverlap(
              wFrom, wTo, vr.from, vr.to
            );
          };

          const textStart =
            $from.pos - textNode.text.length;

          // Auto-commit complete ni directions
          // (no trailing space needed)
          const niAutoMatch =
            textNode.text.match(
              /(ni&([<^>v]{1,2}))$/i
            );
          if (niAutoMatch) {
            const fullStr =
              niAutoMatch[1].toLowerCase();
            const dirStr = niAutoMatch[2];
            if (isCompleteNiDir(dirStr)) {
              const dir =
                niDirectionByVerbatim(dirStr);
              if (dir) {
                const ucsur = wordToUcsur(
                  "ni", dir.index
                );
                if (ucsur) {
                  const wFrom =
                    textStart +
                    textNode.text.length -
                    fullStr.length;
                  const wTo =
                    textStart +
                    textNode.text.length;
                  if (!checkVerbatim(
                    wFrom, wTo
                  )) {
                    return newState.tr
                      .insertText(
                        ucsur, wFrom, wTo
                      );
                  }
                }
              }
            }
          }

          // Word + space auto-commit
          const result = extractWordBeforeSpace(
            textNode.text
          );
          if (!result) return null;

          const { word, start } = result;

          // Handle ni&<dir> + space
          const niDir =
            parseNiDirPrefix(word);
          if (niDir) {
            if (niDir.dir.length === 0) {
              return null;
            }
            const dir = niDirectionByVerbatim(
              niDir.dir
            );
            if (!dir) return null;
            const ucsur = wordToUcsur(
              "ni", dir.index
            );
            if (!ucsur) return null;
            const wordFrom =
              textStart + start;
            const wordTo =
              textStart + start + word.length;
            if (checkVerbatim(
              wordFrom, wordTo
            )) {
              return null;
            }
            return newState.tr.insertText(
              ucsur, wordFrom, wordTo
            );
          }

          if (!isWord(word)) return null;

          const ucsur = wordToUcsur(word);
          if (!ucsur) return null;

          const wordFrom = textStart + start;
          const wordTo =
            textStart + start + word.length;

          if (checkVerbatim(
            wordFrom, wordTo
          )) {
            return null;
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
