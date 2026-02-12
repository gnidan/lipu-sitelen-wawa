import React from "react";
import {
  describe,
  it,
  expect,
  afterEach,
} from "vitest";
import {
  render,
  cleanup,
  act,
} from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  SitelenPona,
} from "../extensions/sitelen-pona";
import {
  Autocomplete,
} from "../extensions/autocomplete";
import {
  AutocompletePopup,
} from "./AutocompletePopup";

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

describe("AutocompletePopup", () => {
  afterEach(cleanup);

  it("renders without crashing", () => {
    const editor = createEditor("<p></p>");
    const { container } = render(
      <AutocompletePopup
        editor={editor as any}
      />
    );
    expect(
      container.querySelector(
        ".autocomplete-popup"
      )
    ).toBeNull();
    editor.destroy();
  });

  it("shows popup when composing text", () => {
    const editor = createEditor("<p></p>");

    const { container } = render(
      <AutocompletePopup
        editor={editor as any}
      />
    );

    act(() => {
      editor.commands.focus("end");
      editor.commands.insertContent("tok");
    });

    const popup = container.querySelector(
      ".autocomplete-popup"
    );
    expect(popup).toBeTruthy();

    const items = container.querySelectorAll(
      ".autocomplete-item"
    );
    expect(items.length).toBeGreaterThan(0);
    editor.destroy();
  });

  it(
    "does not show popup for non-matching text",
    () => {
      const editor = createEditor("<p></p>");

      const { container } = render(
        <AutocompletePopup
          editor={editor as any}
        />
      );

      act(() => {
        editor.commands.focus("end");
        editor.commands.insertContent("xyz");
      });

      expect(
        container.querySelector(
          ".autocomplete-popup"
        )
      ).toBeNull();
      editor.destroy();
    }
  );

  it(
    "shows variant row for word with variants",
    () => {
      const editor = createEditor("<p></p>");

      const { container } = render(
        <AutocompletePopup
          editor={editor as any}
        />
      );

      // "ni" has 8 variants
      act(() => {
        editor.commands.focus("end");
        editor.commands.insertContent("ni");
      });

      const variants = container.querySelector(
        ".autocomplete-variants"
      );
      expect(variants).toBeTruthy();

      const buttons = container.querySelectorAll(
        ".autocomplete-variant-btn"
      );
      expect(buttons.length).toBe(8);
      editor.destroy();
    }
  );

  it(
    "shows structural hint for exact match",
    () => {
      const editor = createEditor("<p></p>");

      const { container } = render(
        <AutocompletePopup
          editor={editor as any}
        />
      );

      act(() => {
        editor.commands.focus("end");
        editor.commands.insertContent("toki");
      });

      const hint = container.querySelector(
        ".autocomplete-structural-hint"
      );
      expect(hint).toBeTruthy();
      expect(hint!.textContent).toContain(
        "+scale"
      );
      editor.destroy();
    }
  );

  it(
    "does not show structural hint " +
      "for partial match",
    () => {
      const editor = createEditor("<p></p>");

      const { container } = render(
        <AutocompletePopup
          editor={editor as any}
        />
      );

      act(() => {
        editor.commands.focus("end");
        editor.commands.insertContent("tok");
      });

      const hint = container.querySelector(
        ".autocomplete-structural-hint"
      );
      expect(hint).toBeNull();
      editor.destroy();
    }
  );
});
