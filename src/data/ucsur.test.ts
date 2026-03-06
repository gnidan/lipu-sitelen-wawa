import { describe, it, expect } from "vitest";
import {
  wordToCodepoint,
  codepointToWord,
  codepointToChar,
  charToCodepoint,
  isUcsurChar,
} from "./ucsur";

describe("wordToCodepoint", () => {
  it("maps core words to expected codepoints", () => {
    expect(wordToCodepoint["a"]).toBe(0xF1900);
    expect(wordToCodepoint["akesi"]).toBe(0xF1901);
    expect(wordToCodepoint["e"]).toBe(0xF1909);
    expect(wordToCodepoint["jan"]).toBe(0xF1911);
    expect(wordToCodepoint["li"]).toBe(0xF1927);
    expect(wordToCodepoint["mi"]).toBe(0xF1934);
    expect(wordToCodepoint["pona"]).toBe(0xF1954);
    expect(wordToCodepoint["toki"]).toBe(0xF196C);
    expect(wordToCodepoint["wile"]).toBe(0xF1977);
    expect(wordToCodepoint["sitelen"]).toBe(0xF1960);
  });

  it("maps newer words to expected codepoints", () => {
    expect(wordToCodepoint["namako"]).toBe(0xF1978);
    expect(wordToCodepoint["tonsi"]).toBe(0xF197E);
    expect(wordToCodepoint["kijetesantakalu"])
      .toBe(0xF1980);
    expect(wordToCodepoint["ku"]).toBe(0xF1988);
    expect(wordToCodepoint["linluwi"]).toBe(0xF19A4);
    expect(wordToCodepoint["su"]).toBe(0xF19A6);
  });

  it("contains all 139 standard words", () => {
    const count =
      Object.keys(wordToCodepoint).length;
    expect(count).toBeGreaterThanOrEqual(139);
  });

  it("does not contain font-specific words", () => {
    expect(wordToCodepoint["pake"])
      .toBeUndefined();
    expect(wordToCodepoint["apeja"])
      .toBeUndefined();
    expect(wordToCodepoint["kokosila"])
      .toBeUndefined();
  });

  it("maps moved words to standard CPs", () => {
    expect(wordToCodepoint["majuna"])
      .toBe(0xF19A2);
    expect(wordToCodepoint["linluwi"])
      .toBe(0xF19A4);
    expect(wordToCodepoint["su"])
      .toBe(0xF19A6);
  });
});

describe("codepointToWord", () => {
  it("maps every codepoint to a valid word", () => {
    for (const [cp, word] of Object.entries(
      codepointToWord
    )) {
      expect(wordToCodepoint[word]).toBe(
        Number(cp)
      );
    }
  });

  it("covers every unique codepoint", () => {
    const uniqueCps = new Set(
      Object.values(wordToCodepoint)
    );
    expect(
      Object.keys(codepointToWord).length
    ).toBe(uniqueCps.size);
  });

  it("prefers canonical form for synonyms", () => {
    // ali is a synonym for ale; reverse map
    // should return "ale"
    const cp = wordToCodepoint["ale"];
    expect(codepointToWord[cp]).toBe("ale");
  });
});

describe("codepointToChar / charToCodepoint", () => {
  it("round-trips for known codepoints", () => {
    const cp = 0xF1954; // pona
    const char = codepointToChar(cp);
    expect(charToCodepoint(char)).toBe(cp);
  });

  it("round-trips for first codepoint", () => {
    const cp = 0xF1900; // a
    const char = codepointToChar(cp);
    expect(char).toBe(String.fromCodePoint(0xF1900));
    expect(charToCodepoint(char)).toBe(cp);
  });

  it("round-trips for last core word", () => {
    const cp = 0xF1977; // wile
    const char = codepointToChar(cp);
    expect(charToCodepoint(char)).toBe(cp);
  });

  it("returns undefined for ASCII chars", () => {
    expect(charToCodepoint("A")).toBeUndefined();
    expect(charToCodepoint("z")).toBeUndefined();
    expect(charToCodepoint("0")).toBeUndefined();
  });
});

describe("isUcsurChar", () => {
  it("returns true for UCSUR sitelen pona chars", () => {
    const char = String.fromCodePoint(0xF1900);
    expect(isUcsurChar(char)).toBe(true);
  });

  it("returns true for end of UCSUR range", () => {
    const char = String.fromCodePoint(0xF19FF);
    expect(isUcsurChar(char)).toBe(true);
  });

  it("returns false for ASCII characters", () => {
    expect(isUcsurChar("a")).toBe(false);
    expect(isUcsurChar("Z")).toBe(false);
    expect(isUcsurChar(" ")).toBe(false);
  });

  it("returns false for chars outside range", () => {
    const before = String.fromCodePoint(0xF18FF);
    const after = String.fromCodePoint(0xF1A00);
    expect(isUcsurChar(before)).toBe(false);
    expect(isUcsurChar(after)).toBe(false);
  });
});
