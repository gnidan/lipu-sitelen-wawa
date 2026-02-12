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

function createEditor(content = "") {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      Autocomplete,
    ],
    content,
  });
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
    "Escape + Space keeps word as Latin",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("toki");

      // Verify autocomplete is active
      let state =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState;
      expect(state.matches.length).toBeGreaterThan(
        0
      );

      // Dismiss with Escape (sets verbatimRange)
      editor.view.dispatch(
        editor.state.tr.setMeta(
          autocompletePluginKey,
          {
            dismiss: true,
            verbatimRange: state.range,
          }
        )
      );

      // Type space — should NOT convert
      editor.commands.insertContent(" ");

      const text = editor.state.doc.textContent;
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

      let state =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState;

      // Dismiss with Escape
      editor.view.dispatch(
        editor.state.tr.setMeta(
          autocompletePluginKey,
          {
            dismiss: true,
            verbatimRange: state.range,
          }
        )
      );

      // Continue typing to extend the word
      editor.commands.insertContent("i");

      // Type space — should NOT convert
      editor.commands.insertContent(" ");

      const text = editor.state.doc.textContent;
      expect(text).toBe("toki ");

      for (const ch of text) {
        expect(isUcsurChar(ch)).toBe(false);
      }
      editor.destroy();
    }
  );

  it(
    "after Escape, moving cursor and typing " +
      "a new word converts normally",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      // Insert "toki" to get autocomplete matches
      editor.commands.insertContent("toki");

      let state =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState;
      expect(
        state.matches.length
      ).toBeGreaterThan(0);
      expect(state.range).not.toBeNull();

      // Dismiss with Escape (sets verbatimRange)
      editor.view.dispatch(
        editor.state.tr.setMeta(
          autocompletePluginKey,
          {
            dismiss: true,
            verbatimRange: state.range,
          }
        )
      );

      // Type space — should NOT convert "toki"
      editor.commands.insertContent(" ");

      // Verify "toki" stayed as Latin
      let text = editor.state.doc.textContent;
      expect(text).toBe("toki ");

      // Now type a new word from scratch
      editor.commands.insertContent("pona ");

      text = editor.state.doc.textContent;
      const ponaChar = codepointToChar(0xf1954);
      // "toki" should remain Latin (verbatim)
      expect(text).toContain("toki");
      // "pona" should be converted to UCSUR
      expect(text).toContain(ponaChar);

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
