import React, {
  useEffect,
  useRef,
  useState,
} from "react";
import { EditorContent } from "@tiptap/react";
import type { Editor as TiptapEditor }
  from "@tiptap/core";
import type { Node as PmNode }
  from "@tiptap/pm/model";
import type { Transaction }
  from "@tiptap/pm/state";
import {
  lipuModelKey,
} from "../editor/extensions/lipu-model";
import { LATIN_SYNC_META } from
  "../editor/lipu-sync";
import {
  blockOffsetToPm,
  pmToBlockOffset,
} from "../editor/pm-coords";
import {
  setMirrorHighlights,
} from "../editor/extensions/mirror-highlight";
import {
  activeBlockIndex,
  setActiveBlock,
} from "../editor/extensions/block-indicators";
import type {
  MirrorRangePm,
} from "../editor/extensions/mirror-highlight";
import {
  createLatinEditor,
} from "../editor/latin/latin-editor";
import { focusTracker } from
  "../editor/focus-tracker";
import { mirrorRange } from "../lipu";
import type { MirrorResult } from "../lipu";
import {
  blockMaps,
  projectLipu,
} from "./latin-projections";

/**
 * Converts a mirrorRange() result (block-relative
 * lipu coordinates) into PM decoration ranges.
 * DOC-GENERIC: it works on the SP doc and on the
 * Latin doc alike, because the coordinate
 * invariant makes block offsets mean the same
 * thing in both. Exported for direct unit testing.
 *
 * TRAILING-DOC SAFE. The result is computed from
 * the MODEL, but the ranges land in a DOC, and the
 * two can disagree for a dispatch: the satellite
 * editor's reconcile defers under a live IME
 * session, so its doc can hold fewer paragraphs (or
 * shorter ones) than the model describes. An
 * out-of-range block would throw a RangeError out
 * of doc.child() — inside an SP event handler,
 * mid-dispatch. Blocks the doc does not have are
 * skipped; offsets are clamped to the block's
 * content size.
 */
export function buildMirrorRanges(
  doc: PmNode,
  result: MirrorResult
): MirrorRangePm[] {
  const out: MirrorRangePm[] = [];
  for (const h of result.inline) {
    if (h.block < 0 || h.block >= doc.childCount) {
      continue;
    }
    const limit = doc.child(h.block).content.size;
    const start = blockOffsetToPm(doc, h.block, 0);
    out.push({
      from: start + Math.min(h.from, limit),
      to: start + Math.min(h.to, limit),
    });
  }
  for (const bi of result.wholeBlocks) {
    if (bi < 0 || bi >= doc.childCount) continue;
    const start = blockOffsetToPm(doc, bi, 0);
    out.push({
      from: start,
      to: start + doc.child(bi).content.size,
    });
  }
  return out;
}

export interface LatinPaneProps {
  editor: TiptapEditor | null;
  /** Same convention as <Editor onEditorReady>:
   *  hands the satellite instance out (and null on
   *  teardown) so the app — and the tests — can
   *  reach it. */
  onLatinEditorReady?: (
    editor: TiptapEditor | null
  ) => void;
}

/**
 * Hosts the satellite Latin editor. The
 * pane no longer renders spans of its own: the
 * Latin projection IS a ProseMirror doc now, kept
 * in step with the model by createLatinEditor's
 * reconcile, and selection mirroring runs through
 * both editors' NATIVE selections in both
 * directions (the resolvePoint/selectionchange DOM
 * machinery is retired — the coordinate invariant
 * is what makes
 * pmToBlockOffset valid on the Latin doc).
 */
export function LatinPane({
  editor,
  onLatinEditorReady,
}: LatinPaneProps) {
  const [latinEditor, setLatinEditor] =
    useState<TiptapEditor | null>(null);

  const readyRef = useRef(onLatinEditorReady);
  readyRef.current = onLatinEditorReady;

  useEffect(() => {
    if (!editor) return;
    const le = createLatinEditor(editor);
    setLatinEditor(le);
    readyRef.current?.(le);
    return () => {
      setLatinEditor(null);
      readyRef.current?.(null);
      le.destroy();
    };
  }, [editor]);

  // SP-focused -> Latin-pane mirror (decorations
  // in the LATIN editor now). Both handlers read
  // plugin state FRESH at event time: plugin state
  // and doc are always mutually consistent there,
  // while a render-time value can trail the doc by
  // a commit.
  useEffect(() => {
    if (!editor || !latinEditor) return;
    const update = () => {
      if (latinEditor.isDestroyed) return;
      const sel = editor.state.selection;
      const st = lipuModelKey.getState(
        editor.state
      );
      if (sel.empty || !st) {
        setMirrorHighlights(latinEditor, []);
        return;
      }
      const doc = editor.state.doc;
      const a = pmToBlockOffset(doc, sel.from);
      const b = pmToBlockOffset(doc, sel.to);
      if (!a || !b) {
        setMirrorHighlights(latinEditor, []);
        return;
      }
      const result = mirrorRange(
        blockMaps(projectLipu(st.lipu)),
        "sp",
        a,
        b
      );
      setMirrorHighlights(
        latinEditor,
        buildMirrorRanges(
          latinEditor.state.doc,
          result
        )
      );
    };
    update();
    editor.on("selectionUpdate", update);
    editor.on("update", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("update", update);
    };
  }, [editor, latinEditor]);

  // Latin-focused -> SP-pane mirror via the latin
  // editor's NATIVE selection.
  //
  // DELIBERATE SUPPRESSION. A reconcile
  // re-maps whatever selection the Latin editor is
  // holding, which fires selectionUpdate — and a
  // reconcile runs INSIDE the SP editor's own
  // transaction handler, so mirroring it would
  // dispatch a second SP transaction re-entrantly,
  // mid-dispatch, and would light up BOTH panes at
  // once (the SP-direction handler is already
  // setting the Latin highlights for the gesture
  // that caused the reconcile). A render-back is
  // not a selection GESTURE; only a real one drives
  // the mirror. The leftover Latin highlight simply
  // stands until the next gesture — accepted, and
  // strictly better than a mirror of a selection
  // nobody moved.
  useEffect(() => {
    if (!editor || !latinEditor) return;
    const update = ({
      transaction,
    }: {
      transaction: Transaction;
    }) => {
      if (editor.isDestroyed) return;
      if (
        transaction.getMeta(LATIN_SYNC_META) !==
        undefined
      ) {
        return;
      }
      const sel = latinEditor.state.selection;
      const st = lipuModelKey.getState(
        editor.state
      );
      if (sel.empty || !st) {
        setMirrorHighlights(editor, []);
        return;
      }
      const doc = latinEditor.state.doc;
      const a = pmToBlockOffset(doc, sel.from);
      const b = pmToBlockOffset(doc, sel.to);
      if (!a || !b) {
        setMirrorHighlights(editor, []);
        return;
      }
      const result = mirrorRange(
        blockMaps(projectLipu(st.lipu)),
        "latin",
        a,
        b
      );
      setMirrorHighlights(
        editor,
        buildMirrorRanges(
          editor.state.doc,
          result
        )
      );
    };
    latinEditor.on("selectionUpdate", update);
    return () => {
      latinEditor.off(
        "selectionUpdate",
        update
      );
      if (!editor.isDestroyed) {
        setMirrorHighlights(editor, []);
      }
    };
  }, [editor, latinEditor]);

  // Block indicator cross-pane sync: the focused
  // pane sends its active block index to the other
  // pane so both gutters emphasize the same block.
  // Focus events trigger an immediate sync so the
  // bars update without waiting for a cursor move.
  useEffect(() => {
    if (!editor || !latinEditor) return;
    // SP -> Latin: propagate on selection/doc
    // change, gated by focus.
    const spUpdate = () => {
      if (latinEditor.isDestroyed) return;
      if (focusTracker.focused() !== "sp") return;
      const active =
        activeBlockIndex(editor.state);
      setActiveBlock(latinEditor, active);
    };
    // Latin -> SP: filter reconcile-induced
    // selection changes (same guard as the
    // mirror-highlight direction).
    const latinUpdate = ({
      transaction,
    }: {
      transaction: Transaction;
    }) => {
      if (editor.isDestroyed) return;
      if (
        transaction.getMeta(LATIN_SYNC_META) !==
        undefined
      ) {
        return;
      }
      if (
        focusTracker.focused() !== "latin"
      ) {
        return;
      }
      const active =
        activeBlockIndex(latinEditor.state);
      setActiveBlock(editor, active);
    };
    // Immediate sync on focus change so the bars
    // update without waiting for a cursor move.
    const onSpFocus = () => {
      if (latinEditor.isDestroyed) return;
      const active =
        activeBlockIndex(editor.state);
      setActiveBlock(latinEditor, active);
    };
    const onLatinFocus = () => {
      if (editor.isDestroyed) return;
      const active =
        activeBlockIndex(latinEditor.state);
      setActiveBlock(editor, active);
    };
    editor.on("selectionUpdate", spUpdate);
    editor.on("update", spUpdate);
    editor.on("focus", onSpFocus);
    latinEditor.on(
      "selectionUpdate", latinUpdate
    );
    latinEditor.on("focus", onLatinFocus);
    // Initial sync.
    spUpdate();
    return () => {
      editor.off("selectionUpdate", spUpdate);
      editor.off("update", spUpdate);
      editor.off("focus", onSpFocus);
      latinEditor.off(
        "selectionUpdate", latinUpdate
      );
      latinEditor.off("focus", onLatinFocus);
    };
  }, [editor, latinEditor]);

  // A TRUE blur (the settle reports no pane
  // focused — click on the page background, not a
  // pane hop) clears the mirrored highlight in BOTH
  // editors, so the mirror's lifetime matches the
  // source selection's VISIBLE lifetime: the browser
  // stops painting the source's native selection at
  // that same moment. Both, not just the peer: a
  // carried highlight (the suppression above)
  // lives in the
  // pane that was hopped INTO, so a later true blur
  // from that pane must reach it too. Blur-to-peer
  // settles non-null and keeps the carry; the
  // suppressNext arm classifies an undo-induced
  // blur
  // as-if-to-peer, so undo never clears the mirror
  // as a side effect.
  //
  // CONSTRAINT (accepted): a window blur (cmd-tab
  // away) is a true blur too, so the mirror clears —
  // and it is NOT restored when the window regains
  // focus, because refocus repaints the source's
  // native selection without dispatching any
  // selectionUpdate. The mirror returns on the next
  // selection gesture.
  useEffect(() => {
    if (!editor || !latinEditor) return;
    const onSettle = (
      now: "sp" | "latin" | null
    ) => {
      if (now !== null) return;
      if (!editor.isDestroyed) {
        setMirrorHighlights(editor, []);
        setActiveBlock(editor, -1);
      }
      if (!latinEditor.isDestroyed) {
        setMirrorHighlights(latinEditor, []);
        setActiveBlock(latinEditor, -1);
      }
    };
    const onSpBlur = () => {
      focusTracker.notifyBlur("sp", onSettle);
    };
    const onLatinBlur = () => {
      focusTracker.notifyBlur("latin", onSettle);
    };
    editor.on("blur", onSpBlur);
    latinEditor.on("blur", onLatinBlur);
    return () => {
      editor.off("blur", onSpBlur);
      latinEditor.off("blur", onLatinBlur);
    };
  }, [editor, latinEditor]);

  return (
    <div className="latin-pane">
      <div className="latin-pane__body">
        {latinEditor && (
          <EditorContent editor={latinEditor} />
        )}
      </div>
    </div>
  );
}
