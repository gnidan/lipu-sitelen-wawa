import { describe, it, expect } from "vitest";
import { wordToUcsur, toUcsur } from "./to-ucsur";
import { toLatin } from "./to-latin";
import {
  codepointToChar,
  wordToCodepoint,
  VARIATION_SELECTOR_BASE,
} from "../data";

describe("wordToUcsur", () => {
  it("converts a known word", () => {
    const expected = codepointToChar(wordToCodepoint["toki"]);
    expect(wordToUcsur("toki")).toBe(expected);
  });

  it("appends variation selector", () => {
    const base = codepointToChar(wordToCodepoint["toki"]);
    const vs = String.fromCodePoint(VARIATION_SELECTOR_BASE);
    expect(wordToUcsur("toki", 1)).toBe(base + vs);
  });

  it("returns undefined for unknown words", () => {
    expect(wordToUcsur("notaword")).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(wordToUcsur("Toki")).toBe(wordToUcsur("toki"));
  });
});

describe("toUcsur", () => {
  it("converts multiple words", () => {
    const result = toUcsur("toki pona");
    const tokiChar = codepointToChar(
      wordToCodepoint["toki"]
    );
    const ponaChar = codepointToChar(
      wordToCodepoint["pona"]
    );
    expect(result).toBe(tokiChar + " " + ponaChar);
  });

  it("preserves punctuation", () => {
    const result = toUcsur("mi moku.");
    const miChar = codepointToChar(wordToCodepoint["mi"]);
    const mokuChar = codepointToChar(
      wordToCodepoint["moku"]
    );
    expect(result).toBe(miChar + " " + mokuChar + ".");
  });

  it("passes unknown words through", () => {
    const result = toUcsur("hello toki");
    const tokiChar = codepointToChar(
      wordToCodepoint["toki"]
    );
    expect(result).toBe("hello " + tokiChar);
  });

  it("round-trips with toLatin", () => {
    const input = "toki pona li pona";
    const ucsur = toUcsur(input);
    const latin = toLatin(ucsur);
    expect(latin).toBe(input);
  });
});
