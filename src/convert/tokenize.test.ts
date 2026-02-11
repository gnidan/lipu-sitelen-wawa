import { describe, it, expect } from "vitest";
import { tokenize, Token } from "./tokenize";

function word(value: string, w?: string): Token {
  return { type: "word", value, word: w ?? value };
}

function ws(value: string): Token {
  return { type: "whitespace", value };
}

function punct(value: string): Token {
  return { type: "punctuation", value };
}

function unknown(value: string): Token {
  return { type: "unknown", value };
}

describe("tokenize", () => {
  it("tokenizes simple words", () => {
    expect(tokenize("toki pona")).toEqual([
      word("toki"),
      ws(" "),
      word("pona"),
    ]);
  });

  it("handles trailing punctuation", () => {
    expect(tokenize("mi moku.")).toEqual([
      word("mi"),
      ws(" "),
      word("moku"),
      punct("."),
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("passes unknown words through", () => {
    expect(tokenize("hello world")).toEqual([
      unknown("hello"),
      ws(" "),
      unknown("world"),
    ]);
  });

  it("recognizes words case-insensitively", () => {
    const result = tokenize("Toki");
    expect(result).toEqual([word("Toki", "toki")]);
  });

  it("handles multiple spaces", () => {
    const result = tokenize("toki  pona");
    expect(result).toEqual([
      word("toki"),
      ws("  "),
      word("pona"),
    ]);
  });

  it("handles multiple punctuation marks", () => {
    expect(tokenize("a!?")).toEqual([
      word("a"),
      punct("!"),
      punct("?"),
    ]);
  });

  it("handles mixed known and unknown words", () => {
    expect(tokenize("toki xyz pona")).toEqual([
      word("toki"),
      ws(" "),
      unknown("xyz"),
      ws(" "),
      word("pona"),
    ]);
  });
});
