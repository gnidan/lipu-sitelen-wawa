import { describe, it, expect } from "vitest";
import {
  toVerbatim,
  fromVerbatim,
} from "./verbatim";
import {
  niDirectionByCp,
  niDirStringEffective,
} from "../data";

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

  describe(
    "standard ni CPs (F1989/F198A/F198B)",
    () => {
      it(
        "toVerbatim recognizes standard ni-left",
        () => {
          // F1989 = standard ni-left
          const input = String.fromCodePoint(
            0xF1989
          );
          expect(toVerbatim(input)).toBe("ni<");
        }
      );

      it(
        "toVerbatim recognizes standard ni-up",
        () => {
          const input = String.fromCodePoint(
            0xF198A
          );
          expect(toVerbatim(input)).toBe("ni^");
        }
      );

      it(
        "toVerbatim recognizes standard ni-right",
        () => {
          const input = String.fromCodePoint(
            0xF198B
          );
          expect(toVerbatim(input)).toBe("ni>");
        }
      );

      it(
        "fromVerbatim ni< produces " +
          "font-effective output",
        () => {
          const result = fromVerbatim("ni<");
          const dir = niDirectionByCp(0xF1989)!;
          const expected =
            niDirStringEffective(dir);
          expect(result).toBe(expected);
        }
      );
    }
  );
});
