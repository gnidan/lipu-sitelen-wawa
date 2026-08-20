import { describe, it, expect, vi } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from "./sitelen-pona";
import { Autocomplete } from "./autocomplete";
import { StructuralChars } from "./structural-chars";
import { Verbatim } from "./verbatim";
import { VerbatimToggle } from "./verbatim-toggle";
import {
  LipuModel,
  lipuModelKey,
  structuralMerge,
} from "./lipu-model";
import { LineBreaks } from "./line-breaks";
import {
  applySeparationDefaultsLipu,
  isSentinel,
  mergeLatinBlock,
  normalizeLetterishLatinLipu,
  parseLatin,
  parseSp,
  renderLatin,
  renderSp,
} from "../../lipu";
import type {
  Block,
  Lipu,
  ParsedSide,
} from "../../lipu";
import {
  CARTOUCHE_START,
  CARTOUCHE_END,
} from "../../lipu/chars";
import {
  copyText,
  projectLipu,
} from "../../app/latin-projections";
import { blockOffsetToPm } from "../pm-coords";
import {
  blockInlines,
  contentToLipu,
  lipuToContent,
} from "../lipu-doc";
import { assertInvariants } from "../test-invariants";
import { cart, glyph as ucsur } from "../../../test/helpers";

function createEditor(content?: JSONContent | string) {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      Autocomplete,
      StructuralChars,
      Verbatim,
      VerbatimToggle,
      LipuModel,
    ],
    content,
  });
}

function createSeededEditor(
  content: JSONContent | string,
  initialLipu: Lipu | null
) {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      Autocomplete,
      StructuralChars,
      Verbatim,
      VerbatimToggle,
      LineBreaks,
      LipuModel.configure({ initialLipu }),
    ],
    content,
  });
}

/**
 * Simulate a keydown event by calling each
 * plugin's handleKeyDown in order (matching
 * ProseMirror dispatch behavior). Mirrors the
 * helper in autocomplete.test.ts.
 */
function simulateKeyDown(
  editor: Editor,
  key: string
): boolean {
  const { view } = editor;
  const event = new KeyboardEvent("keydown", { key });
  let handled = false;
  for (const plugin of view.state.plugins) {
    if (handled) break;
    const handler = plugin.props.handleKeyDown;
    if (handler) {
      const result = handler.call(plugin, view, event);
      if (result) handled = true;
    }
  }
  return handled;
}

/** The model block a live plugin state holds. Object
 *  identity is meaningful: the per-block merge path
 *  leaves untouched blocks as the very same object. */
function blockOf(editor: Editor, i: number): Block {
  const state = lipuModelKey.getState(editor.state);
  expect(state).toBeDefined();
  return state!.lipu.blocks[i];
}

function gapsOf(editor: Editor, i: number) {
  return blockOf(editor, i).gaps;
}

/** A fresh SP-side parse of a block — the shape
 *  the editor hands mergeStructural for one
 *  paragraph. Never hand-write ParsedSide gaps
 *  unless the test is ABOUT parse shapes. */
function parsedOf(block: Block): ParsedSide {
  return parseSp(renderSp(block).inlines);
}

function latinOf(lipu: Lipu): string {
  return copyText(projectLipu(lipu));
}

describe("LipuModel", () => {
  it(
    "initializes from the doc, equal to the " +
      "lipu the content was built from",
    () => {
      // The separation default: the shared gap of
      // two letter-rendering
      // anchors carries latin " " on every import
      // path, so the load-derived lipu has it too.
      const someLipu: Lipu = {
        version: 2,
        blocks: [
          {
            anchors: [
              { kind: "word", word: "toki" },
              { kind: "word", word: "pona" },
            ],
            gaps: [
              { sp: "", latin: "" },
              { sp: " ", latin: " " },
              { sp: "", latin: "" },
            ],
            spans: [],
          },
        ],
      };
      const editor = createEditor(
        lipuToContent(someLipu)
      );

      const state = lipuModelKey.getState(editor.state);
      expect(state).toBeDefined();
      expect(state!.lipu).toEqual(someLipu);
      expect(state!.version).toBe(0);

      editor.destroy();
    }
  );

  it(
    "seeds from a verified initialLipu, keeping " +
      "latin-side gap content the doc alone cannot " +
      "express",
    () => {
      // The break companion alone no longer
      // discriminates: the both-sides default gives
      // every parsed "\n" in
      // gap.sp a "\n" in that gap.latin, so a
      // re-derive would reproduce it. The TRAILING
      // gap's " !" is the discriminator — pure latin
      // content with no SP projection at all.
      const seeded: Lipu = {
        version: 2,
        blocks: [
          {
            anchors: [
              { kind: "word", word: "ona" },
              { kind: "word", word: "wawa" },
            ],
            gaps: [
              { sp: "", latin: "" },
              { sp: "\n", latin: "\n" },
              { sp: "", latin: " !" },
            ],
            spans: [],
          },
        ],
      };
      const editor = createSeededEditor(
        lipuToContent(seeded),
        seeded
      );

      const state = lipuModelKey.getState(editor.state);
      expect(state).toBeDefined();
      expect(state!.lipu).toEqual(seeded);
      expect(state!.version).toBe(0);

      editor.destroy();
    }
  );

  it(
    "falls back to docToLipu and warns when " +
      "initialLipu does not match the doc",
    () => {
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const oneWord = (word: string): Lipu => ({
        version: 2,
        blocks: [
          {
            anchors: [{ kind: "word", word }],
            gaps: [
              { sp: "", latin: "" },
              { sp: "", latin: "" },
            ],
            spans: [],
          },
        ],
      });
      const docLipu = oneWord("toki");
      const foreignLipu = oneWord("pona");
      const editor = createSeededEditor(
        lipuToContent(docLipu),
        foreignLipu
      );

      const state = lipuModelKey.getState(editor.state);
      expect(state).toBeDefined();
      expect(state!.lipu).toEqual(docLipu);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      editor.destroy();
      warnSpy.mockRestore();
    }
  );

  it(
    "tracks typing: render invariant holds per " +
      "transaction",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      assertInvariants(editor);

      editor.on("transaction", () => {
        assertInvariants(editor);
      });

      for (const ch of "toki ") {
        editor.commands.insertContent(ch);
      }

      // word should have been auto-committed as a
      // UCSUR glyph on the trailing space
      const text = editor.state.doc.textContent;
      expect(text.length).toBeGreaterThan(0);

      assertInvariants(editor);

      editor.destroy();
    }
  );

  it(
    "merge agreement: spliced block equals " +
      "whole-block reparse",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      editor.on("transaction", () => {
        assertInvariants(editor);
      });

      for (const ch of "toki ") {
        editor.commands.insertContent(ch);
      }
      for (const ch of "pona ") {
        editor.commands.insertContent(ch);
      }

      const block = blockOf(editor, 0);
      const para = editor.state.doc.child(0);
      const reparsed = parseSp(blockInlines(para));
      // SP-visible scope: anchors and gap.sp. The
      // latin side has no SP projection (see
      // test-invariants).
      expect(block.anchors).toEqual(reparsed.anchors);
      expect(block.gaps.map((g) => g.sp)).toEqual(
        reparsed.gaps
      );

      editor.destroy();
    }
  );

  it(
    "mark-only transactions reach the lipu " +
      "(Escape-rejection)",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("zzz");

      simulateKeyDown(editor, "Escape");
      assertInvariants(editor);

      expect(blockOf(editor, 0).anchors).toEqual([
        { kind: "verbatim", text: "zzz", marked: true },
      ]);

      editor.destroy();
    }
  );

  // A count-PRESERVING join+split is a RESHAPE: the
  // equal-count fast path merges positionally, so
  // block identity is assumed, not derived. SP bytes
  // are safe either way (the edited side is
  // parse-authoritative), which is what this test
  // pins; the latin-side cost is pinned as a known
  // limitation in the structuralMerge describe.
  it(
    "survives count-preserving structural " +
      "rearrangement (equal-count fast path)",
    () => {
      const editor = createEditor({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "xxx" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "yyy" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "zzz" }],
          },
        ],
      });

      assertInvariants(editor);
      expect(editor.state.doc.childCount).toBe(3);

      const before = editor.state.doc;
      const p0Size = before.child(0).nodeSize;
      const p1Size = before.child(1).nodeSize;
      // boundary between paragraph 0 and 1
      const joinPos = p0Size;
      // position after the first char of p2
      // ("z" | "zz"), in ORIGINAL doc coordinates
      const splitPosOrig = p0Size + p1Size + 2;

      const tr = editor.state.tr;
      tr.join(joinPos);
      const splitPos = tr.mapping.map(splitPosOrig);
      tr.split(splitPos);

      editor.view.dispatch(tr);

      // count unchanged: 3 -> 3, but block identity
      // has shifted (join + split combined)
      expect(editor.state.doc.childCount).toBe(3);
      expect(editor.state.doc.child(0).textContent).toBe(
        "xxxyyy"
      );
      expect(editor.state.doc.child(1).textContent).toBe(
        "z"
      );
      expect(editor.state.doc.child(2).textContent).toBe(
        "zz"
      );

      assertInvariants(editor);

      editor.destroy();
    }
  );

  it(
    "save payload equals getJSON as serialized " +
      "bytes, including mid-composition",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      const checkParity = () => {
        const state = lipuModelKey.getState(
          editor.state
        );
        expect(state).toBeDefined();
        const payload = lipuToContent(state!.lipu);
        expect(JSON.stringify(payload)).toBe(
          JSON.stringify(editor.getJSON())
        );
      };

      checkParity();

      // glyph-committing sequence: each trailing
      // space auto-commits the preceding word into
      // a UCSUR glyph
      for (const ch of "toki pona ") {
        editor.commands.insertContent(ch);
        checkParity();
      }

      // partial word, no trailing space: never
      // committed, still mid-composition
      for (const ch of "pon") {
        editor.commands.insertContent(ch);
        checkParity();
      }

      editor.destroy();
    }
  );

  it(
    "reload round-trip: saved payload reproduces " +
      "the doc",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      for (const ch of "toki pona ") {
        editor.commands.insertContent(ch);
      }
      // leave a mid-composition partial word too
      for (const ch of "pon") {
        editor.commands.insertContent(ch);
      }

      const state = lipuModelKey.getState(
        editor.state
      );
      expect(state).toBeDefined();
      const payload = lipuToContent(state!.lipu);
      editor.destroy();

      const reloaded = lipuToContent(
        contentToLipu(payload)
      );
      expect(JSON.stringify(reloaded)).toBe(
        JSON.stringify(payload)
      );
    }
  );

  it("paragraph split/join updates the lipu", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");
    editor.commands.insertContent("xxx yyy");
    assertInvariants(editor);

    // split "xxx yyy" into "xxx" | " yyy" after the
    // 3rd char
    editor.commands.setTextSelection(4);
    editor.commands.splitBlock();
    assertInvariants(editor);
    expect(editor.state.doc.childCount).toBe(2);

    // join back: cursor at start of 2nd paragraph
    const secondParaStart =
      editor.state.doc.child(0).nodeSize + 1;
    editor.commands.setTextSelection(secondParaStart);
    editor.commands.joinBackward();
    assertInvariants(editor);
    expect(editor.state.doc.childCount).toBe(1);

    editor.destroy();
  });
});

/**
 * LineBreaks owns Enter: plain Enter inserts a
 * hardBreak, and an appendTransaction turns any run of
 * two or more into a paragraph split. The break tests
 * need that real gesture, so they use their own editor
 * rather than the shared factory (which deliberately
 * has no Enter handling).
 */
function createEnterEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      Autocomplete,
      StructuralChars,
      Verbatim,
      VerbatimToggle,
      LineBreaks,
      LipuModel,
    ],
    content,
  });
}

function pressEnter(editor: Editor) {
  const handled = simulateKeyDown(editor, "Enter");
  expect(handled).toBe(true);
}

describe("companion newlines through the editor", () => {
  // In this model a break IS gap.sp "\n" and its
  // companion is
  // that same gap's latin "\n" (Enter
  // writes both sides of ONE gap). There is no
  // token adjacency left to assert.
  it("a hard break inserted in the SP doc lands in " +
     "the lipu with its companion", () => {
    const editor = createEditor("<p>xxx</p>");
    editor.commands.focus("end");
    editor.commands.setHardBreak();

    // one anchor ("xxx"), so the break lands in the
    // TRAILING gap, index 1
    expect(blockOf(editor, 0).anchors).toEqual([
      { kind: "verbatim", text: "xxx" },
    ]);
    expect(gapsOf(editor, 0)[1]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });
    assertInvariants(editor);

    editor.destroy();
  });

  // Enter-Enter is the real paragraph gesture:
  // LineBreaks inserts a second hardBreak, then its
  // normalizer deletes the whole run and splits. The
  // flat merge's SPLIT routing divides the carried
  // latin at the trailing "\n" run (both
  // runs consumed), so neither side keeps a stray
  // newline at the seam.
  it("Enter-Enter splits without orphaning a " +
     "companion in the new block", () => {
    const editor = createEnterEditor(
      `<p>${ucsur("toki")}</p>`
    );
    editor.commands.focus("end");
    pressEnter(editor);
    pressEnter(editor);
    editor.commands.insertContent(ucsur("pona"));

    expect(editor.state.doc.childCount).toBe(2);
    expect(blockOf(editor, 0).anchors).toEqual([
      { kind: "word", word: "toki" },
    ]);
    expect(blockOf(editor, 1).anchors).toEqual([
      { kind: "word", word: "pona" },
    ]);
    // both runs consumed — no stray "\n"
    // on either side of the seam
    expect(
      gapsOf(editor, 0).at(-1)!.latin
    ).toBe("");
    expect(gapsOf(editor, 1)[0].latin).toBe("");
    const state = lipuModelKey.getState(editor.state);
    expect(latinOf(state!.lipu)).toBe("toki\n\npona");
    assertInvariants(editor);

    editor.destroy();
  });

  // Enter over a selection is replaceSelectionWith, so
  // the break is replacement-paired with the glyph it
  // overwrote rather than purely inserted — it is
  // still a new break and still means "newline on both
  // sides".
  it("Enter over a selection still produces a " +
     "companion", () => {
    const editor = createEnterEditor(
      `<p>${ucsur("toki")}${ucsur("pona")}</p>`
    );
    const doc = editor.state.doc;
    // select exactly the first glyph (UCSUR glyphs are
    // astral: two UTF-16 units each)
    editor.commands.setTextSelection({
      from: blockOffsetToPm(doc, 0, 0),
      to: blockOffsetToPm(doc, 0, 2),
    });
    pressEnter(editor);

    expect(editor.state.doc.childCount).toBe(1);
    expect(blockOf(editor, 0).anchors).toEqual([
      { kind: "word", word: "pona" },
    ]);
    // the break replaced the leading glyph: it lands
    // in the doc-leading gap 0, both sides
    expect(gapsOf(editor, 0)[0]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });
    const state = lipuModelKey.getState(editor.state);
    expect(latinOf(state!.lipu)).toBe("\npona");
    assertInvariants(editor);

    editor.destroy();
  });
});

// Enter now exercises the NON-structural per-block
// parseSp+mergeBlock path: a hardBreak insert keeps
// childCount unchanged and touches a closed inline
// slice, so `analyze` classifies it as non-structural
// and only the edited block gets re-merged. These
// tests pin that classification directly, plus the
// companion behaviour riding along on it. Direct-
// transaction tests build their editor WITHOUT
// LineBreaks: its normalizer would immediately split
// any fixture with two consecutive breaks, and here the
// merge-path classification itself is under test. Only
// the keystroke end-to-end tests include LineBreaks.
//
// Every test uses a three-block doc and edits only
// block 1; blocks 0 and 2 are captured before the edit
// and re-checked with `toBe` (object IDENTITY, not
// deep equality) afterward — proof the structural
// fallback did not run, since the per-block path
// leaves untouched blocks as the very same object
// reference.
describe("break edits take the per-block merge path", () => {
  function threeBlocks() {
    return createEditor("<p>xxx</p><p>yyy</p><p>zzz</p>");
  }

  function insertBreak(editor: Editor, pos: number) {
    const br = editor.state.schema.nodes.hardBreak
      .create();
    editor.view.dispatch(
      editor.state.tr.replaceWith(pos, pos, br)
    );
  }

  it("hardBreak insert at block end", () => {
    const editor = threeBlocks();
    const before0 = blockOf(editor, 0);
    const before2 = blockOf(editor, 2);

    const pos = blockOffsetToPm(editor.state.doc, 1, 3);
    insertBreak(editor, pos);

    expect(blockOf(editor, 1).anchors).toEqual([
      { kind: "verbatim", text: "yyy" },
    ]);
    expect(gapsOf(editor, 1)[1]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });
    expect(blockOf(editor, 0)).toBe(before0);
    expect(blockOf(editor, 2)).toBe(before2);
    assertInvariants(editor);

    editor.destroy();
  });

  it("hardBreak insert at block start", () => {
    const editor = threeBlocks();
    const before0 = blockOf(editor, 0);
    const before2 = blockOf(editor, 2);

    const pos = blockOffsetToPm(editor.state.doc, 1, 0);
    insertBreak(editor, pos);

    expect(blockOf(editor, 1).anchors).toEqual([
      { kind: "verbatim", text: "yyy" },
    ]);
    expect(gapsOf(editor, 1)[0]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });
    expect(blockOf(editor, 0)).toBe(before0);
    expect(blockOf(editor, 2)).toBe(before2);
    assertInvariants(editor);

    editor.destroy();
  });

  it("hardBreak insert between two existing breaks", () => {
    // DESIGNED DELTA: loaded breaks now DO carry
    // a companion — every "\n" a parse puts in gap.sp
    // gets a "\n" in that gap.latin at import, which
    // is exactly what the storage backfill used to do
    // after the fact.
    const editor = createEditor(
      "<p>xxx</p><p>x<br><br>y</p><p>zzz</p>"
    );
    expect(blockOf(editor, 1).anchors).toEqual([
      { kind: "verbatim", text: "x" },
      { kind: "verbatim", text: "y" },
    ]);
    expect(gapsOf(editor, 1)[1]).toEqual({
      sp: "\n\n",
      latin: "\n\n",
    });
    const before0 = blockOf(editor, 0);
    const before2 = blockOf(editor, 2);

    // between the two existing breaks: after "x" and
    // the first break
    const pos = blockOffsetToPm(editor.state.doc, 1, 2);
    insertBreak(editor, pos);

    // The model has no token slots to be ambiguous
    // about:
    // the three breaks are three "\n"s in one gap.sp,
    // and the Enter default appends exactly the ONE
    // fresh newline to
    // that gap's latin.
    expect(gapsOf(editor, 1)[1]).toEqual({
      sp: "\n\n\n",
      latin: "\n\n\n",
      spAuthored: true,
    });
    expect(blockOf(editor, 0)).toBe(before0);
    expect(blockOf(editor, 2)).toBe(before2);
    assertInvariants(editor);

    editor.destroy();
  });

  it("hardBreak delete", () => {
    const editor = threeBlocks();

    // seed a break WITH a companion at the end of
    // block 1
    const seedPos = blockOffsetToPm(
      editor.state.doc,
      1,
      3
    );
    insertBreak(editor, seedPos);
    expect(gapsOf(editor, 1)[1]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });

    const before0 = blockOf(editor, 0);
    const before2 = blockOf(editor, 2);

    const breakPos = blockOffsetToPm(
      editor.state.doc,
      1,
      3
    );
    editor.view.dispatch(
      editor.state.tr.delete(breakPos, breakPos + 1)
    );

    // Latin newlines stay in step with sp newlines
    // at every break (superseding the
    // old append-only reading of the Enter
    // default): deleting
    // the break removes gap.sp's "\n" AND the
    // matching companion latin "\n" it once left
    // behind. Leaving that companion behind was the
    // "newline ratchet" -- an Enter/delete cycle at
    // the same break used to accrete a latin "\n"
    // forever.
    expect(blockOf(editor, 1).anchors).toEqual([
      { kind: "verbatim", text: "yyy" },
    ]);
    expect(gapsOf(editor, 1)[1]).toEqual({
      sp: "",
      latin: "",
    });
    expect(blockOf(editor, 0)).toBe(before0);
    expect(blockOf(editor, 2)).toBe(before2);
    assertInvariants(editor);

    editor.destroy();
  });

  it("Enter keystroke end-to-end", () => {
    const editor = createEnterEditor(
      "<p>xxx</p><p>yyy</p><p>zzz</p>"
    );
    const before0 = blockOf(editor, 0);
    const before2 = blockOf(editor, 2);

    editor.commands.setTextSelection(
      blockOffsetToPm(editor.state.doc, 1, 3)
    );
    pressEnter(editor);

    expect(blockOf(editor, 1).anchors).toEqual([
      { kind: "verbatim", text: "yyy" },
    ]);
    expect(gapsOf(editor, 1)[1]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });
    expect(blockOf(editor, 0)).toBe(before0);
    expect(blockOf(editor, 2)).toBe(before2);
    assertInvariants(editor);

    editor.destroy();
  });

  it("Enter-Enter end-to-end", () => {
    const editor = createEnterEditor(
      `<p>xxx</p><p>${ucsur("toki")}</p><p>zzz</p>`
    );

    // landmine: seed block 0 with a companion that
    // must survive the structural split triggered in
    // block 1 below (the re-attachment landmine,
    // pinned across a doc with more than the one
    // affected block)
    editor.commands.setTextSelection(
      blockOffsetToPm(editor.state.doc, 0, 3)
    );
    editor.commands.setHardBreak();
    const landmine = blockOf(editor, 0);
    expect(landmine.gaps[1]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });

    // "toki" is one astral UCSUR glyph: 2 UTF-16 units
    editor.commands.setTextSelection(
      blockOffsetToPm(editor.state.doc, 1, 2)
    );
    pressEnter(editor);
    pressEnter(editor);
    editor.commands.insertContent(ucsur("pona"));

    expect(editor.state.doc.childCount).toBe(4);
    // the landmine survives the structural merge
    expect(blockOf(editor, 0)).toEqual(landmine);
    // the two seam blocks: no break, no stray latin
    // "\n" — the split consumed both runs
    expect(blockOf(editor, 1).anchors).toEqual([
      { kind: "word", word: "toki" },
    ]);
    expect(blockOf(editor, 2).anchors).toEqual([
      { kind: "word", word: "pona" },
    ]);
    expect(
      gapsOf(editor, 1).at(-1)!.latin
    ).toBe("");
    expect(gapsOf(editor, 2)[0].latin).toBe("");
    assertInvariants(editor);

    editor.destroy();
  });
});

// The structural path used to be a whole-doc
// docToLipu reparse, which dropped every latin-local
// token in the document. With companions that is real
// data loss on any split/join/paste, so it is now a
// flat merge: blocks are flattened into one token
// stream with a boundary sentinel between them,
// merged, and re-chunked.
describe("flat structural merge", () => {
  it("a paragraph SPLIT preserves latin-local " +
     "content in the OTHER block", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "xxx" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "yyy" }],
        },
      ],
    });

    // give block 1 a companion (latin-side gap
    // content with no SP projection of its own)
    editor.commands.focus("end");
    editor.commands.setHardBreak();
    expect(gapsOf(editor, 1)[1]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });

    // now split block 0 — a structural transaction
    // that touches nothing in block 1
    editor.commands.setTextSelection(2);
    editor.commands.splitBlock();

    expect(editor.state.doc.childCount).toBe(3);
    expect(blockOf(editor, 0).anchors).toEqual([
      { kind: "verbatim", text: "x" },
    ]);
    expect(blockOf(editor, 1).anchors).toEqual([
      { kind: "verbatim", text: "xx" },
    ]);
    // the landmine: the companion used to be dropped
    // here by the whole-doc reparse
    expect(blockOf(editor, 2).anchors).toEqual([
      { kind: "verbatim", text: "yyy" },
    ]);
    expect(gapsOf(editor, 2)[1]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });
    assertInvariants(editor);

    editor.destroy();
  });

  it("a paragraph JOIN preserves mid-block " +
     "latin-local content", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "xxx" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "yyy" }],
        },
      ],
    });

    // companion in the MIDDLE of block 0
    editor.commands.setTextSelection(2);
    editor.commands.setHardBreak();
    expect(blockOf(editor, 0).anchors).toEqual([
      { kind: "verbatim", text: "x" },
      { kind: "verbatim", text: "xx" },
    ]);
    expect(gapsOf(editor, 0)[1]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });

    // join block 1 back into block 0
    const secondParaStart =
      editor.state.doc.child(0).nodeSize + 1;
    editor.commands.setTextSelection(secondParaStart);
    editor.commands.joinBackward();

    expect(editor.state.doc.childCount).toBe(1);
    // "xx" and "yyy" become adjacent text in one
    // paragraph, so the reparse sees a single
    // verbatim run — but the companion, which lives
    // in the (surviving) gap holding the break,
    // rides through the join
    expect(blockOf(editor, 0).anchors).toEqual([
      { kind: "verbatim", text: "x" },
      { kind: "verbatim", text: "xxyyy" },
    ]);
    expect(gapsOf(editor, 0)[1]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });
    assertInvariants(editor);

    editor.destroy();
  });
});

// Unit-level pins for the flat merge. The editor has
// no Latin-editing path yet, so these drive
// structuralMerge directly, seeding gap.latin content
// a live plugin state could otherwise only reach via
// Enter.
describe("structuralMerge (flat merge unit)", () => {
  /** A Block from anchors plus per-gap [sp, latin]
   *  pairs (length must be anchors + 1). */
  const blk = (
    anchors: Block["anchors"],
    gaps: Array<[string, string]>
  ): Block => ({
    anchors,
    gaps: gaps.map(([sp, latin]) => ({ sp, latin })),
    spans: [],
  });
  const w = (word: string): Block["anchors"][number] => ({
    kind: "word",
    word,
  });
  const latins = (b: Block): string[] =>
    b.gaps.map((g) => g.latin);

  it("keeps mid-block latin gap content across a " +
     "JOIN", () => {
    const prev: Block[] = [
      blk([w("toki"), w("pona")], [
        ["", ""],
        [" ", ", "],
        ["", ""],
      ]),
      blk([w("jan"), w("sewi")], [
        ["", ""],
        [" ", "! "],
        ["", ""],
      ]),
    ];
    // the doc reparse after the join: ONE paragraph
    // whose SP text is the two blocks concatenated
    const joined = blk(
      [w("toki"), w("pona"), w("jan"), w("sewi")],
      [
        ["", ""],
        [" ", ""],
        ["", ""],
        [" ", ""],
        ["", ""],
      ]
    );
    const merged = structuralMerge(prev, [
      parsedOf(joined),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].anchors).toEqual(joined.anchors);
    // gap 2 is the seam: both sides' latin were "",
    // and the separation default separates the
    // now-adjacent "pona" and
    // "jan" letter runs.
    expect(latins(merged[0])).toEqual([
      "",
      ", ",
      " ",
      "! ",
      "",
    ]);
  });

  // EXPECTATION FLIP (an old accepted edge, now
  // fixed). FLAT-MERGE OWNERSHIP LAYOUT / JOIN: "a
  // deleted sentinel's owned gap does NOT die with it
  // — it merges INTO the left survivor's trailing gap
  // (sp appended to sp, latin to latin)" — fixing
  // an old accepted edge where Latin content at the
  // very start of a Block
  // dropped on paragraph join.
  it("preserves start-of-block latin content on a " +
     "JOIN (flat-merge JOIN rescue; an old accepted " +
     "edge, fixed)", () => {
    const prev: Block[] = [
      blk([w("toki")], [
        ["", ""],
        ["", ""],
      ]),
      blk([w("pona")], [
        ["", "! "],
        ["", ""],
      ]),
    ];
    const joined = blk([w("toki"), w("pona")], [
      ["", ""],
      ["", ""],
      ["", ""],
    ]);
    const merged = structuralMerge(prev, [
      parsedOf(joined),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].anchors).toEqual(joined.anchors);
    // the dead sentinel's owned gap merged into the
    // left survivor's trailing gap
    expect(merged[0].gaps[1].latin).toBe("! ");
  });

  it("latin content at the very start of the DOC " +
     "survives a JOIN (gaps[0] is Block-owned)", () => {
    const prev: Block[] = [
      blk([w("toki")], [
        ["", "! "],
        ["", ""],
      ]),
      blk([w("pona")], [
        ["", ""],
        ["", ""],
      ]),
    ];
    const joined = blk([w("toki"), w("pona")], [
      ["", ""],
      ["", ""],
      ["", ""],
    ]);
    const merged = structuralMerge(prev, [
      parsedOf(joined),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].gaps[0].latin).toBe("! ");
  });

  it("block count always follows the fresh parse", () => {
    const prev: Block[] = [
      blk([w("toki"), w("pona")], [
        ["", ""],
        ["", ","],
        ["", ""],
      ]),
    ];
    const sides: ParsedSide[] = [
      parsedOf(blk([w("toki")], [["", ""], ["", ""]])),
      parsedOf(blk([w("pona")], [["", ""], ["", ""]])),
      parsedOf(blk([], [["", ""]])),
    ];
    const merged = structuralMerge(prev, sides);
    expect(merged).toHaveLength(3);
    expect(merged[0].anchors).toEqual([w("toki")]);
    // the "," rode along with the gap toki owns
    expect(latins(merged[0])).toEqual(["", ","]);
    expect(merged[1].anchors).toEqual([w("pona")]);
    expect(merged[2].anchors).toEqual([]);
  });

  // KNOWN LIMITATION, recorded not fixed (the RESHAPE
  // caveat; see doc-merge.ts and lipu-model.ts): a
  // transaction that both splits and joins while
  // leaving the paragraph COUNT unchanged takes the
  // equal-count fast path, which pairs paragraphs
  // POSITIONALLY. Anchors the reshape re-created get
  // creation defaults instead of their prev gap.latin.
  // SP bytes are safe; a real fix needs transaction-
  // level position mapping (deliberately not built).
  it("RESHAPE (equal-count split+join) loses latin " +
     "gap content on re-created anchors — known " +
     "limitation, SP-safe", () => {
    // the ", " lives in the gap "pona" OWNS (gaps[i+1]
    // is owned by anchors[i]), so it dies exactly when
    // "pona" is re-created rather than carried.
    const prev: Block[] = [
      blk([w("toki"), w("pona")], [
        ["", ""],
        [" ", ""],
        ["", ", "],
      ]),
      blk([w("jan")], [
        ["", ""],
        ["", ""],
      ]),
    ];
    // the boundary MOVED left: "toki" alone, then
    // "pona jan". Count is still 2.
    const sides: ParsedSide[] = [
      parsedOf(blk([w("toki")], [["", ""], ["", ""]])),
      parsedOf(
        blk([w("pona"), w("jan")], [
          ["", ""],
          [" ", ""],
          ["", ""],
        ])
      ),
    ];
    const merged = structuralMerge(prev, sides);
    // SP side is exactly the fresh parse
    expect(merged.map((b) => b.anchors)).toEqual([
      [w("toki")],
      [w("pona"), w("jan")],
    ]);
    expect(
      merged.map((b) => b.gaps.map((g) => g.sp))
    ).toEqual([
      ["", ""],
      ["", " ", ""],
    ]);
    // ...but the ", " is gone: nothing anywhere holds
    // it any more.
    expect(
      merged.flatMap(latins).join("|")
    ).not.toContain(",");
  });

  // There is NO size ceiling on the structural merge
  // itself: the merge bounds its own LCS DP against
  // the TRIMMED middle, and a split trims to a middle
  // of one sentinel against nothing however long the
  // document is. So a routine split of a document far
  // past any whole-document cell budget still merges
  // with FULL fidelity — no degradation, no loss.
  it("splits a 1500-glyph document with full " +
     "fidelity — the trimmed middle stays tiny", () => {
    const many = (n: number, tag: string) =>
      Array.from({ length: n }, (_, i) =>
        w(tag + i)
      );
    const head = many(500, "a");
    const tail = many(999, "b");
    const gapPairs = (
      n: number,
      nlAt?: number
    ): Array<[string, string]> =>
      Array.from({ length: n }, (_, i) =>
        i === nlAt
          ? (["\n", "\n"] as [string, string])
          : (["", ""] as [string, string])
      );
    // prev: one block, a break (gap.sp "\n" with its
    // companion) between head and tail
    const prev: Block[] = [
      blk(
        [...head, ...tail],
        gapPairs(head.length + tail.length + 1, 500)
      ),
    ];
    // The parsed sides are hand-built rather than
    // re-parsed: these are REGISTRY-DRIFT words, which
    // render as their Latin spelling, so a real reparse
    // of the rendering would fuse all 1500 into one
    // verbatim run. The test is about merge fidelity at
    // scale, not about parse shapes.
    const cut = 499;
    const side0Anchors = [
      ...head,
      ...tail.slice(0, cut),
    ];
    const sides: ParsedSide[] = [
      {
        anchors: side0Anchors,
        gaps: gapPairs(
          side0Anchors.length + 1,
          500
        ).map(([sp]) => sp),
      },
      {
        anchors: tail.slice(cut),
        gaps: gapPairs(
          tail.length - cut + 1
        ).map(([sp]) => sp),
      },
    ];

    const merged = structuralMerge(prev, sides);

    expect(merged).toHaveLength(2);
    // exact SP-visible agreement with the fresh parse
    merged.forEach((b, i) => {
      expect(b.anchors).toEqual(sides[i].anchors);
      expect(b.gaps.map((g) => g.sp)).toEqual(
        sides[i].gaps
      );
    });
    // the companion is still there, still in the gap
    // its break is in, still in block 0 — and it is
    // the only newline anywhere on the latin side
    expect(merged[0].gaps[500].latin).toBe("\n");
    expect(
      merged
        .flatMap((b) => b.gaps)
        .filter((g) => g.latin.includes("\n"))
    ).toHaveLength(1);
  });

  it("never leaks the paragraph sentinel into the " +
     "merged blocks", () => {
    const prev: Block[] = [
      blk([w("toki")], [["", ""], ["", ""]]),
      blk([w("pona")], [["", ""], ["", ""]]),
    ];
    const sides: ParsedSide[] = [
      parsedOf(blk([w("toki")], [["", ""], ["", ""]])),
      parsedOf(blk([w("kili")], [["", ""], ["", ""]])),
      parsedOf(blk([w("pona")], [["", ""], ["", ""]])),
    ];
    for (const b of structuralMerge(prev, sides)) {
      for (const a of b.anchors) {
        expect(isSentinel(a)).toBe(false);
      }
    }
  });
});

describe("LipuModel: reload pin", () => {
  it(
    "end-to-end: the user's minimal repro -- type " +
      "ona Enter wawa, save, reload -- keeps the " +
      "Enter companion through a second mount",
    () => {
      const editor1 = createSeededEditor("<p></p>", null);
      editor1.commands.focus("end");
      for (const ch of "ona") {
        editor1.commands.insertContent(ch);
      }
      // first Enter commits the autocomplete match
      // into a glyph (no break yet); the second
      // inserts the soft break LineBreaks owns, and
      // mergeBlock gives that fresh break its
      // companion latin "\n"
      simulateKeyDown(editor1, "Enter");
      simulateKeyDown(editor1, "Enter");
      for (const ch of "wawa") {
        editor1.commands.insertContent(ch);
      }

      const state1 = lipuModelKey.getState(editor1.state);
      expect(state1).toBeDefined();
      // the save payload, built exactly as
      // Editor.tsx's onTransaction builds it from
      // plugin state
      const payload = {
        lipu: state1!.lipu,
        content: lipuToContent(state1!.lipu),
      };
      editor1.destroy();

      expect(latinOf(payload.lipu)).toBe("ona\nwawa");

      // reload: a second editor mounts from the saved
      // payload (content + initialLipu), exactly as
      // the app's reload path does
      const editor2 = createSeededEditor(
        payload.content,
        payload.lipu
      );
      const state2 = lipuModelKey.getState(editor2.state);
      expect(state2).toBeDefined();
      expect(state2!.lipu).toEqual(payload.lipu);
      expect(latinOf(state2!.lipu)).toBe("ona\nwawa");

      editor2.destroy();
    }
  );
});

describe("minimal edit corpus (gates)", () => {
  // Every step asserts the full invariant set —
  // invariant 1 IS the byte gate: the doc equals
  // renderSp(lipu) at all times, so the editor
  // cannot tell the model swap happened.
  it("type, Enter, Enter-Enter split, join, " +
     "select-all retype, cartouche", () => {
    const editor = createEnterEditor("<p></p>");
    editor.commands.focus("end");
    const type = (s: string) =>
      editor.commands.insertContent(s);

    type(ucsur("toki"));
    assertInvariants(editor);

    type(" ");
    type(ucsur("pona"));
    assertInvariants(editor);
    // separation default: the shared gap carries
    // latin " "
    expect(gapsOf(editor, 0)[1].latin).toBe(" ");

    pressEnter(editor);
    assertInvariants(editor);
    // the Enter default: both sides of ONE gap.
    // Two anchors,
    // so the trailing gap is index 2.
    expect(gapsOf(editor, 0)[2]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });

    pressEnter(editor); // empty line -> split
    // COMPOSITION DWELL: the caret is still ON the fresh
    // empty line, so the split waits for it to
    // leave. The dwelled run is legal transient
    // model content — the invariants hold across it.
    assertInvariants(editor);
    expect(
      lipuModelKey.getState(editor.state)!.lipu.blocks
    ).toHaveLength(1);
    editor.commands.setTextSelection(1);
    assertInvariants(editor);
    expect(
      lipuModelKey.getState(editor.state)!.lipu.blocks
    ).toHaveLength(2);

    // join back (delete across the boundary)
    editor.commands.setTextSelection(
      editor.state.doc.child(0).nodeSize + 1
    );
    editor.commands.joinBackward();
    assertInvariants(editor);
    expect(
      lipuModelKey.getState(editor.state)!.lipu.blocks
    ).toHaveLength(1);

    // select-all retype: every prev anchor and owned
    // gap dies; only gaps[0] remains
    editor.commands.selectAll();
    type(ucsur("mute"));
    assertInvariants(editor);
    expect(blockOf(editor, 0).anchors).toEqual([
      { kind: "word", word: "mute" },
    ]);

    // cartouche typing promotes a span
    editor.commands.selectAll();
    type(
      CARTOUCHE_START + ucsur("toki") + CARTOUCHE_END
    );
    assertInvariants(editor);
    expect(blockOf(editor, 0).spans).toEqual([
      cart(0, 0),
    ]);
  });

  // The SAME gestures with a FOLLOWING paragraph
  // present. This variant is not redundant, and the
  // shape is load-bearing: the split must happen in a
  // paragraph that is NOT the last one. Only then
  // does the new empty paragraph sit BETWEEN two
  // boundaries, putting two ADJACENT sentinels in the
  // flat stream — the tie that the split-routing
  // defect (doc-merge correction (a)) rode on. The
  // single-paragraph corpus above, and a two-
  // paragraph variant that edits the LAST paragraph,
  // both leave every sentinel isolated and would NOT
  // have caught it. Mutation-verified against
  // `if (!inserted) return;`.
  it("same sequence with a FOLLOWING paragraph: the " +
     "neighbour survives and the seam is clean", () => {
    const editor = createEnterEditor(
      `<p></p><p>${ucsur("jan")}</p>`
    );
    // cursor in the FIRST paragraph
    editor.commands.setTextSelection(1);
    const type = (s: string) =>
      editor.commands.insertContent(s);

    type(ucsur("toki"));
    type(" ");
    type(ucsur("pona"));
    assertInvariants(editor);
    expect(gapsOf(editor, 0)[1].latin).toBe(" ");
    const neighbour = blockOf(editor, 1);

    pressEnter(editor);
    assertInvariants(editor);
    expect(gapsOf(editor, 0)[2]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });

    pressEnter(editor); // empty line -> split
    // COMPOSITION DWELL: crystallizes when the caret
    // leaves the run (see the corpus above).
    assertInvariants(editor);
    editor.commands.setTextSelection(1);
    assertInvariants(editor);
    expect(
      lipuModelKey.getState(editor.state)!.lipu.blocks
    ).toHaveLength(3);
    // Split behavior at a seam the LCS ties on: both
    // runs consumed, neither side keeps a "\n"
    expect(gapsOf(editor, 0).at(-1)!.latin).toBe("");
    expect(gapsOf(editor, 1)[0].latin).toBe("");
    // the untouched neighbour is untouched
    expect(blockOf(editor, 2)).toEqual(neighbour);

    // join back: cursor at the start of the empty
    // middle paragraph
    editor.commands.setTextSelection(
      editor.state.doc.child(0).nodeSize + 1
    );
    editor.commands.joinBackward();
    assertInvariants(editor);
    expect(
      lipuModelKey.getState(editor.state)!.lipu.blocks
    ).toHaveLength(2);
    expect(blockOf(editor, 1)).toEqual(neighbour);

    // select-all retype across BOTH paragraphs
    editor.commands.selectAll();
    type(ucsur("mute"));
    assertInvariants(editor);
    expect(
      lipuModelKey.getState(editor.state)!.lipu.blocks
    ).toHaveLength(1);
    expect(blockOf(editor, 0).anchors).toEqual([
      { kind: "word", word: "mute" },
    ]);

    editor.destroy();
  });
});

// The retired development-era storage loader used
// to exercise this seed gate live; this pins the
// gate against a hand-built Lipu carrying the same
// discriminating shape that loader's output used to:
// non-companion latin
// content a doc-derive can never regenerate.
describe("seed gate on a real initialLipu shape", () => {
  it("seeds plugin state from a stored doc's " +
    "Lipu, preserving latin content a re-derive " +
    "would drop", () => {
    // toki | break (companion "\n") | pona, plus a
    // non-companion latin ", " that docToLipu can
    // NEVER regenerate from the doc
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
            { sp: "\n", latin: ", \n" },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    };
    const editor = createSeededEditor(
      lipuToContent(up),
      up
    );
    const state = lipuModelKey.getState(
      editor.state
    );
    expect(state).toBeDefined();
    // IDENTITY, not equality: the gate seeded the
    // exact object instead of re-deriving
    expect(state!.lipu).toBe(up);
    // and the non-companion latin is present (the
    // content a docToLipu fallback would lose)
    const latins = state!.lipu.blocks[0].gaps.map(
      (g) => g.latin
    );
    expect(latins.join("|")).toContain(", ");
    editor.destroy();
  });

  it("re-derives (does not seed) when the lipu " +
    "disagrees with the doc", () => {
    const oneWord = (word: string): Lipu => ({
      version: 2,
      blocks: [
        {
          anchors: [{ kind: "word", word }],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    });
    const up = oneWord("toki");
    const other = oneWord("pona");
    const warn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const editor = createSeededEditor(
      lipuToContent(up),
      other
    );
    const state = lipuModelKey.getState(
      editor.state
    );
    expect(state!.lipu).not.toBe(other);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    editor.destroy();
  });
});

describe("letterish-guard boundary wiring", () => {
  it("normalizeLetterishLatinLipu leaves the SP " +
     "projection byte-identical (seed gate " +
     "compatibility)", () => {
    const lipu: Lipu = {
      version: 2,
      blocks: [
        {
          anchors: [
            { kind: "word", word: "toki" },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "\u0301x" },
          ],
          spans: [],
        },
      ],
    };
    const n = normalizeLetterishLatinLipu(lipu);
    expect(
      JSON.stringify(lipuToContent(n))
    ).toBe(JSON.stringify(lipuToContent(lipu)));
    expect(n.blocks[0].gaps[1].latin).toBe(
      " \u0301x"
    );
  });

  it("the separation boundary pass lifts a stored " +
     "doc below the separation fixpoint, SP bytes " +
     "untouched, second pass identity", () => {
    // saved before the ATOMIZATION RULE: the
    // NAMELESS cartouche exempted the shared gap, so
    // the stored doc renders latin "tokixq" and the
    // first Latin edit would fuse the two anchors
    // into one verbatim, destroying the toki glyph.
    const lipu: Lipu = {
      version: 2,
      blocks: [
        {
          anchors: [
            { kind: "word", word: "toki" },
            {
              kind: "verbatim",
              text: "xq",
              marked: true,
            },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [
            cart(1, 1),
          ],
        },
      ],
    };
    const n = applySeparationDefaultsLipu(lipu);
    expect(n.blocks[0].gaps[1].latin).toBe(" ");
    // SP projection byte-identical (seed gate)
    expect(
      JSON.stringify(lipuToContent(n))
    ).toBe(JSON.stringify(lipuToContent(lipu)));
    // idempotent: a second load changes nothing
    expect(applySeparationDefaultsLipu(n)).toBe(n);
    // ...and the lifted doc is Latin-no-op stable
    const b = n.blocks[0];
    expect(
      mergeLatinBlock(
        b,
        parseLatin(renderLatin(b).inlines)
      )
    ).toEqual(b);
  });
});
