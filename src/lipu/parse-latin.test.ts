import { describe, it, expect } from "vitest";
import {
  parseLatin,
  latinInlinesFromText,
  tokenizeLatin,
  splitRun,
} from "./parse-latin";
import { renderLatin } from "./render-latin";
import { CARTOUCHE_START } from "./chars";
import {
  codepointToChar,
  wordToCodepoint,
} from "../data";
import type { Block, LatinInline } from "./types";
import { cart } from "../../test/helpers";

function parse(text: string) {
  return parseLatin(latinInlinesFromText(text));
}

describe("parseLatin — boundary rule", () => {
  it("words become word anchors with case; " +
     "whitespace is literal gap content", () => {
    expect(parse("Toki  pona")).toEqual({
      anchors: [
        { kind: "word", word: "toki",
          case: "capital" },
        { kind: "word", word: "pona" },
      ],
      gaps: ["", "  ", ""],
    });
  });

  it("a single space is stored too — nothing is " +
     "treated as synthesized", () => {
    expect(parse("toki pona").gaps)
      .toEqual(["", " ", ""]);
  });

  it("\"don't\" is ONE verbatim anchor " +
     "(interior apostrophe)", () => {
    expect(parse("don't")).toEqual({
      anchors: [
        { kind: "verbatim", text: "don't",
          marked: true },
      ],
      gaps: ["", ""],
    });
  });

  it("curly apostrophes count; edge apostrophes " +
     "do not", () => {
    expect(
      parse("don’t").anchors[0]
    ).toEqual({
      kind: "verbatim",
      text: "don’t",
      marked: true,
    });
    expect(parse("'toki'")).toEqual({
      anchors: [{ kind: "word", word: "toki" }],
      gaps: ["'", "'"],
    });
  });

  it("\"café\" parses whole (Unicode " +
     "letters)", () => {
    expect(parse("café").anchors).toEqual([
      { kind: "verbatim", text: "café",
        marked: true },
    ]);
  });

  it("a word-internal-punctuation run binds to ONE " +
     "verbatim token instead of decomposing (e.g. " +
     "a URL)", () => {
    expect(
      parse("lipu.example.com/toki?x=42")
    ).toEqual({
      anchors: [
        {
          kind: "verbatim",
          text: "lipu.example.com/toki?x=42",
          marked: true,
        },
      ],
      gaps: ["", ""],
    });
  });

  it("digit-adjacent letters split at the digit " +
     "boundary", () => {
    expect(parse("toki42")).toEqual({
      anchors: [{ kind: "word", word: "toki" }],
      gaps: ["", "42"],
    });
  });

  it("newlines are gap content", () => {
    expect(parse("toki. \npona").gaps)
      .toEqual(["", ". \n", ""]);
  });

  it("empty and letterless inputs are " +
     "zero-anchor parses", () => {
    expect(parse("")).toEqual({
      anchors: [],
      gaps: [""],
    });
    expect(parse("... 42!")).toEqual({
      anchors: [],
      gaps: ["... 42!"],
    });
  });
});

describe("parseLatin — name atoms", () => {
  it("passes atoms through opaquely with " +
     "interior gaps", () => {
    const inlines: LatinInline[] = [
      { type: "text", text: "x " },
      {
        type: "name",
        anchors: [
          { kind: "word", word: "nena",
            nameScheme: { style: "word" } },
          { kind: "word", word: "kili" },
        ],
        interiorLatin: ["hidden"],
        text: "Nenak",
      },
      { type: "text", text: " b" },
    ];
    expect(parseLatin(inlines)).toEqual({
      anchors: [
        { kind: "verbatim", text: "x",
          marked: true },
        { kind: "word", word: "nena",
          nameScheme: { style: "word" } },
        { kind: "word", word: "kili" },
        { kind: "verbatim", text: "b",
          marked: true },
      ],
      gaps: ["", " ", "hidden", " ", ""],
    });
  });

  it("a name atom is a hard boundary — adjacent " +
     "punct-bearing text does NOT bind across it " +
     "into one verbatim", () => {
    // "toki." directly touches the atom (no space):
    // if a future refactor concatenated inline text
    // before tokenizing, the dot would become
    // INTERIOR punct across the whole run and swallow
    // the atom into one "bound" token. It must stay
    // three separate pieces instead — the atom passes
    // through opaquely (parse-latin.ts's per-inline
    // loop never reaches `tokenizeLatin` for a "name"
    // inline at all).
    const inlines: LatinInline[] = [
      { type: "text", text: "toki." },
      {
        type: "name",
        anchors: [
          { kind: "word", word: "nena",
            nameScheme: { style: "word" } },
          { kind: "word", word: "kili" },
        ],
        interiorLatin: ["hidden"],
        text: "Nenak",
      },
      { type: "text", text: "pona" },
    ];
    expect(parseLatin(inlines)).toEqual({
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "word", word: "nena",
          nameScheme: { style: "word" } },
        { kind: "word", word: "kili" },
        { kind: "word", word: "pona" },
      ],
      gaps: ["", ".", "hidden", "", ""],
    });
  });

  it("round-trips renderLatin's atoms", () => {
    const block: Block = {
      anchors: [
        { kind: "word", word: "nena",
          nameScheme: { style: "morae",
            count: 2 } },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [
        cart(0, 0),
      ],
    };
    expect(
      parseLatin(renderLatin(block).inlines)
    ).toEqual({
      anchors: block.anchors,
      gaps: ["", ""],
    });
  });

  it("combining marks continue a letter run: " +
     "NFD 'cafe' is ONE verbatim anchor holding " +
     "the ORIGINAL NFD bytes", () => {
    const nfd = "cafe\u0301";
    expect(nfd).toHaveLength(5);
    const out = parseLatin([
      { type: "text", text: nfd },
    ]);
    expect(out).toEqual({
      anchors: [
        { kind: "verbatim", text: nfd,
          marked: true },
      ],
      gaps: ["", ""],
    });
    // no normalization: the stored bytes are the
    // author's, not a rewritten NFC form
    expect(out.anchors[0].text).not.toBe(
      nfd.normalize("NFC")
    );
  });

  it("a run cannot START with a combining mark", () => {
    expect(
      parseLatin([
        { type: "text", text: "\u0301ab" },
      ]).gaps[0]
    ).toBe("\u0301");
  });
});

describe("tokenizeLatin", () => {
  it("interior punctuation binds the whole run " +
     "instead of splitting at non-letters", () => {
    expect(
      tokenizeLatin("x-b").map((t) => t.type)
    ).toEqual(["bound"]);
  });

  it("rejects apostrophes without letters on " +
     "both sides", () => {
    expect(
      tokenizeLatin("x'' b").map((t) => t.type)
    ).toEqual([
      "alpha", "other", "other", "other",
      "alpha",
    ]);
  });
});

describe("tokenizeLatin — trim-first binding " +
         "predicate", () => {
  const toks = (
    t: string
  ): Array<[string, string]> =>
    tokenizeLatin(t).map((x) => [x.type, x.value]);

  const TABLE: Array<
    [string, Array<[string, string]>]
  > = [
    ["https://x", [["bound", "https://x"]]],
    ["3:30", [["bound", "3:30"]]],
    ["toki.pona", [["bound", "toki.pona"]]],
    // FONT COLLISION: this repo's active font remaps
    // COMBINING_TALLY_MARK's codepoint onto ASCII ","
    // (0x2C), so isControlChar(0x2C) is true and ","
    // is a hard boundary under isHardBoundary here —
    // "toki,pona" splits rather than binding, unlike
    // a font config where comma is plain punctuation.
    // isHardBoundary itself is unchanged and correct
    // relative to isControlChar's contract; this is a
    // property of the active font, not a bug.
    ["toki,pona", [
      ["word", "toki"], ["other", ","],
      ["word", "pona"],
    ]],
    // "e.g.": the trailing dot is boundary material —
    // the "e.g" token binds, the dot stays gap
    ["e.g.", [["bound", "e.g"], ["other", "."]]],
    // quoted prose does NOT bind: trim strips
    // closers/enders, cores have no interior punct
    ['"toki!"', [
      ["other", '"'], ["word", "toki"],
      ["other", "!"], ["other", '"'],
    ]],
    ["pona.)", [
      ["word", "pona"],
      ["other", "."], ["other", ")"],
    ]],
    ['toki!"', [
      ["word", "toki"],
      ["other", "!"], ["other", '"'],
    ]],
    // digits ride, never trigger; plain numbers
    // stay invisible gap bytes
    ["330", [
      ["other", "3"], ["other", "3"],
      ["other", "0"],
    ]],
    // interior apostrophe is LETTERISH — unchanged
    ["don't", [["alpha", "don't"]]],
    // all-punct runs trim to an EMPTY core
    ["...", [
      ["other", "."], ["other", "."],
      ["other", "."],
    ]],
    [":", [["other", ":"]]],
    // no bind: a trailing colon-slash without a
    // second slash never triggers whole-run binding
    ["https:/", [
      ["alpha", "https"],
      ["other", ":"], ["other", "/"],
    ]],
    ["x-b", [["bound", "x-b"]]],
    ["x'' b", [
      ["alpha", "x"], ["other", "'"],
      ["other", "'"], ["other", " "],
      ["alpha", "b"],
    ]],
  ];
  for (const [input, want] of TABLE) {
    it(JSON.stringify(input), () => {
      expect(toks(input)).toEqual(want);
    });
  }

  it("UCSUR word chars are hard boundaries — " +
     "a glued glyph never binds", () => {
    const g = codepointToChar(
      wordToCodepoint["toki"]
    );
    expect(toks("toki" + g + "pona")).toEqual([
      ["word", "toki"],
      ["other", g],
      ["word", "pona"],
    ]);
  });

  it("structural marker chars are hard " +
     "boundaries; the run beyond one still " +
     "binds", () => {
    expect(
      toks("nimi" + CARTOUCHE_START + "x:y")
    ).toEqual([
      ["word", "nimi"],
      ["other", CARTOUCHE_START],
      ["bound", "x:y"],
    ]);
  });

  it("ASCII lookalikes are PUNCT, not boundaries " +
     "(only UCSUR/control codepoints are SP " +
     "content)", () => {
    expect(toks("nimi[x")).toEqual([
      ["bound", "nimi[x"],
    ]);
  });

  it("splitRun exposes the trim decomposition", () => {
    expect(splitRun('"toki!"')).toEqual({
      leading: '"',
      core: "toki",
      trailing: '!"',
      binds: false,
    });
    expect(splitRun("e.g.")).toEqual({
      leading: "",
      core: "e.g",
      trailing: ".",
      binds: true,
    });
  });
});
