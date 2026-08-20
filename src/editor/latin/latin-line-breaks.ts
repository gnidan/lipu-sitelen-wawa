/**
 * Latin Enter + empty-line crystallization.
 * Enter inserts a hardBreak — Latin-LOCAL
 * "\n" into gap.latin, never an SP break. A run of
 * 2+ hardBreaks crystallizes into a paragraph split
 * when the selection leaves it (dwell, the same rule
 * as the SP LineBreaks); the split then flows
 * through the structural latin merge as a genuine
 * transaction.
 *
 * INERT on sync-flagged reconciles (mount/reconcile
 * is not an edit — a remount NEVER crystallizes
 * at-rest "\n\n" runs that the model legitimately
 * holds) and while composing.
 *
 * Runs inside a structural span's INTERIOR gaps are
 * suppressed (symmetric with the SP side's
 * structural-span exception).
 * Cartouche interiors are skipped here for a
 * different reason than the SP side's: a cartouche
 * that projects a name is ONE ATOM in the Latin doc,
 * so it has no interior positions at all, and a
 * NAMELESS one projects its covered content as
 * ordinary text with no interior gap.latin to
 * protect — long/rev-long are the live cases.
 */

import { Extension } from "@tiptap/core";
import type { Editor as TiptapEditor } from
  "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { lipuModelKey } from
  "../extensions/lipu-model";
import { LATIN_SYNC_META } from "../lipu-sync";
import { projectBlock } from
  "../../app/latin-projections";
import { isStructural } from "../../lipu";
import { focusTracker } from "../focus-tracker";
import type { Block } from "../../lipu";

export const latinLineBreaksKey = new PluginKey(
  "latinLineBreaks"
);

/** Meta value asking for a pass that ignores DWELL.
 *  Dispatched by the Latin editor's TRUE-blur settle
 *  (latin-editor.ts) and by App.tsx's pane-close
 *  branch — closing the pane is a true blur with no
 *  peer to defer for — and kept on the appended
 *  transaction so a forced pass stays forced across
 *  appendTransaction rounds. */
export const FORCE = "forceNormalize";

/** Block-relative [from, to) Latin content ranges
 *  lying in a structural span's INTERIOR gaps.
 *  Offsets are map coordinates, which is what makes
 *  the comparison against PM content offsets
 *  exact. */
function suppressedRanges(
  block: Block | undefined
): Array<{ from: number; to: number }> {
  if (!block) return [];
  const out: Array<{ from: number; to: number }> = [];
  const { latinMap } = projectBlock(block);
  for (const s of block.spans) {
    if (!isStructural(s.kind)) continue;
    if (s.kind === "cartouche") continue;
    for (let g = s.from + 1; g <= s.to; g++) {
      for (const e of latinMap) {
        if (
          e.ref.seg === "gap" &&
          e.ref.index === g &&
          e.from < e.to
        ) {
          out.push({ from: e.from, to: e.to });
        }
      }
    }
  }
  return out;
}

/** DWELL: is the selection ON the run? Identical
 *  window to the SP side ([from, to] inclusive, not
 *  widened) — see line-breaks.ts for why ±1 would be
 *  character-width dependent. */
function dwelled(
  state: EditorState,
  from: number,
  to: number
): boolean {
  const { anchor, head } = state.selection;
  const touching = (p: number): boolean =>
    p >= from && p <= to;
  return touching(anchor) || touching(head);
}

export function latinLineBreaks(
  spEditor: TiptapEditor,
  shared: { composing: boolean }
): ReturnType<typeof Extension.create> {
  return Extension.create({
    name: "latinLineBreaks",
    addProseMirrorPlugins() {
      // The loop's own composing FLAG and the view's
      // live IME state are checked together
      // everywhere else; a browser composition
      // that never fired compositionstart into our
      // listener would otherwise crystallize under
      // the input method.
      const self = this.editor;
      const composing = (): boolean =>
        shared.composing ||
        (!!self &&
          !self.isDestroyed &&
          self.view.composing);
      return [
        new Plugin({
          key: latinLineBreaksKey,
          props: {
            handleKeyDown(view, event) {
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey
              ) {
                return false;
              }
              const { state } = view;
              const br =
                state.schema.nodes.hardBreak.create();
              const tr =
                state.tr.replaceSelectionWith(br);
              tr.scrollIntoView();
              view.dispatch(tr);
              return true;
            },
          },
          appendTransaction(trs, oldState, newState) {
            if (composing()) return null;
            if (
              trs.some(
                (t) =>
                  t.getMeta(LATIN_SYNC_META) !==
                  undefined
              )
            ) {
              return null;
            }
            const force = trs.some(
              (t) =>
                t.getMeta(latinLineBreaksKey) ===
                FORCE
            );
            if (
              !force &&
              !trs.some((t) => t.docChanged) &&
              oldState.selection.eq(
                newState.selection
              )
            ) {
              return null;
            }
            const model = spEditor.isDestroyed
              ? null
              : lipuModelKey.getState(
                  spEditor.state
                );
            const runs: Array<{
              from: number;
              to: number;
            }> = [];
            newState.doc.forEach(
              (para, paraPos, paraIndex) => {
                const contentStart = paraPos + 1;
                let ranges:
                  | Array<{
                      from: number;
                      to: number;
                    }>
                  | undefined;
                const consider = (
                  runStart: number,
                  runLen: number
                ): void => {
                  if (runLen < 2) return;
                  if (
                    !force &&
                    focusTracker.focused() === "sp"
                  ) {
                    // Blur-to-peer, mirrored: while
                    // the SP pane holds focus, a
                    // Latin run
                    // is CARRIED, not crystallized.
                    // A forced pass (true blur, pane
                    // close) still crystallizes.
                    return;
                  }
                  const from = runStart;
                  const to = runStart + runLen;
                  if (
                    !force &&
                    dwelled(newState, from, to)
                  ) {
                    return;
                  }
                  if (ranges === undefined) {
                    ranges = suppressedRanges(
                      model?.lipu.blocks[paraIndex]
                    );
                  }
                  const relFrom =
                    from - contentStart;
                  const relTo = to - contentStart;
                  if (
                    ranges.some(
                      (r) =>
                        r.from <= relFrom &&
                        relTo <= r.to
                    )
                  ) {
                    return;
                  }
                  runs.push({ from, to });
                };
                let runStart = -1;
                let runLen = 0;
                let pos = contentStart;
                para.forEach((child) => {
                  if (
                    child.type.name === "hardBreak"
                  ) {
                    if (runStart === -1) {
                      runStart = pos;
                    }
                    runLen += 1;
                  } else {
                    consider(runStart, runLen);
                    runStart = -1;
                    runLen = 0;
                  }
                  pos += child.nodeSize;
                });
                consider(runStart, runLen);
              }
            );
            if (runs.length === 0) return null;
            const tr = newState.tr;
            if (force) {
              tr.setMeta(latinLineBreaksKey, FORCE);
            }
            for (
              let i = runs.length - 1;
              i >= 0;
              i--
            ) {
              const { from, to } = runs[i];
              tr.delete(from, to);
              tr.split(from);
            }
            return tr;
          },
        }),
      ];
    },
  });
}
