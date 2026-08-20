import { describe, it, expect } from "vitest";
import {
  parseSp,
  spInlinesFromText,
} from "./parse-sp";
import { renderSp } from "./render-sp";
import {
  CARTOUCHE_START,
  CARTOUCHE_END,
  CART_EXT,
  MIDDLE_DOT_CH,
  COLON_CH,
  TALLY_CH,
  IDEO_SPACE,
  STACK,
  ZWJ_CH,
} from "./chars";
import type { Block, SpInline } from "./types";
import {
  niDirectionByIndex,
  niDirStringEffective,
  variationIndexToSelector,
} from "../data";
import { glyph, cart } from "../../test/helpers";

function parse(text: string) {
  return parseSp(spInlinesFromText(text));
}

describe("parseSp — words and gaps", () => {
  it("splits words and literal gap chars", () => {
    expect(
      parse(
        glyph("toki") + " " + glyph("pona") +
          IDEO_SPACE + glyph("mute")
      )
    ).toEqual({
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "word", word: "pona" },
        { kind: "word", word: "mute" },
      ],
      gaps: ["", " ", IDEO_SPACE, ""],
    });
  });

  it("keeps joiners as gap chars", () => {
    expect(
      parse(glyph("pona") + STACK + glyph("mute"))
    ).toEqual({
      anchors: [
        { kind: "word", word: "pona" },
        { kind: "word", word: "mute" },
      ],
      gaps: ["", STACK, ""],
    });
  });

  it("is total: unknown text becomes unmarked " +
     "verbatim anchors, interior spaces " +
     "absorbed", () => {
    expect(parse("hi there " + glyph("toki")))
      .toEqual({
        anchors: [
          { kind: "verbatim",
            text: "hi there " },
          { kind: "word", word: "toki" },
        ],
        gaps: ["", "", ""],
      });
  });

  it("a leading space stays gap content when no " +
     "verbatim run is pending", () => {
    expect(parse(" hi")).toEqual({
      anchors: [{ kind: "verbatim", text: "hi" }],
      gaps: [" ", ""],
    });
  });

  it("marked inline runs become marked verbatim " +
     "anchors", () => {
    const inlines: SpInline[] = [
      { type: "text", text: glyph("toki"),
        verbatim: false },
      { type: "text", text: "hi there",
        verbatim: true },
    ];
    expect(parseSp(inlines)).toEqual({
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "verbatim", text: "hi there",
          marked: true },
      ],
      gaps: ["", "", ""],
    });
  });

  it("breaks become \\n gap chars", () => {
    expect(
      parse(glyph("toki") + "\n" + glyph("pona"))
    ).toEqual({
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "word", word: "pona" },
      ],
      gaps: ["", "\n", ""],
    });
  });

  it("empty input yields a zero-anchor parse", () => {
    expect(parse("")).toEqual({
      anchors: [],
      gaps: [""],
    });
    expect(parse(" \n ")).toEqual({
      anchors: [],
      gaps: [" \n "],
    });
  });
});

describe("parseSp — facet folding", () => {
  it("folds variation selectors onto the " +
     "preceding word", () => {
    const text =
      glyph("kili") +
      String.fromCodePoint(
        variationIndexToSelector(2)
      );
    expect(parse(text).anchors).toEqual([
      { kind: "word", word: "kili", variation: 2 },
    ]);
  });

  it("folds arrows into a preceding bare ni; " +
     "standalone arrows stay gap chars", () => {
    const dir = niDirectionByIndex(6)!;
    expect(
      parse(glyph("ni") + dir.arrow)
    ).toEqual({
      anchors: [
        { kind: "word", word: "ni",
          niDirection: 6 },
      ],
      gaps: ["", ""],
    });
    expect(
      parse(glyph("toki") + dir.arrow)
    ).toEqual({
      anchors: [{ kind: "word", word: "toki" }],
      gaps: ["", dir.arrow],
    });
  });

  it("folds legacy ni+ZWJ+arrow; keeps a real " +
     "ZWJ as a gap char", () => {
    const dir = niDirectionByIndex(3)!;
    expect(
      parse(glyph("ni") + ZWJ_CH + dir.arrow)
        .anchors
    ).toEqual([
      { kind: "word", word: "ni",
        niDirection: 3 },
    ]);
    expect(
      parse(
        glyph("toki") + ZWJ_CH + glyph("pona")
      ).gaps
    ).toEqual(["", ZWJ_CH, ""]);
  });

  it("standard ni-direction codepoints become ni " +
     "anchors with the facet", () => {
    expect(parse("\u{F1989}").anchors).toEqual([
      { kind: "word", word: "ni",
        niDirection: 1 },
    ]);
  });

  it("gap content between word and arrow blocks " +
     "the fold", () => {
    const dir = niDirectionByIndex(2)!;
    expect(
      parse(glyph("ni") + " " + dir.arrow)
    ).toEqual({
      anchors: [{ kind: "word", word: "ni" }],
      gaps: ["", " " + dir.arrow],
    });
  });
});

describe("parseSp — naming chars and " +
         "cartouche depth", () => {
  it("folds naming chars onto the preceding word " +
     "inside a cartouche (depth from literal " +
     "chars)", () => {
    const text =
      CARTOUCHE_START + glyph("nena") +
      MIDDLE_DOT_CH + MIDDLE_DOT_CH + CART_EXT +
      glyph("kili") + TALLY_CH + CARTOUCHE_END;
    expect(parse(text)).toEqual({
      anchors: [
        { kind: "word", word: "nena",
          nameScheme: { style: "morae",
            count: 2 } },
        { kind: "word", word: "kili",
          nameScheme: { style: "letters",
            count: 1 } },
      ],
      gaps: [CARTOUCHE_START, CART_EXT,
        CARTOUCHE_END],
    });
  });

  it("colon inside a cartouche sets the word " +
     "scheme", () => {
    const text =
      CARTOUCHE_START + glyph("nena") + COLON_CH +
      CARTOUCHE_END;
    expect(parse(text).anchors).toEqual([
      { kind: "word", word: "nena",
        nameScheme: { style: "word" } },
    ]);
  });

  // SCHEME FOLD RULE: a naming char folds only when
  // the facet can RE-RENDER exactly what it
  // absorbed. A nameScheme is one style with a
  // count, so a style change cannot be absorbed — an
  // earlier implementation overwrote the facet and
  // silently ate the chars already folded ("[jan.,"
  // reloaded as "[jan,", "[toki::" as "[toki:"). The
  // unfoldable char is ordinary gap content instead,
  // byte-preserved.
  it("a naming char of a DIFFERENT style does not " +
     "overwrite the scheme: it stays gap content", () => {
    const text =
      CARTOUCHE_START + glyph("nena") +
      MIDDLE_DOT_CH + TALLY_CH + CARTOUCHE_END;
    expect(parse(text)).toEqual({
      anchors: [
        { kind: "word", word: "nena",
          nameScheme: { style: "morae",
            count: 1 } },
      ],
      gaps: [
        CARTOUCHE_START,
        TALLY_CH + CARTOUCHE_END,
      ],
    });
  });

  it("a second colon stays gap content too " +
     "({style:'word'} renders exactly one)", () => {
    const text =
      CARTOUCHE_START + glyph("nena") + COLON_CH +
      COLON_CH + CARTOUCHE_END;
    expect(parse(text)).toEqual({
      anchors: [
        { kind: "word", word: "nena",
          nameScheme: { style: "word" } },
      ],
      gaps: [
        CARTOUCHE_START,
        COLON_CH + CARTOUCHE_END,
      ],
    });
  });

  it("outside cartouches the same chars are " +
     "ordinary gap content", () => {
    expect(
      parse(glyph("nena") + MIDDLE_DOT_CH)
    ).toEqual({
      anchors: [{ kind: "word", word: "nena" }],
      gaps: ["", MIDDLE_DOT_CH],
    });
  });

  it("unmatched markers are transitional gap " +
     "chars", () => {
    expect(
      parse(CARTOUCHE_START + glyph("toki"))
    ).toEqual({
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [CARTOUCHE_START, ""],
    });
  });
});

describe("parseSp — round trip with renderSp", () => {
  it("re-parses a rendered block (transitional " +
     "markers as gap chars; span promotion is " +
     "normalize's job)", () => {
    const block: Block = {
      anchors: [
        { kind: "word", word: "nena",
          nameScheme: { style: "morae",
            count: 2 } },
        { kind: "word", word: "kili" },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: CART_EXT, latin: "" },
        { sp: " ", latin: "" },
      ],
      spans: [
        cart(0, 1),
      ],
    };
    expect(
      parseSp(renderSp(block).inlines)
    ).toEqual({
      anchors: block.anchors,
      gaps: [CARTOUCHE_START, CART_EXT,
        CARTOUCHE_END + " "],
    });
  });
});
