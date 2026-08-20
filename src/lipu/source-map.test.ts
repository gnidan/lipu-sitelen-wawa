import { describe, it, expect } from "vitest";
import {
  entryRangeAt,
  rangeForEntries,
} from "./source-map";
import { renderSp } from "./render-sp";
import { renderLatin } from "./render-latin";
import type { Block } from "./types";
import { gap, word, cart } from "../../test/helpers";

const spBlock: Block = {
  anchors: [word("toki"), word("pona")],
  gaps: [gap(), gap(" ", ", "), gap("", "!")],
  spans: [
    cart(1, 1),
  ],
};
// SP text offsets (UTF-16 code units; each UCSUR
// glyph is a surrogate pair = 2 units, per the
// standing offset caveat):
// toki-glyph(0-2) " "(2-3) "["-glyph(3-5)
// pona-glyph(5-7) "]"-glyph(7-9); trailing gap
// zero-width at 9 (latin-only "!" content).

describe("entryRangeAt", () => {
  it("finds the entries covering a range", () => {
    const { map } = renderSp(spBlock);
    const r = entryRangeAt(map, 0, 3)!;
    expect(map[r.start].ref).toEqual({
      seg: "anchor",
      index: 0,
    });
    expect(map[r.end].ref).toEqual({
      seg: "gap",
      index: 1,
    });
  });

  it("includes marker entries", () => {
    const { map } = renderSp(spBlock);
    const r = entryRangeAt(map, 3, 5)!;
    expect(map[r.start].ref).toEqual({
      seg: "marker",
      span: 0,
      end: "start",
    });
  });

  it("resolves a collapsed query at a zero-width " +
     "side-absent gap", () => {
    const { map } = renderSp(spBlock);
    const r = entryRangeAt(map, 9, 9)!;
    expect(map[r.end].ref).toEqual({
      seg: "gap",
      index: 2,
    });
  });

  it("returns null outside the content", () => {
    const { map } = renderSp(spBlock);
    expect(entryRangeAt(map, 99, 100)).toBeNull();
  });
});

describe("rangeForEntries", () => {
  it("covers the position range of an entry " +
     "range", () => {
    const { map } = renderSp(spBlock);
    const r = entryRangeAt(map, 5, 7)!;
    expect(
      rangeForEntries(map, r.start, r.end)
    ).toEqual({ from: 5, to: 7 });
  });

  it("works over Latin maps with name atoms " +
     "(atom counts one position)", () => {
    const { map } = renderLatin(spBlock);
    // latin: "toki" (0-4) ", " (4-6) atom (6-7)
    // "!" (7-8)
    const r = entryRangeAt(map, 6, 7)!;
    expect(map[r.start].ref).toEqual({
      seg: "anchor",
      index: 1,
    });
    expect(
      rangeForEntries(map, r.start, r.end)
    ).toEqual({ from: 6, to: 7 });
  });
});
