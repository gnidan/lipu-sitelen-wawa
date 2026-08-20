import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NameAtom } from "./name-atom";
import {
  latinBlockContent,
  latinDocContent,
  paragraphLatinInlines,
} from "./latin-doc";
import {
  canonicalSegments,
} from "../../../test/edit-corpus";
import { arbBlock } from
  "../../../test/lipu-arbitraries";
import { renderLatin } from "../../lipu";
import type { Block, Lipu } from "../../lipu";

function mkLatinEditor(lipu: Lipu): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({
        history: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        heading: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      NameAtom,
    ],
    content: latinDocContent(lipu),
  });
}

/**
 * The expected PM content size, read off the SOURCE
 * MAP — never recomputed from the inline stream.
 * That distinction is the whole point of the pin
 * below: the invariant is "source-map/BlockPos
 * offsets ===
 * Latin PM content offsets", so the expectation has
 * to come from the coordinate system the rest of
 * the system navigates by. Recomputing it from the
 * stream with atom = 1 hardcoded HERE would only
 * prove "PM size === stream length" and would stay
 * green if renderLatin's own offset arithmetic
 * drifted (e.g. `pos += 2` for an atom).
 */
function mapLength(block: Block): number {
  return renderLatin(block).map.reduce(
    (m, e) => Math.max(m, e.to),
    0
  );
}

describe("latin doc builders", () => {
  it("COORDINATE INVARIANT (pinned): PM " +
     "content size === renderLatin map length " +
     "(atom = 1, hardBreak = 1) for arbitrary " +
     "blocks", () => {
    fc.assert(
      fc.property(arbBlock, (b) => {
        const ed = mkLatinEditor({
          version: 2,
          blocks: [b],
        });
        const size =
          ed.state.doc.child(0).content.size;
        ed.destroy();
        return size === mapLength(b);
      }),
      { numRuns: 200 }
    );
  });

  it("round trip: paragraphLatinInlines of the " +
     "built doc canonicalizes to the same " +
     "segments as renderLatin's stream (the " +
     "oracle-6 comparison)", () => {
    fc.assert(
      fc.property(arbBlock, (b) => {
        const ed = mkLatinEditor({
          version: 2,
          blocks: [b],
        });
        const got = canonicalSegments(
          paragraphLatinInlines(
            ed.state.doc.child(0)
          )
        );
        ed.destroy();
        const want = canonicalSegments(
          renderLatin(b).inlines
        );
        return (
          JSON.stringify(got) ===
          JSON.stringify(want)
        );
      }),
      { numRuns: 200 }
    );
  });

  it("gap.latin \\n builds a hardBreak; name " +
     "spans build atoms carrying the opaque " +
     "payload", () => {
    const block: Block = {
      anchors: [
        { kind: "word", word: "toki" },
        {
          kind: "word",
          word: "pona",
          nameScheme: { style: "word" },
        },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: " \n" },
        { sp: "", latin: "" },
      ],
      spans: [
        {
          from: 1,
          to: 1,
          kind: "cartouche",
          side: "both",
        },
      ],
    };
    const content = latinBlockContent(block);
    expect(content).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "toki " },
        { type: "hardBreak" },
        {
          type: "latinName",
          attrs: {
            anchors: [
              {
                kind: "word",
                word: "pona",
                nameScheme: { style: "word" },
              },
            ],
            interiorLatin: [],
            text: "Pona",
          },
        },
      ],
    });
  });

  it("a NAMELESS cartouche does not atomize: " +
     "its covered content builds ordinary " +
     "text, no latinName node", () => {
    const block: Block = {
      anchors: [
        { kind: "verbatim", text: "-", marked: true },
      ],
      gaps: [
        { sp: "", latin: "a " },
        { sp: "", latin: "" },
      ],
      spans: [
        {
          from: 0,
          to: 0,
          kind: "cartouche",
          side: "both",
        },
      ],
    };
    expect(latinBlockContent(block)).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "a -" }],
    });
  });

  it("a zero-content block builds an empty " +
     "paragraph (no empty text node)", () => {
    expect(
      latinBlockContent({
        anchors: [],
        gaps: [{ sp: "\u{F1990}", latin: "" }],
        spans: [],
      })
    ).toEqual({ type: "paragraph" });
  });

  it("latinDocContent maps blocks to paragraphs " +
     "one-to-one", () => {
    const lipu: Lipu = {
      version: 2,
      blocks: [
        {
          anchors: [{ kind: "word", word: "toki" }],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
        {
          anchors: [{ kind: "word", word: "pona" }],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    };
    expect(latinDocContent(lipu)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "toki" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "pona" }],
        },
      ],
    });
  });
});
