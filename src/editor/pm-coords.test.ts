import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { LipuModel } from "./extensions/lipu-model";
import { SitelenPona } from "./extensions/sitelen-pona";
import { Verbatim } from "./extensions/verbatim";
import { lipuToContent } from "./lipu-doc";
import type { Lipu } from "../lipu";
import {
  pmToBlockOffset,
  blockOffsetToPm,
} from "./pm-coords";

/**
 * Create an editor from a lipu (mirrors the
 * pattern from lipu-doc.test.ts)
 */
function createEditorFromLipu(lipu: Lipu) {
  return new Editor({
    extensions: [LipuModel, StarterKit, SitelenPona, Verbatim],
    content: lipuToContent(lipu),
  });
}

describe("pmToBlockOffset / blockOffsetToPm", () => {
  describe("with two paragraphs", () => {
    let doc: any;
    let editor: Editor;

    beforeEach(() => {
      // Fixture with block 0 having 4 units of
      // content and block 1 having 3 units,
      // matching the expected positions:
      // p0 content 1..4, p1 starts at 6, content 7..9
      const gap = { sp: "", latin: "" };
      const lipu: Lipu = {
        version: 2,
        blocks: [
          {
            anchors: [
              { kind: "word", word: "toki" },
              { kind: "word", word: "pona" },
            ],
            gaps: [gap, gap, gap],
            spans: [],
          },
          {
            anchors: [
              { kind: "word", word: "mute" },
              { kind: "verbatim", text: "x" },
            ],
            gaps: [gap, gap, gap],
            spans: [],
          },
        ],
      };
      editor = createEditorFromLipu(lipu);
      doc = editor.state.doc;
    });

    afterEach(() => {
      editor.destroy();
    });

    it("maps positions inside blocks", () => {
      expect(pmToBlockOffset(doc, 3))
        .toEqual({ block: 0, offset: 2 });
      expect(pmToBlockOffset(doc, 8))
        .toEqual({ block: 1, offset: 1 });
    });

    it(
      "round-trips through blockOffsetToPm",
      () => {
        for (const c of [
          { block: 0, offset: 0 },
          { block: 0, offset: 4 },
          { block: 1, offset: 2 },
        ]) {
          expect(
            pmToBlockOffset(
              doc,
              blockOffsetToPm(doc, c.block, c.offset)
            )
          ).toEqual(c);
        }
      }
    );

    it(
      "snaps depth-0 boundary positions to the " +
        "following block start",
      () => {
        // pos 6 sits between the paragraphs
        expect(pmToBlockOffset(doc, 6))
          .toEqual({ block: 1, offset: 0 });
      }
    );

    it(
      "maps doc-end position to last block end " +
        "(regression: was incorrectly snapping to " +
        "start, breaking cross-block highlights)",
      () => {
        const lastBlock = doc.child(doc.childCount - 1);
        const lastBlockEnd = {
          block: doc.childCount - 1,
          offset: lastBlock.content.size,
        };
        expect(pmToBlockOffset(doc, doc.content.size))
          .toEqual(lastBlockEnd);
        // Round-trip: doc-end offset converts back
        // to a position that maps to itself
        const pmPos =
          blockOffsetToPm(doc, lastBlockEnd.block, lastBlockEnd.offset);
        expect(pmToBlockOffset(doc, pmPos))
          .toEqual(lastBlockEnd);
      }
    );
  });

  describe("with hardBreak", () => {
    let doc: any;
    let editor: Editor;

    beforeEach(() => {
      const lipu: Lipu = {
        version: 2,
        blocks: [
          {
            anchors: [
              { kind: "word", word: "toki" },
              { kind: "word", word: "pona" },
            ],
            // a break is gap.sp "\n" in the model
            gaps: [
              { sp: "", latin: "" },
              { sp: "\n", latin: "\n" },
              { sp: "", latin: "" },
            ],
            spans: [],
          },
        ],
      };
      editor = createEditorFromLipu(lipu);
      doc = editor.state.doc;
    });

    afterEach(() => {
      editor.destroy();
    });

    it("counts hardBreak as one unit", () => {
      // Glyphs are UTF-16 surrogates (2 units each);
      // breaks count as 1 unit like all atoms.
      // Block offsets: toki at 0-1 (2 units),
      // hardBreak at 2 (1 unit), pona at 3-4
      // (2 units).

      // Position at start of toki
      expect(pmToBlockOffset(doc, 1))
        .toEqual({ block: 0, offset: 0 });
      // Position at hardBreak
      expect(pmToBlockOffset(doc, 2))
        .toEqual({ block: 0, offset: 1 });
      // Position immediately after break (start
      // of pona) — proves break counted as 1 unit
      const ponaStartPos = blockOffsetToPm(
        doc,
        0,
        3 // offset after break
      );
      expect(pmToBlockOffset(doc, ponaStartPos))
        .toEqual({ block: 0, offset: 3 });
    });
  });
});
