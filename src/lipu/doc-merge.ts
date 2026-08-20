/**
 * Editor-level merge semantics over whole
 * documents. ProseMirror-free; the editor's model
 * plugin is a thin caller. Three jobs the
 * per-block merge library (merge.ts) deliberately
 * does not do:
 *
 * 1. THE FLAT STRUCTURAL MERGE, used ONLY when the
 *    paragraph COUNT CHANGES; an equal-count
 *    transaction merges per-block positionally
 *    instead (the fast path, see mergeStructural):
 *    flatten n Blocks into one Block with SENTINEL
 *    anchors between them (each sentinel OWNS the
 *    following Block's gaps[0] — the gap to its
 *    right), run the ordinary per-side merge over
 *    the flat streams, then apply the two sentinel
 *    ownership exceptions and re-chunk:
 *    - SPLIT (inserted sentinel): the carried
 *      other side of the gap to its LEFT divides
 *      at the maximal trailing "\n" run containing
 *      its last "\n"; post-run content moves to
 *      the sentinel's owned gap. A sentinel's
 *      owned gap gets {sp:"", latin:""} creation
 *      defaults, never the word-insertion default.
 *    - JOIN (deleted sentinel): its owned gap's
 *      NON-edited side merges into the left
 *      survivor's trailing gap (the edited side is
 *      parse-authoritative and already in the
 *      doc). One-anchor bounded exception to
 *      ownership death; only sentinels get it.
 *      JOIN SEAM RULE (collapseSeamRuns): the seam
 *      gap's CARRIED side then normalizes its
 *      newline runs — to at most one "\n" on an
 *      SP-side join (none is invented), and to
 *      EXACTLY one on a LATIN-side join (invented
 *      at the seam when none existed). So a join
 *      can never accumulate the "\n\n" that the
 *      other pane's normalizer would read back as
 *      a fresh paragraph split (the ping-pong),
 *      never ratchet a "\n\n\n", and never leave
 *      the SP pane with two lines run together
 *      where it was showing a break.
 *    Promotion never crosses a Block boundary: a
 *    merged structural span that covers a sentinel
 *    is DEMOTED back to edge-adjacent transitional
 *    marker chars before re-chunking.
 *
 * 2. THE ENTER DEFAULT, as a two-way delta rule:
 *    on sp-side merges, each output gap's latin
 *    "\n" count adjusts BY THE SP DELTA relative
 *    to the prev gap that carried into it — not a
 *    one-way append. An sp "\n" count INCREASE of
 *    N appends N "\n"s to the END of the latin
 *    side. An sp "\n" count DECREASE of N REMOVES
 *    min(N, latin "\n" count) "\n"s from the latin
 *    side, trailing-most first, leaving every
 *    other latin character untouched — floored at
 *    zero, never forcing parity (latin "\n"s the
 *    delta doesn't reach are left alone; a user
 *    may deliberately replace a latin "\n" with
 *    punctuation, so deletion must never claw one
 *    back). One-way append alone is the "newline
 *    ratchet": an Enter/delete cycle at the same
 *    break would accrete a latin "\n" forever,
 *    since nothing ever took one away.
 *
 * 3. THE ADJACENCY SEPARATION DEFAULT: after
 *    sp-side merges, at import, and at the load
 *    boundary (applySeparationDefaultsLipu), a gap
 *    with latin "" between two anchors whose Latin
 *    renderings would fuse into one letter run
 *    gets latin " ". Without it the editor mints a
 *    non-normal-form shape on which a future Latin
 *    no-op would DELETE an anchor (the fusion the
 *    anchor-conservation law forbids), and the
 *    Latin pane would render "tokipona".
 *
 * SENTINEL: a marked verbatim anchor with a
 * PUA-delimited text no editor flow can produce.
 * parseSp would read a pasted copy as an UNMARKED
 * verbatim — same rendered text, so an alignment
 * collision is conceivable by adversarial paste;
 * the sentinel is practically-unforgeable only.
 * Tripwires: the render invariant and the
 * block-count-follows-the-parse test. A prev
 * sentinel positionally REPLACED by a real anchor
 * hands its owned gap to that anchor
 * (content-preserving; a select-across-boundary +
 * type flow); a next sentinel replacing a real
 * anchor inherits that anchor's owned gap the same
 * way.
 */

import { mergeBlockDetailed } from "./merge";
import { gapMarkers, splitLatin } from "./normalize";
import {
  isAuthored,
  orInto,
  reattachProvenance,
  withMark,
} from "./provenance";
import {
  atomizedAnchors,
  wordLatin,
} from "./render-latin";
import {
  CARTOUCHE_END,
  CARTOUCHE_START,
  COLON_CH,
  MIDDLE_DOT_CH,
  structuralChar,
} from "./chars";
import {
  isCodepointBoundary,
  isStructural,
  sortSpans,
} from "./types";
import type {
  Anchor,
  Block,
  Gap,
  Lipu,
  ParsedSide,
  Side,
  Span,
  StructuralKind,
} from "./types";

const SENTINEL_TEXT =
  "\uE000\u2029\uE001";

function sentinelAnchor(): Anchor {
  return {
    kind: "verbatim",
    text: SENTINEL_TEXT,
    marked: true,
  };
}

export function isSentinel(a: Anchor): boolean {
  return (
    a.kind === "verbatim" &&
    a.text === SENTINEL_TEXT
  );
}

function countNl(s: string): number {
  let n = 0;
  for (const c of s) if (c === "\n") n += 1;
  return n;
}

/** THE CARRY RULE: the index of the prev gap that
 *  carried into output gap gi, or undefined when
 *  the anchor left of gi is new (nothing carried).
 *  Gap 0 always carries from prev gap 0; any other
 *  gap carries from the gap right of its left
 *  anchor's prev counterpart. Every pass that
 *  compares an output gap against "what was there
 *  before" uses this one definition. */
function carriedPrevGap(
  prevIndexOf: Array<number | undefined>,
  gi: number
): number | undefined {
  if (gi === 0) return 0;
  const p = prevIndexOf[gi - 1];
  return p !== undefined ? p + 1 : undefined;
}

/** Remaps a string offset through an ascending list
 *  of deletion cuts made in that string: offsets
 *  past a cut shift left by its length; offsets
 *  inside a cut snap to the cut's start. Shared by
 *  every pass that deletes gap.sp bytes and must
 *  carry marker offsets across the rewrite. */
function remapThroughCuts(
  cuts: Array<{ at: number; len: number }>,
  o: number
): number {
  let shift = 0;
  for (const c of cuts) {
    if (c.at + c.len <= o) shift += c.len;
    else if (c.at < o) return c.at - shift;
  }
  return o - shift;
}

/** Applies remapThroughCuts to every span offset
 *  indexing gap gi (startOffsets of spans opening
 *  there, endOffsets of spans closing there),
 *  mutating the given span copies in place. */
function remapGapOffsets(
  spans: Span[],
  gi: number,
  cuts: Array<{ at: number; len: number }>
): void {
  for (const s of spans) {
    if (
      s.from === gi &&
      s.startOffset !== undefined
    ) {
      s.startOffset = remapThroughCuts(
        cuts,
        s.startOffset
      );
    }
    if (
      s.to + 1 === gi &&
      s.endOffset !== undefined
    ) {
      s.endOffset = remapThroughCuts(
        cuts,
        s.endOffset
      );
    }
  }
}

/** Walks gap.sp, deleting every colon glyph and
 *  recording the deletions as cuts for
 *  remapGapOffsets. Shared by the colon-withdrawal
 *  sites (generateSpFromLatin,
 *  applyContextRederivation). */
function stripColonGlyphs(sp: string): {
  out: string;
  cuts: Array<{ at: number; len: number }>;
} {
  const cuts: Array<{ at: number; len: number }> =
    [];
  let off = 0;
  let out = "";
  for (const ch of sp) {
    if (ch === COLON_CH) {
      cuts.push({ at: off, len: ch.length });
    } else {
      out += ch;
    }
    off += ch.length;
  }
  return { out, cuts };
}

/** n Blocks -> one flat Block. Arity: Σanchors +
 *  (n-1) sentinels anchors; Σ(anchors+1) gaps =
 *  flat anchors + 1 (the ownership layout's
 *  arithmetic — plain gap concatenation is exactly
 *  the sentinel-owns-following-gaps[0]
 *  assignment). */
export function flattenBlocks(
  blocks: Block[]
): Block {
  const anchors: Anchor[] = [];
  const gaps: Gap[] = [];
  const spans: Span[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) anchors.push(sentinelAnchor());
    const base = anchors.length;
    anchors.push(...b.anchors);
    gaps.push(...b.gaps);
    for (const s of b.spans) {
      spans.push({
        ...s,
        from: s.from + base,
        to: s.to + base,
      });
    }
  });
  if (blocks.length === 0) {
    return {
      anchors: [],
      gaps: [{ sp: "", latin: "" }],
      spans: [],
    };
  }
  return { anchors, gaps, spans: sortSpans(spans) };
}

/** Per-paragraph parses -> one flat ParsedSide with
 *  sentinels between paragraphs. */
export function flattenParsed(
  sides: ParsedSide[]
): ParsedSide {
  const anchors: Anchor[] = [];
  const gaps: string[] = [];
  sides.forEach((s, i) => {
    if (i > 0) anchors.push(sentinelAnchor());
    anchors.push(...s.anchors);
    gaps.push(...s.gaps);
  });
  if (sides.length === 0) {
    return { anchors: [], gaps: [""] };
  }
  return { anchors, gaps };
}

/** Flat Block -> per-block chunks at sentinels.
 *  Each sentinel's owned gap becomes the next
 *  chunk's gaps[0]. Formatting spans straddling a
 *  boundary divide into two (clamped); structural
 *  straddlers were demoted before this runs. */
export function rechunk(flat: Block): Block[] {
  const bounds: number[] = [];
  flat.anchors.forEach((a, i) => {
    if (isSentinel(a)) bounds.push(i);
  });
  const blocks: Block[] = [];
  let start = 0;
  for (const b of [
    ...bounds,
    flat.anchors.length,
  ]) {
    const anchors = flat.anchors.slice(start, b);
    const gaps = flat.gaps.slice(start, b + 1);
    const spans: Span[] = [];
    for (const s of flat.spans) {
      if (s.to < start || s.from >= b) continue;
      const from = Math.max(s.from, start) - start;
      const to = Math.min(s.to, b - 1) - start;
      // A ZERO-ANCHOR chunk (adjacent sentinels —
      // an empty paragraph) clamps to to = -1 <
      // from = 0. There is no anchor left to carry
      // the span, so it is dropped for this chunk
      // rather than emitted as a bad range
      // (checkBlock rejects from > to). Reachable:
      // a formatting span straddling an empty
      // paragraph created by a split.
      if (to < from) continue;
      spans.push({ ...s, from, to });
    }
    blocks.push({
      anchors,
      gaps,
      spans: sortSpans(spans),
    });
    start = b + 1;
  }
  return blocks;
}

function anchorLatinText(a: Anchor): string {
  return a.kind === "word"
    ? wordLatin(a)
    : a.text ?? "";
}

const LETTERISH_END = /[\p{L}\p{M}]$/u;
const LETTER_START = /^\p{L}/u;

/** The adjacency separation default. Idempotent;
 *  SP-invisible.
 *
 *  EXEMPTION = ATOM COVERAGE. NOT "interior to
 *  any structural span": renderLatin atomizes
 *  CARTOUCHE spans only, and the two predicates
 *  disagree BOTH ways.
 *   - too narrow: a gap FLANKING a cartouche is not
 *     interior to it, yet the cartouche side renders
 *     as an opaque name atom — no letter run can
 *     fuse across it and a " " there is a spurious
 *     byte (counterexample: cartouche over anchor 0,
 *     plain word at 1).
 *   - too wide: long / rev-long spans have NO Latin
 *     form, so their interior anchors render their
 *     own letter runs and DO fuse. Exempting them
 *     leaves exactly the lethal shape this default
 *     exists to forbid (a long span over
 *     "toki"+"pona" with an empty latin gap
 *     collapses to one verbatim anchor "tokipona"
 *     under a Latin no-op — an anchor and its owned
 *     gap destroyed, SP bytes lost).
 *   - too wide, second half: a cartouche that
 *     projects NO NAME does not atomize either
 *     (render-latin's ATOMIZATION RULE), so its
 *     covered anchors render their own letter runs —
 *     a cartouche over a marked verbatim "xq" next
 *     to the word "toki" fuses to one "tokixq"
 *     anchor without the " ". Hence the predicate is
 *     atomizedAnchors, not "covered by a cartouche".
 *  It is also, verbatim, the test arbitraries'
 *  separation post-pass — the normal form every law
 *  is stated over. */
export function applySeparationDefaults(
  block: Block
): Block {
  const atomized = atomizedAnchors(block);
  const covered = (i: number): boolean =>
    atomized.has(i);
  let changed = false;
  const gaps = block.gaps.map((g, gi) => {
    if (g.latin !== "") return g;
    if (isAuthored(g, "latin")) return g;
    if (
      gi === 0 ||
      gi > block.anchors.length - 1
    ) {
      return g;
    }
    // gap gi sits between anchors gi-1 and gi
    if (covered(gi - 1) || covered(gi)) return g;
    if (
      LETTERISH_END.test(
        anchorLatinText(block.anchors[gi - 1])
      ) &&
      LETTER_START.test(
        anchorLatinText(block.anchors[gi])
      )
    ) {
      changed = true;
      return { ...g, latin: " " };
    }
    return g;
  });
  return changed ? { ...block, gaps } : block;
}

// Letter-or-mark start, never letter-only: the LEFT
// boundary below tests whether gap.latin CONTINUES a
// run the preceding anchor already opened, and marks
// (unlike letters) can continue a run but never START
// one — same asymmetry applySeparationDefaults already
// encodes via its LETTERISH_END (continuation, admits
// marks) vs. LETTER_START (fresh start, letters only)
// split above; the RIGHT boundary below inherits the
// letters-only side of that split, since every anchor
// START is guaranteed letter-only, so fusing into one
// always reduces to tracing back to a genuine letter.
const LETTERISH_START = /^[\p{L}\p{M}]/u;

const MARK = /\p{M}/u;
const LETTER = /\p{L}/u;

/** Mirrors parseLatin's APOSTROPHES set (see its
 *  interior-apostrophe continuation rule at
 *  parse-latin.ts:59-66). */
const APOSTROPHES = new Set(["'", "’"]);

/** Does gap.latin's START fuse into the run opened
 *  by a preceding anchor already known to END in a
 *  letter or mark? Mirrors tokenizeLatin's forward
 *  scan (parse-latin.ts:44-68): a leading letter or
 *  mark always continues that run; a leading
 *  apostrophe continues it only when the NEXT
 *  character is a letter (parse-latin.ts:59-66) —
 *  which may be gap.latin's own second character or,
 *  for a bare-apostrophe gap, the following anchor's
 *  first letter (`afterChar`). */
function fusesLeft(
  latin: string,
  afterChar: string | undefined
): boolean {
  if (latin === "") return false;
  if (LETTERISH_START.test(latin)) return true;
  if (!APOSTROPHES.has(latin[0])) return false;
  const next = latin.length > 1 ? latin[1] : afterChar;
  return next !== undefined && LETTER.test(next);
}

/** Does gap.latin's END fuse into a following
 *  anchor already known to START with a letter?
 *  Mirrors tokenizeLatin's forward scan: a trailing
 *  letter always continues into it (a fresh run
 *  trivially opens on that letter — parse-
 *  latin.ts:44-45 — and immediately absorbs the
 *  anchor's first letter); a trailing mark or
 *  apostrophe continues into it only if THAT
 *  character is itself already inside an active run,
 *  i.e. its own immediately preceding character is a
 *  letter — gap.latin's own second-to-last character
 *  or, for a single-character gap, the preceding
 *  anchor's last letter (`beforeChar`). */
function fusesRight(
  latin: string,
  beforeChar: string | undefined
): boolean {
  if (latin === "") return false;
  const chars = [...latin];
  const last = chars[chars.length - 1];
  if (LETTER.test(last)) return true;
  if (!MARK.test(last) && !APOSTROPHES.has(last)) {
    return false;
  }
  const prev =
    chars.length > 1
      ? chars[chars.length - 2]
      : beforeChar;
  return prev !== undefined && LETTER.test(prev);
}

/** Editor-boundary normalization of letter-ish
 *  gap.latin. Inserts " " where a stored gap.latin
 *  would FUSE with an adjacent anchor's Latin
 *  rendering (either boundary), which is the shape
 *  under which a Latin no-op destroys word anchors
 *  (glyph loss). The fuse predicate is derived
 *  from parseLatin's ACTUAL run-continuation rules
 *  (tokenizeLatin, including its
 *  interior-apostrophe branch), not just a
 *  letter/mark adjacency guess — see fusesLeft /
 *  fusesRight. ATOM-covered flanks are exempt (the
 *  anchor renders inside an opaque atom — the
 *  separation default's predicate: a cartouche
 *  that projects no name does not atomize, so its
 *  anchor's letter run is ordinary and stored
 *  gap.latin next to it fuses like anywhere else —
 *  declining the separator let a Latin no-op
 *  swallow "ab" INTO "[CART]xq[/CART]"). Accepted
 *  limitation, exact-pinned: this rewrites stored
 *  bytes carried in from older documents.
 *  Free-standing letter runs inside a gap are NOT
 *  touched here; they promote to marked verbatim
 *  anchors on first Latin edit (the pinned
 *  anchor-material behavior).
 *
 *  CONSERVATION GUARD — EXPLICITLY UNGATED:
 *  fusion-safety padding fires regardless of marks
 *  (letterish content migrated from older storage
 *  classifies AUTHORED at the load boundary, and
 *  gating the padding re-opens a shipped
 *  anchor-fusion data loss). On an authored side
 *  the OR rule keeps the side authored. */
export function normalizeLetterishLatin(
  block: Block
): Block {
  const atomized = atomizedAnchors(block);
  const covered = (i: number): boolean =>
    atomized.has(i);
  let changed = false;
  const gaps = block.gaps.map((g, gi) => {
    const latin = g.latin;
    const leftOk =
      gi > 0 &&
      gi <= block.anchors.length &&
      !covered(gi - 1);
    const rightOk =
      gi < block.anchors.length && !covered(gi);
    const prevLatin = leftOk
      ? anchorLatinText(block.anchors[gi - 1])
      : undefined;
    const nextLatin = rightOk
      ? anchorLatinText(block.anchors[gi])
      : undefined;
    const left =
      leftOk &&
      prevLatin !== undefined &&
      LETTERISH_END.test(prevLatin) &&
      fusesLeft(
        latin,
        nextLatin !== undefined
          ? nextLatin[0]
          : undefined
      );
    const right =
      rightOk &&
      nextLatin !== undefined &&
      // LETTERISH_START, not LETTER_START: an
      // anchor's STORED latin text can start with a
      // combining mark (unlike an anchor the
      // separation default itself would mint), and
      // tokenizeLatin's inner loop continues an
      // active run into a letter OR a mark equally
      // -- the fusion this pass catches does not
      // care which class the next anchor starts
      // with, only that it is continuable.
      LETTERISH_START.test(nextLatin) &&
      fusesRight(
        latin,
        prevLatin !== undefined
          ? prevLatin[prevLatin.length - 1]
          : undefined
      );
    if (!left && !right) return g;
    changed = true;
    return {
      ...g,
      latin:
        (left ? " " : "") +
        latin +
        (right ? " " : ""),
    };
  });
  return changed ? { ...block, gaps } : block;
}

export function normalizeLetterishLatinLipu(
  lipu: Lipu
): Lipu {
  let changed = false;
  const blocks = lipu.blocks.map((b) => {
    const n = normalizeLetterishLatin(b);
    if (n !== b) changed = true;
    return n;
  });
  return changed
    ? { version: 2, blocks }
    : lipu;
}

/** The separation default at the LOAD BOUNDARY.
 *  Documents saved before nameless cartouches
 *  stopped being exempt load BELOW the separation
 *  fixpoint and sit one Latin edit away from the
 *  fusion the default exists to forbid; composing
 *  it into the boundary chain lifts them, exactly
 *  as normalizeLetterishLatin lifts older
 *  letter-ish gaps.
 *
 *  Safe by the same argument as that pass: it
 *  writes ONLY latin " " separators, so SP bytes
 *  are untouched; and it is idempotent, so a
 *  second load is identity. Chain order mirrors
 *  mergeSpBlock's (separation default first, then
 *  the letterish pass). */
export function applySeparationDefaultsLipu(
  lipu: Lipu
): Lipu {
  let changed = false;
  const blocks = lipu.blocks.map((b) => {
    const n = applySeparationDefaults(b);
    if (n !== b) changed = true;
    return n;
  });
  return changed
    ? { version: 2, blocks }
    : lipu;
}

/** Removes the LAST n "\n" characters found in s
 *  (trailing-most first), leaving every other
 *  character — including any earlier "\n" the
 *  removal doesn't reach — exactly where it was.
 *  Shared by the Enter default's decrease branch
 *  below and the one-time cleanup pass
 *  (capLatinNewlines): both are "trim trailing
 *  newlines toward a budget", never a general
 *  delete. Floors at zero automatically (a loop
 *  bound by n, never by s.length). */
function removeTrailingNewlines(
  s: string,
  n: number
): string {
  if (n <= 0) return s;
  let remaining = n;
  let out = "";
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i];
    if (c === "\n" && remaining > 0) {
      remaining -= 1;
      continue;
    }
    out = c + out;
  }
  return out;
}

/** The Enter default (module header item 2): latin
 *  "\n" counts follow the sp "\n" delta at each
 *  break. sp-side merges only. */
function applyEnterDefaults(
  prev: Block,
  merged: Block,
  prevIndexOf: Array<number | undefined>
): Block {
  let changed = false;
  const gaps = merged.gaps.map((g, gi) => {
    const p = carriedPrevGap(prevIndexOf, gi);
    const prevGap =
      p !== undefined ? prev.gaps[p] : undefined;
    if (
      isDerivedGap(
        prevGap,
        g,
        inCartoucheContext(merged, gi)
      )
    ) {
      // re-derivation SUBSUMES the delta: the Enter
      // companion and the delta removal never fire
      // on a derived gap (no parity check anywhere).
      return g;
    }
    const prevNl =
      prevGap !== undefined ? countNl(prevGap.sp) : 0;
    const delta = countNl(g.sp) - prevNl;
    if (delta !== 0 && isAuthored(g, "latin")) {
      // the companion creator writes into a DEFAULT
      // latin side only, and the gated delta rule
      // removes a "\n" only from one. Authored
      // latin is untouchable by SP edits.
      return g;
    }
    if (delta > 0) {
      const base =
        p === undefined && g.latin === " "
          ? ""
          : g.latin;
      changed = true;
      return {
        ...g,
        latin: base + "\n".repeat(delta),
      };
    }
    if (delta < 0) {
      const removeCount = Math.min(
        -delta,
        countNl(g.latin)
      );
      if (removeCount === 0) return g;
      changed = true;
      return {
        ...g,
        latin: removeTrailingNewlines(
          g.latin,
          removeCount
        ),
      };
    }
    return g;
  });
  return changed ? { ...merged, gaps } : merged;
}

/** ONE-TIME CLEANUP PASS PRIMITIVE (self-retiring;
 *  the app's storage-cleanup pass is the caller):
 *  caps a single block's per-gap latin "\n" count
 *  at that gap's sp "\n" count. TRIM ONLY — never
 *  adds, and never touches a gap whose latin "\n"
 *  count is already at or under budget. Safe
 *  exactly because it runs while no Latin editing
 *  exists: every stored latin "\n" beyond the sp
 *  count is a stale creation default from before
 *  the Enter default learned to remove newlines,
 *  never user content. */
export function capLatinNewlines(
  block: Block
): { block: Block; trimmed: number } {
  let trimmed = 0;
  const gaps = block.gaps.map((g) => {
    if (isAuthored(g, "latin")) return g;
    const budget = countNl(g.sp);
    const latinNl = countNl(g.latin);
    if (latinNl <= budget) return g;
    const excess = latinNl - budget;
    trimmed += excess;
    return {
      ...g,
      latin: removeTrailingNewlines(g.latin, excess),
    };
  });
  return trimmed > 0
    ? { block: { ...block, gaps }, trimmed }
    : { block, trimmed: 0 };
}

/** JOIN rescue: a dead sentinel's owned gap
 *  contributes its NON-edited side to the left
 *  survivor's trailing output gap. */
function rescueJoinedGaps(
  prev: Block,
  merged: Block,
  prevIndexOf: Array<number | undefined>,
  side: Side
): Block {
  const outIndexOfPrev = new Map<number, number>();
  prevIndexOf.forEach((p, i) => {
    if (p !== undefined) outIndexOfPrev.set(p, i);
  });
  let changed = false;
  const gaps = merged.gaps.map((g) => ({ ...g }));
  const spans = merged.spans.map((s) => ({
    ...s,
  }));
  prev.anchors.forEach((a, p) => {
    if (!isSentinel(a)) return;
    if (outIndexOfPrev.has(p)) return;
    let target = 0;
    for (let q = p - 1; q >= 0; q--) {
      const i = outIndexOfPrev.get(q);
      if (i !== undefined) {
        target = i + 1;
        break;
      }
    }
    const dead = prev.gaps[p + 1];
    if (side === "sp") {
      if (dead.latin === "") return;
      gaps[target] = orInto(
        {
          ...gaps[target],
          latin: gaps[target].latin + dead.latin,
        },
        "latin",
        dead.latinAuthored
      );
    } else {
      if (dead.sp === "") return;
      const preLen = gaps[target].sp.length;
      gaps[target] = orInto(
        {
          ...gaps[target],
          sp: gaps[target].sp + dead.sp,
        },
        "sp",
        dead.spAuthored
      );
      // A span whose from-anchor is the first
      // survivor RIGHT of this dead sentinel had
      // its startOffset indexing the DEAD gap's
      // string. merge.ts's ownership rule already
      // DROPPED that offset — merge.ts is
      // sentinel-agnostic and cannot know the gap
      // gets rescued — so this pass RESTORES it
      // from prev data, shifted by the surviving
      // prefix length. (endOffsets on the target
      // gap belong to spans ending LEFT of the
      // sentinel, index the preserved prefix, and
      // survived that rule: untouched.)
      for (const ps of prev.spans) {
        if (
          ps.startOffset === undefined ||
          ps.from !== p + 1
        ) {
          continue;
        }
        const outFrom = outIndexOfPrev.get(
          ps.from
        );
        // OWNERSHIP CONDITION: the restore is sound
        // only when the span's own left gap IS the
        // rescued one. undefined = the anchor died
        // with its offset (nothing to restore). A
        // DEFINED outFrom other than target would
        // mean an output anchor sits between the
        // survivor left of the sentinel and this
        // one, so ps.startOffset indexes a string
        // that is not gaps[outFrom].sp; writing it
        // there would relocate the marker into an
        // unrelated gap, so the offset stays
        // dropped. Enumeration over splits and
        // joins with deaths and insertions never
        // produced that second case (an insertion
        // adjacent to the dead sentinel gets
        // REPLACEMENT-PAIRED with it, which keeps
        // outFrom === target). Kept as an ownership
        // assertion, not a repair.
        if (outFrom !== target) continue;
        for (const s of spans) {
          if (
            s.from === outFrom &&
            s.kind === ps.kind &&
            s.startOffset === undefined
          ) {
            s.startOffset =
              preLen + ps.startOffset;
            break;
          }
        }
      }
    }
    changed = true;
  });
  return changed
    ? { ...merged, gaps, spans }
    : merged;
}

/** MANDATORY FUSION BYTE-RESCUE, by containment
 *  signature (a byte-equality version never fired
 *  on live-edit fusions). For an output anchor A
 *  paired to prev anchor p (prevIndexOf), take the
 *  maximal run of consecutive UNPAIRED prev
 *  anchors p+1..j (sentinels never fuse — a dead
 *  sentinel is rescueJoinedGaps' business and
 *  terminates the run). The run is a fusion iff
 *  the rendered latin of prev anchors p..j occurs
 *  IN ORDER as disjoint substrings of A's rendered
 *  latin (interior-gap wildcards = the indexOf
 *  skip — edited-side tolerance, so the fusing
 *  keystroke's new chars don't defeat detection).
 *  Rescue: the dying gaps p+2..j+1 (gap p+1's
 *  bytes are already carried by frozen pairing
 *  into the slot after A) are APPENDED AFTER the
 *  carried bytes, in prev document order, marks
 *  OR'd in. SP side only: the dying gaps' LATIN
 *  bytes are parse-authoritative (re-supplied by
 *  the edited side) and are NOT rescued.
 *  Containment false positives degrade to a benign
 *  formatting-carry (bytes survive where words
 *  survive); false negatives (a genuine deletion)
 *  correctly rescue nothing. Batch-safe: runs are
 *  disjoint by construction (each starts at a
 *  paired anchor), so N fusions in one merge each
 *  rescue independently. Latin-edited merges only;
 *  slotted after dropKindChangedSpans (span death
 *  is decided on pristine merge output) and before
 *  generateSpFromLatin (generation must read
 *  post-rescue bytes). */
function rescueFusedGaps(
  prev: Block,
  merged: Block,
  prevIndexOf: Array<number | undefined>
): Block {
  const paired = new Set<number>();
  prevIndexOf.forEach((p) => {
    if (p !== undefined) paired.add(p);
  });
  let changed = false;
  let gaps: Gap[] | undefined;
  merged.anchors.forEach((a, oi) => {
    const p = prevIndexOf[oi];
    if (p === undefined) return;
    if (isSentinel(a)) return;
    let j = p;
    while (
      j + 1 < prev.anchors.length &&
      !paired.has(j + 1) &&
      !isSentinel(prev.anchors[j + 1])
    ) {
      j += 1;
    }
    if (j === p) return;
    const target = anchorLatinText(a);
    let pos = 0;
    for (let k = p; k <= j; k++) {
      const t = anchorLatinText(prev.anchors[k]);
      const at = target.indexOf(t, pos);
      if (at === -1) return;
      pos = at + t.length;
    }
    if (gaps === undefined) {
      gaps = merged.gaps.map((gp) => ({ ...gp }));
    }
    const slot = oi + 1;
    for (let k = p + 2; k <= j + 1; k++) {
      const dead = prev.gaps[k];
      if (dead.sp === "") continue;
      gaps[slot] = orInto(
        {
          ...gaps[slot],
          sp: gaps[slot].sp + dead.sp,
        },
        "sp",
        dead.spAuthored
      );
      changed = true;
    }
  });
  return changed && gaps !== undefined
    ? { ...merged, gaps }
    : merged;
}

/** SPLIT routing: at each sentinel that a split
 *  created, reset its owned gap's word-insertion
 *  default (inserted sentinels only) and divide
 *  the carried other side of the gap to its left
 *  at the trailing newline run. The edited side
 *  needs no routing — the editor's normalizer
 *  consumed the run in the doc, so the parse is
 *  already divided.
 *
 *  ROUTING FOLLOWS THE CONSUMED RUN, NOT SENTINEL
 *  IDENTITY. "Which sentinel is the new one" is
 *  not always decidable: sentinels are identical
 *  anchors, so a run of ADJACENT output sentinels
 *  (an empty paragraph — exactly what Enter-Enter
 *  at a paragraph end produces) leaves the LCS
 *  free to call either one the insertion, and it
 *  picks the later one. Keying the division on
 *  `inserted` alone therefore divided an empty gap
 *  and left the consumed run's latin "\n\n"
 *  sitting in the split block, on the single most
 *  common editing gesture in any document with
 *  more than one paragraph.
 *  A MATCHED sentinel therefore also divides, but
 *  only on TWO pieces of positive evidence that a
 *  split happened at ITS boundary:
 *   1. its adjacent-sentinel RUN contains an
 *      insertion — i.e. a boundary really was
 *      created here, and the only reason this
 *      sentinel is the matched one is the tie above.
 *      A lone matched sentinel is a boundary that
 *      merely SURVIVED and must never divide.
 *   2. the edited side's newline count in the gap to
 *      its left SHRANK against the prev gap that
 *      carried into it (the run the split consumed).
 *  Both are required. Dropping 1 misfires on a
 *  compound count-changing transaction that shrinks a
 *  newline run in the trailing gap of a block whose
 *  boundary SURVIVES (delete paragraph 0's trailing
 *  break and join paragraphs 1+2 in one
 *  transaction): division would run at paragraph 0's
 *  surviving boundary and eat the latin "\n" that
 *  the Enter default deliberately leaves behind on a
 *  line join — and the equal-count fast path, given
 *  the same edit, preserves it. Dropping 2 would
 *  divide at a boundary next to an unrelated new
 *  empty paragraph — an Enter-Enter at the START of
 *  the next paragraph puts an insertion in this
 *  sentinel's run, so requirement 1 holds where
 *  nothing was consumed, and the division eats the
 *  surviving latin "\n" of an earlier line join.
 *  Each requirement has its own pin in
 *  doc-merge.test.ts ("a SURVIVING boundary does not
 *  divide when an unrelated edit shrinks the run in
 *  its left gap" for 1, "...when the run's insertion
 *  is an Enter-Enter in the NEXT paragraph" for 2),
 *  each verified to fail with its clause removed. */
function routeSplitGaps(
  prev: Block,
  merged: Block,
  prevIndexOf: Array<number | undefined>,
  side: Side
): Block {
  let changed = false;
  const gaps = merged.gaps.map((g) => ({ ...g }));
  const spanOffsets = merged.spans.map((s) => ({
    ...s,
  }));
  const isSent = merged.anchors.map((a) =>
    isSentinel(a)
  );
  /** Does the maximal run of ADJACENT sentinels
   *  containing i include an inserted one? That is
   *  the evidence that a boundary was CREATED in this
   *  run, whichever member of it the LCS happened to
   *  call the insertion. */
  const runHasInsertion = (i: number): boolean => {
    let s = i;
    while (s > 0 && isSent[s - 1]) s -= 1;
    let e = i;
    while (
      e + 1 < merged.anchors.length &&
      isSent[e + 1]
    ) {
      e += 1;
    }
    for (let k = s; k <= e; k++) {
      if (prevIndexOf[k] === undefined) return true;
    }
    return false;
  };
  merged.anchors.forEach((a, i) => {
    if (!isSentinel(a)) return;
    const inserted = prevIndexOf[i] === undefined;
    if (
      inserted &&
      side === "sp" &&
      gaps[i + 1].latin === " " &&
      !isAuthored(gaps[i + 1], "latin")
    ) {
      // never the word-insertion default
      gaps[i + 1] = { ...gaps[i + 1], latin: "" };
      changed = true;
    }
    // ...and neither does the gap to a sentinel's
    // LEFT when the anchor that owns it is itself
    // newly created. The library's creation default
    // is "space unless this anchor is LAST"
    // (merge.ts) — block-local by
    // design. In the flat stream a paragraph's last
    // anchor is not stream-last, so a pasted
    // multi-paragraph insert gave every paragraph a
    // trailing " " that the same content typed into
    // one paragraph never gets: the Latin copy
    // channel then failed its own idempotence law
    // (copy -> paste -> copy grew a space).
    // Only creation defaults are touched — a gap
    // whose anchor came from prev keeps whatever it
    // carried.
    if (
      side === "sp" &&
      i > 0 &&
      prevIndexOf[i - 1] === undefined &&
      gaps[i].latin === " " &&
      !isAuthored(gaps[i], "latin")
    ) {
      gaps[i] = { ...gaps[i], latin: "" };
      changed = true;
    }
    const leftPrev =
      i === 0
        ? 0
        : prevIndexOf[i - 1] !== undefined
          ? prevIndexOf[i - 1]! + 1
          : undefined;
    if (leftPrev === undefined) return;
    if (
      !inserted &&
      !(
        runHasInsertion(i) &&
        countNl(gaps[i][side]) <
          countNl(prev.gaps[leftPrev][side])
      )
    ) {
      return;
    }
    changed = true;
    if (side === "sp") {
      const { left, right } = splitLatin(
        gaps[i].latin
      );
      const srcLatinAuthored = gaps[i].latinAuthored;
      gaps[i] = { ...gaps[i], latin: left };
      gaps[i + 1] = orInto(
        {
          ...gaps[i + 1],
          latin: right + gaps[i + 1].latin,
        },
        "latin",
        right !== "" ? srcLatinAuthored : undefined
      );
    } else {
      const orig = gaps[i].sp;
      const { left, right } = splitLatin(orig);
      const runStart = left.length;
      const crossAt = orig.length - right.length;
      const srcSpAuthored = gaps[i].spAuthored;
      gaps[i] = { ...gaps[i], sp: left };
      const prefixLen = right.length;
      gaps[i + 1] = orInto(
        {
          ...gaps[i + 1],
          sp: right + gaps[i + 1].sp,
        },
        "sp",
        right !== "" ? srcSpAuthored : undefined
      );
      // Offsets indexing the divided gap.
      // endOffset <= runStart: retained boundary in
      // the left half — keep. Inside the consumed
      // run: snap to the deletion site (runStart).
      // Past the run: content crossed the block
      // boundary — DROP by rule (accepted
      // limitation, exact-pinned: the marker snaps
      // to its anchor-adjacent default).
      // Offsets indexing gaps[i + 1] shift by the
      // prepended right-half length.
      // (A span with from === i starts at the
      // sentinel itself and is a straddler —
      // demoteStraddlers owns it; left alone here.)
      for (const s of spanOffsets) {
        if (
          s.to + 1 === i &&
          s.endOffset !== undefined
        ) {
          if (s.endOffset > crossAt) {
            // crossed the boundary: drop by rule
            delete s.endOffset;
          } else if (s.endOffset > runStart) {
            s.endOffset = runStart;
          }
        }
        if (
          s.to + 1 === i + 1 &&
          s.endOffset !== undefined
        ) {
          s.endOffset += prefixLen;
        }
        if (
          s.from === i + 1 &&
          s.startOffset !== undefined
        ) {
          s.startOffset += prefixLen;
        }
      }
      // ...and RESTORE the startOffset of a
      // right-block-first span that merge.ts's
      // ownership rule dropped when the sentinel
      // was freshly INSERTED (a split): that offset
      // indexed the UNDIVIDED prev gap; a marker at
      // or past the run's end sits in the prepended
      // right part and rebases; a marker
      // before/inside the run stays dropped (its
      // content crossed the boundary).
      const rightFirst = i + 1;
      const prevRight = prevIndexOf[rightFirst];
      // OWNERSHIP CONDITION. TWO requirements, and
      // the second is the one that bites:
      //  1. prev gap prevRight IS leftPrev — the
      //     gap that carried into gaps[i]. Else
      //     (anchors died between the two
      //     survivors) ps.startOffset indexes a
      //     dead, unrelated string.
      //  2. that prev string is BYTE-IDENTICAL to
      //     what was divided. crossAt and runStart
      //     are measured on the MERGED string,
      //     while ps.startOffset indexes the PREV
      //     one, so the subtraction is only
      //     meaningful when the two coordinate
      //     systems coincide. They do NOT whenever
      //     the merge itself rewrote the gap:
      //     cleanupJoiners strips an unflanked
      //     joiner from a DISTURBED gap.sp inside
      //     mergeBlockDetailed — always the case at
      //     a fresh sentinel — and a split at
      //     position 0 then made crossAt 2 units
      //     short and slid the marker 2 places into
      //     the surviving spaces: in-range,
      //     checkBlock-clean, silent (pinned in
      //     doc-merge.test.ts).
      // The alternative repair — re-deriving
      // crossAt in PREV coordinates — needs
      // cleanupJoiners' cut map to carry the
      // offset across the rewrite, and that map
      // lives in the FROZEN merge.ts. Dropping is
      // the sound direction (the marker goes to
      // its anchor-adjacent default, gap content
      // is untouched), so an un-rebasable offset
      // drops rather than moving to a wrong place.
      if (
        prevRight !== undefined &&
        prevRight === leftPrev &&
        prev.gaps[leftPrev].sp === orig &&
        inserted
      ) {
        for (const ps of prev.spans) {
          if (
            ps.from !== prevRight ||
            ps.startOffset === undefined ||
            ps.startOffset < crossAt
          ) {
            continue;
          }
          for (const s of spanOffsets) {
            if (
              s.from === rightFirst &&
              s.kind === ps.kind &&
              s.startOffset === undefined
            ) {
              s.startOffset =
                ps.startOffset - crossAt;
              break;
            }
          }
        }
      }
    }
  });
  return changed
    ? { ...merged, gaps, spans: spanOffsets }
    : merged;
}

/** Collapses a string's "\n" run count to at most
 *  one, keeping the FIRST "\n" in place and deleting
 *  every later one. Returns the new string plus the
 *  deletion cuts, in ascending offset order, so a
 *  caller can remap marker offsets through the
 *  rewrite. Non-newline characters are never
 *  touched and no "\n" is ever added. */
function collapseNl(s: string): {
  out: string;
  cuts: Array<{ at: number; len: number }>;
} {
  if (countNl(s) <= 1) {
    return { out: s, cuts: [] };
  }
  let seen = false;
  let out = "";
  const cuts: Array<{ at: number; len: number }> =
    [];
  let off = 0;
  for (const ch of s) {
    if (ch === "\n" && seen) {
      cuts.push({ at: off, len: 1 });
    } else {
      if (ch === "\n") seen = true;
      out += ch;
    }
    off += ch.length;
  }
  return { out, cuts };
}

/** JOIN SEAM RULE. On a count-DECREASING
 *  structural transaction, each dead prev
 *  sentinel's seam gap normalizes its CARRIED
 *  side's newline count:
 *   - SP-side edit (carried latin): to AT MOST one —
 *     one survives if any existed, NONE IS INVENTED.
 *   - LATIN-side edit (carried sp): to EXACTLY one —
 *     runs collapse to one, and one is INVENTED at
 *     the seam when none existed. This mirrors the
 *     standing "SP-join leaves Latin '\n'" rule:
 *     deleting newlines in one pane reshapes only
 *     that pane's lines, and the other pane never
 *     loses a line break it was showing (joining two
 *     plain paragraphs from the Latin pane must not
 *     run the SP glyphs together with no break).
 *     Users who want the panes to agree delete the
 *     SP break in the SP pane. The invented "\n"
 *     goes AT THE SEAM: the junction in front of the
 *     sp that rescueJoinedGaps appended from the
 *     dead sentinel's owned gap, i.e. where the
 *     paragraph boundary used to be. A single "\n"
 *     is a soft break, so nothing re-crystallizes
 *     (only "\n\n" splits) and a second join is a
 *     no-op.
 *  Seams are ENUMERATED from dead prev sentinels
 *  (multi-seam joins included; two seams landing in
 *  one output gap collapse it once), never gated
 *  behind rescueJoinedGaps' early returns. Runs
 *  UNCONDITIONALLY FROM BOTH EDIT SIDES — the
 *  defaults it must follow are sp-gated, so it sits
 *  after the sp defaults block and before
 *  demoteStraddlers (demotion computes marker
 *  offsets against final sp text; this collapse is
 *  a gap rewrite and remaps surviving offsets).
 *
 *  CARRIED SIDE ONLY. The EDITED side of every gap
 *  is PARSE-AUTHORITATIVE: it is the text the user
 *  has in the doc right now, so no pass in this
 *  module may rewrite it (the same reason
 *  rescueJoinedGaps rescues the non-edited side
 *  only and routeSplitGaps divides the carried
 *  side only). Collapsing it loses a user byte:
 *  counterexample — prev [toki·toki with trailing
 *  sp "\n"] + [empty block with leading sp "\n"],
 *  joined by the user into one paragraph whose
 *  parse asserts sp "\n\n" in the seam gap;
 *  collapsing it yields a document whose SP text
 *  is not the parse's SP text. Both of this rule's
 *  jobs live on the carried side anyway: killing
 *  the ping-pong is "a LATIN join must not leave
 *  '\n\n' in the carried gap.sp", and the standing
 *  "SP-join leaves Latin '\n'" rule is about the
 *  carried gap.latin. An sp "\n\n" that the SP
 *  parse itself asserts is the SP normalizer's
 *  business, not this pass's.
 *
 *  EVIDENCE GUARD: sentinel liveness alone is not
 *  decidable evidence (adjacent-sentinel runs let
 *  the LCS pick either member); the collapse
 *  requires the dead sentinel AND a paragraph-count
 *  decrease, else the gap is left untouched.
 *
 *  `side` is the EDITED side (as everywhere else in
 *  this module); the collapse applies to the other. */
export function collapseSeamRuns(
  prev: Block,
  merged: Block,
  prevIndexOf: Array<number | undefined>,
  countDecreased: boolean,
  side: Side
): Block {
  if (!countDecreased) return merged;
  const carried: Side = side === "sp" ? "latin" : "sp";
  const outIndexOfPrev = new Map<number, number>();
  prevIndexOf.forEach((p, i) => {
    if (p !== undefined) outIndexOfPrev.set(p, i);
  });
  // gap index -> total length rescueJoinedGaps
  // appended to it from dead sentinels' owned gaps.
  // The SEAM (where the paragraph boundary was) is the
  // junction in front of that suffix; two seams
  // landing in one gap keep the leftmost junction.
  const targets = new Map<number, number>();
  prev.anchors.forEach((a, p) => {
    if (!isSentinel(a)) return;
    if (outIndexOfPrev.has(p)) return;
    let target = 0;
    for (let q = p - 1; q >= 0; q--) {
      const i = outIndexOfPrev.get(q);
      if (i !== undefined) {
        target = i + 1;
        break;
      }
    }
    targets.set(
      target,
      (targets.get(target) ?? 0) +
        (prev.gaps[p + 1]?.[carried].length ?? 0)
    );
  });
  if (targets.size === 0) return merged;
  const gaps = merged.gaps.map((g) => ({ ...g }));
  const spans = merged.spans.map((s) => ({
    ...s,
  }));
  let changed = false;
  for (const [gi, deadLen] of targets) {
    if (gaps[gi] === undefined) continue;
    if (
      carried === "sp" &&
      countNl(gaps[gi].sp) === 0
    ) {
      // Latin-side join: invent the one "\n" this
      // seam must have (see the docstring).
      const text = gaps[gi].sp;
      let at = text.length - deadLen;
      if (
        at < 0 ||
        at > text.length ||
        !isCodepointBoundary(text, at)
      ) {
        // no recoverable junction (a compound
        // transaction rewrote this gap after the
        // rescue): put the break at the gap's end,
        // still exactly one.
        at = text.length;
      }
      changed = true;
      gaps[gi] = {
        ...gaps[gi],
        sp:
          text.slice(0, at) + "\n" + text.slice(at),
      };
      // Offset remap, INSERTION direction:
      // everything right of the break shifts by
      // one. AT the break the tie goes as in
      // demoteStraddlers (same nesting reason): an
      // END marker closes the line that just ended
      // and stays LEFT, a START marker opens the
      // next line and moves RIGHT.
      for (const s of spans) {
        if (
          s.from === gi &&
          s.startOffset !== undefined &&
          s.startOffset >= at
        ) {
          s.startOffset += 1;
        }
        if (
          s.to + 1 === gi &&
          s.endOffset !== undefined &&
          s.endOffset > at
        ) {
          s.endOffset += 1;
        }
      }
      continue;
    }
    const done = collapseNl(gaps[gi][carried]);
    if (done.cuts.length === 0) continue;
    changed = true;
    gaps[gi] = { ...gaps[gi], [carried]: done.out };
    // Marker offsets index gap.sp, so a removed
    // "\n" before one shifts it left. (Nothing
    // indexes gap.latin, so the latin branch needs
    // no remap.)
    if (carried === "sp") {
      remapGapOffsets(spans, gi, done.cuts);
    }
  }
  return changed
    ? { ...merged, gaps, spans }
    : merged;
}

/** Promotion never crosses a Block boundary: spans
 *  covering a sentinel demote back to transitional
 *  marker chars AT THEIR RECORDED OFFSETS — the
 *  exact inverse of promotion, so demotion is
 *  byte-preserving too. Absent offsets restore
 *  edge-adjacent, as before. Fresh cross-boundary
 *  promotions are the only source; any attrs a
 *  triple-match handed one are dropped with it —
 *  consistent with demotion generally. */
function demoteStraddlers(flat: Block): Block {
  const straddles = (s: Span): boolean =>
    isStructural(s.kind) &&
    flat.anchors.some(
      (a, i) =>
        isSentinel(a) &&
        s.from <= i &&
        i <= s.to
    );
  const bad = sortSpans(
    flat.spans.filter(straddles)
  );
  if (bad.length === 0) return flat;
  const gaps = flat.gaps.map((g) => ({ ...g }));
  // copies: the offset fix-up below mutates them
  const survivors = flat.spans
    .filter((s) => !straddles(s))
    .map((s) => ({ ...s }));
  // gapMarkers over the DEMOTED spans alone gives
  // each restored char its position and the same
  // emission order renderSp would have used.
  const scratch: Block = {
    anchors: flat.anchors,
    gaps,
    spans: bad,
  };
  gaps.forEach((gap, gi) => {
    const marks = gapMarkers(scratch, gi);
    if (marks.length === 0) return;
    let sp = "";
    let cursor = 0;
    let shift = 0;
    for (const m of marks) {
      const ch = structuralChar(m.kind, m.role);
      sp += gap.sp.slice(cursor, m.offset) + ch;
      cursor = m.offset;
      // a surviving span's own offset in this gap
      // moves by every char inserted before it.
      // AT AN EQUAL OFFSET the tie goes by nesting,
      // and the straddler is always the OUTER pair
      // (it reaches across a Block boundary, so a
      // surviving span in this gap is inside it):
      //   - its START goes FIRST, so a survivor's
      //     start at the same offset shifts (>=);
      //   - its END goes LAST, so a survivor's end
      //     at the same offset does NOT (>).
      // Using > on both swapped the two markers:
      // "toki[( jan)" split before the "]" came back
      // as "toki([ jan)".
      for (const s of survivors) {
        if (
          s.from === gi &&
          s.startOffset !== undefined &&
          s.startOffset >= m.offset + shift
        ) {
          s.startOffset += ch.length;
        }
        if (
          s.to + 1 === gi &&
          s.endOffset !== undefined &&
          s.endOffset > m.offset + shift
        ) {
          s.endOffset += ch.length;
        }
      }
      shift += ch.length;
    }
    gaps[gi] = withMark(
      {
        ...gap,
        sp: sp + gap.sp.slice(cursor),
      },
      "sp",
      true
    );
  });
  return {
    anchors: flat.anchors,
    gaps,
    spans: survivors,
  };
}

/** Offset tail guard: the flat path's LAST word on
 *  marker offsets, after every routing pass has
 *  rewritten gaps. Remap-or-drop, NEVER a silent
 *  clamp: an in-bounds offset on a codepoint
 *  boundary passes through (edge-valued offsets
 *  drop to canonical absence); anything else lost
 *  its character boundary to a rewrite this pass
 *  cannot reconstruct, and the marker snaps to its
 *  anchor-adjacent default by rule (the only
 *  editor-reachable producer, registered as an
 *  accepted limitation: a user split through that
 *  spot). Exported for direct testing.
 *
 *  Two drop reasons, deliberately distinguished:
 *  an EDGE-VALUED offset is canonicalized (same
 *  marker position, storage normal form), while an
 *  out-of-range / mid-codepoint one is a MOVE, and
 *  a move nobody registered is a bug in whichever
 *  pass rewrote the gap — so that branch reports
 *  itself (see the tripwire below). Without the
 *  distinction "drop only by rule" would be an
 *  assumption instead of something observable. */
export function revalidateSpanOffsets(
  flat: Block
): Block {
  let changed = false;
  const spans = flat.spans.map((s) => {
    if (
      s.startOffset === undefined &&
      s.endOffset === undefined
    ) {
      return s;
    }
    const out = { ...s };
    const bad = (
      off: number,
      gi: number,
      name: string,
      edge: (len: number) => number
    ): boolean => {
      const sp = flat.gaps[gi]?.sp;
      if (
        sp !== undefined &&
        off === edge(sp.length)
      ) {
        // CANONICALIZATION, not a rule drop: the
        // offset already MEANS anchor-adjacent, so
        // absence is the same marker position (the
        // form checkBlock demands). This is the
        // routing passes' expected exhaust — e.g.
        // the snap to runStart when the consumed
        // run began the divided gap.
        return true;
      }
      if (
        sp === undefined ||
        off < 0 ||
        off > sp.length ||
        !isCodepointBoundary(sp, off)
      ) {
        // TRIPWIRE: reaching here means a routing
        // pass left an offset this function can
        // only DROP, and that drop moves the marker
        // WITHOUT being the registered rule's doing
        // — an unregistered silent snap. The
        // accepted-limitation registry is a closed
        // set, so this must be diagnosed as a
        // routing-pass bug (give the offending pass
        // its own offset remap), never accepted as
        // a new carve-out. Kept as a report rather
        // than a throw: the drop still yields a
        // valid block, and the editor must not lose
        // a keystroke over it.
        console.error(
          "lipu-sitelen-wawa: UNREGISTERED OFFSET " +
            `DROP (${name}) in flat merge — ` +
            "marker snapped outside the registered " +
            "drop rule: " +
            JSON.stringify({ span: s, gap: gi, off })
        );
        return true;
      }
      return false;
    };
    if (
      out.startOffset !== undefined &&
      bad(
        out.startOffset,
        out.from,
        "startOffset",
        (l) => l
      )
    ) {
      delete out.startOffset;
      changed = true;
    }
    if (
      out.endOffset !== undefined &&
      bad(
        out.endOffset,
        out.to + 1,
        "endOffset",
        () => 0
      )
    ) {
      delete out.endOffset;
      changed = true;
    }
    return out;
  });
  return changed ? { ...flat, spans } : flat;
}

/** SPAN KIND-CHANGE RULE: a structural span does
 *  not follow a REPLACEMENT PAIRING onto an anchor
 *  of a different KIND -- it dies instead (a span
 *  may die rather than migrate to a mismatched
 *  anchor).
 *
 *  A replacement pair is the merge saying "the edited
 *  side put something ELSE here", and on the Latin
 *  side the parse has no authority over kind at all
 *  (merge.ts's absorbInto doc comment). Carrying a
 *  cartouche across such a pair made a freshly
 *  pasted "mi" come back as the span's projected
 *  name atom "M": the pane stopped showing what the
 *  user typed. Kind equality is the line -- a word
 *  replaced by a word is a spelling change inside a
 *  name and keeps its span.
 *
 *  Detection needs no new state: prevIndexOf maps an
 *  output anchor to the prev anchor it came from, and
 *  the OTHER two ways an anchor can carry a prev index
 *  (an LCS match, which on a Latin edit returns prev
 *  verbatim, and a re-anchor, which clones prev) can
 *  never change kind. So "mapped to a prev anchor of
 *  a different kind" IS "replacement-paired across a
 *  kind change".
 *
 *  Editor layer, not library: merge.ts is frozen,
 *  and this is a policy about what a span MEANS,
 *  which is exactly the editor's call.
 *
 *  SCOPE: LATIN merges only — both the per-block path
 *  (mergeLatinBlock) and the flat count-changing one,
 *  since the triggering gesture is a paste that can
 *  land on either.
 *
 *  The SP path is excluded for a reason stronger than
 *  authority. On an SP merge the structural spans are
 *  REBUILT from the parsed marker stream:
 *  matchStructuralPairs pairs the marker characters,
 *  removePairChars then CONSUMES those characters out
 *  of the gaps, and spansFromPairs turns the pairs
 *  into the spans (merge.ts). By the time a span
 *  exists on that path, the user's typed marker bytes
 *  have already been absorbed INTO it — the span is
 *  their only surviving representation. Dropping it
 *  would delete typed characters outright, where on a
 *  Latin merge the span is merely CARRIED and
 *  declining to carry it is a licensed span death.
 *
 *  Measured with a counting harness over both corpus
 *  families: running this pass on the SP side of the
 *  flat merge destroys edited-side document text;
 *  Latin-only stays green across families and seeds.
 *  (A counting harness must stop tallying once
 *  fast-check starts SHRINKING, or it counts the
 *  same failure again on every shrink step — an
 *  early, inflated measurement here was exactly
 *  that artifact.) Pinned both ways in
 *  doc-merge.test.ts. */
function dropKindChangedSpans(
  prev: Block,
  block: Block,
  prevIndexOf: Array<number | undefined>
): Block {
  const changed = (i: number): boolean => {
    const p = prevIndexOf[i];
    if (
      p === undefined ||
      prev.anchors[p] === undefined
    ) {
      return false;
    }
    // A SENTINEL is not a user anchor and its pairing
    // is not evidence about anything anyone typed: a
    // prev sentinel positionally replaced by a real
    // anchor (the select-across-boundary-and-type flow
    // in this module's header) is a kind change by
    // construction. A span reaching over a sentinel is
    // a straddler, and demoteStraddlers turns it into
    // literal marker CHARACTERS further down this same
    // pipeline -- dropping it here would delete those
    // bytes instead. Defensive: no corpus run reached
    // the shape (a flattened span never covers a
    // sentinel; only the merge's own span widening can
    // make one), so this guard is unpinned.
    if (
      isSentinel(prev.anchors[p]) ||
      isSentinel(block.anchors[i])
    ) {
      return false;
    }
    return (
      prev.anchors[p].kind !== block.anchors[i].kind
    );
  };
  const spans = block.spans.filter((s) => {
    if (!isStructural(s.kind)) return true;
    for (let i = s.from; i <= s.to; i++) {
      if (changed(i)) return false;
    }
    return true;
  });
  return spans.length === block.spans.length
    ? block
    : { ...block, spans };
}

/** A gap is in cartouche context iff it is
 *  interior to a matched cartouche span, OR it lies
 *  at/after an UNMATCHED cartouche-start char with
 *  no intervening resolution in the same block
 *  (shadow to end-of-block — conservative on
 *  purpose: a missed generation costs one manual
 *  character; a wrong generation plants stale
 *  bytes).
 *
 *  Span membership can ride
 *  a marker OFFSET rather than pure gap position --
 *  gaps[s.to + 1] holds the CARTOUCHE_END char, and
 *  when the span records an `endOffset > 0` the
 *  region BEFORE that offset (normalize.ts's
 *  exteriorSegments) is still interior to the name,
 *  even though the gap itself is not `> s.from &&
 *  <= s.to`. Every owned-class rewrite this predicate
 *  gates (colon prepend, whole-gap "\n"/strip
 *  rewrites) touches the FRONT of the gap, so treating
 *  the whole gap as in-context is the same
 *  conservative-by-construction lean as the shadow
 *  scan below, not a new kind of imprecision. */
export function inCartoucheContext(
  block: Block,
  gi: number
): boolean {
  for (const s of block.spans) {
    if (s.kind !== "cartouche") continue;
    if (gi > s.from && gi <= s.to) return true;
    if (
      gi === s.to + 1 &&
      s.endOffset !== undefined &&
      s.endOffset > 0
    ) {
      return true;
    }
  }
  let depth = 0;
  for (let k = 0; k <= gi; k++) {
    const sp = block.gaps[k]?.sp ?? "";
    for (const ch of sp) {
      if (ch === CARTOUCHE_START) depth += 1;
      else if (ch === CARTOUCHE_END) {
        depth = Math.max(0, depth - 1);
      }
    }
  }
  return depth > 0;
}

/** SP => Latin: a free-standing mappable char is
 *  a middle dot or colon glyph in sp bytes. Whether
 *  it is IN cartouche context (a shadowed dot, not
 *  mappable) is decided by the caller via
 *  inCartoucheContext -- this is a pure byte test. */
function containsMappable(sp: string): boolean {
  return (
    sp.includes(MIDDLE_DOT_CH) ||
    sp.includes(COLON_CH)
  );
}

/** "Derived" is stored NOWHERE -- decided
 *  statelessly from bytes: latin side default AND
 *  either the PREV or the OUT gap.sp holds a
 *  free-standing mappable char, outside cartouche
 *  context (a shadowed dot is NOT mappable, so the
 *  gap is non-derived and the plain delta
 *  arithmetic applies). The prev-side disjunct is
 *  load-bearing: deleting the last "·" must
 *  re-derive latin to the plain separator.
 *
 *  Each mappable side must ALSO be AUTHORED sp --
 *  a machine-planted glyph (e.g. the default
 *  colon) is never a derivation source. Without
 *  this, deleting a generated Latin ": " left the
 *  default sp colon behind, and any later
 *  unrelated sp edit resurrected the deleted Latin
 *  bytes. Only user-typed punctuation derives.
 *
 *  No gi/gap-0 exclusion here, unlike Latin=>SP's
 *  generateSpFromLatin (gap 0 never generates a
 *  leading break). SP=>Latin is a faithful mapping
 *  of whatever bytes already exist, not a
 *  break-inserter, so a leading "·" in gap 0 DOES
 *  derive to "." -- intentional, pinned. */
/** A gap "vouches" for an SP=>Latin derivation
 *  only when its mappable char is BOTH present and
 *  user-AUTHORED -- a machine-planted glyph never
 *  derives. Factored out of isDerivedGap so
 *  applyContextRederivation's class 3 can share
 *  the exact same predicate rather than restating
 *  a narrower one that a machine colon could sneak
 *  through. */
function vouchesForDerivation(g: Gap): boolean {
  return containsMappable(g.sp) && isAuthored(g, "sp");
}

function isDerivedGap(
  prevGap: Gap | undefined,
  g: Gap,
  inContext: boolean
): boolean {
  return (
    !inContext &&
    !isAuthored(g, "latin") &&
    (vouchesForDerivation(g) ||
      (prevGap !== undefined &&
        vouchesForDerivation(prevGap)))
  );
}

/** The SP=>Latin mapping: MIDDLE_DOT_CH => ".",
 *  COLON_CH => ":", "\n" => "\n", other sp layout
 *  chars => " " (collapsing runs); one " " appended
 *  after a final "."/":" in interior gaps; surplus
 *  latin newlines (prev-baselined) appended at the
 *  end. */
function transliterateSp(
  sp: string,
  interior: boolean,
  surplus: number
): string {
  let out = "";
  for (const ch of sp) {
    if (ch === MIDDLE_DOT_CH) out += ".";
    else if (ch === COLON_CH) out += ":";
    else if (ch === "\n") out += "\n";
    else out += " ";
  }
  out = out.replace(/ {2,}/g, " ");
  if (interior && /[.:]$/.test(out)) out += " ";
  return out + "\n".repeat(surplus);
}

/** Named apart from the firing gate in
 *  generateSpFromLatin (~40 lines below) ON PURPOSE
 *  -- the two answer different questions and must
 *  NOT be unified. This one answers the SP=>Latin
 *  SPACING question ("one ' ' appended after a
 *  final '.'/':' in interior gaps"); the firing
 *  gate governs only Latin=>SP's firing POSITION.
 *  isDerivedGap carries no gi/sentinel gating at
 *  all, so a block-final derived gap still derives
 *  -- e.g. "." with no trailing space -- and
 *  self-heals to the interior spacing the moment a
 *  following word makes it interior (pinned: "a
 *  block-final '·' still derives"). Loosely
 *  mirrors provenance.ts's gapPosition vocabulary
 *  (gap0/interior/final) but this one is
 *  sentinel-aware, which gapPosition is not. */
function isInteriorForSpacing(
  block: Block,
  gi: number
): boolean {
  return (
    gi > 0 &&
    gi <= block.anchors.length - 1 &&
    !isSentinel(block.anchors[gi - 1]) &&
    !isSentinel(block.anchors[gi])
  );
}

/** Wholesale re-derivation for derived gaps.
 *  Sp-edited merges only; fixpoint-shaped (writes
 *  only when the derived image differs), which is
 *  what makes shadow-EXIT re-generation work with
 *  no byte-change trigger (pinned) and makes a
 *  no-op merge a no-op here. Latin is the CARRIED
 *  side on sp merges, so rewriting a default latin
 *  side here respects parse authority. */
function applyDerivedTransliteration(
  prev: Block,
  merged: Block,
  prevIndexOf: Array<number | undefined>
): Block {
  let changed = false;
  const gaps = merged.gaps.map((g, gi) => {
    const p = carriedPrevGap(prevIndexOf, gi);
    const prevGap =
      p !== undefined ? prev.gaps[p] : undefined;
    if (
      !isDerivedGap(
        prevGap,
        g,
        inCartoucheContext(merged, gi)
      )
    ) {
      return g;
    }
    const interior = isInteriorForSpacing(merged, gi);
    // surplus baselined on PREV -- the NEW sp
    // would resurrect the Enter/delete ratchet
    const surplus =
      prevGap !== undefined
        ? Math.max(
            0,
            countNl(prevGap.latin) -
              countNl(prevGap.sp)
          )
        : 0;
    const derived = transliterateSp(
      g.sp,
      interior,
      surplus
    );
    if (derived === g.latin) return g;
    changed = true;
    // stamped default: the target was default
    // (isDerivedGap requires it) and stays so
    return { ...g, latin: derived };
  });
  return changed ? { ...merged, gaps } : merged;
}

/** Latin => SP generation (the sentence rule and
 *  the colon rule) and symmetric colon WITHDRAWAL
 *  (plant and withdraw share the trigger
 *  discipline, so generation is not a plant-only
 *  ratchet). LATIN-edited merges only, slotted
 *  immediately after routeSplitGaps so its guards
 *  read post-rescue, post-route bytes. */
const SENTENCE_END = /[.!?]["'’”»›)\]]*\s*$/;
const COLON_END = /:\s*$/;

function generateSpFromLatin(
  prev: Block,
  merged: Block,
  prevIndexOf: Array<number | undefined>
): Block {
  let changed = false;
  // withdrawal cuts per gap index, for the
  // span-offset remap below.
  const cutsByGap = new Map<
    number,
    Array<{ at: number; len: number }>
  >();
  const gaps = merged.gaps.map((g, gi) => {
    // Gap 0 never generates (no leading breaks),
    // and a sentinel-adjacent gap in the flat
    // stream never generates (paste protection).
    // The block-final gap otherwise generates like
    // any interior gap -- live typing at the end of
    // a paragraph must fire at that keystroke, not
    // be silently suppressed forever (the bytes are
    // then CARRIED, not newly written, once the gap
    // turns interior, so the authored-write trigger
    // never re-fires).
    if (
      gi === 0 ||
      isSentinel(merged.anchors[gi - 1]) ||
      (gi < merged.anchors.length &&
        isSentinel(merged.anchors[gi]))
    ) {
      return g;
    }
    // trigger (a): this merge's EDITED side wrote
    // the bytes (fresh gap, or byte-change vs the
    // prev gap that carried in)
    const p = carriedPrevGap(prevIndexOf, gi);
    const latinChanged =
      p === undefined ||
      prev.gaps[p].latin !== g.latin;
    if (!latinChanged) return g;
    // SYMMETRIC COLON WITHDRAWAL: a machine-planted
    // DEFAULT colon whose latin trigger no longer
    // matches is withdrawn at the same edited-side
    // byte-change that lapsed it. This is what
    // makes live typing of "http://x" / "3:30"
    // self-correct — the glyph fires at the ":"
    // keystroke (terminal at that instant) and
    // re-derives away at the next one. Sits BEFORE
    // the authored-latin gate (trigger b) ON
    // PURPOSE: deleting the generated ": " leaves a
    // DEFAULT latin " ", and that delete must
    // withdraw too (the stale-byte shape, cured at
    // the source). COLON GLYPHS ONLY — a generated
    // "\n" is NEVER withdrawn (the dwell guard's
    // newline-monotonicity stands; paragraph flow
    // may build on a generated break). Authored sp
    // never withdraws; in-context machine colons
    // belong to the context re-derivation's class
    // 1, not this pass. The context gate is
    // OWNERSHIP hygiene, byte-identical in output
    // to letting class 1 clean up (it runs right
    // after, presence-based, same cuts remap) — so
    // no fixture can discriminate the gate itself.
    // If class 1's scope is ever NARROWED, the
    // cartouche-guard pin
    // (doc-merge.provenance.test.ts, unmatched-"["
    // shadow + lapsed machine colon) inherits the
    // discrimination duty: it fails the moment
    // in-context lapsed colons stop being removed,
    // forcing this gate to be revisited.
    if (
      g.sp.includes(COLON_CH) &&
      !isAuthored(g, "sp") &&
      !COLON_END.test(g.latin) &&
      !inCartoucheContext(merged, gi)
    ) {
      const { out, cuts } = stripColonGlyphs(g.sp);
      cutsByGap.set(gi, cuts);
      changed = true;
      return { ...g, sp: out };
    }
    // trigger (b): the triggering bytes classify
    // AUTHORED; (c): the target side is DEFAULT
    if (!isAuthored(g, "latin")) return g;
    if (isAuthored(g, "sp")) return g;
    // marker offsets index gap.sp: a sentence
    // REPLACE is not soundly remappable, so it
    // defers (never a silent marker move); the
    // colon PREPEND shifts offsets and is handled
    // below.
    const hasOffsets = merged.spans.some(
      (s) =>
        (s.from === gi &&
          s.startOffset !== undefined) ||
        (s.to + 1 === gi &&
          s.endOffset !== undefined)
    );
    if (
      SENTENCE_END.test(g.latin) &&
      !inCartoucheContext(merged, gi)
    ) {
      // dwell guard: newline-monotone — never
      // rewrite a target holding any "\n"
      if (countNl(g.sp) > 0) return g;
      if (hasOffsets) return g;
      changed = true;
      return { ...g, sp: "\n" };
    }
    if (
      COLON_END.test(g.latin) &&
      !inCartoucheContext(merged, gi) &&
      !g.sp.includes(COLON_CH)
    ) {
      changed = true;
      return { ...g, sp: COLON_CH + g.sp };
    }
    return g;
  });
  if (!changed) return merged;
  // colon prepends shifted gap.sp coordinates:
  // remap marker offsets indexing a prepended gap.
  // Withdrawal DELETED colon bytes: remap offsets
  // indexing a withdrawn gap through the recorded
  // cuts. The two gap sets are disjoint (a gap
  // either gained or lost its colon this pass), so
  // composing both adjustments is exact.
  const spans = merged.spans.map((s) => {
    const shifted = { ...s };
    const shiftFor = (gi: number): number =>
      gaps[gi].sp !== merged.gaps[gi].sp &&
      gaps[gi].sp ===
        COLON_CH + merged.gaps[gi].sp
        ? COLON_CH.length
        : 0;
    const remapFor = (
      gi: number,
      o: number
    ): number => {
      const cuts = cutsByGap.get(gi);
      if (cuts === undefined) return o;
      return remapThroughCuts(cuts, o);
    };
    if (shifted.startOffset !== undefined) {
      shifted.startOffset = remapFor(
        shifted.from,
        shifted.startOffset
      );
      shifted.startOffset += shiftFor(shifted.from);
    }
    if (shifted.endOffset !== undefined) {
      shifted.endOffset = remapFor(
        shifted.to + 1,
        shifted.endOffset
      );
      shifted.endOffset += shiftFor(shifted.to + 1);
    }
    return shifted;
  });
  return { ...merged, gaps, spans };
}

/** CONSUMED-TRIGGER BREAK WITHDRAWAL — the ONLY
 *  break withdrawal; newline-monotonicity holds
 *  everywhere else (paragraph flow built on
 *  surviving breaks is never disturbed).
 *  STATELESS: reads prev + out only, no history. A
 *  generated DEFAULT lone "\n" is withdrawn when,
 *  in this same merge, its triggering latin bytes
 *  were consumed into the flanking bound token:
 *  prev gap.latin matched SENTENCE_END, the out
 *  gap no longer does, and the prev flank's
 *  rendered latin + the trigger bytes now sit
 *  INSIDE the left-flank marked verbatim's text
 *  ('toki.' fires, 'toki.p' binds => the break
 *  goes; 'toki. p' keeps the dot in the gap =>
 *  the break stays). Restored bytes: the plain
 *  default separator the position rule dictates —
 *  interior " ", block-final "" — stamped default
 *  (the gap was default; nothing re-marks it).
 *
 *  READS THE CARRIED PREV GAP, NOT THE MERGED
 *  GAP'S AGGREGATE MARK: the withdrawal predicate
 *  below tests prevGap's own bytes/mark
 *  (prev.gaps[p]) and strips only a LEADING "\n",
 *  rather than requiring g.sp === "\n" exactly on
 *  the merged gap. The fusion rescue
 *  (rescueFusedGaps) concatenates a fused run's
 *  surviving trailing gap AFTER the carried gap
 *  p+1's own bytes (carried gap first, dying
 *  interiors appended) -- so a consumed-trigger's
 *  withdrawable default "\n" can sit as a PREFIX
 *  of a composite gap whose aggregate mark got
 *  OR'd authored by an appended rescued byte (the
 *  fusion shape: "toki. pona" + an authored
 *  trailing "\n", space deleted => "toki.pona"). A
 *  guard reading the COMPOSITE's own mark can
 *  never fire there -- the OR always sets it once
 *  ANY appended piece is authored, even though the
 *  LEADING default piece is independently and
 *  provably withdrawable on its own terms;
 *  default-ness attaches to the byte being
 *  withdrawn, which is prevGap's, not the
 *  composite's. Slicing off exactly one leading
 *  "\n" removes nothing else -- the appended
 *  remainder (its bytes, its own authored-ness)
 *  rides through untouched. On every non-composite
 *  fixture prevGap.sp === g.sp exactly (no rescue
 *  append occurred), so slicing one "\n" off a
 *  lone "\n" restores the same "" / " " a
 *  whole-gap-shape guard would stamp -- see the
 *  composite-withdrawal pins
 *  (doc-merge.binding.test.ts) and the
 *  non-composite withdrawal pins alongside them. */
function withdrawConsumedBreaks(
  prev: Block,
  merged: Block,
  prevIndexOf: Array<number | undefined>
): Block {
  let changed = false;
  const gaps = merged.gaps.map((g, gi) => {
    if (gi === 0) return g;
    const p = carriedPrevGap(prevIndexOf, gi);
    if (p === undefined) return g;
    const prevGap = prev.gaps[p];
    if (
      prevGap.sp !== "\n" ||
      isAuthored(prevGap, "sp")
    ) {
      return g;
    }
    if (!g.sp.startsWith("\n")) return g;
    const m = SENTENCE_END.exec(prevGap.latin);
    if (m === null) return g;
    if (SENTENCE_END.test(g.latin)) return g;
    const flank = merged.anchors[gi - 1];
    if (
      flank === undefined ||
      flank.kind !== "verbatim" ||
      flank.marked !== true ||
      isSentinel(flank)
    ) {
      return g;
    }
    const prevFlank = prev.anchors[p - 1];
    const prevFlankText =
      prevFlank !== undefined &&
      !isSentinel(prevFlank)
        ? anchorLatinText(prevFlank)
        : "";
    const trigger = m[0].replace(/\s+$/, "");
    if (
      !(flank.text ?? "").includes(
        prevFlankText + trigger
      )
    ) {
      return g;
    }
    changed = true;
    return {
      ...g,
      sp:
        (isInteriorForSpacing(merged, gi)
          ? " "
          : "") + g.sp.slice(1),
    };
  });
  return changed ? { ...merged, gaps } : merged;
}

/** Context re-derivation, NARROW: touches ONLY
 *  generator-owned byte classes on DEFAULT sides
 *  in cartouche context — (1) a generation-planted
 *  COLON_CH (sp), (2) the generated whole-side
 *  "\n" (sp, freshly-entered contexts only), (3) a
 *  transliteration-derived latin image (leading
 *  "."/":" plus its appended " ", only where a
 *  mappable sp char — prev or out — vouches for
 *  the derivation). Everything else on the side
 *  survives (demoted markers included). Parse
 *  authority: sp bytes are removable only when sp
 *  is CARRIED (editedSide "latin"); latin bytes
 *  only when latin is carried (editedSide "sp").
 *
 *  DESIGN NOTE (declared deviation): this pass is
 *  PRESENCE-BASED rather than event-enumerated — a
 *  gap in context holding generator-owned bytes IS
 *  the stale state, so one idempotent pass covers
 *  every trigger (promotion, demotion, demote
 *  restores, shadow entry/exit, block split/join)
 *  by construction at the next merge with a
 *  carried-side opportunity. Owned class 3 (the
 *  latin derived-image strip) fires on UNDISTURBED
 *  gaps too -- required for shadow ENTRY to clear a
 *  stale ". " that predates the "[" (the entering
 *  "[" disturbs bytes around the CARTOUCHE gap,
 *  not the dot gap). Owned class 2 (the generated
 *  "\n") is restricted to freshly ENTERED contexts
 *  (prev gap out of context) so a long-standing
 *  default break inside an old doc's cartouche is
 *  never eaten -- generation never plants
 *  in-context, so entry is the only way a
 *  generated break gets there.
 *
 *  The premise above requires BOTH
 *  generateSpFromLatin rules to be gated on
 *  inCartoucheContext, not just the colon rule --
 *  the SENTENCE_END rule carries the same
 *  `!inCartoucheContext(merged, gi)` guard the
 *  colon rule has (a Latin "." typed inside a
 *  cartouche used to plant sp "\n" straight into
 *  the name, with no owned class able to remove it
 *  since class 2's own freshly-entered restriction
 *  declines on an already-in-context prevGap). */
function applyContextRederivation(
  prev: Block,
  merged: Block,
  prevIndexOf: Array<number | undefined>,
  editedSide: Side
): Block {
  let changed = false;
  const gaps = merged.gaps.map((g) => ({ ...g }));
  const spans = merged.spans.map((s) => ({ ...s }));
  merged.gaps.forEach((g, gi) => {
    if (!inCartoucheContext(merged, gi)) return;
    const p = carriedPrevGap(prevIndexOf, gi);
    const prevGap =
      p !== undefined ? prev.gaps[p] : undefined;
    if (editedSide === "latin") {
      if (isAuthored(g, "sp")) return;
      if (
        g.sp === "\n" &&
        prevGap !== undefined &&
        !inCartoucheContext(prev, p!)
      ) {
        // owned class 2: the sentence generator's
        // whole-side image, carried into a context
        // it was planted outside of
        const interior =
          gi > 0 &&
          gi <= merged.anchors.length - 1;
        gaps[gi] = {
          ...gaps[gi],
          sp: interior ? " " : "",
        };
        changed = true;
        return;
      }
      if (g.sp.includes(COLON_CH)) {
        // owned class 1: machine colon meets a
        // cartouche — the carried-side opportunity.
        // Offsets indexing this gap remap through
        // the deletions.
        const { out, cuts } = stripColonGlyphs(
          g.sp
        );
        gaps[gi] = { ...gaps[gi], sp: out };
        remapGapOffsets(spans, gi, cuts);
        changed = true;
      }
      return;
    }
    // editedSide === "sp": latin is carried
    if (isAuthored(g, "latin")) return;
    if (
      /^[.:]/.test(g.latin) &&
      (vouchesForDerivation(g) ||
        (prevGap !== undefined &&
          vouchesForDerivation(prevGap)))
    ) {
      // owned class 3: strip the derived punct and
      // its appended separator; gated on the SAME
      // authored-sp vouching isDerivedGap requires,
      // so a machine-planted glyph (the default
      // colon) never vouches for stripping a
      // genuinely user-authored latin image sitting
      // next to it; any surplus "\n"s survive
      // (newline-monotone)
      gaps[gi] = {
        ...gaps[gi],
        latin: g.latin.slice(1).replace(/^ /, ""),
      };
      changed = true;
    }
  });
  return changed
    ? { ...merged, gaps, spans }
    : merged;
}

/** Facet-unfold net. Block-level detection: a
 *  DEFAULT COLON_CH present in some prev gap,
 *  absent from every output gap, in a merge that
 *  minted a word-style nameScheme => unfold that
 *  scheme, BYTE-PRESERVING: strip the minted facet
 *  AND reinstate the literal COLON_CH at offset 0
 *  of the gap following the stripped anchor, mark
 *  still default. Neighborhood: the fold host is
 *  the colon gap's LEFT flank (parseSp folds onto
 *  the PRECEDING word only), located via
 *  prevIndexOf on the gap's matched flanking
 *  anchors; fresh anchors qualify only strictly
 *  BETWEEN the mapped flanks. A mint on the RIGHT
 *  flank is a same-merge typed-colon candidate and
 *  is never unfolded (false-negative over
 *  false-positive: a false positive demotes the
 *  user's authored scheme to a default byte).
 *  Authored prev colons never satisfy the
 *  predicate (their folds are intentional
 *  behavior); a same-merge typed colon was never
 *  in prev, so no false strip. Minting implies
 *  depth (only the depth-gated fold writes
 *  {style:"word"} on a merge), so no separate
 *  depth re-check. A further accepted
 *  false-negative: if the vanished gap's
 *  LEFT-flank anchor is itself deleted in this
 *  same merge (outIndexOfPrev has no entry for
 *  pgi - 1), both disjuncts fail and the gap is
 *  skipped entirely -- a fold minted on a fresh
 *  anchor in that region survives unfolded. Same
 *  false-negative-over-false-positive direction as
 *  above. */
function unfoldMintedScheme(
  prev: Block,
  merged: Block,
  prevIndexOf: Array<number | undefined>
): Block {
  const vanished: number[] = [];
  prev.gaps.forEach((pg, pgi) => {
    if (
      !isAuthored(pg, "sp") &&
      pg.sp.includes(COLON_CH)
    ) {
      vanished.push(pgi);
    }
  });
  if (vanished.length === 0) return merged;
  if (
    merged.gaps.some((g) =>
      g.sp.includes(COLON_CH)
    )
  ) {
    return merged;
  }
  const minted: number[] = [];
  merged.anchors.forEach((a, i) => {
    if (
      a.kind !== "word" ||
      a.nameScheme === undefined ||
      a.nameScheme.style !== "word"
    ) {
      return;
    }
    const p = prevIndexOf[i];
    if (
      p !== undefined &&
      prev.anchors[p]?.nameScheme?.style === "word"
    ) {
      return; // carried, not minted
    }
    minted.push(i);
  });
  if (minted.length === 0) return merged;
  const outIndexOfPrev = new Map<number, number>();
  prevIndexOf.forEach((p, i) => {
    if (p !== undefined) outIndexOfPrev.set(p, i);
  });
  const anchors = merged.anchors.slice();
  const gaps = merged.gaps.map((g) => ({ ...g }));
  const spans = merged.spans.map((s) => ({ ...s }));
  let changed = false;
  for (const pgi of vanished) {
    const leftOut =
      pgi === 0 ? -1 : outIndexOfPrev.get(pgi - 1);
    const rightOut =
      pgi === prev.anchors.length
        ? merged.anchors.length
        : outIndexOfPrev.get(pgi);
    const idx = minted.findIndex(
      (i) =>
        (leftOut !== undefined &&
          leftOut >= 0 &&
          i === leftOut) ||
        (prevIndexOf[i] === undefined &&
          leftOut !== undefined &&
          rightOut !== undefined &&
          i > leftOut &&
          i < rightOut)
    );
    if (idx === -1) continue;
    const m = minted[idx];
    minted.splice(idx, 1);
    const na = { ...anchors[m] };
    delete na.nameScheme;
    anchors[m] = na;
    gaps[m + 1] = {
      ...gaps[m + 1],
      sp: COLON_CH + gaps[m + 1].sp,
    };
    // The prepend shifts offsets indexing the
    // reinstatement gap. ASYMMETRIC by construction
    // (normalize.ts, frozen): a span's startOffset,
    // when absent, means "end of gaps[from].sp" --
    // a prepend at offset 0 lands BEFORE that
    // boundary, so an absent startOffset needs no
    // shift (it still means the same place).
    // endOffset, when absent, means offset 0 --
    // normalize.ts OMITS it exactly at that value
    // (`if (end !== 0) span.endOffset = end`) -- so
    // an absent endOffset is NOT "no shift needed"
    // the way an absent startOffset is: 0 is itself
    // a real, shiftable position (immediately
    // before the reinstated colon), just not one
    // normalize.ts spells out. Gating this shift on
    // `!== undefined` silently drops it for every
    // edge-adjacent end marker (the common case),
    // pushing the reinstated colon outside the
    // cartouche and permanently corrupting the
    // render (the escaped colon sits at depth 0, so
    // nothing ever re-folds it). Always materialize
    // the shift.
    for (const s of spans) {
      if (
        s.from === m + 1 &&
        s.startOffset !== undefined
      ) {
        s.startOffset += COLON_CH.length;
      }
      if (s.to + 1 === m + 1) {
        s.endOffset =
          (s.endOffset ?? 0) + COLON_CH.length;
      }
    }
    changed = true;
  }
  return changed
    ? { ...merged, anchors, gaps, spans }
    : merged;
}

/** The SP-side pass chain, shared verbatim by the
 *  per-block merge (mergeSpBlock) and the flat
 *  structural sp arm (mergeStructural) so the two
 *  can never drift apart: derived transliteration,
 *  context re-derivation, the Enter default, the
 *  separation default, then the letterish
 *  fusion-safety pass.
 *
 *  The letterish pass re-runs AFTER the separation
 *  default, as the last step. An SP edit is the
 *  one gesture the editor's load-boundary pass
 *  never sees again -- it can newly abut the SP
 *  edit's own output against stored letter-ish
 *  gap.latin, or uncover a cartouche flank that
 *  was exempt at load time -- so this
 *  re-establishes the fusion-safety invariant the
 *  boundary pass alone can't maintain past the
 *  first SP edit. Identity on any block already at
 *  the fixpoint (pinned), so this is a no-op cost
 *  for documents already in normal form. */
function runSpPasses(
  prev: Block,
  merged: Block,
  prevIndexOf: Array<number | undefined>
): Block {
  return normalizeLetterishLatin(
    applySeparationDefaults(
      applyEnterDefaults(
        prev,
        applyContextRederivation(
          prev,
          applyDerivedTransliteration(
            prev,
            merged,
            prevIndexOf
          ),
          prevIndexOf,
          "sp"
        ),
        prevIndexOf
      )
    )
  );
}

/** The Latin-side generation chain, shared
 *  verbatim by the per-block merge
 *  (mergeLatinBlock) and the flat structural latin
 *  arm (mergeStructural) so the two can never
 *  drift apart: Latin=>SP generation,
 *  consumed-trigger break withdrawal, context
 *  re-derivation, then the marked-verbatim SP
 *  separation default. */
function runLatinPasses(
  prev: Block,
  merged: Block,
  prevIndexOf: Array<number | undefined>
): Block {
  return applyMarkedVerbatimSpDefault(
    applyContextRederivation(
      prev,
      withdrawConsumedBreaks(
        prev,
        generateSpFromLatin(
          prev,
          merged,
          prevIndexOf
        ),
        prevIndexOf
      ),
      prevIndexOf,
      "latin"
    ),
    prev,
    prevIndexOf
  );
}

/** Per-block editor merge (the non-structural
 *  transaction path). */
export function mergeSpBlock(
  prev: Block,
  parsed: ParsedSide
): Block {
  const { block, prevIndexOf } = mergeBlockDetailed(
    prev,
    parsed,
    "sp"
  );
  const marked = reattachProvenance(
    prev,
    block,
    prevIndexOf,
    "sp"
  );
  // the facet-unfold net runs IMMEDIATELY after
  // reattachProvenance, on pristine merge output
  // -- before the pass chain below.
  const unfolded = unfoldMintedScheme(
    prev,
    marked,
    prevIndexOf
  );
  return runSpPasses(prev, unfolded, prevIndexOf);
}

/** Per-block editor merge, Latin side: no Latin
 *  analogue of the Enter default (a Latin Enter
 *  must not create SP breaks) and no separation
 *  default on a parse-authoritative Latin edit --
 *  but exactly ONE SP-side separation default
 *  runs, protecting the NON-edited (carried) side:
 *  see applyMarkedVerbatimSpDefault. */
export function mergeLatinBlock(
  prev: Block,
  parsed: ParsedSide
): Block {
  const { block, prevIndexOf } = mergeBlockDetailed(
    prev,
    parsed,
    "latin"
  );
  const marked = reattachProvenance(
    prev,
    block,
    prevIndexOf,
    "latin"
  );
  return runLatinPasses(
    prev,
    rescueFusedGaps(
      prev,
      dropKindChangedSpans(
        prev,
        marked,
        prevIndexOf
      ),
      prevIndexOf
    ),
    prevIndexOf
  );
}

/** The SP analogue of the separation default, and
 *  the ONLY default the Latin merge path applies.
 *  mergeLatinBlock's creation default leaves a
 *  freshly promoted anchor's owned gap.sp "" --
 *  correct in isolation, since the SP side was not
 *  edited -- but renderSp coalesces two adjacent
 *  MARKED VERBATIM anchors into ONE inline text
 *  node purely because both sides of the gap
 *  render with the SAME `verbatim` inline flag
 *  (render-sp.ts's pushText); gap content itself
 *  renders with verbatim=false, so this is the one
 *  shape where an empty gap.sp is genuinely
 *  ambiguous, not just idle. A single " " breaks
 *  the coalescing (it renders as its own
 *  non-verbatim inline run) without touching the
 *  Latin projection at all, so it cannot disturb
 *  the side that was just edited -- the same
 *  "protects the carried side, invisible to the
 *  edited side" shape as the separation default
 *  itself.
 *
 *  SCOPED TO ADJACENCY-LEVEL FRESHNESS
 *  (ANCHOR-level freshness, prevIndexOf undefined
 *  on a flank, is necessary but NOT sufficient):
 *  skip the default only when both flanks were
 *  matched to prev AND were ALREADY ADJACENT there
 *  (prevIndexOf[gi] === prevIndexOf[gi - 1] + 1).
 *  Two anchors can each be individually CARRIED
 *  (both prevIndexOf defined) and still mint a
 *  fresh SP-degenerate adjacency: a Latin delete
 *  of a WORD anchor sitting between two marked
 *  verbatims (prev "xq" | word | "ax") drops only
 *  the word from the parse -- "xq" and "ax" are
 *  both carried, individually unchanged, but newly
 *  NEXT TO EACH OTHER, with a fresh gap.sp "" from
 *  the same creation-default path a true mint
 *  would get. An anchor-level check misses this
 *  (both flanks defined => skipped) and reopens
 *  the coalescing bug through ordinary word
 *  deletion. The ADJACENCY check still correctly
 *  stays silent on a genuine no-op reparse (every
 *  flank matches AND stays adjacent, so prevRight
 *  === prevLeft + 1) -- required so a second,
 *  unrelated no-op call does not keep finding the
 *  same already-settled pair as new (a
 *  cartouche-covered anchor freshly split next to
 *  a promoted "ax"). "Mints an SP-degenerate
 *  adjacency" is about the ADJACENCY being new,
 *  not necessarily either anchor being new -- this
 *  is that condition read literally. */
export function applyMarkedVerbatimSpDefault(
  block: Block,
  prev: Block,
  prevIndexOf: Array<number | undefined>
): Block {
  const isMarkedVerbatim = (a: Anchor): boolean =>
    a.kind === "verbatim" && a.marked === true;
  let changed = false;
  const gaps = block.gaps.map((g, gi) => {
    if (g.sp !== "") return g;
    if (isAuthored(g, "sp")) return g;
    if (gi === 0 || gi > block.anchors.length - 1) {
      return g;
    }
    if (
      isSentinel(block.anchors[gi - 1]) ||
      isSentinel(block.anchors[gi])
    ) {
      return g;
    }
    const prevLeft = prevIndexOf[gi - 1];
    const prevRight = prevIndexOf[gi];
    if (
      prevLeft !== undefined &&
      prevRight !== undefined &&
      prevRight === prevLeft + 1 &&
      isMarkedVerbatim(prev.anchors[prevLeft]) &&
      isMarkedVerbatim(prev.anchors[prevRight])
    ) {
      return g;
    }
    if (
      isMarkedVerbatim(block.anchors[gi - 1]) &&
      isMarkedVerbatim(block.anchors[gi])
    ) {
      changed = true;
      return { ...g, sp: " " };
    }
    return g;
  });
  return changed ? { ...block, gaps } : block;
}

/** Whole-doc structural merge. Block count of the
 *  result always equals parsedSides.length: on the
 *  equal-count fast path by construction, and on the
 *  flat path because every boundary in the output
 *  comes from the fresh parse's sentinels (a prev
 *  sentinel survives only by pairing with a next
 *  one), modulo the sentinel adversarial-paste
 *  caveat.
 *
 *  TWO PATHS: equal paragraph counts merge
 *  per-block positionally; only a count CHANGE (a
 *  split or a join) builds the flat sentinel stream.
 *
 *  side defaults to "sp" (the SP editor's edit
 *  side); "latin" exists for the
 *  anchor-conservation law and for Latin-pane
 *  editing. */
export function mergeStructural(
  prevBlocks: Block[],
  parsedSides: ParsedSide[],
  side: Side = "sp"
): Block[] {
  // ZERO PARAGRAPHS: flattenBlocks([]) and
  // flattenBlocks([a single zero-anchor Block]) are
  // the SAME value — both
  // are {anchors: [], gaps: [{sp:"", latin:""}]},
  // because a Block's gaps are always anchors + 1.
  // rechunk therefore cannot tell them apart and
  // always yields one chunk, which would break this
  // function's own stated invariant (block count ===
  // parsedSides.length) at n = 0. The empty case is
  // resolved HERE, where the count is still known.
  // Unreachable from the editor (a PM doc always has
  // at least one paragraph); the guard exists so the
  // invariant is total, which is what the no-op laws
  // are stated over.
  //
  // Stated honestly: with a NON-EMPTY prev this
  // is a TOTAL DISCARD — every prev block, and all
  // the other-side content its gaps own, is dropped.
  // That is the correct reading of "block count
  // follows the fresh parse" (a doc with no
  // paragraphs holds nothing), and it is exactly
  // what the flat path would do with an empty next
  // stream anyway: no next anchor can pair with any
  // prev anchor, so every prev anchor dies and takes
  // its owned gap with it. The guard changes the
  // COUNT, never the content policy. A caller that
  // reaches this with real content has already lost
  // it upstream (PM cannot produce a zero-paragraph
  // doc); callers must not call it speculatively.
  if (parsedSides.length === 0) return [];

  // EQUAL-COUNT FAST PATH: when the paragraph
  // count is UNCHANGED, no boundary is being
  // created or destroyed, so there is nothing for
  // the sentinel layout to express. Merge each
  // block against its POSITIONAL counterpart,
  // exactly as the per-block editor path does — no
  // flat stream at all.
  //
  // This is not only an optimization: it removes a
  // whole class of cross-block misalignment by
  // construction. In the flat stream, anchors from
  // DIFFERENT paragraphs compete in one LCS over
  // rendered text, so a parse-unstable anchor in
  // block 0 could be matched against a same-
  // rendering anchor in block 1 and be stranded,
  // losing SP bytes on a pure no-op (pinned in the
  // tests). Paragraph
  // identity is positional whenever the count holds;
  // only a split or a join makes it ambiguous, and
  // those are precisely the cases that still take
  // the flat path below.
  //
  // RESHAPE CAVEAT (known, deliberately not fixed
  // here): a single transaction can
  // both SPLIT and JOIN and still leave the count
  // unchanged (paste over a multi-paragraph
  // selection is the realistic producer). Positional
  // pairing then merges paragraph i against a
  // paragraph that is not its descendant. SP BYTES
  // ARE STILL SAFE — the edited side is
  // parse-authoritative, so the doc's own text wins
  // and nothing is invented — but prev-side content
  // hanging off anchors that the reshape re-created
  // (gap.latin, and facets like case/nameScheme) is
  // lost to the creation defaults instead of being
  // carried. The flat path would not do better in
  // general: with the count unchanged it has no
  // evidence about which boundary moved either. A
  // real fix needs transaction-level mapping (PM
  // step positions), which is the editor
  // integration's job, not this module's.
  if (prevBlocks.length === parsedSides.length) {
    return prevBlocks.map((b, i) =>
      side === "sp"
        ? mergeSpBlock(b, parsedSides[i])
        : mergeLatinBlock(b, parsedSides[i])
    );
  }

  const prevFlat = flattenBlocks(prevBlocks);
  const nextFlat = flattenParsed(parsedSides);
  const { block, prevIndexOf } = mergeBlockDetailed(
    prevFlat,
    nextFlat,
    side
  );
  const marked = reattachProvenance(
    prevFlat,
    block,
    prevIndexOf,
    side
  );
  // the facet-unfold net, sp-only, wired at the
  // same "immediately after reattach" slot as
  // mergeSpBlock's.
  const unfolded =
    side === "sp"
      ? unfoldMintedScheme(
          prevFlat,
          marked,
          prevIndexOf
        )
      : marked;
  let flat = rescueJoinedGaps(
    prevFlat,
    side === "latin"
      ? dropKindChangedSpans(
          prevFlat,
          unfolded,
          prevIndexOf
        )
      : unfolded,
    prevIndexOf,
    side
  );
  if (side === "latin") {
    // fusion rescue: after the sentinel rescue
    // (disjoint domains — the run scan stops at
    // sentinels), before routeSplitGaps so rescued
    // bytes still divide at a fresh boundary. The
    // equal-count arm is covered through its
    // per-block delegation to mergeLatinBlock.
    flat = rescueFusedGaps(
      prevFlat,
      flat,
      prevIndexOf
    );
  }
  flat = routeSplitGaps(
    prevFlat,
    flat,
    prevIndexOf,
    side
  );
  // The shared per-side pass chains slot in
  // immediately after routeSplitGaps, reading
  // post-rescue, post-route bytes — the same
  // chains, in the same order, as the per-block
  // paths run.
  if (side === "latin") {
    flat = runLatinPasses(
      prevFlat,
      flat,
      prevIndexOf
    );
  }
  if (side === "sp") {
    flat = runSpPasses(prevFlat, flat, prevIndexOf);
  }
  flat = collapseSeamRuns(
    prevFlat,
    flat,
    prevIndexOf,
    parsedSides.length < prevBlocks.length,
    side
  );
  flat = demoteStraddlers(flat);
  flat = revalidateSpanOffsets(flat);
  return rechunk(flat);
}
