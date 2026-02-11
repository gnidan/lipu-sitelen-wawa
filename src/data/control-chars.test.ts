import { describe, it, expect } from "vitest";
import {
  STACKING_JOINER,
  SCALING_JOINER,
  START_OF_LONG_GLYPH,
  END_OF_LONG_GLYPH,
  START_OF_REVERSE_LONG_GLYPH,
  END_OF_REVERSE_LONG_GLYPH,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
  isControlChar,
  isJoiner,
  isCartoucheChar,
  controlCharToName,
} from "./control-chars";

describe("control char constants", () => {
  it("has correct codepoint values", () => {
    expect(STACKING_JOINER).toBe(0xF1995);
    expect(SCALING_JOINER).toBe(0xF1996);
    expect(START_OF_LONG_GLYPH).toBe(0xF1997);
    expect(END_OF_LONG_GLYPH).toBe(0xF1998);
    expect(START_OF_REVERSE_LONG_GLYPH)
      .toBe(0xF199A);
    expect(END_OF_REVERSE_LONG_GLYPH)
      .toBe(0xF199B);
    expect(START_OF_CARTOUCHE).toBe(0xF1990);
    expect(END_OF_CARTOUCHE).toBe(0xF1991);
    expect(CARTOUCHE_EXTENSION).toBe(0xF1992);
  });
});

describe("isControlChar", () => {
  it("returns true for all control characters", () => {
    const allChars = [
      STACKING_JOINER,
      SCALING_JOINER,
      START_OF_LONG_GLYPH,
      END_OF_LONG_GLYPH,
      START_OF_REVERSE_LONG_GLYPH,
      END_OF_REVERSE_LONG_GLYPH,
      START_OF_CARTOUCHE,
      END_OF_CARTOUCHE,
      CARTOUCHE_EXTENSION,
    ];
    for (const cp of allChars) {
      expect(isControlChar(cp)).toBe(true);
    }
  });

  it("returns false for non-control chars", () => {
    expect(isControlChar(0xF1900)).toBe(false);
    expect(isControlChar(0x0041)).toBe(false);
    expect(isControlChar(0)).toBe(false);
  });
});

describe("isJoiner", () => {
  it("returns true for joiners", () => {
    expect(isJoiner(STACKING_JOINER)).toBe(true);
    expect(isJoiner(SCALING_JOINER)).toBe(true);
  });

  it("returns false for non-joiners", () => {
    expect(isJoiner(START_OF_LONG_GLYPH))
      .toBe(false);
    expect(isJoiner(START_OF_CARTOUCHE))
      .toBe(false);
    expect(isJoiner(0xF1900)).toBe(false);
  });
});

describe("isCartoucheChar", () => {
  it("returns true for cartouche characters", () => {
    expect(isCartoucheChar(START_OF_CARTOUCHE))
      .toBe(true);
    expect(isCartoucheChar(END_OF_CARTOUCHE))
      .toBe(true);
    expect(isCartoucheChar(CARTOUCHE_EXTENSION))
      .toBe(true);
  });

  it("returns false for non-cartouche chars", () => {
    expect(isCartoucheChar(STACKING_JOINER))
      .toBe(false);
    expect(isCartoucheChar(START_OF_LONG_GLYPH))
      .toBe(false);
    expect(isCartoucheChar(0xF1900)).toBe(false);
  });
});

describe("controlCharToName", () => {
  it("returns names for all control characters", () => {
    expect(controlCharToName(STACKING_JOINER))
      .toBe("STACKING_JOINER");
    expect(controlCharToName(SCALING_JOINER))
      .toBe("SCALING_JOINER");
    expect(controlCharToName(START_OF_LONG_GLYPH))
      .toBe("START_OF_LONG_GLYPH");
    expect(controlCharToName(END_OF_LONG_GLYPH))
      .toBe("END_OF_LONG_GLYPH");
    expect(
      controlCharToName(START_OF_REVERSE_LONG_GLYPH)
    ).toBe("START_OF_REVERSE_LONG_GLYPH");
    expect(
      controlCharToName(END_OF_REVERSE_LONG_GLYPH)
    ).toBe("END_OF_REVERSE_LONG_GLYPH");
    expect(controlCharToName(START_OF_CARTOUCHE))
      .toBe("START_OF_CARTOUCHE");
    expect(controlCharToName(END_OF_CARTOUCHE))
      .toBe("END_OF_CARTOUCHE");
    expect(controlCharToName(CARTOUCHE_EXTENSION))
      .toBe("CARTOUCHE_EXTENSION");
  });

  it("returns undefined for unknown codepoints", () => {
    expect(controlCharToName(0xF1900))
      .toBeUndefined();
    expect(controlCharToName(0x0041))
      .toBeUndefined();
    expect(controlCharToName(0)).toBeUndefined();
  });
});
