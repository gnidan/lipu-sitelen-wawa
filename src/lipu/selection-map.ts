/**
 * Pure selection-mirroring math over this
 * library's source maps: expansion and snapping
 * fall out of entryRangeAt (source) plus an
 * ordinal sweep (target). Zero-width entries carry
 * side-absent content the way an earlier
 * implementation's invisible tokens did.
 * ProseMirror-free by design; the editor layer
 * converts editor positions to BlockPos.
 *
 * SegRef ordinals are the shared coordinate:
 * gap i -> 2i, anchor i -> 2i+1; a marker entry
 * borrows its span endpoint's anchor ordinal, so
 * highlighting a cartouche's anchors includes its
 * marker chars on the SP side.
 */

import { entryRangeAt } from "./source-map";
import type {
  SegRef,
  Side,
  SourceEntry,
  Span,
} from "./types";

export interface BlockMaps {
  sp: SourceEntry[];
  latin: SourceEntry[];
  spans: Span[];
}

export interface BlockPos {
  block: number;
  offset: number;
}

export interface InlineHighlight {
  block: number;
  from: number;
  to: number;
}

export interface MirrorResult {
  inline: InlineHighlight[];
  wholeBlocks: number[];
}

function refOrdinal(
  ref: SegRef,
  spans: Span[]
): number {
  if (ref.seg === "gap") return 2 * ref.index;
  if (ref.seg === "anchor") {
    return 2 * ref.index + 1;
  }
  const s = spans[ref.span];
  const anchor =
    ref.end === "start" ? s.from : s.to;
  return 2 * anchor + 1;
}

function mapWithin(
  maps: BlockMaps,
  view: Side,
  block: number,
  from: number,
  to: number
): InlineHighlight | null {
  if (from >= to) return null;
  const source =
    view === "sp" ? maps.sp : maps.latin;
  const target =
    view === "sp" ? maps.latin : maps.sp;
  const range = entryRangeAt(source, from, to);
  if (!range) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = range.start; i <= range.end; i++) {
    const o = refOrdinal(
      source[i].ref,
      maps.spans
    );
    lo = Math.min(lo, o);
    hi = Math.max(hi, o);
  }
  let f: number | null = null;
  let t: number | null = null;
  for (const e of target) {
    const o = refOrdinal(e.ref, maps.spans);
    if (o < lo || o > hi) continue;
    if (f === null || e.from < f) f = e.from;
    if (t === null || e.to > t) t = e.to;
  }
  if (f === null || t === null || f === t) {
    return null;
  }
  return { block, from: f, to: t };
}

function blockEnd(map: SourceEntry[]): number {
  let end = 0;
  for (const e of map) {
    end = Math.max(end, e.to);
  }
  return end;
}

export function mirrorRange(
  blocks: BlockMaps[],
  view: Side,
  anchor: BlockPos,
  head: BlockPos
): MirrorResult {
  let a = anchor;
  let b = head;
  if (
    a.block > b.block ||
    (a.block === b.block && a.offset > b.offset)
  ) {
    const t = a;
    a = b;
    b = t;
  }
  const inline: InlineHighlight[] = [];
  const wholeBlocks: number[] = [];
  if (
    a.block < 0 ||
    b.block < 0 ||
    a.block >= blocks.length ||
    b.block >= blocks.length
  ) {
    return { inline, wholeBlocks };
  }
  if (
    a.block === b.block &&
    a.offset === b.offset
  ) {
    return { inline, wholeBlocks };
  }
  if (a.block === b.block) {
    const h = mapWithin(
      blocks[a.block],
      view,
      a.block,
      a.offset,
      b.offset
    );
    if (h) inline.push(h);
    return { inline, wholeBlocks };
  }
  const srcOf = (i: number) =>
    view === "sp"
      ? blocks[i].sp
      : blocks[i].latin;
  const first = mapWithin(
    blocks[a.block],
    view,
    a.block,
    a.offset,
    blockEnd(srcOf(a.block))
  );
  if (first) inline.push(first);
  for (let i = a.block + 1; i < b.block; i++) {
    wholeBlocks.push(i);
  }
  const last = mapWithin(
    blocks[b.block],
    view,
    b.block,
    0,
    b.offset
  );
  if (last) inline.push(last);
  return { inline, wholeBlocks };
}
