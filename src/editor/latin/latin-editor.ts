/**
 * The satellite Latin editor.
 * Thin TipTap instance: input surface +
 * projection. This module owns its construction
 * and the SP->Latin reconcile loop: observed
 * via spEditor.on("transaction") AFTER the SP
 * dispatch chain (incl. appended transactions)
 * completes; the handler compares the Latin doc
 * to the renderLatin stream via a minimal
 * node-diff (structure-keyed — a text-keyed diff
 * is blind to node-kind changes like cartouche
 * promotion) and dispatches one sync-flagged
 * reconcile if unequal. Reconciles are never
 * parsed and cannot change the model, so the loop
 * terminates. Cross-editor dispatches happen ONLY
 * in on("transaction") handlers; an in-flight
 * flag collapses nested triggers; the whole body
 * runs in try/finally so the flag ALWAYS clears
 * (the error policy below).
 *
 * THE EDIT LOOP closes the other half. A
 * GENUINE Latin transaction (not sync-flagged, and
 * one that actually moved the doc) is classified
 * exactly as lipu-model classifies an SP one, parsed
 * with parseLatin (through the fusion guard),
 * merged with mergeLatinBlock / mergeStructural(...,
 * "latin"), and dispatched as ONE lipuSync
 * transaction on the SP editor. That dispatch's own
 * transaction handler is the reconcile above, which
 * runs synchronously and renders any divergence
 * (the fusion space, a seam collapse, a
 * crystallized split) back into the Latin doc with
 * the caret-keeps-its-BlockPos rule.
 *
 * TERMINATION, stated as the cycle it is: latin
 * keystroke -> processEdit -> SP lipuSync dispatch
 * (+ any SP-side appended transactions) ->
 * reconcile -> ONE sync-flagged latin transaction ->
 * onLatinTr sees LATIN_SYNC_META and returns. The
 * meta check is what makes the cycle finite; the
 * flags below only collapse nesting.
 */

import { Editor, Extension } from "@tiptap/core";
import type { Editor as TiptapEditor } from
  "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  Plugin,
  TextSelection,
} from "@tiptap/pm/state";
import type {
  EditorState,
  Transaction,
} from "@tiptap/pm/state";
import {
  ReplaceStep,
  ReplaceAroundStep,
} from "@tiptap/pm/transform";
import type { Node as PmNode } from
  "@tiptap/pm/model";
import {
  Decoration,
  DecorationSet,
} from "@tiptap/pm/view";
import { lipuModelKey } from
  "../extensions/lipu-model";
import { MirrorHighlight } from
  "../extensions/mirror-highlight";
import { BlockIndicators } from
  "../extensions/block-indicators";
import {
  LATIN_SYNC_META,
  LIPU_SYNC_META,
  minimalReplaceTr,
} from "../lipu-sync";
import type {
  LipuSyncMeta,
  SelSnapshot,
} from "../lipu-sync";
import { lipuToContent } from "../lipu-doc";
import { pmToBlockOffset } from "../pm-coords";
import { projectBlock } from
  "../../app/latin-projections";
import {
  emptyBlock,
  mergeLatinBlock,
  mergeStructural,
  parseLatin,
} from "../../lipu";
import type {
  Anchor,
  Block,
  Lipu,
  ParsedSide,
} from "../../lipu";
import { NameAtom } from "./name-atom";
import { latinPaste } from "./latin-paste";
import {
  latinDocContent,
  paragraphLatinInlines,
} from "./latin-doc";
import {
  deadSeamOffsets,
  injectFusionSpaces,
} from "./fusion-guard";
import {
  FORCE,
  latinLineBreaks,
  latinLineBreaksKey,
} from "./latin-line-breaks";
import { focusTracker } from "../focus-tracker";
import {
  latinHistoryKeymap,
  registerLatinEditor,
} from "../extensions/lipu-history";
import { pasteHandlerKey } from
  "../extensions/paste-handler";

export function latinAnchorClass(
  anchor: Anchor
): string {
  if (anchor.kind === "verbatim") {
    return (
      "latin-verbatim" +
      (anchor.marked ? "" : " latin-provisional")
    );
  }
  return "latin-word";
}

/** Anchor-class decorations derived from the
 *  model's latinMap (positions valid by the
 *  coordinate invariant).
 *  Read-only; recomputes per version.
 *
 *  GATING (the O(doc) recipe): skip the whole
 *  rebuild when neither the model VERSION nor the
 *  doc OBJECT changed — a mirror-highlight meta
 *  transaction, a caret move, or any redraw that
 *  leaves both alone reuses the cached set.
 *
 *  Paragraph starts are accumulated in the loop
 *  rather than re-derived per entry: blockOffsetToPm
 *  walks the doc from 0 every call, which would make
 *  this O(blocks * entries) on every keystroke.
 *  Positions are clamped to the paragraph's content
 *  size — a decorations prop that throws takes the
 *  whole view down, and the Latin doc can trail the
 *  model by one dispatch.
 *
 *  LEDGER (measured, happy-dom, 1000 blocks x 3
 *  anchors = 3000 decorations): this rebuild is
 *  ~4.5ms of the ~6.8ms the reconcile adds to a
 *  keystroke — the dominant typing-adjacent cost of
 *  the pane, and it is DecorationSet.create itself,
 *  not the projection (0.02ms) or the doc diff
 *  (~0.6ms). Ordinary documents are orders of
 *  magnitude smaller and the gate above skips the
 *  rebuild entirely for caret moves and mirror
 *  metas, so this is recorded, not fixed; the real
 *  fix is mapping the previous set through the
 *  reconcile instead of rebuilding, which needs
 *  per-block decoration ownership. WHOEVER BUILDS
 *  THAT must still handle version-changed /
 *  doc-UNCHANGED: these decorations are a function
 *  of the MODEL, not of the Latin doc, so a
 *  mapping-only strategy would reintroduce exactly
 *  the staleness the meta-only redraw below fixes
 *  (a verbatim mark toggle changes no Latin
 *  bytes). */
function latinDecorations(
  spEditor: TiptapEditor
): Plugin {
  let cacheVersion = -1;
  let cacheDoc: unknown = null;
  let cached = DecorationSet.empty;
  return new Plugin({
    props: {
      decorations(state) {
        if (spEditor.isDestroyed) {
          return DecorationSet.empty;
        }
        const st = lipuModelKey.getState(
          spEditor.state
        );
        if (!st) return DecorationSet.empty;
        if (
          st.version === cacheVersion &&
          cacheDoc === state.doc
        ) {
          return cached;
        }
        const decos: Decoration[] = [];
        const n = Math.min(
          state.doc.childCount,
          st.lipu.blocks.length
        );
        let pos = 0;
        for (let i = 0; i < n; i++) {
          const para = state.doc.child(i);
          const start = pos + 1;
          const limit = para.content.size;
          pos += para.nodeSize;
          const block = st.lipu.blocks[i];
          const proj = projectBlock(block);
          for (const e of proj.latinMap) {
            if (
              e.ref.seg !== "anchor" ||
              e.from === e.to
            ) {
              continue;
            }
            const anchor =
              block.anchors[e.ref.index];
            if (anchor === undefined) continue;
            const from = Math.min(e.from, limit);
            const to = Math.min(e.to, limit);
            if (from >= to) continue;
            decos.push(
              Decoration.inline(
                start + from,
                start + to,
                {
                  class:
                    latinAnchorClass(anchor),
                }
              )
            );
          }
        }
        cacheVersion = st.version;
        cacheDoc = state.doc;
        cached = DecorationSet.create(
          state.doc,
          decos
        );
        return cached;
      },
    },
  });
}

/** The Latin side's live sync flags. Exposed for
 *  tests (and only for tests): the loop reads them
 *  through the closure. */
export interface LatinSyncState {
  inFlight: boolean;
  composing: boolean;
  pendingEdit: boolean;
  /** Paste flag, queued half: a transaction QUEUED
   *  (mid-flight or under a composition) instead of
   *  processed carried the paste meta. The drain
   *  re-reads the doc whole, so the original
   *  transaction is gone by then — without this flag
   *  the paste's undo-group close is lost on exactly
   *  the paths that queue. */
  pendingPaste: boolean;
  pendingReconcile: boolean;
  reSeedQueued: boolean;
  /** test hook: makes the next genuine transaction
   *  — or the next composition flush — throw, to
   *  exercise the error policy on both paths. */
  forceError: boolean;
}

const syncStates = new WeakMap<
  TiptapEditor,
  LatinSyncState
>();

export function latinSyncState(
  latin: TiptapEditor
): LatinSyncState | undefined {
  return syncStates.get(latin);
}

/** Does this Latin transaction carry the paste
 *  meta the shared history keys its group-close on?
 *  One predicate for all three consumers (the direct
 *  path and the two queueing paths), so they cannot
 *  drift apart. */
const isPasteTr = (tr: Transaction): boolean =>
  tr.getMeta(pasteHandlerKey) !== undefined;

const flushFns = new WeakMap<
  TiptapEditor,
  () => void
>();

/** compositionend flush, exported for tests: the
 *  IME deferral's release valve. */
export function flushLatinEdits(
  latin: TiptapEditor
): void {
  flushFns.get(latin)?.();
}

export function createLatinEditor(
  spEditor: TiptapEditor
): TiptapEditor {
  const st = lipuModelKey.getState(
    spEditor.state
  );
  const DecoExtension = Extension.create({
    name: "latinDecorations",
    addProseMirrorPlugins() {
      return [latinDecorations(spEditor)];
    },
  });
  const state: LatinSyncState = {
    inFlight: false,
    composing: false,
    pendingEdit: false,
    pendingPaste: false,
    pendingReconcile: false,
    reSeedQueued: false,
    forceError: false,
  };
  const latin = new Editor({
    // Both panes are peers. Everything below —
    // the classify/merge/dispatch loop, the fusion
    // guard, the error policy — exists to make this
    // line safe.
    editable: true,
    extensions: [
      // DECLARED FIRST, matching the SP editor's
      // convention (Editor.tsx) and for the same
      // reason: TipTap REVERSES declaration order
      // when it builds the plugin list, so first-
      // declared runs LAST among same-priority user
      // extensions. Latin Enter is a FALLBACK — every
      // future UI Enter handler (Tasks 10/12 add
      // extensions to this very editor) must be able
      // to win over it — while it still beats the
      // CORE splitBlock keymap, which TipTap puts
      // behind all user extensions. Pinned by the
      // synthetic-keydown Enter tests: if this
      // ordering ever flips, Latin Enter silently
      // becomes a Block split (violating the
      // standing SP-join ruling) and those tests are
      // what fail.
      latinLineBreaks(spEditor, state),
      StarterKit.configure({
        history: false, // undo is lipu-layer
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        heading: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      NameAtom,
      // The plugin's own handlePaste tags its
      // transaction with pasteHandlerKey; the edit
      // loop below (processEdit/dispatchSync)
      // forwards that meta onto the SP dispatch so
      // the shared history closes its group on a
      // Latin paste.
      latinPaste(),
      MirrorHighlight,
      BlockIndicators,
      DecoExtension,
      // Cmd+Z anywhere in the dual-pane surface
      // reaches the ONE shared stack, which lives in
      // the SP editor. Declared LAST so its keymap
      // sorts FIRST (TipTap reverses), ahead of
      // anything StarterKit's core keymaps might
      // claim; native history has always been off
      // here.
      latinHistoryKeymap(spEditor),
    ],
    content: st
      ? latinDocContent(st.lipu)
      : { type: "doc", content: [] },
    editorProps: {
      attributes: {
        class: "latin-editor-content",
        // toki pona isn't in any browser dictionary;
        // native spellcheck flags every word.
        spellcheck: "false",
      },
    },
  });

  syncStates.set(latin, state);
  // The shared history restores a Latin-origin
  // selection into THIS pane while it is open, and
  // falls back to the SP-mirrored position once it
  // is not (the pairing is released on destroy,
  // below).
  registerLatinEditor(spEditor, latin);
  /** Re-entrancy guard for the RECONCILE only. It is
   *  deliberately NOT state.inFlight: the reconcile
   *  runs INSIDE processEdit's SP dispatch (that is
   *  how a divergence gets rendered back), so sharing
   *  the edit flag would silently disable the
   *  render-back half of the loop. */
  let reconciling = false;
  /** The last Latin state this handler has accounted
   *  for. It is the OLD doc for the next genuine
   *  transaction, and — because TipTap emits
   *  "transaction" once per dispatch with the
   *  ORIGINAL transaction while latin.state already
   *  holds every APPENDED step (crystallization!) —
   *  it is also the only reliable "did the doc
   *  actually move" test. */
  let prevState = latin.state;
  /** The model version the Latin side is DISPLAYING
   *  — doc content and decorations both. It is not
   *  enough to track the doc: the decorations read
   *  the MODEL (anchor kinds, verbatim marks), so a
   *  model change whose Latin projection is
   *  byte-identical — toggling a verbatim mark is
   *  exactly that — still has to reach the view, or
   *  the pane keeps showing e.g. latin-provisional
   *  on text that is now marked. That case has no
   *  steps to dispatch, so it rides a META-ONLY
   *  transaction purely to force the redraw. */
  let syncedVersion = st ? st.version : -1;

  /** Is EITHER side mid-composition? Both panes'
   *  composition deferrals suspend the same
   *  work, and a destroyed editor has no view to
   *  ask. */
  const anyComposing = (): boolean =>
    state.composing ||
    (!latin.isDestroyed && latin.view.composing) ||
    (!spEditor.isDestroyed && spEditor.view.composing);

  /** The error policy's recovery: throw away
   *  whatever the Latin
   *  doc holds and re-render it from the model, the
   *  last good state. Never a captured doc — the
   *  queued FLAG (state.reSeedQueued) is what makes
   *  this composition-safe. */
  const reSeed = (): void => {
    if (latin.isDestroyed || spEditor.isDestroyed) {
      return;
    }
    const model = lipuModelKey.getState(
      spEditor.state
    );
    if (!model) return;
    const tr = minimalReplaceTr(
      latin.state,
      latinDocContent(model.lipu)
    );
    if (tr) {
      tr.setMeta(LATIN_SYNC_META, true);
      tr.setMeta("addToHistory", false);
      latin.view.dispatch(tr);
    }
    syncedVersion = model.version;
  };

  const selSnapshot = (
    s: EditorState
  ): SelSnapshot | null => {
    const a = pmToBlockOffset(
      s.doc,
      s.selection.anchor
    );
    const h = pmToBlockOffset(
      s.doc,
      s.selection.head
    );
    return a && h ? { anchor: a, head: h } : null;
  };

  /** Classify exactly as lipu-model's analyze does
   *  for the SP side: a block-count change or any
   *  block-touching step is structural, everything
   *  else is an inline range in NEW-doc
   *  coordinates. */
  const classify = (
    tr: Transaction,
    newDoc: PmNode,
    oldDoc: PmNode
  ):
    | { structural: true }
    | { structural: false; from: number; to: number } => {
    if (newDoc.childCount !== oldDoc.childCount) {
      return { structural: true };
    }
    // APPENDED STEPS (crystallization) are not in
    // tr.steps, so tr's own coordinates no longer
    // describe the doc we are about to parse. Fall
    // back to the whole-doc path rather than merge
    // against a range that has moved.
    if (!tr.doc.eq(newDoc)) {
      return { structural: true };
    }
    let from = Infinity;
    let to = -Infinity;
    for (let i = 0; i < tr.steps.length; i++) {
      const step = tr.steps[i];
      if (
        !(step instanceof ReplaceStep) &&
        !(step instanceof ReplaceAroundStep)
      ) {
        return { structural: true };
      }
      const slice = step.slice;
      if (
        slice.openStart > 0 ||
        slice.openEnd > 0 ||
        (slice.content.firstChild !== null &&
          slice.content.firstChild.isBlock)
      ) {
        return { structural: true };
      }
      const own = step.getMap();
      let f = own.map(step.from, -1);
      let t = own.map(step.to, 1);
      const rest = tr.mapping.slice(i + 1);
      f = rest.map(f, -1);
      t = rest.map(t, 1);
      from = Math.min(from, f);
      to = Math.max(to, t);
    }
    if (from === Infinity) {
      return { structural: true };
    }
    return { structural: false, from, to };
  };

  /** One lipuSync dispatch carrying the merged
   *  model. minimalReplaceTr derives the SP steps;
   *  a Latin-LOCAL edit derives NONE, and the
   *  meta-only transaction is what advances the
   *  version. `paste` forwards the paste meta
   *  from the ORIGINAL Latin transaction onto this
   *  freshly-built SP transaction — lipu-history
   *  reads the meta off whatever transaction it
   *  actually observes (this one, dispatched on the
   *  SP editor), so without the forward a Latin
   *  paste would silently coalesce into adjacent
   *  typing instead of closing the undo group. */
  const dispatchSync = (
    newLipu: Lipu,
    before: SelSnapshot | null,
    after: SelSnapshot | null,
    paste = false
  ): void => {
    if (spEditor.isDestroyed) return;
    const spTr =
      minimalReplaceTr(
        spEditor.state,
        lipuToContent(newLipu)
      ) ?? spEditor.state.tr;
    spTr.setMeta(LIPU_SYNC_META, {
      lipu: newLipu,
      originSide: "latin",
      origin: "edit",
      latinSelBefore: before,
      latinSelAfter: after,
    } satisfies LipuSyncMeta);
    if (paste) {
      spTr.setMeta(pasteHandlerKey, { paste: true });
    }
    spEditor.view.dispatch(spTr);
    // The SP transaction handler (reconcile, below)
    // runs synchronously inside that dispatch and
    // renders any divergence back into the Latin
    // doc.
  };

  const processEdit = (
    tr: Transaction,
    oldSt: EditorState,
    newSt: EditorState
  ): void => {
    if (spEditor.isDestroyed) return;
    const model = lipuModelKey.getState(
      spEditor.state
    );
    if (!model) return;
    const newDoc = newSt.doc;
    const res = classify(tr, newDoc, oldSt.doc);
    // The fusion guard's seam offsets come out of
    // tr.mapping, so they only mean anything while
    // tr's coordinates still describe newDoc — the
    // same condition classify checks above.
    const seams = tr.doc.eq(newDoc)
      ? deadSeamOffsets(tr, oldSt.doc, newDoc)
      : new Map<number, number[]>();
    const parseParagraph = (b: number): ParsedSide => {
      let inlines = paragraphLatinInlines(
        newDoc.child(b)
      );
      const offs = seams.get(b);
      if (offs) {
        inlines = injectFusionSpaces(inlines, offs);
      }
      return parseLatin(inlines);
    };
    let blocks: Block[];
    if (
      !res.structural &&
      newDoc.childCount === model.lipu.blocks.length
    ) {
      const clamp = (p: number): number =>
        Math.max(
          0,
          Math.min(p, newDoc.content.size)
        );
      const $f = newDoc.resolve(clamp(res.from));
      const $t = newDoc.resolve(clamp(res.to));
      const startBlock =
        $f.depth === 0
          ? Math.max(0, $f.index(0) - 1)
          : $f.index(0);
      const endBlock =
        $t.depth === 0
          ? Math.min(
              newDoc.childCount - 1,
              $t.index(0)
            )
          : $t.index(0);
      blocks = model.lipu.blocks.slice();
      for (
        let b = startBlock;
        b <= endBlock && b < newDoc.childCount;
        b++
      ) {
        blocks[b] = mergeLatinBlock(
          blocks[b] ?? emptyBlock(),
          parseParagraph(b)
        );
      }
    } else {
      const sides: ParsedSide[] = [];
      for (let b = 0; b < newDoc.childCount; b++) {
        sides.push(parseParagraph(b));
      }
      blocks = mergeStructural(
        model.lipu.blocks,
        sides,
        "latin"
      );
    }
    dispatchSync(
      { version: 2, blocks },
      selSnapshot(oldSt),
      selSnapshot(newSt),
      isPasteTr(tr)
    );
  };

  /** The DRAIN pass: the composed input, or a
   *  mid-flight arrival, processed as ONE full-doc
   *  pass. The per-tr seam mapping is gone by then,
   *  which costs nothing — a composition does not kill
   *  paragraph boundaries.
   *
   *  `paste` is the queued paste flag (state
   *  .pendingPaste): the original transaction's meta
   *  cannot be read here — this pass re-reads the doc,
   *  it does not replay the transaction — so the flag
   *  is what carries the undo-group close onto the SP
   *  dispatch. Without it a paste that happens to
   *  arrive mid-flight (or under an IME) silently
   *  coalesces into adjacent typing — the same
   *  group-close hole the direct path closes with
   *  the meta forward. */
  const processFull = (paste = false): void => {
    if (latin.isDestroyed || spEditor.isDestroyed) {
      return;
    }
    if (state.forceError) {
      throw new Error("latin sync test error");
    }
    const model = lipuModelKey.getState(
      spEditor.state
    );
    if (!model) return;
    const newDoc = latin.state.doc;
    const sides: ParsedSide[] = [];
    for (let b = 0; b < newDoc.childCount; b++) {
      sides.push(
        parseLatin(
          paragraphLatinInlines(newDoc.child(b))
        )
      );
    }
    const blocks =
      newDoc.childCount === model.lipu.blocks.length
        ? model.lipu.blocks.map((pb, i) =>
            mergeLatinBlock(pb, sides[i])
          )
        : mergeStructural(
            model.lipu.blocks,
            sides,
            "latin"
          );
    dispatchSync(
      { version: 2, blocks },
      null,
      selSnapshot(latin.state),
      paste
    );
  };

  const reconcile = (): void => {
    if (reconciling) return;
    reconciling = true;
    try {
      if (latin.isDestroyed || spEditor.isDestroyed) {
        return;
      }
      const model = lipuModelKey.getState(
        spEditor.state
      );
      if (!model) return;
      // The gate: nothing the Latin side displays
      // can have changed if the model version did
      // not move (caret moves, mirror metas, any
      // no-op transaction).
      if (model.version === syncedVersion) return;
      // NEVER re-seed under a live IME session
      // (either side composing): replacing the
      // text node
      // the browser is composing into loses the
      // pending characters, and even a
      // decoration-only redraw can disturb it. The
      // model is what saves, so a few frames of
      // stale projection cost nothing. The pending
      // flag is released by the compositionend
      // flush.
      if (state.composing || latin.view.composing) {
        state.pendingReconcile = true;
        return;
      }
      const replace = minimalReplaceTr(
        latin.state,
        latinDocContent(model.lipu)
      );
      // No steps means the projection is unchanged
      // but the MODEL moved: dispatch a meta-only
      // transaction so the decorations recompute
      // (see syncedVersion above).
      const hasSteps =
        replace !== null && replace.steps.length > 0;
      const tr = hasSteps
        ? replace!
        : latin.state.tr;
      if (hasSteps) {
        // The caret keeps its BlockPos. Content
        // the render-back inserts AT the caret — the
        // fusion space is exactly that — lands
        // BEFORE it (assoc 1), so the caret ends up
        // immediately AFTER the injected space
        // rather than stranded in front of it.
        const sel = latin.state.selection;
        const size = tr.doc.content.size;
        const $a = tr.doc.resolve(
          Math.min(tr.mapping.map(sel.anchor, 1), size)
        );
        const $h = tr.doc.resolve(
          Math.min(tr.mapping.map(sel.head, 1), size)
        );
        tr.setSelection(TextSelection.between($a, $h));
      }
      tr.setMeta(LATIN_SYNC_META, true);
      tr.setMeta("addToHistory", false);
      latin.view.dispatch(tr);
      syncedVersion = model.version;
    } finally {
      reconciling = false;
    }
  };

  /** The error policy for paths run from a DOM
   *  event
   *  handler (compositionend): an escaping throw
   *  there is unlogged and unrecoverable, so every
   *  call the flush makes is wrapped. */
  const guarded = (fn: () => void): boolean => {
    try {
      fn();
      return true;
    } catch (e) {
      console.error(
        "lipu-sitelen-wawa: latin sync failed; " +
          "re-seeding from model",
        e
      );
      return false;
    }
  };

  const flush = (): void => {
    if (latin.isDestroyed) return;
    if (state.reSeedQueued) {
      // A failed sync outranks anything queued: the
      // doc is untrusted until it comes back from
      // the model. The flag is cleared only if the
      // re-seed actually lands — losing the recovery
      // to a throw would leave the untrusted doc
      // standing with nothing left to fix it.
      state.pendingEdit = false;
      state.pendingPaste = false;
      state.pendingReconcile = false;
      if (guarded(reSeed)) {
        state.reSeedQueued = false;
      }
      prevState = latin.state;
      return;
    }
    if (state.pendingEdit) {
      state.pendingEdit = false;
      // consumed HERE, not inside processFull: the
      // recovery below re-seeds from the model, and a
      // flag left standing would tag the NEXT
      // unrelated drain as a paste.
      const paste = state.pendingPaste;
      state.pendingPaste = false;
      state.inFlight = true;
      try {
        if (!guarded(() => processFull(paste))) {
          guarded(reSeed);
        }
      } finally {
        state.inFlight = false;
        prevState = latin.state;
      }
    }
    if (state.pendingReconcile) {
      state.pendingReconcile = false;
      guarded(reconcile);
    }
  };
  flushFns.set(latin, flush);

  const onLatinTr = ({
    transaction,
  }: {
    transaction: Transaction;
  }): void => {
    const oldSt = prevState;
    prevState = latin.state;
    if (latin.isDestroyed) return;
    // LOOP BREAKER (the reverse direction's half):
    // a reconcile/re-seed is this module's own
    // render of the model — never an edit, never
    // parsed back.
    if (
      transaction.getMeta(LATIN_SYNC_META) !==
      undefined
    ) {
      return;
    }
    // NOT transaction.docChanged: an appended
    // crystallization split rides a SELECTION-only
    // transaction, and gating on the original
    // transaction would drop it on the floor.
    if (oldSt.doc === latin.state.doc) return;
    if (state.inFlight) {
      // A GENUINE transaction arriving mid-flight
      // must never be dropped: prevState has already
      // advanced past it, so no later merge would
      // ever see it and the model would diverge from
      // the doc silently — feeding the decorations
      // and the mirror a projection of bytes that no
      // longer exist. Queue it; the drain in the
      // finally below (or the compositionend flush)
      // re-reads the doc whole.
      state.pendingEdit = true;
      state.pendingPaste ||= isPasteTr(transaction);
      return;
    }
    state.inFlight = true;
    try {
      if (state.forceError) {
        throw new Error("latin sync test error");
      }
      if (anyComposing()) {
        // Either side composing: latest queued,
        // flushed at the relevant compositionend.
        // Only a FLAG is queued — the doc is read
        // fresh at flush time.
        state.pendingEdit = true;
        state.pendingPaste ||= isPasteTr(transaction);
        return;
      }
      processEdit(transaction, oldSt, latin.state);
    } catch (e) {
      // ERROR POLICY: the model keeps its last
      // good state (saves stay correct); the failed
      // keystroke is lost; nothing else is.
      // Composition-safe: a RE-SEED FLAG is queued,
      // never a captured doc.
      console.error(
        "lipu-sitelen-wawa: latin sync failed; " +
          "re-seeding from model",
        e
      );
      state.pendingEdit = false;
      state.pendingPaste = false;
      if (state.composing) {
        state.reSeedQueued = true;
      } else {
        reSeed();
      }
    } finally {
      state.inFlight = false;
      prevState = latin.state;
      // Drain a mid-flight arrival now that the loop
      // is idle. A composition owns its own flush, so
      // leave the flag for compositionend there.
      if (state.pendingEdit && !anyComposing()) {
        flush();
      }
    }
  };

  const onCompStart = (): void => {
    state.composing = true;
  };
  const onCompEnd = (): void => {
    state.composing = false;
    flush();
  };
  const latinDom = latin.view.dom;
  latinDom.addEventListener(
    "compositionstart",
    onCompStart
  );
  latinDom.addEventListener(
    "compositionend",
    onCompEnd
  );
  // An edit deferred because the SP editor was
  // composing flushes at ITS compositionend.
  const spDom = spEditor.view.dom;
  spDom.addEventListener("compositionend", flush);

  /** FOCUS. The satellite's half
   *  of the tracker: its focus is what suspends the
   *  SP side's dwell evaluation, and its TRUE blur
   *  is what crystallizes a pending Latin run.
   *  Blur-to-PEER carries the run — the
   *  settle is the first moment the two are
   *  distinguishable. Composition is re-checked
   *  AT the settle, exactly as the SP handler does:
   *  a run left under a live IME waits for the
   *  composition's own commit. */
  const onFocus = (): void =>
    focusTracker.notifyFocus("latin");
  const onBlur = (): void => {
    focusTracker.notifyBlur("latin", (now) => {
      if (now !== null) return;
      if (latin.isDestroyed) return;
      if (state.composing || latin.view.composing) {
        return;
      }
      latin.view.dispatch(
        latin.state.tr.setMeta(
          latinLineBreaksKey,
          FORCE
        )
      );
    });
  };
  latin.on("focus", onFocus);
  latin.on("blur", onBlur);

  latin.on("transaction", onLatinTr);
  spEditor.on("transaction", reconcile);
  latin.on("destroy", () => {
    registerLatinEditor(spEditor, null);
    spEditor.off("transaction", reconcile);
    latinDom.removeEventListener(
      "compositionstart",
      onCompStart
    );
    latinDom.removeEventListener(
      "compositionend",
      onCompEnd
    );
    spDom.removeEventListener(
      "compositionend",
      flush
    );
  });
  return latin;
}
