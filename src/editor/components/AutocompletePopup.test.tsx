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
import { focusTracker } from "../focus-tracker";

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
    "shows direction hint for ni",
    () => {
      const editor = createEditor("<p></p>");

      const { container } = render(
        <AutocompletePopup
          editor={editor as any}
        />
      );

      act(() => {
        editor.commands.focus("end");
        editor.commands.insertContent("ni");
      });

      // ni shows direction hint with compass keys
      const hint = container.querySelector(
        ".autocomplete-ni-hint"
      );
      expect(hint).toBeTruthy();

      const compass = container.querySelector(
        ".ni-hint-compass"
      );
      expect(compass).toBeTruthy();

      const keys = container.querySelectorAll(
        ".ni-hint-compass__key"
      );
      expect(keys.length).toBe(3);
      const labels = Array.from(keys)
        .map((k) => k.textContent);
      expect(labels).toEqual(["^", "<", ">"]);

      const dirLabel = container.querySelector(
        ".ni-hint-compass__label"
      );
      expect(dirLabel).toBeTruthy();

      editor.destroy();
    }
  );

});

/**
 * The POPUP is
 * render-gated on PEER focus, so typing in the Latin
 * pane can never sprout an SP suggestion list over
 * the sitelen pona side. The gate is on the peer
 * holding focus, NOT on "the SP editor is
 * unfocused": a click into the popup itself blurs
 * the SP editor to null and must keep working
 * exactly as it does today.
 */
describe("AutocompletePopup peer-focus gate", () => {
  afterEach(() => {
    cleanup();
    focusTracker.reset();
  });

  it("hides while the LATIN pane holds focus and " +
     "comes back when the SP pane regains it", () => {
    const editor = createEditor("<p></p>");
    focusTracker.reset();
    focusTracker.notifyFocus("sp");

    const { container } = render(
      <AutocompletePopup editor={editor as any} />
    );

    act(() => {
      editor.commands.focus("end");
      editor.commands.insertContent("tok");
    });
    expect(
      container.querySelector(".autocomplete-popup")
    ).toBeTruthy();

    act(() => {
      focusTracker.notifyFocus("latin");
    });
    expect(
      container.querySelector(".autocomplete-popup")
    ).toBeNull();

    act(() => {
      focusTracker.notifyFocus("sp");
    });
    expect(
      container.querySelector(".autocomplete-popup")
    ).toBeTruthy();

    editor.destroy();
  });

  it("a NON-pane popup (NameInput) is never " +
     "peer-gated: it shares the extension, not " +
     "the pane", () => {
    const editor = createEditor("<p></p>");
    const pane = createEditor("<p></p>");
    focusTracker.reset();
    focusTracker.claimSpView(pane.view);

    const { container } = render(
      <AutocompletePopup editor={editor as any} />
    );
    act(() => {
      editor.commands.focus("end");
      editor.commands.insertContent("tok");
    });
    expect(
      container.querySelector(".autocomplete-popup")
    ).toBeTruthy();

    act(() => {
      focusTracker.notifyFocus("latin");
    });
    // still up: this popup belongs to an editor
    // that is not the SP pane, so "the peer holds
    // focus" says nothing about it
    expect(
      container.querySelector(".autocomplete-popup")
    ).toBeTruthy();

    focusTracker.claimSpView(null);
    pane.destroy();
    editor.destroy();
  });

  it("a blur to NOTHING (popup click) does not " +
     "gate it: only the peer does", () => {
    const editor = createEditor("<p></p>");
    focusTracker.reset();
    focusTracker.notifyFocus("sp");

    const { container } = render(
      <AutocompletePopup editor={editor as any} />
    );
    act(() => {
      editor.commands.focus("end");
      editor.commands.insertContent("tok");
    });

    act(() => {
      focusTracker.reset(); // nothing focused
    });
    expect(
      container.querySelector(".autocomplete-popup")
    ).toBeTruthy();

    editor.destroy();
  });
});
