import { describe, it, expect } from "vitest";
import {
  projectBlock,
  projectLipu,
  blockMaps,
  copyText,
} from "./latin-projections";
import type { Block, Lipu } from "../lipu";
import { cart } from "../../test/helpers";

function gap(sp = "", latin = "") {
  return { sp, latin };
}
function word(w: string) {
  return { kind: "word" as const, word: w };
}

describe("projectBlock memoization", () => {
  it("returns the SAME object for the same " +
     "Block identity", () => {
    const b: Block = {
      anchors: [word("toki")],
      gaps: [gap(), gap()],
      spans: [],
    };
    const first = projectBlock(b);
    const second = projectBlock(b);
    expect(second).toBe(first);
  });

  it("returns a NEW object for an equal-but-" +
     "distinct Block", () => {
    const b: Block = {
      anchors: [word("toki")],
      gaps: [gap(), gap()],
      spans: [],
    };
    const clone: Block = {
      anchors: [word("toki")],
      gaps: [gap(), gap()],
      spans: [],
    };
    const first = projectBlock(b);
    const second = projectBlock(clone);
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });
});

describe("projectLipu / blockMaps", () => {
  it("projects each block and exposes its maps", () => {
    const lipu: Lipu = {
      version: 2,
      blocks: [
        {
          anchors: [word("toki")],
          gaps: [gap(), gap()],
          spans: [],
        },
        {
          anchors: [word("pona")],
          gaps: [gap(), gap()],
          spans: [],
        },
      ],
    };
    const projections = projectLipu(lipu);
    expect(projections).toHaveLength(2);
    const maps = blockMaps(projections);
    expect(maps).toHaveLength(2);
    expect(maps[0]).toEqual({
      sp: projections[0].spMap,
      latin: projections[0].latinMap,
      spans: projections[0].block.spans,
    });
  });
});

describe("copyText", () => {
  it(
    "joins inline text, blocks as newlines, " +
      "cartouche atom text included",
    () => {
      // Ported from an earlier implementation's
      // token fixture: two
      // letter-adjacent word pairs each carry the
      // separation-default latin " "; the
      // (companion-less) break before the
      // cartouche used to synthesize a separator
      // space too, so its gap gets an explicit
      // latin " " here (the default supplies exactly
      // what the old converter synthesized).
      const block1: Block = {
        anchors: [
          word("toki"),
          word("pona"),
          {
            kind: "word",
            word: "nena",
            nameScheme: { style: "morae", count: 2 },
          },
        ],
        gaps: [
          gap(),
          gap(" ", " "),
          gap("\n", " "),
          gap(),
        ],
        spans: [
          cart(2, 2),
        ],
      };
      const block2: Block = {
        anchors: [word("pona")],
        gaps: [gap(), gap()],
        spans: [],
      };
      const lipu: Lipu = {
        version: 2,
        blocks: [block1, block2],
      };
      const projections = projectLipu(lipu);
      expect(copyText(projections)).toBe(
        "toki pona Nena\n\npona"
      );
    }
  );

  it(
    "a companion-less break is one separator " +
      "space; the block boundary is still two " +
      "newlines",
    () => {
      const block1: Block = {
        anchors: [word("toki"), word("pona")],
        gaps: [gap(), gap("\n", " "), gap()],
        spans: [],
      };
      const block2: Block = {
        anchors: [word("jan")],
        gaps: [gap(), gap()],
        spans: [],
      };
      const lipu: Lipu = {
        version: 2,
        blocks: [block1, block2],
      };
      const projections = projectLipu(lipu);
      expect(copyText(projections)).toBe(
        "toki pona" + "\n\n" + "jan"
      );
    }
  );

  it(
    "a break with its companion newline copies as " +
      "a real line break",
    () => {
      // What the editor-merge layer produces for a
      // break the user actually typed (the Enter
      // default writes both sides of one gap):
      // the sp "\n" lands in the gap, and the SAME
      // gap's latin gets an appended "\n" — no
      // separator space needed since the companion
      // already supplies the line break.
      const block: Block = {
        anchors: [word("toki"), word("pona")],
        gaps: [gap(), gap("\n", "\n"), gap()],
        spans: [],
      };
      const lipu: Lipu = {
        version: 2,
        blocks: [block],
      };
      expect(copyText(projectLipu(lipu))).toBe(
        "toki\npona"
      );
    }
  );
});

describe("copy-output deltas vs the older toLatin " +
  "converter", () => {
  it(
    "consecutive sp spaces: the gap stores ONE " +
      "latin space, so copyText has one " +
      "where the older toLatin synthesized two",
    () => {
      const block: Block = {
        anchors: [word("toki"), word("pona")],
        gaps: [gap(), gap("  ", " "), gap()],
        spans: [],
      };
      const lipu: Lipu = { version: 2, blocks: [block] };
      expect(copyText(projectLipu(lipu))).toBe(
        "toki pona"
      );
    }
  );

  it(
    "leading sp space on a line: an empty " +
      "gap.latin means copyText has nothing, " +
      "where the older toLatin kept the leading " +
      "space",
    () => {
      const block: Block = {
        anchors: [word("toki")],
        gaps: [gap(" ", ""), gap()],
        spans: [],
      };
      const lipu: Lipu = { version: 2, blocks: [block] };
      expect(copyText(projectLipu(lipu))).toBe("toki");
    }
  );

  it(
    "a standalone structural/arrow gap char has " +
      "no latin form (a delta: the older toLatin " +
      "passed the arrow char through; the model has " +
      "no gap.latin content to pass)",
    () => {
      const block: Block = {
        anchors: [],
        gaps: [gap("←", "")],
        spans: [],
      };
      const lipu: Lipu = { version: 2, blocks: [block] };
      expect(copyText(projectLipu(lipu))).toBe("");
    }
  );
});
