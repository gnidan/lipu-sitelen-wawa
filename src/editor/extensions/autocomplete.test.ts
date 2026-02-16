import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from "./sitelen-pona";
import {
  Autocomplete,
  autocompletePluginKey,
  getComposingWord,
} from "./autocomplete";
import type {
  AutocompleteState,
} from "./autocomplete";
import {
  hasVariations,
  codepointToChar,
  isUcsurChar,
} from "../../data";
import {
  StructuralChars,
} from "./structural-chars";
import { Verbatim } from "./verbatim";
import {
  VerbatimToggle,
  verbatimTogglePluginKey,
} from "./verbatim-toggle";
import type {
  VerbatimToggleState,
} from "./verbatim-toggle";

function createEditor(content = "") {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      Autocomplete,
      StructuralChars,
      Verbatim,
      VerbatimToggle,
    ],
    content,
  });
}

/**
 * Helper: simulate a keydown event by calling
 * each plugin's handleKeyDown in order (matching
 * ProseMirror dispatch behavior).
 */
function simulateKeyDown(
  editor: Editor,
  key: string
): boolean {
  const { view } = editor;
  const event = new KeyboardEvent(
    "keydown",
    { key }
  );
  let handled = false;
  for (const plugin of view.state.plugins) {
    if (handled) break;
    const handler =
      plugin.props.handleKeyDown;
    if (handler) {
      const result = handler.call(
        plugin, view, event
      );
      if (result) handled = true;
    }
  }
  return handled;
}

describe("getComposingWord", () => {
  it("extracts Latin word at cursor", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");
    editor.commands.insertContent("tok");
    const result = getComposingWord(editor.state);
    expect(result).not.toBeNull();
    expect(result!.word).toBe("tok");
    editor.destroy();
  });

  it("returns null when no text", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");
    const result = getComposingWord(editor.state);
    expect(result).toBeNull();
    editor.destroy();
  });

  it("extracts full word not partial", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");
    editor.commands.insertContent("toki");
    const result = getComposingWord(editor.state);
    expect(result).not.toBeNull();
    expect(result!.word).toBe("toki");
    editor.destroy();
  });
});

describe("Autocomplete plugin state", () => {
  it("populates matches for valid prefix", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");
    editor.commands.insertContent("tok");

    const state = autocompletePluginKey.getState(
      editor.state
    ) as AutocompleteState;
    expect(state.prefix).toBe("tok");
    expect(
      state.matches.length
    ).toBeGreaterThan(0);
    expect(state.matches[0].word).toBe("toki");
    editor.destroy();
  });

  it(
    "returns empty for non-matching prefix",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("xyz");

      const state =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState;
      expect(state.matches).toHaveLength(0);
      editor.destroy();
    }
  );

  it("commits word on space as UCSUR text", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");
    editor.commands.insertContent("toki ");

    // After space, the word should be committed
    // as a UCSUR character in text content
    const text = editor.state.doc.textContent;
    const tokiChar = codepointToChar(0xF196C);
    expect(text).toContain(tokiChar);
    editor.destroy();
  });

  it("does not commit non-words on space", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");
    editor.commands.insertContent("hello ");

    const text = editor.state.doc.textContent;
    // Should remain as Latin text, no UCSUR chars
    expect(text).toBe("hello ");

    // Verify no UCSUR chars present
    for (const ch of text) {
      expect(isUcsurChar(ch)).toBe(false);
    }
    editor.destroy();
  });

  it(
    "converts multiple words in sequence",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("toki ");
      editor.commands.insertContent("pona ");

      const text = editor.state.doc.textContent;
      const tokiChar = codepointToChar(0xF196C);
      const ponaChar = codepointToChar(0xF1954);
      expect(text).toContain(tokiChar);
      expect(text).toContain(ponaChar);
      editor.destroy();
    }
  );
});

describe("verbatim mode (Escape to reject)", () => {
  it(
    "Escape applies verbatim mark and enters " +
      "verbatim mode",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("toki");

      // Verify autocomplete is active
      let state =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState;
      expect(
        state.matches.length
      ).toBeGreaterThan(0);

      // Press Escape
      simulateKeyDown(editor, "Escape");

      // Autocomplete should be dismissed
      state =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState;
      expect(state.matches).toHaveLength(0);
      expect(state.range).toBeNull();

      // Verbatim toggle should be active
      const vtState =
        verbatimTogglePluginKey.getState(
          editor.state
        ) as VerbatimToggleState;
      expect(vtState.active).toBe(true);

      // Text should have verbatim mark
      const $pos = editor.state.doc.resolve(
        editor.state.selection.from
      );
      const node = $pos.nodeBefore;
      const vt =
        editor.state.schema.marks.verbatim;
      expect(node?.isText).toBe(true);
      expect(
        vt.isInSet(node!.marks)
      ).toBeTruthy();

      editor.destroy();
    }
  );

  it(
    "Escape + Space keeps word as Latin",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("toki");

      // Press Escape (marks as verbatim +
      // activates verbatim mode)
      simulateKeyDown(editor, "Escape");

      // Type space — verbatim mode is active,
      // so space stays as Latin
      editor.commands.insertContent(" ");

      const text =
        editor.state.doc.textContent;
      expect(text).toBe("toki ");

      // Verify no UCSUR chars
      for (const ch of text) {
        expect(isUcsurChar(ch)).toBe(false);
      }
      editor.destroy();
    }
  );

  it(
    "Escape + continue typing + Space keeps " +
      "extended word as Latin",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("tok");

      // Press Escape (marks "tok" as verbatim)
      simulateKeyDown(editor, "Escape");

      // Continue typing — verbatim mode is
      // active, so "i" gets verbatim mark
      editor.commands.insertContent("i");

      // Type space
      editor.commands.insertContent(" ");

      const text =
        editor.state.doc.textContent;
      expect(text).toBe("toki ");

      for (const ch of text) {
        expect(isUcsurChar(ch)).toBe(false);
      }
      editor.destroy();
    }
  );

  it(
    "typo (no matches) allows backspace " +
      "recovery",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("tokx");

      // No matches — should be empty state
      // (no verbatim marking)
      let state =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState;
      expect(state.matches).toHaveLength(0);

      // Verify text has no verbatim mark
      const $pos = editor.state.doc.resolve(
        editor.state.selection.from
      );
      const node = $pos.nodeBefore;
      const vt =
        editor.state.schema.marks.verbatim;
      expect(
        node?.isText && vt.isInSet(node.marks)
      ).toBeFalsy();

      editor.destroy();
    }
  );
});

describe("digit key handling", () => {
  it(
    "handleKeyDown returns false for digits " +
      "when word has no variations",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("tok");

      const state =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState;
      expect(state.matches[0].word).toBe("toki");
      expect(
        hasVariations(state.matches[0].word)
      ).toBe(false);

      editor.destroy();
    }
  );

  it(
    "active word with variations can accept " +
      "digit commit",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("ni");

      const state =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState;
      expect(state.matches[0].word).toBe("ni");

      expect(
        hasVariations(state.matches[0].word)
      ).toBe(true);

      editor.destroy();
    }
  );
});

describe("ni direction buffering", () => {
  it(
    "autocomplete handleKeyDown runs before " +
      "structuralChars",
    () => {
      const editor = createEditor("<p></p>");
      const plugins = editor.view.state.plugins;

      const handlers: string[] = [];
      for (const plugin of plugins) {
        if (plugin.props.handleKeyDown) {
          const key =
            (plugin as any).key ?? "unknown";
          handlers.push(key);
        }
      }

      const acIdx = handlers.findIndex(
        (k) => k.includes("autocomplete")
      );
      const scIdx = handlers.findIndex(
        (k) => k.includes("structuralChars")
      );

      expect(acIdx).toBeGreaterThanOrEqual(0);
      expect(scIdx).toBeGreaterThanOrEqual(0);
      expect(acIdx).toBeLessThan(scIdx);

      editor.destroy();
    }
  );

  it(
    "buffers direction char in niDirBuffer " +
      "instead of committing",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("ni");

      // Verify autocomplete is active with "ni"
      let state =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState;
      expect(state.prefix).toBe("ni");
      expect(state.matches[0].word).toBe("ni");
      expect(state.niDirBuffer).toBe("");

      // Simulate pressing "^"
      const handled = simulateKeyDown(
        editor, "^"
      );
      expect(handled).toBe(true);

      // Check state: niDirBuffer should be "^"
      state =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState;
      expect(state.niDirBuffer).toBe("^");
      // Word should NOT be committed
      expect(state.prefix).toBe("ni");
      expect(
        state.matches.length
      ).toBeGreaterThan(0);

      // Verify "ni" is still Latin in the doc
      const text =
        editor.state.doc.textContent;
      expect(text).toBe("ni");

      editor.destroy();
    }
  );

  it(
    "direction char does not commit when " +
      "StructuralChars is present",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("ni");

      // Simulate pressing "<"
      const handled = simulateKeyDown(
        editor, "<"
      );
      expect(handled).toBe(true);

      // Word should not be committed
      const text =
        editor.state.doc.textContent;
      expect(text).toBe("ni");

      // Buffer should have "<"
      const state =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState;
      expect(state.niDirBuffer).toBe("<");

      editor.destroy();
    }
  );

  it(
    "two-char direction commits ni with " +
      "direction",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("ni");

      // Buffer first direction
      simulateKeyDown(editor, "^");

      // Second direction should commit
      const handled = simulateKeyDown(
        editor, "<"
      );
      expect(handled).toBe(true);

      // "ni" should be committed (replaced
      // with UCSUR)
      const text =
        editor.state.doc.textContent;
      expect(text).not.toBe("ni");

      // Verify it contains UCSUR chars
      let hasUcsur = false;
      for (const ch of text) {
        if (isUcsurChar(ch)) hasUcsur = true;
      }
      expect(hasUcsur).toBe(true);

      editor.destroy();
    }
  );
});
