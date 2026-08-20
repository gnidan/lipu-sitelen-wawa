/**
 * PM doc positions <-> (block, offset) in the
 * per-block linearized units the lipu source maps
 * use. Exact because the render invariant
 * keeps the doc equal to renderSp(lipu) at all
 * times, and both sides count UTF-16 units with
 * breaks/atoms = 1.
 */

import type { Node as PmNode }
  from "@tiptap/pm/model";
import type { BlockPos } from "../lipu";

export function pmToBlockOffset(
  doc: PmNode,
  pos: number
): BlockPos | null {
  if (doc.childCount === 0) return null;
  const clamped = Math.max(
    0,
    Math.min(pos, doc.content.size)
  );
  const $pos = doc.resolve(clamped);
  if ($pos.depth === 0) {
    const i = $pos.index(0);
    // Past the last block (doc end): return
    // the end of the last block's content
    if (i >= doc.childCount) {
      const last = doc.childCount - 1;
      return {
        block: last,
        offset: doc.child(last).content.size,
      };
    }
    // Between blocks: snap to start of next
    return { block: i, offset: 0 };
  }
  return {
    block: $pos.index(0),
    offset: clamped - $pos.start(1),
  };
}

export function blockOffsetToPm(
  doc: PmNode,
  block: number,
  offset: number
): number {
  let pos = 0;
  const n = Math.min(block, doc.childCount);
  for (let i = 0; i < n; i++) {
    pos += doc.child(i).nodeSize;
  }
  return pos + 1 + offset;
}
