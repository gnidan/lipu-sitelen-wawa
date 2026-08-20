/**
 * Edit-corpus generator. Simulates editor-driven
 * edit sequences at the lipu layer through the SAME
 * entrypoints the editors use (mergeSpBlock /
 * mergeLatinBlock / mergeStructural), then checks
 * the oracles. There is NO global
 * latin-misplacement invariant in this model; this
 * corpus plus the named oracles is the accepted
 * mitigation, by design.
 *
 * ACCEPTED-LIMITATION REGISTRY (each behavior was
 * examined and accepted, with an exact pin; the
 * names below are used throughout this file and
 * edit-corpus.test.ts):
 *  - the BOUNDARY MARKER-DROP rule: a span marker
 *    whose content crossed a block boundary is
 *    dropped to its anchor-adjacent default.
 *  - the JOIN SEAM RULE: a join normalizes the
 *    seam gap's carried-side newline run.
 *  - the EDGE-SPLIT RELOCATION: a split at a
 *    paragraph edge can relocate (never lose) a
 *    following paragraph's leading gap; widened to
 *    cover the equal-count reshape's
 *    positional-pairing losses.
 *  - the ATTR-PAIRING DROP: a re-promotion whose
 *    ordinals shifted declines to carry span
 *    attrs rather than risk stealing another
 *    span's.
 *  - the LATIN-SPLIT NEWLINE CONSUMPTION: a Latin
 *    split consumes the split gap's newline runs
 *    on both sides.
 *  - the FLAT-PATH STRANDING acceptance: on a
 *    count-changing merge, anchors from different
 *    paragraphs compete in one LCS, and a
 *    parse-unstable anchor can be stranded
 *    (accepted until transaction-level mapping
 *    exists).
 *  - the WHITESPACE-VERBATIM SPLIT-HALF
 *    misalignment: the Latin parse splits a
 *    whitespace-bearing verbatim in two, and the
 *    alignment can match a neighbouring anchor
 *    against one half.
 *
 * GENERATOR EXCLUSIONS (the arbitraries-header
 * convention: every narrowing is written down here,
 * with the reason, and none may be added silently):
 *
 * E1. arbEditLipu decorates arbBlock output, so it
 *     inherits every exclusion documented in
 *     test/lipu-arbitraries.ts verbatim. The shapes
 *     added on top (offsets, empty-name atoms,
 *     interior "\n\n" runs, letter-ish gap.latin,
 *     block-leading latin, cross-boundary marker
 *     pairs) are ADDITIONS, never relaxations.
 * E2. The empty-name atom is appended with an
 *     IDEO_SPACE separator when the anchor to its
 *     left is a verbatim whose gap.sp is
 *     spaces-only. That is arbitraries' post-pass 1,
 *     re-applied to the anchor this pass appends:
 *     two adjacent MARKED verbatim runs with no
 *     separator fuse into one run on reparse, which
 *     is a normal-form violation the generator must
 *     not mint (not a law weakening — the fused
 *     shape is unreachable from the editor because
 *     parseSp can never produce it).
 * E3. Letter-ish gap.latin is minted and then run
 *     through normalizeLetterishLatin,
 *     i.e. the corpus holds the EDITOR-BOUNDARY form
 *     of that shape, which is the form every editor
 *     entrypoint sees at run time. The raw
 *     pre-normalization form is covered by that pass's
 *     own pins, not by this corpus.
 * E4. Op positions are arbitrary integers, so they
 *     are SNAPPED DOWN to a code-point boundary before
 *     use (see `snap`). ProseMirror positions are
 *     always at code-point boundaries, so an op that
 *     cuts a surrogate pair in half is not an editor
 *     gesture; without the snap the INTERPRETER
 *     destroys half a UCSUR glyph and the oracles
 *     report the merge for it. The lone-surrogate drop
 *     in the two inline editors stays as a backstop.
 *
 * SEED SCOPE (not an exclusion — a measured
 * limit). Both families are green at the committed
 * seed far past the sweep horizon, and at several
 * extra seeds. Seed 1 fails on oracle 3, on a block
 * holding a verbatim anchor whose text is
 * "hi there" — the WHITESPACE-VERBATIM SPLIT-HALF
 * misalignment from the registry above: the Latin
 * parse splits such an anchor in two and the
 * rendered-text alignment can match a NEIGHBOURING
 * anchor against one of the halves; gaps then move
 * wholesale and oracle 3's positional premise does
 * not hold. A bare Latin no-op is enough, and
 * duplicate texts only decide whether oracle 3 can
 * NOTICE the loss (a minimal duplicate-free
 * reproducer is pinned in edit-corpus.test.ts).
 * Oracle 4b's sanitizer normalizes the shape away
 * (splitWhitespaceVerbatims) and oracle 3 has no
 * equivalent, because it reasons about a REAL edit
 * rather than a probe. Recorded as a measured limit
 * rather than silenced with a gate nobody can
 * justify: the seed-1 sweep stays red by design,
 * not by neglect.
 *
 * NOT-CARVE-OUTS of this corpus (shapes that look
 * like losses and are not, so nobody re-litigates
 * them; the Enter default's companion "\n" and the
 * separation default's " " are ratified creation
 * defaults, UCSUR paste stripping is an input rule,
 * the zero-paragraph discard is
 * editor-unreachable):
 *
 *   ATOM-INTERIOR gap.latin RE-HOMING. gap.latin
 *   stored INTERIOR to a cartouche that ATOMIZES is
 *   unreachable through the Latin projection:
 *   renderLatin emits the span's projected NAME and
 *   nothing of that gap, so no parse can see it and
 *   no edit can address it. The model's normal form
 *   therefore re-homes it OUTSIDE the span on the
 *   first Latin no-op, where it is visible and
 *   editable again. Every byte is preserved, the
 *   anchors, the spans and every gap.sp are
 *   untouched, and it SETTLES in one step. No
 *   structural span is created or destroyed. A
 *   canonicalization in the same family as the
 *   separation default's injected " ", not a loss.
 *   Pinned exactly in edit-corpus.test.ts;
 *   latinNeutral renders with the cartouches taken
 *   off so atom-interior content is visible on both
 *   sides of its comparison (which costs the clause
 *   no strength, since an atom's spelling is a pure
 *   function of anchors and spans it already
 *   asserts identical).
 */

import * as fc from "fast-check";
import {
  anchorSpText,
  checkBlock,
  classifyProvenance,
  JOINER_CHARS,
  mergeLatinBlock,
  mergeSpBlock,
  mergeStructural,
  normalizeLetterishLatin,
  parseLatin,
  parseSp,
  renderLatin,
  renderSp,
  sortSpans,
} from "../src/lipu";
import { isCodepointBoundary } from "../src/lipu/types";
import type {
  Anchor,
  Block,
  LatinInline,
  Lipu,
  Gap,
  ParsedSide,
  Side,
  Span,
  SpInline,
} from "../src/lipu";
import {
  CARTOUCHE_START,
  CARTOUCHE_END,
  IDEO_SPACE,
  STACK,
} from "../src/lipu/chars";
import {
  codepointToChar,
  isWord,
  wordToCodepoint,
} from "../src/data";
import { arbBlock } from "./lipu-arbitraries";

const glyph = (w: string): string =>
  codepointToChar(wordToCodepoint[w]);

// ---------- shapes ----------

/** Which shapes a corpus family mints.
 *
 *  "full"  — every known landmine, including the
 *            GAP-RESIDENT LATIN shapes (letter-ish
 *            gap.latin, block-leading "ni ").
 *  "plain" — the same generator with those two
 *            DISABLED (family 2). They are the
 *            shapes that make a block latin-parse
 *            UNSTABLE, and instrumentation on family 1
 *            measured 74% of oracle-3 checks and 75%
 *            of oracle-4 checks landing in the
 *            weakened domain because of them. Family 2
 *            is otherwise identical, so oracles 3 and
 *            4a run at FULL strength over it — offsets,
 *            empty-name atoms, joiners, interior runs
 *            and cross-boundary marker pairs all still
 *            minted. */
export type CorpusFamily = "full" | "plain";

/** Post-pass over arbBlock output: decorate with
 *  the landmine shapes. Deterministic per
 *  the seeds fast-check hands us. */
function shapeBlock(
  block: Block,
  picks: number[],
  family: CorpusFamily
): Block {
  const b: Block = {
    anchors: block.anchors.map((a) => ({ ...a })),
    gaps: block.gaps.map((g) => ({ ...g })),
    spans: block.spans.map((s) => ({ ...s })),
  };
  const pick = (i: number, n: number): number =>
    picks[i % picks.length] % n;
  // offset-bearing spans: give the
  // first structural span offsets at valid,
  // non-edge codepoint boundaries when its gaps
  // have room
  const st = b.spans.find(
    (s) =>
      s.kind === "cartouche" ||
      s.kind === "long" ||
      s.kind === "rev-long"
  );
  if (st) {
    const sGap = b.gaps[st.from].sp;
    if (sGap.length >= 1 && pick(0, 2) === 0) {
      // boundary before the last char if legal
      const off = sGap.length - 1;
      if (
        off > 0 &&
        off !== sGap.length &&
        !/[\uD800-\uDBFF]/.test(sGap[off - 1])
      ) {
        st.startOffset = off;
      }
    }
    const eGap = b.gaps[st.to + 1].sp;
    if (eGap.length >= 1 && pick(1, 2) === 0) {
      // off 1 is never the canonical edge (0), so
      // only the in-bounds + boundary checks remain
      const off = 1;
      if (
        off < eGap.length &&
        !/[\uD800-\uDBFF]/.test(eGap[0])
      ) {
        st.endOffset = off;
      }
    }
  }
  // empty-name atom: cartouche over a lone
  // marked verbatim anchor (nameText === "")
  if (pick(2, 4) === 0) {
    // E2: two adjacent marked verbatim runs with a
    // spaces-only gap fuse on reparse — arbitraries'
    // post-pass 1, re-applied to the appended anchor
    const tail = b.gaps[b.gaps.length - 1];
    const left = b.anchors[b.anchors.length - 1];
    if (
      left !== undefined &&
      left.kind === "verbatim" &&
      /^ *$/.test(tail.sp)
    ) {
      b.gaps[b.gaps.length - 1] = {
        ...tail,
        sp: IDEO_SPACE,
      };
    }
    b.anchors.push({
      kind: "verbatim",
      text: "-",
      marked: true,
    });
    b.gaps.push({ sp: "", latin: "" });
    b.spans.push({
      from: b.anchors.length - 1,
      to: b.anchors.length - 1,
      kind: "cartouche",
      side: "both",
    });
  }
  // interior run: "\n\n" inside a structural
  // span's interior gap
  const inner = b.spans.find(
    (s) =>
      (s.kind === "long" ||
        s.kind === "cartouche") &&
      s.to > s.from
  );
  if (inner && pick(3, 3) === 0) {
    const gi = inner.from + 1;
    b.gaps[gi] = {
      ...b.gaps[gi],
      sp: b.gaps[gi].sp + "\n\n",
    };
  }
  // letter-ish gap.latin, editor-boundary form
  // (post-normalization): inject then normalize.
  // GAP-RESIDENT LATIN — family "plain" skips it.
  if (
    family === "full" &&
    pick(4, 3) === 0 &&
    b.anchors.length > 0
  ) {
    const gi = pick(5, b.gaps.length);
    b.gaps[gi] = {
      ...b.gaps[gi],
      latin:
        b.gaps[gi].latin + "\u0301ax",
    };
  }
  // block-leading latin (the migrated old-storage
  // shape). GAP-RESIDENT LATIN — family "plain"
  // skips it.
  if (family === "full" && pick(6, 3) === 0) {
    b.gaps[0] = {
      ...b.gaps[0],
      latin: "ni " + b.gaps[0].latin,
    };
  }
  // CANONICAL SPAN ORDER: the spans pushed above go
  // on the end of a list arbBlock already sorted, so
  // a formatting span can end up before a structural
  // one. sortSpans is the storage normal form (every
  // merge output is in it), and a block that is not in
  // it fails the latin no-op identity law on ORDER
  // alone.
  b.spans = sortSpans(b.spans);
  return normalizeLetterishLatin(b);
}

const arbFamily = (
  family: CorpusFamily
): fc.Arbitrary<Lipu> =>
  fc
  .tuple(
    fc.array(
      fc.tuple(
        arbBlock,
        fc.array(fc.nat(1000), {
          minLength: 8,
          maxLength: 8,
        })
      ),
      { minLength: 1, maxLength: 3 }
    ),
    // cross-boundary transitional marker pair:
    // START stray in one block, END stray in a
    // later one
    fc.boolean()
  )
  .map(([parts, crossPair]) => {
    const blocks = parts.map(([b, picks]) =>
      shapeBlock(b, picks, family)
    );
    if (crossPair && blocks.length >= 2) {
      const first = blocks[0];
      first.gaps[first.gaps.length - 1] = {
        ...first.gaps[first.gaps.length - 1],
        sp:
          first.gaps[first.gaps.length - 1].sp +
          CARTOUCHE_START,
      };
      const last = blocks[blocks.length - 1];
      last.gaps[0] = {
        ...last.gaps[0],
        sp: CARTOUCHE_END + last.gaps[0].sp,
      };
      // ...and REMAP the marker offsets shapeBlock
      // already placed in that gap: prepending shifts
      // every index in gaps[0].sp right, and an
      // unshifted one lands mid-surrogate-pair, which
      // checkBlock rightly rejects. (Appending to the
      // FIRST block's trailing gap moves nothing: an
      // offset counts from the string start, and only
      // an endOffset can index that gap.)
      last.spans = last.spans.map((s) =>
        s.from === 0 && s.startOffset !== undefined
          ? {
              ...s,
              startOffset:
                s.startOffset + CARTOUCHE_END.length,
            }
          : s
      );
    }
    // Generated documents must be classified like
    // loaded ones: the load boundary classifies and
    // typing stamps, so an unclassified non-default
    // byte (e.g. the stray marker chars the
    // crossPair injection mints) cannot exist in a
    // real session. Without this wrap the corpus
    // asserts laws over states no editor can reach.
    return classifyProvenance(
      { version: 2, blocks } as Lipu
    );
  });

/** FAMILY 1 — every shape. */
export const arbEditLipu: fc.Arbitrary<Lipu> =
  arbFamily("full");

/** FAMILY 2 — gap-resident latin disabled, so
 *  oracle 3's parse-fixpoint gate and oracle 4a's
 *  backbone-stable gate stand open and both run at
 *  full strength. */
export const arbEditLipuPlain: fc.Arbitrary<Lipu> =
  arbFamily("plain");

// ---------- op alphabet ----------

export interface EditOp {
  kind:
    | "insert"
    | "delete"
    | "replace"
    | "enter"
    | "split"
    | "join"
    | "paste"
    /** Multi-paragraph paste over a cross-boundary
     *  selection — the realistic producer of the
     *  edge-split relocation. Two paragraphs' worth
     *  of text is replaced by pasted text carrying
     *  its own "\n", so the paragraph COUNT can
     *  hold while the boundary MOVES — the
     *  equal-count reshape (the fast path pairs
     *  paragraph i against a paragraph that is not
     *  its descendant). */
    | "paste-multi"
    /** Compound cross-boundary selection DELETE —
     *  one transaction that removes text on both sides
     *  of a paragraph boundary and the boundary with
     *  it. This is routeSplitGaps' evidence-guard
     *  shape: a count-changing transaction that also
     *  shrinks a newline run in a gap whose boundary
     *  merely SURVIVES. */
    | "delete-across";
  side: Side;
  block: number;
  pos: number;
  len: number;
  text: string;
}

export interface AppliedOp {
  op: EditOp;
  structural: boolean;
  /** touched block range in BEFORE coordinates */
  blockLo: number;
  blockHi: number;
  /** for non-structural ops: edited char range in
   *  the edited side's projection of the block */
  from: number;
  to: number;
  /** STRUCTURAL ops: the edited side's whole-document
   *  text, in MAP coordinates (atom = "\uFFFC"), that
   *  this op's parse ASSERTED. The edited side is
   *  parse-authoritative, so this is the text the
   *  merge is required to reproduce — and it is the
   *  honest yardstick for a DELETING gesture, where
   *  the before-document is not (the user really did
   *  destroy those characters). */
  editedUnits?: string;
}

const SP_TEXT = [
  glyph("toki"),
  glyph("pona"),
  " ",
  IDEO_SPACE,
  "\n",
  CARTOUCHE_START,
  CARTOUCHE_END,
  STACK,
];
const LATIN_TEXT = [
  "a",
  "toki",
  "pona",
  " ",
  ", ",
  "1",
  "?",
  "\n",
];

/** Pasted payloads for "paste-multi": each carries at
 *  least one "\n", so the paste re-chunks. The
 *  one-newline entries are the equal-count RESHAPE
 *  (two paragraphs in, two out, boundary moved) that
 *  the edge-split relocation is about; the others
 *  change the count. */
const MULTI_SP = [
  glyph("toki") + "\n" + glyph("pona"),
  "\n",
  glyph("mi") + "\n\n" + glyph("li"),
  " \n ",
  glyph("toki") + "\n",
  "\n" + glyph("pona"),
  IDEO_SPACE + "\n" + IDEO_SPACE,
  CARTOUCHE_START + "\n" + CARTOUCHE_END,
];
const MULTI_LATIN = [
  "toki\npona",
  "\n",
  "mi\n\nli",
  " \n ",
  "toki\n",
  "\npona",
  ", \n. ",
  "a\nb",
];

export const arbOps: fc.Arbitrary<EditOp[]> =
  fc.array(
    fc
      .tuple(
        fc.constantFrom(
          "insert",
          "delete",
          "replace",
          "enter",
          "split",
          "join",
          "paste",
          "paste-multi",
          "delete-across"
        ),
        fc.constantFrom<Side>("sp", "latin"),
        fc.nat(5),
        fc.nat(400),
        fc.nat(4),
        fc.nat(7)
      )
      .map(
        ([kind, side, block, pos, len, ti]) => ({
          kind: kind as EditOp["kind"],
          side,
          block,
          pos,
          len: len + 1,
          text:
            kind === "paste-multi"
              ? side === "sp"
                ? MULTI_SP[ti % MULTI_SP.length]
                : MULTI_LATIN[
                    ti % MULTI_LATIN.length
                  ]
              : side === "sp"
                ? SP_TEXT[ti % SP_TEXT.length]
                : LATIN_TEXT[
                    ti % LATIN_TEXT.length
                  ],
        })
      ),
    { minLength: 1, maxLength: 6 }
  );

// ---------- inline editing ----------

type SpChar = { ch: string; verbatim: boolean };

function explodeSp(
  inlines: SpInline[]
): SpChar[] {
  const out: SpChar[] = [];
  for (const inline of inlines) {
    if (inline.type === "break") {
      out.push({ ch: "\n", verbatim: false });
      continue;
    }
    for (const ch of inline.text) {
      out.push({
        ch,
        verbatim: inline.verbatim,
      });
    }
  }
  return out;
}

function rebuildSp(chars: SpChar[]): SpInline[] {
  const out: SpInline[] = [];
  for (const c of chars) {
    if (c.ch === "\n" && !c.verbatim) {
      out.push({ type: "break" });
      continue;
    }
    const last = out[out.length - 1];
    if (
      last &&
      last.type === "text" &&
      last.verbatim === c.verbatim
    ) {
      last.text += c.ch;
    } else {
      out.push({
        type: "text",
        text: c.ch,
        verbatim: c.verbatim,
      });
    }
  }
  return out;
}

/** Character-level edit over an SpInline stream;
 *  UTF-16 positions, break = 1 (pm-coords
 *  convention). Inserted text is unmarked. */
export function editSpInlines(
  inlines: SpInline[],
  from: number,
  to: number,
  text: string
): SpInline[] {
  const chars = explodeSp(inlines);
  // positions are UTF-16 units (pm-coords
  // convention): explode to units, splice, then
  // re-join surrogate pairs
  const units: SpChar[] = [];
  for (const c of chars) {
    if (c.ch.length === 1) units.push(c);
    else {
      units.push({
        ch: c.ch[0],
        verbatim: c.verbatim,
      });
      units.push({
        ch: c.ch[1],
        verbatim: c.verbatim,
      });
    }
  }
  const f = Math.max(
    0,
    Math.min(from, units.length)
  );
  const t = Math.max(
    f,
    Math.min(to, units.length)
  );
  // inserted text is exploded to UNITS too — the
  // re-join pass below is stated over units, and a
  // whole surrogate PAIR sitting in the stream would
  // let it glue a third unit onto the pair
  const inserted: SpChar[] = [];
  for (const ch of text) {
    if (ch.length === 1) {
      inserted.push({ ch, verbatim: false });
    } else {
      inserted.push({
        ch: ch[0],
        verbatim: false,
      });
      inserted.push({
        ch: ch[1],
        verbatim: false,
      });
    }
  }
  const spliced = [
    ...units.slice(0, f),
    ...inserted,
    ...units.slice(t),
  ];
  // re-join surrogate pairs
  const joined: SpChar[] = [];
  for (let i = 0; i < spliced.length; i++) {
    const a = spliced[i];
    const b = spliced[i + 1];
    if (
      b &&
      a.ch.charCodeAt(0) >= 0xd800 &&
      a.ch.charCodeAt(0) <= 0xdbff &&
      b.ch.charCodeAt(0) >= 0xdc00 &&
      b.ch.charCodeAt(0) <= 0xdfff
    ) {
      joined.push({
        ch: a.ch + b.ch,
        verbatim: a.verbatim,
      });
      i += 1;
    } else if (
      a.ch.charCodeAt(0) >= 0xd800 &&
      a.ch.charCodeAt(0) <= 0xdfff
    ) {
      // lone surrogate created by the splice:
      // drop it (an editor would never produce
      // one; positions in arbOps are arbitrary)
      continue;
    } else {
      joined.push(a);
    }
  }
  return rebuildSp(joined);
}

type LatinItem =
  | { kind: "ch"; ch: string }
  | { kind: "atom"; inline: LatinInline };

const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Edit over a LatinInline stream in map
 *  coordinates (atom = 1). A range touching an
 *  atom expands to cover it whole (chip edits are
 *  all-or-nothing; deletion = span death). */
export function editLatinInlines(
  inlines: LatinInline[],
  from: number,
  to: number,
  text: string
): LatinInline[] {
  const items: LatinItem[] = [];
  for (const inline of inlines) {
    if (inline.type === "name") {
      items.push({ kind: "atom", inline });
      continue;
    }
    for (const ch of inline.text) {
      // code points; map coords are UTF-16 units,
      // so split pairs into units
      if (ch.length === 1) {
        items.push({ kind: "ch", ch });
      } else {
        items.push({ kind: "ch", ch: ch[0] });
        items.push({ kind: "ch", ch: ch[1] });
      }
    }
  }
  const f = Math.max(
    0,
    Math.min(from, items.length)
  );
  const t = Math.max(
    f,
    Math.min(to, items.length)
  );
  // atoms need no boundary snapping: an atom is a
  // SINGLE item in map coordinates, so any range
  // covers it whole or not at all (chip edits are
  // all-or-nothing; deleting one is span death).
  const inserted: LatinItem[] = [];
  for (const u of text) {
    if (u.length === 1) {
      inserted.push({ kind: "ch", ch: u });
    } else {
      inserted.push({ kind: "ch", ch: u[0] });
      inserted.push({ kind: "ch", ch: u[1] });
    }
  }
  const spliced = [
    ...items.slice(0, f),
    ...inserted,
    ...items.slice(t),
  ];
  const out: LatinInline[] = [];
  for (const it of spliced) {
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
  // drop lone surrogates the splice may have made
  return out.map((n) =>
    n.type === "text"
      ? {
          type: "text" as const,
          text: n.text.replace(
            LONE_SURROGATE,
            ""
          ),
        }
      : n
  );
}

// ---------- op application ----------

function sideInlines(
  block: Block,
  side: Side
): SpInline[] | LatinInline[] {
  return side === "sp"
    ? renderSp(block).inlines
    : renderLatin(block).inlines;
}

function sideLength(
  block: Block,
  side: Side
): number {
  if (side === "sp") {
    let n = 0;
    for (const i of renderSp(block).inlines) {
      n += i.type === "break" ? 1 : i.text.length;
    }
    return n;
  }
  let n = 0;
  for (const i of renderLatin(block).inlines) {
    n += i.type === "name" ? 1 : i.text.length;
  }
  return n;
}

/** The edited side's projection as a flat UTF-16
 *  string in MAP coordinates (a name atom is ONE unit,
 *  a break is "\n"), used only to snap op positions. */
function sideUnits(
  block: Block,
  side: Side
): string {
  return side === "sp"
    ? renderSp(block)
        .inlines.map((i) =>
          i.type === "break" ? "\n" : i.text
        )
        .join("")
    : renderLatin(block)
        .inlines.map((i) =>
          i.type === "name" ? "\uFFFC" : i.text
        )
        .join("");
}

/** The same map-coordinate string as `sideUnits`, but
 *  taken from a raw inline array (a ParsedSide has no
 *  spans, so it cannot be rendered back). Used to
 *  record what text an op's parse ASSERTED. */
function unitsOfInlines(
  inlines: SpInline[] | LatinInline[],
  side: Side
): string {
  return (
    inlines as Array<SpInline | LatinInline>
  )
    .map((i) =>
      i.type === "break"
        ? "\n"
        : i.type === "name"
          ? "\uFFFC"
          : i.text
    )
    .join("");
}

/** Snap a position DOWN to a code-point boundary.
 *  ProseMirror positions are always at code-point
 *  boundaries, so an op that cuts a surrogate pair in
 *  half is not an editor gesture — it is the corpus's
 *  arbitrary integers, and letting one through makes
 *  the INTERPRETER destroy half a glyph and the
 *  oracles blame the merge for it. */
function snap(
  block: Block,
  side: Side,
  pos: number
): number {
  const units = sideUnits(block, side);
  let p = Math.max(0, Math.min(pos, units.length));
  while (!isCodepointBoundary(units, p)) p -= 1;
  return p;
}

function parseSide(
  block: Block,
  side: Side
): ParsedSide {
  return side === "sp"
    ? parseSp(renderSp(block).inlines)
    : parseLatin(renderLatin(block).inlines);
}

/** Divide one inline stream into PARAGRAPHS at its
 *  "\n"s — the shape the editor's normalizer hands
 *  back
 *  after a paste whose payload carried hard breaks.
 *  The break itself is CONSUMED (it became the
 *  boundary), which is what makes a one-newline
 *  payload over a two-paragraph selection an
 *  EQUAL-COUNT reshape. */
function splitAtBreaks(
  inlines: SpInline[] | LatinInline[],
  side: Side
): Array<SpInline[] | LatinInline[]> {
  const out: Array<SpInline[] | LatinInline[]> = [];
  let cur: Array<SpInline | LatinInline> = [];
  const flush = (): void => {
    out.push(cur as SpInline[]);
    cur = [];
  };
  for (const inline of inlines as Array<
    SpInline | LatinInline
  >) {
    if (side === "sp" && inline.type === "break") {
      flush();
      continue;
    }
    if (inline.type === "name") {
      cur.push(inline);
      continue;
    }
    if (side === "sp") {
      cur.push(inline);
      continue;
    }
    // latin: "\n" lives INSIDE text inlines
    if (inline.type === "break") continue;
    const parts: string[] = inline.text.split("\n");
    parts.forEach((part: string, k: number) => {
      if (k > 0) flush();
      if (part.length > 0) {
        cur.push({ type: "text", text: part });
      }
    });
  }
  flush();
  return out;
}

function parseEdited(
  inlines: SpInline[] | LatinInline[],
  side: Side
): ParsedSide {
  return side === "sp"
    ? parseSp(inlines as SpInline[])
    : parseLatin(inlines as LatinInline[]);
}

/** The leftmost block a JOIN's ownership rescue can
 *  reach. rescueJoinedGaps hands a dead sentinel's
 *  owned gap to "the gap after the last surviving
 *  anchor to its left" — and that walk crosses
 *  ZERO-ANCHOR paragraphs, so an empty paragraph
 *  between the join and the block before it puts the
 *  rescued bytes in a block the gesture never named.
 *  That is the flat merge's ownership layout working
 *  as designed; the touched range has to say so, or
 *  oracle 2 reports the layout as damage. */
function rescueReach(
  blocks: Block[],
  j: number
): number {
  let lo = j;
  while (
    lo > 0 &&
    blocks[lo].anchors.length === 0
  ) {
    lo -= 1;
  }
  return lo;
}

export function applyOp(
  lipu: Lipu,
  op: EditOp
): { lipu: Lipu; applied: AppliedOp } {
  const nb = lipu.blocks.length;
  const bi = op.block % nb;
  const block = lipu.blocks[bi];
  const len = sideLength(block, op.side);
  const side = op.side;
  const pos = snap(block, side, op.pos % (len + 1));
  const snapEnd = (n: number): number =>
    snap(block, side, Math.min(n, len));

  const editInlines = (
    from: number,
    to: number,
    text: string
  ): SpInline[] | LatinInline[] =>
    side === "sp"
      ? editSpInlines(
          renderSp(block).inlines,
          from,
          to,
          text
        )
      : editLatinInlines(
          renderLatin(block).inlines,
          from,
          to,
          text
        );

  const nonStructural = (
    from: number,
    to: number,
    text: string
  ): { lipu: Lipu; applied: AppliedOp } => {
    const edited = editInlines(from, to, text);
    const parsed = parseEdited(edited, side);
    const merged =
      side === "sp"
        ? mergeSpBlock(block, parsed)
        : mergeLatinBlock(block, parsed);
    const blocks = lipu.blocks.slice();
    blocks[bi] = merged;
    return {
      lipu: { version: 2, blocks },
      applied: {
        op,
        structural: false,
        blockLo: bi,
        blockHi: bi,
        from,
        to: Math.max(to, from + text.length),
      },
    };
  };

  switch (op.kind) {
    case "insert":
    case "paste":
    case "enter": {
      const text =
        op.kind === "enter" ? "\n" : op.text;
      return nonStructural(pos, pos, text);
    }
    case "delete": {
      const to = Math.max(pos, snapEnd(pos + op.len));
      return nonStructural(pos, to, "");
    }
    case "replace": {
      const to = Math.max(pos, snapEnd(pos + op.len));
      return nonStructural(pos, to, op.text);
    }
    case "split": {
      const edited = editInlines(pos, pos, "");
      const left =
        side === "sp"
          ? editSpInlines(
              edited as SpInline[],
              pos,
              sideLength(block, side),
              ""
            )
          : editLatinInlines(
              edited as LatinInline[],
              pos,
              sideLength(block, side),
              ""
            );
      const right =
        side === "sp"
          ? editSpInlines(
              edited as SpInline[],
              0,
              pos,
              ""
            )
          : editLatinInlines(
              edited as LatinInline[],
              0,
              pos,
              ""
            );
      const sides: ParsedSide[] = [];
      const units: string[] = [];
      lipu.blocks.forEach((b, i) => {
        if (i === bi) {
          sides.push(parseEdited(left, side));
          sides.push(parseEdited(right, side));
          units.push(unitsOfInlines(left, side));
          units.push(unitsOfInlines(right, side));
        } else {
          sides.push(parseSide(b, side));
          units.push(sideUnits(b, side));
        }
      });
      return {
        lipu: {
          version: 2,
          blocks: mergeStructural(
            lipu.blocks,
            sides,
            side
          ),
        },
        applied: {
          op,
          structural: true,
          blockLo: bi,
          blockHi: bi,
          from: pos,
          to: pos,
          editedUnits: units.join(""),
        },
      };
    }
    case "paste-multi":
    case "delete-across": {
      // Both are ONE transaction over a selection
      // that spans the boundary between blocks j and
      // j+1: everything from `pos` in j to `endPos` in
      // j+1 is replaced by op.text (which, for
      // paste-multi, carries its own "\n"s). The
      // paragraph count therefore follows the pasted
      // text, and for a single-"\n" payload it holds
      // while the boundary MOVES — the equal-count
      // reshape that takes the fast path and
      // produces the edge-split relocation's
      // positional-pairing losses.
      // "delete-across" is the same gesture with an
      // empty payload: a count-DECREASING compound
      // transaction that deletes on both sides of the
      // boundary at once (routeSplitGaps' evidence-
      // guard shape).
      if (nb < 2) {
        return {
          lipu,
          applied: {
            op,
            structural: false,
            blockLo: bi,
            blockHi: bi,
            from: 0,
            to: 0,
          },
        };
      }
      const j = Math.min(bi, nb - 2);
      const left = lipu.blocks[j];
      const right = lipu.blocks[j + 1];
      const leftLen = sideLength(left, side);
      const rightLen = sideLength(right, side);
      const from = snap(
        left,
        side,
        op.pos % (leftLen + 1)
      );
      const to = snap(
        right,
        side,
        (op.pos * 7 + op.len) % (rightLen + 1)
      );
      const text =
        op.kind === "delete-across" ? "" : op.text;
      // the selection's surviving head and tail, then
      // the payload between them
      const head =
        side === "sp"
          ? editSpInlines(
              renderSp(left).inlines,
              from,
              leftLen,
              ""
            )
          : editLatinInlines(
              renderLatin(left).inlines,
              from,
              leftLen,
              ""
            );
      const tail =
        side === "sp"
          ? editSpInlines(
              renderSp(right).inlines,
              0,
              to,
              ""
            )
          : editLatinInlines(
              renderLatin(right).inlines,
              0,
              to,
              ""
            );
      const fused =
        side === "sp"
          ? editSpInlines(
              [
                ...(head as SpInline[]),
                ...(tail as SpInline[]),
              ],
              from,
              from,
              text
            )
          : editLatinInlines(
              [
                ...(head as LatinInline[]),
                ...(tail as LatinInline[]),
              ],
              from,
              from,
              text
            );
      // re-chunk the fused paragraph at its "\n"s,
      // the way the editor's normalizer hands
      // paragraphs back
      const chunks = splitAtBreaks(fused, side);
      const sides: ParsedSide[] = [];
      const units: string[] = [];
      lipu.blocks.forEach((blk, i) => {
        if (i === j) {
          for (const c of chunks) {
            sides.push(parseEdited(c, side));
            units.push(unitsOfInlines(c, side));
          }
        } else if (i === j + 1) {
          // consumed by the selection
        } else {
          sides.push(parseSide(blk, side));
          units.push(sideUnits(blk, side));
        }
      });
      return {
        lipu: {
          version: 2,
          blocks: mergeStructural(
            lipu.blocks,
            sides,
            side
          ),
        },
        applied: {
          op,
          structural: true,
          blockLo: rescueReach(lipu.blocks, j),
          blockHi: j + 1,
          from: 0,
          to: 0,
          editedUnits: units.join(""),
        },
      };
    }
    case "join": {
      if (nb < 2) {
        return {
          lipu,
          applied: {
            op,
            structural: false,
            blockLo: bi,
            blockHi: bi,
            from: 0,
            to: 0,
          },
        };
      }
      const j = Math.min(bi, nb - 2);
      const a = sideInlines(
        lipu.blocks[j],
        side
      );
      const b = sideInlines(
        lipu.blocks[j + 1],
        side
      );
      const joinedInlines = [
        ...(a as Array<
          SpInline | LatinInline
        >),
        ...(b as Array<SpInline | LatinInline>),
      ];
      const sides: ParsedSide[] = [];
      const units: string[] = [];
      lipu.blocks.forEach((blk, i) => {
        if (i === j) {
          sides.push(
            parseEdited(
              joinedInlines as SpInline[],
              side
            )
          );
          units.push(
            unitsOfInlines(
              joinedInlines as SpInline[],
              side
            )
          );
        } else if (i === j + 1) {
          // consumed by the join
        } else {
          sides.push(parseSide(blk, side));
          units.push(sideUnits(blk, side));
        }
      });
      return {
        lipu: {
          version: 2,
          blocks: mergeStructural(
            lipu.blocks,
            sides,
            side
          ),
        },
        applied: {
          op,
          structural: true,
          blockLo: rescueReach(lipu.blocks, j),
          blockHi: j + 1,
          from: 0,
          to: 0,
          editedUnits: units.join(""),
        },
      };
    }
  }
}

// ---------- oracles ----------

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (
      val === null ||
      typeof val !== "object" ||
      Array.isArray(val)
    ) {
      return val;
    }
    const rec = val as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(rec).sort()) {
      out[k] = rec[k];
    }
    return out;
  });
}

/** STORED SP content: gap.sp strings and anchor SP
 *  texts concatenated in order, minus JOINER chars.
 *  This is the domain oracle 4b's conservation
 *  clause is stated over.
 *
 *  THREE NAMED EXCLUSIONS (the arbitraries convention —
 *  written down, with reasons, never silent):
 *
 *  1. STRUCTURAL MARKER CHARS are excluded because
 *     they are not stored bytes at all: renderSp
 *     derives them from spans and their positions
 *     from marker offsets, so the documented
 *     OWNERSHIP-CARRY drop (an anchor promoted INTO
 *     a span's exterior gap snaps that span's
 *     marker to its anchor-adjacent default)
 *     legitimately MOVES
 *     one inside its gap without touching a stored
 *     byte. Span survival and offset drops are
 *     oracle 5's subject, not this clause's.
 *  2. JOINER CHARS are excluded because
 *     cleanupJoiners (narrowed to DISTURBED gaps)
 *     drops an unflanked joiner from a gap a Latin
 *     merge disturbed — and an anchor-material
 *     promotion disturbs the very gap it promotes
 *     out of. Joiner PRESERVATION on undisturbed
 *     gaps is the subject of the wide-domain no-op
 *     laws, which this corpus does not restate.
 *
 *  3. WHITESPACE is excluded because it is the one SP
 *     character class whose Latin correspondence is
 *     genuinely ambiguous. An UNMARKED verbatim anchor
 *     renders its text bare on BOTH sides, so
 *     "hi there" is one SP anchor but TWO Latin runs
 *     with the space between them living in gap.latin;
 *     when a Latin edit disturbs it the anchor
 *     splits and that space is now Latin-side
 *     content, gone from the SP concatenation. The
 *     same ambiguity is what the fusion-guard space
 *     and the separation default's injected " " are
 *     about. Every NON-space SP
 *     character — glyphs, marker chars, letters,
 *     digits, punctuation — stays fully in scope, and
 *     the headline losses this oracle exists to catch
 *     (a word anchor's glyph replaced by literal
 *     letters) are all in that set.
 *
 *  Every other stored SP character stays in scope. */
function spCore(b: Block): string {
  let s = b.gaps[0]?.sp ?? "";
  b.anchors.forEach((a, i) => {
    s += anchorSpText(a) + (b.gaps[i + 1]?.sp ?? "");
  });
  return [...s]
    .filter(
      (c) => !JOINER_CHARS.has(c) && !/\s/u.test(c)
    )
    .join("");
}

/** Undo the ABSORPTION FLIP: an UNMARKED verbatim
 *  anchor renders as bare SP text, so a spaces-only
 *  gap.sp beside it fuses into its run and the next
 *  parse hands the spaces back as part of the ANCHOR
 *  ("toki" + gap "  " -> anchor "toki  "). The
 *  arbitraries exclude the flipped shape by
 *  construction (exclusion 5, "verbatim texts have no
 *  leading/trailing spaces") — but an SP merge MINTS
 *  it, and once minted the anchor's text no longer
 *  equals its Latin run, so merge.ts's re-absorption
 *  declines and the Latin parse wins the kind. Moving
 *  the spaces back into the neighbouring gaps restores
 *  the documented normal form; it does not change
 *  spCore, which is the concatenation of both. */
function unflipEdgeSpaces(b: Block): Block {
  const anchors = b.anchors.map((a) => ({ ...a }));
  const gaps = b.gaps.map((g) => ({ ...g }));
  anchors.forEach((a, i) => {
    if (a.kind !== "verbatim" || a.marked) return;
    const text = a.text ?? "";
    const trimmed = text.trim();
    if (trimmed === "" || trimmed === text) return;
    const lead = text.slice(
      0,
      text.length - text.trimStart().length
    );
    const tail = text.slice(text.trimEnd().length);
    a.text = trimmed;
    gaps[i] = { ...gaps[i], sp: gaps[i].sp + lead };
    gaps[i + 1] = {
      ...gaps[i + 1],
      sp: tail + gaps[i + 1].sp,
    };
  });
  return { ...b, anchors, gaps };
}

/** Split every VERBATIM anchor whose text holds
 *  WHITESPACE into one anchor per non-space run, with
 *  the whitespace moved into a fresh gap between them.
 *
 *  This is the second half of the sanitizer's job, and
 *  without it oracle 4b's conservation clause had no
 *  teeth at all: a verbatim renders BARE on the Latin
 *  side, so "hi there" is one SP anchor but TWO Latin
 *  runs, the parse splits it, and the sanitized block
 *  stayed backbone-UNSTABLE — which excused the clause
 *  on every block that held one. Splitting it here is
 *  the canonical form for the Latin round trip, not a
 *  concession: it is exactly what the parse produces,
 *  and spCore is untouched (it concatenates anchor
 *  texts with gap.sp and filters whitespace out, so
 *  moving spaces between the two changes nothing).
 *
 *  Parts are re-marked `marked: true` when they are not
 *  toki pona words, because that is the kind parseLatin
 *  gives an alpha run — again a rendering flag, not a
 *  byte. A part that IS a word-lookalike is left alone:
 *  the Latin parse would make it a WORD anchor, which
 *  renders as a GLYPH, so "canonicalizing" it would
 *  change SP bytes. That shape stays honestly
 *  unstable, and the clause stays excused for it.
 *
 *  Marker offsets survive by construction: the first
 *  part keeps the gap in front of the original anchor
 *  and the last part keeps the gap behind it, so
 *  gaps[span.from] and gaps[span.to + 1] are the same
 *  strings they were. */
function splitWhitespaceVerbatims(
  b: Block
): Block {
  if (
    !b.anchors.some(
      (a) =>
        a.kind === "verbatim" &&
        /\s/u.test(a.text ?? "")
    )
  ) {
    return b;
  }
  const anchors: Anchor[] = [];
  const gaps: Gap[] = [{ ...b.gaps[0] }];
  /** old anchor index -> [firstNew, lastNew] */
  const span: Array<[number, number]> = [];
  b.anchors.forEach((a, i) => {
    const text = a.text ?? "";
    const parts =
      a.kind === "verbatim" && /\s/u.test(text)
        ? text.split(/(\s+)/u)
        : [text];
    const first = anchors.length;
    if (parts.length === 1) {
      anchors.push({ ...a });
    } else {
      let pendingWs = "";
      for (const part of parts) {
        if (part === "") continue;
        if (/^\s+$/u.test(part)) {
          pendingWs += part;
          continue;
        }
        if (anchors.length > first) {
          gaps.push({ sp: pendingWs, latin: " " });
        } else if (pendingWs !== "") {
          gaps[gaps.length - 1] = {
            ...gaps[gaps.length - 1],
            sp:
              gaps[gaps.length - 1].sp + pendingWs,
          };
        }
        pendingWs = "";
        const kept: Anchor = { ...a, text: part };
        if (!isWord(part.toLowerCase())) {
          kept.marked = true;
        }
        anchors.push(kept);
      }
      if (anchors.length === first) {
        // whitespace only: unrepresentable as an
        // anchor (checkBlock rejects empty text), so
        // keep the original
        anchors.push({ ...a });
      }
      if (pendingWs !== "") {
        b.gaps[i + 1] = {
          ...b.gaps[i + 1],
          sp: pendingWs + b.gaps[i + 1].sp,
        };
      }
    }
    span.push([first, anchors.length - 1]);
    gaps.push({ ...b.gaps[i + 1] });
  });
  return {
    anchors,
    gaps,
    spans: b.spans.map((sp) => ({
      ...sp,
      from: span[sp.from][0],
      to: span[sp.to][1],
    })),
  };
}

/** The anchor backbone a LATIN parse can actually be
 *  expected to reproduce.
 *
 *  A raw parse DROPS every anchor whose Latin text is
 *  not anchor material — a verbatim spelling "3.14" or
 *  "?!" goes straight back into gap.latin, because
 *  digits and punctuation are literal gap content
 *  (parse-latin.ts's boundary rule). merge.ts's
 *  RE-ABSORPTION is documented to restore exactly
 *  those, so comparing raw-parse anchors against
 *  stored anchors calls such a block "unstable" when
 *  a no-op over it is in fact required to be an
 *  identity. Filtering both sides to the anchors the
 *  parse can even represent is what makes the
 *  comparison mean "the backbone is stable", and it
 *  OPENS oracle gates rather than closing them: every
 *  block it admits now faces a full-strength
 *  assertion. */
function letterBackbone(anchors: Anchor[]): string {
  return stable(
    anchors
      .filter((a) =>
        /\p{L}/u.test(
          a.kind === "word"
            ? a.word ?? ""
            : a.text ?? ""
        )
      )
      // ...and compared on LATIN-VISIBLE identity only.
      // parseLatin can set `case` and nothing else: the
      // SP facets (variation, niDirection, nameScheme)
      // are invisible to the Latin projection, so a
      // stored anchor carrying one never equals its own
      // re-parse and the comparison called every
      // faceted block "unstable" — which was, measured,
      // the single largest reason oracle 4b's
      // conservation clause stood down. Re-absorption
      // restores the facets; the parse is not expected
      // to know them.
      .map((a) => ({
        kind: a.kind,
        text:
          a.kind === "word" ? a.word ?? "" : a.text ?? "",
        case: a.case,
      }))
  );
}

/** A block with gap.latin PLACEMENT neutralized: the
 *  anchors, the spans and every gap.sp exactly as they
 *  are, plus the whole rendered LATIN TEXT as one
 *  string. Used by oracle 4a' (see its comment).
 *
 *  The latin half is the rendered PROJECTION, not the
 *  gap strings concatenated: re-absorption moves the
 *  boundary between an anchor's own text and its
 *  neighbouring gaps ("...- " + anchor "-" becomes
 *  "...-" + anchor "-" + " "), so the gaps alone are
 *  not even order-stable while the text the Latin pane
 *  shows is byte-identical.
 *
 *  ...and it is rendered with the CARTOUCHES TAKEN OFF,
 *  so atom-INTERIOR gap.latin is visible on both sides
 *  of the comparison. Without that, the
 *  atom-interior re-homing reads as a latin-text
 *  change: content stored interior to an atomizing
 *  cartouche shows as nothing at all before the
 *  no-op and as itself afterwards, purely because
 *  the normal form re-homed it outside the span
 *  (see the NOT-CARVE-OUTS header note —
 *  byte-preserved, one step, no span created or
 *  destroyed). De-atomizing costs this
 *  clause no strength: an atom's spelling is a pure
 *  function of the anchors and spans it covers, and
 *  those are asserted byte-identical on the line above,
 *  so the only thing the atomized text could add is
 *  WHERE gap content sits — which is exactly what this
 *  helper is normalizing away. */
function latinNeutral(b: Block): string {
  return stable({
    anchors: b.anchors,
    spans: b.spans,
    sp: b.gaps.map((g) => g.sp),
    latin: renderLatin({
      ...b,
      spans: b.spans.filter(
        (sp) => sp.kind !== "cartouche"
      ),
    }).text,
  });
}

/** NAMED EXCLUSION for oracle 4's SP branch: RUNS of
 *  VARIATION SELECTORS collapse to their last member.
 *
 *  This is not a weakening of the sp-byte identity
 *  clause, it is the arbitraries' own SP-CONSERVATION
 *  exclusion 2 restated: "a word absorbs ONE variation;
 *  a second VS overwrites the first (carried-over
 *  behavior, pinned as an accepted one-step
 *  canonicalization)".
 *  The corpus can MINT the double-VS shape where the
 *  arbitraries cannot — an SP edit that deletes a glyph
 *  but not its variation selector leaves a bare-VS
 *  verbatim anchor, and a later paste can seat it right
 *  behind another variation-carrying word — so the
 *  exclusion has to be stated here too. Every other SP
 *  byte stays in scope: the clause is otherwise
 *  untouched and at full strength. */
function vsCanon(t: string): string {
  return t.replace(
    /[\uFE00-\uFE0F]{2,}/gu,
    (m) => m[m.length - 1]
  );
}

/** Longest-common-subsequence LENGTH over code
 *  points. Gap strings are short (a handful of chars),
 *  so the quadratic table is free. */
function lcsLen(a: string[], b: string[]): number {
  const prev = new Array<number>(b.length + 1).fill(0);
  const cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = 0;
    for (let j = 1; j <= b.length; j++) {
      cur[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], cur[j - 1]);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** Is `a` a subsequence of `b` (code points)? */
function isSubsequence(
  a: string,
  b: string
): boolean {
  const as = [...a];
  const bs = [...b];
  let i = 0;
  for (const c of bs) {
    if (i < as.length && as[i] === c) i += 1;
  }
  return i === as.length;
}

/** THE FUSION-GUARD FIXPOINT diagnosis — a fixed
 *  bug's regression lock rather than a tolerance
 *  (pinned in edit-corpus.test.ts).
 *
 *  As found: no editor merge entrypoint
 *  re-established the latin fusion-guard fixpoint,
 *  so a merge could hand back a block on which the
 *  very next Latin parse DESTROYS a word anchor
 *  (glyph loss) — the exact class the separation
 *  default and the letterish pass exist to forbid.
 *  The doors:
 *
 *   (a) mergeSpBlock's separation default fires
 *       only on latin === "", so an SP edit that
 *       inserts an anchor next to a stored
 *       NON-EMPTY letter-ish gap.latin leaves the
 *       fusing shape unless the letterish pass runs
 *       after the edit too (it used to run only at
 *       the editor's load boundary).
 *   (b) an SP edit that kills a CARTOUCHE span
 *       un-covers a flank the guards had exempted,
 *       exposing a mark-leading gap.latin (this
 *       falsified an arbitraries-header claim that
 *       the mark-leading shape is unreachable from
 *       editor ops; the header was corrected with
 *       the code).
 *   (c) the separation default's right-boundary
 *       predicate was letters-only on the stated
 *       assumption that "every anchor START is
 *       guaranteed letter-only", which a verbatim
 *       anchor holding a stranded VARIATION
 *       SELECTOR falsifies — fixed by the
 *       LETTERISH_START widening.
 *  (A reported fourth door — a Latin join leaving
 *  an empty gap.latin between letter-rendering
 *  anchors — was NOT reproduced as characterized:
 *  the construction fuses AT THE PARSE, so the
 *  merge reproduces a parse-authoritative reading
 *  rather than leaving a guard-less gap behind.)
 *
 *  This is NOT a skip. The branch asserts the
 *  DIAGNOSIS: an SP-destroying Latin parse is
 *  tolerated only when (a) the block is genuinely off
 *  the fusion-guard fixpoint and (b) applying the
 *  guards first restores conservation — i.e. the loss
 *  is fully explained by the missing guard pass and by
 *  nothing else. Any other SP-destroying parse is
 *  reported. */
function diagnoseSpLoss(b: Block): string[] {
  const latinRt = (x: Block): Block =>
    mergeLatinBlock(
      x,
      parseLatin(renderLatin(x).inlines)
    );
  // SANITIZED probe: the SAME block canonicalized back
  // into the NORMAL FORM the library's own laws are
  // stated over — every gap.latin reduced to WHITESPACE
  // (which removes both halves of exclusion 1's
  // rationale at once: the anchor material that
  // promotes, and the punctuation that collides with a
  // punctuation-only ANCHOR's text so that
  // "re-absorption occurrences stay
  // position-unambiguous"), every gap padded so no run
  // can fuse across it, and the absorption flip undone
  // (exclusion 5). gap.latin is not SP content, so none
  // of this touches spCore. Merges are observed to mint
  // blocks OUTSIDE that domain; losses that only
  // happen outside it are the fusion-guard
  // fixpoint class.
  //
  // Deliberately NOT written in terms of the
  // shipped guards. Those have their own blind
  // spots (a right-boundary test that is
  // letters-only on the stated
  // assumption that "every anchor START is guaranteed
  // letter-only", which a verbatim anchor holding a
  // stranded VARIATION SELECTOR falsifies), and a
  // diagnosis phrased in the buggy predicate would
  // excuse exactly the bugs it exists to name. Both
  // edits touch gap.latin ONLY, so spCore is unchanged
  // by them: if the destruction disappears here,
  // it was caused by gap-resident latin content —
  // the fusion-guard fixpoint class in full. If it
  // survives, the loss has nothing to do with that
  // class and is reported. */
  const sanitized = splitWhitespaceVerbatims(
    unflipEdgeSpaces({
    ...b,
    gaps: b.gaps.map((g) => ({
      ...g,
      latin:
        " " +
        g.latin.replace(/\S/gu, "") +
        " ",
    })),
    })
  );
  // The sanitizer can only normalize GAPS. An anchor
  // whose own text the Latin parse re-tokenizes — any
  // verbatim holding whitespace, marked or not, since
  // both render bare on the Latin side — stays
  // ambiguous no matter what the gaps look like: the
  // parse splits it, the halves become two anchors,
  // and the gap the original owned dies with it,
  // taking whatever gap.sp it held. That is the same
  // fixpoint class (the model is outside the domain
  // its laws are stated over) reached through the
  // anchor rather than the gap, so the sanitized
  // block's OWN backbone stability is the honest
  // boundary of this clause.
  //
  // LIMITATION, stated plainly rather than hidden:
  // the conservation clause therefore has teeth
  // only for blocks the sanitizer can actually
  // bring back into the normal form. For the rest,
  // oracle 4b's SETTLE clause (full strength, never
  // relaxed), oracle 4a's identity clause, and
  // oracles 1/2/3/5 are what hold.
  const sanStable =
    letterBackbone(
      parseLatin(renderLatin(sanitized).inlines)
        .anchors
    ) === letterBackbone(sanitized.anchors);
  corpusStats.oracle4bLoss += 1;
  if (sanStable) {
    corpusStats.oracle4bAdjudicated += 1;
  } else {
    corpusStats.oracle4bExcused += 1;
  }
  if (
    !sanStable ||
    isSubsequence(
      spCore(sanitized),
      spCore(latinRt(sanitized))
    )
  ) {
    return [];
  }
  // The DUPLICATE-WORD ALIGNMENT bug is FIXED, in
  // full. It had ONE cause, the LCS alignment key
  // in merge.ts. When a block held two
  // punctuation-only anchors with the SAME text (a
  // marked verbatim "-" twice, one of them covered
  // by a cartouche that ATOMIZES because it also
  // covers a word, so the Latin projection showed
  // the name and not that "-"), the raw parse
  // returned both occurrences to gap.latin and the
  // alignment had nothing to tell them apart. It
  // matched by position, and the anchor it stranded
  // DIED with its SP bytes on a per-block Latin
  // NO-OP. The occurrence-aware secondary key now
  // disambiguates that shape (the regression lock
  // is in edit-corpus.test.ts).
  //
  // A branch USED to sit here excusing a loss
  // whenever making the duplicate punctuation texts
  // unique made it go away. That escape is REMOVED:
  // the bug is fixed, the hatch measured 0 hits on
  // either family at the committed seed both before
  // and after the fix, and a live hatch for a fixed
  // defect would silently excuse the regression it
  // was built to find. The occurrence-aware keying
  // and its pins are the guard now; a recurrence
  // fails here, loudly.
  //
  // The whitespace-verbatim split-half
  // misalignment does not need the hatch either: it
  // shows up as the seed-1 ORACLE-3 limit recorded
  // in the SEED SCOPE header, not as an SP loss
  // this clause adjudicates.
  return [
    "a Latin parse destroyed SP bytes from a " +
      "block the sanitizer restored to the latin " +
      "normal form — outside the fusion-guard " +
      "fixpoint class",
  ];
}

/** INSTRUMENTATION. Counters the corpus
 *  tests read back to assert that the oracles' GATES
 *  actually stand open often enough to mean something,
 *  and that every op kind reaches the path it names.
 *  Statistics only — never consulted by an oracle. */
export interface CorpusStats {
  ops: Record<string, number>;
  structuralOps: number;
  sideOps: Record<string, number>;
  /** oracle 3: gate open vs closed by the edited
   *  side's parse-fixpoint precondition */
  oracle3Open: number;
  oracle3Closed: number;
  /** oracle 4: 4a (strict identity, raw backbone
   *  stable), 4a' (placement-neutral identity) and 4b */
  oracle4a: number;
  oracle4aPrime: number;
  oracle4b: number;
  /** oracle 4b's SP-conservation clause: how often it
   *  was REACHED (a loss to explain), and of those how
   *  often the sanitizer restored the block so the
   *  clause could ADJUDICATE rather than be excused */
  oracle4bLoss: number;
  oracle4bAdjudicated: number;
  oracle4bExcused: number;
  /** oracle 7: marker pairs compared, and how
   *  many sat in a byte-identical gap (the strict
   *  branch) */
  oracle7Compared: number;
  oracle7SameGap: number;
  /** oracle 2's stranding-acceptance
   *  document-level fallback */
  strandingFallbackTaken: number;
  /** a carried cartouche re-atomized freshly
   *  pasted Latin text; counts only the SAME-KIND
   *  residue the span kind-change rule leaves
   *  standing. */
  reAtomized: number;
}

export const corpusStats: CorpusStats = {
  ops: {},
  structuralOps: 0,
  sideOps: {},
  oracle3Open: 0,
  oracle3Closed: 0,
  oracle4a: 0,
  oracle4aPrime: 0,
  oracle4b: 0,
  oracle4bLoss: 0,
  oracle4bAdjudicated: 0,
  oracle4bExcused: 0,
  oracle7Compared: 0,
  oracle7SameGap: 0,
  strandingFallbackTaken: 0,
  reAtomized: 0,
};

export function resetCorpusStats(): void {
  corpusStats.ops = {};
  corpusStats.sideOps = {};
  corpusStats.structuralOps = 0;
  corpusStats.oracle3Open = 0;
  corpusStats.oracle3Closed = 0;
  corpusStats.oracle4a = 0;
  corpusStats.oracle4aPrime = 0;
  corpusStats.oracle4b = 0;
  corpusStats.oracle4bLoss = 0;
  corpusStats.oracle4bAdjudicated = 0;
  corpusStats.oracle4bExcused = 0;
  corpusStats.oracle7Compared = 0;
  corpusStats.oracle7SameGap = 0;
  corpusStats.strandingFallbackTaken = 0;
  corpusStats.reAtomized = 0;
}

const bump = (
  bag: Record<string, number>,
  key: string
): void => {
  bag[key] = (bag[key] ?? 0) + 1;
};

// ---------- oracle 7: marker relocation ----------

/** One structural span's two MARKER positions, with
 *  the gap text each one divides. `off` is the
 *  EFFECTIVE position: an absent startOffset means
 *  gap.sp.length and an absent endOffset means 0
 *  (types.ts), so absence is a POSITION, not a
 *  missing value — which is exactly why a marker can
 *  move without any offset field changing. */
interface MarkerCtx {
  gap: string;
  off: number;
  defined: boolean;
}

function markerCtxs(
  b: Block
): Map<string, Array<[MarkerCtx, MarkerCtx]>> {
  const out = new Map<
    string,
    Array<[MarkerCtx, MarkerCtx]>
  >();
  for (const sp of b.spans) {
    if (
      sp.kind !== "cartouche" &&
      sp.kind !== "long" &&
      sp.kind !== "rev-long"
    ) {
      continue;
    }
    const startGap = b.gaps[sp.from]?.sp ?? "";
    const endGap = b.gaps[sp.to + 1]?.sp ?? "";
    const key =
      sp.kind +
      "|" +
      stable(b.anchors.slice(sp.from, sp.to + 1));
    const entry: [MarkerCtx, MarkerCtx] = [
      {
        gap: startGap,
        off: sp.startOffset ?? startGap.length,
        defined: sp.startOffset !== undefined,
      },
      {
        gap: endGap,
        off: sp.endOffset ?? 0,
        defined: sp.endOffset !== undefined,
      },
    ];
    const list = out.get(key) ?? [];
    list.push(entry);
    out.set(key, list);
  }
  return out;
}

/** ORACLE 7 — MARKER RELOCATION. The net the
 *  coordinate mix slipped through: the tripwire only
 *  reports offsets the tail pass cannot keep, so an
 *  arithmetic error that happens to land IN RANGE is
 *  invisible to it. This oracle watches the marker's
 *  POSITION IN ITS GAP across every op instead.
 *
 *  Two branches, both stated over spans identified by
 *  (kind + covered anchors) so index shifts cannot
 *  confuse one span for another:
 *
 *   STRICT — the marker's gap is BYTE-IDENTICAL before
 *     and after. Then the marker must not have moved
 *     at all, with exactly one legal exception: it may
 *     become ABSENT, which is the registered snap
 *     to the anchor-adjacent default (and, on a
 *     non-structural op, oracle 5 already
 *     adjudicates that drop).
 *     Any move to a different DEFINED offset in an
 *     untouched string is a silent relocation.
 *   REWRITTEN — the gap changed. A legal remap is
 *     always a pure INSERTION or a pure DELETION on
 *     each side of the marker (routeSplitGaps prepends
 *     the divided right half; collapseSeamRuns deletes
 *     "\n"s; demoteStraddlers inserts marker chars),
 *     so the text before the marker must be a
 *     subsequence of the old text before it or vice
 *     versa, and likewise after. A marker that ends up
 *     with content on the WRONG SIDE satisfies neither
 *     — which is precisely what a prev-coordinate
 *     offset applied to a merge-rewritten string does. */
export function checkMarkerRelocation(
  before: Lipu,
  after: Lipu,
  structural: boolean,
  side: Side
): string[] {
  const errs: string[] = [];
  // SCOPE: LATIN edits only — the side on which the SP
  // projection, and with it every marker char, is
  // CARRIED. There the merge alone decides where a
  // marker sits, so any move is the merge's doing and
  // this oracle can hold it to account.
  //
  // On an SP edit the SP text is PARSE-AUTHORITATIVE:
  // parseSp re-derives the marker positions from the
  // characters the user now has, and re-partitions the
  // text between anchors and gaps while it is at it.
  // A gap can come back byte-identical and still be a
  // DIFFERENT span of the document (observed: pasting
  // a space next to "42" moved the space into the
  // anchor, leaving gap.sp " " unchanged but now
  // sitting on the other side of the marker char).
  // Comparing offsets across that is comparing two
  // coordinate systems — the very mistake this oracle
  // exists to catch. Offset DROPS on the SP side are
  // oracle 5's subject.
  if (side !== "latin") return errs;
  const collect = (
    l: Lipu
  ): Map<string, Array<[MarkerCtx, MarkerCtx]>> => {
    const all = new Map<
      string,
      Array<[MarkerCtx, MarkerCtx]>
    >();
    for (const b of l.blocks) {
      for (const [k, v] of markerCtxs(b)) {
        all.set(k, [...(all.get(k) ?? []), ...v]);
      }
    }
    return all;
  };
  const b0 = collect(before);
  const b1 = collect(after);
  const consistent = (
    x: MarkerCtx,
    y: MarkerCtx
  ): boolean => {
    if (x.gap === y.gap) {
      corpusStats.oracle7SameGap += 1;
      // absence is the registered snap; anything
      // else must not have moved
      return !y.defined || y.off === x.off;
    }
    if (!y.defined) return true;
    // REWRITTEN branch, STRUCTURAL ops only. On a
    // non-structural op the gap text is what the user
    // just typed, and a REPLACE legitimately swaps the
    // character on one side of the marker for a
    // different one — the marker did not move, its
    // neighbourhood did, and oracles 3 and 5 own that.
    // The relocation class this oracle exists for
    // (a prev-coordinate offset applied to a
    // merge-rewritten string) lives in the routing
    // passes, which only run on the flat path.
    if (!structural) return true;
    // ALIGNMENT CONSISTENCY. A single merge can both
    // DELETE from a gap (cleanupJoiners drops an
    // unflanked joiner) and INSERT into it
    // (demoteStraddlers restores a straddler's marker
    // char), so "one side is a subsequence of the
    // other" is not a rule the legal remaps obey. What
    // they all do obey is that the marker keeps its
    // place in the ALIGNMENT: the surviving characters
    // in front of it stay in front of it and the ones
    // behind stay behind. Splitting a maximum
    // alignment at the marker must therefore lose
    // nothing —
    //     lcs(before) === lcs(prefixes) + lcs(suffixes)
    // — which is exactly false when a marker JUMPS
    // across surviving content, i.e. when an offset
    // measured in one string is applied to another.
    const cp = (t: string): string[] => [...t];
    const pre0 = cp(x.gap.slice(0, x.off));
    const pre1 = cp(y.gap.slice(0, y.off));
    const suf0 = cp(x.gap.slice(x.off));
    const suf1 = cp(y.gap.slice(y.off));
    return (
      lcsLen(pre0, pre1) + lcsLen(suf0, suf1) ===
      lcsLen(cp(x.gap), cp(y.gap))
    );
  };
  for (const [key, list0] of b0) {
    const list1 = b1.get(key);
    // span died, or the anchors it covers changed so
    // the identity key no longer matches: nothing to
    // compare (span death is licensed and oracles
    // 2/4 own the anchor changes)
    if (list1 === undefined) continue;
    if (list1.length !== list0.length) continue;
    list0.forEach(([s0, e0], k) => {
      const [s1, e1] = list1[k];
      corpusStats.oracle7Compared += 1;
      if (!consistent(s0, s1)) {
        errs.push(
          "oracle7 START marker RELOCATED inside " +
            `its gap (${key})`
        );
      }
      if (!consistent(e0, e1)) {
        errs.push(
          "oracle7 END marker RELOCATED inside " +
            `its gap (${key})`
        );
      }
    });
  }
  return errs;
}

export function checkOracles(
  before: Lipu,
  after: Lipu,
  applied: AppliedOp
): string[] {
  const errs: string[] = [];
  bump(corpusStats.ops, applied.op.kind);
  bump(corpusStats.sideOps, applied.op.side);
  if (applied.structural) {
    corpusStats.structuralOps += 1;
  }
  // 7. MARKER RELOCATION — runs first so a
  // relocation is reported even when a later oracle
  // also fires on the same step.
  errs.push(
    ...checkMarkerRelocation(
      before,
      after,
      applied.structural,
      applied.op.side
    )
  );
  // 1. checkBlock holds everywhere
  after.blocks.forEach((b, i) => {
    for (const e of checkBlock(b)) {
      errs.push(`oracle1 block ${i}: ${e}`);
    }
  });
  // 2. untouched blocks byte-identical (compare
  // from the ends; structural ops shift indices).
  //
  // SECOND DOMAIN (not a relaxation — a tighter
  // statement of what "untouched" means for a
  // STRUCTURAL op): a structural transaction hands
  // mergeStructural the parse of EVERY paragraph,
  // untouched ones included, exactly as the editor
  // will. For a paragraph carrying LATIN ANCHOR
  // MATERIAL in gap.latin, that parse is documented
  // NOT to be a no-op (see oracle 4b) — so such a
  // block is allowed to change by EXACTLY its own
  // per-block side no-op merge and by nothing else.
  // Where the side no-op IS identity (every other
  // block) the two branches coincide, so nothing is
  // given away.
  const sideNoOp = (b: Block): Block =>
    applied.op.side === "sp"
      ? mergeSpBlock(
          b,
          parseSp(renderSp(b).inlines)
        )
      : mergeLatinBlock(
          b,
          parseLatin(renderLatin(b).inlines)
        );
  // THIRD DOMAIN — the EDGE-SPLIT RELOCATION
  // (registered accepted limitation: "relocation of
  // a following paragraph's leading gap — both
  // sides; relocated, never lost; exact pin in
  // edit-corpus.test.ts"). A split at a paragraph
  // EDGE mints an output run of ADJACENT sentinels
  // against a prev run of them. Sentinels are
  // identical anchors, so which output sentinel IS a
  // given prev boundary is an LCS tie-break (see
  // routeSplitGaps' own note: "it picks the later
  // one"). A prev boundary paired with an EARLIER
  // output sentinel carries its OWNED gap — which is
  // the FOLLOWING paragraph's gaps[0] — into that
  // earlier output position, so a trailing
  // paragraph's leading gap hands its CARRIED side to
  // the paragraph in front of it (typically the newly
  // minted empty one). Content is RELOCATED, never
  // destroyed ("gap CONTENT is never lost" holds
  // document-wide), but it changes paragraph.
  //
  // Recognized by EXACT shape, never skipped: a
  // trailing block may differ from its own side no-op
  // in gaps[0][carried] AND NOTHING ELSE, and the
  // carried leading-gap strings over the whole
  // trailing region must still be CONSERVED in order
  // (checked once, below). A block that changes
  // anywhere else, or a carried string that goes
  // missing, still fires.
  const carried: Side =
    applied.op.side === "sp" ? "latin" : "sp";
  // ...and the registered ATTR-PAIRING DROP: attr
  // pairing is deliberately conservative — a prev
  // span's attrs may land only where that span's own
  // anchors map to, so a re-promotion whose ordinals
  // shifted DECLINES rather than risk stealing another
  // span's latinSpelling. The flat path shifts them
  // routinely (every paragraph's markers are
  // promoted in one stream), so an untouched block
  // can come back with its cartouche attrs dropped.
  // The registry accepts exactly this loss for the
  // demote→re-promote route; the flat re-promotion
  // is the same mechanism, so `neutral` ignores
  // DROPPED
  // attrs — and only dropped ones: an attr that
  // appears or CHANGES is checked separately below and
  // still fires.
  // Provenance: the carried side's mark rides
  // along with its bytes (copy-on-write,
  // provenance.ts), so zeroing gaps[0][carried]
  // here must also drop its mark key — otherwise a
  // relocated/lost carried gap the registered
  // tolerances cover newly fails oracle2 on
  // mark-key PRESENCE alone, never on content. Not
  // a relaxation of
  // reattachProvenance: the byte-level tolerance
  // already existed; this only keeps the mark from
  // defeating it.
  const carriedMarkKey: "spAuthored" | "latinAuthored" =
    carried === "sp" ? "spAuthored" : "latinAuthored";
  const neutral = (b: Block): string =>
    stable({
      ...b,
      gaps: b.gaps.map((g, gi) => {
        if (gi !== 0) return g;
        const { [carriedMarkKey]: _m, ...rest } = g;
        return { ...rest, [carried]: "" };
      }),
      spans: b.spans.map((sp) => {
        const { attrs: _drop, ...rest } = sp;
        // ...and, when SP is the carried side, the
        // startOffset of a span anchored at gaps[0]:
        // that offset INDEXES the very gap the
        // edge-split relocation moves to another
        // paragraph, so when the gap goes the
        // marker has nowhere to point and snaps to
        // its anchor-adjacent default. That is the
        // marker-drop rule applying to the
        // relocation — two registered carve-outs
        // composing, not a third thing.
        if (carried === "sp" && rest.from === 0) {
          delete rest.startOffset;
        }
        return rest;
      }),
    });
  /** Did any span gain or change an attr? Dropping
   *  is the registered attr-pairing drop; inventing
   *  or rewriting one never is.
   *
   *  Spans are paired by IDENTITY KEY (kind +
   *  covered anchors), not by array index. Index
   *  pairing is wrong whenever the two lists differ in
   *  length or order — which is exactly the situation
   *  this branch exists for, since sortSpans reorders
   *  on kind and rechunk can drop one — and it
   *  would happily compare a cartouche's attrs against
   *  a bold span's absent ones. */
  const attrKey = (b: Block, sp: Span): string =>
    sp.kind +
    "|" +
    stable(b.anchors.slice(sp.from, sp.to + 1));
  const attrsOnlyDropped = (
    b1: Block,
    b0: Block
  ): boolean => {
    const was = new Map<string, string[]>();
    for (const sp of b0.spans) {
      const k = attrKey(b0, sp);
      was.set(k, [
        ...(was.get(k) ?? []),
        stable(sp.attrs),
      ]);
    }
    return b1.spans.every((sp) => {
      if (sp.attrs === undefined) return true;
      const seen = was.get(attrKey(b1, sp));
      return (
        seen !== undefined &&
        seen.includes(stable(sp.attrs))
      );
    });
  };
  const delta =
    after.blocks.length - before.blocks.length;
  /** Untouched before-index -> after-index. */
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < applied.blockLo; i++) {
    pairs.push([i, i]);
  }
  for (
    let i = applied.blockHi + 1;
    i < before.blocks.length;
    i++
  ) {
    pairs.push([i, i + delta]);
  }
  // FOURTH DOMAIN — the FLAT-PATH STRANDING
  // acceptance (registered accepted limitation,
  // until transaction-level mapping exists; the pin
  // the registry requires is in
  // edit-corpus.test.ts). A count-CHANGING
  // transaction takes the FLAT path, where anchors
  // from DIFFERENT paragraphs compete in one LCS
  // over rendered text. mergeStructural's own
  // fast-path note names the hazard ("a
  // parse-unstable anchor in block 0 could be
  // matched against a same-rendering anchor in
  // block 1 and be stranded, losing SP bytes") and
  // answers it for EQUAL counts only — a split or a
  // join has no fast path to fall back to. A Latin
  // projection is parse-unstable far more often
  // than an SP one (an un-cartouched marked
  // verbatim anchor whose Latin text is pure
  // punctuation goes back into gap.latin, and only
  // merge.ts's re-absorption rescues it). When the
  // stranding happens the block's CARRIED side is
  // destroyed — real byte loss, on a paragraph the
  // user never touched. The real fix is
  // transaction-level mapping (editor step
  // positions), which lives outside this library.
  //
  // Gated on the block being a NON-FIXPOINT of the
  // edited side's own parse — the precondition the
  // stranding needs — and even then the EDITED side
  // must still be conserved exactly, because the fresh
  // parse is authoritative and no amount of LCS
  // confusion may rewrite it. A parse-fixpoint block
  // gets no leniency at all.
  /** Is the block a fixpoint of the EDITED side's own
   *  MERGE — is a no-op on that side an identity?
   *
   *  This is the precondition oracle 3's positional
   *  reasoning actually needs ("the anchor backbone
   *  outside the edit window survives the edit"), and
   *  it is not circular: oracle 3 asserts about gap
   *  CONTENT after a real edit, never about the no-op.
   *  It used to test the RAW PARSE's anchors instead,
   *  which called a block unstable whenever it held a
   *  punctuation-only verbatim — a shape the raw parse
   *  always drops and re-absorption always restores —
   *  and closed the gate on blocks that are perfectly
   *  stable. Compared as the whole BLOCK, so the
   *  absorption flip ("xq" + gap "  " -> anchor
   *  "xq  ") and every span/gap movement count as
   *  instability too. */
  const parseFixpoint = (b: Block): boolean =>
    stable(sideNoOp(b)) === stable(b);
  /** ...and a SECOND, different notion for the
   *  stranding gate below. The precondition is
   *  about the RAW PARSE, not about the merge: in the
   *  flat stream every paragraph's anchors compete in
   *  ONE LCS, and an anchor the raw parse drops (a
   *  punctuation-only verbatim goes back into
   *  gap.latin) is exactly the anchor whose rescue can
   *  be claimed by a same-rendering anchor in another
   *  paragraph. Such a block can be a perfectly good
   *  merge FIXPOINT on its own — re-absorption restores
   *  it every time when nothing competes — so the two
   *  gates must not share a predicate. */
  const rawParseUnstable = (b: Block): boolean =>
    stable(parseSide(b, applied.op.side).anchors) !==
    stable(b.anchors);
  let sawF2 = false;
  const perBlock: string[] = [];
  for (const [i, j] of pairs) {
    const b0 = before.blocks[i];
    const b1 = after.blocks[j];
    const where =
      i < applied.blockLo ? "leading" : "trailing";
    if (b1 !== undefined) {
      if (stable(b1) === stable(b0)) continue;
      if (applied.structural) {
        const want = sideNoOp(b0);
        if (stable(b1) === stable(want)) continue;
        if (
          neutral(b1) === neutral(want) &&
          attrsOnlyDropped(b1, want)
        ) {
          sawF2 = true;
          continue;
        }
      }
    }
    perBlock.push(
      `oracle2 ${where} block ${i} changed`
    );
  }
  // The stranding fallback fires only when the
  // per-block
  // statement ALREADY failed, so a merge that behaves
  // still faces the strict oracle. The precondition is
  // DOCUMENT-level, not block-level: the flat stream
  // mixes every paragraph's anchors into one LCS, so a
  // single parse-unstable paragraph anywhere in the
  // document can shift paragraph identity for blocks
  // that are perfectly stable themselves (observed: a
  // "ni" promoted out of paragraph 2's gap.latin pairs
  // with paragraph 1's "ni" anchor, and paragraph 1's
  // niDirection facet lands one paragraph later).
  if (perBlock.length > 0) {
    const docUnstable =
      applied.structural &&
      before.blocks.some(
        (b) => rawParseUnstable(b) || !parseFixpoint(b)
      );
    if (!docUnstable) {
      errs.push(...perBlock);
    } else {
      corpusStats.strandingFallbackTaken += 1;
      // What survives the fallback is
      // DOCUMENT-level edited-side
      // conservation: the fresh parse is authoritative,
      // so however the LCS shuffles paragraph identity
      // it may never destroy a character of the text
      // the parse asserted.
      //
      // Measured against `applied.editedUnits` — the
      // text the OP's parse asserted — not against the
      // before-document. A deleting gesture
      // (delete-across) really does destroy characters,
      // so the before-document is not the yardstick;
      // and MAP coordinates (atom = one "\uFFFC",
      // stripped below) sidestep derived text, since
      // promoting a cartouche legitimately respells its
      // name atom without any user text changing.
      const atomless = (t: string): string =>
        t.split("\uFFFC").join("");
      const wantDoc = atomless(
        applied.editedUnits ??
          before.blocks
            .map((b) =>
              sideUnits(b, applied.op.side)
            )
            .join("")
      );
      const gotDoc = atomless(
        after.blocks
          .map((b) => sideUnits(b, applied.op.side))
          .join("")
      );
      if (!isSubsequence(wantDoc, gotDoc)) {
        // Re-atomization: a prev CARTOUCHE span,
        // reconciled onto content the paste freshly
        // created, ATOMIZES it — the Latin pane
        // stops showing the characters the user
        // pasted and shows the span's projected
        // NAME instead ("mi" -> "M"). The SPAN
        // KIND-CHANGE RULE (doc-merge's
        // dropKindChangedSpans) kills such a span
        // whenever the replacement pairing crossed
        // a KIND boundary (verbatim "-" -> word
        // "mi"); the pin lives in
        // edit-corpus.test.ts.
        //
        // This branch survives for the SAME-KIND
        // residue the rule leaves standing — a word
        // pasted over a word inside a cartouche is
        // a spelling change to a name, so the span
        // follows and the pane atomizes it
        // (measured: a small residue, well below
        // the pre-rule count).
        //
        // Recognized by EXACT shape, never skipped: the
        // loss must disappear when the cartouches are
        // taken off, i.e. the characters are all still
        // in the model, hidden behind an atom. Any
        // other document-text destruction still fires.
        const deAtomized = after.blocks
          .map((b) =>
            sideUnits(
              {
                ...b,
                spans: b.spans.filter(
                  (sp) => sp.kind !== "cartouche"
                ),
              },
              applied.op.side
            )
          )
          .join("");
        if (
          isSubsequence(wantDoc, atomless(deAtomized))
        ) {
          corpusStats.reAtomized += 1;
        } else {
          errs.push(
            "oracle2 a count-changing merge " +
              "DESTROYED edited-side document text"
          );
        }
      }
    }
  }
  if (sawF2) {
    // RELOCATION CONSERVATION: every carried
    // leading-gap
    // CHARACTER an untouched block held must still be
    // somewhere in the output document's leading gaps,
    // in order. Stated over the concatenation rather
    // than per block, because a JOIN legitimately
    // CONCATENATES two boundary-owned gaps into one
    // (rescueJoinedGaps) and a split relocates one
    // whole — both are order-preserving. A carried
    // character that simply DISAPPEARS is neither, and
    // fires.
    // NEWLINES are out of scope for this clause,
    // on BOTH structural gestures, and both
    // exemptions are REGISTERED carve-outs rather
    // than concessions: the LATIN-SPLIT NEWLINE
    // CONSUMPTION eats the split gap's newline runs
    // on both sides, and the JOIN SEAM RULE
    // collapses the seam gap's carried-side newline
    // run to at most one. The exemption is applied
    // to BOTH edit sides here, deliberately one
    // step wider: an SP split's newline handling is
    // the Enter default's delta territory, which
    // moves carried "\n"s for its own registered
    // reasons, so a newline-sensitive clause on
    // this side would be adjudicating three
    // carve-outs at once. Every NON-newline carried
    // character stays in scope on both sides. The
    // adjacent-sentinel tie decides WHICH gap
    // counts as the seam, which is why the
    // exemption is stated over the whole
    // concatenation.
    const stripSeamNoise = (t: string): string => {
      const noNl = t.split("\n").join("");
      // ...and spCore's joiner exclusion, for the same
      // reason: cleanupJoiners drops an unflanked
      // joiner from any gap the merge disturbed, and a
      // relocated boundary gap is disturbed by
      // definition.
      return carried === "sp"
        ? [...noNl]
            .filter((c) => !JOINER_CHARS.has(c))
            .join("")
        : noNl;
    };
    const want = stripSeamNoise(
      pairs
        .map(
          ([i]) =>
            sideNoOp(before.blocks[i]).gaps[0][
              carried
            ]
        )
        .join("")
    );
    // ...searched across EVERY gap of the output, not
    // just leading ones: when the paragraph in front
    // also gained anchors, the relocated boundary gap
    // lands as an INTERIOR gap of that paragraph
    // rather than as its gaps[0]. Relocation is what
    // the relocation tolerates; the clause is
    // about DESTRUCTION.
    const got = stripSeamNoise(
      after.blocks
        .map((b) =>
          b.gaps.map((g) => g[carried]).join("")
        )
        .join("")
    );
    if (!isSubsequence(want, got)) {
      errs.push(
        "oracle2 carried leading-gap content " +
          "LOST, not merely relocated"
      );
    }
  }
  // 3. other-side survival inside the edited
  // block, non-structural ops only: gaps outside
  // the edited window (located from the block
  // ends) keep other-side bytes. The window is
  // the touched gap ordinals +/- 1 anchor.
  //
  // PRECONDITION — PARSE FIXPOINT on the edited side.
  // This oracle locates gaps POSITIONALLY from the
  // block's ends, which presumes the anchor backbone
  // outside the edit window survives the edit. That
  // presumption is exactly "the block is a fixpoint of
  // the edited side's own parse": if the projection
  // re-parses to a different anchor COUNT, every gap
  // index shifts and a positional comparison compares
  // unrelated gaps. Two reachable non-fixpoints:
  //
  //  - GAIN (documented): Latin anchor material in
  //    gap.latin promotes to fresh anchors on any
  //    Latin edit (oracle 4b's domain), inserting
  //    anchors ahead of the edit window.
  //  - LOSS — the degenerate-adjacency mint, FIXED
  //    (pinned in edit-corpus.test.ts): two
  //    adjacent anchors whose EDITED-side runs
  //    fuse. mergeLatinBlock USED to mint that
  //    shape, being default-free by design, so a
  //    Latin edit that promoted gap.latin anchor
  //    material next to an existing marked verbatim
  //    anchor gave the new anchor gap.sp "" from
  //    the creation default, and the very next SP
  //    edit fused the pair: an anchor died and
  //    ownership death took its owned gap.latin
  //    with it, arbitrarily far from where the user
  //    typed. The SP analogue of the separation
  //    default now exists on the Latin merge path —
  //    applyMarkedVerbatimSpDefault, scoped to
  //    ADJACENCY-level freshness — so a FRESH
  //    degenerate adjacency gets " " instead of "".
  //    The precondition stays because the gate is
  //    about parse fixpoints in general, not only
  //    about that one shape.
  //
  // The precondition is PER SIDE, so a block carrying
  // Latin anchor material still gets full oracle-3
  // coverage on its SP edits.
  // A SECOND PRECONDITION USED TO SIT HERE and is
  // RETIRED. It closed the gate on any block
  // holding TWO punctuation-only anchors with the
  // SAME text: the raw parse returns both
  // occurrences to gap.latin, so which stored
  // anchor each one belongs to was decided by the
  // rendered-text ALIGNMENT, and identical texts
  // gave the alignment nothing to tell them apart —
  // the duplicate-word alignment bug's shape. That
  // bug is FIXED (occurrence-aware secondary keying
  // on flanking-gap content; the defect was the LCS
  // alignment key in merge.ts, NOT absorbInto
  // guessing an occurrence).
  //
  // RETIREMENT, on measurement rather than on the
  // fix alone. With the conjunct disabled: both
  // families green at the committed seed and the
  // extra seeds; the only thing it still suppressed
  // was the seed-1 whitespace-verbatim split-half
  // errors — an already-registered measured limit
  // recorded in the SEED SCOPE header — at the cost
  // of hundreds of live oracle-3 checks per sweep.
  // Buying suppression of one registered carve-out
  // at one off-seed for that many live assertions
  // is a bad trade once the defect behind it is
  // gone, so the gate is back to its one real
  // precondition: the parse fixpoint.
  //
  // The ratio floors asserted in the corpus law are
  // what keep the gate from quietly narrowing
  // again.
  const o3Gate =
    !applied.structural &&
    parseFixpoint(before.blocks[applied.blockLo]);
  if (!applied.structural) {
    if (o3Gate) corpusStats.oracle3Open += 1;
    else corpusStats.oracle3Closed += 1;
  }
  if (o3Gate) {
    const b0 = before.blocks[applied.blockLo];
    const b1 = after.blocks[applied.blockLo];
    const map =
      applied.op.side === "sp"
        ? renderSp(b0).map
        : renderLatin(b0).map;
    let loOrd = Infinity;
    let hiOrd = -Infinity;
    for (const e of map) {
      if (
        e.to < applied.from - 1 ||
        e.from > applied.to + 1
      ) {
        continue;
      }
      if (e.ref.seg === "marker") {
        // A structural span's MARKER CHAR is in the
        // edit range: deleting it DISSOLVES the span,
        // and a dissolved span reshapes its whole
        // extent — its covered anchors re-align, and
        // ownership death retires the owned gap of
        // every
        // anchor the re-alignment re-creates. The
        // blast radius is therefore the span, not the
        // marker, so the window covers both of its
        // exterior gaps and everything between.
        const sp = b0.spans[e.ref.span];
        if (sp === undefined) continue;
        loOrd = Math.min(loOrd, 2 * sp.from);
        hiOrd = Math.max(hiOrd, 2 * (sp.to + 1));
        continue;
      }
      const ord =
        e.ref.seg === "gap"
          ? 2 * e.ref.index
          : 2 * e.ref.index + 1;
      loOrd = Math.min(loOrd, ord);
      hiOrd = Math.max(hiOrd, ord);
    }
    if (loOrd !== Infinity) {
      const other = (g: {
        sp: string;
        latin: string;
      }): string =>
        applied.op.side === "sp"
          ? g.latin
          : g.sp;
      const loGap = Math.max(
        0,
        Math.floor(loOrd / 2) - 1
      );
      const hiGap = Math.ceil(hiOrd / 2) + 1;
      // CONSERVATION, not positional identity. The
      // plan's positional form compares gap g of the
      // before block against gap g of the after block
      // (counted from whichever end is nearer), which
      // presumes the merge kills the anchors the USER
      // deleted. It does not have to: several anchors
      // can render identically (arbRepetitive is the
      // corpus for exactly that), and the LCS is then
      // free to call any of them the casualty — a
      // deletion of the FIRST of three identical
      // glyphs is observed to retire the THIRD anchor
      // and its owned gap instead, shifting every
      // gap.latin by one WITHOUT losing a byte. Stating
      // the oracle over CONTENT is also the only
      // licensed statement: the model has no
      // latin-misplacement invariant, so this
      // oracle owns DESTRUCTION, not placement.
      // Order is still enforced (subsequence, not
      // multiset). JOINERS excluded for spCore's
      // reason 2: on a LATIN edit the other side is
      // SP, and cleanupJoiners drops an unflanked
      // joiner from any gap the merge disturbed.
      const strip = (t: string): string =>
        applied.op.side === "sp"
          ? t
          : [...t]
              .filter((c) => !JOINER_CHARS.has(c))
              .join("");
      const outside = strip(
        b0.gaps
          .slice(0, loGap)
          .map(other)
          .join("") +
          b0.gaps
            .slice(hiGap + 1)
            .map(other)
            .join("")
      );
      const survives = strip(
        b1.gaps.map(other).join("")
      );
      if (!isSubsequence(outside, survives)) {
        errs.push(
          "oracle3 other-side bytes outside the " +
            "edit window were DESTROYED"
        );
      }
    }
  }
  // 4. no-op round trips on the resulting state.
  //
  // The LATIN branch is stated in two domains, and
  // neither is weaker than the other (this is a
  // domain split, NOT a relaxation):
  //
  // 4a IDENTITY — blocks whose Latin projection
  //    RE-PARSES TO THE SAME ANCHOR BACKBONE. This is
  //    the domain of arbitraries' exclusion 1 and of
  //    every existing latin no-op law, and identity is
  //    required there in full: gaps, spans, marker
  //    offsets and facets included, not just anchors.
  // 4b THE PARSE SETTLES — blocks whose Latin parse
  //    returns a DIFFERENT backbone, so no merge can
  //    make the no-op an identity. Two ways in, both
  //    minted on purpose by this corpus: gap.latin
  //    holds anchor material (the
  //    block-leading-latin shape, the letter-ish
  //    shape) and the Latin side legitimately GAINS
  //    an anchor (pinned at properties.test.ts
  //    "letters in gap.latin are anchor material";
  //    doc-merge's letterish note says the same);
  //    or a fusing adjacency LOSES one (the
  //    fusion-guard fixpoint class). The domain
  //    test is deliberately the PARSE, not the shipped
  //    guard predicates — those have blind spots (see
  //    diagnoseSpLoss) and would put their own bugs in
  //    4a where the oracle would report them as bare
  //    non-identity instead of as the SP destruction
  //    they are. What must hold in 4b is that the
  //    parse happens ONCE and then settles — a second
  //    no-op IS identity — and that it costs no SP
  //    bytes. A ratcheting or SP-destroying parse is a
  //    real finding and fires here.
  after.blocks.forEach((b, i) => {
    const latinRt = (x: Block): Block =>
      mergeLatinBlock(
        x,
        parseLatin(renderLatin(x).inlines)
      );
    const lrt = latinRt(b);
    const parsedAnchors = parseLatin(
      renderLatin(b).inlines
    ).anchors;
    const rawStable =
      stable(parsedAnchors) === stable(b.anchors);
    const backboneStable =
      rawStable ||
      letterBackbone(parsedAnchors) ===
        letterBackbone(b.anchors);
    if (!backboneStable) corpusStats.oracle4b += 1;
    else if (rawStable) corpusStats.oracle4a += 1;
    else corpusStats.oracle4aPrime += 1;
    /** 4b's treatment: SETTLE + SP conservation. Also
     *  used as 4a's FALLBACK, so a block whose
     *  punctuation ambiguity defeats placement-neutral
     *  identity still faces the strongest clauses
     *  rather than being waved through. */
    const settleAndConserve = (): void => {
      // SETTLE (full strength, never relaxed): repeated
      // Latin no-ops must reach a FIXPOINT. Bounded at
      // 4 iterations rather than 1 because a single
      // no-op can legitimately take more than one step
      // to converge — a promotion mints an anchor, the
      // next pass re-homes the gap content it displaced,
      // and a third settles it (observed converging at
      // step 3). What must never happen is a document
      // that keeps changing under a key the user is not
      // pressing, and that is exactly what fires here.
      let cur = lrt;
      let settled = false;
      for (let k = 0; k < 4; k++) {
        const nxt = latinRt(cur);
        if (stable(nxt) === stable(cur)) {
          settled = true;
          break;
        }
        cur = nxt;
      }
      if (!settled) {
        errs.push(
          `oracle4b block ${i}: repeated Latin ` +
            `no-ops never reach a fixpoint`
        );
      }
      // SP CONSERVATION under promotion: the
      // promotion may ADD SP content (the promoted
      // anchors render), but it may never destroy
      // any — so the prior SP text must survive as a
      // SUBSEQUENCE of the new one.
      if (!isSubsequence(spCore(b), spCore(lrt))) {
        for (const e of diagnoseSpLoss(b)) {
          errs.push(`oracle4b block ${i}: ${e}`);
        }
      }
    };
    if (!backboneStable) {
      settleAndConserve();
    } else if (rawStable) {
      if (stable(lrt) !== stable(b)) {
        errs.push(
          `oracle4a block ${i}: latin no-op not ` +
            `identity`
        );
      }
    } else if (
      latinNeutral(lrt) !== latinNeutral(b)
    ) {
      // 4a' — the LETTER backbone is stable but the
      // block holds a PUNCTUATION-ONLY anchor, whose
      // text the raw parse always returns to gap.latin
      // and re-absorption always restores. When the
      // SAME punctuation also sits in a gap ("-" as an
      // anchor next to gap.latin " - "), the rendered
      // text carries no evidence about which occurrence
      // is the anchor's — the arbitraries avoid the
      // collision by construction ("digits,
      // apostrophes, '!' and '?' are reserved for
      // verbatim texts so re-absorption occurrences
      // stay position-unambiguous"), this corpus mints
      // it on purpose, and the model has no
      // latin-misplacement invariant to appeal to.
      // So identity is asserted MODULO gap.latin
      // PLACEMENT: anchors, spans and every gap.sp must
      // be untouched, and the latin bytes must all
      // still be there in order. Only where they sit
      // may move.
      // A 4a' failure used to FALL THROUGH to 4b's
      // weaker treatment, on the grounds that
      // duplicate punctuation made identity
      // unpromisable. That escape is REMOVED: it
      // measured 0 hits on either family at the
      // committed seed, and a live hatch is a
      // standing excuse for whatever lands in it
      // next. It reports now. (What it turned out
      // to be swallowing was not an alignment-bug
      // recurrence but the atom-interior gap.latin
      // re-homing described in the header — a
      // one-step, SP-lossless canonicalization.
      // Making it visible is the point of removing
      // the hatch.)
      errs.push(
        `oracle4a' block ${i}: latin no-op changed ` +
          `more than gap.latin placement`
      );
    }
    const srt = mergeSpBlock(
      b,
      parseSp(renderSp(b).inlines)
    );
    if (
      vsCanon(stable(renderSp(srt).inlines)) !==
      vsCanon(stable(renderSp(b).inlines))
    ) {
      errs.push(
        `oracle4 block ${i}: sp no-op not ` +
          `sp-byte identity`
      );
    }
  });
  // 5. offsets never dropped except by a split
  // (the marker-drop rule): a same-kind span
  // surviving in an
  // untouched-or-edited block may lose an offset
  // only on a structural op
  if (!applied.structural) {
    const b0 = before.blocks[applied.blockLo];
    const b1 = after.blocks[applied.blockLo];
    for (const s0 of b0.spans) {
      if (
        s0.startOffset === undefined &&
        s0.endOffset === undefined
      ) {
        continue;
      }
      // Identify the survivor by the ANCHORS IT
      // COVERS, not by index overlap. Indices shift
      // whenever the edit inserts or removes an anchor,
      // and index overlap then picks whichever
      // same-kind span happens to sit at the old
      // numbers — observed selecting a neighbouring
      // cartouche that never had an offset while the
      // real survivor kept its own, reporting a drop
      // that did not happen.
      const key = stable(
        b0.anchors.slice(s0.from, s0.to + 1)
      );
      const s1 = b1.spans.find(
        (s) =>
          s.kind === s0.kind &&
          stable(
            b1.anchors.slice(s.from, s.to + 1)
          ) === key
      );
      if (!s1) continue; // span died: no offset
      if (
        s0.startOffset !== undefined &&
        s1.startOffset === undefined &&
        s1.from === s0.from &&
        applied.from > 0
      ) {
        // offset became edge-adjacent: legal only
        // if the edit could reach its gap; flag
        // only when the edit window excluded it.
        // ALL entries for that gap, not the first:
        // a marker offset SPLITS its gap into two
        // source-map entries (text before the marker
        // char, text after), and the edit can land in
        // either. Taking only the first reports a
        // legitimate edit just past the marker as an
        // out-of-window drop.
        const ws = renderSp(b0).map.filter(
          (e) =>
            e.ref.seg === "gap" &&
            e.ref.index === s0.from
        );
        const reachable = ws.some(
          (w) =>
            w.to >= applied.from - 1 &&
            w.from <= applied.to + 1
        );
        if (
          ws.length > 0 &&
          !reachable &&
          applied.op.side === "sp"
        ) {
          errs.push(
            `oracle5 span offset dropped ` +
              `outside the edit window`
          );
        }
      }
    }
  }
  return errs;
}

// ---------- oracle-6 canonicalization ----------

export type CanonSeg =
  | { kind: "text"; text: string }
  | { kind: "break" }
  | {
      kind: "name";
      anchors: Anchor[];
      interiorLatin: string[];
      text: string;
    };

/** THE pinned oracle-6 normalization:
 *  renderLatin coalesces adjacent text
 *  inlines and carries "\n" INSIDE text, while the
 *  Latin PM doc splits at hardBreak/atom
 *  boundaries. Both sides normalize to this
 *  canonical segment list: text split at "\n"
 *  (each "\n" becomes a break), empty texts
 *  dropped, adjacent texts merged. */
export function canonicalSegments(
  inlines: LatinInline[]
): CanonSeg[] {
  const out: CanonSeg[] = [];
  const pushText = (t: string): void => {
    if (t.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") {
      last.text += t;
    } else {
      out.push({ kind: "text", text: t });
    }
  };
  for (const inline of inlines) {
    if (inline.type === "name") {
      out.push({
        kind: "name",
        anchors: inline.anchors,
        interiorLatin: inline.interiorLatin,
        text: inline.text,
      });
      continue;
    }
    const parts = inline.text.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) out.push({ kind: "break" });
      pushText(p);
    });
  }
  return out;
}
