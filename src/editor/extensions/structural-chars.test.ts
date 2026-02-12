import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from "./sitelen-pona";
import { Autocomplete } from "./autocomplete";
import {
  StructuralChars,
  isStructuralChar,
  STRUCTURAL_CHARS,
} from "./structural-chars";
import {
  codepointToChar,
  isUcsurChar,
  SCALING_JOINER,
} from "../../data";
import {
  asciiToUcsurControl,
} from "../../data/structural-map";

function createEditor(content = "") {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      Autocomplete,
      StructuralChars,
    ],
    content,
  });
}

describe("isStructuralChar", () => {
  it("returns true for structural chars", () => {
    for (const ch of [
      "+", "-", "[", "]", "(", ")", "{", "}",
      "=", "_",
    ]) {
      expect(isStructuralChar(ch)).toBe(true);
    }
  });

  it(
    "returns false for non-structural chars",
    () => {
      expect(isStructuralChar("a")).toBe(false);
      expect(isStructuralChar(" ")).toBe(false);
      expect(isStructuralChar("1")).toBe(false);
    }
  );
});

describe("STRUCTURAL_CHARS set", () => {
  it("has 10 members", () => {
    expect(STRUCTURAL_CHARS.size).toBe(10);
  });
});

describe("StructuralChars extension", () => {
  it("creates extension without errors", () => {
    const editor = createEditor("<p></p>");
    expect(editor).toBeTruthy();
    editor.destroy();
  });

  it(
    "inserts structural char as UCSUR control " +
      "via handleKeyDown",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      const { view } = editor;

      // Call handleKeyDown through the plugins
      let handled = false;
      const event = new KeyboardEvent(
        "keydown",
        { key: "+" }
      );
      view.state.plugins.forEach((plugin) => {
        if (handled) return;
        const handler =
          plugin.props.handleKeyDown;
        if (handler) {
          const result = handler.call(
            plugin, view, event
          );
          if (result) handled = true;
        }
      });

      expect(handled).toBe(true);

      const text =
        editor.state.doc.textContent;
      const expected =
        asciiToUcsurControl("+")!;
      expect(text).toBe(expected);
      editor.destroy();
    }
  );

  it(
    "commits composing word before inserting " +
      "structural char",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");
      editor.commands.insertContent("toki");

      const { view } = editor;

      let handled = false;
      const event = new KeyboardEvent(
        "keydown",
        { key: "+" }
      );
      view.state.plugins.forEach((plugin) => {
        if (handled) return;
        const handler =
          plugin.props.handleKeyDown;
        if (handler) {
          const result = handler.call(
            plugin, view, event
          );
          if (result) handled = true;
        }
      });

      expect(handled).toBe(true);

      const text =
        editor.state.doc.textContent;
      const tokiChar = codepointToChar(0xF196C);
      const scalingChar = String.fromCodePoint(
        SCALING_JOINER
      );
      expect(text).toBe(
        tokiChar + scalingChar
      );
      editor.destroy();
    }
  );
});
