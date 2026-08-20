/**
 * The production projection guard,
 * post-dispatch-chain.
 *
 * Separate module so lipu-sync stays a LEAF:
 * lipu-model imports lipu-sync, and the guard needs
 * lipu-model, so putting it there would close an
 * import cycle.
 *
 * RECOVERY IS INVISIBLE AND ONE-SHOT.
 * The correction is a repair of a state the user
 * never asked for, so it (a) never enters the undo
 * stack — addToHistory: false, or Ctrl-Z restores
 * the corrupt projection and the guard re-corrects
 * it, giving the user a dead undo step and a warn
 * loop; (b) never dispatches a zero-step
 * transaction — Transform.replace returns `this`
 * even when the fit yields nothing, so a zero-step
 * result would change nothing, re-enter the guard,
 * and recurse to stack death on the save path; and
 * (c) never re-enters itself (the `correcting`
 * flag). (b) and (c) are belt and braces on purpose:
 * one-shot-ness is structural here, not an accident
 * of what the diff happens to produce.
 *
 * RECOVERY DEFERS TO COMPOSITION END; NEVER ABORT A
 * LIVE IME SESSION.
 * Replacing the text node under an open composition
 * is the classic collab hazard: the browser's IME
 * loses its anchor and the pending characters land
 * somewhere else, or vanish. The MODEL is already
 * safe — it is what saves — so waiting for
 * compositionend costs nothing but a few frames of a
 * stale projection.
 */

import type { Editor as TiptapEditor } from
  "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { renderSp } from "../lipu";
import { lipuModelKey } from
  "./extensions/lipu-model";
import { lipuToContent } from "./lipu-doc";
import {
  LIPU_SYNC_META,
  minimalReplaceTr,
} from "./lipu-sync";
import type { LipuSyncMeta } from "./lipu-sync";
import type { SpInline } from "../lipu";

function spLength(inlines: SpInline[]): number {
  let n = 0;
  for (const i of inlines) {
    n += i.type === "break" ? 1 : i.text.length;
  }
  return n;
}

/** The production guard: cheap per-paragraph text
 *  length comparison after every dispatch chain.
 *  On mismatch the MODEL WINS — the SP doc is
 *  re-derived from renderSp(lipu) via derived
 *  steps (recover, don't corrupt: lipuToContent
 *  (lipu) is what saves, so the model is what must
 *  be displayed). Departure from the seed gate's
 *  verify-everything rule, justified by same-tick
 *  construction provenance; this guard bounds the
 *  damage of being wrong. */
export let adoptionMismatches = 0;

/** Re-entrancy latch: the correction dispatch runs
 *  the whole transaction chain, which calls back
 *  into this guard. */
let correcting = false;

/** Views with a compositionend re-check pending. */
const awaitingComposition = new WeakSet<EditorView>();

function deferToCompositionEnd(
  editor: TiptapEditor
): void {
  const view = editor.view;
  if (awaitingComposition.has(view)) return;
  awaitingComposition.add(view);
  const onEnd = (): void => {
    view.dom.removeEventListener(
      "compositionend",
      onEnd
    );
    awaitingComposition.delete(view);
    verifySpProjection(editor);
  };
  view.dom.addEventListener("compositionend", onEnd);
}

/** KNOWN COST (recorded, not built): this
 *  runs O(doc) work — renderSp per block — on EVERY
 *  transaction, caret moves included. The gating
 *  recipe, when someone owns it: skip when neither
 *  the doc OBJECT nor the model VERSION changed
 *  since the last verification, capturing that
 *  comparison BEFORE the correction dispatch (or
 *  placing it after the version check), so the
 *  correction's own re-entry still verifies clean.
 *  The satellite editor's decoration plugin
 *  (editor/latin/latin-editor.ts) implements the
 *  same recipe and can serve as the reference. */
export function verifySpProjection(
  editor: TiptapEditor
): boolean {
  const st = lipuModelKey.getState(editor.state);
  if (!st) return true;
  const doc = editor.state.doc;
  const blocks = st.lipu.blocks;
  let ok = doc.childCount === blocks.length;
  if (ok) {
    for (let i = 0; i < blocks.length; i++) {
      const want = spLength(
        renderSp(blocks[i]).inlines
      );
      if (doc.child(i).content.size !== want) {
        ok = false;
        break;
      }
    }
  }
  if (ok) return true;

  const view = editor.view;
  // Already waiting on an IME session: stay quiet
  // rather than warn once per keystroke.
  if (awaitingComposition.has(view)) return false;

  adoptionMismatches += 1;
  console.warn(
    "lipu-sitelen-wawa: adoption guard " +
      "mismatch; model wins"
  );

  if (view.composing) {
    deferToCompositionEnd(editor);
    return false;
  }
  if (correcting) return false;

  const tr = minimalReplaceTr(
    editor.state,
    lipuToContent(st.lipu)
  );
  // A zero-step transaction would change nothing and
  // bring the guard straight back here.
  if (!tr || tr.steps.length === 0) return false;
  // Flagged as an adoption of the SAME lipu: the
  // correction must not send the doc back through
  // the parse (that would let the corrupted doc
  // rewrite the model it just lost to).
  tr.setMeta(LIPU_SYNC_META, {
    lipu: st.lipu,
    originSide: "sp",
    origin: "edit",
    latinSelBefore: null,
    latinSelAfter: null,
  } satisfies LipuSyncMeta);
  tr.setMeta("addToHistory", false);
  correcting = true;
  try {
    view.dispatch(tr);
  } finally {
    correcting = false;
  }
  return false;
}
