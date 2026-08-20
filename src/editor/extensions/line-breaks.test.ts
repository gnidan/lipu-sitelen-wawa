import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from "./sitelen-pona";
import {
  LineBreaks,
  lineBreaksKey,
} from "./line-breaks";
import {
  codepointToChar,
  wordToCodepoint,
} from "../../data";
import { Autocomplete } from "./autocomplete";
import { StructuralChars } from "./structural-chars";
import { Verbatim } from "./verbatim";
import { VerbatimToggle } from "./verbatim-toggle";
import {
  LipuModel,
  lipuModelKey,
} from "./lipu-model";
import { renderSp } from "../../lipu";
import type { Lipu } from "../../lipu";
import { CARTOUCHE_START } from "../../lipu/chars";
import { lipuToContent } from "../lipu-doc";
import { blockOffsetToPm } from "../pm-coords";
import { assertInvariants } from "../test-invariants";
import { focusTracker } from "../focus-tracker";
import {
  DOC_PREFIX,
  LIPUDOC_PREFIX,
  loadDocLipu,
  saveDocDual,
} from "../../app/documents";
import { cart, glyph as ucsur } from "../../../test/helpers";

function createEditor(content = "") {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      LineBreaks,
    ],
    content,
  });
}

function pressEnter(
  editor: Editor,
  opts: { shift?: boolean } = {}
): boolean {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    shiftKey: !!opts.shift,
  });
  for (const plugin of
    editor.view.state.plugins) {
    const handler = plugin.props.handleKeyDown;
    if (handler) {
      const result = handler.call(
        plugin,
        editor.view,
        event
      );
      if (result) return true;
    }
  }
  return false;
}

/**
 * COMPOSITION DWELL: the
 * normalizer skips a break-run the selection is inside
 * or immediately adjacent to, so every gesture that
 * ENDS with the caret on the fresh empty line now
 * splits one transaction later -- when the caret
 * leaves, or on blur. These helpers are that "leave".
 *
 * Position 1 is the first content position of the
 * first paragraph; every run in this file's fixtures
 * starts at 3 or later (a UCSUR glyph is 2 UTF-16
 * units), so a caret at 1 is never within the
 * adjacency window [runFrom - 1, runTo + 1].
 */
function leaveRun(editor: Editor): void {
  editor.commands.setTextSelection(1);
}

function blurEditor(editor: Editor): void {
  editor.view.dom.dispatchEvent(
    new FocusEvent("blur")
  );
}

/**
 * FOCUS DEFERRAL: the blur handler does not
 * dispatch the forced pass synchronously —
 * it registers a callback with the FocusTracker,
 * which settles one microtask later, the first
 * moment "blur to the peer pane" is distinguishable
 * from a TRUE blur. The assertions below are
 * unchanged; only their timing is. The tracker is
 * RESET first so nothing is focused: an unanswered
 * blur settles null = true blur = today's forced
 * pass.
 */
async function blurAndSettle(
  editor: Editor
): Promise<void> {
  focusTracker.reset();
  blurEditor(editor);
  await new Promise((r) =>
    queueMicrotask(() => r(null))
  );
}

// NOTE: the "undo after Enter-Enter leaves the
// document un-split" pin (undo through the shared
// document-level history stack) lands with that
// extension in the Latin-pane PR, alongside its
// createHistoryEditor helper.

function countBreaks(editor: Editor): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "hardBreak") n += 1;
  });
  return n;
}

describe("LineBreaks", () => {
  it("Enter inserts a soft break, not a split", () => {
    const editor = createEditor(
      `<p>${ucsur("toki")}</p>`
    );
    editor.commands.focus("end");

    const handled = pressEnter(editor);

    expect(handled).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(countBreaks(editor)).toBe(1);
    editor.destroy();
  });

  it(
    "Enter-Enter at line end splits into two " +
      "empty-adjacent paragraphs (once the caret " +
      "leaves the run -- COMPOSITION DWELL)",
    () => {
      const editor = createEditor(
        `<p>${ucsur("toki")}</p>`
      );
      editor.commands.focus("end");

      pressEnter(editor);
      pressEnter(editor);

      // The caret sits immediately after the run it
      // just typed, so the split DWELLS.
      expect(editor.state.doc.childCount).toBe(1);
      expect(countBreaks(editor)).toBe(2);

      leaveRun(editor);

      expect(editor.state.doc.childCount).toBe(2);
      expect(countBreaks(editor)).toBe(0);
      editor.destroy();
    }
  );

  it("Enter-Enter mid-line splits cleanly", () => {
    const tokiChar = ucsur("toki");
    const ponaChar = ucsur("pona");
    const editor = createEditor(
      `<p>${tokiChar}${ponaChar}</p>`
    );
    const mid = 1 + tokiChar.length;
    editor.commands.setTextSelection(mid);

    pressEnter(editor);
    pressEnter(editor);
    // dwelled at the caret; crystallizes on leave
    expect(editor.state.doc.childCount).toBe(1);
    leaveRun(editor);

    expect(editor.state.doc.childCount).toBe(2);
    expect(countBreaks(editor)).toBe(0);
    const first = editor.state.doc.child(0);
    const second = editor.state.doc.child(1);
    expect(first.textContent).toBe(tokiChar);
    expect(second.textContent).toBe(ponaChar);
    editor.destroy();
  });

  it(
    "Enter at the start of an existing line " +
      "SPLITS (reversed from the superseded " +
      "provenance-gated design)",
    () => {
      const tokiChar = ucsur("toki");
      const ponaChar = ucsur("pona");
      const editor = createEditor(
        `<p>${tokiChar}<br>${ponaChar}</p>`
      );
      const beforePona = 1 + tokiChar.length + 1;
      editor.commands.setTextSelection(beforePona);

      const handled = pressEnter(editor);

      expect(handled).toBe(true);
      // the caret landed between the two breaks:
      // dwelled until it leaves
      expect(editor.state.doc.childCount).toBe(1);
      leaveRun(editor);

      expect(editor.state.doc.childCount).toBe(2);
      expect(countBreaks(editor)).toBe(0);
      const first = editor.state.doc.child(0);
      const second = editor.state.doc.child(1);
      expect(first.textContent).toBe(tokiChar);
      expect(second.textContent).toBe(ponaChar);
      editor.destroy();
    }
  );

  it(
    "Shift+Enter after Enter splits too (uniform " +
      "under the normalizer)",
    () => {
      const editor = createEditor(
        `<p>${ucsur("toki")}</p>`
      );
      editor.commands.focus("end");

      pressEnter(editor);
      pressEnter(editor, { shift: true });
      // COMPOSITION DWELL: the mixed Enter /
      // Shift+Enter run is attended by the caret
      // exactly like a plain one -- the rule is
      // about the SELECTION, not about which key
      // made the break.
      expect(editor.state.doc.childCount).toBe(1);
      leaveRun(editor);

      expect(editor.state.doc.childCount).toBe(2);
      expect(countBreaks(editor)).toBe(0);
      editor.destroy();
    }
  );

  it(
    "a single break persists: leading and trailing",
    () => {
      const tokiChar = ucsur("toki");

      // Trailing: cursor at paragraph end, one Enter.
      const trailing = createEditor(`<p>${tokiChar}</p>`);
      trailing.commands.focus("end");
      pressEnter(trailing);
      expect(trailing.state.doc.childCount).toBe(1);
      expect(countBreaks(trailing)).toBe(1);
      trailing.destroy();

      // Leading: cursor at paragraph start, one Enter.
      const leading = createEditor(`<p>${tokiChar}</p>`);
      leading.commands.setTextSelection(1);
      pressEnter(leading);
      expect(leading.state.doc.childCount).toBe(1);
      expect(countBreaks(leading)).toBe(1);
      leading.destroy();
    }
  );

  it(
    "standalone-deleting the only text on a " +
      "middle line splits there",
    () => {
      const a = ucsur("toki");
      const b = ucsur("pona");
      const c = ucsur("suli");
      const editor = createEditor(
        `<p>${a}<br>${b}<br>${c}</p>`
      );

      // Derivation (UCSUR chars are astral-plane
      // codepoints, so each is a surrogate pair --
      // JS string / ProseMirror text nodeSize 2, not
      // 1; hardBreak nodeSize 1):
      //   pos 0: <p> open
      //   pos 1 .. 1+a.length: a  (nodeSize a.length)
      //   .. +1: br
      //   .. +b.length: b
      //   .. +1: br
      //   .. +c.length: c
      //   </p> close
      // "b" starts at bStart = 1 + a.length + 1 and
      // ends at bEnd = bStart + b.length. Deleting
      // exactly tr.delete(bStart, bEnd) leaves
      // <p>a<br><br>c</p>: the two hardBreaks that
      // used to be separated by b are now a single
      // run of length 2 (both consumed by the run --
      // nothing "left over" on either side). The
      // normalizer's run rule deletes that whole run
      // and splits at its start, producing
      // <p>a</p><p>c</p> with ZERO hardBreaks
      // remaining -- not one leading/trailing break
      // on each side, since the run length is
      // exactly 2 (not 3+).
      const bStart = 1 + a.length + 1;
      const bEnd = bStart + b.length;
      const tr = editor.state.tr.delete(bStart, bEnd);
      editor.view.dispatch(tr);

      expect(editor.state.doc.childCount).toBe(2);
      expect(countBreaks(editor)).toBe(0);
      const first = editor.state.doc.child(0);
      const second = editor.state.doc.child(1);
      expect(first.textContent).toBe(a);
      expect(second.textContent).toBe(c);
      editor.destroy();
    }
  );

  it(
    "replacing a selected line's text in ONE " +
      "transaction does not split",
    () => {
      const a = ucsur("toki");
      const b = ucsur("pona");
      const c = ucsur("suli");
      const editor = createEditor(
        `<p>${a}<br>${b}<br>${c}</p>`
      );

      // "b" occupies [bStart, bEnd) (see derivation
      // above); replace it with a different single
      // glyph in one transaction. The two hardBreaks
      // stay separated by exactly one non-break node
      // throughout, so no run of length >= 2 ever
      // forms and the normalizer is a no-op.
      const bStart = 1 + a.length + 1;
      const bEnd = bStart + b.length;
      const replacement = ucsur("mute");
      const node = editor.state.schema.text(
        replacement
      );
      const tr = editor.state.tr.replaceWith(
        bStart,
        bEnd,
        node
      );
      editor.view.dispatch(tr);

      expect(editor.state.doc.childCount).toBe(1);
      expect(countBreaks(editor)).toBe(2);
      editor.destroy();
    }
  );

  it(
    "Enter with a non-empty selection replaces " +
      "it with a break",
    () => {
      const tokiChar = ucsur("toki");
      const ponaChar = ucsur("pona");
      const editor = createEditor(
        `<p>${tokiChar}${ponaChar}</p>`
      );
      const end = 1 + tokiChar.length + ponaChar.length;
      editor.commands.setTextSelection({
        from: 1,
        to: end,
      });

      pressEnter(editor);

      expect(editor.state.doc.childCount).toBe(1);
      expect(countBreaks(editor)).toBe(1);
      const text = editor.state.doc.textContent;
      expect(text).not.toContain(tokiChar);
      expect(text).not.toContain(ponaChar);
      editor.destroy();
    }
  );

  it(
    "the handler returns true for plain Enter, " +
      "with and without an existing adjacent break",
    () => {
      const editor = createEditor(
        `<p>${ucsur("toki")}</p>`
      );
      editor.commands.focus("end");

      const plugin = editor.view.state.plugins.find(
        (p) => (p as any).spec.key === lineBreaksKey
      );
      expect(plugin).toBeDefined();
      const handler = plugin!.props.handleKeyDown!;

      // No existing adjacent break yet.
      const firstEvent = new KeyboardEvent(
        "keydown",
        { key: "Enter" }
      );
      const firstResult = handler.call(
        plugin!,
        editor.view,
        firstEvent
      );
      expect(firstResult).toBe(true);

      // Now a break already precedes the cursor.
      const secondEvent = new KeyboardEvent(
        "keydown",
        { key: "Enter" }
      );
      const secondResult = handler.call(
        plugin!,
        editor.view,
        secondEvent
      );
      expect(secondResult).toBe(true);

      editor.destroy();
    }
  );
});

describe("autocomplete popup-accept still wins", () => {
  function createFullEditor(content = "") {
    return new Editor({
      extensions: [
        StarterKit,
        SitelenPona,
        Autocomplete,
        StructuralChars,
        Verbatim,
        VerbatimToggle,
        LineBreaks,
      ],
      content,
    });
  }

  it(
    "commits the popup match on the first Enter, " +
      "then breaks, then splits (pins the " +
      "accepted 3-press gesture under the " +
      "content-driven normalizer)",
    () => {
      const editor = createFullEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("tok");

      const first = pressEnter(editor);
      expect(first).toBe(true);
      expect(countBreaks(editor)).toBe(0);
      expect(editor.state.doc.childCount).toBe(1);
      const tokiChar = codepointToChar(
        wordToCodepoint["toki"]
      );
      expect(
        editor.state.doc.textContent
      ).toContain(tokiChar);

      const second = pressEnter(editor);
      expect(second).toBe(true);
      expect(countBreaks(editor)).toBe(1);
      expect(editor.state.doc.childCount).toBe(1);

      const third = pressEnter(editor);
      expect(third).toBe(true);
      // COMPOSITION DWELL: the third press leaves the
      // caret on the fresh empty line, so the split
      // waits for the caret to leave.
      expect(editor.state.doc.childCount).toBe(1);
      expect(countBreaks(editor)).toBe(2);
      leaveRun(editor);
      expect(editor.state.doc.childCount).toBe(2);
      expect(countBreaks(editor)).toBe(0);

      editor.destroy();
    }
  );
});

/**
 * Editors carrying the lipu plugin state the normalizer
 * now reads (named layering change: line-breaks
 * depends on lipu-model). Extension order mirrors
 * Editor.tsx -- LineBreaks first, then LipuModel.
 */
function buildEditorWithLipu(lipu: Lipu): Editor {
  return new Editor({
    extensions: [
      LineBreaks,
      LipuModel.configure({ initialLipu: lipu }),
      StarterKit,
      SitelenPona,
      Autocomplete,
      StructuralChars,
      Verbatim,
      VerbatimToggle,
    ],
    content: lipuToContent(lipu),
  });
}

/** Doc position just past block 0's last content
 *  unit (never hardcoded: content.size counts the
 *  same UTF-16 units renderSp does). */
function endOfFirstBlock(editor: Editor): number {
  const doc = editor.state.doc;
  return blockOffsetToPm(
    doc,
    0,
    doc.child(0).content.size
  );
}

/** Doc position immediately after block 0's anchor
 *  `index`, derived from the source map. */
function afterAnchor(
  editor: Editor,
  index: number
): number {
  const st = lipuModelKey.getState(editor.state)!;
  const entry = renderSp(
    st.lipu.blocks[0]
  ).map.find(
    (e) =>
      e.ref.seg === "anchor" && e.ref.index === index
  )!;
  return blockOffsetToPm(
    editor.state.doc,
    0,
    entry.to
  );
}

/**
 * COMPOSITION DWELL: the normalizer skips a break-run the
 * selection is inside or immediately adjacent to. The
 * split crystallizes on the first transaction that
 * leaves the run unattended -- a bare caret move is
 * enough -- or on editor blur.
 */
describe("composition dwell", () => {
  it(
    "park-and-type dissolves the run: no split, " +
      "ever",
    () => {
      const tokiChar = ucsur("toki");
      const editor = createEditor(
        `<p>${tokiChar}</p>`
      );
      editor.commands.focus("end");
      pressEnter(editor);
      pressEnter(editor);

      // Derivation: toki is one UCSUR glyph = 2
      // UTF-16 units at doc [1, 3); the two
      // hardBreaks (nodeSize 1) occupy [3, 4) and
      // [4, 5). Position 4 is INSIDE the run,
      // between them.
      const insideRun = 1 + tokiChar.length + 1;
      expect(editor.state.doc.childCount).toBe(1);
      expect(countBreaks(editor)).toBe(2);

      editor.commands.setTextSelection(insideRun);
      // still parked: a selection-only transaction
      // that stays inside the run changes nothing
      expect(editor.state.doc.childCount).toBe(1);

      editor.commands.insertContent("x");

      // The run is DISSOLVED: two runs of length 1
      // now, so there is nothing left to split --
      // not on leave, not on blur.
      expect(editor.state.doc.childCount).toBe(1);
      expect(countBreaks(editor)).toBe(2);
      leaveRun(editor);
      blurEditor(editor);
      expect(editor.state.doc.childCount).toBe(1);
      expect(countBreaks(editor)).toBe(2);
      expect(
        editor.state.doc.child(0).textContent
      ).toBe(tokiChar + "x");

      editor.destroy();
    }
  );

  it(
    "park-and-leave splits at the LEAVE " +
      "transaction (which changes no doc content)",
    () => {
      const editor = createEditor(
        `<p>${ucsur("toki")}</p>`
      );
      editor.commands.focus("end");
      pressEnter(editor);
      pressEnter(editor);
      expect(editor.state.doc.childCount).toBe(1);

      // The only transaction DISPATCHED here is a
      // selection change (setTextSelection); the
      // split rides on it as an APPENDED transaction,
      // which is why the doc changes even though the
      // dispatched transaction changed nothing.
      // (TipTap emits one "transaction" event per
      // dispatch, so only the dispatched one is
      // observed here.)
      const docChangedTrs: boolean[] = [];
      editor.on("transaction", ({ transaction }) => {
        docChangedTrs.push(transaction.docChanged);
      });
      leaveRun(editor);

      expect(docChangedTrs).toEqual([false]);
      expect(editor.state.doc.childCount).toBe(2);
      expect(countBreaks(editor)).toBe(0);

      editor.destroy();
    }
  );

  it(
    "the window is exactly [from, to]: one step off " +
      "the run crystallizes it, whatever the " +
      "character's UTF-16 width",
    () => {
      // Gesture table (run at doc [3, 5) after
      // Enter-Enter on a 2-unit glyph; the window is
      // the TOUCHING positions 3..5):
      //   caret 5 (typed the run)      -> dwell
      //   type "!"      -> caret 6     -> split
      //   type a glyph  -> caret 7     -> split
      //   arrow off by one 1-unit char -> split
      // The ±1 window this replaces measured in
      // UTF-16 units, so the first two rows
      // disagreed with each other and the third
      // failed to split at all — why the exact
      // window was chosen.
      const oneUnit = createEditor(
        `<p>${ucsur("toki")}</p>`
      );
      oneUnit.commands.focus("end");
      pressEnter(oneUnit);
      pressEnter(oneUnit);
      expect(oneUnit.state.doc.childCount).toBe(1);

      oneUnit.commands.insertContent("!");
      expect(oneUnit.state.doc.childCount).toBe(2);
      expect(countBreaks(oneUnit)).toBe(0);
      expect(
        oneUnit.state.doc.child(1).textContent
      ).toBe("!");
      oneUnit.destroy();

      // Same gesture with a 2-unit glyph: identical
      // outcome, which is the point of the narrowing.
      const twoUnit = createEditor(
        `<p>${ucsur("toki")}</p>`
      );
      twoUnit.commands.focus("end");
      pressEnter(twoUnit);
      pressEnter(twoUnit);
      twoUnit.commands.insertContent(ucsur("pona"));
      expect(twoUnit.state.doc.childCount).toBe(2);
      expect(
        twoUnit.state.doc.child(1).textContent
      ).toBe(ucsur("pona"));
      twoUnit.destroy();

      // And a caret STEP of one unit off the run's
      // end -- the arrow-key case -- crystallizes:
      // "toki" + br + br + "!" leaves the run at
      // [3, 5) with "!" at [5, 6), so parking on the
      // run (5) dwells and stepping to 6 splits.
      const arrow = createEditor(
        `<p>${ucsur("toki")}<br><br>!</p>`
      );
      arrow.commands.setTextSelection(5);
      expect(arrow.state.doc.childCount).toBe(1);
      arrow.commands.setTextSelection(6);
      expect(arrow.state.doc.childCount).toBe(2);
      arrow.destroy();
    }
  );

  it(
    "blur during an IME composition does NOT " +
      "split; the next blur does",
    async () => {
      const editor = createEditor(
        `<p>${ucsur("toki")}</p>`
      );
      editor.commands.focus("end");
      pressEnter(editor);
      pressEnter(editor);
      expect(editor.state.doc.childCount).toBe(1);

      // happy-dom cannot drive a real IME; the guard
      // reads view.composing, which ProseMirror
      // holds true for the duration of a
      // composition, so mocking that flag is the
      // whole of what this environment can express.
      // RESIDUAL: blurring mid-composition in a real
      // browser is a manual smoke check.
      // (view.composing is a getter over the input
      // state, so the mock is a property override.)
      const setComposing = (v: boolean): void => {
        Object.defineProperty(
          editor.view,
          "composing",
          { configurable: true, get: () => v }
        );
      };
      setComposing(true);
      // composing is re-checked AT THE SETTLE, where
      // it describes the moment we would dispatch
      await blurAndSettle(editor);
      expect(editor.state.doc.childCount).toBe(1);
      expect(countBreaks(editor)).toBe(2);

      setComposing(false);
      await blurAndSettle(editor);
      expect(editor.state.doc.childCount).toBe(2);
      expect(countBreaks(editor)).toBe(0);
      editor.destroy();
    }
  );

  it("blur crystallizes a dwelled run", async () => {
    const editor = createEditor(
      `<p>${ucsur("toki")}</p>`
    );
    editor.commands.focus("end");
    pressEnter(editor);
    pressEnter(editor);
    // the caret never moves: dwell holds
    expect(editor.state.doc.childCount).toBe(1);
    expect(countBreaks(editor)).toBe(2);

    focusTracker.reset();
    blurEditor(editor);
    // DEFERRED to the settle: still pending in this turn
    expect(editor.state.doc.childCount).toBe(1);
    await new Promise((r) =>
      queueMicrotask(() => r(null))
    );

    expect(editor.state.doc.childCount).toBe(2);
    expect(countBreaks(editor)).toBe(0);
    editor.destroy();
  });

  it(
    "a dwelled run is legal transient content: it " +
      "round-trips through storage and the next " +
      "qualifying transaction normalizes it",
    () => {
      const id = "dwell-roundtrip";
      localStorage.removeItem(LIPUDOC_PREFIX + id);
      localStorage.removeItem(DOC_PREFIX + id);

      const seed: Lipu = {
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
        ],
      };
      const editor = buildEditorWithLipu(seed);
      editor.commands.focus("end");
      pressEnter(editor);
      pressEnter(editor);

      // mid-dwell: the model legally holds the run
      const st = lipuModelKey.getState(editor.state)!;
      expect(st.lipu.blocks.length).toBe(1);
      expect(st.lipu.blocks[0].gaps.at(-1)!.sp).toBe(
        "\n\n"
      );
      assertInvariants(editor);

      // an autosave firing right now stores it
      saveDocDual(
        id,
        st.lipu,
        lipuToContent(st.lipu),
        false
      );
      const loaded = loadDocLipu(id)!;
      expect(loaded.blocks.length).toBe(1);
      expect(loaded.blocks[0].gaps.at(-1)!.sp).toBe(
        "\n\n"
      );

      // reopening shows the empty line, un-split
      const reopened = buildEditorWithLipu(loaded);
      expect(reopened.state.doc.childCount).toBe(1);
      expect(countBreaks(reopened)).toBe(2);
      assertInvariants(reopened);

      // ...and the next qualifying transaction
      // normalizes: inserting at doc position 1
      // leaves the caret at 2, and the run (now at
      // [4, 6)) is unattended.
      reopened.commands.insertContentAt(
        1,
        ucsur("pona")
      );
      expect(reopened.state.doc.childCount).toBe(2);
      expect(countBreaks(reopened)).toBe(0);
      assertInvariants(reopened);

      editor.destroy();
      reopened.destroy();
      localStorage.removeItem(LIPUDOC_PREFIX + id);
      localStorage.removeItem(DOC_PREFIX + id);
    }
  );
});

/**
 * The structural-span exception:
 * no empty-line split between a PROMOTED structural
 * span's markers. Ranges come from the lipu plugin
 * state's rendered marker positions, so MARKER
 * OFFSETS are
 * honoured on both sides.
 *
 * Fixtures here are hand-written Blocks, so their
 * offsets must already satisfy checkBlock's stricter
 * rules (codepoint boundaries; an offset
 * stored ON its edge is rejected -- canonical
 * spelling is ABSENT). Anything that PRODUCES spans
 * must route through clampSpanOffsets; this plugin
 * produces none (it only deletes runs and splits,
 * and splitBlock rebases the offsets).
 */
describe("structural-span exception", () => {
  const cartoucheWithEmptyLine = (): Lipu => ({
    version: 2,
    blocks: [
      {
        anchors: [
          { kind: "word", word: "toki" },
          { kind: "word", word: "pona" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: "\n\n", latin: "" },
          { sp: "", latin: "" },
        ],
        spans: [
          cart(0, 1),
        ],
      },
    ],
  });

  it(
    "an empty line INSIDE a promoted cartouche " +
      "never splits",
    () => {
      const editor = buildEditorWithLipu(
        cartoucheWithEmptyLine()
      );
      // Derivation (standing caveat: the UCSUR
      // cartouche markers are astral codepoints --
      // 2 UTF-16 units each, exactly like a glyph):
      // "[" (2) + toki (2) + br + br + pona (2) +
      // "]" (2) = 10 content units, so the run sits
      // at doc [5, 7) and the insertion point is doc
      // 11 -- the caret lands at 12, outside the
      // run's adjacency window [4, 8]. Only the
      // exception can be keeping this paragraph
      // whole.
      expect(
        editor.state.doc.child(0).content.size
      ).toBe(10);
      editor.commands.insertContentAt(
        endOfFirstBlock(editor),
        "x"
      );

      expect(editor.state.doc.childCount).toBe(1);
      assertInvariants(editor);
      editor.destroy();
    }
  );

  it(
    "transitional (unmatched) markers suppress " +
      "nothing",
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
              { sp: CARTOUCHE_START, latin: "" },
              { sp: "\n\n", latin: "" },
              { sp: "", latin: "" },
            ],
            spans: [],
          },
        ],
      };
      const editor = buildEditorWithLipu(lipu);
      // "[" (2) + toki (2) + br + br + pona (2) = 8
      // content units: the run is at doc [5, 7) and
      // the caret lands at 10, clear of the window
      // [4, 8].
      expect(
        editor.state.doc.child(0).content.size
      ).toBe(8);
      editor.commands.insertContentAt(
        endOfFirstBlock(editor),
        "x"
      );

      expect(editor.state.doc.childCount).toBe(2);
      assertInvariants(editor);
      editor.destroy();
    }
  );

  it(
    "deleting a marker demotes the span and the " +
      "suppressed split fires on that edit's pass",
    () => {
      const editor = buildEditorWithLipu(
        cartoucheWithEmptyLine()
      );
      // start marker is the first rendered char of
      // the block; content starts at doc pos 1
      const st = lipuModelKey.getState(editor.state)!;
      const map = renderSp(st.lipu.blocks[0]).map;
      const start = map.find(
        (e) =>
          e.ref.seg === "marker" &&
          e.ref.end === "start"
      )!;
      editor.commands.deleteRange({
        from: 1 + start.from,
        to: 1 + start.to,
      });
      // the merge demoted the span in state.apply;
      // this SAME transaction's normalizer pass saw
      // no suppression and split (the caret sits at
      // doc 1, clear of the run's window)
      expect(editor.state.doc.childCount).toBe(2);
      assertInvariants(editor);
      editor.destroy();
    }
  );

  // MARKER OFFSETS, both sides:
  // gaps[from] and gaps[to + 1] are the
  // spans' EXTERIOR gaps, but the part of gaps[from]
  // after the start marker and the part of
  // gaps[to + 1] before the end marker are INTERIOR.
  // The two fixtures below hold byte-identical gaps
  // and differ ONLY in where the markers sit.
  const offsetGaps = () => [
    { sp: "\n\n", latin: "" },
    { sp: "", latin: "" },
    { sp: "\n\n", latin: "" },
  ];
  const offsetAnchors = () => [
    { kind: "word" as const, word: "toki" },
    { kind: "word" as const, word: "pona" },
  ];

  it(
    "runs on the INTERIOR side of both marker " +
      "offsets never split",
    () => {
      const lipu: Lipu = {
        version: 2,
        blocks: [
          {
            anchors: offsetAnchors(),
            gaps: offsetGaps(),
            spans: [
              {
                from: 0,
                to: 1,
                kind: "cartouche",
                side: "both",
                // marker BEFORE gaps[0]'s run
                startOffset: 0,
                // marker AFTER gaps[2]'s run
                endOffset: 2,
              },
            ],
          },
        ],
      };
      const editor = buildEditorWithLipu(lipu);
      // Rendering: "[" (2) br br toki (2) pona (2)
      // br br "]" (2) = 12 content units; runs at
      // doc [3, 5) and [9, 11); the interior is
      // [start.to, end.from) = rel [2, 10),
      // containing both.
      expect(
        editor.state.doc.child(0).content.size
      ).toBe(12);
      // Edit between the anchors (doc 7): the caret
      // lands at 8, outside both adjacency windows
      // ([2, 6] and, after the insert, [9, 13]).
      editor.commands.insertContentAt(
        afterAnchor(editor, 0),
        "x"
      );

      expect(editor.state.doc.childCount).toBe(1);
      expect(countBreaks(editor)).toBe(4);
      assertInvariants(editor);
      editor.destroy();
    }
  );

  it(
    "the same gap bytes with EDGE-ADJACENT markers " +
      "split: the runs are exterior",
    () => {
      const lipu: Lipu = {
        version: 2,
        blocks: [
          {
            anchors: offsetAnchors(),
            gaps: offsetGaps(),
            spans: [
              cart(0, 1),
            ],
          },
        ],
      };
      const editor = buildEditorWithLipu(lipu);
      // Rendering: br br "[" (2) toki (2) pona (2)
      // "]" (2) = 12 content units; runs at doc
      // [1, 3) and [11, 13); the interior is rel
      // [4, 8) -- neither run is inside it. The
      // caret lands at 8 (insert at doc 7), outside
      // both windows ([0, 4] and [10, 14]).
      expect(
        editor.state.doc.child(0).content.size
      ).toBe(12);
      editor.commands.insertContentAt(
        afterAnchor(editor, 0),
        "x"
      );

      expect(editor.state.doc.childCount).toBe(3);
      expect(countBreaks(editor)).toBe(0);
      assertInvariants(editor);
      editor.destroy();
    }
  );
});
