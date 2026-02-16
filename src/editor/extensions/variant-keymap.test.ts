import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from "./sitelen-pona";
import { VariantKeymap } from "./variant-keymap";
import { Autocomplete } from "./autocomplete";
import {
  codepointToChar,
  applyVariation,
  niDirString,
  niDirectionByIndex,
} from "../../data";

function createEditor(content = "") {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      Autocomplete,
      VariantKeymap,
    ],
    content,
  });
}

describe("VariantKeymap", () => {
  it(
    "sets variation on UCSUR char before cursor",
    () => {
      const editor = createEditor("<p></p>");
      // Insert "ni" as UCSUR
      editor.commands.insertSitelenPona("ni");
      // Cursor should be right after the UCSUR char

      const shortcuts =
        VariantKeymap.config
          .addKeyboardShortcuts!;
      const handlers = shortcuts.call(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { editor } as any
      );
      const result = (
        handlers as Record<
          string,
          (args: { editor: Editor }) => boolean
        >
      )["3"]({ editor });
      expect(result).toBe(true);

      // Check that text now has ni + → (no ZWJ)
      const text =
        editor.state.doc.textContent;
      const dir = niDirectionByIndex(3)!;
      const expected = niDirString(0xF1941, dir);
      // Should be ni codepoint + arrow, no ZWJ
      expect(text).toBe(expected);
      expect(text).not.toContain("\u200D");
      editor.destroy();
    }
  );

  it("key 0 removes variation selector", () => {
    const editor = createEditor("<p></p>");
    editor.commands.insertSitelenPona("ni", 3);

    const shortcuts =
      VariantKeymap.config
        .addKeyboardShortcuts!;
    const handlers = shortcuts.call(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { editor } as any
    );
    const result = (
      handlers as Record<
        string,
        (args: { editor: Editor }) => boolean
      >
    )["0"]({ editor });
    expect(result).toBe(true);

    // Should be just the base UCSUR char
    const text = editor.state.doc.textContent;
    const niChar = codepointToChar(0xF1941);
    expect(text).toBe(niChar);
    editor.destroy();
  });

  it(
    "falls through when no UCSUR char " +
      "before cursor",
    () => {
      const editor = createEditor(
        "<p>hello world</p>"
      );
      editor.commands.focus("end");

      const shortcuts =
        VariantKeymap.config
          .addKeyboardShortcuts!;
      const handlers = shortcuts.call(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { editor } as any
      );
      const result = (
        handlers as Record<
          string,
          (args: { editor: Editor }) => boolean
        >
      )["3"]({ editor });
      expect(result).toBe(false);
      editor.destroy();
    }
  );

  it(
    "falls through for word without variations",
    () => {
      const editor = createEditor("<p></p>");
      // "toki" has no variations
      editor.commands.insertSitelenPona("toki");

      const shortcuts =
        VariantKeymap.config
          .addKeyboardShortcuts!;
      const handlers = shortcuts.call(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { editor } as any
      );
      const result = (
        handlers as Record<
          string,
          (args: { editor: Editor }) => boolean
        >
      )["3"]({ editor });
      expect(result).toBe(false);
      editor.destroy();
    }
  );
});
