import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from "./sitelen-pona";
import { PasteHandler } from "./paste-handler";
import {
  codepointToChar,
  wordToCodepoint,
  isUcsurChar,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
} from "../../data";

function ucsur(word: string): string {
  return codepointToChar(wordToCodepoint[word]);
}

function createEditor(content = "") {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      PasteHandler,
    ],
    content,
  });
}

/**
 * Simulate a paste by calling handlePaste on the
 * plugin's props. We create a minimal clipboard
 * event-like object.
 */
function simulatePaste(
  editor: Editor,
  text: string
): boolean {
  const plugins =
    editor.view.state.plugins;
  for (const plugin of plugins) {
    const handlePaste =
      plugin.props.handlePaste;
    if (handlePaste) {
      const fakeEvent = {
        clipboardData: {
          getData: (type: string) =>
            type === "text/plain" ? text : "",
        },
        preventDefault: () => {},
      } as unknown as ClipboardEvent;
      const result = handlePaste.call(
        plugin,
        editor.view,
        fakeEvent,
        // ProseMirror passes a Slice but our
        // plugin only uses the event
        null as any
      );
      if (result) return true;
    }
  }
  return false;
}

const cartStart = String.fromCodePoint(
  START_OF_CARTOUCHE
);
const cartEnd = String.fromCodePoint(
  END_OF_CARTOUCHE
);
const cartExt = String.fromCodePoint(
  CARTOUCHE_EXTENSION
);

describe("PasteHandler", () => {
  it("converts Latin toki pona to UCSUR", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");

    const handled = simulatePaste(
      editor,
      "toki pona"
    );
    expect(handled).toBe(true);

    const text = editor.state.doc.textContent;
    expect(text).toContain(ucsur("toki"));
    expect(text).toContain(ucsur("pona"));
    editor.destroy();
  });

  it(
    "passes through text with UCSUR chars",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      const ucsurText =
        ucsur("toki") + " " + ucsur("pona");
      const handled = simulatePaste(
        editor,
        ucsurText
      );
      // Should return false — let PM handle it
      expect(handled).toBe(false);
      editor.destroy();
    }
  );

  it(
    "passes through text with no tp words",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      const handled = simulatePaste(
        editor,
        "hello world 123"
      );
      // No conversion happened
      expect(handled).toBe(false);
      editor.destroy();
    }
  );

  it(
    "wraps capitalized tp words in cartouches",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      const handled = simulatePaste(
        editor,
        "jan Toki Pona li pona"
      );
      expect(handled).toBe(true);

      const text = editor.state.doc.textContent;
      // Check cartouche markers present
      expect(text).toContain(cartStart);
      expect(text).toContain(cartEnd);
      // Check toki pona words converted
      expect(text).toContain(ucsur("jan"));
      expect(text).toContain(ucsur("li"));
      editor.destroy();
    }
  );
});
