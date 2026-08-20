import { describe, it, expect } from "vitest";
import {
  checkBlock,
  emptyBlock,
  isStructural,
  sortSpans,
} from "./types";
import type { Block, Span } from "./types";
import { CART_EXT } from "./chars";
import { cart, span } from "../../test/helpers";

describe("emptyBlock / checkBlock", () => {
  it("emptyBlock satisfies the invariants", () => {
    expect(checkBlock(emptyBlock())).toEqual([]);
  });

  it("flags a gaps/anchors length mismatch", () => {
    const b: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [{ sp: "", latin: "" }],
      spans: [],
    };
    expect(checkBlock(b).length).toBeGreaterThan(0);
  });

  it("flags a span out of range and a span with " +
     "from > to", () => {
    const b: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [
        cart(0, 1),
        span("bold", 1, 0),
      ],
    };
    expect(checkBlock(b)).toHaveLength(2);
  });

  it("flags crossing structural spans", () => {
    const b: Block = {
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "word", word: "pona" },
        { kind: "word", word: "mute" },
      ],
      gaps: Array.from({ length: 4 }, () => ({
        sp: "", latin: "",
      })),
      spans: [
        cart(0, 1),
        span("long", 1, 2),
      ],
    };
    expect(
      checkBlock(b).some((e) =>
        e.includes("cross")
      )
    ).toBe(true);
  });

  // An anchor rendering NOTHING is invisible to
  // both projections, so no merge alignment can
  // see it: it is dropped on a pure no-op and its
  // owned gap with it. Neither parser mints one;
  // rejecting it here is the structural exclusion
  // that keeps the no-op SP-identity law total.
  it("flags a verbatim anchor with EMPTY text, " +
     "not only a missing one", () => {
    const withEmpty: Block = {
      anchors: [{ kind: "verbatim", text: "" }],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    expect(checkBlock(withEmpty)).toEqual([
      "anchor 0: verbatim without text",
    ]);
    const withMissing: Block = {
      anchors: [{ kind: "verbatim" }],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    expect(checkBlock(withMissing)).toEqual([
      "anchor 0: verbatim without text",
    ]);
    // a one-char verbatim is still fine
    expect(
      checkBlock({
        ...withEmpty,
        anchors: [{ kind: "verbatim", text: "x" }],
      })
    ).toEqual([]);
  });

  it("flags latinSpelling on a non-cartouche " +
     "span and marked: false", () => {
    const b: Block = {
      anchors: [
        { kind: "verbatim", text: "x",
          marked: false as unknown as true },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [
        span("long", 0, 0, { attrs: { latinSpelling: "X" } }),
      ],
    };
    expect(checkBlock(b)).toHaveLength(2);
  });

  // checkBlock bounds marker offsets to the gap
  // string they index.
  it("accepts interior marker offsets", () => {
    const b: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [
        { sp: "ab", latin: "" },
        { sp: "cd", latin: "" },
      ],
      spans: [
        cart(0, 0, { startOffset: 1, endOffset: 1 }),
      ],
    };
    expect(checkBlock(b)).toEqual([]);
  });

  it("flags an offset past its gap, a negative " +
     "one, and an offset on a formatting span", () => {
    const base: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [
        { sp: "ab", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const errs = (s: Span): string[] =>
      checkBlock({ ...base, spans: [s] });
    // gaps[0].sp is 2 long, gaps[1].sp is empty
    expect(
      errs(cart(0, 0, { startOffset: 3 }))
    ).toHaveLength(1);
    expect(
      errs(cart(0, 0, { endOffset: 1 }))
    ).toHaveLength(1);
    expect(
      errs(cart(0, 0, { startOffset: -1 }))
    ).toHaveLength(1);
    expect(
      errs(span("bold", 0, 0, { startOffset: 1 }))
    ).toHaveLength(1);
  });

  // CODEPOINT BOUNDARY: gap.sp is full of surrogate
  // pairs; an offset inside one would make renderSp
  // emit LONE SURROGATES.
  it("flags an offset that splits a surrogate " +
     "pair", () => {
    const b: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [
        { sp: CART_EXT + CART_EXT, latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [
        cart(0, 0, { startOffset: 1 }),
      ],
    };
    expect(checkBlock(b)).toHaveLength(1);
    // ...and the boundary between the two chars is
    // fine (anti-vacuity)
    expect(
      checkBlock({
        ...b,
        spans: [
          { ...b.spans[0],
            startOffset: CART_EXT.length },
        ],
      })
    ).toEqual([]);
  });

  // CANONICAL FORM: absent MEANS edge-adjacent, so
  // an offset stored ON its edge is a second
  // spelling of the same thing. Promotion and
  // clampSpanOffsets never emit one; checkBlock
  // rejects it, keeping storage canonical.
  it("flags an offset stored at its edge (the " +
     "canonical spelling is ABSENT)", () => {
    const base: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [
        { sp: "ab", latin: "" },
        { sp: "cd", latin: "" },
      ],
      spans: [],
    };
    const errs = (s: Span): string[] =>
      checkBlock({ ...base, spans: [s] });
    expect(
      errs(cart(0, 0, { startOffset: 2 }))
    ).toHaveLength(1);
    expect(
      errs(cart(0, 0, { endOffset: 0 }))
    ).toHaveLength(1);
  });
});

describe("sortSpans", () => {
  // NO kind tie-break. Two structural spans over
  // the same range differ only in NESTING,
  // and array order is where that lives (renderSp
  // opens in array order, closes in reverse), so
  // sorting by kind rewrote "([toki])" into
  // "[(toki)]".
  it("keeps same-range structural spans in array " +
     "order (the nesting), whatever their kinds", () => {
    const outerLong: Span[] = [
      span("long", 0, 0),
      cart(0, 0),
    ];
    expect(sortSpans(outerLong)).toEqual(outerLong);
    const outerCart: Span[] = [
      cart(0, 0),
      span("long", 0, 0),
    ];
    expect(sortSpans(outerCart)).toEqual(outerCart);
  });

  it("orders structural first, then from asc, " +
     "to desc", () => {
    const spans: Span[] = [
      span("bold", 1, 1),
      cart(0, 2),
      span("bold", 0, 0),
      cart(0, 1),
    ];
    expect(sortSpans(spans)).toEqual([
      cart(0, 2),
      cart(0, 1),
      span("bold", 0, 0),
      span("bold", 1, 1),
    ]);
  });
});

describe("isStructural", () => {
  it("classifies kinds", () => {
    expect(isStructural("cartouche")).toBe(true);
    expect(isStructural("long")).toBe(true);
    expect(isStructural("rev-long")).toBe(true);
    expect(isStructural("bold")).toBe(false);
    expect(isStructural("italic")).toBe(false);
  });
});
