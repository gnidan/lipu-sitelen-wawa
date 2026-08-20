/**
 * lipu v2 core types: anchors, gaps, spans.
 *
 * A Block is a backbone of nimi ANCHORS; the
 * intervals between them (GAPS) hold each side's
 * literal content independently; scoped structure
 * (cartouches, long glyphs, formatting) is SPANS
 * over inclusive anchor ranges. Gap ownership:
 * gaps[i + 1] is owned by anchors[i]; gaps[0] by
 * the Block.
 */

export type Side = "sp" | "latin";

export type NameScheme =
  | { style: "letters" | "morae"; count: number }
  | { style: "word" };

export interface Anchor {
  kind: "word" | "verbatim";
  /** kind "word": canonical lowercase */
  word?: string;
  /** kind "verbatim" */
  text?: string;
  /** verbatim SP mark; never store false */
  marked?: boolean;
  // SP facets
  variation?: number;
  niDirection?: number; // NI_DIRECTIONS index 1-8
  nameScheme?: NameScheme;
  // Latin facets
  case?: "capital";
}

export interface Gap {
  sp: string;
  latin: string;
  /** PROVENANCE: absent = still default; never
   *  store false (mirrors the `marked` convention).
   *  Additive — stored payloads round-trip it, and
   *  a build that doesn't know about it yet strips
   *  it via mkGap on re-merge without corrupting
   *  anything (degrades safely). */
  spAuthored?: true;
  latinAuthored?: true;
}

export type StructuralKind =
  | "cartouche"
  | "long"
  | "rev-long";
export type FormattingKind = "bold" | "italic";
export type SpanKind =
  | StructuralKind
  | FormattingKind;

export interface SpanAttrs {
  /** cartouche only: always-spelled-out override;
   *  the span's ONLY attr */
  latinSpelling?: string;
}

export interface Span {
  from: number; // anchor index, inclusive
  to: number;   // anchor index, inclusive
  kind: SpanKind;
  side: Side | "both";
  attrs?: SpanAttrs;
  /** MARKER OFFSETS: promotion and demotion are
   *  byte-preserving for every marker position.
   *  STRUCTURAL spans only.
   *
   *  startOffset: index within gaps[from].sp where
   *  the START marker sits; chars before it are
   *  OUTSIDE the span, chars after it interior.
   *  ABSENT means edge-adjacent — gaps[from].sp
   *  .length — so every offset-free Block (content
   *  with no interior marker, every generator,
   *  every hand-written fixture) keeps rendering
   *  exactly as written. Edge-adjacent offsets are
   *  therefore NOT stored: promotion omits them,
   *  which keeps the normal form canonical. */
  startOffset?: number;
  /** ...and index within gaps[to + 1].sp where the
   *  END marker sits; chars before it are interior,
   *  chars after it outside. ABSENT means 0. */
  endOffset?: number;
}

export interface Block {
  anchors: Anchor[];
  /** length === anchors.length + 1, always */
  gaps: Gap[];
  spans: Span[];
}

export interface Lipu {
  version: 2;
  blocks: Block[];
}

/** One side's parse output: anchors plus that
 *  side's gap strings (other side unknown to the
 *  parse; the merge fills it per ownership). */
export interface ParsedSide {
  anchors: Anchor[];
  /** length === anchors.length + 1 */
  gaps: string[];
}

/** Source-map segment reference: alternating gap/
 *  anchor segments per side; structural span
 *  marker chars get their own entries. */
export type SegRef =
  | { seg: "gap"; index: number }
  | { seg: "anchor"; index: number }
  | { seg: "marker"; span: number;
      end: "start" | "end" };

/** Positions are UTF-16 code units (JS string
 *  .length); UCSUR glyphs are surrogate pairs (2
 *  units); name atoms count as 1 position. */
export interface SourceEntry {
  ref: SegRef;
  from: number;
  to: number;
}

/** SP projection inline shapes (same shape the
 *  app's editor extension already expects, so
 *  wiring the editor onto this model is drop-in).
 *  gap.sp "\n" is
 *  the ENCODING of a hardBreak: render emits break
 *  inlines, parse folds them back to "\n". */
export type SpInline =
  | { type: "text"; text: string; verbatim: boolean }
  | { type: "break" };

/** Latin projection inlines. A name atom is opaque
 *  to the Latin side: it carries its covered
 *  anchors and interior latin gap strings through
 *  the parse untouched. */
export type LatinInline =
  | { type: "text"; text: string }
  | { type: "name";
      anchors: Anchor[];
      interiorLatin: string[];
      text: string };

export function isStructural(
  kind: SpanKind
): kind is StructuralKind {
  return (
    kind === "cartouche" ||
    kind === "long" ||
    kind === "rev-long"
  );
}

export function emptyBlock(): Block {
  return {
    anchors: [],
    gaps: [{ sp: "", latin: "" }],
    spans: [],
  };
}

/** Is `i` a CODEPOINT BOUNDARY of `s`? gap.sp is
 *  full of surrogate PAIRS (every UCSUR control char
 *  and glyph is one), so a marker offset landing
 *  between the two units of a pair would make
 *  renderSp emit lone surrogates. checkBlock rejects
 *  such offsets and normalize's clampSpanOffsets
 *  snaps to a boundary. */
export function isCodepointBoundary(
  s: string,
  i: number
): boolean {
  if (i <= 0 || i >= s.length) return true;
  const hi = s.charCodeAt(i - 1);
  const lo = s.charCodeAt(i);
  return !(
    hi >= 0xd800 &&
    hi <= 0xdbff &&
    lo >= 0xdc00 &&
    lo <= 0xdfff
  );
}

/** Canonical span order (normal form): structural
 *  before formatting, then from asc, to desc,
 *  original index (stable).
 *
 *  NOTE: there is deliberately NO kind tie-break.
 *  For two structural spans over the SAME anchor
 *  range, array order is not a tie to be broken —
 *  it IS the nesting the user typed ("([toki])" vs
 *  "[(toki)]" differ only in it, since both markers
 *  of each pair sit at the same gap offset).
 *  Promotion appends pairs outermost-first, renderSp
 *  opens in array order and closes in reverse, so
 *  keeping the order is what conserves those bytes.
 *  Sorting by kind instead would rewrite
 *  "([toki])" into "[(toki)]". */
export function sortSpans(spans: Span[]): Span[] {
  return spans
    .map((s, i) => [s, i] as const)
    .sort(([a, ai], [b, bi]) => {
      const sa = isStructural(a.kind) ? 0 : 1;
      const sb = isStructural(b.kind) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (a.from !== b.from) return a.from - b.from;
      if (a.to !== b.to) return b.to - a.to;
      return ai - bi;
    })
    .map(([s]) => s);
}

/** Structural invariant violations (empty = ok).
 *  Property tests assert this on generator output
 *  and on every merge result. */
export function checkBlock(block: Block): string[] {
  const errs: string[] = [];
  const n = block.anchors.length;
  if (block.gaps.length !== n + 1) {
    errs.push(
      `gaps.length ${block.gaps.length} !== ` +
        `anchors.length + 1 (${n + 1})`
    );
  }
  block.anchors.forEach((a, i) => {
    if (a.kind === "word" && !a.word) {
      errs.push(`anchor ${i}: word without word`);
    }
    // EMPTY text is rejected, not just missing
    // text (mirroring the empty-word rule above).
    // An anchor that renders NOTHING is invisible
    // to both projections, so no merge alignment
    // can see it: it is dropped on a pure no-op
    // and the gap it owns is destroyed with it,
    // violating the Latin no-op SP-identity law.
    // Neither parser can mint one, so this is a
    // structural exclusion rather than a repair —
    // any import path must normalize such anchors
    // away.
    if (a.kind === "verbatim" && !a.text) {
      errs.push(
        `anchor ${i}: verbatim without text`
      );
    }
    if (a.marked === false) {
      errs.push(
        `anchor ${i}: marked: false stored`
      );
    }
  });
  for (const s of block.spans) {
    if (
      s.from < 0 ||
      s.to >= n ||
      s.from > s.to
    ) {
      errs.push(
        `span ${JSON.stringify(s)}: bad range`
      );
    } else {
      // MARKER OFFSETS are gap-string positions, so
      // they are bounded by the gap they index. Only
      // structural spans render markers at all; an
      // offset on a formatting span indexes nothing.
      const bound = (
        off: number | undefined,
        gapIndex: number,
        name: string,
        edge: (len: number) => number
      ): void => {
        if (off === undefined) return;
        if (!isStructural(s.kind)) {
          errs.push(
            `span ${JSON.stringify(s)}: ` +
              `${name} on non-structural span`
          );
          return;
        }
        const sp = block.gaps[gapIndex]?.sp;
        if (sp === undefined) {
          errs.push(
            `span ${JSON.stringify(s)}: ` +
              `${name} out of range for gap ` +
              `${gapIndex}`
          );
          return;
        }
        if (
          !Number.isInteger(off) ||
          off < 0 ||
          off > sp.length
        ) {
          errs.push(
            `span ${JSON.stringify(s)}: ` +
              `${name} out of range for gap ` +
              `${gapIndex}`
          );
          return;
        }
        // CODEPOINT BOUNDARY: gap.sp is full of
        // surrogate PAIRS, and an offset inside one
        // would make renderSp emit lone surrogates.
        if (!isCodepointBoundary(sp, off)) {
          errs.push(
            `span ${JSON.stringify(s)}: ` +
              `${name} splits a codepoint in gap ` +
              `${gapIndex}`
          );
          return;
        }
        // CANONICAL FORM: absent MEANS edge-adjacent,
        // so an offset stored ON its edge is a second
        // spelling of the same thing. Promotion omits
        // it and clampSpanOffsets drops it, keeping
        // storage canonical -- this validation is what
        // makes that omission enforceable.
        if (off === edge(sp.length)) {
          errs.push(
            `span ${JSON.stringify(s)}: ` +
              `${name} stored at its edge ` +
              `(canonical form is absent)`
          );
        }
      };
      bound(
        s.startOffset,
        s.from,
        "startOffset",
        (len) => len
      );
      bound(s.endOffset, s.to + 1, "endOffset",
        () => 0);
    }
    if (
      s.attrs?.latinSpelling !== undefined &&
      s.kind !== "cartouche"
    ) {
      errs.push(
        `span ${JSON.stringify(s)}: ` +
          `latinSpelling on non-cartouche`
      );
    }
  }
  const structural = block.spans.filter((s) =>
    isStructural(s.kind)
  );
  for (const a of structural) {
    for (const b of structural) {
      if (a === b) continue;
      if (
        a.from < b.from &&
        b.from <= a.to &&
        a.to < b.to
      ) {
        errs.push(
          "structural spans cross: " +
            JSON.stringify([a, b])
        );
      }
    }
  }
  return errs;
}
