import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from "./extensions/sitelen-pona";
import { Verbatim } from "./extensions/verbatim";
import { LipuModel } from "./extensions/lipu-model";
import { asciiToUcsurControl } from "../data";
import {
  contentToLipu,
  docToLipu,
  blockInlines,
  lipuToContent,
  loadNormalizeLipu,
} from "./lipu-doc";
import type { Lipu } from "../lipu";
import { MIDDLE_DOT_CH } from "../lipu/chars";
import { cart, glyph } from "../../test/helpers";

/** the effective control char for an ASCII shortcut
 *  (the same table src/lipu/chars.ts reads) */
function markerChar(name: string): string {
  const ascii: Record<string, string> = {
    "cartouche-start": "[",
    "cartouche-end": "]",
    "cart-ext": "=",
  };
  const c = asciiToUcsurControl(ascii[name]);
  if (c === undefined) throw new Error(name);
  return c;
}

function createEditor(content?: JSONContent | string) {
  return new Editor({
    extensions: [StarterKit, SitelenPona, Verbatim],
    content,
  });
}

/**
 * Mirrors the extension order Editor.tsx uses for
 * the load path: LipuModel first, then the same
 * base extensions.
 */
function createEditorFromLipu(lipu: Lipu) {
  return new Editor({
    extensions: [LipuModel, StarterKit, SitelenPona, Verbatim],
    content: lipuToContent(lipu),
  });
}

const fixture: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: glyph("toki") + " " + glyph("pona"),
        },
        {
          type: "text",
          text: "hi x",
          marks: [{ type: "verbatim" }],
        },
        { type: "hardBreak" },
        { type: "text", text: "tail" },
      ],
    },
  ],
};

describe("contentToLipu / lipuToContent", () => {
  it(
    "round-trips glyphs, spaces, verbatim marks, " +
      "and hard breaks byte-for-byte",
    () => {
      const editor = createEditor(fixture);
      const expected = editor.getJSON();
      editor.destroy();

      const lipu = contentToLipu(fixture);
      expect(JSON.stringify(lipuToContent(lipu))).toBe(
        JSON.stringify(expected)
      );
    }
  );

  it(
    "maps undefined/new-doc content to the empty " +
      "lipu and one empty paragraph",
    () => {
      const lipu = contentToLipu(undefined);
      expect(lipu).toEqual({
        version: 2,
        blocks: [
          {
            anchors: [],
            gaps: [{ sp: "", latin: "" }],
            spans: [],
          },
        ],
      });
      expect(lipuToContent(lipu)).toEqual({
        type: "doc",
        content: [{ type: "paragraph" }],
      });
    }
  );

  it(
    "folds legacy standard ni codepoints on load " +
      "(enumerated canonicalization)",
    () => {
      const legacy: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: String.fromCodePoint(0xf1989),
              },
            ],
          },
        ],
      };
      const lipu = contentToLipu(legacy);
      // In the model: one word anchor, two empty
      // gaps (a
      // Block's gaps are always anchors + 1)
      expect(lipu.blocks[0]).toEqual({
        anchors: [
          { kind: "word", word: "ni", niDirection: 1 },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: "", latin: "" },
        ],
        spans: [],
      });
      // re-render is ni + left arrow, not F1989
      const out = lipuToContent(lipu);
      expect(out.content?.[0].content?.[0].text).toBe(
        glyph("ni") + "←"
      );
    }
  );

  it(
    "joins adjacent same-mark text nodes on load " +
      "(enumerated load-time canonicalization, like " +
      "the legacy-ni fold — this is not a claim " +
      "that lipuToContent byte-matches getJSON() " +
      "for arbitrary stored JSON, only for " +
      "editor-produced content)",
    () => {
      const split: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              // unmarked adjacent pair
              { type: "text", text: "foo" },
              { type: "text", text: "bar" },
              // same-mark adjacent pair
              {
                type: "text",
                text: "hi ",
                marks: [{ type: "verbatim" }],
              },
              {
                type: "text",
                text: "there",
                marks: [{ type: "verbatim" }],
              },
            ],
          },
        ],
      };
      const lipu = contentToLipu(split);
      // parseSp itself keeps them as separate
      // anchors (one per source inline) — the join
      // happens on the render side, in renderSp.
      expect(lipu.blocks[0].anchors).toEqual([
        { kind: "verbatim", text: "foo" },
        { kind: "verbatim", text: "bar" },
        { kind: "verbatim", text: "hi ", marked: true },
        { kind: "verbatim", text: "there", marked: true },
      ]);
      // Separation default, latin side only (SP
      // bytes unmoved): the gaps between anchors that
      // would FUSE into one Latin letter run get " ".
      // "foo"|"bar" and "bar"|"hi " do; "hi " already
      // ends with a space, so the last gap does not.
      expect(lipu.blocks[0].gaps).toEqual([
        { sp: "", latin: "" },
        { sp: "", latin: " " },
        { sp: "", latin: " " },
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ]);

      const out = lipuToContent(lipu);
      // but the re-rendered content joins same-mark
      // runs into single text nodes: 2 nodes, not 4
      expect(out.content?.[0].content).toEqual([
        { type: "text", text: "foobar" },
        {
          type: "text",
          marks: [{ type: "verbatim" }],
          text: "hi there",
        },
      ]);
    }
  );
});

describe("docToLipu / blockInlines", () => {
  it(
    "agrees with contentToLipu for the same " +
      "content loaded into a real editor",
    () => {
      const editor = createEditor(fixture);
      const fromDoc = docToLipu(editor.state.doc);
      editor.destroy();

      const fromContent = contentToLipu(fixture);
      expect(fromDoc).toEqual(fromContent);
    }
  );

  it(
    "stays byte-matched with getJSON() after live " +
      "editing splits and re-marks a run (confirms " +
      "live sessions can't produce the split shape " +
      "the load-time join canonicalizes away)",
    () => {
      const joined = lipuToContent(
        contentToLipu({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "hi there",
                  marks: [{ type: "verbatim" }],
                },
              ],
            },
          ],
        })
      );

      const editor = createEditor(joined);
      // select "there" (chars 3..8 of "hi there",
      // i.e. doc positions 4..9), remove the
      // verbatim mark, then re-add it — this forces
      // PM to split the text node into pieces and
      // then re-merge them via its own
      // editing-path invariant
      editor.commands.setTextSelection({
        from: 4,
        to: 9,
      });
      editor.commands.unsetMark("verbatim");
      editor.commands.setTextSelection({
        from: 4,
        to: 9,
      });
      editor.commands.setMark("verbatim");

      const lipu = docToLipu(editor.state.doc);
      const rebuilt = lipuToContent(lipu);
      const actual = editor.getJSON();
      editor.destroy();

      expect(JSON.stringify(rebuilt)).toBe(
        JSON.stringify(actual)
      );
    }
  );
});

describe("editor load path (invariant 4)", () => {
  const fixtures: Record<string, JSONContent> = {
    "plain glyph doc": {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: glyph("toki") + " " + glyph("pona"),
            },
          ],
        },
      ],
    },
    "verbatim-marked doc": {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "hi there",
              marks: [{ type: "verbatim" }],
            },
          ],
        },
      ],
    },
    "unmarked-latin doc": {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "hello world" },
          ],
        },
      ],
    },
    "hardBreak doc": {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: glyph("toki") },
            { type: "hardBreak" },
            { type: "text", text: glyph("pona") },
          ],
        },
      ],
    },
    // THE REPORTED BUG (a real user sighting,
    // fixed): an abbreviated
    // cartouche — a cart-ext between the last glyph
    // and "]". Promotion used to synthesize the end
    // marker edge-adjacent, so this doc reloaded as
    // "[jan]=". Marker-offset recording fixes it:
    // promotion records
    // the marker's offset instead. The mirror shape
    // ("[ toki]") is the same rule on the start side.
    "abbreviated cartouche doc": {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text:
                markerChar("cartouche-start") +
                glyph("jan") +
                markerChar("cart-ext") +
                markerChar("cartouche-end"),
            },
          ],
        },
      ],
    },
    "cartouche with a leading space": {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text:
                markerChar("cartouche-start") +
                " " +
                glyph("toki") +
                markerChar("cartouche-end"),
            },
          ],
        },
      ],
    },
  };

  it(
    "initializing via the lipu equals " +
      "initializing from stored JSON",
    () => {
      for (const [name, fixture] of Object.entries(
        fixtures
      )) {
        const editorA = createEditor(fixture);
        const lipu = contentToLipu(fixture);
        const editorB = createEditorFromLipu(lipu);

        expect(
          JSON.stringify(editorB.getJSON()),
          name
        ).toBe(JSON.stringify(editorA.getJSON()));

        editorA.destroy();
        editorB.destroy();
      }
    }
  );

  it(
    "legacy ni codepoints are the only load " +
      "divergence (enumerated)",
    () => {
      const legacy: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: String.fromCodePoint(0xf1989),
              },
            ],
          },
        ],
      };

      const editorA = createEditor(legacy);
      const lipu = contentToLipu(legacy);
      const editorB = createEditorFromLipu(lipu);

      const jsonA = editorA.getJSON();
      const jsonB = editorB.getJSON();
      editorA.destroy();
      editorB.destroy();

      const textA =
        jsonA.content?.[0].content?.[0].text;
      const textB =
        jsonB.content?.[0].content?.[0].text;

      // A holds the raw legacy codepoint verbatim;
      // B (loaded via the lipu) holds the folded
      // ni + left-arrow rendering
      expect(textA).toBe(
        String.fromCodePoint(0xf1989)
      );
      expect(textB).toBe(glyph("ni") + "←");

      // nothing else differs: patching B's text
      // node back to A's text makes the two docs
      // identical
      const patchedB: JSONContent = {
        ...jsonB,
        content: jsonB.content?.map((p, i) =>
          i === 0
            ? {
                ...p,
                content: p.content?.map((n, j) =>
                  j === 0
                    ? { ...n, text: textA }
                    : n
                ),
              }
            : p
        ),
      };
      expect(JSON.stringify(patchedB)).toBe(
        JSON.stringify(jsonA)
      );
    }
  );

  it(
    "gate: a Lipu with a companioned break and a " +
      "cartouche loads, renders, and reloads " +
      "byte-stably",
    () => {
      // a companioned break and a cartouche around
      // "toki" (the shape a development-era stored
      // doc used to
      // exercise, before the storage flip retired
      // the lipudoc format entirely)
      const up: Lipu = {
        version: 2,
        blocks: [
          {
            anchors: [
              { kind: "word", word: "toki" },
              { kind: "word", word: "pona" },
            ],
            gaps: [
              { sp: "", latin: "" },
              { sp: "\n", latin: "\n" },
              { sp: "", latin: "" },
            ],
            spans: [
              cart(0, 0),
            ],
          },
        ],
      };
      const json = JSON.stringify(lipuToContent(up));
      // reload: parse the rendered doc back and
      // re-render — byte-identical (no drift loop)
      const again = contentToLipu(
        JSON.parse(json) as JSONContent
      );
      expect(
        JSON.stringify(lipuToContent(again))
      ).toBe(json);
    }
  );
});

describe("load boundary provenance", () => {
  it("classifies per-side: default-shaped old " +
     "content (incl. the ' \\n' seam image) loads " +
     "UNMARKED and byte-identical", () => {
    const lipu: Lipu = {
      version: 2,
      blocks: [
        {
          anchors: [
            { kind: "word", word: "toki" },
            { kind: "word", word: "pona" },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: " \n", latin: " \n" },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    };
    const out = loadNormalizeLipu(lipu);
    const gp = out.blocks[0].gaps[1];
    expect(gp).toEqual({ sp: " \n", latin: " \n" });
    expect("spAuthored" in gp).toBe(false);
    expect("latinAuthored" in gp).toBe(false);
  });

  it("punctuated old content loads AUTHORED (a " +
     "deliberate behavior " +
     "change)", () => {
    const lipu: Lipu = {
      version: 2,
      blocks: [
        {
          anchors: [
            { kind: "word", word: "toki" },
            { kind: "word", word: "pona" },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: " ", latin: ".\n" },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    };
    const out = loadNormalizeLipu(lipu);
    expect(
      out.blocks[0].gaps[1].latinAuthored
    ).toBe(true);
    expect(
      out.blocks[0].gaps[1].spAuthored
    ).toBeUndefined();
    // idempotent second load
    expect(loadNormalizeLipu(out)).toBe(out);
  });

  it("parsedToBlock consumers classify too: a " +
     "mirror paragraph carrying a literal mid-dot " +
     "gap byte re-derives it AUTHORED", () => {
    const lipu = contentToLipu({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text:
                glyph("toki") +
                MIDDLE_DOT_CH +
                glyph("pona"),
            },
          ],
        },
      ],
    });
    const gp = lipu.blocks[0].gaps[1];
    expect(gp.sp).toBe(MIDDLE_DOT_CH);
    expect(gp.spAuthored).toBe(true);
  });
});
