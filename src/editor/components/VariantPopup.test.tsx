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
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  SitelenPona,
} from "../extensions/sitelen-pona";
import {
  Autocomplete,
} from "../extensions/autocomplete";
import {
  VariantPopup,
  createVariantPopupPlugin,
  variantPopupPluginKey,
} from "./VariantPopup";
import { getVariations } from "../../data";

const VariantPopupExtension = Extension.create({
  name: "variantPopupPlugin",
  addProseMirrorPlugins() {
    return [createVariantPopupPlugin()];
  },
});

function createEditor(content = "") {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      Autocomplete,
      VariantPopupExtension,
    ],
    content,
  });
}

describe("VariantPopup", () => {
  afterEach(cleanup);

  it(
    "does not render without popup state",
    () => {
      const editor = createEditor("<p></p>");
      const { container } = render(
        <VariantPopup editor={editor as any} />
      );
      expect(
        container.querySelector(".variant-popup")
      ).toBeNull();
      editor.destroy();
    }
  );

  it(
    "renders when plugin state is set with " +
      "coords",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");

      // Render first, then dispatch to trigger
      // the transaction listener
      const { container } = render(
        <VariantPopup editor={editor as any} />
      );

      // Set popup state via plugin meta
      act(() => {
        const tr = editor.state.tr.setMeta(
          variantPopupPluginKey,
          {
            word: "ni",
            from: 1,
            to: 3,
            coords: { left: 100, top: 200 },
          }
        );
        editor.view.dispatch(tr);
      });

      const popup = container.querySelector(
        ".variant-popup"
      );
      expect(popup).toBeTruthy();

      const variations = getVariations("ni");
      const buttons = container.querySelectorAll(
        ".variant-option"
      );
      // +1 for the default option
      expect(buttons.length).toBe(
        variations.length + 1
      );
      editor.destroy();
    }
  );

  it(
    "does not render when coords is null",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");

      const { container } = render(
        <VariantPopup editor={editor as any} />
      );

      act(() => {
        const tr = editor.state.tr.setMeta(
          variantPopupPluginKey,
          {
            word: "ni",
            from: 1,
            to: 3,
            coords: null,
          }
        );
        editor.view.dispatch(tr);
      });

      expect(
        container.querySelector(".variant-popup")
      ).toBeNull();
      editor.destroy();
    }
  );

  it("shows default option with key 0", () => {
    const editor = createEditor("<p></p>");
    editor.commands.insertSitelenPona("ni");

    const { container } = render(
      <VariantPopup editor={editor as any} />
    );

    act(() => {
      const tr = editor.state.tr.setMeta(
        variantPopupPluginKey,
        {
          word: "ni",
          from: 1,
          to: 3,
          coords: { left: 100, top: 200 },
        }
      );
      editor.view.dispatch(tr);
    });

    const defaultBtn = container.querySelector(
      '[title="Default"]'
    );
    expect(defaultBtn).toBeTruthy();
    expect(
      defaultBtn!.textContent
    ).toContain("0");
    editor.destroy();
  });
});
