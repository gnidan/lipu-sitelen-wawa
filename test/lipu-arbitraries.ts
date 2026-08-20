/**
 * fast-check generators for NORMAL-FORM lipu
 * values. Generators must only produce normal
 * forms — the round-trip laws are stated over
 * them. The exclusions below are why each shape
 * is excluded; do not remove one without making
 * the corresponding law pass without it.
 *
 * HONEST EXCLUSIONS (each one is a shape the laws
 * would fail on BY CONSTRUCTION, not by bug):
 *
 * 1. gap.latin never contains letters, combining
 *    marks, digits, apostrophes, "!" or "?".
 *    Letters/marks would re-parse into anchors (or
 *    fuse into a neighbour's letter run); digits,
 *    apostrophes, "!" and "?" are reserved for
 *    verbatim texts so re-absorption occurrences
 *    stay position-unambiguous.
 *    Mark-leading gap.latin is excluded a second
 *    time for a specific reason: a word anchor
 *    followed by a MARK-LEADING gap.latin is
 *    non-idempotent under a Latin no-op, because
 *    parseLatin's mark class continues the anchor's
 *    letter run into the gap. A cartouche-covered
 *    flank is exempt from boundary normalization
 *    while the span stands, but an SP edit that
 *    dissolves the cartouche (deleting its END
 *    marker) can un-cover a mark-leading gap.latin
 *    the editor never re-normalized, reaching the
 *    shape live. The SP-side merge chain
 *    (mergeSpBlock / mergeStructural) now composes
 *    normalizeLetterishLatin to close that door, so
 *    the shape this generator would mint doesn't
 *    survive into a normal form regardless — it is
 *    exercised directly instead by targeted pins in
 *    edit-corpus.test.ts.
 * 2. gap.sp comes from: "", " ", "  ", IDEO_SPACE,
 *    "\n", and (rarely) a stray CARTOUCHE_END char
 *    — a transitional marker that can never pair
 *    with anything (only END strays are generated,
 *    so no accidental matched pair ever forms). No
 *    arrows and NO NAMING CHARS: both fold into
 *    facets on reparse. Naming chars are excluded a
 *    second time for a specific reason — see
 *    NAMING-CHAR REORDER below. Joiners may appear
 *    free-floating in gap.sp: cleanupJoiners was
 *    narrowed to fire only on disturbed gaps, so a
 *    Latin no-op preserves them and the law suite
 *    verifies the shape directly.
 * 3. NAMING-CHAR REORDER: this parser's parseSp
 *    deliberately does NOT reproduce an earlier
 *    implementation's naming-char reorder — that
 *    implementation folded a naming char onto the
 *    last WORD token even across intervening
 *    unmarked Latin text, which moves the char on
 *    re-render; this parser refuses to fold past
 *    pending Latin and round-trips instead. This
 *    behavior is intentional and is never changed
 *    to match the earlier implementation, so the
 *    generator does not mint naming chars in gaps
 *    at all and the byte-parity law never sees the
 *    shape. The behavior on it is asserted directly,
 *    as a pinned test, in this library's
 *    property-based tests.
 * 4. Unmarked verbatim texts are drawn from a pool
 *    filtered so no char is an SP marker char
 *    (space allowed interior only): parseSp must
 *    re-tokenize them stably. Marked verbatim texts
 *    are free ("a.b", "3.14", "?!" exercise Latin
 *    scatter + re-absorption).
 * 5. Verbatim texts have no leading/trailing spaces
 *    (the "aa " absorption flip is pinned
 *    explicitly instead of generated).
 * 6. Post-pass 1: two adjacent verbatim anchors
 *    with ""/spaces-only gap.sp between them get
 *    IDEO_SPACE instead (their SP runs would
 *    otherwise fuse on reparse).
 * 7. Post-pass 2: two adjacent anchors that both
 *    render Latin letters at the shared boundary
 *    (and are not swallowed by a NAME ATOM — see
 *    render-latin's atomizedAnchors; a NAMELESS
 *    cartouche does not atomize and so does not
 *    exempt) get gap.latin " " when it was "" (their
 *    Latin letter runs would otherwise fuse into
 *    one anchor on reparse). "Letter" at the LEFT
 *    boundary means letter-or-combining-mark: the
 *    mark class continues a run through \p{M}, so
 *    an NFD-final anchor is letter-final for fusion
 *    purposes.
 */

import * as fc from "fast-check";
import type {
  Anchor,
  Block,
  Gap,
  Lipu,
  Span,
} from "../src/lipu/types";
import {
  isStructural,
  sortSpans,
} from "../src/lipu/types";
import {
  CARTOUCHE_START,
  CARTOUCHE_END,
  CART_EXT,
  IDEO_SPACE,
  LONG_START,
  LONG_END,
  REV_LONG_START,
  REV_LONG_END,
  STACK,
  SCALE,
  ZWJ_CH,
  MIDDLE_DOT_CH,
  COLON_CH,
  TALLY_CH,
  arrowChar,
  isMarkerChar,
} from "../src/lipu/chars";
import {
  atomizedAnchors,
} from "../src/lipu/render-latin";
import {
  codepointToChar,
  isWord,
  wordToCodepoint,
} from "../src/data";

const glyphOf = (w: string): string =>
  codepointToChar(wordToCodepoint[w]);

const WORDS = [
  "toki", "pona", "mute", "kili", "nena", "kon",
  "sewi", "ni", "li", "mi", "sina", "lipu",
];

const arbPlainWord: fc.Arbitrary<Anchor> = fc
  .record(
    {
      word: fc.constantFrom(...WORDS),
      variation: fc.option(
        fc.integer({ min: 1, max: 3 }),
        { nil: undefined }
      ),
      cap: fc.option(fc.constant(true), {
        nil: undefined,
      }),
    },
    { requiredKeys: ["word"] }
  )
  .map((r) => {
    const a: Anchor = {
      kind: "word",
      word: r.word,
    };
    // normal form: ni uses niDirection, never
    // variation; keep generated ni bare here
    if (r.word !== "ni" && r.variation) {
      a.variation = r.variation;
    }
    if (r.cap) a.case = "capital";
    return a;
  });

const arbNi: fc.Arbitrary<Anchor> = fc
  .integer({ min: 1, max: 8 })
  .map((d) => ({
    kind: "word",
    word: "ni",
    niDirection: d,
  }));

/** SP-stable unmarked pool: no SP marker chars
 *  (space allowed interior between letters), no
 *  real toki pona words, no edge spaces. */
const UNMARKED_POOL = [
  "xq", "qqq", "hi there", "!", "?!", "42",
  "3.14",
].filter(
  (t) =>
    !isWord(t) &&
    [...t].every(
      (ch, i, arr) =>
        (ch === " " &&
          i > 0 &&
          i < arr.length - 1) ||
        !isMarkerChar(ch.codePointAt(0)!)
    )
);

/** WORD-LOOKALIKE verbatim (deliberately exempt
 *  from the !isWord filter above): un-glyphed SP
 *  text that parseLatin re-reads as a WORD anchor.
 *  On a LATIN edit re-absorption must never
 *  decline — declining would let the Latin parse
 *  win the kind, glyphing "toki" and rewriting SP
 *  bytes. On an SP edit the parse does own the
 *  kind. Keeping it in the pool means every law
 *  runs over this case, not just targeted pins. */
const LOOKALIKE = "toki";

/** NFD text: "café" with a COMBINING acute, written
 *  as an escape so this file's own encoding cannot
 *  pre-compose it. parseLatin must carry the
 *  original NFD bytes through untouched — no NFC
 *  normalization anywhere in the library. */
const NFD_TEXT = "cafe\u0301";

const MARKED_POOL = [
  "xq", "hi there", "a.b", "3.14", "?!",
  LOOKALIKE, NFD_TEXT,
];

const arbVerbatim: fc.Arbitrary<Anchor> = fc
  .oneof(
    fc
      .constantFrom(...UNMARKED_POOL, LOOKALIKE)
      .map((text): Anchor => ({
        kind: "verbatim",
        text,
      })),
    fc
      .constantFrom(...MARKED_POOL)
      .map((text): Anchor => ({
        kind: "verbatim",
        text,
        marked: true,
      }))
  );

interface Seg {
  anchors: Anchor[];
  gaps: Gap[]; // length anchors.length - 1
  spans: Span[]; // relative to segment start
}

const single = (
  arb: fc.Arbitrary<Anchor>
): fc.Arbitrary<Seg> =>
  arb.map((a) => ({
    anchors: [a],
    gaps: [],
    spans: [],
  }));

const arbJoined: fc.Arbitrary<Seg> = fc
  .tuple(
    arbPlainWord,
    fc.constantFrom(STACK, SCALE, ZWJ_CH),
    arbPlainWord
  )
  .map(([a, j, b]) => {
    // ZWJ directly after ni would legacy-fold on
    // reparse if an arrow followed; keep joined
    // pairs ni-free on the left
    const left: Anchor =
      a.word === "ni"
        ? { ...a, word: "toki" }
        : a;
    return {
      anchors: [left, b],
      gaps: [{ sp: j, latin: " " }],
      spans: [],
    };
  });

const arbScheme = fc.option(
  fc.oneof(
    fc.record({
      style: fc.constantFrom<
        "letters" | "morae"
      >("letters", "morae"),
      count: fc.integer({ min: 1, max: 2 }),
    }),
    fc.constant<{ style: "word" }>({
      style: "word",
    })
  ),
  { nil: undefined }
);

const arbCartouche: fc.Arbitrary<Seg> = fc
  .tuple(
    fc.array(
      fc.tuple(arbPlainWord, arbScheme),
      { minLength: 1, maxLength: 3 }
    ),
    fc.option(
      fc.constantFrom("Nena", "Kili Pona"),
      { nil: undefined }
    )
  )
  .map(([entries, spelling]) => {
    const anchors: Anchor[] = [];
    const gaps: Gap[] = [];
    entries.forEach(([w, scheme], i) => {
      const a: Anchor = { ...w };
      delete a.case;
      if (w.word === "ni") a.word = "nena";
      if (scheme) a.nameScheme = scheme;
      anchors.push(a);
      if (i < entries.length - 1) {
        gaps.push({ sp: CART_EXT, latin: "" });
      }
    });
    const span: Span = {
      from: 0,
      to: anchors.length - 1,
      kind: "cartouche",
      side: "both",
    };
    if (spelling !== undefined) {
      span.attrs = { latinSpelling: spelling };
    }
    return { anchors, gaps, spans: [span] };
  });

const arbSegment: fc.Arbitrary<Seg> = fc.oneof(
  { weight: 4, arbitrary: single(arbPlainWord) },
  { weight: 1, arbitrary: single(arbNi) },
  { weight: 2, arbitrary: single(arbVerbatim) },
  { weight: 1, arbitrary: arbJoined },
  { weight: 1, arbitrary: arbCartouche }
);

const arbGapSp = fc.oneof(
  { weight: 8,
    arbitrary: fc.constantFrom(
      "", " ", "  ", IDEO_SPACE, "\n"
    ) },
  // stray transitional marker: END only, so no
  // accidental matched pair can ever form
  { weight: 1,
    arbitrary: fc.constant(CARTOUCHE_END) },
  // free-floating joiners: the narrowed
  // cleanupJoiners leaves undisturbed gaps alone,
  // so the law suite now runs over the shape. All
  // THREE JOINER_CHARS members are minted.
  { weight: 1,
    arbitrary: fc.constantFrom(
      STACK,
      SCALE,
      " " + ZWJ_CH + " "
    ) }
);
const arbGapLatin = fc.constantFrom(
  "", " ", ", ", ". ", "; ", " - ", "  ", "\n",
  "."
);
const arbConnector: fc.Arbitrary<Gap> = fc
  .tuple(arbGapSp, arbGapLatin)
  .map(([sp, latin]) => ({ sp, latin }));

function latinTextOf(a: Anchor): string {
  return a.kind === "word"
    ? a.word ?? ""
    : a.text ?? "";
}
/** A run can never START with a combining mark
 *  (parse-latin's isMark class), so only \p{L}
 *  counts on the right of a boundary... */
const startsLetter = (a: Anchor): boolean =>
  /^\p{L}/u.test(latinTextOf(a));
/** ...but a mark CONTINUES a run, so an NFD-final
 *  anchor is letter-final for fusion purposes. */
const endsLetter = (a: Anchor): boolean =>
  /[\p{L}\p{M}]$/u.test(latinTextOf(a));

function postProcess(block: Block): Block {
  // ATOM coverage, not cartouche coverage: a
  // cartouche that projects no name does not
  // atomize (render-latin's ATOMIZATION RULE), so
  // its anchors' letter runs fuse like anyone
  // else's. Same predicate as the editor's
  // separation default (applySeparationDefaults).
  // Inert for arbBlock —
  // its cartouches always cover word anchors, so
  // they always have a name — but the two copies
  // must not drift.
  const atomized = atomizedAnchors(block);
  const covered = (i: number): boolean =>
    atomized.has(i);
  for (
    let i = 0; i + 1 < block.anchors.length; i++
  ) {
    const a = block.anchors[i];
    const b = block.anchors[i + 1];
    const g = block.gaps[i + 1];
    // post-pass 1: SP runs of two verbatims must
    // not fuse
    if (
      a.kind === "verbatim" &&
      b.kind === "verbatim" &&
      /^ *$/.test(g.sp)
    ) {
      g.sp = IDEO_SPACE;
    }
    // post-pass 2: Latin letter runs must not
    // fuse (atom-covered anchors are opaque)
    if (
      !covered(i) &&
      !covered(i + 1) &&
      endsLetter(a) &&
      startsLetter(b) &&
      g.latin === ""
    ) {
      g.latin = " ";
    }
  }
  block.spans = sortSpans(block.spans);
  return block;
}

export const arbBlock: fc.Arbitrary<Block> = fc
  .tuple(
    arbConnector,
    fc.array(fc.tuple(arbSegment, arbConnector), {
      minLength: 0,
      maxLength: 6,
    }),
    fc.option(fc.tuple(fc.nat(9), fc.nat(9)), {
      nil: undefined,
    })
  )
  .map(([g0, parts, fmt]) => {
    const anchors: Anchor[] = [];
    const gaps: Gap[] = [{ ...g0 }];
    const spans: Span[] = [];
    for (const [seg, conn] of parts) {
      const base = anchors.length;
      seg.anchors.forEach((a, i) => {
        anchors.push({ ...a });
        if (i < seg.gaps.length) {
          gaps.push({ ...seg.gaps[i] });
        }
      });
      for (const s of seg.spans) {
        spans.push({
          ...s,
          from: s.from + base,
          to: s.to + base,
        });
      }
      gaps.push({ ...conn });
    }
    if (fmt && anchors.length > 0) {
      const from = fmt[0] % anchors.length;
      const to =
        from +
        (fmt[1] % (anchors.length - from));
      spans.push({
        from,
        to,
        kind: "bold",
        side: "both",
      });
    }
    return postProcess({ anchors, gaps, spans });
  });

function cloneBlock(b: Block): Block {
  return {
    anchors: b.anchors.map((a) => ({ ...a })),
    gaps: b.gaps.map((g) => ({ ...g })),
    spans: b.spans.map((s) =>
      s.attrs
        ? { ...s, attrs: { ...s.attrs } }
        : { ...s }
    ),
  };
}

/** Gap indices that are NOT interior to a
 *  structural span. Decision 4 exempts interior
 *  gaps from empty-line splits, and an injected
 *  marker pair anchored at two such gaps is always
 *  nested-or-disjoint with every existing span (so
 *  promotion can never mint a crossing pair). */
function outerGaps(b: Block): number[] {
  const out: number[] = [];
  for (let g = 0; g < b.gaps.length; g++) {
    const interior = b.spans.some(
      (s) =>
        isStructural(s.kind) &&
        s.from < g &&
        g <= s.to
    );
    if (!interior) out.push(g);
  }
  return out;
}

/** Blocks carrying EMPTY-LINE RUNS, so
 *  normalizeLipu's Block splits are actually
 *  reached (a hand-written unit test alone never
 *  got to a split). NOT a Lipu normal form by
 *  construction — used only by the normalize laws,
 *  never by the round-trip laws. */
const arbSplittyBlock: fc.Arbitrary<Block> = fc
  .tuple(
    arbBlock,
    fc.array(fc.nat(19), {
      minLength: 1,
      maxLength: 3,
    }),
    fc.constantFrom("\n\n", "\n\n\n", "\n\n \n\n")
  )
  .map(([base, picks, run]) => {
    const b = cloneBlock(base);
    const outer = outerGaps(b);
    for (const p of picks) {
      const g = outer[p % outer.length];
      b.gaps[g] = {
        ...b.gaps[g],
        sp: b.gaps[g].sp + run,
      };
    }
    return b;
  });

export const arbLipu: fc.Arbitrary<Lipu> = fc
  .array(
    fc.oneof(
      { weight: 1, arbitrary: arbBlock },
      { weight: 2, arbitrary: arbSplittyBlock }
    ),
    { minLength: 0, maxLength: 3 }
  )
  .map((blocks) => ({ version: 2, blocks }));

/** DENORMALIZED corpus: legacy/transitional junk
 *  that normalizeBlock is supposed to absorb —
 *  facet folds (bare ni + arrow, out-of-cartouche
 *  nameScheme demotion) and structural marker pairs
 *  awaiting promotion (cartouche AND long, which
 *  the normal-form generators never mint). Stated
 *  laws over it: idempotence and checkBlock, never
 *  a round trip. */
export const arbRawBlock: fc.Arbitrary<Block> = fc
  .tuple(
    arbBlock,
    fc.array(
      fc.tuple(
        fc.nat(19),
        fc.nat(19),
        fc.constantFrom<"cartouche" | "long">(
          "cartouche",
          "long"
        )
      ),
      { maxLength: 2 }
    ),
    fc.array(fc.nat(19), { maxLength: 2 }),
    fc.array(fc.nat(19), { maxLength: 2 })
  )
  .map(([base, pairs, schemes, nis]) => {
    const b = cloneBlock(base);
    const outer = outerGaps(b);
    // structural marker pairs in gaps, awaiting
    // promotion (i <= j keeps them nested-or-
    // disjoint with every existing span)
    for (const [x, y, kind] of pairs) {
      const i = outer[x % outer.length];
      const j = outer[y % outer.length];
      const [lo, hi] = i <= j ? [i, j] : [j, i];
      const [s, e] =
        kind === "cartouche"
          ? [CARTOUCHE_START, CARTOUCHE_END]
          : [LONG_START, LONG_END];
      b.gaps[lo] = {
        ...b.gaps[lo],
        sp: s + b.gaps[lo].sp,
      };
      b.gaps[hi] = {
        ...b.gaps[hi],
        sp: b.gaps[hi].sp + e,
      };
    }
    if (b.anchors.length === 0) return b;
    // nameScheme on a word with no cartouche over
    // it: normalizeBlock must DEMOTE it to literal
    // naming chars at the head of its owned gap
    for (const p of schemes) {
      const i = p % b.anchors.length;
      const a = b.anchors[i];
      if (a.kind !== "word") continue;
      a.nameScheme = {
        style: p % 2 === 0 ? "letters" : "morae",
        count: 1,
      };
    }
    // bare ni whose owned gap opens with an arrow:
    // normalizeBlock must FOLD the arrow into a
    // niDirection facet and drop the char
    for (const p of nis) {
      const i = p % b.anchors.length;
      const a = b.anchors[i];
      if (a.kind !== "word") continue;
      a.word = "ni";
      delete a.variation;
      delete a.niDirection;
      delete a.nameScheme;
      b.gaps[i + 1] = {
        ...b.gaps[i + 1],
        sp:
          arrowChar((p % 8) + 1) +
          b.gaps[i + 1].sp,
      };
    }
    return b;
  });

/** REQUIRED corpus (spec Merge robustness):
 *  three near-identical soft-break name lines in
 *  one Block. */
export const arbNameLines: fc.Arbitrary<Block> =
  fc
    .tuple(
      fc.constantFrom("kili", "mun", "nena"),
      fc.array(
        fc.constantFrom("kili", "mun", "nena"),
        { minLength: 3, maxLength: 3 }
      )
    )
    .map(([base, perLine]) => {
      const anchors: Anchor[] = [];
      const gaps: Gap[] = [{ sp: "", latin: "" }];
      const spans: Span[] = [];
      perLine.forEach((w, line) => {
        if (line > 0) {
          gaps[gaps.length - 1] = {
            sp: "\n",
            latin: "\n",
          };
        }
        // lines 0 and 2 use the same base word:
        // near-identical on purpose
        const name = line === 1 ? w : base;
        spans.push({
          from: anchors.length,
          to: anchors.length,
          kind: "cartouche",
          side: "both",
        });
        anchors.push({
          kind: "word",
          word: name,
          nameScheme: {
            style: "letters",
            count: 1,
          },
        });
        gaps.push({ sp: " ", latin: " " });
        anchors.push({ kind: "word", word: "li" });
        gaps.push({ sp: " ", latin: " " });
        anchors.push({
          kind: "word",
          word: "pona",
        });
        gaps.push({ sp: "", latin: "" });
      });
      return {
        anchors,
        gaps,
        spans: sortSpans(spans),
      };
    });

/** Repetition corpus: toki pona's li/e/ni
 *  everywhere. */
export const arbRepetitive: fc.Arbitrary<Block> =
  fc
    .array(fc.constantFrom("li", "e", "ni", "mi"), {
      minLength: 6,
      maxLength: 14,
    })
    .map((ws) => ({
      anchors: ws.map(
        (w): Anchor => ({ kind: "word", word: w })
      ),
      gaps: [
        { sp: "", latin: "" },
        ...ws.map((_, i) =>
          i < ws.length - 1
            ? { sp: " ", latin: " " }
            : { sp: "", latin: "" }
        ),
      ],
      spans: [],
    }));

/** RAW SP TEXT — the domain of the SP CONSERVATION
 *  LAW ("renderSp(normalizeBlock(parseSp(x))).text
 *  === x for all x"). Not a Block: the law is about
 *  the PROMOTE path, so it starts from bytes a user
 *  can type and asserts they survive parse ->
 *  normalize (facet folds + span promotion) ->
 *  render.
 *
 *  The alphabet is deliberately the whole marker
 *  repertoire — structural pairs of all three kinds
 *  at ARBITRARY gap positions, naming chars,
 *  cart-ext, joiners, spaces, ideo-space, breaks —
 *  plus glyphs and unmarked Latin runs, because
 *  those positions are exactly what the law is
 *  about. Nothing about markers is excluded.
 *
 *  HONEST EXCLUSIONS (each a NORMALIZATION the law
 *  is not stated over — accepted behavior with its
 *  own pin, not a byte lost by accident):
 *  1. ni-direction ARROWS and standard ni-direction
 *     CODEPOINTS. parseSp folds them into the
 *     niDirection facet and renderSp re-emits the
 *     EFFECTIVE form: a legacy ZWJ between ni and
 *     its arrow is dropped, and a cardinal ni+arrow
 *     comes back as the single combined codepoint.
 *     That normalization matches the app's existing
 *     renderer, inherited on purpose, and is
 *     covered by the byte-parity law and
 *     normalize's facet-fold tests. ZWJ itself IS
 *     generated — with no arrow after it, it is an
 *     ordinary joiner char, and it conserves.
 *  2. VARIATION SELECTORS. A word absorbs ONE
 *     variation; a second VS overwrites the first
 *     (matches the app's existing behavior, pinned
 *     as an accepted one-step canonicalization in
 *     the storage migration's tests, a later PR),
 *     so "glyph VS VS" is not byte-conserved. The
 *     one VS interaction this library fixed — a VS
 *     after a naming char, which renderSp would
 *     re-emit BEFORE it — is pinned directly in this
 *     library's property-based tests.
 *  3. MARKED verbatim inline runs. The law is stated
 *     over plain text + breaks (spInlinesFromText);
 *     the marked-run shape is covered by the SP-BYTE
 *     identity law over arbBlock, which mints it.
 */
const SP_ATOMS: string[] = [
  " ",
  "  ",
  IDEO_SPACE,
  "\n",
  CART_EXT,
  STACK,
  SCALE,
  ZWJ_CH,
  MIDDLE_DOT_CH,
  COLON_CH,
  TALLY_CH,
];

const SP_MARKERS: string[] = [
  CARTOUCHE_START,
  CARTOUCHE_END,
  LONG_START,
  LONG_END,
  REV_LONG_START,
  REV_LONG_END,
];

const arbSpAtom: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc
      .constantFrom(...WORDS)
      .map((w) => glyphOf(w)),
  },
  {
    weight: 4,
    arbitrary: fc.constantFrom(...SP_ATOMS),
  },
  {
    weight: 6,
    arbitrary: fc.constantFrom(...SP_MARKERS),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      "xq",
      "A",
      "hi there",
      "3"
    ),
  }
);

export const arbSpText: fc.Arbitrary<string> = fc
  .array(arbSpAtom, { minLength: 0, maxLength: 14 })
  .map((atoms) => atoms.join(""));
