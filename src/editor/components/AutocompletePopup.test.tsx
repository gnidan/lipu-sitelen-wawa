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
    "shows arrow hint for ni instead of variants",
    () => {
      const editor = createEditor("<p></p>");

      const { container } = render(
        <AutocompletePopup
          editor={editor as any}
        />
      );

      // "ni" shows arrow hint, not variant buttons
      act(() => {
        editor.commands.focus("end");
        editor.commands.insertContent("ni");
      });

      const hint = container.querySelector(
        ".autocomplete-ni-hint"
      );
      expect(hint).toBeTruthy();

      const arrows = container.querySelector(
        ".autocomplete-ni-arrows"
      );
      expect(arrows?.textContent).toBe(
        "←↑→↓↖↗↘↙"
      );

      // Should not show variant buttons
      const variants = container.querySelector(
        ".autocomplete-variants"
      );
      expect(variants).toBeNull();

      editor.destroy();
    }
  );

});
