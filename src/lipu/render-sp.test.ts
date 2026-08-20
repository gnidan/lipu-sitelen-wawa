import { describe, it, expect } from "vitest";
import { renderSp, anchorSpText } from "./render-sp";
import {
  CARTOUCHE_START,
  CARTOUCHE_END,
  CART_EXT,
  LONG_START,
  LONG_END,
  MIDDLE_DOT_CH,
  IDEO_SPACE,
  STACK,
} from "./chars";
import type { Block } from "./types";
import {
  niDirectionByIndex,
  niDirStringEffective,
} from "../data";
import { glyph, gap, cart, span } from
  "../../test/helpers";

function spText(
  r: ReturnType<typeof renderSp>
): string {
  return r.text;
}

describe("renderSp — concatenation", () => {
  it("renders words with literal gap chars, no " +
     "synthesis", () => {
    const block: Block = {
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "word", word: "pona" },
        { kind: "word", word: "mute" },
      ],
      gaps: [
        gap(), gap(" "), gap(IDEO_SPACE), gap(),
      ],
      spans: [],
    };
    expect(spText(renderSp(block))).toBe(
      glyph("toki") + " " + glyph("pona") +
        IDEO_SPACE + glyph("mute")
    );
  });

  it("adjacent words render fused (SP spacing " +
     "convention: gaps are deliberate)", () => {
    const block: Block = {
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "word", word: "pona" },
      ],
      gaps: [gap(), gap(), gap()],
      spans: [],
    };
    expect(spText(renderSp(block))).toBe(
      glyph("toki") + glyph("pona")
    );
  });

  it("renders joiners literally from gap.sp", () => {
    const block: Block = {
      anchors: [
        { kind: "word", word: "pona" },
        { kind: "word", word: "mute" },
      ],
      gaps: [gap(), gap(STACK), gap()],
      spans: [],
    };
    expect(spText(renderSp(block))).toBe(
      glyph("pona") + STACK + glyph("mute")
    );
  });

  it("renders ni direction as ni + arrow", () => {
    const block: Block = {
      anchors: [
        { kind: "word", word: "ni",
          niDirection: 6 },
      ],
      gaps: [gap(), gap()],
      spans: [],
    };
    const dir = niDirectionByIndex(6)!;
    expect(spText(renderSp(block))).toBe(
      niDirStringEffective(dir)
    );
  });

  it("gap.sp \\n becomes a break inline counting " +
     "one position", () => {
    const block: Block = {
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "word", word: "pona" },
      ],
      gaps: [gap(), gap("\n", "\n"), gap()],
      spans: [],
    };
    const r = renderSp(block);
    expect(r.inlines[1]).toEqual({ type: "break" });
    expect(r.text).toBe(
      glyph("toki") + "\n" + glyph("pona")
    );
    // gap entry spans the break position
    const g = r.map.find(
      (e) =>
        e.ref.seg === "gap" && e.ref.index === 1
    )!;
    expect(g).toMatchObject({ from: 2, to: 3 });
  });

  it("marked verbatim renders as a verbatim " +
     "inline; unmarked as plain text", () => {
    const block: Block = {
      anchors: [
        { kind: "verbatim", text: "hi there",
          marked: true },
        { kind: "verbatim", text: "cd" },
      ],
      gaps: [gap(), gap(IDEO_SPACE), gap()],
      spans: [],
    };
    const r = renderSp(block);
    expect(r.inlines).toEqual([
      { type: "text", text: "hi there",
        verbatim: true },
      { type: "text", text: IDEO_SPACE + "cd",
        verbatim: false },
    ]);
  });
});

describe("renderSp — spans and facets", () => {
  it("emits cartouche markers around the covered " +
     "range with naming chars from the facet", () => {
    const block: Block = {
      anchors: [
        { kind: "word", word: "nena",
          nameScheme: { style: "morae",
            count: 2 } },
        { kind: "word", word: "kili" },
      ],
      gaps: [gap(), gap(CART_EXT), gap()],
      spans: [
        cart(0, 1),
      ],
    };
    expect(spText(renderSp(block))).toBe(
      CARTOUCHE_START + glyph("nena") +
        MIDDLE_DOT_CH + MIDDLE_DOT_CH + CART_EXT +
        glyph("kili") + CARTOUCHE_END
    );
  });

  it("nests spans properly: outer starts first, " +
     "inner ends first", () => {
    const block: Block = {
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "word", word: "pona" },
      ],
      gaps: [gap(), gap(), gap()],
      spans: [
        cart(0, 1),
        span("long", 1, 1),
      ],
    };
    expect(spText(renderSp(block))).toBe(
      CARTOUCHE_START + glyph("toki") +
        LONG_START + glyph("pona") + LONG_END +
        CARTOUCHE_END
    );
  });

  it("renders transitional (unmatched) marker " +
     "chars literally from gap.sp", () => {
    const block: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [gap(CARTOUCHE_START), gap()],
      spans: [],
    };
    expect(spText(renderSp(block))).toBe(
      CARTOUCHE_START + glyph("toki")
    );
  });

  // MARKER OFFSETS: a span's start/end marker
  // renders at its recorded offset inside the gap,
  // not at the gap edge — pinned directly here, and
  // covered more broadly by a byte-conservation
  // property test over arbitrary input elsewhere in
  // this library's test suite.
  it("emits a marker at its recorded offset inside " +
     "the gap, not at the gap edge", () => {
    const block: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [gap(" "), gap(CART_EXT + " ")],
      spans: [
        {
          from: 0,
          to: 0,
          kind: "cartouche",
          side: "both",
          // "[" sat BEFORE the space...
          startOffset: 0,
          // ...and "]" AFTER the cart-ext (2 UTF-16
          // units), before the trailing space
          endOffset: CART_EXT.length,
        },
      ],
    };
    expect(spText(renderSp(block))).toBe(
      CARTOUCHE_START +
        " " +
        glyph("toki") +
        CART_EXT +
        CARTOUCHE_END +
        " "
    );
  });

  it("orders several markers in one gap by offset " +
     "(ends before starts at a shared offset)", () => {
    const block: Block = {
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "word", word: "pona" },
      ],
      gaps: [gap(), gap(" " + CART_EXT), gap()],
      spans: [
        {
          from: 0,
          to: 0,
          kind: "cartouche",
          side: "both",
          // closes after the space, before cart-ext
          endOffset: 1,
        },
        {
          from: 1,
          to: 1,
          kind: "long",
          side: "both",
          // opens at the same place the "]" closed
          startOffset: 1,
        },
      ],
    };
    expect(spText(renderSp(block))).toBe(
      CARTOUCHE_START +
        glyph("toki") +
        " " +
        CARTOUCHE_END +
        LONG_START +
        CART_EXT +
        glyph("pona") +
        LONG_END
    );
  });

  it("formatting spans emit nothing in SP", () => {
    const block: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [gap(), gap()],
      spans: [
        span("bold", 0, 0),
      ],
    };
    expect(spText(renderSp(block)))
      .toBe(glyph("toki"));
  });

  it("zero-anchor blocks render their gap " +
     "content", () => {
    const block: Block = {
      anchors: [],
      gaps: [gap(" \n ")],
      spans: [],
    };
    expect(spText(renderSp(block))).toBe(" \n ");
  });
});

describe("renderSp — source map", () => {
  it("emits alternating gap/anchor entries; " +
     "both-sides-empty gaps get no entry", () => {
    const block: Block = {
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "word", word: "pona" },
      ],
      gaps: [gap(), gap(" ", ","), gap("", "!")],
      spans: [],
    };
    const r = renderSp(block);
    expect(r.map).toEqual([
      { ref: { seg: "anchor", index: 0 },
        from: 0, to: 2 },
      { ref: { seg: "gap", index: 1 },
        from: 2, to: 3 },
      { ref: { seg: "anchor", index: 1 },
        from: 3, to: 5 },
      // side-absent content: zero-width entry
      { ref: { seg: "gap", index: 2 },
        from: 5, to: 5 },
    ]);
  });

  it("marker entries carry span index and end", () => {
    const block: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [gap(), gap()],
      spans: [
        cart(0, 0),
      ],
    };
    const r = renderSp(block);
    expect(r.map).toEqual([
      { ref: { seg: "marker", span: 0,
               end: "start" }, from: 0, to: 2 },
      { ref: { seg: "anchor", index: 0 },
        from: 2, to: 4 },
      { ref: { seg: "marker", span: 0,
               end: "end" }, from: 4, to: 6 },
    ]);
  });
});

describe("anchorSpText", () => {
  it("is the anchor's exact SP byte string", () => {
    expect(
      anchorSpText({ kind: "word", word: "toki" })
    ).toBe(glyph("toki"));
    expect(
      anchorSpText({
        kind: "verbatim", text: "a b",
      })
    ).toBe("a b");
  });
});
