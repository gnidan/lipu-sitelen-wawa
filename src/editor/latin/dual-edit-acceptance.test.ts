import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from
  "../extensions/sitelen-pona";
import { Verbatim } from "../extensions/verbatim";
import { LineBreaks } from
  "../extensions/line-breaks";
import {
  LipuModel,
  lipuModelKey,
} from "../extensions/lipu-model";
import { lipuToContent } from "../lipu-doc";
import {
  createLatinEditor,
  flushLatinEdits,
} from "./latin-editor";
import type { Lipu } from "../../lipu";
import { glyph } from "../../../test/helpers";

/**
 * DUAL-EDIT ACCEPTANCE PINS.
 *
 * Every dual-edit acceptance criterion that
 * is machine-checkable at the two-editor level gets
 * its pin here; the ones already pinned elsewhere
 * (the persistence class tests, the JOIN SEAM RULE,
 * shared undo) are not duplicated. These are deliberately
 * end-to-end: they drive REAL editors through REAL
 * gestures and read the model back, so any wiring
 * regression in the loop surfaces here even when the
 * unit coverage stays green.
 */

function mkSp(lipu: Lipu): Editor {
  return new Editor({
    extensions: [
      LineBreaks,
      LipuModel.configure({ initialLipu: lipu }),
      StarterKit.configure({ history: false }),
      SitelenPona,
      Verbatim,
    ],
    content: lipuToContent(lipu),
  });
}

function lipu1(latin: string): Lipu {
  return {
    version: 2,
    blocks: [
      {
        anchors: [{ kind: "word", word: "toki" }],
        gaps: [
          { sp: "", latin: "" },
          { sp: "", latin },
        ],
        spans: [],
      },
    ],
  };
}

describe("dual-edit acceptance pins", () => {
  it("type freely in either pane; the other " +
     "follows live", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    // latin -> sp
    latin.commands.setTextSelection(5);
    latin.view.dispatch(
      latin.state.tr.insertText(" pona")
    );
    expect(
      lipuModelKey
        .getState(sp.state)!
        .lipu.blocks[0].anchors.map((a) => a.word)
    ).toEqual(["toki", "pona"]);
    // ...and the SP pane shows both glyphs live
    expect(sp.state.doc.textContent).toContain(
      glyph("pona")
    );
    // sp -> latin
    sp.commands.setTextSelection(1);
    sp.view.dispatch(
      sp.state.tr.insertText(glyph("mute"), 1)
    );
    expect(latin.state.doc.textContent).toContain(
      "mute"
    );
    latin.destroy();
    sp.destroy();
  });

  it("an SP verbatim MARK survives the " +
     "satellite derivation of a latin edit that " +
     "re-derives the marked node", () => {
    const sp = mkSp({
      version: 2,
      blocks: [
        {
          anchors: [
            {
              kind: "verbatim",
              text: "xyz",
              marked: true,
            },
            { kind: "word", word: "toki" },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: " ", latin: " " },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    });
    const latin = createLatinEditor(sp);
    // The edit lands INSIDE the verbatim on purpose.
    // A latin-LOCAL edit elsewhere (a trailing "!",
    // say) produces zero SP steps — minimalReplaceTr
    // returns null and the SP node is never touched,
    // so asserting the mark would only be reading the
    // seed back. Changing the anchor's own text forces
    // the node to be re-derived from renderSp, which
    // is the derivation under test.
    latin.commands.setTextSelection(4);
    latin.view.dispatch(
      latin.state.tr.insertText("q")
    );
    // the mark is still on the model, on the edited
    // anchor...
    const anchor = lipuModelKey.getState(sp.state)!
      .lipu.blocks[0].anchors[0];
    expect(anchor.text).toBe("xyzq");
    expect(anchor.marked).toBe(true);
    // ...and on the SP doc's re-derived text node
    let marked = false;
    sp.state.doc.descendants((n) => {
      if (
        n.isText &&
        n.text === "xyzq" &&
        n.marks.some(
          (m) => m.type.name === "verbatim"
        )
      ) {
        marked = true;
      }
    });
    expect(marked).toBe(true);
    latin.destroy();
    sp.destroy();
  });

  it("pane close/reopen is INERT: a stored " +
     "\\n\\n gap.latin run does NOT crystallize " +
     "on (re)mount", () => {
    const sp = mkSp(lipu1("\n\n"));
    const l1 = createLatinEditor(sp);
    expect(
      lipuModelKey.getState(sp.state)!.lipu.blocks
    ).toHaveLength(1);
    l1.destroy();
    const l2 = createLatinEditor(sp);
    expect(
      lipuModelKey.getState(sp.state)!.lipu.blocks
    ).toHaveLength(1);
    // ...and the model never moved at all: mount is
    // not an edit, so the version is still the
    // seed's
    expect(
      lipuModelKey.getState(sp.state)!.version
    ).toBe(0);
    l2.destroy();
    sp.destroy();
  });

  it("a latin edit while the SP editor is " +
     "composing defers until SP compositionend",
     () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    Object.defineProperty(sp.view, "composing", {
      value: true,
      configurable: true,
    });
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    latin.view.dispatch(
      latin.state.tr.insertText(",")
    );
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].gaps[1].latin
    ).toBe("");
    Object.defineProperty(sp.view, "composing", {
      value: false,
      configurable: true,
    });
    flushLatinEdits(latin);
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].gaps[1].latin
    ).toBe(",");
    latin.destroy();
    sp.destroy();
  });

  it("joins from any COUNT-CHANGING gesture " +
     "behave identically: keymap-style join and " +
     "selection-delete join give the seam the " +
     "SAME treatment", () => {
    // Both blocks carry an SP break at the seam and
    // NO latin one. That is the shape where the JOIN
    // SEAM RULE has work to do: the join would
    // otherwise leave gap.sp "\n\n" (the derive-back
    // ping-pong
    // the rule exists to kill), and there is no latin
    // run for the crystallizer to split back out.
    const seed = (): {
      sp: Editor;
      latin: Editor;
    } => {
      const sp = mkSp({
        version: 2,
        blocks: [
          {
            anchors: [
              { kind: "word", word: "toki" },
            ],
            gaps: [
              { sp: "", latin: "" },
              { sp: "\n", latin: "" },
            ],
            spans: [],
          },
          {
            anchors: [
              { kind: "word", word: "pona" },
            ],
            gaps: [
              { sp: "\n", latin: "" },
              { sp: "", latin: "" },
            ],
            spans: [],
          },
        ],
      });
      return { sp, latin: createLatinEditor(sp) };
    };
    const a = seed();
    const boundaryA = a.latin.state.doc.child(0)
      .nodeSize;
    a.latin.view.dispatch(
      a.latin.state.tr.delete(
        boundaryA - 1,
        boundaryA + 1
      )
    );
    const lipuA = lipuModelKey.getState(a.sp.state)!
      .lipu;
    const b = seed();
    // selection-delete spanning the boundary plus
    // one char each side
    const boundaryB = b.latin.state.doc.child(0)
      .nodeSize;
    b.latin.view.dispatch(
      b.latin.state.tr.delete(
        boundaryB - 2,
        boundaryB + 2
      )
    );
    const lipuB = lipuModelKey.getState(b.sp.state)!
      .lipu;
    // both joined to ONE block with the seam rule
    // applied; the gestures differ only in the extra
    // characters the second one deleted, so what has
    // to MATCH is the seam gap itself — one "\n",
    // not one per dead sentinel
    expect(lipuA.blocks).toHaveLength(1);
    expect(lipuB.blocks).toHaveLength(1);
    expect(lipuA.blocks[0].gaps[1].sp).toBe("\n");
    expect(lipuB.blocks[0].gaps[1].sp).toBe(
      lipuA.blocks[0].gaps[1].sp
    );
    for (const l of [lipuA, lipuB]) {
      for (const g of l.blocks[0].gaps) {
        expect(g.sp.includes("\n\n")).toBe(false);
      }
    }
    a.latin.destroy();
    a.sp.destroy();
    b.latin.destroy();
    b.sp.destroy();
  });

  /**
   * THE LATIN-JOIN SEAM INVENTION, pinned at the
   * level it was first hit live:
   * two PLAIN paragraphs — no seam newline anywhere —
   * joined from the Latin pane used to leave the SP
   * pane with the two glyphs run together on one line
   * ("󱥬󱥔"), a line break destroyed by a gesture in
   * the other pane. The rule now leaves EXACTLY ONE
   * sp "\n" at the seam: collapse a run to one, or
   * INVENT one when none existed. Mirror of the
   * standing "SP-join leaves Latin '\n'" rule.
   * Discrimination: revert the invention in
   * collapseSeamRuns and this pin reads back the old
   * run-together output (gap.sp "", zero hardBreaks).
   */
  it("LATIN-JOIN SEAM: joining two PLAIN paragraphs " +
     "from the Latin pane leaves the SP pane a line " +
     "break, not run-together glyphs", () => {
    const plain = (word: string) => ({
      anchors: [{ kind: "word" as const, word }],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    });
    const sp = mkSp({
      version: 2,
      blocks: [plain("toki"), plain("pona")],
    });
    const latin = createLatinEditor(sp);
    const boundary = latin.state.doc.child(0).nodeSize;
    latin.view.dispatch(
      latin.state.tr.delete(boundary - 1, boundary + 1)
    );
    const lipu = lipuModelKey.getState(sp.state)!.lipu;
    expect(lipu.blocks).toHaveLength(1);
    expect(
      lipu.blocks[0].anchors.map((a) => a.word)
    ).toEqual(["toki", "pona"]);
    // the invented seam break, and the fusion guard's
    // " " on the parse-authoritative latin side
    expect(lipu.blocks[0].gaps[1]).toEqual({
      sp: "\n",
      latin: " ",
    });
    // ...and the SP pane really shows it: ONE
    // paragraph (a single "\n" is a soft break, so
    // nothing re-crystallizes) holding glyph, break,
    // glyph.
    expect(sp.state.doc.childCount).toBe(1);
    const kinds: string[] = [];
    sp.state.doc.child(0).forEach((n) => {
      kinds.push(n.isText ? n.text! : n.type.name);
    });
    expect(kinds).toEqual([
      glyph("toki"),
      "hardBreak",
      glyph("pona"),
    ]);
    latin.destroy();
    sp.destroy();
  });

  /**
   * TASK-3 LEDGER (deferred minor, now pinned): the
   * JOIN SEAM RULE docstring claims multi-seam joins
   * work — "two seams landing in one output gap
   * collapse it once" — and that claim was probed at
   * the time but never pinned. One gesture, two dead
   * sentinels: the caret sweeps from the end of the
   * first paragraph through the start of the third,
   * taking the empty paragraph between them with it.
   */
  it("MULTI-SEAM join: one gesture killing TWO " +
     "sentinels collapses the shared output gap " +
     "once (collapseSeamRuns' docstring claim)",
     () => {
    const sp = mkSp({
      version: 2,
      blocks: [
        {
          anchors: [{ kind: "word", word: "toki" }],
          gaps: [
            { sp: "", latin: "" },
            { sp: "\n", latin: "\n" },
          ],
          spans: [],
        },
        {
          anchors: [],
          gaps: [{ sp: "\n", latin: "\n" }],
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
    });
    const latin = createLatinEditor(sp);
    expect(latin.state.doc.childCount).toBe(3);
    const p0 = latin.state.doc.child(0).nodeSize;
    const p1 = latin.state.doc.child(1).nodeSize;
    latin.view.dispatch(
      latin.state.tr.delete(p0 - 1, p0 + p1 + 1)
    );
    const lipu = lipuModelKey.getState(sp.state)!
      .lipu;
    expect(lipu.blocks).toHaveLength(1);
    // both words survive the join...
    expect(
      lipu.blocks[0].anchors.map((a) => a.word)
    ).toEqual(["toki", "pona"]);
    // ...and no gap carries a run on either side:
    // the two seams that landed in one gap were
    // collapsed once, not once per seam
    for (const g of lipu.blocks[0].gaps) {
      expect(g.sp.includes("\n\n")).toBe(false);
      expect(g.latin.includes("\n\n")).toBe(false);
    }
    latin.destroy();
    sp.destroy();
  });
});
