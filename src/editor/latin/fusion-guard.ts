/**
 * FUSION GUARD. Lives in the
 * LATIN EDITOR LAYER at parse-input construction —
 * by the time a ParsedSide exists, parseLatin has
 * already fused the letters, and doc-merge is
 * PM-free and cannot read transactions.
 *
 * TRIGGER: any transaction in which an OLD
 * PARAGRAPH BOUNDARY DIED — enumerated by mapping
 * each old boundary through tr.mapping and keeping
 * those whose mapping reports deleted. That trigger
 * is COUNT-INDEPENDENT on purpose: keymap joins,
 * selection-deletes, drag-drop, paste-over-selection
 * AND equal-count reshapes all reach it, whereas a
 * paragraph-count decrease would miss the reshape
 * class (which is exactly the equal-count
 * paste-over-selection family the collapseSeamRuns
 * evidence guard cannot cover).
 *
 * The predicate is INLINE-AWARE: a seam whose flank
 * is a name chip is EXEMPT. A text-level predicate
 * would read the chip's SPELLING (a name renders as
 * letters) and inject a space that LAW A —
 * renderLatin/parseLatin round-tripping — would then
 * report as a counterexample, because the chip's
 * covered gap.latin is not where that space could
 * live.
 *
 * Injects " " at each dead-seam offset in the text
 * handed to parseLatin; the reconcile makes the
 * space visible; the caret lands AFTER it (the
 * caret-keeps-its-BlockPos rule, assoc 1 mapping).
 * Deleting the space later fuses the words into one
 * marked verbatim — an accepted, pinned behaviour,
 * not a bug.
 */

import type { Transaction } from "@tiptap/pm/state";
import type { Node as PmNode } from
  "@tiptap/pm/model";
import { pmToBlockOffset } from "../pm-coords";
import type { LatinInline } from "../../lipu";

/** Dead old-paragraph boundaries, as
 *  paragraph-index -> content offsets in the NEW
 *  doc (map coordinates). The flank position
 *  maps with assoc -1; both flanks of a deleted
 *  boundary collapse to the same seam position. */
export function deadSeamOffsets(
  tr: Transaction,
  oldDoc: PmNode,
  newDoc: PmNode
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let pos = 0;
  for (let i = 0; i < oldDoc.childCount - 1; i++) {
    pos += oldDoc.child(i).nodeSize;
    const r = tr.mapping.mapResult(pos, -1);
    if (!r.deleted) continue; // survived: not a seam
    const bp = pmToBlockOffset(newDoc, r.pos);
    if (!bp) continue;
    const list = out.get(bp.block) ?? [];
    list.push(bp.offset);
    out.set(bp.block, list);
  }
  return out;
}

const L_END = /[\p{L}\p{M}]$/u;
const L_START = /^\p{L}/u;

type Item =
  | { kind: "ch"; ch: string }
  | { kind: "atom"; inline: LatinInline };

/** Offsets are map content offsets: UTF-16 units,
 *  every atom exactly 1. The item list below is
 *  built in those units (a surrogate pair
 *  contributes its two halves), so `offsets` index
 *  it directly. */
export function injectFusionSpaces(
  inlines: LatinInline[],
  offsets: number[]
): LatinInline[] {
  const items: Item[] = [];
  for (const inline of inlines) {
    if (inline.type === "name") {
      items.push({ kind: "atom", inline });
      continue;
    }
    for (const ch of inline.text) {
      if (ch.length === 1) {
        items.push({ kind: "ch", ch });
      } else {
        items.push({ kind: "ch", ch: ch[0] });
        items.push({ kind: "ch", ch: ch[1] });
      }
    }
  }
  const sorted = [...offsets].sort((a, b) => b - a);
  let changed = false;
  for (const off of sorted) {
    if (off <= 0 || off >= items.length) continue;
    const left = items[off - 1];
    const right = items[off];
    if (
      left.kind === "atom" ||
      right.kind === "atom"
    ) {
      continue; // chip exemption
    }
    if (
      L_END.test(left.ch) &&
      L_START.test(right.ch)
    ) {
      items.splice(off, 0, { kind: "ch", ch: " " });
      changed = true;
    }
  }
  if (!changed) return inlines;
  const out: LatinInline[] = [];
  for (const it of items) {
    if (it.kind === "atom") {
      out.push(it.inline);
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.type === "text") {
      last.text += it.ch;
    } else {
      out.push({ type: "text", text: it.ch });
    }
  }
  return out;
}
