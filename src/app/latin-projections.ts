/**
 * Per-block projection cache. Memoized on the
 * Block object's identity: updateLipu's
 * incremental path preserves identity for
 * untouched blocks (blocks.slice() + per-index
 * replacement); the structural path rebuilds all
 * blocks (full recompute — accepted; pinned by
 * test).
 */

import { renderLatin, renderSp } from "../lipu";
import type {
  Block,
  BlockMaps,
  LatinInline,
  Lipu,
  SourceEntry,
} from "../lipu";

export interface BlockProjection {
  block: Block;
  inlines: LatinInline[];
  latinMap: SourceEntry[];
  spMap: SourceEntry[];
}

const cache = new WeakMap<
  Block,
  BlockProjection
>();

export function projectBlock(
  block: Block
): BlockProjection {
  const hit = cache.get(block);
  if (hit) return hit;
  const latin = renderLatin(block);
  const sp = renderSp(block);
  const proj: BlockProjection = {
    block,
    inlines: latin.inlines,
    latinMap: latin.map,
    spMap: sp.map,
  };
  cache.set(block, proj);
  return proj;
}

export function projectLipu(
  lipu: Lipu
): BlockProjection[] {
  return lipu.blocks.map(projectBlock);
}

export function blockMaps(
  projections: BlockProjection[]
): BlockMaps[] {
  return projections.map((p) => ({
    sp: p.spMap,
    latin: p.latinMap,
    spans: p.block.spans,
  }));
}

export function copyText(
  projections: BlockProjection[]
): string {
  return projections
    .map((p) =>
      p.inlines
        .map((inline) => inline.text)
        .join("")
    )
    .join("\n\n");
}
