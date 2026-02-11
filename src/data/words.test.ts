import { describe, it, expect } from "vitest";
import {
  words,
  isWord,
  getWord,
  wordsByCategory,
} from "./words";
import { wordToCodepoint } from "./ucsur";

describe("words", () => {
  describe("isWord", () => {
    it("returns true for known words", () => {
      expect(isWord("toki")).toBe(true);
      expect(isWord("pona")).toBe(true);
      expect(isWord("a")).toBe(true);
      expect(isWord("wile")).toBe(true);
    });

    it("returns true for post-pu words", () => {
      expect(isWord("namako")).toBe(true);
      expect(isWord("tonsi")).toBe(true);
      expect(isWord("ku")).toBe(true);
    });

    it("returns false for non-words", () => {
      expect(isWord("xyz")).toBe(false);
      expect(isWord("hello")).toBe(false);
      expect(isWord("")).toBe(false);
    });
  });

  describe("getWord", () => {
    it("returns word entry for valid words", () => {
      const entry = getWord("toki");
      expect(entry).toBeDefined();
      expect(entry!.word).toBe("toki");
      expect(entry!.codepoint).toBe(0xF196C);
      expect(entry!.category).toBe("core");
      expect(entry!.definition).toBeTruthy();
    });

    it("returns undefined for unknown words", () => {
      expect(getWord("xyz")).toBeUndefined();
    });
  });

  describe("word count", () => {
    it("has the expected number of words", () => {
      const count = Object.keys(words).length;
      expect(count).toBeGreaterThanOrEqual(137);
      expect(count).toBeLessThanOrEqual(170);
    });
  });

  describe("wordsByCategory", () => {
    it("returns many core words", () => {
      const core = wordsByCategory("core");
      expect(core.length).toBe(120);
    });

    it("returns common words", () => {
      const common = wordsByCategory("common");
      expect(common.length).toBeGreaterThanOrEqual(7);
    });

    it("returns uncommon words", () => {
      const uncommon = wordsByCategory("uncommon");
      expect(uncommon.length).toBeGreaterThanOrEqual(10);
    });

    it("returns sandbox words", () => {
      const sandbox = wordsByCategory("sandbox");
      expect(sandbox.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("codepoint consistency with ucsur.ts", () => {
    it("matches codepoints in wordToCodepoint", () => {
      for (const [word, entry] of Object.entries(words)) {
        const ucsurCp = wordToCodepoint[word];
        if (ucsurCp !== undefined) {
          expect(entry.codepoint).toBe(ucsurCp);
        }
      }
    });

    it("all words have valid UCSUR codepoints", () => {
      for (const entry of Object.values(words)) {
        expect(entry.codepoint).toBeGreaterThanOrEqual(
          0xF1900
        );
        expect(entry.codepoint).toBeLessThanOrEqual(
          0xF19FF
        );
      }
    });
  });
});
