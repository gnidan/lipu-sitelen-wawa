import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeEach,
} from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from "./sitelen-pona";
import { Verbatim } from "./verbatim";
import { LineBreaks } from "./line-breaks";
import {
  LipuModel,
  lipuModelKey,
} from "./lipu-model";
import { PasteHandler, pasteHandlerKey } from
  "./paste-handler";
import {
  clampBlockPos,
  HISTORY_DEPTH,
  LipuHistory,
  lipuHistoryKey,
  sharedRedo,
  sharedUndo,
} from "./lipu-history";
import { lipuToContent } from "../lipu-doc";
import {
  createLatinEditor,
  latinSyncState,
} from "../latin/latin-editor";
import { latinDocContent } from
  "../latin/latin-doc";
import {
  LATIN_SYNC_META,
  LIPU_SYNC_META,
  minimalReplaceTr,
} from "../lipu-sync";
import { TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { focusTracker } from "../focus-tracker";
import type { PaneId } from "../focus-tracker";
import type { Lipu } from "../../lipu";
import {
  codepointToChar,
  wordToCodepoint,
} from "../../data";

const glyph = (w: string): string =>
  codepointToChar(wordToCodepoint[w]);

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

/** DECLARATION ORDER IS LOAD-BEARING. TipTap
 *  REVERSES the extension array when it builds the
 *  plugin list, so a plugin declared BEFORE another
 *  runs AFTER it — lipu-history must be declared
 *  BEFORE lipu-model to have its state.apply see the
 *  model's ADVANCED version. The "records the
 *  advanced version" and "misordered" pins below are
 *  what hold this. */
function mkSp(lipu: Lipu): Editor {
  return new Editor({
    extensions: [
      LineBreaks,
      LipuHistory,
      LipuModel.configure({ initialLipu: lipu }),
      StarterKit.configure({ history: false }),
      SitelenPona,
      Verbatim,
      PasteHandler,
    ],
    content: lipuToContent(lipu),
  });
}

/** Mirrors prosemirror-keymap's own Mod resolution,
 *  so the pin holds on either platform. */
const MOD = /Mac|iP(hone|[oa]d)/.test(
  navigator.platform
)
  ? { metaKey: true }
  : { ctrlKey: true };

/** Through the DOM, not through the command: the
 *  whole handleKeyDown chain runs, so this is what
 *  proves Cmd+Z REACHES the shared stack rather
 *  than some other handler. */
function pressUndo(
  ed: Editor,
  shiftKey = false
): void {
  ed.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      shiftKey,
      ...MOD,
      bubbles: true,
      cancelable: true,
    })
  );
}

const doneOf = (sp: Editor) =>
  lipuHistoryKey.getState(sp.state)!.done;

describe("shared lipu-layer undo", () => {
  beforeEach(() => focusTracker.reset());
  afterEach(() => focusTracker.reset());

  it(
    "records SP edits; undo adopts lipuBefore via " +
      "derived steps; version advances so the save " +
      "trigger fires",
    () => {
      const sp = mkSp(lipu1(""));
      const st0 = lipuModelKey.getState(sp.state)!;
      sp.commands.setTextSelection(
        sp.state.doc.content.size
      );
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("pona"))
      );
      const stEdit = lipuModelKey.getState(
        sp.state
      )!;
      expect(stEdit.version).toBe(st0.version + 1);
      expect(sharedUndo(sp)).toBe(true);
      const stUndo = lipuModelKey.getState(
        sp.state
      )!;
      expect(stUndo.lipu).toEqual(st0.lipu);
      // Undo ADVANCES the version (the save
      // trigger in Editor.tsx is version-keyed).
      expect(stUndo.version).toBe(
        stEdit.version + 1
      );
      expect(sp.state.doc.textContent).toBe(
        glyph("toki")
      );
      expect(sharedRedo(sp)).toBe(true);
      const stRedo = lipuModelKey.getState(
        sp.state
      )!;
      expect(stRedo.lipu).toEqual(stEdit.lipu);
      expect(stRedo.version).toBe(
        stUndo.version + 1
      );
      sp.destroy();
    }
  );

  it(
    "undo/redo round-trip restores the lipu " +
      "BYTE-IDENTICALLY (both directions)",
    () => {
      const sp = mkSp(lipu1("hi"));
      const before = JSON.stringify(
        lipuModelKey.getState(sp.state)!.lipu
      );
      sp.commands.setTextSelection(
        sp.state.doc.content.size
      );
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("pona"))
      );
      const after = JSON.stringify(
        lipuModelKey.getState(sp.state)!.lipu
      );
      expect(after).not.toBe(before);
      sharedUndo(sp);
      expect(
        JSON.stringify(
          lipuModelKey.getState(sp.state)!.lipu
        )
      ).toBe(before);
      sharedRedo(sp);
      expect(
        JSON.stringify(
          lipuModelKey.getState(sp.state)!.lipu
        )
      ).toBe(after);
      sp.destroy();
    }
  );

  it("undo/redo on an empty stack return false", () => {
    const sp = mkSp(lipu1(""));
    expect(sharedUndo(sp)).toBe(false);
    expect(sharedRedo(sp)).toBe(false);
    sp.destroy();
  });

  it(
    "PM-style coalescing: two quick keystrokes = " +
      "one entry; a SIDE SWITCH closes the group",
    () => {
      const sp = mkSp(lipu1(""));
      const latin = createLatinEditor(sp);
      sp.commands.setTextSelection(
        sp.state.doc.content.size
      );
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("pona"))
      );
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("mute"))
      );
      expect(doneOf(sp)).toHaveLength(1);
      // latin keystroke -> new entry (side switch)
      latin.commands.setTextSelection(
        latin.state.doc.content.size
      );
      latin.view.dispatch(
        latin.state.tr.insertText(",")
      );
      expect(doneOf(sp)).toHaveLength(2);
      // one undo removes ONLY the latin edit...
      sharedUndo(sp);
      expect(
        lipuModelKey
          .getState(sp.state)!
          .lipu.blocks[0].gaps.at(-1)!.latin
      ).toBe("");
      // ...the next removes BOTH sp keystrokes
      sharedUndo(sp);
      expect(
        lipuModelKey.getState(sp.state)!.lipu
          .blocks[0].anchors
      ).toHaveLength(1);
      latin.destroy();
      sp.destroy();
    }
  );

  it(
    "a TIME GAP closes the group (NEW_GROUP_MS)",
    () => {
      const sp = mkSp(lipu1(""));
      sp.commands.setTextSelection(
        sp.state.doc.content.size
      );
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("pona"))
      );
      const spy = vi
        .spyOn(Date, "now")
        .mockReturnValue(Date.now() + 60_000);
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("mute"))
      );
      spy.mockRestore();
      expect(doneOf(sp)).toHaveLength(2);
      sp.destroy();
    }
  );

  it("a PASTE closes the group (paste meta)", () => {
    // EVERY insert here is INSIDE the paragraph (at
    // offset 1) and inside NEW_GROUP_MS, on the same
    // side: the block count never moves, so the
    // paste rule is the ONLY rule that can split
    // these three edits into three entries. (An
    // insert at doc.content.size would sit at the
    // DOC level and mint a paragraph — the
    // structural rule would then satisfy the
    // assertions with the paste rule deleted.)
    const sp = mkSp(lipu1(""));
    sp.view.dispatch(
      sp.state.tr.insertText(glyph("pona"), 1)
    );
    expect(doneOf(sp)).toHaveLength(1);
    const tr = sp.state.tr.insertText(
      glyph("mute"),
      1
    );
    tr.setMeta(pasteHandlerKey, { paste: true });
    sp.view.dispatch(tr);
    expect(sp.state.doc.childCount).toBe(1);
    expect(doneOf(sp)).toHaveLength(2);
    // and the group is CLOSED after it: the next
    // keystroke does not merge into the paste
    sp.view.dispatch(
      sp.state.tr.insertText(glyph("toki"), 1)
    );
    expect(sp.state.doc.childCount).toBe(1);
    expect(doneOf(sp)).toHaveLength(3);
    sp.destroy();
  });

  it(
    'origin "history" NEVER records: undo/redo move ' +
      "entries, mint none",
    () => {
      const sp = mkSp(lipu1(""));
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("pona"), 1)
      );
      const h0 = lipuHistoryKey.getState(sp.state)!;
      expect(h0.done).toHaveLength(1);
      sharedUndo(sp);
      const h1 = lipuHistoryKey.getState(sp.state)!;
      expect(h1.done).toHaveLength(0);
      expect(h1.undone).toHaveLength(1);
      sharedRedo(sp);
      const h2 = lipuHistoryKey.getState(sp.state)!;
      expect(h2.done).toHaveLength(1);
      expect(h2.undone).toHaveLength(0);
      sp.destroy();
    }
  );

  it(
    "a new edit after an undo clears the redo stack",
    () => {
      const sp = mkSp(lipu1(""));
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("pona"), 1)
      );
      sharedUndo(sp);
      expect(
        lipuHistoryKey.getState(sp.state)!.undone
      ).toHaveLength(1);
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("mute"), 1)
      );
      expect(
        lipuHistoryKey.getState(sp.state)!.undone
      ).toHaveLength(0);
      expect(sharedRedo(sp)).toBe(false);
      sp.destroy();
    }
  );

  it(
    "the production guard's correction (a " +
      "re-adoption of " +
      "the SAME lipu) records NO entry",
    () => {
      const sp = mkSp(lipu1(""));
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("pona"), 1)
      );
      const st = lipuModelKey.getState(sp.state)!;
      expect(doneOf(sp)).toHaveLength(1);
      const top = doneOf(sp)[0];
      // OUTSIDE the coalescing window, deliberately:
      // inside it, a deleted identity guard would
      // merge the correction into the top entry and
      // the length assertion below would still pass.
      // At +60s the missing guard MINTS a dead entry.
      const spy = vi
        .spyOn(Date, "now")
        .mockReturnValue(Date.now() + 60_000);
      // exactly what sync-guard.ts dispatches: the
      // model's OWN lipu, origin "edit", zero steps
      const tr = sp.state.tr;
      tr.setMeta(LIPU_SYNC_META, {
        lipu: st.lipu,
        originSide: "sp",
        origin: "edit",
        latinSelBefore: null,
        latinSelAfter: null,
      });
      tr.setMeta("addToHistory", false);
      sp.view.dispatch(tr);
      spy.mockRestore();
      // the version ADVANCED (saves still fire)...
      expect(
        lipuModelKey.getState(sp.state)!.version
      ).toBe(st.version + 1);
      // ...but no dead undo step was minted, and the
      // surviving entry is the SAME object (nothing
      // was coalesced into it either)
      expect(doneOf(sp)).toHaveLength(1);
      expect(doneOf(sp)[0]).toBe(top);
      sp.destroy();
    }
  );

  it(
    "a structural change is its own entry and " +
      "closes the group (crystallization chain = " +
      "two entries)",
    () => {
      const sp = mkSp(lipu1(""));
      const latin = createLatinEditor(sp);
      latin.commands.setTextSelection(
        latin.state.doc.content.size
      );
      const br = () =>
        latin.view.dispatch(
          latin.state.tr.replaceSelectionWith(
            latin.state.schema.nodes.hardBreak.create()
          )
        );
      br();
      br();
      // typing group: the two Enters coalesced
      const preCryst = doneOf(sp).length;
      expect(preCryst).toBe(1);
      // caret-leave crystallizes -> structural
      // merge -> its OWN entry
      latin.commands.setTextSelection(1);
      expect(doneOf(sp).length).toBe(preCryst + 1);
      // UNDO-CANCELS-COMPOSE half: undo the
      // crystallization, then undo the typing group
      // -> pre-run state in two steps; undo BEFORE
      // crystallization would have been one
      sharedUndo(sp);
      expect(
        lipuModelKey.getState(sp.state)!.lipu.blocks
      ).toHaveLength(1);
      sharedUndo(sp);
      expect(
        lipuModelKey.getState(sp.state)!.lipu
          .blocks[0].gaps[1].latin
      ).toBe("");
      latin.destroy();
      sp.destroy();
    }
  );

  it(
    "undo-cancels-compose: with the run still " +
      "transient, ONE undo returns to pre-run state",
    () => {
      const sp = mkSp(lipu1(""));
      const latin = createLatinEditor(sp);
      latin.commands.setTextSelection(
        latin.state.doc.content.size
      );
      const br = () =>
        latin.view.dispatch(
          latin.state.tr.replaceSelectionWith(
            latin.state.schema.nodes.hardBreak.create()
          )
        );
      br();
      br();
      sharedUndo(sp);
      expect(
        lipuModelKey.getState(sp.state)!.lipu
          .blocks[0].gaps[1].latin
      ).toBe("");
      // The restored transient run is NOT
      // re-crystallized by the restore itself
      expect(
        lipuModelKey.getState(sp.state)!.lipu.blocks
      ).toHaveLength(1);
      latin.destroy();
      sp.destroy();
    }
  );

  it(
    "a Latin-LOCAL edit (zero SP steps) is UNDOABLE " +
      "(a doc-step history could never see it)",
    () => {
      const sp = mkSp(lipu1(""));
      const latin = createLatinEditor(sp);
      const spDoc = sp.state.doc;
      latin.commands.setTextSelection(
        latin.state.doc.content.size
      );
      latin.view.dispatch(
        latin.state.tr.insertText(", ")
      );
      // zero SP steps: the SP doc object is
      // untouched, yet the model moved
      expect(sp.state.doc).toBe(spDoc);
      expect(
        lipuModelKey.getState(sp.state)!.lipu
          .blocks[0].gaps.at(-1)!.latin
      ).toBe(", ");
      expect(doneOf(sp)).toHaveLength(1);
      expect(sharedUndo(sp)).toBe(true);
      expect(
        lipuModelKey.getState(sp.state)!.lipu
          .blocks[0].gaps.at(-1)!.latin
      ).toBe("");
      latin.destroy();
      sp.destroy();
    }
  );

  it(
    "the full undo cycle QUIESCES with the edit " +
      "loop: no pending flags, panes in step",
    () => {
      const sp = mkSp(lipu1(""));
      const latin = createLatinEditor(sp);
      latin.commands.setTextSelection(
        latin.state.doc.content.size
      );
      latin.view.dispatch(
        latin.state.tr.insertText(", ")
      );
      sharedUndo(sp);
      const flags = latinSyncState(latin)!;
      expect(flags.inFlight).toBe(false);
      expect(flags.pendingEdit).toBe(false);
      expect(flags.pendingReconcile).toBe(false);
      expect(flags.reSeedQueued).toBe(false);
      // the Latin doc IS the restored projection
      // (minimalReplaceTr null == already equal)
      const model = lipuModelKey.getState(sp.state)!;
      expect(
        minimalReplaceTr(
          latin.state,
          latinDocContent(model.lipu)
        )
      ).toBeNull();
      // and the undo did not re-enter the edit loop
      expect(doneOf(sp)).toHaveLength(0);
      expect(
        lipuHistoryKey.getState(sp.state)!.undone
      ).toHaveLength(1);
      sharedRedo(sp);
      expect(
        lipuModelKey.getState(sp.state)!.lipu
          .blocks[0].gaps.at(-1)!.latin
      ).toBe(", ");
      expect(
        minimalReplaceTr(
          latin.state,
          latinDocContent(
            lipuModelKey.getState(sp.state)!.lipu
          )
        )
      ).toBeNull();
      latin.destroy();
      sp.destroy();
    }
  );

  it(
    "the restored selection RIDES the adoption " +
      "transaction: one SP dispatch, no separate " +
      "(unflagged) selection transaction",
    () => {
      const sp = mkSp(lipu1(""));
      sp.commands.setTextSelection(
        sp.state.doc.content.size
      );
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("pona"))
      );
      // Park the caret somewhere ELSE before undoing.
      // The steps map THIS position forward; the
      // entry remembers where the edit began — so
      // the two now disagree, which is the only
      // condition under which the ride-along is
      // observable at all.
      sp.commands.setTextSelection(1);
      const seen: Transaction[] = [];
      const spy = ({
        transaction,
      }: {
        transaction: Transaction;
      }): void => {
        seen.push(transaction);
      };
      sp.on("transaction", spy);
      sharedUndo(sp);
      sp.off("transaction", spy);
      const moving = seen.filter(
        (t) => t.docChanged || t.selectionSet
      );
      expect(moving).toHaveLength(1);
      expect(
        moving[0].getMeta(LIPU_SYNC_META)
      ).toBeDefined();
      // ...and it carries the RECORDED selection
      // (offset 2 = after the glyph), not the
      // step-mapped one (offset 0)
      expect(sp.state.selection.head).toBe(3);
      sp.destroy();
    }
  );

  it(
    "the Latin selection restore is SYNC-FLAGGED, " +
      "so the restored at-rest run is not " +
      "re-crystallized (Latin half)",
    () => {
      const sp = mkSp(lipu1("\n\n"));
      const latin = createLatinEditor(sp);
      // A genuine Latin edit anywhere crystallizes
      // the at-rest run (only reconciles are
      // exempt), so this is the natural way to get a
      // TRANSIENT run back out of an undo.
      latin.commands.setTextSelection(1);
      latin.view.dispatch(
        latin.state.tr.insertText("x", 1)
      );
      expect(
        lipuModelKey.getState(sp.state)!.lipu.blocks
      ).toHaveLength(2);
      const seen: Transaction[] = [];
      const spy = ({
        transaction,
      }: {
        transaction: Transaction;
      }): void => {
        seen.push(transaction);
      };
      latin.on("transaction", spy);
      sharedUndo(sp);
      latin.off("transaction", spy);
      // EVERY transaction the undo puts into the
      // Latin editor is our own render of the model
      // — the reconcile AND the selection restore.
      // An unflagged one is a live pass for
      // latinLineBreaks over the state just
      // restored.
      expect(seen.length).toBeGreaterThan(0);
      for (const t of seen) {
        expect(
          t.getMeta(LATIN_SYNC_META)
        ).toBeDefined();
      }
      // and the run came back TRANSIENT and stayed
      // that way
      expect(
        lipuModelKey.getState(sp.state)!.lipu.blocks
      ).toHaveLength(1);
      expect(
        lipuModelKey.getState(sp.state)!.lipu
          .blocks[0].gaps[1].latin
      ).toBe("\n\n");
      latin.destroy();
      sp.destroy();
    }
  );

  it(
    "a BACKWARDS Latin selection stays backwards " +
      "through the SP mirror",
    () => {
      const sp = mkSp(lipu1(""));
      const latin = createLatinEditor(sp);
      // anchor AFTER "toki", head before it
      latin.view.dispatch(
        latin.state.tr.setSelection(
          TextSelection.create(latin.state.doc, 5, 1)
        )
      );
      latin.view.dispatch(
        latin.state.tr.insertText("x")
      );
      latin.destroy(); // pane closed
      expect(sharedUndo(sp)).toBe(true);
      // mirrorRange normalizes its arguments, so
      // without the direction fix both ends come
      // back in document order and the next
      // shift-arrow would grow the wrong end.
      expect(sp.state.selection.anchor).toBe(3);
      expect(sp.state.selection.head).toBe(1);
      sp.destroy();
    }
  );

  it(
    "selection restore clamps block and offset and " +
      "snaps to a codepoint boundary — " +
      "never errors",
    () => {
      const sp = mkSp(lipu1(""));
      // grow then shrink so the recorded selection
      // exceeds the restored doc
      sp.commands.setTextSelection(
        sp.state.doc.content.size
      );
      sp.view.dispatch(
        sp.state.tr.insertText(
          glyph("pona") + glyph("mute")
        )
      );
      sharedUndo(sp);
      const head = sp.state.selection.head;
      expect(head).toBeGreaterThanOrEqual(0);
      expect(head).toBeLessThanOrEqual(
        sp.state.doc.content.size
      );
      sp.destroy();
    }
  );

  it(
    "clampBlockPos: out-of-range block and offset " +
      "clamp; a mid-surrogate offset snaps DOWN",
    () => {
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
              { sp: "", latin: " " },
              { sp: "", latin: "" },
            ],
            spans: [],
          },
        ],
      };
      // SP side: two 2-unit glyphs = 4 units
      expect(
        clampBlockPos(lipu, "sp", {
          block: 7,
          offset: 99,
        })
      ).toEqual({ block: 0, offset: 4 });
      // offset 1 and 3 split a surrogate pair
      expect(
        clampBlockPos(lipu, "sp", {
          block: 0,
          offset: 3,
        })
      ).toEqual({ block: 0, offset: 2 });
      expect(
        clampBlockPos(lipu, "sp", {
          block: 0,
          offset: -5,
        })
      ).toEqual({ block: 0, offset: 0 });
      // latin side: "toki pona" = 9 units
      expect(
        clampBlockPos(lipu, "latin", {
          block: 0,
          offset: 99,
        })
      ).toEqual({ block: 0, offset: 9 });
      // empty lipu never throws
      expect(
        clampBlockPos(
          { version: 2, blocks: [] },
          "sp",
          { block: 3, offset: 3 }
        )
      ).toEqual({ block: 0, offset: 0 });
    }
  );

  it(
    "undo with the latin pane ABSENT restores the " +
      "SP-mirrored selection, no error",
    () => {
      const sp = mkSp(lipu1(""));
      const latin = createLatinEditor(sp);
      latin.commands.setTextSelection(
        latin.state.doc.content.size
      );
      latin.view.dispatch(
        latin.state.tr.insertText(",")
      );
      latin.destroy(); // pane closed
      expect(sharedUndo(sp)).toBe(true);
      expect(
        lipuModelKey.getState(sp.state)!.lipu
          .blocks[0].gaps.at(-1)!.latin
      ).toBe("");
      const head = sp.state.selection.head;
      expect(head).toBeGreaterThanOrEqual(0);
      expect(head).toBeLessThanOrEqual(
        sp.state.doc.content.size
      );
      sp.destroy();
    }
  );

  it(
    "undo-then-focus does not crystallize the " +
      "restored state",
    async () => {
      const sp = mkSp(lipu1("\n\n"));
      // "\n\n" is at-rest gap.latin content; make an
      // edit, undo it — the induced blur must not
      // force any pass that mutates the model
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("pona"), 1)
      );
      const before = lipuModelKey.getState(sp.state)!;
      sharedUndo(sp);
      const restored = lipuModelKey.getState(
        sp.state
      )!;
      // simulate the induced blur settling, and
      // RECORD how the tracker classified it
      let settled: PaneId | null | "unset" = "unset";
      focusTracker.notifyBlur("sp", (now) => {
        settled = now;
      });
      await new Promise((r) =>
        queueMicrotask(() => r(null))
      );
      // Undo armed suppressNext BEFORE its
      // programmatic focus, so the induced blur
      // classifies AS-IF-TO-PEER. A null here is a
      // TRUE blur, which forces the crystallization
      // pass over the state the undo just restored.
      expect(settled).toBe("latin");
      expect(
        lipuModelKey.getState(sp.state)!.lipu
      ).toEqual(restored.lipu);
      expect(before.lipu).not.toEqual(restored.lipu);
      sp.destroy();
    }
  );

  it("depth is capped at HISTORY_DEPTH", () => {
    const sp = mkSp(lipu1(""));
    for (let i = 0; i < HISTORY_DEPTH + 20; i++) {
      // spread lastTime so nothing coalesces
      const t = Date.now() + i * 10_000;
      const spy = vi
        .spyOn(Date, "now")
        .mockReturnValue(t);
      sp.view.dispatch(
        sp.state.tr.insertText(
          glyph(i % 2 === 0 ? "pona" : "mute"),
          1
        )
      );
      spy.mockRestore();
    }
    expect(doneOf(sp).length).toBeLessThanOrEqual(
      HISTORY_DEPTH
    );
    expect(doneOf(sp).length).toBe(HISTORY_DEPTH);
    sp.destroy();
  });

  it(
    "the KEYMAP path: Mod+Z in the SP editor undoes " +
      "through the shared stack; Shift-Mod+Z redoes",
    () => {
      const sp = mkSp(lipu1(""));
      const st0 = lipuModelKey.getState(sp.state)!;
      sp.commands.setTextSelection(
        sp.state.doc.content.size
      );
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("pona"))
      );
      const edited = lipuModelKey.getState(
        sp.state
      )!.lipu;
      pressUndo(sp);
      expect(
        lipuModelKey.getState(sp.state)!.lipu
      ).toEqual(st0.lipu);
      pressUndo(sp, true);
      expect(
        lipuModelKey.getState(sp.state)!.lipu
      ).toEqual(edited);
      sp.destroy();
    }
  );

  it(
    "the KEYMAP path: Mod+Z in the LATIN editor " +
      "reaches the SAME stack (scope: the " +
      "dual-pane surface)",
    () => {
      const sp = mkSp(lipu1(""));
      const latin = createLatinEditor(sp);
      latin.commands.setTextSelection(
        latin.state.doc.content.size
      );
      latin.view.dispatch(
        latin.state.tr.insertText(", ")
      );
      expect(doneOf(sp)).toHaveLength(1);
      pressUndo(latin);
      expect(doneOf(sp)).toHaveLength(0);
      expect(
        lipuModelKey.getState(sp.state)!.lipu
          .blocks[0].gaps.at(-1)!.latin
      ).toBe("");
      latin.destroy();
      sp.destroy();
    }
  );

  it(
    "undo adoption restores provenance marks " +
      "wholesale and runs no re-derivation",
    () => {
      const lipu = lipu1(". ");
      lipu.blocks[0].gaps[1].latinAuthored = true;
      const sp = mkSp(lipu);
      sp.commands.setTextSelection(
        sp.state.doc.content.size
      );
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("pona"))
      );
      expect(sharedUndo(sp)).toBe(true);
      const st = lipuModelKey.getState(sp.state)!;
      expect(
        st.lipu.blocks[0].gaps[1].latin
      ).toBe(". ");
      expect(
        st.lipu.blocks[0].gaps[1].latinAuthored
      ).toBe(true);
      sp.destroy();
    }
  );

  it(
    "MISORDERED declaration (history AFTER model) " +
      "is caught loudly and records nothing",
    () => {
      const spy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const lipu = lipu1("");
      const sp = new Editor({
        extensions: [
          LineBreaks,
          // WRONG: TipTap reverses, so this puts
          // lipu-history's apply BEFORE lipu-model's
          LipuModel.configure({ initialLipu: lipu }),
          LipuHistory,
          StarterKit.configure({ history: false }),
          SitelenPona,
          Verbatim,
        ],
        content: lipuToContent(lipu),
      });
      sp.view.dispatch(
        sp.state.tr.insertText(glyph("pona"), 1)
      );
      expect(
        lipuHistoryKey.getState(sp.state)!.done
      ).toHaveLength(0);
      expect(spy).toHaveBeenCalled();
      expect(
        String(spy.mock.calls[0][0])
      ).toContain("lipu-history");
      spy.mockRestore();
      sp.destroy();
    }
  );
});
