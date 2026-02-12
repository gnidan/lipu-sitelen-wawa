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
  SelectionMenu,
  createSelectionMenuPlugin,
  selectionMenuPluginKey,
} from "./SelectionMenu";
import { getVariations } from "../../data";

const SelectionMenuExtension = Extension.create({
  name: "selectionMenuPlugin",
  addProseMirrorPlugins() {
    return [createSelectionMenuPlugin()];
  },
});

function createEditor(content = "") {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      Autocomplete,
      SelectionMenuExtension,
    ],
    content,
  });
}

function mockCoordsAtPos(editor: Editor) {
  (editor as any).view.coordsAtPos = () => ({
    left: 100,
    right: 110,
    top: 190,
    bottom: 200,
  });
}

describe("SelectionMenu", () => {
  afterEach(cleanup);

  it(
    "does not render without selection",
    () => {
      const editor = createEditor("<p></p>");
      const { container } = render(
        <SelectionMenu
          editor={editor as any}
        />
      );
      expect(
        container.querySelector(
          ".selection-menu"
        )
      ).toBeNull();
      editor.destroy();
    }
  );

  it(
    "renders variant grid when single glyph " +
      "with variants is set via meta",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");
      mockCoordsAtPos(editor);

      const { container } = render(
        <SelectionMenu
          editor={editor as any}
        />
      );

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          {
            text: "\uD83C",
            from: 1,
            to: 3,
            singleGlyphWithVariants: {
              word: "ni",
            },
            containsUcsur: true,
            containsLatin: false,
            isSingleParagraph: true,
            glyphCount: 1,
            firstGlyphWord: "ni",
            hasStackingJoiner: false,
            hasScalingJoiner: false,
            insideCartouche: null,
            insideLongGlyph: null,
            adjacentLongGlyph: null,
            precedingLongGlyph: null,
            verbatimPreview: "ni",
            sitelenPonaPreview: null,
          }
        );
        editor.view.dispatch(tr);
      });

      const menu = container.querySelector(
        ".selection-menu"
      );
      expect(menu).toBeTruthy();

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
    "hides menu when dismissed via meta",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");
      mockCoordsAtPos(editor);

      const { container } = render(
        <SelectionMenu
          editor={editor as any}
        />
      );

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          {
            text: "",
            from: 1,
            to: 3,
            singleGlyphWithVariants: {
              word: "ni",
            },
            containsUcsur: true,
            containsLatin: false,
            isSingleParagraph: true,
            glyphCount: 1,
            firstGlyphWord: "ni",
            hasStackingJoiner: false,
            hasScalingJoiner: false,
            insideCartouche: null,
            insideLongGlyph: null,
            adjacentLongGlyph: null,
            precedingLongGlyph: null,
            verbatimPreview: "ni",
            sitelenPonaPreview: null,
          }
        );
        editor.view.dispatch(tr);
      });

      expect(
        container.querySelector(
          ".selection-menu"
        )
      ).toBeTruthy();

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          null
        );
        editor.view.dispatch(tr);
      });

      expect(
        container.querySelector(
          ".selection-menu"
        )
      ).toBeNull();
      editor.destroy();
    }
  );

  it("shows default option with key 0", () => {
    const editor = createEditor("<p></p>");
    editor.commands.insertSitelenPona("ni");
    mockCoordsAtPos(editor);

    const { container } = render(
      <SelectionMenu
        editor={editor as any}
      />
    );

    act(() => {
      const tr = editor.state.tr.setMeta(
        selectionMenuPluginKey,
        {
          text: "",
          from: 1,
          to: 3,
          singleGlyphWithVariants: {
            word: "ni",
          },
          containsUcsur: true,
          containsLatin: false,
          isSingleParagraph: true,
          glyphCount: 1,
          containsJoiners: false,
          insideCartouche: null,
          insideLongGlyph: null,
          verbatimPreview: "ni",
          sitelenPonaPreview: null,
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
