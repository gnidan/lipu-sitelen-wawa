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
import type {
  SelectionMenuPluginState,
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

function mockAnalysis(overrides: any = {}) {
  return {
    text: "\uD83C",
    from: 1,
    to: 3,
    singleGlyphWithVariants: {
      word: "ni",
      currentIndex: 1,
    },
    containsUcsur: true,
    containsLatin: false,
    isSingleParagraph: true,
    glyphCount: 1,
    firstGlyphWord: "ni",
    secondGlyphWord: null,
    hasStackingJoiner: false,
    hasScalingJoiner: false,
    hasLongGlyphMarkers: false,
    hasCartoucheMarkers: false,
    insideCartouche: null,
    insideLongGlyph: null,
    adjacentLongGlyph: null,
    precedingLongGlyph: null,
    longGlyphContainerWord: null,
    cartoucheContentPreview: null,
    verbatimPreview: "ni",
    sitelenPonaPreview: null,
    ...overrides,
  };
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
          mockAnalysis()
        );
        editor.view.dispatch(tr);
      });

      const menu = container.querySelector(
        ".selection-menu"
      );
      expect(menu).toBeTruthy();

      const variations = getVariations("ni");
      const buttons = container.querySelectorAll(
        ".variant-row__btn"
      );
      // "ni" has no default option (variant 4 is
      // the default glyph), so count = variations
      expect(buttons.length).toBe(
        variations.length
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
          mockAnalysis()
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

  it(
    "shows only variation buttons (no default)",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("jaki");
      mockCoordsAtPos(editor);

      const { container } = render(
        <SelectionMenu
          editor={editor as any}
        />
      );

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          mockAnalysis({
            singleGlyphWithVariants: {
              word: "jaki",
              currentIndex: 1,
            },
            firstGlyphWord: "jaki",
            verbatimPreview: "jaki",
          })
        );
        editor.view.dispatch(tr);
      });

      const defaultBtn = container.querySelector(
        '[title="Default"]'
      );
      expect(defaultBtn).toBeNull();

      const buttons = container.querySelectorAll(
        ".variant-row__btn"
      );
      const variations = getVariations("jaki");
      expect(buttons.length).toBe(
        variations.length
      );
      editor.destroy();
    }
  );

  it(
    "plugin state contains actions array",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          mockAnalysis({
            glyphCount: 1,
            containsUcsur: true,
          })
        );
        editor.view.dispatch(tr);
      });

      const st =
        selectionMenuPluginKey.getState(
          editor.state
        ) as SelectionMenuPluginState;

      expect(st.analysis).toBeTruthy();
      expect(st.actions).toBeDefined();
      expect(
        Array.isArray(st.actions)
      ).toBe(true);
      // -1 = variant row is active initially
      expect(st.activeActionIndex).toBe(-1);
      editor.destroy();
    }
  );

  it(
    "ArrowDown meta advances activeActionIndex",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");

      // Set up with analysis that has actions
      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          mockAnalysis({
            glyphCount: 1,
            containsUcsur: true,
            verbatimPreview: "ni",
          })
        );
        editor.view.dispatch(tr);
      });

      const st1 =
        selectionMenuPluginKey.getState(
          editor.state
        ) as SelectionMenuPluginState;

      if (st1.actions.length < 1) {
        // Not enough actions to test nav
        editor.destroy();
        return;
      }

      // -1 = variant row initially
      expect(st1.activeActionIndex).toBe(-1);

      // Dispatch ArrowDown navigate meta
      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          {
            navigate: true,
            activeActionIndex: 0,
          }
        );
        editor.view.dispatch(tr);
      });

      const st2 =
        selectionMenuPluginKey.getState(
          editor.state
        ) as SelectionMenuPluginState;
      expect(st2.activeActionIndex).toBe(0);

      editor.destroy();
    }
  );

  it(
    "null meta resets plugin state",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          mockAnalysis()
        );
        editor.view.dispatch(tr);
      });

      const st1 =
        selectionMenuPluginKey.getState(
          editor.state
        ) as SelectionMenuPluginState;
      expect(st1.analysis).toBeTruthy();

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          null
        );
        editor.view.dispatch(tr);
      });

      const st2 =
        selectionMenuPluginKey.getState(
          editor.state
        ) as SelectionMenuPluginState;
      expect(st2.analysis).toBeNull();
      expect(st2.actions).toEqual([]);
      expect(st2.activeActionIndex).toBe(0);

      editor.destroy();
    }
  );
});
