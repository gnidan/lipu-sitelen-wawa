import { Extension } from "@tiptap/core";
import {
  EditorState,
  Plugin,
  PluginKey,
  TextSelection,
} from "@tiptap/pm/state";
import { LIPU_SYNC_META } from "../lipu-sync";

export const verbatimTogglePluginKey =
  new PluginKey("verbatimToggle");

export interface VerbatimToggleState {
  active: boolean;
  lastBacktickTime: number;
  manualOverride: boolean;
}

const DOUBLE_TAP_MS = 300;

/**
 * Check whether the cursor sits inside text that
 * carries the verbatim mark (i.e. the character
 * immediately before the cursor is verbatim-marked).
 */
export function cursorInVerbatim(
  state: EditorState
): boolean {
  const { from, to } = state.selection;
  if (from !== to) return false;

  const verbatimType =
    state.schema.marks.verbatim;
  if (!verbatimType) return false;

  const $from = state.doc.resolve(from);
  const offset = $from.parentOffset;
  if (offset === 0) return false;

  const { node } =
    $from.parent.childBefore(offset);
  return !!(
    node && verbatimType.isInSet(node.marks)
  );
}

/**
 * Check whether the character after the cursor has
 * the verbatim mark (cursor is at the left edge of
 * a verbatim span).
 */
export function cursorBeforeVerbatim(
  state: EditorState
): boolean {
  const { from, to } = state.selection;
  if (from !== to) return false;
  const vt = state.schema.marks.verbatim;
  if (!vt) return false;
  const $from = state.doc.resolve(from);
  const off = $from.parentOffset;
  const { node } =
    $from.parent.childAfter(off);
  return !!(node && vt.isInSet(node.marks));
}

/**
 * Find the contiguous run of verbatim-marked text
 * that contains the cursor position.
 */
export function findVerbatimSpan(
  state: EditorState,
  cur: number
): { start: number; end: number } | null {
  const $pos = state.doc.resolve(cur);
  const parent = $pos.parent;
  const vt = state.schema.marks.verbatim;
  if (!vt) return null;

  const base = $pos.start();
  let rStart = -1;
  let rEnd = -1;
  let pos = base;

  for (
    let i = 0; i < parent.childCount; i++
  ) {
    const child = parent.child(i);
    const cStart = pos;
    const cEnd = pos + child.nodeSize;

    if (
      child.isText &&
      vt.isInSet(child.marks)
    ) {
      if (rStart === -1) rStart = cStart;
      rEnd = cEnd;
    } else {
      if (
        rStart !== -1 &&
        cur >= rStart &&
        cur <= rEnd
      ) {
        return { start: rStart, end: rEnd };
      }
      rStart = -1;
      rEnd = -1;
    }
    pos = cEnd;
  }

  if (
    rStart !== -1 &&
    cur >= rStart &&
    cur <= rEnd
  ) {
    return { start: rStart, end: rEnd };
  }
  return null;
}

export const VerbatimToggle = Extension.create({
  name: "verbatimToggle",

  addProseMirrorPlugins() {
    return [
      new Plugin<VerbatimToggleState>({
        key: verbatimTogglePluginKey,

        state: {
          init(): VerbatimToggleState {
            return {
              active: false,
              lastBacktickTime: 0,
              manualOverride: false,
            };
          },
          apply(
            tr, prev, _oldState, newState
          ): VerbatimToggleState {
            const meta = tr.getMeta(
              verbatimTogglePluginKey
            );
            if (meta !== undefined) {
              return meta as VerbatimToggleState;
            }

            // FOREIGN-TRANSACTION RULE:
            // a lipuSync-mapped selection delta is
            // not user selection movement.
            // manualOverride SURVIVES it; only
            // genuine movement consumes it.
            if (
              tr.getMeta(LIPU_SYNC_META) !== undefined
            ) {
              return prev;
            }

            // Auto-sync: when the cursor moves,
            // activate/deactivate based on
            // whether it landed in verbatim text,
            // with boundary suppression.
            const oldSel = _oldState.selection;
            const newSel = newState.selection;
            if (
              oldSel.from !== newSel.from ||
              oldSel.to !== newSel.to
            ) {
              if (prev.manualOverride) {
                return {
                  ...prev,
                  manualOverride: false,
                };
              }
              const inV =
                cursorInVerbatim(newState);
              if (inV && !prev.active) {
                const span = findVerbatimSpan(
                  newState, newSel.from
                );
                if (
                  span &&
                  newSel.from === span.end
                ) {
                  return prev; // right boundary
                }
                return {
                  active: true,
                  lastBacktickTime: 0,
                  manualOverride: false,
                };
              }
              if (!inV && prev.active) {
                if (
                  cursorBeforeVerbatim(newState)
                ) {
                  return prev; // left boundary
                }
                return {
                  active: false,
                  lastBacktickTime: 0,
                  manualOverride: false,
                };
              }
            }

            return prev;
          },
        },

        props: {
          handleKeyDown(view, event) {
            const st =
              verbatimTogglePluginKey.getState(
                view.state
              ) as VerbatimToggleState;

            // Helper to dispatch with meta
            function dispatch(
              tr: ReturnType<
                typeof view.state.tr.setMeta
              >,
              meta: VerbatimToggleState
            ) {
              tr.setMeta(
                verbatimTogglePluginKey, meta
              );
              view.dispatch(tr);
            }

            // Arrow key boundary stops
            if (
              (event.key === "ArrowLeft" ||
                event.key === "ArrowRight") &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.altKey &&
              !event.metaKey
            ) {
              const { from, to } =
                view.state.selection;
              if (from !== to) return false;

              if (event.key === "ArrowRight") {
                if (st.active) {
                  const span = findVerbatimSpan(
                    view.state, from
                  );
                  if (
                    span && from === span.end
                  ) {
                    dispatch(view.state.tr, {
                      active: false,
                      lastBacktickTime: 0,
                      manualOverride: false,
                    });
                    return true;
                  }
                } else {
                  if (
                    cursorBeforeVerbatim(
                      view.state
                    )
                  ) {
                    dispatch(view.state.tr, {
                      active: true,
                      lastBacktickTime: 0,
                      manualOverride: true,
                    });
                    return true;
                  }
                }
              }

              if (event.key === "ArrowLeft") {
                if (st.active) {
                  const span = findVerbatimSpan(
                    view.state, from
                  );
                  if (span) {
                    if (from === span.start) {
                      dispatch(view.state.tr, {
                        active: false,
                        lastBacktickTime: 0,
                        manualOverride: false,
                      });
                      return true;
                    }
                    if (
                      from - 1 === span.start
                    ) {
                      const tr = view.state.tr;
                      tr.setSelection(
                        TextSelection.create(
                          tr.doc, span.start
                        )
                      );
                      dispatch(tr, {
                        active: true,
                        lastBacktickTime: 0,
                        manualOverride: true,
                      });
                      return true;
                    }
                  }
                } else {
                  if (
                    cursorInVerbatim(view.state)
                  ) {
                    dispatch(view.state.tr, {
                      active: true,
                      lastBacktickTime: 0,
                      manualOverride: true,
                    });
                    return true;
                  }
                }
              }
              return false;
            }

            // Escape exits verbatim mode
            if (
              event.key === "Escape" &&
              st.active
            ) {
              const tr = view.state.tr;
              tr.setMeta(
                verbatimTogglePluginKey,
                {
                  active: false,
                  lastBacktickTime: 0,
                  manualOverride: false,
                }
              );
              view.dispatch(tr);
              return true;
            }

            if (event.key !== "`") return false;

            // Don't intercept with modifiers
            if (
              event.ctrlKey ||
              event.altKey ||
              event.metaKey
            ) {
              return false;
            }

            // Hold-to-exit: on key repeat,
            // delete the backtick and exit
            if (event.repeat) {
              if (
                st.active &&
                st.lastBacktickTime > 0
              ) {
                const { from } =
                  view.state.selection;
                if (
                  from >= 1 &&
                  view.state.doc.textBetween(
                    from - 1, from
                  ) === "`"
                ) {
                  const tr = view.state.tr;
                  tr.delete(from - 1, from);
                  tr.setMeta(
                    verbatimTogglePluginKey,
                    {
                      active: false,
                      lastBacktickTime: 0,
                      manualOverride: false,
                    }
                  );
                  view.dispatch(tr);
                }
              }
              return true; // consume all repeats
            }

            event.preventDefault();

            if (!st.active) {
              // Enter verbatim mode (no char)
              const tr = view.state.tr;
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

            // In verbatim mode
            const now = Date.now();
            const isDouble =
              st.lastBacktickTime > 0 &&
              now - st.lastBacktickTime <
                DOUBLE_TAP_MS;

            const tr = view.state.tr;
            const { from, to } =
              view.state.selection;

            if (isDouble) {
              // Delete previous backtick, exit
              if (
                from >= 1 &&
                view.state.doc.textBetween(
                  from - 1, from
                ) === "`"
              ) {
                tr.delete(from - 1, from);
              }
              tr.setMeta(
                verbatimTogglePluginKey,
                {
                  active: false,
                  lastBacktickTime: 0,
                  manualOverride: false,
                }
              );
              view.dispatch(tr);
              return true;
            }

            // Insert literal backtick with
            // verbatim mark
            tr.insertText("`", from, to);
            const verbatimMark =
              view.state.schema.marks.verbatim;
            if (verbatimMark) {
              tr.addMark(
                from,
                from + 1,
                verbatimMark.create()
              );
            }
            tr.setMeta(
              verbatimTogglePluginKey,
              {
                active: true,
                lastBacktickTime: now,
                manualOverride: false,
              }
            );
            view.dispatch(tr);
            return true;
          },

          handleTextInput(view, from, to, text) {
            const vt =
              view.state.schema.marks.verbatim;
            if (!vt) return false;

            const st =
              verbatimTogglePluginKey.getState(
                view.state
              ) as VerbatimToggleState;

            if (st?.active) {
              // Active: apply verbatim mark
              const tr = view.state.tr;
              tr.insertText(text, from, to);
              tr.addMark(
                from,
                from + text.length,
                vt.create()
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

            // Inactive: prevent verbatim mark
            // propagation at span boundary
            const $from =
              view.state.doc.resolve(from);
            const nb = $from.nodeBefore;
            if (
              nb?.isText &&
              vt.isInSet(nb.marks)
            ) {
              const tr = view.state.tr;
              tr.insertText(text, from, to);
              tr.removeMark(
                from, from + text.length, vt
              );
              view.dispatch(tr);
              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});
