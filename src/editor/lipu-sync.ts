/**
 * The satellite sync protocol. A
 * transaction on the SP editor may carry
 * LIPU_SYNC_META: the model plugin ADOPTS the
 * carried lipu (never parses it) and the version
 * advances — including on Latin-LOCAL edits with
 * zero SP steps. LATIN_SYNC_META flags
 * reconcile transactions dispatched INTO the Latin
 * editor; the Latin plugins ignore them
 * symmetrically. minimalReplaceTr is the single
 * derived-steps builder used by edits, reconciles,
 * the production guard, and undo (steps keep PM
 * position mapping alive — never a wholesale
 * re-seed).
 *
 * LEAF MODULE, deliberately: lipu-model imports from
 * here, so nothing here may import lipu-model (the
 * repo has no cycle-breaking machinery). The
 * adoption guard that needs both lives in
 * sync-guard.ts.
 */

import type { JSONContent } from "@tiptap/core";
import type {
  EditorState,
  Transaction,
} from "@tiptap/pm/state";
import type {
  BlockPos,
  Lipu,
  Side,
} from "../lipu";

export interface SelSnapshot {
  anchor: BlockPos;
  head: BlockPos;
}

export interface LipuSyncMeta {
  lipu: Lipu;
  originSide: Side;
  origin: "edit" | "history";
  latinSelBefore: SelSnapshot | null;
  latinSelAfter: SelSnapshot | null;
}

export const LIPU_SYNC_META = "lipuSync";
export const LATIN_SYNC_META = "latinSync";

/** Cheap SHAPE CHECK, not a validation pass: the
 *  meta is adopted VERBATIM into the model and
 *  straight into storage, so a malformed one (an
 *  older satellite build, a stray setMeta) would
 *  corrupt the document silently in production,
 *  where the dev assertion is compiled out. Anything
 *  that is not recognizably a LipuSyncMeta is
 *  IGNORED with a warning — never adopted, and never
 *  thrown at the user mid-keystroke. */
function isLipuSyncMeta(
  value: unknown
): value is LipuSyncMeta {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const m = value as Partial<LipuSyncMeta>;
  const lipu = m.lipu as Partial<Lipu> | undefined;
  if (
    typeof lipu !== "object" ||
    lipu === null ||
    !Array.isArray(lipu.blocks)
  ) {
    return false;
  }
  if (
    m.originSide !== "sp" &&
    m.originSide !== "latin"
  ) {
    return false;
  }
  return (
    m.origin === "edit" || m.origin === "history"
  );
}

export function getLipuSync(
  tr: Transaction
): LipuSyncMeta | null {
  const raw = tr.getMeta(LIPU_SYNC_META) as unknown;
  if (raw === undefined || raw === null) return null;
  if (!isLipuSyncMeta(raw)) {
    console.warn(
      "lipu-sitelen-wawa: malformed lipuSync meta " +
        "ignored"
    );
    return null;
  }
  return raw;
}

/** DEV/TEST build? The dev-only adoption assertion
 *  is gated on this. Vite statically defines
 *  import.meta.env (vitest sets DEV true, the
 *  production bundle sets PROD true); the
 *  process.env fallback covers a plain-node
 *  consumer, where import.meta.env is absent. */
export function isDevBuild(): boolean {
  const env = (
    import.meta as ImportMeta & {
      env?: { PROD?: boolean };
    }
  ).env;
  if (env && typeof env.PROD === "boolean") {
    return !env.PROD;
  }
  const proc = (
    globalThis as {
      process?: {
        env?: Record<string, string | undefined>;
      };
    }
  ).process;
  return proc?.env?.NODE_ENV !== "production";
}

/**
 * STEPS, not a re-seed. The doc is replaced only
 * over the range that actually differs, so every
 * position outside it maps through unchanged (the
 * caret, decorations, and any concurrent plugin
 * state survive) — a wholesale setContent would
 * invalidate all of them and reset the history.
 *
 * The diff runs over the FULL inline stream, marks
 * included: Fragment.findDiffStart compares
 * node markup, so a verbatim MARK-only change is a
 * difference, and comparing text alone would let it
 * through unsynced.
 *
 * Returns null when the doc already equals the
 * target — the Latin-LOCAL case, where the carried
 * lipu differs only in bytes the SP side cannot
 * express.
 */
export function minimalReplaceTr(
  state: EditorState,
  content: JSONContent
): Transaction | null {
  const next = state.schema.nodeFromJSON(content);
  const cur = state.doc;
  const start = cur.content.findDiffStart(
    next.content
  );
  if (start === null) return null;
  const ends = cur.content.findDiffEnd(
    next.content
  )!;
  let { a: endA, b: endB } = ends;
  // findDiffStart/End can cross on repeated
  // content (PM's own prosemirror-view recipe)
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return state.tr.replace(
    start,
    endA,
    next.slice(start, endB)
  );
}
