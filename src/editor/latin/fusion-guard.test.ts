import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  deadSeamOffsets,
  injectFusionSpaces,
} from "./fusion-guard";
import type { LatinInline } from "../../lipu";

describe("injectFusionSpaces", () => {
  it("injects a single space between two LETTER " +
     "flanks at a dead seam", () => {
    const inlines: LatinInline[] = [
      { type: "text", text: "tokimi" },
    ];
    expect(
      injectFusionSpaces(inlines, [4])
    ).toEqual([
      { type: "text", text: "toki mi" },
    ]);
  });

  it("no injection when either flank is not a " +
     "letter run", () => {
    const inlines: LatinInline[] = [
      { type: "text", text: "toki,mi" },
    ];
    expect(
      injectFusionSpaces(inlines, [5])
    ).toEqual(inlines);
  });

  it("CHIP EXEMPTION: a name-atom flank blocks " +
     "the injection (a text-level predicate " +
     "would inject the LAW-A counterexample " +
     "space)", () => {
    const inlines: LatinInline[] = [
      {
        type: "name",
        anchors: [
          { kind: "word", word: "toki" },
        ],
        interiorLatin: [],
        text: "Toki",
      },
      { type: "text", text: "mi" },
    ];
    expect(
      injectFusionSpaces(inlines, [1])
    ).toEqual(inlines);
  });

  it("marks continue a run: a mark-ending left " +
     "flank fuses and gets the space", () => {
    const inlines: LatinInline[] = [
      { type: "text", text: "mi\u0301la" },
    ];
    expect(
      injectFusionSpaces(inlines, [3])
    ).toEqual([
      { type: "text", text: "mi\u0301 la" },
    ]);
  });

  it("multiple seams inject in DESCENDING order " +
     "so earlier offsets stay valid", () => {
    const inlines: LatinInline[] = [
      { type: "text", text: "abcd" },
    ];
    expect(
      injectFusionSpaces(inlines, [1, 3])
    ).toEqual([
      { type: "text", text: "a bc d" },
    ]);
  });

  it("out-of-range and edge offsets are ignored " +
     "(no leading/trailing space can appear)", () => {
    const inlines: LatinInline[] = [
      { type: "text", text: "toki" },
    ];
    expect(
      injectFusionSpaces(inlines, [0, 4, 99, -3])
    ).toEqual(inlines);
  });

  it("counts UTF-16 units, not code points: a " +
     "seam AFTER an astral char injects there " +
     "(map coordinates)", () => {
    // U+1F600 is 2 UTF-16 units; the map offset of
    // the following "a" is 2.
    const inlines: LatinInline[] = [
      { type: "text", text: "\u{1F600}ab" },
    ];
    // seam between "a" and "b" is offset 3
    expect(
      injectFusionSpaces(inlines, [3])
    ).toEqual([
      { type: "text", text: "\u{1F600}a b" },
    ]);
  });
});

/** A bare PM editor: deadSeamOffsets only reads a
 *  transaction's mapping and the two docs, so it
 *  needs no lipu machinery. */
function mkDoc(paras: string[]): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ history: false }),
    ],
    content: {
      type: "doc",
      content: paras.map((t) => ({
        type: "paragraph",
        content: t
          ? [{ type: "text", text: t }]
          : undefined,
      })),
    },
  });
}

describe("deadSeamOffsets", () => {
  it("a paragraph JOIN reports the seam in the " +
     "surviving paragraph's content offsets", () => {
    const ed = mkDoc(["toki", "mi"]);
    const old = ed.state.doc;
    const boundary = old.child(0).nodeSize;
    const tr = ed.state.tr.delete(
      boundary - 1,
      boundary + 1
    );
    expect(
      deadSeamOffsets(tr, old, tr.doc)
    ).toEqual(new Map([[0, [4]]]));
    ed.destroy();
  });

  it("a boundary that SURVIVES reports nothing " +
     "(ordinary typing is not a seam)", () => {
    const ed = mkDoc(["toki", "mi"]);
    const old = ed.state.doc;
    const tr = ed.state.tr.insertText("s", 5);
    expect(
      deadSeamOffsets(tr, old, tr.doc).size
    ).toBe(0);
    ed.destroy();
  });

  it("an EQUAL-COUNT reshape still reports the " +
     "dead boundary (the trigger is boundary " +
     "death, not a paragraph-count decrease)", () => {
    const ed = mkDoc(["ab", "cd", "ef"]);
    const old = ed.state.doc;
    // delete across the FIRST boundary and split
    // inside the last paragraph: count stays 3,
    // yet boundary 1 died.
    const tr = ed.state.tr;
    tr.delete(3, 5); // join paragraphs 0 and 1
    tr.split(tr.mapping.map(9)); // re-split later
    const seams = deadSeamOffsets(tr, old, tr.doc);
    expect(tr.doc.childCount).toBe(3);
    expect(seams.get(0)).toEqual([2]);
    ed.destroy();
  });
});
