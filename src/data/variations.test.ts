import { describe, it, expect } from "vitest";
import {
  VARIATION_SELECTOR_BASE,
  variationIndexToSelector,
  glyphVariations,
  hasVariations,
  getVariations,
  applyVariation,
} from "./variations";

describe("variations", () => {
  describe("hasVariations", () => {
    it("returns true for words with variations", () => {
      expect(hasVariations("jaki")).toBe(true);
      expect(hasVariations("ko")).toBe(true);
      expect(hasVariations("ni")).toBe(true);
      expect(hasVariations("akesi")).toBe(true);
      expect(hasVariations("sewi")).toBe(true);
      expect(hasVariations("lanpan")).toBe(true);
    });

    it("returns false for words without", () => {
      expect(hasVariations("toki")).toBe(false);
      expect(hasVariations("pona")).toBe(false);
      expect(hasVariations("xyz")).toBe(false);
    });
  });

  describe("getVariations", () => {
    it("returns 8 variants for jaki", () => {
      expect(getVariations("jaki")).toHaveLength(8);
    });

    it("returns 8 variants for ko", () => {
      expect(getVariations("ko")).toHaveLength(8);
    });

    it("returns 8 variants for ni", () => {
      const vars = getVariations("ni");
      expect(vars).toHaveLength(8);
      expect(vars[0].description).toBe("left arrow");
      expect(vars[7].description).toBe(
        "lower-left arrow"
      );
    });

    it("returns 1 variant for two-variant words", () => {
      expect(getVariations("akesi")).toHaveLength(1);
      expect(getVariations("sewi")).toHaveLength(1);
      expect(getVariations("meli")).toHaveLength(1);
    });

    it("returns empty array for unknown words", () => {
      expect(getVariations("toki")).toEqual([]);
      expect(getVariations("xyz")).toEqual([]);
    });
  });

  describe("variationIndexToSelector", () => {
    it("maps index 1 to U+FE00", () => {
      expect(variationIndexToSelector(1)).toBe(0xFE00);
    });

    it("maps index 8 to U+FE07", () => {
      expect(variationIndexToSelector(8)).toBe(0xFE07);
    });

    it("maps sequential indices correctly", () => {
      for (let i = 1; i <= 8; i++) {
        expect(variationIndexToSelector(i)).toBe(
          VARIATION_SELECTOR_BASE + (i - 1)
        );
      }
    });

    it("throws for out-of-range indices", () => {
      expect(() => variationIndexToSelector(0)).toThrow();
      expect(() => variationIndexToSelector(9)).toThrow();
      expect(() => variationIndexToSelector(-1)).toThrow();
    });
  });

  describe("applyVariation", () => {
    it("appends variation selector to char", () => {
      const base = String.fromCodePoint(0xF1910);
      const result = applyVariation(base, 1);
      expect(result).toHaveLength(base.length + 1);
      expect(result.codePointAt(
        base.length
      )).toBe(0xFE00);
    });

    it("appends correct selector for index 3", () => {
      const base = String.fromCodePoint(0xF1941);
      const result = applyVariation(base, 3);
      const codes = [...result].map(
        (ch) => ch.codePointAt(0)
      );
      expect(codes).toContain(0xFE02);
    });
  });

  describe("glyphVariations", () => {
    it("contains exactly 17 words", () => {
      expect(
        Object.keys(glyphVariations)
      ).toHaveLength(17);
    });

    it("has valid selectors for all entries", () => {
      for (const vars of Object.values(
        glyphVariations
      )) {
        for (const v of vars) {
          expect(v.selector).toBeGreaterThanOrEqual(
            0xFE00
          );
          expect(v.selector).toBeLessThanOrEqual(
            0xFE07
          );
          expect(v.index).toBeGreaterThanOrEqual(1);
          expect(v.index).toBeLessThanOrEqual(8);
        }
      }
    });
  });
});
