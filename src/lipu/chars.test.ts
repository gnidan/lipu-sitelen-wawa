import { describe, it, expect } from "vitest";
import {
  CARTOUCHE_START,
  CARTOUCHE_END,
  LONG_START,
  LONG_END,
  REV_LONG_START,
  REV_LONG_END,
  MIDDLE_DOT_CH,
  COLON_CH,
  TALLY_CH,
  IDEO_SPACE,
  STACK,
  SCALE,
  ZWJ_CH,
  JOINER_CHARS,
  STRUCTURAL_BY_CHAR,
  structuralChar,
  schemeChars,
  arrowChar,
  isArrowChar,
  isMarkerChar,
} from "./chars";
import { NI_DIRECTIONS } from "../data";

// Codepoint values below are FROZEN literals: the
// exact codepoint each marker must render as. Pinned
// directly rather than derived from another module, so
// the guarantee holds regardless of how the rendering
// code is implemented.
describe("marker char codepoints (frozen)", () => {
  it("structural/scheme/joiner chars match their " +
     "pinned codepoints", () => {
    expect(CARTOUCHE_START.codePointAt(0))
      .toBe(0xf1990);
    expect(CARTOUCHE_END.codePointAt(0))
      .toBe(0xf1991);
    expect(LONG_START.codePointAt(0)).toBe(0xf1997);
    expect(LONG_END.codePointAt(0)).toBe(0xf1998);
    expect(REV_LONG_START.codePointAt(0))
      .toBe(0xf199a);
    expect(REV_LONG_END.codePointAt(0)).toBe(0xf199b);
    expect(MIDDLE_DOT_CH.codePointAt(0)).toBe(0xf199c);
    expect(COLON_CH.codePointAt(0)).toBe(0xf199d);
    expect(TALLY_CH.codePointAt(0)).toBe(0x2c);
    expect(IDEO_SPACE.codePointAt(0)).toBe(0x3000);
    expect(STACK.codePointAt(0)).toBe(0xf1995);
    expect(SCALE.codePointAt(0)).toBe(0xf1996);
    expect(ZWJ_CH.codePointAt(0)).toBe(0x200d);
  });

  it("arrowChar matches its pinned codepoint per " +
     "ni direction", () => {
    const ARROW_CPS: Record<number, number> = {
      1: 0x2190,
      2: 0x2191,
      3: 0x2192,
      4: 0x2193,
      5: 0x2196,
      6: 0x2197,
      7: 0x2198,
      8: 0x2199,
    };
    for (const d of NI_DIRECTIONS) {
      expect(arrowChar(d.index).codePointAt(0))
        .toBe(ARROW_CPS[d.index]);
      expect(isArrowChar(d.arrow)).toBe(true);
    }
  });
});

describe("tables", () => {
  it("structuralChar round-trips through " +
     "STRUCTURAL_BY_CHAR", () => {
    for (const [c, r] of STRUCTURAL_BY_CHAR) {
      expect(structuralChar(r.kind, r.role))
        .toBe(c);
    }
    expect(STRUCTURAL_BY_CHAR.size).toBe(6);
  });

  it("JOINER_CHARS holds stack/scale/zwj", () => {
    expect(JOINER_CHARS).toEqual(
      new Set([STACK, SCALE, ZWJ_CH])
    );
  });

  it("schemeChars renders each style", () => {
    expect(
      schemeChars({ style: "morae", count: 2 })
    ).toBe(MIDDLE_DOT_CH + MIDDLE_DOT_CH);
    expect(
      schemeChars({ style: "letters", count: 3 })
    ).toBe(TALLY_CH.repeat(3));
    expect(schemeChars({ style: "word" }))
      .toBe(COLON_CH);
    expect(schemeChars(undefined)).toBe("");
  });

  it("isMarkerChar covers markers, space, and " +
     "arrows; excludes word glyph area", () => {
    expect(isMarkerChar(0x20)).toBe(true);
    expect(
      isMarkerChar(IDEO_SPACE.codePointAt(0)!)
    ).toBe(true);
    expect(
      isMarkerChar(
        NI_DIRECTIONS[0].arrowCp
      )
    ).toBe(true);
    expect(isMarkerChar(0x61)).toBe(false);
  });
});
