import { describe, it, expect } from "vitest";
import { toLatin } from "./to-latin";
import { toUcsur } from "./to-ucsur";
import {
  codepointToChar,
  wordToCodepoint,
  VARIATION_SELECTOR_BASE,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
} from "../data";

function ucsur(word: string): string {
  return codepointToChar(wordToCodepoint[word]);
}

describe("toLatin", () => {
  it("converts a single UCSUR char to its word", () => {
    expect(toLatin(ucsur("toki"))).toBe("toki");
  });

  it("converts multiple UCSUR chars with spaces", () => {
    const input =
      ucsur("toki") + " " + ucsur("pona");
    expect(toLatin(input)).toBe("toki pona");
  });

  it("strips variation selectors", () => {
    const vs1 = String.fromCodePoint(
      VARIATION_SELECTOR_BASE
    );
    const input = ucsur("toki") + vs1;
    expect(toLatin(input)).toBe("toki");
  });

  it("passes unknown characters through", () => {
    expect(toLatin("hello")).toBe("hello");
  });

  it("passes punctuation through", () => {
    const input =
      ucsur("mi") + " " + ucsur("moku") + ".";
    expect(toLatin(input)).toBe("mi moku.");
  });

  it("inserts spaces between consecutive UCSUR chars", () => {
    const input = ucsur("toki") + ucsur("pona");
    expect(toLatin(input)).toBe("toki pona");
  });

  it("round-trips with toUcsur", () => {
    const input = "mi wile moku";
    const roundTripped = toLatin(toUcsur(input));
    expect(roundTripped).toBe(input);
  });

  it(
    "abbreviates single cartouche word",
    () => {
      const start = String.fromCodePoint(
        START_OF_CARTOUCHE
      );
      const end = String.fromCodePoint(
        END_OF_CARTOUCHE
      );
      const input =
        start + ucsur("toki") + end;
      expect(toLatin(input)).toBe("T");
    }
  );

  it(
    "abbreviates multi-word cartouche",
    () => {
      const start = String.fromCodePoint(
        START_OF_CARTOUCHE
      );
      const end = String.fromCodePoint(
        END_OF_CARTOUCHE
      );
      const ext = String.fromCodePoint(
        CARTOUCHE_EXTENSION
      );
      const input =
        start +
        ucsur("o") +
        ext +
        ucsur("monsuta") +
        ext +
        ucsur("o") +
        end;
      expect(toLatin(input)).toBe("Omo");
    }
  );

  it(
    "does not abbreviate outside cartouches",
    () => {
      const start = String.fromCodePoint(
        START_OF_CARTOUCHE
      );
      const end = String.fromCodePoint(
        END_OF_CARTOUCHE
      );
      const input =
        ucsur("mi") +
        " " +
        start +
        ucsur("toki") +
        end +
        " " +
        ucsur("pona");
      expect(toLatin(input)).toBe(
        "mi T pona"
      );
    }
  );

  it("strips control chars in output", () => {
    const ext = String.fromCodePoint(
      CARTOUCHE_EXTENSION
    );
    // Extension char outside cartouche is stripped
    const input = ucsur("toki") + ext + ucsur("pona");
    expect(toLatin(input)).toBe("toki pona");
  });
});
