import { describe, it, expect } from "vitest";
import {
  words,
  isWord,
  getWord,
  wordsByCategory,
  wordsByPrefix,
  wordToCodepoint,
  codepointToWord,
} from "./";

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
      expect(core.length).toBe(123);
    });

    it("returns common words", () => {
      const common = wordsByCategory("common");
      expect(common.length).toBeGreaterThanOrEqual(7);
    });

    it("returns uncommon words", () => {
      const uncommon = wordsByCategory("uncommon");
      expect(uncommon.length)
        .toBeGreaterThanOrEqual(9);
    });

    it("returns sandbox words", () => {
      const sandbox = wordsByCategory("sandbox");
      expect(sandbox.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("wordsByPrefix", () => {
    it("returns empty for empty prefix", () => {
      expect(wordsByPrefix("")).toHaveLength(0);
    });

    it("returns exact match first", () => {
      const results = wordsByPrefix("toki");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].word).toBe("toki");
    });

    it("returns multiple matches for prefix", () => {
      const results = wordsByPrefix("to");
      expect(results.length).toBeGreaterThan(1);
      // All results should start with "to"
      for (const r of results) {
        expect(r.word.startsWith("to")).toBe(true);
      }
    });

    it("returns empty for non-matching prefix", () => {
      expect(wordsByPrefix("xyz")).toHaveLength(0);
    });

    it("is case insensitive", () => {
      const lower = wordsByPrefix("tok");
      const upper = wordsByPrefix("Tok");
      expect(lower).toEqual(upper);
    });

    it("sorts core words before uncommon", () => {
      // "ki" matches core "kili", "kiwen", "kin"
      // and uncommon "kipisi", "ku", etc.
      const results = wordsByPrefix("ki");
      const coreIdx = results.findIndex(
        (r) => r.category === "core"
      );
      const uncommonIdx = results.findIndex(
        (r) => r.category === "uncommon"
      );
      if (coreIdx >= 0 && uncommonIdx >= 0) {
        expect(coreIdx).toBeLessThan(uncommonIdx);
      }
    });
  });

  describe("codepoint consistency with ucsur.ts", () => {
    it("matches codepoints in wordToCodepoint", () => {
      for (const [word, entry] of
        Object.entries(words)) {
        const ucsurCp = wordToCodepoint[word];
        if (ucsurCp !== undefined) {
          expect(entry.codepoint).toBe(ucsurCp);
        }
      }
    });

    it("all words have valid codepoints", () => {
      const SPECIAL_WORD_CPS = new Set([
        0x300C, 0x300D,
      ]);
      for (const entry of Object.values(words)) {
        if (
          SPECIAL_WORD_CPS.has(entry.codepoint)
        ) {
          continue;
        }
        expect(entry.codepoint)
          .toBeGreaterThanOrEqual(0xF1900);
        expect(entry.codepoint)
          .toBeLessThanOrEqual(0xF19FF);
      }
    });
  });

  describe("effective maps (font-capabilities)", () => {
    it(
      "extraWords appear in effective maps",
      () => {
        // pake, apeja, kokosila are in
        // nasin-nanpa extraWords
        expect(wordToCodepoint["pake"])
          .toBe(0xF19A0);
        expect(wordToCodepoint["apeja"])
          .toBe(0xF19A1);
        expect(wordToCodepoint["kokosila"])
          .toBe(0xF1984);
        expect(words["pake"]).toBeDefined();
        expect(words["apeja"]).toBeDefined();
        expect(words["kokosila"]).toBeDefined();
      }
    );

    it(
      "standard ni direction CPs map to ni",
      () => {
        expect(codepointToWord[0xF1989])
          .toBe("ni");
        expect(codepointToWord[0xF198A])
          .toBe("ni");
        expect(codepointToWord[0xF198B])
          .toBe("ni");
      }
    );
  });
});
