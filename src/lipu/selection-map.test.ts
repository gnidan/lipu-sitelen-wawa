import { describe, expect, it } from "vitest";
import { mirrorRange } from "./selection-map";
import type { BlockMaps } from "./selection-map";
import { renderSp } from "./render-sp";
import { renderLatin } from "./render-latin";
import type { Block, SourceEntry } from "./types";

function maps(block: Block): BlockMaps {
  return {
    sp: renderSp(block).map,
    latin: renderLatin(block).map,
    spans: block.spans,
  };
}

function anchorRange(
  map: SourceEntry[],
  index: number
): { from: number; to: number } {
  const e = map.find(
    (x) =>
      x.ref.seg === "anchor" &&
      x.ref.index === index
  );
  if (!e) throw new Error("no anchor entry");
  return { from: e.from, to: e.to };
}

const simple: Block = {
  anchors: [
    { kind: "word", word: "toki" },
    { kind: "word", word: "pona" },
  ],
  gaps: [
    { sp: "", latin: "" },
    { sp: " ", latin: ", " },
    { sp: "", latin: "" },
  ],
  spans: [],
};

describe("mirrorRange", () => {
  it("sp anchor selection maps to the latin " +
     "anchor range", () => {
    const m = maps(simple);
    const spA = anchorRange(m.sp, 0);
    const out = mirrorRange(
      [m],
      "sp",
      { block: 0, offset: spA.from },
      { block: 0, offset: spA.to }
    );
    const latinA = anchorRange(m.latin, 0);
    expect(out.inline).toEqual([
      {
        block: 0,
        from: latinA.from,
        to: latinA.to,
      },
    ]);
    expect(out.wholeBlocks).toEqual([]);
  });

  it("a latin selection spanning the gap expands " +
     "to cover both sp anchors and the sp gap", () => {
    const m = maps(simple);
    const a0 = anchorRange(m.latin, 0);
    const a1 = anchorRange(m.latin, 1);
    const out = mirrorRange(
      [m],
      "latin",
      { block: 0, offset: a0.to - 1 },
      { block: 0, offset: a1.from + 1 }
    );
    const s0 = anchorRange(m.sp, 0);
    const s1 = anchorRange(m.sp, 1);
    expect(out.inline).toEqual([
      { block: 0, from: s0.from, to: s1.to },
    ]);
  });

  it("cartouche markers ride their anchors: " +
     "selecting the covered anchor on the latin " +
     "side (the name atom) covers marker chars on " +
     "the sp side", () => {
    const cart: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [
        {
          from: 0,
          to: 0,
          kind: "cartouche",
          side: "both",
        },
      ],
    };
    const m = maps(cart);
    // the name atom is 1 position wide
    const atom = anchorRange(m.latin, 0);
    expect(atom.to - atom.from).toBe(1);
    const out = mirrorRange(
      [m],
      "latin",
      { block: 0, offset: atom.from },
      { block: 0, offset: atom.to }
    );
    // full sp width: start marker + glyph + end
    // marker = everything renderSp emitted
    const spText = renderSp(cart).text;
    expect(out.inline).toEqual([
      { block: 0, from: 0, to: spText.length },
    ]);
  });

  it("MULTI-ANCHOR cartouche: selecting the atom " +
     "sweeps the full sp range including BOTH " +
     "markers and the interior gap", () => {
    const cart: Block = {
      anchors: [
        { kind: "word", word: "nena" },
        { kind: "word", word: "kili" },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [
        {
          from: 0,
          to: 1,
          kind: "cartouche",
          side: "both",
        },
      ],
    };
    const m = maps(cart);
    // the name atom is 1 position wide and covers
    // BOTH anchors
    const atom = anchorRange(m.latin, 0);
    expect(atom.to - atom.from).toBe(1);
    expect(anchorRange(m.latin, 1)).toEqual(atom);
    const out = mirrorRange(
      [m],
      "latin",
      { block: 0, offset: atom.from },
      { block: 0, offset: atom.to }
    );
    // full sp width: start marker + nena glyph +
    // interior gap + kili glyph + end marker —
    // everything renderSp emitted for the block
    const spText = renderSp(cart).text;
    expect(out.inline).toEqual([
      { block: 0, from: 0, to: spText.length },
    ]);
  });

  it("cross-block selections report interior " +
     "whole blocks", () => {
    const m = maps(simple);
    const out = mirrorRange(
      [m, m, m],
      "sp",
      { block: 0, offset: 0 },
      { block: 2, offset: 1 }
    );
    expect(out.wholeBlocks).toEqual([1]);
  });

  it("collapsed and out-of-range selections are " +
     "empty", () => {
    const m = maps(simple);
    expect(
      mirrorRange(
        [m],
        "sp",
        { block: 0, offset: 1 },
        { block: 0, offset: 1 }
      )
    ).toEqual({ inline: [], wholeBlocks: [] });
    expect(
      mirrorRange(
        [m],
        "sp",
        { block: -1, offset: 0 },
        { block: 5, offset: 0 }
      )
    ).toEqual({ inline: [], wholeBlocks: [] });
  });

  it("side-absent content (zero-width target " +
     "entries) yields null inline, not a crash", () => {
    const b: Block = {
      anchors: [],
      gaps: [{ sp: "", latin: "hi " }],
      spans: [],
    };
    const m = maps(b);
    const out = mirrorRange(
      [m],
      "latin",
      { block: 0, offset: 0 },
      { block: 0, offset: 2 }
    );
    expect(out.inline).toEqual([]);
  });
});
