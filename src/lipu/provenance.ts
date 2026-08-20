/**
 * Gap provenance: per-side authored/default marks,
 * the two recognizer predicates (deliberately named
 * apart — see each), the boundary classifier, and
 * reattachProvenance — run immediately after EVERY
 * mergeBlockDetailed call, classifying the merge
 * output only. Later passes carry their own mark
 * plumbing inline (doc-merge.ts).
 */

import { isStructural } from "./types";
import type {
  Block,
  Gap,
  Lipu,
  Side,
} from "./types";

/** LIVE origin rule: user-edited bytes are
 *  default iff space-only ("" included). Newlines
 *  are NOT space-only — a typed Enter is authored.
 *  Fusion-guard machine spaces stay default via
 *  this same predicate. */
export function originDefault(
  bytes: string
): boolean {
  return /^ *$/.test(bytes);
}

export type GapPosition =
  | "gap0"
  | "interior"
  | "final";

export function gapPosition(
  gi: number,
  gapCount: number
): GapPosition {
  if (gi === 0) return "gap0";
  return gi === gapCount - 1
    ? "final"
    : "interior";
}

/** BOUNDARY classifier: true iff bytes are " "
 *  and "\n" in ANY order and mix — the latin-join
 *  invention writes " \n" (layout BEFORE newline)
 *  into production docs, so an ordered grammar
 *  misclassifies real data. side/position are part
 *  of the contract (creator images differ by
 *  position: block-final "" vs interior " "), but
 *  every default-creator image is inside this one
 *  grammar, so the accept set is
 *  position-independent today; a future narrowing
 *  has the call-site information it needs. Any
 *  punctuation, letter, or control char =>
 *  authored. */
export function looksDefault(
  side: Side,
  bytes: string,
  position: GapPosition
): boolean {
  void side;
  void position;
  return /^[ \n]*$/.test(bytes);
}

const MARK_KEY = {
  sp: "spAuthored",
  latin: "latinAuthored",
} as const;

export function isAuthored(
  g: Gap,
  side: Side
): boolean {
  return g[MARK_KEY[side]] === true;
}

/** Copy-on-write mark write: never stores false;
 *  identity when the mark already agrees (any pass
 *  setting/clearing a mark on a shared gap copies
 *  first). */
export function withMark(
  g: Gap,
  side: Side,
  authored: boolean
): Gap {
  if (isAuthored(g, side) === authored) return g;
  const out = { ...g };
  if (authored) out[MARK_KEY[side]] = true;
  else delete out[MARK_KEY[side]];
  return out;
}

/** The OR rule for concatenations: the result is
 *  authored if EITHER contributor was. */
export function orInto(
  g: Gap,
  side: Side,
  otherAuthored: boolean | undefined
): Gap {
  return otherAuthored
    ? withMark(g, side, true)
    : g;
}

function sideBytes(g: Gap, side: Side): string {
  return side === "sp" ? g.sp : g.latin;
}

const SIDES: readonly Side[] = ["sp", "latin"];

/** Load/boundary recognizer: PER-SIDE — any
 *  unmarked side is classified by looksDefault;
 *  marked sides are left alone. Idempotent. */
export function classifyBlock(block: Block): Block {
  let changed = false;
  const gaps = block.gaps.map((g, gi) => {
    const pos = gapPosition(gi, block.gaps.length);
    let out = g;
    for (const side of SIDES) {
      if (
        !isAuthored(out, side) &&
        !looksDefault(side, sideBytes(out, side), pos)
      ) {
        out = withMark(out, side, true);
        changed = true;
      }
    }
    return out;
  });
  return changed ? { ...block, gaps } : block;
}

export function classifyProvenance(
  lipu: Lipu
): Lipu {
  let changed = false;
  const blocks = lipu.blocks.map((b) => {
    const n = classifyBlock(b);
    if (n !== b) changed = true;
    return n;
  });
  return changed ? { version: 2, blocks } : lipu;
}

/** Gap indices whose EDITED side was touched by a
 *  registered frozen consumption in this merge
 *  (sp merges only — cleanupJoiners is a
 *  CARRIED-side consumption on latin merges and is
 *  handled by the carried-side byte-diff restamp
 *  instead):
 *   - marker-pair consumption: a structural span
 *     in `out` with no prev counterpart consumed
 *     its start marker from gaps[from] and its end
 *     marker from gaps[to + 1];
 *   - parseSp facet folds: an anchor that GAINED a
 *     nameScheme / variation / niDirection (or a
 *     scheme count increase) consumed the naming
 *     char from its owned gap, gaps[i + 1]. */
function consumptionTouched(
  prev: Block,
  out: Block,
  prevIndexOf: Array<number | undefined>
): Set<number> {
  const touched = new Set<number>();
  const outIndexOfPrev = new Map<number, number>();
  prevIndexOf.forEach((p, i) => {
    if (p !== undefined) outIndexOfPrev.set(p, i);
  });
  const carried = new Set<string>();
  for (const s of prev.spans) {
    if (!isStructural(s.kind)) continue;
    let lo: number | null = null;
    let hi: number | null = null;
    for (let p = s.from; p <= s.to; p++) {
      const i = outIndexOfPrev.get(p);
      if (i === undefined) continue;
      if (lo === null || i < lo) lo = i;
      if (hi === null || i > hi) hi = i;
    }
    if (lo !== null && hi !== null) {
      carried.add(s.kind + ":" + lo + ":" + hi);
    }
  }
  for (const s of out.spans) {
    if (!isStructural(s.kind)) continue;
    const key = s.kind + ":" + s.from + ":" + s.to;
    if (carried.has(key)) continue;
    touched.add(s.from);
    touched.add(s.to + 1);
  }
  out.anchors.forEach((a, i) => {
    if (a.kind !== "word") return;
    const p = prevIndexOf[i];
    const pa =
      p !== undefined ? prev.anchors[p] : undefined;
    if (pa === undefined) return; // fresh gap is
    // recognizer-classified anyway
    const gained =
      (a.nameScheme !== undefined &&
        pa.nameScheme === undefined) ||
      (a.nameScheme !== undefined &&
        pa.nameScheme !== undefined &&
        a.nameScheme.style !== "word" &&
        pa.nameScheme.style ===
          a.nameScheme.style &&
        a.nameScheme.count > pa.nameScheme.count) ||
      (a.variation !== undefined &&
        pa.variation === undefined) ||
      (a.niDirection !== undefined &&
        pa.niDirection === undefined);
    if (gained) touched.add(i + 1);
  });
  return touched;
}

/** Runs immediately after every mergeBlockDetailed
 *  call; classifies the MERGE OUTPUT only. Mark
 *  algebra (last-write wins):
 *   - matched gap, bytes unchanged => inherit;
 *   - carried side, bytes changed => recognizer
 *     restamp (only registered frozen consumptions
 *     change a carried side);
 *   - edited side, bytes changed => originDefault,
 *     UNLESS a registered consumption touched the
 *     side this merge — then the recognizer
 *     restamp wins;
 *   - fresh gap => looksDefault both sides. */
export function reattachProvenance(
  prev: Block,
  out: Block,
  prevIndexOf: Array<number | undefined>,
  editedSide: Side
): Block {
  const touched =
    editedSide === "sp"
      ? consumptionTouched(prev, out, prevIndexOf)
      : new Set<number>();
  let changed = false;
  const gaps = out.gaps.map((g, gi) => {
    const p =
      gi === 0
        ? 0
        : prevIndexOf[gi - 1] !== undefined
          ? prevIndexOf[gi - 1]! + 1
          : undefined;
    const pos = gapPosition(gi, out.gaps.length);
    let next = g;
    for (const side of SIDES) {
      const bytes = sideBytes(g, side);
      let authored: boolean;
      if (p === undefined) {
        authored = !looksDefault(side, bytes, pos);
      } else {
        const pg = prev.gaps[p];
        if (bytes === sideBytes(pg, side)) {
          authored = isAuthored(pg, side);
        } else if (
          side !== editedSide ||
          touched.has(gi)
        ) {
          authored = !looksDefault(
            side,
            bytes,
            pos
          );
        } else {
          authored = !originDefault(bytes);
        }
      }
      if (authored !== isAuthored(next, side)) {
        next = withMark(next, side, authored);
        changed = true;
      }
    }
    return next;
  });
  return changed ? { ...out, gaps } : out;
}
