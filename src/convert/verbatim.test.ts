import { describe, it, expect } from "vitest";
import {
  toVerbatim,
  fromVerbatim,
} from "./verbatim";

describe("verbatim round-trip", () => {
  describe("ni directions", () => {
    const cases = [
      { verbatim: "ni<", desc: "left" },
      { verbatim: "ni^", desc: "up" },
      { verbatim: "ni>", desc: "right" },
      { verbatim: "niv", desc: "down" },
      { verbatim: "ni^<", desc: "upper-left" },
      { verbatim: "ni^>", desc: "upper-right" },
      { verbatim: "ni>v", desc: "lower-right" },
      { verbatim: "ni<v", desc: "lower-left" },
    ];

    for (const { verbatim, desc } of cases) {
      it(`round-trips ni ${desc} (${verbatim})`,
        () => {
          const ucsur = fromVerbatim(verbatim);
          const back = toVerbatim(ucsur);
          expect(back).toBe(verbatim);
        }
      );
    }
  });

  describe("fromVerbatim → toVerbatim", () => {
    it("round-trips plain words", () => {
      const v = "toki pona";
      expect(toVerbatim(fromVerbatim(v)))
        .toBe(v);
    });

    it("round-trips structural chars", () => {
      const v = "[toki=pona]";
      expect(toVerbatim(fromVerbatim(v)))
        .toBe(v);
    });

    it("round-trips long glyph", () => {
      const v = "lon(toki pona)";
      expect(toVerbatim(fromVerbatim(v)))
        .toBe(v);
    });

    it("round-trips joiners", () => {
      const v = "toki-pona";
      expect(toVerbatim(fromVerbatim(v)))
        .toBe(v);
    });
  });
});
