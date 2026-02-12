import { describe, it, expect } from "vitest";
import { toSitelenPona } from "./to-sitelen-pona";
import { toLatin } from "./to-latin";
import {
  codepointToChar,
  wordToCodepoint,
  isUcsurChar,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
} from "../data";

function ucsur(word: string): string {
  return codepointToChar(wordToCodepoint[word]);
}

const cartStart = String.fromCodePoint(
  START_OF_CARTOUCHE
);
const cartEnd = String.fromCodePoint(
  END_OF_CARTOUCHE
);
const cartExt = String.fromCodePoint(
  CARTOUCHE_EXTENSION
);

describe("toSitelenPona", () => {
  it("converts lowercase toki pona words", () => {
    const result = toSitelenPona("toki pona");
    // Spaces between UCSUR words are stripped
    expect(result).toBe(
      ucsur("toki") + ucsur("pona")
    );
  });

  it(
    "wraps a capitalized tp word in a cartouche",
    () => {
      const result = toSitelenPona("Toki");
      expect(result).toBe(
        cartStart + ucsur("toki") + cartEnd
      );
    }
  );

  it(
    "expands a capitalized abbreviation into " +
      "a cartouche",
    () => {
      // "Omo" -> O=o, m=mi (or similar), o=o
      const result = toSitelenPona("Omo");
      // Should produce a cartouche with 3 words
      expect(result).toContain(cartStart);
      expect(result).toContain(cartEnd);
      // Should have 2 extension markers
      const extCount = [...result].filter(
        (c) =>
          c.codePointAt(0) === CARTOUCHE_EXTENSION
      ).length;
      expect(extCount).toBe(2);
    }
  );

  it(
    "handles mixed words and abbreviations",
    () => {
      const result = toSitelenPona(
        "jan Tp li pona"
      );
      // "jan" -> UCSUR
      // "Tp" -> cartouche abbreviation (t-word, p-word)
      // "li" -> UCSUR
      // "pona" -> UCSUR
      expect(result).toContain(ucsur("jan"));
      expect(result).toContain(cartStart);
      expect(result).toContain(cartEnd);
      expect(result).toContain(ucsur("li"));
      expect(result).toContain(ucsur("pona"));
    }
  );

  it("passes unknown words through", () => {
    const result = toSitelenPona("hello world");
    expect(result).toBe("hello world");
  });

  it("passes punctuation through", () => {
    const result = toSitelenPona("toki pona.");
    expect(result).toBe(
      ucsur("toki") + ucsur("pona") + "."
    );
  });

  it(
    "strips spaces between converted words",
    () => {
      const result = toSitelenPona(
        "mi moku e telo"
      );
      // All tp words, spaces stripped
      expect(result).toBe(
        ucsur("mi") +
          ucsur("moku") +
          ucsur("e") +
          ucsur("telo")
      );
    }
  );

  it(
    "preserves spaces next to non-UCSUR tokens",
    () => {
      const result = toSitelenPona(
        "hello toki"
      );
      // "hello" is not tp, space preserved
      expect(result).toBe(
        "hello " + ucsur("toki")
      );
    }
  );

  it("returns input unchanged for empty", () => {
    expect(toSitelenPona("")).toBe("");
  });

  it(
    "round-trips abbreviation through toLatin",
    () => {
      // "Omo" -> cartouche -> toLatin -> "Omo"
      const sitelenPona = toSitelenPona("Omo");
      const latin = toLatin(sitelenPona);
      expect(latin).toBe("Omo");
    }
  );

  it(
    "does not cartouche capitalized non-tp " +
      "non-expandable words",
    () => {
      // "Xyz" — x, y, z have no tp words
      const result = toSitelenPona("Xyz");
      expect(result).toBe("Xyz");
      for (const ch of result) {
        expect(isUcsurChar(ch)).toBe(false);
      }
    }
  );

  it(
    "capitalized tp word followed by non-tp",
    () => {
      const result = toSitelenPona("Toki World");
      // "Toki" -> single-word cartouche
      // " World" -> pass through
      expect(result).toBe(
        cartStart +
          ucsur("toki") +
          cartEnd +
          " World"
      );
    }
  );
});
