import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from "./extensions/sitelen-pona";
import { Autocomplete } from "./extensions/autocomplete";
import { StructuralChars } from "./extensions/structural-chars";
import { Verbatim } from "./extensions/verbatim";
import {
  VerbatimToggle,
  verbatimTogglePluginKey,
} from "./extensions/verbatim-toggle";
import type { VerbatimToggleState } from
  "./extensions/verbatim-toggle";
import { LipuModel, lipuModelKey } from
  "./extensions/lipu-model";
import { assertInvariants } from "./test-invariants";
import { focusTracker } from "./focus-tracker";

/**
 * Case 8 (negative: no test path may produce a lipu
 * whose render flags disagree with doc marks) is not
 * a separate test — it is the `assertInvariants` call
 * that runs after every case below, which checks
 * exactly that (see test-invariants.ts).
 */

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

/**
 * Simulate a keydown event by calling each plugin's
 * handleKeyDown in order (matching ProseMirror
 * dispatch behavior). Mirrors the helper in
 * autocomplete.test.ts and lipu-model.test.ts.
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

/**
 * Simulate the blur DOM event by calling each
 * plugin's handleDOMEvents.blur in order.
 */
function simulateBlur(editor: Editor): void {
  const { view } = editor;
  for (const plugin of view.state.plugins) {
    const handler = plugin.props.handleDOMEvents?.blur;
    if (handler) {
      handler.call(plugin, view, new FocusEvent("blur"));
    }
  }
}

const settle = (): Promise<void> =>
  new Promise((r) => queueMicrotask(() => r()));

/**
 * Type text one character at a time, mirroring real
 * keyboard input: each character is first offered to
 * every plugin's handleTextInput (this is where
 * VerbatimToggle marks characters typed while active,
 * and strips mark propagation at a verbatim boundary
 * while inactive); if no plugin handles it, fall back
 * to the normal insertContent command path (used by
 * plain composing text, exactly as existing tests
 * drive it).
 */
function typeText(editor: Editor, text: string): void {
  const { view } = editor;
  for (const ch of text) {
    const { from, to } = view.state.selection;
    let handled = false;
    for (const plugin of view.state.plugins) {
      const handler = plugin.props.handleTextInput;
      if (handler) {
        const result = handler.call(
          plugin,
          view,
          from,
          to,
          ch,
          () => view.state.tr.insertText(ch, from, to)
        );
        if (result) {
          handled = true;
          break;
        }
      }
    }
    if (!handled) {
      editor.commands.insertContent(ch);
    }
  }
}

function verbatimActive(editor: Editor): boolean {
  const st = verbatimTogglePluginKey.getState(
    editor.state
  ) as VerbatimToggleState;
  return st.active;
}

/** The block's ANCHORS are what an earlier
 *  implementation called its
 *  SP-visible tokens (gap strings hold the rest). */
function lipuAnchors(editor: Editor) {
  const modelState = lipuModelKey.getState(editor.state);
  expect(modelState).toBeDefined();
  return modelState!.lipu.blocks[0].anchors;
}

describe("verbatim behavior matrix", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    "1: backtick then typing marks the run verbatim",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      simulateKeyDown(editor, "`");
      typeText(editor, "hello");

      assertInvariants(editor);
      expect(lipuAnchors(editor)).toEqual([
        { kind: "verbatim", text: "hello", marked: true },
      ]);

      editor.destroy();
    }
  );

  it(
    "2: double-backtick exit removes the inserted " +
      "backtick",
    () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);

      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      simulateKeyDown(editor, "`"); // enter
      typeText(editor, "hello");
      simulateKeyDown(editor, "`"); // literal `
      vi.setSystemTime(1_100); // +100ms, within 300ms
      simulateKeyDown(editor, "`"); // double-tap exit

      assertInvariants(editor);
      expect(lipuAnchors(editor)).toEqual([
        { kind: "verbatim", text: "hello", marked: true },
      ]);
      expect(verbatimActive(editor)).toBe(false);

      editor.destroy();
    }
  );

  it("3: Escape exit keeps content marked", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");

    simulateKeyDown(editor, "`");
    typeText(editor, "hello");
    simulateKeyDown(editor, "Escape");

    assertInvariants(editor);
    expect(lipuAnchors(editor)).toEqual([
      { kind: "verbatim", text: "hello", marked: true },
    ]);
    expect(verbatimActive(editor)).toBe(false);

    editor.destroy();
  });

  it(
    "4: literal backtick inside verbatim mode stays " +
      "marked",
    () => {
      vi.useFakeTimers();
      vi.setSystemTime(2_000);

      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      simulateKeyDown(editor, "`"); // enter
      typeText(editor, "hi");
      vi.setSystemTime(2_500); // outside 300ms window
      simulateKeyDown(editor, "`"); // literal `
      typeText(editor, "there");

      assertInvariants(editor);
      expect(lipuAnchors(editor)).toEqual([
        {
          kind: "verbatim",
          text: "hi`there",
          marked: true,
        },
      ]);
      expect(verbatimActive(editor)).toBe(true);

      editor.destroy();
    }
  );

  it(
    "5: Escape-rejection of a no-match word marks " +
      "it (mark-only transaction reaches the lipu)",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("zzz");

      simulateKeyDown(editor, "Escape");

      assertInvariants(editor);
      expect(lipuAnchors(editor)).toEqual([
        { kind: "verbatim", text: "zzz", marked: true },
      ]);
      expect(verbatimActive(editor)).toBe(true);

      editor.destroy();
    }
  );

  it(
    "6: blur mid-composition marks the composing " +
      "text",
    async () => {
      const editor = createEditor("<p></p>");
      focusTracker.reset();
      focusTracker.notifyFocus("sp");
      editor.commands.focus("end");
      typeText(editor, "tok"); // matches "toki"

      simulateBlur(editor);
      // FOCUS DEFERRAL: the mark rides
      // the FocusTracker's settle now, not the blur
      // event itself — nothing has happened yet.
      expect(lipuAnchors(editor)).toEqual([
        { kind: "verbatim", text: "tok" },
      ]);
      await settle();

      assertInvariants(editor);
      expect(lipuAnchors(editor)).toEqual([
        { kind: "verbatim", text: "tok", marked: true },
      ]);

      editor.destroy();
      focusTracker.reset();
    }
  );

  it(
    "6b: blur TO THE PEER PANE does NOT mark the " +
      "composing text (the pending run is " +
      "still being composed, one pane over)",
    async () => {
      const editor = createEditor("<p></p>");
      focusTracker.reset();
      focusTracker.notifyFocus("sp");
      editor.commands.focus("end");
      typeText(editor, "tok");

      simulateBlur(editor);
      // the peer answers the blur before the settle
      focusTracker.notifyFocus("latin");
      await settle();

      assertInvariants(editor);
      expect(lipuAnchors(editor)).toEqual([
        { kind: "verbatim", text: "tok" },
      ]);

      editor.destroy();
      focusTracker.reset();
    }
  );

  it(
    "6c: a SHARED-extension editor that is NOT the " +
      "SP pane (NameInput) marks SYNCHRONOUSLY on " +
      "blur and leaves the pane's focus state alone",
    async () => {
      const editor = createEditor("<p></p>");
      const pane = createEditor("<p></p>");
      focusTracker.reset();
      focusTracker.claimSpView(pane.view);
      editor.commands.focus("end");
      typeText(editor, "tok");

      // the SP pane holds focus and keeps it: a
      // non-pane blur must not borrow the pane's
      // single pendingBlur slot
      focusTracker.notifyFocus("sp");
      simulateBlur(editor);
      // SYNCHRONOUS: nothing was deferred
      assertInvariants(editor);
      expect(lipuAnchors(editor)).toEqual([
        { kind: "verbatim", text: "tok", marked: true },
      ]);
      await settle();
      expect(focusTracker.focused()).toBe("sp");

      focusTracker.claimSpView(null);
      focusTracker.reset();
      pane.destroy();
      editor.destroy();
    }
  );

  it(
    "7: mixed block: glyph + marked span + unmarked " +
      "composing tail",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      // committed glyph (Tab, no trailing space)
      typeText(editor, "tok");
      simulateKeyDown(editor, "Tab");

      // marked verbatim span
      simulateKeyDown(editor, "`");
      typeText(editor, "abc");
      simulateKeyDown(editor, "Escape");

      // unmarked composing tail, never committed
      typeText(editor, "de");

      assertInvariants(editor);
      expect(lipuAnchors(editor)).toEqual([
        { kind: "word", word: "toki" },
        { kind: "verbatim", text: "abc", marked: true },
        { kind: "verbatim", text: "de" },
      ]);

      editor.destroy();
    }
  );
});
