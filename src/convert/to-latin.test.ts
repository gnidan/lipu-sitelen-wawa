import { describe, it, expect } from "vitest";
import { toLatin, splitMorae } from "./to-latin";
import { toUcsur } from "./to-ucsur";
import {
  codepointToChar,
  wordToCodepoint,
  asciiToUcsurControl,
  VARIATION_SELECTOR_BASE,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
  MIDDLE_DOT,
  COLON,
  IDEOGRAPHIC_SPACE,
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

  it(
    "inserts space between UCSUR and Latin text",
    () => {
      const input = ucsur("toki") + "po";
      expect(toLatin(input)).toBe("toki po");
    }
  );

  it("preserves newlines between UCSUR lines", () => {
    const input =
      ucsur("toki") +
      ucsur("pona") +
      "\n" +
      ucsur("mi") +
      ucsur("moku");
    expect(toLatin(input)).toBe(
      "toki pona\nmi moku"
    );
  });

  it("strips control chars in output", () => {
    const ext = String.fromCodePoint(
      CARTOUCHE_EXTENSION
    );
    // Extension char outside cartouche is stripped
    const input = ucsur("toki") + ext + ucsur("pona");
    expect(toLatin(input)).toBe("toki pona");
  });

  it("converts ideographic space to regular space", () => {
    const idesp = String.fromCodePoint(
      IDEOGRAPHIC_SPACE
    );
    const input =
      ucsur("toki") + idesp + ucsur("pona");
    expect(toLatin(input)).toBe("toki pona");
  });

  it(
    "converts ideographic space between sentences",
    () => {
      const idesp = String.fromCodePoint(
        IDEOGRAPHIC_SPACE
      );
      const input =
        ucsur("mi") +
        ucsur("moku") +
        idesp +
        ucsur("sina") +
        ucsur("pona");
      expect(toLatin(input)).toBe(
        "mi moku sina pona"
      );
    }
  );

  describe("standard ni direction CPs", () => {
    it(
      "converts ni-left (F1989) to 'ni'",
      () => {
        const input = String.fromCodePoint(
          0xF1989
        );
        expect(toLatin(input)).toBe("ni");
      }
    );

    it(
      "converts ni-up (F198A) to 'ni'",
      () => {
        const input = String.fromCodePoint(
          0xF198A
        );
        expect(toLatin(input)).toBe("ni");
      }
    );

    it(
      "converts ni-right (F198B) to 'ni'",
      () => {
        const input = String.fromCodePoint(
          0xF198B
        );
        expect(toLatin(input)).toBe("ni");
      }
    );

    it(
      "standard ni CPs do not skip next char",
      () => {
        // Standard ni CP followed by a regular
        // word — should not eat it as an arrow
        const input =
          String.fromCodePoint(0xF1989) +
          ucsur("pona");
        expect(toLatin(input)).toBe("ni pona");
      }
    );
  });

  describe("nasin sitelen kalama (mora-based)", () => {
    const start = String.fromCodePoint(
      START_OF_CARTOUCHE
    );
    const end = String.fromCodePoint(
      END_OF_CARTOUCHE
    );
    const ext = String.fromCodePoint(
      CARTOUCHE_EXTENSION
    );
    const dot = String.fromCodePoint(MIDDLE_DOT);
    const colon = String.fromCodePoint(COLON);

    it("uses colon for whole word", () => {
      // [tan:] → "Tan"
      const input =
        start + ucsur("tan") + colon + end;
      expect(toLatin(input)).toBe("Tan");
    });

    it("uses dot for one mora", () => {
      // [ken.] → "Ke" (first mora of ken)
      const input =
        start + ucsur("ken") + dot + end;
      expect(toLatin(input)).toBe("Ke");
    });

    it("uses multiple dots for multiple morae", () => {
      // [ken..] → "Ken" (both morae: ke + n)
      const input =
        start + ucsur("ken") + dot + dot + end;
      expect(toLatin(input)).toBe("Ken");
    });

    it("handles jan Kenitan example", () => {
      // jan [ken. = ni. = tan:]
      const input =
        ucsur("jan") + " " +
        start +
        ucsur("ken") + dot +
        ext +
        ucsur("ni") + dot +
        ext +
        ucsur("tan") + colon +
        end;
      expect(toLatin(input)).toBe("jan Kenitan");
    });

    it("handles single-mora word with dot", () => {
      // [a.] → "A" (a is one mora)
      const input =
        start + ucsur("a") + dot + end;
      expect(toLatin(input)).toBe("A");
    });

    it("handles multi-syllable word morae", () => {
      // [toki.] → "To" (first mora of toki)
      const input =
        start + ucsur("toki") + dot + end;
      expect(toLatin(input)).toBe("To");
    });

    it("handles two morae of multi-syllable word", () => {
      // [toki..] → "Toki"
      const input =
        start + ucsur("toki") + dot + dot + end;
      expect(toLatin(input)).toBe("Toki");
    });
  });

  describe(
    "nasin sitelen kalama pi linja lili " +
    "(letter-based)",
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
      // Tally mark is overridden to ASCII comma
      const tally = asciiToUcsurControl(",")!;

      it("uses commas for letter count", () => {
        // [ken,,] → "Ke" (2 letters)
        const input =
          start +
          ucsur("ken") + tally + tally +
          end;
        expect(toLatin(input)).toBe("Ke");
      });

      it("uses three commas for three letters", () => {
        // [ken,,,] → "Ken" (3 letters)
        const input =
          start +
          ucsur("ken") +
          tally + tally + tally +
          end;
        expect(toLatin(input)).toBe("Ken");
      });

      it("handles jan Kenitan example", () => {
        // jan [ken,, = ni,, = tan,,,]
        const input =
          ucsur("jan") + " " +
          start +
          ucsur("ken") + tally + tally +
          ext +
          ucsur("ni") + tally + tally +
          ext +
          ucsur("tan") +
          tally + tally + tally +
          end;
        expect(toLatin(input)).toBe("jan Kenitan");
      });

      it("uses one comma for one letter", () => {
        // [toki,] → "T"
        const input =
          start + ucsur("toki") + tally + end;
        expect(toLatin(input)).toBe("T");
      });
    }
  );
});

describe("splitMorae", () => {
  it("splits CV syllables", () => {
    expect(splitMorae("toki")).toEqual(
      ["to", "ki"]
    );
  });

  it("splits coda n as separate mora", () => {
    expect(splitMorae("tan")).toEqual(
      ["ta", "n"]
    );
    expect(splitMorae("jan")).toEqual(
      ["ja", "n"]
    );
    expect(splitMorae("ken")).toEqual(
      ["ke", "n"]
    );
  });

  it("handles vowel-initial words", () => {
    expect(splitMorae("a")).toEqual(["a"]);
    expect(splitMorae("ale")).toEqual(
      ["a", "le"]
    );
  });

  it("handles the word n", () => {
    expect(splitMorae("n")).toEqual(["n"]);
  });

  it("handles multi-syllable with coda n", () => {
    expect(splitMorae("nasin")).toEqual(
      ["na", "si", "n"]
    );
    expect(splitMorae("sinpin")).toEqual(
      ["si", "n", "pi", "n"]
    );
  });

  it("handles long words", () => {
    expect(splitMorae("kepeken")).toEqual(
      ["ke", "pe", "ke", "n"]
    );
    expect(splitMorae("kijetesantakalu")).toEqual(
      ["ki", "je", "te", "sa", "n",
       "ta", "ka", "lu"]
    );
  });
});
