import { describe, it, expect } from "vitest";
import {
  atomizedAnchors,
  nameAtoms,
  renderLatin,
  wordLatin,
  nameText,
} from "./render-latin";
import { CART_EXT } from "./chars";
import type { Block } from "./types";
import { gap, word, cart, span } from
  "../../test/helpers";

describe("renderLatin — stored content only", () => {
  it("concatenates gap.latin and anchor text " +
     "with no synthesis", () => {
    const block: Block = {
      anchors: [word("toki"), word("pona")],
      gaps: [gap(), gap("", ", "), gap("", "!")],
      spans: [],
    };
    expect(renderLatin(block).text)
      .toBe("toki, pona!");
  });

  it("renders adjacent anchors fused when the " +
     "gap.latin is empty", () => {
    const block: Block = {
      anchors: [word("toki"), word("pona")],
      gaps: [gap(), gap(" "), gap()],
      spans: [],
    };
    // gap.sp " " is SP-side content; latin is ""
    expect(renderLatin(block).text)
      .toBe("tokipona");
  });

  it("applies the case facet; renders verbatim " +
     "text literally", () => {
    const block: Block = {
      anchors: [
        { kind: "word", word: "toki",
          case: "capital" },
        { kind: "verbatim", text: "don't" },
      ],
      gaps: [gap(), gap("", " "), gap()],
      spans: [],
    };
    expect(renderLatin(block).text)
      .toBe("Toki don't");
    expect(
      wordLatin({ kind: "word", word: "toki",
        case: "capital" })
    ).toBe("Toki");
  });

  it("renders latin newlines from gap content", () => {
    const block: Block = {
      anchors: [word("toki"), word("pona")],
      gaps: [gap(), gap("\n", ". \n"), gap()],
      spans: [],
    };
    expect(renderLatin(block).text)
      .toBe("toki. \npona");
  });

  it("zero-anchor blocks emit their gap " +
     "content", () => {
    const block: Block = {
      anchors: [],
      gaps: [gap("", "hello\n")],
      spans: [],
    };
    expect(renderLatin(block).text)
      .toBe("hello\n");
  });
});

describe("renderLatin — name atoms", () => {
  const cartBlock: Block = {
    anchors: [
      { kind: "word", word: "nena",
        nameScheme: { style: "morae",
          count: 2 } },
      { kind: "word", word: "kili",
        nameScheme: { style: "letters",
          count: 1 } },
    ],
    gaps: [
      gap("", "prefix "),
      gap(CART_EXT, "hidden"),
      gap("", " suffix"),
    ],
    spans: [
      cart(0, 1),
    ],
  };

  it("derives the atom text from nameScheme " +
     "facets", () => {
    const r = renderLatin(cartBlock);
    expect(r.inlines).toEqual([
      { type: "text", text: "prefix " },
      {
        type: "name",
        anchors: cartBlock.anchors,
        interiorLatin: ["hidden"],
        text: "Nenak",
      },
      { type: "text", text: " suffix" },
    ]);
  });

  it("latinSpelling overrides the derived " +
     "text", () => {
    const b: Block = {
      ...cartBlock,
      spans: [
        cart(0, 1, { attrs: { latinSpelling: "Nenakili" } }),
      ],
    };
    const atom = renderLatin(b).inlines[1];
    expect(atom.type).toBe("name");
    if (atom.type === "name") {
      expect(atom.text).toBe("Nenakili");
    }
  });

  it("word scheme spells the word; no scheme " +
     "takes the first letter", () => {
    expect(
      nameText([
        { kind: "word", word: "nena",
          nameScheme: { style: "word" } },
        { kind: "word", word: "kili" },
      ])
    ).toBe("Nenak");
  });

  it("counts one position; covered anchors and " +
     "interior gaps share the atom's map " +
     "range", () => {
    const r = renderLatin(cartBlock);
    expect(r.map).toEqual([
      { ref: { seg: "gap", index: 0 },
        from: 0, to: 7 },
      { ref: { seg: "anchor", index: 0 },
        from: 7, to: 8 },
      { ref: { seg: "gap", index: 1 },
        from: 7, to: 8 },
      { ref: { seg: "anchor", index: 1 },
        from: 7, to: 8 },
      { ref: { seg: "gap", index: 2 },
        from: 8, to: 15 },
    ]);
  });

  it("only the outermost cartouche forms the " +
     "atom", () => {
    const b: Block = {
      anchors: [word("nena"), word("kili")],
      gaps: [gap(), gap(), gap()],
      spans: [
        cart(0, 1),
        cart(1, 1),
      ],
    };
    const inlines = renderLatin(b).inlines;
    expect(inlines).toHaveLength(1);
    expect(inlines[0].type).toBe("name");
  });

  it("a NAMELESS cartouche does not atomize: its " +
     "covered content projects the ordinary way", () => {
    // nameText draws on WORD anchors only, so a
    // cartouche over verbatims alone renders "".
    const b: Block = {
      anchors: [
        { kind: "verbatim", text: "-", marked: true },
      ],
      gaps: [gap("", "a "), gap()],
      spans: [
        cart(0, 0),
      ],
    };
    const r = renderLatin(b);
    expect(r.inlines).toEqual([
      { type: "text", text: "a -" },
    ]);
    expect(r.map).toEqual([
      { ref: { seg: "gap", index: 0 },
        from: 0, to: 2 },
      { ref: { seg: "anchor", index: 0 },
        from: 2, to: 3 },
    ]);
    expect(atomizedAnchors(b).size).toBe(0);
  });

  it("an explicitly EMPTY latinSpelling is " +
     "nameless too", () => {
    const b: Block = {
      ...cartBlock,
      spans: [
        cart(0, 1, { attrs: { latinSpelling: "" } }),
      ],
    };
    expect(renderLatin(b).text)
      .toBe("prefix nenahiddenkili suffix");
    expect(nameAtoms(b)).toEqual([]);
  });

  it("a NAMED cartouche nested inside a nameless " +
     "one still atomizes", () => {
    const b: Block = {
      anchors: [
        { kind: "verbatim", text: "-", marked: true },
        word("nena"),
      ],
      gaps: [gap(), gap(CART_EXT), gap()],
      spans: [
        // outer covers both; its name is "N", so
        // pick a latinSpelling "" to make it
        // nameless without touching the inner one
        cart(0, 1, { attrs: { latinSpelling: "" } }),
        cart(1, 1),
      ],
    };
    const r = renderLatin(b);
    expect(r.inlines).toEqual([
      { type: "text", text: "-" },
      {
        type: "name",
        anchors: [word("nena")],
        interiorLatin: [],
        text: "N",
      },
    ]);
    expect([...atomizedAnchors(b)]).toEqual([1]);
  });

  it("long spans have no Latin form", () => {
    const b: Block = {
      anchors: [word("toki"), word("pona")],
      gaps: [gap(), gap("", " "), gap()],
      spans: [
        span("long", 0, 1),
      ],
    };
    expect(renderLatin(b).text).toBe("toki pona");
  });
});

describe("renderLatin — marks and map", () => {
  it("emits anchor-granular formatting marks", () => {
    const b: Block = {
      anchors: [
        word("toki"), word("pona"), word("mute"),
      ],
      gaps: [
        gap(), gap("", ", "), gap("", " "),
        gap(),
      ],
      spans: [
        span("bold", 1, 2),
      ],
    };
    // "toki, pona mute": pona starts at 6,
    // mute ends at 15
    expect(renderLatin(b).marks).toEqual([
      { kind: "bold", from: 6, to: 15 },
    ]);
  });

  it("gap entries: zero-width only for " +
     "side-absent content", () => {
    const b: Block = {
      anchors: [word("toki")],
      gaps: [gap(" ", ""), gap("", "")],
      spans: [],
    };
    expect(renderLatin(b).map).toEqual([
      { ref: { seg: "gap", index: 0 },
        from: 0, to: 0 },
      { ref: { seg: "anchor", index: 0 },
        from: 0, to: 4 },
    ]);
  });
});
