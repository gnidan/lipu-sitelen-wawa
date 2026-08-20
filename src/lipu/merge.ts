/**
 * Per-side, anchor-aligned merge. Gap ownership
 * decides every carry question; re-absorption
 * guarantees tokenization differences never delete
 * content; span reconciliation runs on parsed
 * marker evidence for SP edits and prev-carry
 * otherwise.
 */

import { codepoints } from "../convert/verbatim";
import {
  JOINER_CHARS,
  STRUCTURAL_BY_CHAR,
} from "./chars";
import { anchorSpText } from "./render-sp";
import { wordLatin } from "./render-latin";
import {
  clampSpanOffsets,
  matchStructuralPairs,
  removePairChars,
  spansFromPairs,
} from "./normalize";
import { isStructural, sortSpans } from "./types";
import type {
  Anchor,
  Block,
  Gap,
  ParsedSide,
  Side,
  Span,
  SpanAttrs,
  SpanKind,
} from "./types";

/** Full identity of an anchor. NOT the alignment
 *  key (see mergeBlock's ALIGNMENT KEY note): this
 *  decides who wins when the two sides disagree —
 *  matched-vs-replacement semantics in pairedAnchor
 *  and the SP-EDITS-ONLY GATE in absorbInto (an
 *  occurrence that is exactly one whole next anchor
 *  with no gap chars, whose key differs from prev's,
 *  is declined on SP edits — see absorbInto's doc
 *  comment). */
function anchorKey(a: Anchor): string {
  if (a.kind === "word") {
    return "word:" + a.word;
  }
  return (
    "verbatim:" +
    (a.marked ? "1" : "0") +
    ":" +
    (a.text ?? "")
  );
}

/** Ceiling on the LCS DP, applied to the TRIMMED
 *  middle — the only part that is ever allocated.
 *  2e6 cells is a number[][] of a few tens of MB; past
 *  that we decline to allocate at all rather than let
 *  a phone OOM.
 *
 *  Every routine edit trims to a tiny middle and comes
 *  nowhere near this: typing changes a token or two,
 *  and a paragraph split or join is one sentinel
 *  against an empty span, however long the document
 *  is. Only a whole-document replacement with no
 *  shared prefix or suffix can trip it.
 *
 *  When it does trip, the middle is simply left
 *  unmatched and replacement detection pairs it
 *  positionally, up to the SHORTER side's length. That
 *  degrades ALIGNMENT QUALITY on that one transaction.
 *  Content anchored to the still-matched prefix/suffix,
 *  or to a positionally-paired middle item, survives.
 *  When the two middle spans are unequal in length, the
 *  longer side's surplus items get no positional
 *  partner at all, and any content anchored to THOSE is
 *  dropped.
 *
 *  Under gap ownership EVERY gap holds other-side
 *  content owned by the anchor to its left,
 *  so a surplus prev anchor takes a real gap.latin (or
 *  gap.sp) with it. The true bound
 *  is narrower than it sounds: the loss needs one
 *  transaction whose trimmed middles multiply past the
 *  ceiling AND differ in length, and even then only the
 *  surplus beyond the shorter middle is affected —
 *  content on the matched prefix/suffix, on re-absorbed
 *  anchors, and on positionally paired anchors all
 *  survives. Pinned by merge.test.ts "above the
 *  ceiling, UNEQUAL middles: surplus prev anchors lose
 *  their owned latin", which asserts both halves (the
 *  paired "x1000" survives, the surplus "x1999" does
 *  not). */
const LCS_CELL_LIMIT = 2_000_000;

/** Longest common subsequence over alignment keys
 *  (mergeBlock's edited-side rendered text); returns
 *  aligned index pairs [prevIdx, nextIdx].
 *
 *  Trims the common prefix/suffix before running the
 *  O(n*m) DP so per-keystroke merges on large blocks
 *  only pay for the changed middle span. The trimmed
 *  ends are re-attached positionally afterward, which
 *  is exactly what an untrimmed LCS would align them
 *  to (a shared prefix/suffix run is always part of
 *  some longest common subsequence). */
function lcs(
  a: string[],
  b: string[]
): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const limit = Math.min(n, m);
  let p = 0;
  while (p < limit && a[p] === b[p]) p++;
  let s = 0;
  while (
    s < limit - p &&
    a[n - 1 - s] === b[m - 1 - s]
  ) {
    s++;
  }
  const midA = a.slice(p, n - s);
  const midB = b.slice(p, m - s);
  const midPairs =
    midA.length * midB.length > LCS_CELL_LIMIT
      ? []
      : lcsCore(midA, midB);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < p; i++) pairs.push([i, i]);
  for (const [i, j] of midPairs) {
    pairs.push([i + p, j + p]);
  }
  for (let k = 0; k < s; k++) {
    pairs.push([n - s + k, m - s + k]);
  }
  return pairs;
}

/** Core O(n*m) LCS DP, run on the already-trimmed
 *  middle slices. */
function lcsCore(
  a: string[],
  b: string[]
): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from(
    { length: n + 1 },
    () => new Array(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

function renderAnchorOn(
  a: Anchor,
  side: Side
): string {
  if (side === "sp") return anchorSpText(a);
  return a.kind === "word"
    ? wordLatin(a)
    : a.text ?? "";
}

/** Attr carry for a matched or replacement pair
 *  (ported from the app's existing mergeWordAttrs,
 *  plus the verbatim markedness rule for Latin
 *  edits and the matched-non-word keep-prev
 *  rule). */
function mergeAnchorAttrs(
  prev: Anchor,
  next: Anchor,
  side: Side,
  matched: boolean
): Anchor {
  if (
    prev.kind === "word" &&
    next.kind === "word"
  ) {
    const out: Anchor = { ...next };
    if (side === "latin") {
      if (prev.word === next.word) {
        if (prev.variation !== undefined) {
          out.variation = prev.variation;
        }
        if (prev.niDirection !== undefined) {
          out.niDirection = prev.niDirection;
        }
      }
      // slot attr: naming scheme survives swap
      if (prev.nameScheme !== undefined) {
        out.nameScheme = prev.nameScheme;
      } else {
        delete out.nameScheme;
      }
    } else {
      if (prev.case !== undefined) {
        out.case = prev.case;
      }
    }
    return out;
  }
  if (matched) return { ...prev };
  if (
    side === "latin" &&
    next.kind === "verbatim"
  ) {
    // markedness is SP-local: parseLatin always
    // emits marked, which is no evidence; carry
    // prev's flag when prev was verbatim
    const out: Anchor = { ...next };
    if (prev.kind === "verbatim") {
      if (prev.marked) out.marked = true;
      else delete out.marked;
    }
    return out;
  }
  return { ...next };
}

type Item =
  | { kind: "gap"; text: string }
  | { kind: "anchor"; nextIdx: number }
  | { kind: "reanchored"; prevIdx: number };

/** Try to re-anchor prev anchor `prevIdx` into the
 *  region. Returns the rebuilt item list or null.
 *  Position consistency: search starts after the
 *  last already-re-anchored item; an occurrence
 *  may cover unmatched next anchors only WHOLE.
 *
 *  SP EDITS ONLY (the SP-EDITS-ONLY GATE): an
 *  occurrence that is exactly ONE whole next anchor
 *  with no gap chars, whose key DIFFERS from prev's,
 *  is declined. Re-absorption exists solely to stop
 *  tokenization differences from DELETING content;
 *  when the next side parsed a whole anchor with the
 *  same rendered text, nothing is at risk of
 *  deletion — the disagreement is facet-level, and
 *  per-side authority says the edited side's parse
 *  wins, via replacement pairing. Equal-key
 *  whole-anchor re-anchoring stays (with equal keys
 *  the two outcomes coincide anyway).
 *
 *  WHAT THIS GATE IS NOW — read before deleting it.
 *  Under rendered-text alignment (see mergeBlock's
 *  ALIGNMENT KEY note) the shape this gate was
 *  written for normally never gets here: prev and
 *  next render the same characters, so the LCS
 *  MATCHES them and `pairedAnchor` is the primary
 *  carrier of this behavior — it re-derives `matched`
 *  from key equality and lets the SP parse win
 *  facets and kind. This gate is the DEGRADED-MODE
 *  RESIDUAL. It is reachable in exactly one regime:
 *  when the trimmed middle exceeds LCS_CELL_LIMIT,
 *  `lcs` returns no middle pairs at all, and every
 *  anchor in that middle — including a
 *  rendering-equal pair — arrives here unmatched.
 *  Without the gate an SP-side markedness flip
 *  inside an over-ceiling middle is silently
 *  reverted, which regresses this gate's guarantee
 *  in the one place nobody looks. Pinned by
 *  merge.test.ts "above the ceiling: the
 *  SP-edits-only gate still holds".
 *
 *  The side gate is load-bearing: the SP parse IS
 *  evidence for SP-local identity (facets, and
 *  word-vs-verbatim kind), but the LATIN parse has
 *  no authority over kind — it re-reads an
 *  un-glyphed verbatim "toki" as a word anchor,
 *  which would silently glyph it and change the SP
 *  bytes. On Latin edits, re-absorption's keep-prev
 *  is the correct answer. */
function absorbInto(
  items: Item[],
  rendered: string,
  prevIdx: number,
  prevKey: string,
  nextAnchors: Anchor[],
  side: Side
): Item[] | null {
  let startItem = 0;
  for (let k = items.length - 1; k >= 0; k--) {
    if (items[k].kind === "reanchored") {
      startItem = k + 1;
      break;
    }
  }
  const parts: Array<{
    item: number;
    start: number;
    end: number;
    text: string;
  }> = [];
  let off = 0;
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    const text =
      it.kind === "gap"
        ? it.text
        : it.kind === "anchor"
          ? renderAnchorOn(
              nextAnchors[it.nextIdx],
              side
            )
          : " "; // opaque: never matched into
    parts.push({
      item: k,
      start: off,
      end: off + text.length,
      text,
    });
    off += text.length;
  }
  const full = parts
    .map((p) => p.text)
    .join("");
  const minPos = parts[startItem]?.start ?? 0;

  /** SP-EDITS-ONLY GATE (see the doc comment): the
   *  occurrence is a bare substitution for one whole
   *  next anchor of a DIFFERENT identity (no gap
   *  chars covered) — decline it, so the leftover
   *  pass pairs them as a replacement and the parse
   *  keeps its facet authority. */
  const bareSubstitution = (
    from: number,
    to: number
  ): boolean => {
    const over = parts.filter(
      (p) => p.end > from && p.start < to
    );
    if (over.length !== 1) return false;
    const it = items[over[0].item];
    if (it.kind !== "anchor") return false;
    return (
      anchorKey(nextAnchors[it.nextIdx]) !== prevKey
    );
  };

  let at = full.indexOf(rendered, minPos);
  while (at !== -1) {
    const end = at + rendered.length;
    let ok = true;
    for (const p of parts) {
      const it = items[p.item];
      if (p.end <= at || p.start >= end) continue;
      if (
        it.kind === "reanchored" ||
        (it.kind === "anchor" &&
          !(at <= p.start && p.end <= end))
      ) {
        ok = false;
        break;
      }
    }
    if (
      ok &&
      side === "sp" &&
      bareSubstitution(at, end)
    ) {
      ok = false;
    }
    if (ok) break;
    at = full.indexOf(rendered, at + 1);
  }
  if (at === -1) return null;
  const end = at + rendered.length;

  const out: Item[] = [];
  let placed = false;
  const place = (): void => {
    if (!placed) {
      out.push({ kind: "reanchored", prevIdx });
      placed = true;
    }
  };
  for (const p of parts) {
    const it = items[p.item];
    if (p.end <= at || p.start >= end) {
      out.push(it);
      continue;
    }
    if (it.kind === "gap") {
      const pre = it.text.slice(
        0,
        Math.max(0, at - p.start)
      );
      const post = it.text.slice(
        Math.min(it.text.length, end - p.start)
      );
      if (pre.length > 0) {
        out.push({ kind: "gap", text: pre });
      }
      place();
      if (post.length > 0) {
        out.push({ kind: "gap", text: post });
      }
      continue;
    }
    // next anchor covered entirely: consumed
    place();
  }
  return out;
}

/** Depth/ordinal triples for prev structural
 *  spans (containment over anchor ranges),
 *  mirroring matchStructuralPairs' triples.
 *
 *  TIE RULE: anchor ranges cannot distinguish two
 *  spans covering the SAME anchors, but the marker
 *  stream can — renderSp emits equal-range starts
 *  in span-array order and their ends in REVERSE
 *  array order (proper nesting out — an earlier
 *  implementation emitted both in array order and
 *  produced crossed markers), so the
 *  stack matcher reads the EARLIER array entry as
 *  the OUTER pair either way. Equal ranges
 *  therefore nest by array order here too;
 *  normalizeBlock really does produce this shape
 *  (doubled markers "[[x]]" promote two same-range
 *  cartouches), and without the tie rule both would
 *  claim depth 0 and the inner span's attrs would
 *  be dropped on an SP no-op. */
function structuralTriples(
  spans: Span[]
): Array<{ span: Span; key: string }> {
  const st = spans.filter((s) =>
    isStructural(s.kind)
  );
  const depth = (s: Span, i: number): number =>
    st.filter(
      (o, j) =>
        j !== i &&
        o.from <= s.from &&
        s.to <= o.to &&
        (o.from < s.from || s.to < o.to || j < i)
    ).length;
  const ordered = st
    .map((s, i) => ({ span: s, d: depth(s, i) }))
    .sort(
      (a, b) =>
        a.span.from - b.span.from ||
        b.span.to - a.span.to
    );
  const counters = new Map<string, number>();
  return ordered.map(({ span, d }) => {
    const kd = span.kind + ":" + d;
    const o = counters.get(kd) ?? 0;
    counters.set(kd, o + 1);
    return { span, key: kd + ":" + o };
  });
}

/** The value a MATCHED pair takes. Alignment now
 *  matches on rendered text (see alignKey), so a
 *  match means "these emit the same edited-side
 *  characters" and nothing more — the two anchors
 *  may still disagree on facets or even kind. Per-
 *  side authority settles that:
 *
 *  SP edit — the parse IS evidence for SP-local
 *  identity, so `matched` is re-derived from KEY
 *  equality and handed to mergeAnchorAttrs. Equal
 *  keys keep the matched semantics (no prev-only
 *  facet is dropped); differing keys are a
 *  replacement, so the parse wins facets AND kind.
 *  That is what keeps an SP-side markedness flip
 *  performable now that the flip is a match.
 *
 *  Latin edit — prev wins outright. The Latin parse
 *  has no authority over kind (it re-reads an
 *  un-glyphed verbatim "toki" as a word), and since
 *  a match means the Latin rendering is IDENTICAL,
 *  it has nothing to say about the text or `case`
 *  either: everything the Latin side could express
 *  already agrees. */
function pairedAnchor(
  pa: Anchor,
  na: Anchor,
  side: Side
): Anchor {
  if (side === "latin") return { ...pa };
  return mergeAnchorAttrs(
    pa,
    na,
    side,
    anchorKey(pa) === anchorKey(na)
  );
}

/** JOINER CLEANUP NARROWING: joiner cleanup fires
 *  only on DISTURBED gaps — gaps whose flanking
 *  output anchors are not a contiguous carried prev
 *  pair (block edges count as prev index -1 /
 *  prev.anchors.length). A Latin no-op carries every
 *  flank contiguously, so a free-floating joiner now
 *  survives it and the anchor-conservation law (a
 *  no-op merge never fuses or deletes anchors) holds
 *  over the shape. A joiner left dangling by an
 *  adjacent anchor death sits in a disturbed gap and
 *  is dropped, which is the behavior downstream
 *  consumers of this pass rely on.
 *
 *  OFFSET REMAP: the deletions this pass makes are
 *  gap rewrites, so marker offsets indexing the
 *  rewritten gap remap through them: an offset
 *  after a deleted char shifts left by its length;
 *  an offset inside a deleted char snaps to the
 *  deletion site. */
function cleanupJoiners(
  gaps: Gap[],
  spans: Span[],
  prev: Block,
  prevIndexOf: Array<number | undefined>
): { gaps: Gap[]; spans: Span[] } {
  const n = prevIndexOf.length;
  const disturbed = (gi: number): boolean => {
    const left =
      gi === 0 ? -1 : prevIndexOf[gi - 1];
    const right =
      gi === n
        ? prev.anchors.length
        : prevIndexOf[gi];
    if (
      left === undefined ||
      right === undefined
    ) {
      return true;
    }
    return left + 1 !== right;
  };
  const glyphishChar = (
    ch: string | undefined
  ): boolean =>
    ch !== undefined &&
    STRUCTURAL_BY_CHAR.has(ch);
  const outSpans = spans.map((s) => ({ ...s }));
  const outGaps = gaps.map((g, gi) => {
    if (!disturbed(gi)) return g;
    const chars: string[] = [];
    for (const [cp] of codepoints(g.sp)) {
      chars.push(String.fromCodePoint(cp));
    }
    const cuts: Array<{
      at: number;
      len: number;
    }> = [];
    let off = 0;
    let sp = "";
    chars.forEach((ch, i) => {
      const keep =
        !JOINER_CHARS.has(ch) ||
        ((i > 0
          ? glyphishChar(chars[i - 1])
          : gi > 0) &&
          (i < chars.length - 1
            ? glyphishChar(chars[i + 1])
            : gi < n));
      if (keep) sp += ch;
      else cuts.push({ at: off, len: ch.length });
      off += ch.length;
    });
    if (cuts.length > 0) {
      const remap = (o: number): number => {
        let shift = 0;
        for (const c of cuts) {
          if (c.at + c.len <= o) shift += c.len;
          else if (c.at < o) return c.at - shift;
        }
        return o - shift;
      };
      for (const s of outSpans) {
        if (
          s.from === gi &&
          s.startOffset !== undefined
        ) {
          s.startOffset = remap(s.startOffset);
        }
        if (
          s.to + 1 === gi &&
          s.endOffset !== undefined
        ) {
          s.endOffset = remap(s.endOffset);
        }
      }
    }
    return { ...g, sp };
  });
  return { gaps: outGaps, spans: outSpans };
}

export interface MergeResult {
  block: Block;
  /** Output anchor i came from prev anchor
   *  prevIndexOf[i] (LCS match, replacement pair,
   *  or re-anchor); undefined = pure insertion.
   *  Gap correspondence follows by ownership:
   *  output gap 0 always carries prev gap 0's
   *  other side; output gap i+1 carries prev gap
   *  prevIndexOf[i]+1's (undefined = creation
   *  default). A document-level merge layer needs
   *  this for structural line-break defaults and
   *  sentinel split/join routing. */
  prevIndexOf: Array<number | undefined>;
}

export function mergeBlockDetailed(
  prev: Block,
  next: ParsedSide,
  side: Side
): MergeResult {
  // ALIGNMENT KEY — read this before changing it.
  // Anchors align on the text they RENDER ON THE
  // EDITED SIDE, not on their identity key. The
  // principle: the edited side's parse is evidence
  // ONLY about the text it renders. It cannot see
  // an SP facet from the Latin pane, or a verbatim
  // MARK from the SP characters, so an identity key
  // over-discriminates for MATCHING — it splits
  // anchors the edited side cannot tell apart, and
  // the split is arbitrary whenever two anchors
  // render alike. An arbitrary split strands an
  // unmatched prev anchor in a region its own text
  // never reaches (its twin, or the gap text it
  // re-tokenized into, sits across the boundary),
  // where neither re-absorption nor replacement
  // pairing can reach it — so it is deleted, taking
  // the gap it owns with it. That is silent content
  // loss on a NO-OP; the property suite found two
  // distinct shapes of it (see the pinned
  // "stranding" tests).
  //
  // Identity keys still decide attrs and KIND, at
  // the point where per-side authority belongs:
  // pairedAnchor for matches, mergeAnchorAttrs for
  // replacement pairs, and absorbInto's
  // SP-edits-only gate.
  // Matching is about "what did the user actually
  // see and leave alone"; keys are about "who wins
  // when the two sides disagree".
  //
  // Widening this implies, deliberate: a next anchor
  // that is key-EQUAL to a prev anchor but renders
  // DIFFERENTLY (a nameScheme or case change) is no
  // longer auto-matched, so it can now be consumed
  // WHOLE by a neighbouring prev anchor's
  // re-absorption — a lateral shift the key
  // alignment made impossible.
  //
  // Anchors that render nothing would be invisible
  // to this alignment, so they get per-side unique
  // keys and never match. That is a fallback, not a
  // remedy: such an anchor is dropped on a no-op
  // and its owned gap with it, because a no-op
  // region contains no pairable next anchor either.
  // checkBlock rejects them outright (see types.ts)
  // and neither parser can mint one.
  const alignKey = (
    a: Anchor,
    i: number,
    ns: string
  ): string => {
    const t = renderAnchorOn(a, side);
    return t.length > 0 ? "t" + t : ns + i;
  };
  // OCCURRENCE-AWARE SECONDARY KEYING.
  // The primary key is right about WHICH TEXT the
  // edited side is evidence about, but it cannot tell
  // two anchors that render the SAME text apart. When
  // prev holds MORE occurrences of one such text than
  // next does — the Latin parse returns a
  // punctuation-only anchor to gap.latin, or a
  // cartouche atomizes one occurrence out of the pane
  // — the LCS keeps prev's FIRST occurrences, by
  // position and nothing else, and the surplus prev
  // occurrence is stranded in a region whose next side
  // holds no matching text at all. Re-absorption then
  // searches an empty haystack, so the anchor is
  // deleted and its SP bytes go with it — on a NO-OP.
  //
  // The tie-breaker is the anchor's FLANKING GAP
  // CONTENT on the edited side, the only other
  // evidence the edited side actually carries about
  // WHICH occurrence it is. Four narrowings keep it a
  // tie-breaker rather than a new alignment policy:
  //
  //   - LATIN EDITS ONLY. On the SP side the two
  //     flanks are not comparable strings at all:
  //     prev's gap.sp is marker-FREE (structural
  //     markers live in spans), while parseSp's gaps
  //     still carry the raw marker characters, so the
  //     flanks of one and the same anchor differ by
  //     construction and the "evidence" is noise —
  //     this refinement is Latin-side only.
  //   - A key is refined only when prev holds it MORE
  //     often than next does — exactly the regime
  //     where the LCS must drop prev occurrences, and
  //     drops them by position. A key prev holds no
  //     more often than next keeps its primary key
  //     verbatim, so no pairing the primary keys make
  //     on their own is ever prevented by gap content
  //     (this is also what keeps a document-level
  //     merge's SENTINEL runs, which all render
  //     alike, on their split routing: a split has
  //     prev's count BELOW next's).
  //   - Refined keys are built on BOTH sides for the
  //     same text, so an occurrence pairs only with
  //     one whose flanks agree, and otherwise with
  //     NONE — leaving it unmatched in a region that
  //     does contain its text, where re-absorption
  //     (or replacement pairing) can reach it. They
  //     carry an "r" prefix that no primary key can
  //     have (primary keys start with "t"/"p"/"n"),
  //     and the flanks are length-prefixed, so a
  //     refined key can never collide with a primary
  //     one that happens to contain the encoding.
  //   - The refined alignment is ADOPTED only when the
  //     set of prev anchors it carries is a strict
  //     SUPERSET of the primary alignment's (the
  //     conservation gate below).
  const prevKeys = prev.anchors.map((a, i) =>
    alignKey(a, i, "p")
  );
  const nextKeys = next.anchors.map((a, i) =>
    alignKey(a, i, "n")
  );
  const tally = (
    ks: string[]
  ): Map<string, number> => {
    const m = new Map<string, number>();
    for (const k of ks) {
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const prevTally = tally(prevKeys);
  const nextTally = tally(nextKeys);
  const ambiguous = new Set<string>();
  if (side === "latin") {
    for (const [k, c] of prevTally) {
      if (c > (nextTally.get(k) ?? 0)) {
        ambiguous.add(k);
      }
    }
  }
  const refined = ambiguous.size > 0;
  const part = (s: string): string =>
    " " + s.length + ":" + s;
  const refine = (
    keys: string[],
    gapAt: (i: number) => string
  ): string[] =>
    keys.map((k, i) =>
      ambiguous.has(k)
        ? "r" + k + part(gapAt(i)) + part(gapAt(i + 1))
        : k
    );
  const refPrevKeys = refined
    ? refine(prevKeys, (i) => prev.gaps[i].latin)
    : prevKeys;
  const refNextKeys = refined
    ? refine(nextKeys, (i) => next.gaps[i])
    : nextKeys;
  interface Built {
    outAnchors: Anchor[];
    outEdited: string[];
    prevIndexOf: Array<number | undefined>;
  }

  const build = (
    pairs: Array<[number, number]>
  ): Built => {
    const outAnchors: Anchor[] = [];
    const outEdited: string[] = [];
    const prevIndexOf: Array<number | undefined> =
      [];
    let pendingGap = "";

    const emitAnchor = (
      a: Anchor,
      prevIdx: number | undefined
    ): void => {
      outEdited.push(pendingGap);
      pendingGap = "";
      outAnchors.push(a);
      prevIndexOf.push(prevIdx);
    };

    let pp = 0;
    let pn = 0;
    const bounds: Array<[number, number]> = [
      ...pairs,
      [prev.anchors.length, next.anchors.length],
    ];
    for (const [bp, bn] of bounds) {
      // region: prev [pp, bp) and next [pn, bn)
      // unmatched, plus next gaps pn..bn
      let items: Item[] = [];
      for (let ni = pn; ni < bn; ni++) {
        items.push({
          kind: "gap",
          text: next.gaps[ni],
        });
        items.push({ kind: "anchor", nextIdx: ni });
      }
      items.push({
        kind: "gap",
        text: next.gaps[bn],
      });

      // re-absorption
      const absorbed = new Set<number>();
      for (let pi = pp; pi < bp; pi++) {
        const rendered = renderAnchorOn(
          prev.anchors[pi],
          side
        );
        if (rendered.length === 0) continue;
        const res = absorbInto(
          items,
          rendered,
          pi,
          anchorKey(prev.anchors[pi]),
          next.anchors,
          side
        );
        if (res) {
          items = res;
          absorbed.add(pi);
        }
      }

      // positional replacement pairing of leftovers
      const prevRest: number[] = [];
      for (let pi = pp; pi < bp; pi++) {
        if (!absorbed.has(pi)) prevRest.push(pi);
      }
      const replacedBy = new Map<number, number>();
      {
        let x = 0;
        for (const it of items) {
          if (it.kind !== "anchor") continue;
          if (x < prevRest.length) {
            replacedBy.set(
              it.nextIdx,
              prevRest[x]
            );
          }
          x += 1;
        }
      }

      // emit the region
      for (const it of items) {
        if (it.kind === "gap") {
          pendingGap += it.text;
          continue;
        }
        if (it.kind === "reanchored") {
          emitAnchor(
            { ...prev.anchors[it.prevIdx] },
            it.prevIdx
          );
          continue;
        }
        const na = next.anchors[it.nextIdx];
        const rp = replacedBy.get(it.nextIdx);
        if (rp === undefined) {
          emitAnchor({ ...na }, undefined);
        } else {
          emitAnchor(
            mergeAnchorAttrs(
              prev.anchors[rp],
              na,
              side,
              false
            ),
            rp
          );
        }
      }

      // the boundary match itself (absent for the
      // final sentinel)
      if (bp < prev.anchors.length) {
        emitAnchor(
          pairedAnchor(
            prev.anchors[bp],
            next.anchors[bn],
            side
          ),
          bp
        );
        pp = bp + 1;
        pn = bn + 1;
      }
    }
    outEdited.push(pendingGap);
    return { outAnchors, outEdited, prevIndexOf };
  };

  // CONSERVATION GATE on the secondary keying.
  // Refusing a pairing is not free: an occurrence the
  // refined keys leave unmatched is reclaimed only if
  // the region it lands in actually contains its text.
  // Where it does (the atomized-cartouche case) the
  // refined alignment saves an anchor; where it does
  // not, it COSTS one — a duplicate-word block whose
  // refined alignment strands an unrelated verbatim
  // is a real counterexample, not a hypothetical.
  //
  // The gate is SET INCLUSION, not a count: adopt the
  // refined alignment only when the set of prev anchors
  // it carries CONTAINS the primary alignment's and is
  // strictly larger. A count comparison is not enough —
  // measured, a majority of the alignments that carry
  // MORE anchors carry a DIFFERENT set, dropping one
  // the primary kept (and some of those lose more prev
  // SP bytes than they save, since bytes ride on gap
  // ownership, not on anchor count). Under set
  // inclusion the property the comment can honestly
  // claim is exact: the tie-breaker never deletes an
  // anchor the primary keys kept, it only adds.
  const carriedSet = (b: Built): Set<number> => {
    const s = new Set<number>();
    for (const p of b.prevIndexOf) {
      if (p !== undefined) s.add(p);
    }
    return s;
  };
  let built = build(lcs(prevKeys, nextKeys));
  if (refined) {
    const alt = build(lcs(refPrevKeys, refNextKeys));
    const base = carriedSet(built);
    const wide = carriedSet(alt);
    let superset = wide.size > base.size;
    if (superset) {
      for (const p of base) {
        if (!wide.has(p)) {
          superset = false;
          break;
        }
      }
    }
    if (superset) built = alt;
  }
  const { outAnchors, outEdited, prevIndexOf } =
    built;

  // gap assembly: edited side from the parse,
  // other side per gap ownership
  const otherOf = (g: Gap): string =>
    side === "sp" ? g.latin : g.sp;
  const mkGap = (
    edited: string,
    other: string
  ): Gap =>
    side === "sp"
      ? { sp: edited, latin: other }
      : { sp: other, latin: edited };

  const gaps: Gap[] = [
    mkGap(outEdited[0], otherOf(prev.gaps[0])),
  ];
  for (let i = 0; i < outAnchors.length; i++) {
    const p = prevIndexOf[i];
    let other: string;
    if (p !== undefined) {
      other = otherOf(prev.gaps[p + 1]);
    } else if (side === "sp") {
      // creation default: a new SP anchor gets a
      // single space on its Latin side
      other =
        i < outAnchors.length - 1 ? " " : "";
    } else {
      other = "";
    }
    gaps.push(mkGap(outEdited[i + 1], other));
  }

  // span reconciliation
  const outIndexOfPrev = new Map<
    number,
    number
  >();
  prevIndexOf.forEach((p, i) => {
    if (p !== undefined) outIndexOfPrev.set(p, i);
  });
  const mapSpan = (s: Span): Span | null => {
    let from: number | null = null;
    let to: number | null = null;
    for (let p = s.from; p <= s.to; p++) {
      const i = outIndexOfPrev.get(p);
      if (i === undefined) continue;
      if (from === null || i < from) from = i;
      if (to === null || i > to) to = i;
    }
    if (from === null || to === null) return null;
    const out: Span = { ...s, from, to };
    // OWNERSHIP-CARRY REMAP: an offset is an index
    // into a SPECIFIC prev gap
    // string. It survives only when that very gap
    // carried into the output gap the offset now
    // indexes; otherwise that gap died with its
    // owner and the marker snaps to its
    // anchor-adjacent default (absent offset) — the
    // deletion-site snap, never a clamp into an
    // unrelated string.
    if (
      out.startOffset !== undefined &&
      !(from === 0
        ? s.from === 0
        : prevIndexOf[from - 1] === s.from - 1)
    ) {
      delete out.startOffset;
    }
    if (
      out.endOffset !== undefined &&
      prevIndexOf[to] !== s.to
    ) {
      delete out.endOffset;
    }
    return out;
  };

  const spans: Span[] = [];
  for (const s of prev.spans) {
    if (isStructural(s.kind)) continue;
    const m = mapSpan(s);
    if (m) spans.push(m);
  }

  let finalGaps = gaps;
  if (side === "latin") {
    for (const s of prev.spans) {
      if (!isStructural(s.kind)) continue;
      const m = mapSpan(s);
      if (m) spans.push(m);
    }
    const cleaned = cleanupJoiners(
      finalGaps,
      spans,
      prev,
      prevIndexOf
    );
    finalGaps = cleaned.gaps;
    spans.length = 0;
    spans.push(...cleaned.spans);
  } else {
    // ATTR PAIRING: attrs follow the pair with the
    // same (kind, depth, ordinal) —
    // "with POSITIONS COMPARED THROUGH THE ANCHOR
    // MAPPING". That last clause is load-bearing:
    // the triple is not an identity. Ordinals
    // RENUMBER when a pair is inserted before an
    // existing one or when a pair's markers are
    // deleted, so a fresh pair can inherit a
    // shifted ordinal and STEAL another span's
    // latinSpelling. A prev span's own anchors,
    // mapped into the merged block, say where its
    // attrs are allowed to land.
    //
    // Pass 1 takes triple matches whose ranges
    // still overlap. Pass 2 is what makes the
    // renumbered case come out right: a pair whose
    // triple found nothing (or was vetoed) may
    // still claim the attrs of a same-kind prev
    // span occupying EXACTLY its anchors. Each
    // prev span is claimable once, so nothing is
    // duplicated, and a span whose anchors are all
    // gone (mapSpan null) is dead and carries
    // nothing anywhere.
    interface AttrCand {
      key: string;
      kind: SpanKind;
      from: number;
      to: number;
      attrs: SpanAttrs;
      taken: boolean;
    }
    const cands: AttrCand[] = [];
    for (const {
      span,
      key,
    } of structuralTriples(prev.spans)) {
      if (!span.attrs) continue;
      const m = mapSpan(span);
      if (!m) continue;
      cands.push({
        key,
        kind: span.kind,
        from: m.from,
        to: m.to,
        attrs: span.attrs,
        taken: false,
      });
    }
    const parsed = matchStructuralPairs(
      finalGaps.map((g) => g.sp)
    ).filter((p) => p.to >= p.from);
    finalGaps = removePairChars(finalGaps, parsed);
    const claimed = new Map<number, SpanAttrs>();
    parsed.forEach((p, i) => {
      const key =
        p.kind + ":" + p.depth + ":" + p.ordinal;
      const c = cands.find(
        (x) =>
          !x.taken &&
          x.key === key &&
          x.from <= p.to &&
          p.from <= x.to
      );
      if (c) {
        c.taken = true;
        claimed.set(i, c.attrs);
      }
    });
    parsed.forEach((p, i) => {
      if (claimed.has(i)) return;
      const c = cands.find(
        (x) =>
          !x.taken &&
          x.kind === p.kind &&
          x.from === p.from &&
          x.to === p.to
      );
      if (c) {
        c.taken = true;
        claimed.set(i, c.attrs);
      }
    });
    // MARKER OFFSETS: the merge promotes on the
    // same path as normalizeBlock,
    // so it records the same post-splice offsets —
    // otherwise every SP keystroke would strip the
    // offsets promotion had just recorded and the
    // next reload would eject the trapped chars
    // again.
    spansFromPairs(
      parsed,
      finalGaps.map((g) => g.sp)
    ).forEach((span, i) => {
      const attrs = claimed.get(i);
      if (attrs) span.attrs = attrs;
      spans.push(span);
    });
    // prev structural spans with no parsed
    // counterpart die here by construction
    // (demotion: their surviving marker chars are
    // ordinary transitional gap content in the
    // parse's authoritative strings)
  }

  return {
    block: {
      anchors: outAnchors,
      gaps: finalGaps,
      // carried marker offsets index gap strings the
      // merge may have rewritten (a Latin merge's
      // cleanupJoiners, an anchor death) — clamp so
      // the output always satisfies checkBlock
      spans: sortSpans(
        clampSpanOffsets(spans, finalGaps)
      ),
    },
    prevIndexOf,
  };
}

export function mergeBlock(
  prev: Block,
  next: ParsedSide,
  side: Side
): Block {
  return mergeBlockDetailed(prev, next, side).block;
}
