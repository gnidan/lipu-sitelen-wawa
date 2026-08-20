/**
 * Shared lipu-layer history: ONE document-level
 * stack spanning both panes,
 * held as a plugin IN THE SP EDITOR whose state
 * runs AFTER lipu-model's.
 *
 * WHY A PLUGIN AND NOT on("transaction"): a chain
 * "keystroke-merge then crystallize-merge" is TWO
 * model changes inside ONE dispatch (the second
 * rides an APPENDED transaction). on("transaction")
 * fires once per dispatch with the post-append
 * state, so it cannot see the intermediate lipu and
 * would record the pair as one entry. Only a plugin
 * in the apply chain observes each version delta
 * individually.
 *
 * WHY DECLARED **BEFORE** LipuModel: TipTap REVERSES
 * the extension array when it builds the plugin
 * list, and ProseMirror computes plugin state fields
 * in array order — a field can only read fields
 * EARLIER in that array off the new state. Declaring
 * this extension before LipuModel is therefore what
 * puts it AFTER lipu-model in the chain. Getting it
 * backwards is silent (the model field reads
 * undefined on the new state), so `apply` tripwires
 * on exactly that shape.
 *
 * WHAT IS RECORDED: { lipuBefore, lipuAfter,
 * originSide, selBefore, selAfter } on every
 * model-version change with origin "edit" — SP
 * edits, Latin edits, and Latin-LOCAL edits (zero SP
 * steps) alike. NEVER origin "history" (undo/redo
 * MOVE entries, they mint none), and never the
 * production guard's correction, which re-adopts the
 * SAME lipu object (a version advance with nothing
 * to undo).
 *
 * COALESCING: PM-style typing runs. The group closes
 * on a structural change (crystallization included —
 * the block count moves), on a paste (the forwarded
 * paste meta), on a time gap, and on ANY SIDE
 * SWITCH.
 * UNDO-CANCELS-COMPOSE falls out of this rather than
 * being special-cased: a transient run IS the top
 * entry's lipuAfter, and crystallization closes the
 * group, so one undo always returns to the pre-run
 * state.
 *
 * UNDO adopts lipuBefore through the SAME derived
 * SpInline steps as an edit — one transaction per
 * editor, origin "history", sync-flagged, never a
 * wholesale re-seed (steps keep PM position mapping
 * alive, which is what lets the caret rule and the
 * decorations
 * survive undo). The version ADVANCES, so saves
 * fire. The Latin pane follows through the ordinary
 * structure-keyed reconcile.
 *
 * MEMORY (stated acceptance): incremental
 * entries share structure with the model's own block
 * arrays (the merge paths rebuild only touched
 * blocks), but a STRUCTURAL entry pins a full-doc
 * Block array on each side. At depth 100 that is the
 * accepted ceiling; post-undo the projection cache
 * recomputes from scratch for the same reason.
 */

import { Extension } from "@tiptap/core";
import type { Editor as TiptapEditor } from
  "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from
  "@tiptap/pm/state";
import type {
  EditorState,
  Selection,
} from "@tiptap/pm/state";
import type { Node as PmNode } from
  "@tiptap/pm/model";
import {
  isCodepointBoundary,
  mirrorRange,
  renderLatin,
  renderSp,
} from "../../lipu";
import type {
  BlockPos,
  Lipu,
  Side,
} from "../../lipu";
import {
  blockMaps,
  projectLipu,
} from "../../app/latin-projections";
import {
  LATIN_SYNC_META,
  LIPU_SYNC_META,
  getLipuSync,
  minimalReplaceTr,
} from "../lipu-sync";
import type {
  LipuSyncMeta,
  SelSnapshot,
} from "../lipu-sync";
import { lipuToContent } from "../lipu-doc";
import {
  blockOffsetToPm,
  pmToBlockOffset,
} from "../pm-coords";
import { lipuModelKey } from "./lipu-model";
import { pasteHandlerKey } from "./paste-handler";
import { focusTracker } from "../focus-tracker";

export interface HistoryEntry {
  lipuBefore: Lipu;
  lipuAfter: Lipu;
  originSide: Side;
  selBefore: SelSnapshot | null;
  selAfter: SelSnapshot | null;
}

export interface LipuHistoryState {
  done: HistoryEntry[];
  undone: HistoryEntry[];
  lastVersion: number;
  lastLipu: Lipu | null;
  groupSide: Side | null;
  lastTime: number;
}

export const lipuHistoryKey =
  new PluginKey<LipuHistoryState>("lipuHistory");

export const HISTORY_DEPTH = 100;
export const NEW_GROUP_MS = 1000;

/** The Latin pane, when one is open over this SP
 *  editor. A WeakMap, not plugin state: the pane
 *  comes and goes with a React effect and its
 *  lifetime is not a document fact. */
const latinOf = new WeakMap<
  TiptapEditor,
  TiptapEditor
>();

export function registerLatinEditor(
  sp: TiptapEditor,
  latin: TiptapEditor | null
): void {
  if (latin) latinOf.set(sp, latin);
  else latinOf.delete(sp);
}

function snapshotSel(
  st: EditorState
): SelSnapshot | null {
  const a = pmToBlockOffset(
    st.doc,
    st.selection.anchor
  );
  const h = pmToBlockOffset(
    st.doc,
    st.selection.head
  );
  return a && h ? { anchor: a, head: h } : null;
}

/** Side-linearized text whose UTF-16 indexing
 *  matches PM content offsets (breaks and name
 *  atoms are 1 unit each). renderLatin's `.text` for
 *  a name atom is its full spelling, which is NOT
 *  that coordinate system, so it is replaced by a
 *  single placeholder unit here. */
function sideText(
  lipu: Lipu,
  side: Side,
  block: number
): string {
  const b = lipu.blocks[block];
  if (!b) return "";
  if (side === "sp") {
    return renderSp(b)
      .inlines.map((i) =>
        i.type === "break" ? "\n" : i.text
      )
      .join("");
  }
  return renderLatin(b)
    .inlines.map((i) =>
      i.type === "name" ? "￼" : i.text
    )
    .join("");
}

/** Restore clamp: clamp the block index, then the
 *  offset,
 *  SNAPPED DOWN TO A CODEPOINT BOUNDARY — a raw
 *  UTF-16 clamp can land inside a surrogate pair on
 *  the SP side (every UCSUR glyph is one), and
 *  resolving there would either throw or render lone
 *  surrogates. Never errors: a restored selection is
 *  a convenience, never a reason to lose an undo.
 *  Exported for the pin — no ordinary edit reaches
 *  the defensive branches. */
export function clampBlockPos(
  lipu: Lipu,
  side: Side,
  p: BlockPos
): BlockPos {
  if (lipu.blocks.length === 0) {
    return { block: 0, offset: 0 };
  }
  const block = Math.max(
    0,
    Math.min(p.block, lipu.blocks.length - 1)
  );
  const text = sideText(lipu, side, block);
  let offset = Math.max(
    0,
    Math.min(p.offset, text.length)
  );
  while (
    offset > 0 &&
    !isCodepointBoundary(text, offset)
  ) {
    offset -= 1;
  }
  return { block, offset };
}

/** Document order over BlockPos. */
function posBefore(a: BlockPos, b: BlockPos): boolean {
  return (
    a.block < b.block ||
    (a.block === b.block && a.offset < b.offset)
  );
}

/** Pane lifecycle: the entry originated in the
 *  Latin pane and that pane is gone, so its
 *  selection is restored on the SP side at the
 *  MIRRORED position. A collapsed caret mirrors as
 *  an empty range (mirrorRange returns nothing for
 *  one), so it is mirrored as the 1-unit range that
 *  ENDS at it — falling back to the block start when
 *  even that has no SP counterpart (a Latin-only
 *  byte). */
function mirrorToSp(
  lipu: Lipu,
  sel: SelSnapshot
): SelSnapshot {
  const maps = blockMaps(projectLipu(lipu));
  const a = clampBlockPos(lipu, "latin", sel.anchor);
  const h = clampBlockPos(lipu, "latin", sel.head);
  const fallback: SelSnapshot = {
    anchor: { block: a.block, offset: 0 },
    head: { block: a.block, offset: 0 },
  };
  const collapsed =
    a.block === h.block && a.offset === h.offset;
  const from = collapsed
    ? { block: a.block, offset: Math.max(0, a.offset - 1) }
    : a;
  const to =
    collapsed && a.offset === 0
      ? { block: a.block, offset: 1 }
      : h;
  const res = mirrorRange(maps, "latin", from, to);
  const first = res.inline[0];
  const last = res.inline[res.inline.length - 1];
  if (!first || !last) {
    if (res.wholeBlocks.length > 0) {
      const b = res.wholeBlocks[0];
      return {
        anchor: { block: b, offset: 0 },
        head: { block: b, offset: 0 },
      };
    }
    return fallback;
  }
  if (!collapsed) {
    const start = {
      block: first.block,
      offset: first.from,
    };
    const end = { block: last.block, offset: last.to };
    // DIRECTION SURVIVES THE MIRROR: mirrorRange
    // normalizes its arguments (it swaps them so
    // from <= to), so its result is always in
    // document order. A backwards selection —
    // shift-arrow leftwards, or a drag that ended
    // before it started — must come back backwards,
    // or the next shift-arrow grows the wrong end.
    return posBefore(sel.head, sel.anchor)
      ? { anchor: end, head: start }
      : { anchor: start, head: end };
  }
  const pos =
    a.offset === 0
      ? { block: first.block, offset: first.from }
      : { block: last.block, offset: last.to };
  return { anchor: pos, head: pos };
}

/** Doc-clamped resolve of a BlockPos pair. The doc
 *  can trail the model by a dispatch (the Latin pane
 *  defers reconciles under a live IME), so every
 *  position is clamped a second time in DOC
 *  coordinates before it is resolved. */
function selectionIn(
  doc: PmNode,
  sel: SelSnapshot
): Selection | null {
  if (doc.childCount === 0) return null;
  const clamp = (pos: number): number =>
    Math.max(0, Math.min(pos, doc.content.size));
  const at = (p: BlockPos): number => {
    const b = Math.max(
      0,
      Math.min(p.block, doc.childCount - 1)
    );
    const limit = doc.child(b).content.size;
    return clamp(
      blockOffsetToPm(
        doc,
        b,
        Math.max(0, Math.min(p.offset, limit))
      )
    );
  };
  return TextSelection.between(
    doc.resolve(at(sel.anchor)),
    doc.resolve(at(sel.head))
  );
}

/** Which editor the entry's selection belongs to. */
function restoreTarget(
  sp: TiptapEditor,
  side: Side
): TiptapEditor | null {
  if (side !== "latin") return null;
  const latin = latinOf.get(sp);
  return latin && !latin.isDestroyed ? latin : null;
}

function applyHistory(
  sp: TiptapEditor,
  direction: "undo" | "redo"
): boolean {
  if (sp.isDestroyed) return false;
  const hist = lipuHistoryKey.getState(sp.state);
  if (!hist) return false;
  const stack =
    direction === "undo" ? hist.done : hist.undone;
  if (stack.length === 0) return false;
  const entry = stack[stack.length - 1];
  const lipu =
    direction === "undo"
      ? entry.lipuBefore
      : entry.lipuAfter;
  const sel =
    direction === "undo"
      ? entry.selBefore
      : entry.selAfter;
  const latin = restoreTarget(sp, entry.originSide);

  // ONE transaction on the SP editor: the derived
  // steps, the sync meta, and — when the selection
  // belongs to this side — the selection too. Folded
  // in rather than dispatched after, because a bare
  // selection transaction is an UNFLAGGED pass for
  // LineBreaks' normalizer, which would crystallize
  // the very transient run the undo just restored
  // (the crystallize-on-restore hazard, SP half).
  const tr =
    minimalReplaceTr(sp.state, lipuToContent(lipu)) ??
    sp.state.tr;
  tr.setMeta(LIPU_SYNC_META, {
    lipu,
    originSide: entry.originSide,
    origin: "history",
    latinSelBefore: null,
    latinSelAfter: null,
  } satisfies LipuSyncMeta);
  tr.setMeta(lipuHistoryKey, { direction });
  if (sel && !latin) {
    const spSel =
      entry.originSide === "latin"
        ? mirrorToSp(lipu, sel)
        : {
            anchor: clampBlockPos(
              lipu,
              "sp",
              sel.anchor
            ),
            head: clampBlockPos(lipu, "sp", sel.head),
          };
    const next = selectionIn(tr.doc, spSel);
    if (next) tr.setSelection(next);
  }
  sp.view.dispatch(tr);
  // The Latin pane reconciled inside that dispatch,
  // structure-keyed as always (latin-editor.ts's
  // spEditor.on("transaction") observer).

  // The programmatic focus below induces a blur
  // on the peer pane. Armed BEFORE the focus so the
  // blur's settle sees it; the tracker's
  // generation-stamped auto-disarm cleans up when
  // the editor already held focus and no blur ever
  // fires.
  focusTracker.suppressNext();
  if (latin && !latin.isDestroyed) {
    if (sel) {
      const next = selectionIn(latin.state.doc, {
        anchor: clampBlockPos(
          lipu,
          "latin",
          sel.anchor
        ),
        head: clampBlockPos(lipu, "latin", sel.head),
      });
      if (next) {
        const ltr =
          latin.state.tr.setSelection(next);
        // Sync-flagged for the same reason the SP
        // selection rides the adoption: this is our
        // own render of a restored state, not an
        // edit gesture — latinLineBreaks stays inert
        // (crystallize-on-restore, Latin half) and
        // the pane's mirror
        // handler leaves it alone (the deliberate
        // leftover-highlight suppression).
        ltr.setMeta(LATIN_SYNC_META, true);
        ltr.setMeta("addToHistory", false);
        latin.view.dispatch(ltr);
      }
    }
    latin.view.focus();
  } else if (!sp.isDestroyed) {
    // view.focus(), never commands.focus(): the
    // command dispatches its own selection
    // transaction, which is exactly the unflagged
    // normalizer pass this function avoids above.
    sp.view.focus();
  }
  return true;
}

export function sharedUndo(
  sp: TiptapEditor
): boolean {
  return applyHistory(sp, "undo");
}

export function sharedRedo(
  sp: TiptapEditor
): boolean {
  return applyHistory(sp, "redo");
}

let orderWarned = false;

export const LipuHistory = Extension.create({
  name: "lipuHistory",

  addKeyboardShortcuts() {
    return {
      "Mod-z": () => sharedUndo(this.editor),
      "Shift-Mod-z": () => sharedRedo(this.editor),
      "Mod-y": () => sharedRedo(this.editor),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<LipuHistoryState>({
        key: lipuHistoryKey,
        state: {
          init: (_config, state) => ({
            done: [],
            undone: [],
            lastVersion:
              lipuModelKey.getState(state)?.version ??
              -1,
            lastLipu:
              lipuModelKey.getState(state)?.lipu ??
              null,
            groupSide: null,
            lastTime: 0,
          }),
          apply: (tr, prev, oldState, newState) => {
            const model =
              lipuModelKey.getState(newState);
            if (!model) {
              // ORDERING TRIPWIRE. The model field
              // is
              // missing from the NEW state but
              // present on the old one: this plugin
              // is ordered BEFORE lipu-model, so it
              // can never see an advanced version
              // and the whole history would be
              // silently dead. See the header for
              // the declaration-order rule.
              if (
                !orderWarned &&
                lipuModelKey.getState(oldState)
              ) {
                orderWarned = true;
                console.error(
                  "lipu-sitelen-wawa: lipu-history " +
                    "runs BEFORE lipu-model; declare " +
                    "LipuHistory before LipuModel " +
                    "(TipTap reverses extension " +
                    "order). History disabled."
                );
              }
              return prev;
            }
            if (model.version === prev.lastVersion) {
              return prev;
            }
            const sync = getLipuSync(tr);
            if (sync?.origin === "history") {
              // origin "history" NEVER records: it
              // MOVES an entry between the stacks.
              const dir = (
                tr.getMeta(lipuHistoryKey) as
                  | { direction: string }
                  | undefined
              )?.direction;
              let { done, undone } = prev;
              if (dir === "undo" && done.length > 0) {
                const e = done[done.length - 1];
                done = done.slice(0, -1);
                undone = [...undone, e];
              } else if (
                dir === "redo" &&
                undone.length > 0
              ) {
                const e = undone[undone.length - 1];
                undone = undone.slice(0, -1);
                done = [...done, e];
              }
              return {
                done,
                undone,
                lastVersion: model.version,
                lastLipu: model.lipu,
                groupSide: null,
                lastTime: 0,
              };
            }
            const before = prev.lastLipu;
            if (!before) {
              return {
                ...prev,
                lastVersion: model.version,
                lastLipu: model.lipu,
              };
            }
            if (before === model.lipu) {
              // The production guard's
              // recovery re-adopts the model's OWN
              // lipu to repair the projection. The
              // version advances (the save must
              // fire), but there is nothing to undo
              // — recording it would mint a dead
              // entry whose undo restores the
              // corrupt doc for the guard to correct
              // again.
              return {
                ...prev,
                lastVersion: model.version,
                lastLipu: model.lipu,
              };
            }
            const side: Side = sync
              ? sync.originSide
              : "sp";
            // Latin selections ride the sync meta;
            // SP ones are read off the states.
            const selB: SelSnapshot | null =
              side === "latin" && sync
                ? sync.latinSelBefore
                : snapshotSel(oldState);
            const selA: SelSnapshot | null =
              side === "latin" && sync
                ? sync.latinSelAfter
                : snapshotSel(newState);
            const structural =
              before.blocks.length !==
              model.lipu.blocks.length;
            const paste =
              tr.getMeta(pasteHandlerKey) !==
              undefined;
            const now = Date.now();
            let done = prev.done;
            const coalesce =
              prev.groupSide === side &&
              !structural &&
              !paste &&
              now - prev.lastTime < NEW_GROUP_MS &&
              done.length > 0;
            if (coalesce) {
              const top = done[done.length - 1];
              done = [
                ...done.slice(0, -1),
                {
                  ...top,
                  lipuAfter: model.lipu,
                  selAfter: selA,
                },
              ];
            } else {
              done = [
                ...done,
                {
                  lipuBefore: before,
                  lipuAfter: model.lipu,
                  originSide: side,
                  selBefore: selB,
                  selAfter: selA,
                },
              ];
              if (done.length > HISTORY_DEPTH) {
                done = done.slice(
                  done.length - HISTORY_DEPTH
                );
              }
            }
            return {
              done,
              // any new edit retires the redo stack
              undone: [],
              lastVersion: model.version,
              lastLipu: model.lipu,
              // structural / paste CLOSE the group
              groupSide:
                structural || paste ? null : side,
              lastTime: now,
            };
          },
        },
      }),
    ];
  },
});

/** Keymap extension for the LATIN editor: routes
 *  Cmd+Z / Shift-Cmd+Z to the shared history, which
 *  lives in the SP editor. SCOPE: "Cmd+Z anywhere"
 *  means anywhere in the dual-pane document surface
 *  — NameInput's mini-editor keeps its own native
 *  history. */
export function latinHistoryKeymap(
  sp: TiptapEditor
): ReturnType<typeof Extension.create> {
  return Extension.create({
    name: "latinHistoryKeymap",
    addKeyboardShortcuts() {
      return {
        "Mod-z": () => sharedUndo(sp),
        "Shift-Mod-z": () => sharedRedo(sp),
        "Mod-y": () => sharedRedo(sp),
      };
    },
  });
}
