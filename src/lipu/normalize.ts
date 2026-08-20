/**
 * Normal form. Three jobs:
 * 1. matchStructuralPairs: find matched structural
 *    marker pairs in gap.sp strings (per-kind
 *    stack matching; crossing pairs rejected) with
 *    (kind, depth, ordinal) triples — shared with
 *    the merge's span reconciliation.
 * 2. normalizeBlock: legacy facet folds + span
 *    promotion (matched pairs covering >= 1
 *    anchor; empty pairs stay transitional).
 * 3. normalizeLipu: the empty-line invariant —
 *    a gap.sp with 2+ consecutive "\n" outside
 *    structural spans splits the Block.
 */

import {
  niDirectionByArrowCp,
  ZWJ,
} from "../data";
import { codepoints } from "../convert/verbatim";
import {
  CARTOUCHE_START,
  CARTOUCHE_END,
  schemeChars,
  STRUCTURAL_BY_CHAR,
} from "./chars";
import {
  isCodepointBoundary,
  isStructural,
  sortSpans,
} from "./types";
import type {
  Block,
  Gap,
  Lipu,
  Span,
  StructuralKind,
} from "./types";

export interface MarkerPos {
  gap: number;
  offset: number;
  length: number;
}

export interface MarkerPair {
  kind: StructuralKind;
  start: MarkerPos;
  end: MarkerPos;
  from: number;
  to: number;
  depth: number;
  ordinal: number;
}

interface Occ {
  kind: StructuralKind;
  role: "start" | "end";
  pos: MarkerPos;
  seq: number;
}

export function matchStructuralPairs(
  gapsSp: string[]
): MarkerPair[] {
  const occs: Occ[] = [];
  let seq = 0;
  gapsSp.forEach((sp, gap) => {
    for (const [cp, offset] of codepoints(sp)) {
      const ch = String.fromCodePoint(cp);
      const role = STRUCTURAL_BY_CHAR.get(ch);
      if (role) {
        occs.push({
          kind: role.kind,
          role: role.role,
          pos: { gap, offset, length: ch.length },
          seq,
        });
      }
      seq += 1;
    }
    seq += 1; // anchor slot keeps order monotonic
  });

  // per-kind stack matching
  interface Cand {
    kind: StructuralKind;
    start: Occ;
    end: Occ;
  }
  const cands: Cand[] = [];
  const stacks = new Map<StructuralKind, Occ[]>();
  for (const o of occs) {
    const stack = stacks.get(o.kind) ?? [];
    if (o.role === "start") {
      stack.push(o);
    } else if (stack.length > 0) {
      const start = stack.pop()!;
      cands.push({ kind: o.kind, start, end: o });
    }
    stacks.set(o.kind, stack);
  }

  // crossing rejection: interleaving candidate
  // pairs BOTH stay transitional
  const crosses = (a: Cand, b: Cand): boolean =>
    a.start.seq < b.start.seq &&
    b.start.seq < a.end.seq &&
    a.end.seq < b.end.seq;
  const ok = cands.filter(
    (a) =>
      !cands.some(
        (b) =>
          b !== a &&
          (crosses(a, b) || crosses(b, a))
      )
  );

  // depth (strict containment among survivors,
  // any kind) and ordinal within (kind, depth)
  const withSeq = ok
    .map((c) => ({
      c,
      depth: ok.filter(
        (o) =>
          o !== c &&
          o.start.seq < c.start.seq &&
          c.end.seq < o.end.seq
      ).length,
    }))
    .sort((a, b) => a.c.start.seq - b.c.start.seq);
  const counters = new Map<string, number>();
  return withSeq.map(({ c, depth }) => {
    const key = c.kind + ":" + depth;
    const ordinal = counters.get(key) ?? 0;
    counters.set(key, ordinal + 1);
    return {
      kind: c.kind,
      start: c.start.pos,
      end: c.end.pos,
      from: c.start.pos.gap,
      to: c.end.pos.gap - 1,
      depth,
      ordinal,
    };
  });
}

/** Delete exactly the given pairs' marker chars
 *  from the gap strings (descending offsets so
 *  earlier cuts do not shift later ones). */
export function removePairChars(
  gaps: Gap[],
  pairs: MarkerPair[]
): Gap[] {
  const cuts = new Map<
    number,
    Array<{ offset: number; length: number }>
  >();
  for (const p of pairs) {
    for (const pos of [p.start, p.end]) {
      const list = cuts.get(pos.gap) ?? [];
      list.push({
        offset: pos.offset,
        length: pos.length,
      });
      cuts.set(pos.gap, list);
    }
  }
  return gaps.map((g, i) => {
    const list = cuts.get(i);
    if (!list) return g;
    let sp = g.sp;
    for (const c of [...list].sort(
      (a, b) => b.offset - a.offset
    )) {
      sp =
        sp.slice(0, c.offset) +
        sp.slice(c.offset + c.length);
    }
    return { ...g, sp };
  });
}

/** Where a marker ends up in its gap string AFTER
 *  removePairChars has cut every pair's marker chars
 *  out: its own offset, minus the length of every
 *  cut that sits earlier in the SAME gap. (Its own
 *  cut is at its own offset, so it never counts.) */
function splicedOffset(
  pos: MarkerPos,
  pairs: MarkerPair[]
): number {
  let shift = 0;
  for (const p of pairs) {
    for (const q of [p.start, p.end]) {
      if (
        q.gap === pos.gap &&
        q.offset < pos.offset
      ) {
        shift += q.length;
      }
    }
  }
  return pos.offset - shift;
}

/** Offsets of spans that were ALREADY promoted move
 *  too when a later promotion splices chars out of
 *  the same gap. */
function shiftExistingOffsets(
  spans: Span[],
  pairs: MarkerPair[]
): Span[] {
  if (pairs.length === 0) return spans;
  return spans.map((s) => {
    if (
      s.startOffset === undefined &&
      s.endOffset === undefined
    ) {
      return s;
    }
    const out = { ...s };
    if (out.startOffset !== undefined) {
      out.startOffset = splicedOffset(
        { gap: s.from, offset: out.startOffset,
          length: 0 },
        pairs
      );
    }
    if (out.endOffset !== undefined) {
      out.endOffset = splicedOffset(
        { gap: s.to + 1, offset: out.endOffset,
          length: 0 },
        pairs
      );
    }
    return out;
  });
}

/** Spans for promoted pairs, carrying the MARKER
 *  OFFSETS that make promotion byte-preserving:
 *  promotion records the post-splice offsets.
 *  `spliced` is the gap.sp array AFTER
 *  removePairChars — the strings the offsets index.
 *
 *  Edge-adjacent offsets are OMITTED (absent means
 *  edge): "[toki]" promotes to exactly the span it
 *  always did, so nothing that was already
 *  edge-adjacent changes shape. */
export function spansFromPairs(
  pairs: MarkerPair[],
  spliced: string[]
): Span[] {
  return pairs.map((p) => {
    const span: Span = {
      from: p.from,
      to: p.to,
      kind: p.kind,
      side: "both",
    };
    const start = splicedOffset(p.start, pairs);
    const end = splicedOffset(p.end, pairs);
    if (start !== spliced[p.from].length) {
      span.startOffset = start;
    }
    if (end !== 0) span.endOffset = end;
    return span;
  });
}

export interface GapMarker {
  /** index into block.spans */
  span: number;
  role: "start" | "end";
  kind: StructuralKind;
  /** clamped position within this gap's sp */
  offset: number;
  /** false when the span stores no offset for this
   *  end (edge-adjacent) */
  explicit: boolean;
}

/** Every structural marker char that renders inside
 *  gap `index`, in EMISSION ORDER: ascending offset,
 *  then ENDS before STARTS at a shared offset, ends
 *  innermost-first (larger `from` first) and starts
 *  outermost-first (larger `to` first) — proper
 *  nesting in, proper nesting out. With no stored
 *  offsets this emits at the edges exactly (ends at
 *  0, starts at sp.length).
 *
 *  SAME-RANGE spans tie on from/to, and there the
 *  array order is the nesting (sortSpans note):
 *  starts open in array order, ends close in
 *  REVERSE array order. Emitting both in array
 *  order instead closes the OUTER pair first, so
 *  "[(toki)]" would come back as the crossed
 *  "[(toki])".
 *
 *  The single place marker POSITIONS are resolved:
 *  renderSp and the flat merge's demotion both read
 *  it, so they cannot drift apart.
 */
export function gapMarkers(
  block: Block,
  index: number
): GapMarker[] {
  const sp = block.gaps[index]?.sp ?? "";
  const clamp = (o: number): number =>
    Math.min(Math.max(0, o), sp.length);
  const marks: Array<
    GapMarker & { order: number; tie: number }
  > = [];
  block.spans.forEach((s, span) => {
    if (!isStructural(s.kind)) return;
    const kind = s.kind as StructuralKind;
    if (s.to === index - 1) {
      marks.push({
        span,
        role: "end",
        kind,
        offset: clamp(s.endOffset ?? 0),
        explicit: s.endOffset !== undefined,
        // innermost (larger from) first; same range
        // closes in reverse array order
        order: -s.from,
        tie: -span,
      });
    }
    if (s.from === index) {
      marks.push({
        span,
        role: "start",
        kind,
        offset: clamp(s.startOffset ?? sp.length),
        explicit: s.startOffset !== undefined,
        // outermost (larger to) first; same range
        // opens in array order
        order: -s.to,
        tie: span,
      });
    }
  });
  return marks
    .sort((a, b) => {
      if (a.offset !== b.offset) {
        return a.offset - b.offset;
      }
      if (a.role !== b.role) {
        return a.role === "end" ? -1 : 1;
      }
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.tie - b.tie;
    })
    .map(({ order: _o, tie: _t, ...m }) => m);
}

/** Marker offsets index gap strings, and other
 *  passes rewrite the gap they index (cleanupJoiners
 *  drops a joiner char on a Latin merge; an anchor
 *  death moves a gap; splitBlock slices one in two).
 *  Clamping keeps the model inside checkBlock's
 *  bounds; the marker then renders at the nearest
 *  legal position.
 *
 *  SNAP DIRECTION is OUTWARD FOR THE SPAN — a start
 *  offset floors, an end offset ceils — so an offset
 *  that no longer sits on a codepoint boundary grows
 *  the span's interior instead of shrinking it. That
 *  is the safe direction for the bug this whole task
 *  exists to kill: content whose side of the marker
 *  became ambiguous stays INSIDE the cartouche
 *  rather than being ejected past it. (Both
 *  directions are equally safe against lone
 *  surrogates; only ejection is a content change the
 *  user notices.) */
export function clampSpanOffsets(
  spans: Span[],
  gaps: Gap[]
): Span[] {
  return spans.map((s) => {
    if (
      s.startOffset === undefined &&
      s.endOffset === undefined
    ) {
      return s;
    }
    const out = { ...s };
    const fit = (
      off: number,
      gapIndex: number,
      dir: -1 | 1
    ): number => {
      const sp = gaps[gapIndex]?.sp ?? "";
      let o = Math.min(
        Math.max(0, off),
        sp.length
      );
      while (!isCodepointBoundary(sp, o)) o += dir;
      return o;
    };
    if (out.startOffset !== undefined) {
      const off = fit(out.startOffset, s.from, -1);
      // an offset that lands ON the edge is the
      // default: drop it, so a clamped span is
      // deep-equal to the offset-free span it now
      // means (the canonical form spansFromPairs
      // emits)
      if (off === (gaps[s.from]?.sp.length ?? 0)) {
        delete out.startOffset;
      } else {
        out.startOffset = off;
      }
    }
    if (out.endOffset !== undefined) {
      const off = fit(out.endOffset, s.to + 1, 1);
      if (off === 0) {
        delete out.endOffset;
      } else {
        out.endOffset = off;
      }
    }
    return out;
  });
}

/** Legacy facet folds (ported from the app's
 *  existing normalization pass, restated over
 *  anchors + gap chars). */
function foldAnchors(block: Block): Block {
  const anchors = block.anchors.map((a) => ({
    ...a,
  }));
  const gaps = block.gaps.map((g) => ({ ...g }));

  const spanDepth = (i: number): number =>
    block.spans.filter(
      (s) =>
        s.kind === "cartouche" &&
        s.from <= i &&
        i <= s.to
    ).length;

  let charDepth = 0;
  for (let i = 0; i < anchors.length; i++) {
    for (const [cp] of codepoints(gaps[i].sp)) {
      const ch = String.fromCodePoint(cp);
      if (ch === CARTOUCHE_START) charDepth += 1;
      if (ch === CARTOUCHE_END) {
        charDepth = Math.max(0, charDepth - 1);
      }
    }
    const a = anchors[i];
    if (a.kind !== "word") continue;

    // ni variation 1-8 means direction
    if (
      a.word === "ni" &&
      a.variation &&
      a.variation >= 1 &&
      a.variation <= 8
    ) {
      a.niDirection = a.variation;
      delete a.variation;
    }

    // arrow (optionally after legacy ZWJ) at the
    // start of a bare ni's owned gap: fold
    if (a.word === "ni" && !a.niDirection) {
      const own = gaps[i + 1];
      const cps = [...codepoints(own.sp)];
      let k = 0;
      if (
        cps[k] &&
        cps[k][0] === ZWJ &&
        cps[k + 1] &&
        niDirectionByArrowCp(cps[k + 1][0])
      ) {
        k += 1;
      }
      const arrow =
        cps[k] &&
        niDirectionByArrowCp(cps[k][0]);
      if (arrow) {
        a.niDirection = arrow.index;
        const arrowCh = String.fromCodePoint(
          cps[k][0]
        );
        own.sp = own.sp.slice(
          cps[k][1] + arrowCh.length
        );
      }
    }

    // nameScheme only inside cartouches: demote
    // to literal naming chars at the START of the
    // owned gap (they render right after the word)
    if (
      a.nameScheme &&
      charDepth + spanDepth(i) === 0
    ) {
      gaps[i + 1] = {
        ...gaps[i + 1],
        sp:
          schemeChars(a.nameScheme) +
          gaps[i + 1].sp,
      };
      delete a.nameScheme;
    }
  }
  return { anchors, gaps, spans: block.spans };
}

/** Promotion-only normal form: matched pairs
 *  enclosing >= 1 anchor become spans; no facet
 *  folds, no splits. Shared by normalizeBlock, the
 *  storage migration's import path, and the editor's
 *  load path. */
export function promoteBlock(block: Block): Block {
  const pairs = matchStructuralPairs(
    block.gaps.map((g) => g.sp)
  ).filter((p) => p.to >= p.from);
  const gaps = removePairChars(block.gaps, pairs);
  const spans = sortSpans([
    ...clampSpanOffsets(
      shiftExistingOffsets(block.spans, pairs),
      gaps
    ),
    ...spansFromPairs(
      pairs,
      gaps.map((g) => g.sp)
    ),
  ]);
  return { anchors: block.anchors, gaps, spans };
}

export function normalizeBlock(
  block: Block
): Block {
  return promoteBlock(foldAnchors(block));
}

interface SplitPoint {
  gap: number;
  runStart: number;
  runEnd: number; // exclusive
}

/** Exterior [from, to) segments of gap g's sp once
 *  structural-span coverage — INCLUDING marker
 *  offsets — is excluded. Gaps strictly inside a
 *  span are fully interior; gaps[s.from] is interior
 *  AT AND AFTER a recorded startOffset; gaps[s.to +
 *  1] is interior BEFORE a recorded endOffset.
 *  Edge-adjacent markers (absent offsets) contribute
 *  nothing. Mirrors the
 *  line-breaks normalizer's suppressedRanges
 *  authority (which reads RENDERED marker
 *  positions): a "\n\n" run straddling a recorded
 *  offset is not consecutive in the rendered text
 *  (the marker char sits between the breaks) and
 *  must not split — segmenting at the offsets gives
 *  that for free, while a 2+ run wholly on the
 *  outer side of a marker still splits. */
function exteriorSegments(
  block: Block,
  g: number
): Array<{ from: number; to: number }> {
  const len = block.gaps[g].sp.length;
  const interior: Array<[number, number]> = [];
  for (const s of block.spans) {
    if (!isStructural(s.kind)) continue;
    if (s.from < g && g <= s.to) {
      interior.push([0, len]);
    }
    if (
      s.from === g &&
      s.startOffset !== undefined
    ) {
      interior.push([s.startOffset, len]);
    }
    if (
      s.to + 1 === g &&
      s.endOffset !== undefined
    ) {
      interior.push([0, s.endOffset]);
    }
  }
  interior.sort((a, b) => a[0] - b[0]);
  const out: Array<{ from: number; to: number }> =
    [];
  let cursor = 0;
  for (const [a, b] of interior) {
    if (a > cursor) {
      out.push({ from: cursor, to: a });
    }
    cursor = Math.max(cursor, b);
  }
  if (cursor < len) {
    out.push({ from: cursor, to: len });
  }
  return out;
}

function findSplit(
  block: Block
): SplitPoint | null {
  for (let g = 0; g < block.gaps.length; g++) {
    for (const seg of exteriorSegments(block, g)) {
      const m = /\n{2,}/.exec(
        block.gaps[g].sp.slice(seg.from, seg.to)
      );
      if (m) {
        return {
          gap: g,
          runStart: seg.from + m.index,
          runEnd: seg.from + m.index + m[0].length,
        };
      }
    }
  }
  return null;
}

/** latin side of a splitting gap: divide at the
 *  maximal consecutive-"\n" run containing the
 *  LAST "\n"; the run is consumed.
 *  Also used by a document-level merge's sentinel
 *  split routing — and, string-generically, for the
 *  latin-edit mirror division of gap.sp. */
export function splitLatin(latin: string): {
  left: string;
  right: string;
} {
  const last = latin.lastIndexOf("\n");
  if (last === -1) {
    return { left: latin, right: "" };
  }
  let start = last;
  while (
    start > 0 &&
    latin[start - 1] === "\n"
  ) {
    start -= 1;
  }
  return {
    left: latin.slice(0, start),
    right: latin.slice(last + 1),
  };
}

function splitBlock(
  block: Block,
  at: SplitPoint
): [Block, Block] {
  const g = at.gap;
  const gap = block.gaps[g];
  const { left: leftLatin, right: rightLatin } =
    splitLatin(gap.latin);

  // OFFSET REBASING. The splitting gap is SLICED, so
  // any marker offset that indexes it must move with
  // its half or the marker silently relocates
  // ("toki\n\n[ jan]" ejecting the space again), and
  // a rebase-free offset can even land MID-SURROGATE
  // and emit lone surrogates.
  // The right half's gaps[0] is gap.sp.slice(runEnd)
  // (subtract runEnd); the left half's last gap is
  // gap.sp.slice(0, runStart) (positions unchanged,
  // clamped by normalizeBlock's clampSpanOffsets on
  // the way out). Markers that sat INSIDE the
  // consumed run have nowhere to go and clamp to
  // their half's edge.
  const rebaseRight = (s: Span): Span => {
    if (s.from !== g || s.startOffset === undefined) {
      return s;
    }
    return {
      ...s,
      startOffset: Math.max(
        0,
        s.startOffset - at.runEnd
      ),
    };
  };

  const leftSpans: Span[] = [];
  const rightSpans: Span[] = [];
  for (const s of block.spans) {
    if (s.to < g) {
      leftSpans.push(s);
    } else if (s.from >= g) {
      const r = rebaseRight(s);
      rightSpans.push({
        ...r,
        from: r.from - g,
        to: r.to - g,
      });
    } else {
      // formatting span straddling the split
      // divides in two (structural spans never
      // straddle: their interior gaps are exempt)
      leftSpans.push({ ...s, to: g - 1 });
      rightSpans.push({
        ...s,
        from: 0,
        to: s.to - g,
      });
    }
  }
  const leftGaps = [
    ...block.gaps.slice(0, g),
    {
      sp: gap.sp.slice(0, at.runStart),
      latin: leftLatin,
    },
  ];
  const rightGaps = [
    {
      sp: gap.sp.slice(at.runEnd),
      latin: rightLatin,
    },
    ...block.gaps.slice(g + 1),
  ];
  return [
    {
      anchors: block.anchors.slice(0, g),
      gaps: leftGaps,
      spans: clampSpanOffsets(leftSpans, leftGaps),
    },
    {
      anchors: block.anchors.slice(g),
      gaps: rightGaps,
      spans: clampSpanOffsets(rightSpans, rightGaps),
    },
  ];
}

export function normalizeLipu(lipu: Lipu): Lipu {
  const out: Block[] = [];
  const queue = lipu.blocks.map(normalizeBlock);
  while (queue.length > 0) {
    const block = queue.shift()!;
    const at = findSplit(block);
    if (!at) {
      out.push(block);
      continue;
    }
    const [l, r] = splitBlock(block, at);
    queue.unshift(
      normalizeBlock(l),
      normalizeBlock(r)
    );
  }
  return { version: 2, blocks: out };
}
