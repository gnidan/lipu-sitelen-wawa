import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from
  "../extensions/sitelen-pona";
import { Verbatim } from "../extensions/verbatim";
import {
  LineBreaks,
  lineBreaksKey,
} from "../extensions/line-breaks";
import {
  LipuModel,
  lipuModelKey,
} from "../extensions/lipu-model";
import { lipuToContent } from "../lipu-doc";
import { minimalReplaceTr } from "../lipu-sync";
import {
  createLatinEditor,
  flushLatinEdits,
  latinAnchorClass,
  latinSyncState,
} from "./latin-editor";
import {
  latinDocContent,
  paragraphLatinInlines,
} from "./latin-doc";
import {
  FORCE,
  latinLineBreaksKey,
} from "./latin-line-breaks";
import { focusTracker } from "../focus-tracker";
import {
  canonicalSegments,
} from "../../../test/edit-corpus";
import { cart, glyph } from "../../../test/helpers";
import { renderLatin } from "../../lipu";
import type { Lipu } from "../../lipu";
import {
  CARTOUCHE_START,
  CARTOUCHE_END,
} from "../../lipu/chars";

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
        anchors: [
          { kind: "word", word: "toki" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: "", latin },
        ],
        spans: [],
      },
    ],
  };
}

/** post-handler invariant: latin doc
 *  structure === renderLatin(lipu) inlines,
 *  compared through the pinned
 *  canonicalization. */
function assertMirrors(
  sp: Editor,
  latin: Editor
): void {
  const st = lipuModelKey.getState(sp.state)!;
  expect(latin.state.doc.childCount).toBe(
    st.lipu.blocks.length
  );
  st.lipu.blocks.forEach((b, i) => {
    expect(
      canonicalSegments(
        paragraphLatinInlines(
          latin.state.doc.child(i)
        )
      )
    ).toEqual(
      canonicalSegments(renderLatin(b).inlines)
    );
  });
}

describe("createLatinEditor: SP -> Latin " +
         "reconcile", () => {
  it("seeds from the model and follows SP typing " +
     "live (structure-keyed, sync-flagged, " +
     "minimal)", () => {
    const sp = mkSp(lipu1("!"));
    const latin = createLatinEditor(sp);
    assertMirrors(sp, latin);
    // SP types a glyph at the end
    sp.commands.setTextSelection(
      sp.state.doc.content.size
    );
    sp.view.dispatch(
      sp.state.tr.insertText(glyph("pona"))
    );
    assertMirrors(sp, latin);
    latin.destroy();
    sp.destroy();
  });

  it("ships editable: true (both panes are " +
     "peers; the edit loop below is what makes " +
     "that safe)", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    expect(latin.isEditable).toBe(true);
    latin.destroy();
    sp.destroy();
  });

  it("a cartouche promotion swaps text for an " +
     "atom even though .text could look alike " +
     "(structure-keyed diff, not text-keyed)", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    // type [ toki ] around the glyph via direct
    // SP text edits: wrap with cartouche markers
    sp.commands.setTextSelection(1);
    sp.view.dispatch(
      sp.state.tr.insertText(CARTOUCHE_START)
    );
    sp.commands.setTextSelection(
      sp.state.doc.content.size
    );
    sp.view.dispatch(
      sp.state.tr.insertText(CARTOUCHE_END)
    );
    assertMirrors(sp, latin);
    const kinds: string[] = [];
    latin.state.doc
      .child(0)
      .forEach((c) => kinds.push(c.type.name));
    expect(kinds).toContain("latinName");
    latin.destroy();
    sp.destroy();
  });

  it("an atomization FLIP reconciles cleanly in " +
     "BOTH directions (emptying the name " +
     "de-atomizes the chip, refilling it " +
     "re-atomizes)", () => {
    // A cartouche covering [word, verbatim] has a
    // name (from the word) and atomizes; deleting
    // the word leaves the span alive over the
    // verbatim alone, which projects NO name — so
    // the atom becomes ordinary text. Re-inserting
    // a word inside flips it back. This is the
    // node-KIND change a text-keyed diff is blind
    // to.
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    sp.commands.setTextSelection(
      sp.state.doc.content.size
    );
    sp.view.dispatch(sp.state.tr.insertText("-"));
    sp.commands.setTextSelection(1);
    sp.view.dispatch(
      sp.state.tr.insertText(CARTOUCHE_START)
    );
    sp.commands.setTextSelection(
      sp.state.doc.content.size
    );
    sp.view.dispatch(
      sp.state.tr.insertText(CARTOUCHE_END)
    );
    const atomized = (): boolean => {
      let hit = false;
      latin.state.doc.child(0).forEach((c) => {
        if (c.type.name === "latinName") hit = true;
      });
      return hit;
    };
    assertMirrors(sp, latin);
    expect(atomized()).toBe(true);
    // delete the covered glyph (2 UTF-16 units,
    // right after the 2-unit start marker)
    sp.view.dispatch(sp.state.tr.delete(3, 5));
    assertMirrors(sp, latin);
    expect(atomized()).toBe(false);
    // ...because the name went EMPTY, not because
    // the span died — without this the pin would
    // stay green under span death, which is a
    // different phenomenon entirely (span death is
    // licensed; a silent no-op is not).
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].spans
    ).toHaveLength(1);
    expect(
      latin.state.doc.child(0).textContent
    ).toContain("-");
    // put a word back inside: it re-atomizes
    sp.commands.setTextSelection(3);
    sp.view.dispatch(
      sp.state.tr.insertText(glyph("mute"))
    );
    assertMirrors(sp, latin);
    expect(atomized()).toBe(true);
    latin.destroy();
    sp.destroy();
  });

  it("the diff is STRUCTURE-keyed where a text " +
     "diff is provably blind: a promotion that " +
     "leaves renderLatin's .text byte-identical " +
     "still reconciles, both directions", () => {
    // capital case + a whole-word name scheme:
    // wordLatin capitalizes to "Toki", and nameText
    // capitalizes the same fragment to "Toki". The
    // rendered TEXT is identical plain and
    // promoted; only the node KIND (text vs atom)
    // differs. A text-keyed diff sees nothing.
    const anchor = {
      kind: "word" as const,
      word: "toki",
      case: "capital" as const,
      nameScheme: { style: "word" as const },
    };
    const gaps = [
      { sp: "", latin: "" },
      { sp: "", latin: "" },
    ];
    const plain: Lipu = {
      version: 2,
      blocks: [{ anchors: [anchor], gaps, spans: [] }],
    };
    const promoted: Lipu = {
      version: 2,
      blocks: [
        {
          anchors: [anchor],
          gaps,
          spans: [
            cart(0, 0),
          ],
        },
      ],
    };
    // the premise, asserted rather than assumed
    expect(
      renderLatin(plain.blocks[0]).text
    ).toBe("Toki");
    expect(
      renderLatin(promoted.blocks[0]).text
    ).toBe(
      renderLatin(plain.blocks[0]).text
    );

    const spA = mkSp(plain);
    const latinA = createLatinEditor(spA);
    const spB = mkSp(promoted);
    const latinB = createLatinEditor(spB);

    // ...and the discrimination, stated over the
    // stream a text-keyed reconcile would compare:
    // the two DOCS carry the same inline text and
    // differ only in node kind.
    const streamText = (ed: Editor): string =>
      paragraphLatinInlines(ed.state.doc.child(0))
        .map((i) => i.text)
        .join("");
    expect(streamText(latinA)).toBe("Toki");
    expect(streamText(latinB)).toBe(
      streamText(latinA)
    );
    expect(
      latinA.state.doc.child(0).child(0).type.name
    ).toBe("text");
    expect(
      latinB.state.doc.child(0).child(0).type.name
    ).toBe("latinName");

    const fwd = minimalReplaceTr(
      latinA.state,
      latinDocContent(promoted)
    );
    expect(fwd).not.toBeNull();
    expect(fwd!.steps.length).toBeGreaterThan(0);

    const back = minimalReplaceTr(
      latinB.state,
      latinDocContent(plain)
    );
    expect(back).not.toBeNull();
    expect(back!.steps.length).toBeGreaterThan(0);

    latinA.destroy();
    spA.destroy();
    latinB.destroy();
    spB.destroy();
  });

  it("reconciles are sync-flagged and terminate: " +
     "quiescence after one pass, and the model " +
     "never changes from a reconcile", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    const v0 = lipuModelKey.getState(sp.state)!
      .version;
    let latinTrs = 0;
    latin.on("transaction", () => {
      latinTrs += 1;
    });
    sp.view.dispatch(
      sp.state.tr.insertText(glyph("mute"), 1)
    );
    expect(
      lipuModelKey.getState(sp.state)!.version
    ).toBe(v0 + 1);
    expect(latinTrs).toBe(1);
    latin.destroy();
    sp.destroy();
  });

  it("DEFERS the re-seed to composition end: no " +
     "dispatch while the latin view is composing " +
     "(composition deferral), then one catch-up " +
     "pass", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    // view.composing is a getter over the input
    // state; override it the way sync-guard's own
    // deferral test does.
    let composing = true;
    Object.defineProperty(latin.view, "composing", {
      configurable: true,
      get: () => composing,
    });
    let latinTrs = 0;
    latin.on("transaction", () => {
      latinTrs += 1;
    });
    sp.view.dispatch(
      sp.state.tr.insertText(glyph("mute"), 1)
    );
    expect(latinTrs).toBe(0);
    // a second SP edit mid-composition stays quiet
    sp.view.dispatch(
      sp.state.tr.insertText(glyph("pona"), 1)
    );
    expect(latinTrs).toBe(0);
    composing = false;
    latin.view.dom.dispatchEvent(
      new Event("compositionend")
    );
    expect(latinTrs).toBe(1);
    assertMirrors(sp, latin);
    latin.destroy();
    sp.destroy();
  });

  it("a model change with a BYTE-IDENTICAL latin " +
     "projection still redraws the decorations " +
     "(verbatim mark toggle; zero-step reconcile)",
     () => {
    // The decorations are a function of the MODEL,
    // not of the Latin doc: marking a provisional
    // verbatim changes anchor.marked and nothing
    // else, so the reconcile has no steps to
    // dispatch — and without the meta-only redraw
    // the pane would show latin-provisional
    // forever. Latin-LOCAL edits (zero SP
    // steps by construction) make this the normal
    // case, not the corner one.
    const sp = mkSp({
      version: 2,
      blocks: [
        {
          anchors: [
            { kind: "verbatim", text: "qqq" },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    });
    const latin = createLatinEditor(sp);
    const cls = (): string =>
      latin.view.dom.innerHTML;
    expect(cls()).toContain("latin-provisional");
    const before = latin.state.doc;
    sp.commands.setTextSelection({
      from: 1,
      to: sp.state.doc.content.size - 1,
    });
    sp.commands.setMark("verbatim");
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].anchors[0].marked
    ).toBe(true);
    // byte-identical projection: same doc, no steps
    expect(latin.state.doc.eq(before)).toBe(true);
    expect(cls()).toContain("latin-verbatim");
    expect(cls()).not.toContain(
      "latin-provisional"
    );
    latin.destroy();
    sp.destroy();
  });

  it("a selection-only SP transaction dispatches " +
     "nothing into the latin editor", () => {
    const sp = mkSp(lipu1("!"));
    const latin = createLatinEditor(sp);
    let latinTrs = 0;
    latin.on("transaction", () => {
      latinTrs += 1;
    });
    sp.commands.setTextSelection(1);
    expect(latinTrs).toBe(0);
    latin.destroy();
    sp.destroy();
  });

  it("destroy() detaches the SP listener", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    latin.destroy();
    // must not throw / touch the destroyed view
    sp.view.dispatch(
      sp.state.tr.insertText(glyph("pona"), 1)
    );
    sp.destroy();
  });

  it("anchor-class decorations key off the " +
     "model's latinMap (verbatim/provisional)",
     () => {
    const sp = mkSp({
      version: 2,
      blocks: [
        {
          anchors: [
            {
              kind: "verbatim",
              text: "zzz",
              marked: true,
            },
            { kind: "verbatim", text: "qqq" },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: "　", latin: " " },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    });
    const latin = createLatinEditor(sp);
    const html = latin.view.dom.innerHTML;
    expect(html).toContain("latin-verbatim");
    expect(html).toContain("latin-provisional");
    latin.destroy();
    sp.destroy();
  });

  it("spacing cosmetic: 'toki \\npona' keeps " +
     "its space before the break in the doc (CSS " +
     "pre-wrap makes it visible)", () => {
    const sp = mkSp({
      version: 2,
      blocks: [
        {
          anchors: [
            { kind: "word", word: "toki" },
            { kind: "word", word: "pona" },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: " \n" },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    });
    const latin = createLatinEditor(sp);
    const first = latin.state.doc
      .child(0)
      .child(0);
    expect(first.text).toBe("toki ");
    expect(
      latin.state.doc.child(0).child(1).type.name
    ).toBe("hardBreak");
    latin.destroy();
    sp.destroy();
  });

  it("latinAnchorClass: words, marked and " +
     "unmarked verbatims", () => {
    expect(
      latinAnchorClass({ kind: "word", word: "toki" })
    ).toBe("latin-word");
    expect(
      latinAnchorClass({
        kind: "verbatim",
        text: "x",
        marked: true,
      })
    ).toBe("latin-verbatim");
    expect(
      latinAnchorClass({
        kind: "verbatim",
        text: "x",
      })
    ).toBe("latin-verbatim latin-provisional");
  });
});

/** A REAL keydown through the view's DOM handler,
 *  so the whole handleKeyDown chain runs: PM's
 *  editHandler -> every plugin's handleKeyDown in
 *  plugin order -> the core baseKeymap (splitBlock).
 *  Dispatching the transaction directly, as the
 *  other Enter tests do, proves the crystallization
 *  rule but proves NOTHING about which handler wins
 *  the key. */
function pressEnter(
  latin: Editor,
  shiftKey = false
): void {
  latin.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      shiftKey,
      bubbles: true,
      cancelable: true,
    })
  );
}

describe("Latin Enter: the KEYMAP path", () => {
  it("plain Enter is handled by latinLineBreaks, " +
     "not by the core splitBlock keymap: one " +
     "hardBreak, still ONE block", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    pressEnter(latin);
    // the KEY reached our handler (a dead chain
    // would leave the doc untouched, and a lost
    // race would split the paragraph)
    expect(latin.state.doc.childCount).toBe(1);
    let breaks = 0;
    latin.state.doc.descendants((n) => {
      if (n.type.name === "hardBreak") breaks += 1;
    });
    expect(breaks).toBe(1);
    const st = lipuModelKey.getState(sp.state)!;
    expect(st.lipu.blocks).toHaveLength(1);
    expect(
      st.lipu.blocks[0].gaps[1].latin
    ).toBe("\n");
    // the standing SP-join ruling's other half: no
    // SP break was created
    expect(st.lipu.blocks[0].gaps[1].sp).toBe("");
    assertMirrors(sp, latin);
    latin.destroy();
    sp.destroy();
  });

  it("Shift+Enter also stays Latin-LOCAL (our " +
     "handler declines it; StarterKit's hardBreak " +
     "binding takes it — neither splits)", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    pressEnter(latin, true);
    expect(latin.state.doc.childCount).toBe(1);
    const st = lipuModelKey.getState(sp.state)!;
    expect(st.lipu.blocks).toHaveLength(1);
    expect(
      st.lipu.blocks[0].gaps[1].latin
    ).toBe("\n");
    assertMirrors(sp, latin);
    latin.destroy();
    sp.destroy();
  });

  it("Enter-Enter through the keymap, then a " +
     "caret leave, crystallizes exactly one " +
     "Block split", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    pressEnter(latin);
    pressEnter(latin);
    // dwelled: the writer is still on the run
    expect(
      lipuModelKey.getState(sp.state)!.lipu.blocks
    ).toHaveLength(1);
    expect(latin.state.doc.childCount).toBe(1);
    latin.commands.setTextSelection(1);
    expect(
      lipuModelKey.getState(sp.state)!.lipu.blocks
    ).toHaveLength(2);
    expect(latin.state.doc.childCount).toBe(2);
    assertMirrors(sp, latin);
    latin.destroy();
    sp.destroy();
  });
});

describe("Latin -> SP edit loop", () => {
  it("punctuation typed in the latin pane is " +
     "Latin-LOCAL: gap.latin gains it, the SP " +
     "doc is untouched, the version advances",
     () => {
    const sp = mkSp(lipu1("!"));
    const latin = createLatinEditor(sp);
    const spDocBefore = sp.state.doc;
    const v0 = lipuModelKey.getState(sp.state)!
      .version;
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    latin.view.dispatch(
      latin.state.tr.insertText(",")
    );
    const st = lipuModelKey.getState(sp.state)!;
    expect(
      st.lipu.blocks[0].gaps[1].latin
    ).toBe("!,");
    expect(st.version).toBe(v0 + 1);
    expect(sp.state.doc).toBe(spDocBefore);
    latin.destroy();
    sp.destroy();
  });

  it("FULL CYCLE quiescence: one latin keystroke " +
     "produces ONE sp dispatch and ONE render-" +
     "back, and the latin handler does not " +
     "re-fire on its own reconcile", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    latin.commands.setTextSelection(5);
    let spTrs = 0;
    let latinTrs = 0;
    let processed = 0;
    sp.on("transaction", () => {
      spTrs += 1;
    });
    latin.on("transaction", ({ transaction }) => {
      latinTrs += 1;
      // "genuine" from the loop's own point of
      // view: what onLatinTr would have parsed.
      if (
        transaction.docChanged &&
        transaction.getMeta("latinSync") === undefined
      ) {
        processed += 1;
      }
    });
    const v0 = lipuModelKey.getState(sp.state)!
      .version;
    latin.view.dispatch(
      latin.state.tr.insertText("s")
    );
    // one adoption, one version bump
    expect(spTrs).toBe(1);
    expect(
      lipuModelKey.getState(sp.state)!.version
    ).toBe(v0 + 1);
    // the keystroke, plus at most the meta-only
    // render-back; never a re-parsed second round
    expect(processed).toBe(1);
    expect(latinTrs).toBeLessThanOrEqual(2);
    // AT REST: an SP selection-only pass changes
    // nothing on either side.
    const spDoc = sp.state.doc;
    const latinDoc = latin.state.doc;
    sp.commands.setTextSelection(1);
    expect(sp.state.doc).toBe(spDoc);
    expect(latin.state.doc).toBe(latinDoc);
    assertMirrors(sp, latin);
    latin.destroy();
    sp.destroy();
  });

  it("a GENUINE transaction arriving MID-FLIGHT " +
     "is queued and drained, never dropped (the " +
     "silent-divergence failure mode)", () => {
    const sp = mkSp(lipu1("!"));
    const latin = createLatinEditor(sp);
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    // An SP transaction handler that types into the
    // Latin pane exactly once. It runs INSIDE the
    // edit loop's own SP dispatch, i.e. with
    // inFlight set and prevState already advanced —
    // the one window where a dropped transaction
    // would leave the model describing bytes the
    // doc no longer holds, silently, forever.
    let fired = false;
    const intruder = (): void => {
      if (fired) return;
      fired = true;
      latin.view.dispatch(
        latin.state.tr.insertText(
          "?",
          latin.state.doc.content.size - 1
        )
      );
    };
    sp.on("transaction", intruder);
    latin.view.dispatch(
      latin.state.tr.insertText(",")
    );
    sp.off("transaction", intruder);
    expect(fired).toBe(true);
    expect(
      latinSyncState(latin)!.pendingEdit
    ).toBe(false);
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].gaps[1].latin
    ).toBe("!,?");
    expect(
      latin.state.doc.child(0).textContent
    ).toBe("toki!,?");
    assertMirrors(sp, latin);
    latin.destroy();
    sp.destroy();
  });

  it("an unknown Latin word becomes a MARKED " +
     "VERBATIM in SP; completing it back to a " +
     "word swaps the glyph in", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    // "toki" -> "tokis" (append s at the word's
    // end: pm pos = 1 + length of "toki")
    latin.commands.setTextSelection(5);
    latin.view.dispatch(
      latin.state.tr.insertText("s")
    );
    let st = lipuModelKey.getState(sp.state)!;
    expect(st.lipu.blocks[0].anchors).toEqual([
      {
        kind: "verbatim",
        text: "tokis",
        marked: true,
      },
    ]);
    expect(
      sp.state.doc.textContent
    ).toContain("tokis");
    // delete the s -> word again -> glyph back
    latin.view.dispatch(
      latin.state.tr.delete(5, 6)
    );
    st = lipuModelKey.getState(sp.state)!;
    expect(st.lipu.blocks[0].anchors).toEqual([
      { kind: "word", word: "toki" },
    ]);
    expect(
      sp.state.doc.textContent
    ).toBe(glyph("toki"));
    latin.destroy();
    sp.destroy();
  });

  it("Latin Enter is LOCAL: \\n lands in " +
     "gap.latin, no SP break is created", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    latin.view.dispatch(
      latin.state.tr.replaceSelectionWith(
        latin.state.schema.nodes.hardBreak.create()
      )
    );
    const st = lipuModelKey.getState(sp.state)!;
    expect(
      st.lipu.blocks[0].gaps[1].latin
    ).toBe("\n");
    expect(st.lipu.blocks).toHaveLength(1);
    let breaks = 0;
    sp.state.doc.descendants((n) => {
      if (n.type.name === "hardBreak") {
        breaks += 1;
      }
    });
    expect(breaks).toBe(0);
    latin.destroy();
    sp.destroy();
  });

  it("Enter-Enter then caret-leave crystallizes " +
     "a Block split (structural class: the " +
     "caret keeps the BlockPos it moved to)",
     () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    const end = latin.state.doc.content.size;
    latin.commands.setTextSelection(end);
    const br = (): void => {
      latin.view.dispatch(
        latin.state.tr.replaceSelectionWith(
          latin.state.schema.nodes.hardBreak.create()
        )
      );
    };
    br();
    br();
    // still one block: the run is dwelled
    expect(
      lipuModelKey.getState(sp.state)!.lipu.blocks
    ).toHaveLength(1);
    // ...and the transient "\n\n" is legal model
    // content while the writer is on it.
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].gaps[1].latin
    ).toBe("\n\n");
    // caret leaves the run
    latin.commands.setTextSelection(1);
    const st = lipuModelKey.getState(sp.state)!;
    expect(st.lipu.blocks).toHaveLength(2);
    expect(latin.state.doc.childCount).toBe(2);
    // The caret rule across an intentional split:
    // the caret
    // moved to pos 1 (block 0, offset 0) BEFORE the
    // crystallization, and the render-back keeps
    // that BlockPos.
    expect(latin.state.selection.head).toBe(1);
    assertMirrors(sp, latin);
    latin.destroy();
    sp.destroy();
  });

  it("Latin JOIN: seam collapse at editor " +
     "level; a subsequent SP pass appends " +
     "nothing (no derive-back ping-pong)", () => {
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
          anchors: [{ kind: "word", word: "pona" }],
          gaps: [
            { sp: "\n", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    });
    const latin = createLatinEditor(sp);
    // join paragraphs: delete the boundary
    const boundary = latin.state.doc.child(0)
      .nodeSize;
    latin.commands.setTextSelection(boundary + 1);
    latin.view.dispatch(
      latin.state.tr.delete(
        boundary - 1,
        boundary + 1
      )
    );
    const st = lipuModelKey.getState(sp.state)!;
    expect(st.lipu.blocks).toHaveLength(1);
    // THE EXACT SEAM PAIR, per the LATIN-JOIN SEAM
    // AMENDMENT: a latin join leaves EXACTLY ONE sp
    // "\n" at the seam. Asserting only the absence of
    // "\n\n" was satisfied by over-collapsing the gap
    // to "" — which destroys an SP byte and is the
    // failure this pin exists to catch.
    expect(st.lipu.blocks[0].gaps[1]).toEqual({
      sp: "\n",
      latin: "\n",
    });
    for (const g of st.lipu.blocks[0].gaps) {
      expect(g.sp.includes("\n\n")).toBe(false);
    }
    // quiescence: an SP selection-only pass
    // appends nothing
    const doc0 = sp.state.doc;
    sp.commands.setTextSelection(1);
    expect(sp.state.doc).toBe(doc0);
    assertMirrors(sp, latin);
    latin.destroy();
    sp.destroy();
  });

  it("FUSION GUARD: joining 'toki'/'mi' " +
     "injects ' ' (both words survive; caret " +
     "after the space); deleting the space " +
     "fuses them into ONE marked verbatim", () => {
    const sp = mkSp({
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
          anchors: [{ kind: "word", word: "mi" }],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    });
    const latin = createLatinEditor(sp);
    const boundary = latin.state.doc.child(0)
      .nodeSize;
    // a Backspace at the head of paragraph 2: the
    // caret starts where the join will happen.
    latin.commands.setTextSelection(boundary + 1);
    latin.view.dispatch(
      latin.state.tr.delete(
        boundary - 1,
        boundary + 1
      )
    );
    let st = lipuModelKey.getState(sp.state)!;
    expect(
      st.lipu.blocks[0].anchors.map((a) => a.word)
    ).toEqual(["toki", "mi"]);
    expect(
      st.lipu.blocks[0].gaps[1].latin
    ).toBe(" ");
    // The caret rule, fusion class. Arithmetic:
    // the joined
    // paragraph is "tokimi", so the caret sat at pm
    // 1 + 4 = 5 (block 0, offset 4 — the seam). The
    // render-back inserts " " AT 5, and assoc 1
    // puts the caret after it: 6 == 1 + len("toki ")
    expect(latin.state.doc.child(0).textContent)
      .toBe("toki mi");
    expect(latin.state.selection.head).toBe(6);
    // The accepted fusion: delete the space ->
    // one marked
    // verbatim "tokimi" (glyphs replaced)
    latin.view.dispatch(
      latin.state.tr.delete(5, 6)
    );
    st = lipuModelKey.getState(sp.state)!;
    expect(st.lipu.blocks[0].anchors).toEqual([
      {
        kind: "verbatim",
        text: "tokimi",
        marked: true,
      },
    ]);
    latin.destroy();
    sp.destroy();
  });

  it("FUSION GUARD chip exemption, end to end: " +
     "joining a chip-ending paragraph onto a word " +
     "injects NOTHING (a text-level predicate " +
     "would see letters and mint a space with no " +
     "gap to live in)", () => {
    const sp = mkSp({
      version: 2,
      blocks: [
        {
          anchors: [{ kind: "word", word: "toki" }],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [
            cart(0, 0),
          ],
        },
        {
          anchors: [{ kind: "word", word: "mi" }],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    });
    const latin = createLatinEditor(sp);
    // the premise: block 0 ends in an ATOM
    expect(
      latin.state.doc.child(0).child(0).type.name
    ).toBe("latinName");
    const boundary = latin.state.doc.child(0)
      .nodeSize;
    latin.commands.setTextSelection(boundary + 1);
    latin.view.dispatch(
      latin.state.tr.delete(
        boundary - 1,
        boundary + 1
      )
    );
    const st = lipuModelKey.getState(sp.state)!;
    expect(st.lipu.blocks).toHaveLength(1);
    for (const g of st.lipu.blocks[0].gaps) {
      expect(g.latin).toBe("");
    }
    assertMirrors(sp, latin);
    latin.destroy();
    sp.destroy();
  });

  it("chip deletion is span death", () => {
    const sp = mkSp({
      version: 2,
      blocks: [
        {
          anchors: [{ kind: "word", word: "toki" }],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [
            cart(0, 0),
          ],
        },
      ],
    });
    const latin = createLatinEditor(sp);
    // the doc is a single atom: delete it
    latin.view.dispatch(
      latin.state.tr.delete(1, 2)
    );
    const st = lipuModelKey.getState(sp.state)!;
    expect(st.lipu.blocks[0].anchors)
      .toHaveLength(0);
    expect(st.lipu.blocks[0].spans)
      .toHaveLength(0);
    latin.destroy();
    sp.destroy();
  });

  it("SPAN DEATH BY TEXT EDIT: a NAMELESS " +
     "cartouche's covered text is ordinary " +
     "editable Latin, and an edit that changes " +
     "the anchor's KIND kills the span — no chip " +
     "appears", () => {
    // A cartouche over a VERBATIM projects an empty
    // name (nameText only reads word anchors), so
    // it never atomizes: the covered "qqq" is plain
    // text in the Latin doc. Typing over it makes a
    // WORD anchor, and the span kind-change rule
    // forbids the span from
    // following a replacement pairing onto an
    // anchor of a different kind.
    const sp = mkSp({
      version: 2,
      blocks: [
        {
          anchors: [
            {
              kind: "verbatim",
              text: "qqq",
              marked: true,
            },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [
            cart(0, 0),
          ],
        },
      ],
    });
    const latin = createLatinEditor(sp);
    // the premise: no chip, just text
    expect(
      latin.state.doc.child(0).child(0).type.name
    ).toBe("text");
    expect(
      latin.state.doc.child(0).textContent
    ).toBe("qqq");
    latin.view.dispatch(
      latin.state.tr.insertText("toki", 1, 4)
    );
    const st = lipuModelKey.getState(sp.state)!;
    expect(st.lipu.blocks[0].anchors).toEqual([
      { kind: "word", word: "toki" },
    ]);
    expect(st.lipu.blocks[0].spans).toHaveLength(0);
    let chips = 0;
    latin.state.doc.descendants((n) => {
      if (n.type.name === "latinName") chips += 1;
    });
    expect(chips).toBe(0);
    assertMirrors(sp, latin);
    latin.destroy();
    sp.destroy();
  });

  it("ERROR POLICY: a thrown sync clears the " +
     "flag, re-seeds the latin doc from the " +
     "model, loses only the failed keystroke, " +
     "and the next edit works", () => {
    const sp = mkSp(lipu1("!"));
    const latin = createLatinEditor(sp);
    const st0 = lipuModelKey.getState(sp.state)!;
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    latinSyncState(latin)!.forceError = true;
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    latin.view.dispatch(
      latin.state.tr.insertText("z")
    );
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    // model unchanged; latin re-seeded (the "z"
    // is gone); flag cleared
    const st1 = lipuModelKey.getState(sp.state)!;
    expect(st1.lipu).toEqual(st0.lipu);
    expect(
      latin.state.doc.textContent
    ).not.toContain("z");
    expect(
      latinSyncState(latin)!.inFlight
    ).toBe(false);
    latinSyncState(latin)!.forceError = false;
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    latin.view.dispatch(
      latin.state.tr.insertText(",")
    );
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].gaps[1].latin
    ).toBe("!,");
    latin.destroy();
    sp.destroy();
  });

  it("edits during composition are queued " +
     "(latest wins) and flush at " +
     "compositionend; SP shows pre-composition " +
     "state meanwhile", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    const st = latinSyncState(latin)!;
    st.composing = true;
    latin.commands.setTextSelection(5);
    latin.view.dispatch(
      latin.state.tr.insertText("s")
    );
    // suspended: model unchanged
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].anchors[0].word
    ).toBe("toki");
    expect(st.pendingEdit).toBe(true);
    st.composing = false;
    flushLatinEdits(latin);
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].anchors[0]
    ).toEqual({
      kind: "verbatim",
      text: "tokis",
      marked: true,
    });
    latin.destroy();
    sp.destroy();
  });

  it("an edit deferred because the SP editor " +
     "was composing flushes at the SP editor's " +
     "compositionend", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    let composing = true;
    Object.defineProperty(sp.view, "composing", {
      configurable: true,
      get: () => composing,
    });
    latin.commands.setTextSelection(5);
    latin.view.dispatch(
      latin.state.tr.insertText("s")
    );
    expect(
      latinSyncState(latin)!.pendingEdit
    ).toBe(true);
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].anchors[0].word
    ).toBe("toki");
    composing = false;
    sp.view.dom.dispatchEvent(
      new Event("compositionend")
    );
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].anchors[0]
    ).toEqual({
      kind: "verbatim",
      text: "tokis",
      marked: true,
    });
    latin.destroy();
    sp.destroy();
  });

  it("error recovery under composition: it is a " +
     "QUEUED FLAG, so the re-seed happens at " +
     "compositionend and never mid-IME", () => {
    const sp = mkSp(lipu1("!"));
    const latin = createLatinEditor(sp);
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const st = latinSyncState(latin)!;
    st.composing = true;
    st.forceError = true;
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    latin.view.dispatch(
      latin.state.tr.insertText("z")
    );
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    // still composing: the bad doc stands, nothing
    // was dispatched into the composing editor
    expect(st.reSeedQueued).toBe(true);
    expect(
      latin.state.doc.textContent
    ).toContain("z");
    st.forceError = false;
    st.composing = false;
    latin.view.dom.dispatchEvent(
      new Event("compositionend")
    );
    expect(st.reSeedQueued).toBe(false);
    expect(
      latin.state.doc.textContent
    ).not.toContain("z");
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].gaps[1].latin
    ).toBe("!");
    latin.destroy();
    sp.destroy();
  });

  it("the error policy on the FLUSH path: a " +
     "throw inside the " +
     "compositionend flush is contained, logged " +
     "and recovered — it never escapes into the " +
     "DOM handler", () => {
    const sp = mkSp(lipu1("!"));
    const latin = createLatinEditor(sp);
    const st = latinSyncState(latin)!;
    st.composing = true;
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    latin.view.dispatch(
      latin.state.tr.insertText("z")
    );
    expect(st.pendingEdit).toBe(true);
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    st.forceError = true;
    st.composing = false;
    expect(() => {
      latin.view.dom.dispatchEvent(
        new Event("compositionend")
      );
    }).not.toThrow();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    st.forceError = false;
    // recovered: model untouched, doc re-seeded
    // from it, flags clear
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].gaps[1].latin
    ).toBe("!");
    expect(
      latin.state.doc.textContent
    ).not.toContain("z");
    expect(st.inFlight).toBe(false);
    expect(st.pendingEdit).toBe(false);
    assertMirrors(sp, latin);
    latin.destroy();
    sp.destroy();
  });

  it("crystallization is suspended by the VIEW's " +
     "live IME state too, not only by the loop's " +
     "own composing flag", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    let composing = true;
    Object.defineProperty(latin.view, "composing", {
      configurable: true,
      get: () => composing,
    });
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    const br = (): void => {
      latin.view.dispatch(
        latin.state.tr.replaceSelectionWith(
          latin.state.schema.nodes.hardBreak.create()
        )
      );
    };
    br();
    br();
    // the caret leaves the run WHILE the browser is
    // composing: no split may be appended under the
    // input method.
    latin.commands.setTextSelection(1);
    expect(latin.state.doc.childCount).toBe(1);
    composing = false;
    latin.view.dom.dispatchEvent(
      new Event("compositionend")
    );
    // ...and the deferred edit lands intact
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].gaps[1].latin
    ).toBe("\n\n");
    latin.destroy();
    sp.destroy();
  });

  it("a destroyed SP editor cannot be dispatched " +
     "into: a latin edit after sp.destroy() is a " +
     "no-op, not a throw", () => {
    const sp = mkSp(lipu1("!"));
    const latin = createLatinEditor(sp);
    sp.destroy();
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    expect(() => {
      latin.view.dispatch(
        latin.state.tr.insertText(",")
      );
    }).not.toThrow();
    expect(
      latin.state.doc.textContent
    ).toBe("toki!,");
    latin.destroy();
  });

  it("the caret rule: an ordinary keystroke " +
     "keeps the " +
     "caret's BlockPos through the render-back",
     () => {
    const sp = mkSp(lipu1("!"));
    const latin = createLatinEditor(sp);
    latin.commands.setTextSelection(3);
    latin.view.dispatch(
      latin.state.tr.insertText(",", 3)
    );
    // caret sits after the inserted char
    expect(latin.state.selection.head).toBe(4);
    latin.destroy();
    sp.destroy();
  });

  it("a sync-flagged reconcile never crystallizes " +
     "an at-rest '\\n\\n' run: the model " +
     "keeps its two breaks across an unrelated " +
     "SP edit", () => {
    const sp = mkSp({
      version: 2,
      blocks: [
        {
          anchors: [{ kind: "word", word: "toki" }],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "\n\n" },
          ],
          spans: [],
        },
      ],
    });
    const latin = createLatinEditor(sp);
    expect(latin.state.doc.childCount).toBe(1);
    // an SP edit reconciles into the latin doc; the
    // run must survive as content.
    sp.commands.setTextSelection(1);
    sp.view.dispatch(
      sp.state.tr.insertText(glyph("pona"), 1)
    );
    expect(latin.state.doc.childCount).toBe(1);
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks[0].gaps[2].latin
    ).toBe("\n\n");
    latin.destroy();
    sp.destroy();
  });
});

/**
 * FOCUS RULES. The three SP
 * blur consumers and the Latin one all defer to the
 * FocusTracker's microtask settle, which is the
 * first moment blur-to-PEER is distinguishable from
 * a TRUE blur. Blur-to-peer must not force
 * crystallization (the dwell CARRIES); a true blur
 * keeps today's semantics.
 */
describe("focus rules (blur-to-peer, pane close)",
         () => {
  afterEach(() => {
    // the tracker is a module singleton: leave it
    // neutral so unrelated tests evaluate as today
    focusTracker.reset();
  });

  const settle = (): Promise<void> =>
    new Promise((r) =>
      queueMicrotask(() => r())
    );

  /** what a real blur does: every plugin's blur
   *  handler, in plugin order. */
  const blurSp = (sp: Editor): void => {
    const plugin = lineBreaksKey.get(sp.state)!;
    const handler =
      plugin.props.handleDOMEvents!.blur!;
    handler.call(
      plugin,
      sp.view,
      new FocusEvent("blur")
    );
  };

  const spBreak = (sp: Editor): void => {
    sp.view.dispatch(
      sp.state.tr.replaceSelectionWith(
        sp.state.schema.nodes.hardBreak.create()
      )
    );
  };

  it("blur-to-peer: an SP dwelled run CARRIES " +
     "(no crystallization) and crystallizes " +
     "after refocus + caret leave", async () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    focusTracker.reset();
    focusTracker.notifyFocus("sp");
    // SP builds a dwelled "\n\n" run at the end
    sp.commands.setTextSelection(
      sp.state.doc.content.size
    );
    spBreak(sp);
    spBreak(sp);
    expect(sp.state.doc.childCount).toBe(1);
    // blur to the peer: NOT a forced pass
    blurSp(sp);
    focusTracker.notifyFocus("latin");
    await settle();
    expect(sp.state.doc.childCount).toBe(1);
    // while the latin pane holds focus, SP caret
    // moves do NOT crystallize (dwell suspended
    // = carried)
    sp.commands.setTextSelection(1);
    expect(sp.state.doc.childCount).toBe(1);
    // refocus SP and put the caret back on the run
    // (a repeat of the SAME position dispatches a
    // selection-EQUAL transaction, which the
    // normalizer skips by design), then leave it
    focusTracker.notifyFocus("sp");
    sp.commands.setTextSelection(
      sp.state.doc.content.size - 1
    );
    expect(sp.state.doc.childCount).toBe(1);
    sp.commands.setTextSelection(1);
    expect(sp.state.doc.childCount).toBe(2);
    latin.destroy();
    sp.destroy();
  });

  it("TRUE blur still forces (unanswered blur " +
     "settles null), and only at the SETTLE", async () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    focusTracker.reset();
    focusTracker.notifyFocus("sp");
    sp.commands.setTextSelection(
      sp.state.doc.content.size
    );
    spBreak(sp);
    spBreak(sp);
    blurSp(sp);
    // DEFERRED: the forced pass has not run yet
    // (a synchronous dispatch would already have
    // split the block here)
    expect(sp.state.doc.childCount).toBe(1);
    await settle();
    expect(sp.state.doc.childCount).toBe(2);
    latin.destroy();
    sp.destroy();
  });

  it("latin blur-to-peer CARRIES, latin true blur " +
     "crystallizes at the settle", async () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    focusTracker.reset();
    focusTracker.notifyFocus("latin");
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    const br = (): void => {
      latin.view.dispatch(
        latin.state.tr.replaceSelectionWith(
          latin.state.schema.nodes.hardBreak
            .create()
        )
      );
    };
    br();
    br();
    expect(
      lipuModelKey.getState(sp.state)!.lipu.blocks
    ).toHaveLength(1);
    // blur to the SP pane: the run carries
    latin.view.dom.dispatchEvent(
      new FocusEvent("blur")
    );
    focusTracker.notifyFocus("sp");
    await settle();
    expect(
      lipuModelKey.getState(sp.state)!.lipu.blocks
    ).toHaveLength(1);
    // now a TRUE blur: crystallizes at the settle
    focusTracker.notifyFocus("latin");
    latin.view.dom.dispatchEvent(
      new FocusEvent("blur")
    );
    expect(
      lipuModelKey.getState(sp.state)!.lipu.blocks
    ).toHaveLength(1);
    await settle();
    expect(
      lipuModelKey.getState(sp.state)!.lipu.blocks
    ).toHaveLength(2);
    latin.destroy();
    sp.destroy();
  });

  it("while the SP pane holds focus a latin run " +
     "is CARRIED too (mirrored): a latin " +
     "caret move does not crystallize it", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    focusTracker.reset();
    focusTracker.notifyFocus("latin");
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    const br = (): void => {
      latin.view.dispatch(
        latin.state.tr.replaceSelectionWith(
          latin.state.schema.nodes.hardBreak
            .create()
        )
      );
    };
    br();
    br();
    const blocks = (): number =>
      lipuModelKey.getState(sp.state)!.lipu.blocks
        .length;
    expect(blocks()).toBe(1);
    // focus hops to the SP pane; the run carries
    focusTracker.notifyFocus("sp");
    latin.commands.setTextSelection(1);
    expect(blocks()).toBe(1);
    // back on the latin pane, leaving the run
    // crystallizes it as usual
    focusTracker.notifyFocus("latin");
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    expect(blocks()).toBe(1);
    latin.commands.setTextSelection(1);
    expect(blocks()).toBe(2);
    latin.destroy();
    sp.destroy();
  });

  it("pane close: a pending latin \\n\\n run " +
     "crystallizes into the model BEFORE the " +
     "pane is gone (FORCE dispatch)", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    // the live shape of this gesture: the run was
    // built in the latin pane, focus hopped to SP
    // (the run CARRIED), and the close click lands
    // with SP focused — the forced pass must beat
    // the peer-focus suspension.
    focusTracker.reset();
    focusTracker.notifyFocus("latin");
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    const br = (): void => {
      latin.view.dispatch(
        latin.state.tr.replaceSelectionWith(
          latin.state.schema.nodes.hardBreak
            .create()
        )
      );
    };
    br();
    br();
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks
    ).toHaveLength(1);
    focusTracker.notifyFocus("sp");
    // what App.tsx's close branch dispatches:
    latin.view.dispatch(
      latin.state.tr.setMeta(
        latinLineBreaksKey,
        FORCE
      )
    );
    expect(
      lipuModelKey.getState(sp.state)!.lipu
        .blocks
    ).toHaveLength(2);
    latin.destroy();
    sp.destroy();
  });

  it("cross-pane dwell interleaving: SP edits a " +
     "block while the latin pane holds an " +
     "uncrystallized run; the merge operates on " +
     "the transient and the run survives", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    focusTracker.reset();
    focusTracker.notifyFocus("latin");
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    const br = (): void => {
      latin.view.dispatch(
        latin.state.tr.replaceSelectionWith(
          latin.state.schema.nodes.hardBreak
            .create()
        )
      );
    };
    br();
    br();
    const gapBefore = lipuModelKey.getState(
      sp.state
    )!.lipu.blocks[0].gaps[1].latin;
    expect(gapBefore).toBe("\n\n");
    // SP appends a glyph to the same block
    sp.commands.setTextSelection(1);
    sp.view.dispatch(
      sp.state.tr.insertText(glyph("pona"), 1)
    );
    const st = lipuModelKey.getState(sp.state)!;
    expect(st.lipu.blocks).toHaveLength(1);
    expect(
      st.lipu.blocks[0].gaps[
        st.lipu.blocks[0].gaps.length - 1
      ].latin
    ).toBe("\n\n");
    latin.destroy();
    sp.destroy();
  });
});
