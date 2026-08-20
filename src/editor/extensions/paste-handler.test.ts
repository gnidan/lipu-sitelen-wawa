import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from "./sitelen-pona";
import {
  PasteHandler,
  pasteHandlerKey,
} from "./paste-handler";
import {
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
} from "../../data";
import { glyph as ucsur } from "../../../test/helpers";

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

function countBreaks(editor: Editor): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "hardBreak") n += 1;
  });
  return n;
}

/**
 * Simulate a paste by calling handlePaste on the
 * plugin's props. We create a minimal clipboard
 * event-like object. `text/html` is always empty,
 * matching real plain-text-only pastes.
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
    "UCSUR text pastes unchanged, no double " +
      "conversion",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      const ucsurText =
        ucsur("toki") + " " + ucsur("pona");
      const handled = simulatePaste(
        editor,
        ucsurText
      );
      // The handler now owns this paste (no
      // text/html on the event) and inserts the
      // UCSUR text unchanged.
      expect(handled).toBe(true);
      expect(
        editor.state.doc.textContent
      ).toBe(ucsurText);
      editor.destroy();
    }
  );

  it(
    "non-convertible text still pastes as " +
      "markdown structure",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      const handled = simulatePaste(
        editor,
        "hello world 123"
      );
      // No tp conversion happens, but the handler
      // still owns and inserts the plain text.
      expect(handled).toBe(true);
      expect(
        editor.state.doc.textContent
      ).toBe("hello world 123");
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

describe("markdown newline semantics", () => {
  it(
    "multi-line toki pona keeps its line " +
      "structure",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      const handled = simulatePaste(
        editor,
        "jan li moku\n     li lape"
      );
      expect(handled).toBe(true);
      expect(editor.state.doc.childCount).toBe(1);
      expect(countBreaks(editor)).toBe(1);
      // Spacing is content: the second line's
      // leading spaces must survive.
      expect(
        editor.state.doc.textContent
      ).toContain("     ");
      editor.destroy();
    }
  );

  it("blank line separates paragraphs", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");

    const handled = simulatePaste(
      editor,
      "toki\n\npona"
    );
    expect(handled).toBe(true);
    expect(editor.state.doc.childCount).toBe(2);
    expect(countBreaks(editor)).toBe(0);
    const text = editor.state.doc.textContent;
    expect(text).toContain(ucsur("toki"));
    expect(text).toContain(ucsur("pona"));
    editor.destroy();
  });

  it("CRLF normalizes", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");

    const handled = simulatePaste(
      editor,
      "toki\r\npona"
    );
    expect(handled).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(countBreaks(editor)).toBe(1);
    editor.destroy();
  });

  it("trailing newline is stripped", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");

    const handled = simulatePaste(editor, "toki\n");
    expect(handled).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(countBreaks(editor)).toBe(0);
    editor.destroy();
  });

  it("leading blank line is stripped", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");

    const handled = simulatePaste(
      editor,
      "\n\ntoki"
    );
    expect(handled).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(countBreaks(editor)).toBe(0);
    editor.destroy();
  });

  it(
    "single-line paste mid-paragraph merges inline",
    () => {
      const tokiChar = ucsur("toki");
      const ponaChar = ucsur("pona");
      const editor = createEditor(
        `<p>${tokiChar}${ponaChar}</p>`
      );
      const mid = 1 + tokiChar.length;
      editor.commands.setTextSelection(mid);

      const handled = simulatePaste(
        editor,
        "toki"
      );
      expect(handled).toBe(true);
      expect(editor.state.doc.childCount).toBe(1);
      editor.destroy();
    }
  );

  it(
    "two-chunk paste mid-paragraph adds exactly " +
      "one boundary",
    () => {
      const tokiChar = ucsur("toki");
      const ponaChar = ucsur("pona");
      const editor = createEditor(
        `<p>${tokiChar}${ponaChar}</p>`
      );
      const mid = 1 + tokiChar.length;
      editor.commands.setTextSelection(mid);

      const handled = simulatePaste(
        editor,
        "X\n\nY"
      );
      expect(handled).toBe(true);
      expect(editor.state.doc.childCount).toBe(2);
      const first = editor.state.doc.child(0);
      const second = editor.state.doc.child(1);
      expect(first.textContent.endsWith("X")).toBe(
        true
      );
      expect(
        second.textContent.startsWith("Y")
      ).toBe(true);
      editor.destroy();
    }
  );

  it("UCSUR paste follows the same rules", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");

    const tokiChar = ucsur("toki");
    const ponaChar = ucsur("pona");
    const handled = simulatePaste(
      editor,
      `${tokiChar}\n${ponaChar}`
    );
    expect(handled).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(countBreaks(editor)).toBe(1);
    expect(
      editor.state.doc.textContent
    ).toBe(`${tokiChar}${ponaChar}`);
    editor.destroy();
  });

  it("whitespace-only line is preserved", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");

    const handled = simulatePaste(
      editor,
      "toki\n   \npona"
    );
    expect(handled).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(countBreaks(editor)).toBe(2);
    expect(
      editor.state.doc.textContent
    ).toContain("   ");
    editor.destroy();
  });

  it(
    "newline-only paste mid-paragraph is a no-op " +
      "the handler owns (not left to ProseMirror's " +
      "default split)",
    () => {
      const tokiChar = ucsur("toki");
      const ponaChar = ucsur("pona");
      for (const newlines of ["\n", "\n\n"]) {
        const editor = createEditor(
          `<p>${tokiChar}${ponaChar}</p>`
        );
        const mid = 1 + tokiChar.length;
        editor.commands.setTextSelection(mid);

        const handled = simulatePaste(
          editor,
          newlines
        );
        expect(handled).toBe(true);
        expect(editor.state.doc.childCount).toBe(1);
        expect(
          editor.state.doc.textContent
        ).toBe(`${tokiChar}${ponaChar}`);
        editor.destroy();
      }
    }
  );

  it("paste with text/html defers", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");

    const plugins = editor.view.state.plugins;
    let handled = false;
    for (const plugin of plugins) {
      const handlePaste = plugin.props.handlePaste;
      if (handlePaste) {
        const fakeEvent = {
          clipboardData: {
            getData: (type: string) => {
              if (type === "text/html") {
                return "<p>x</p>";
              }
              if (type === "text/plain") {
                return "toki";
              }
              return "";
            },
          },
          preventDefault: () => {},
        } as unknown as ClipboardEvent;
        const result = handlePaste.call(
          plugin,
          editor.view,
          fakeEvent,
          null as any
        );
        if (result) handled = true;
      }
    }
    expect(handled).toBe(false);
    editor.destroy();
  });

  it(
    "every paste transaction carries the " +
      "pasteHandlerKey meta",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.focus("end");

      let captured: Transaction | null = null;
      const onTr = ({
        transaction,
      }: {
        transaction: Transaction;
      }): void => {
        captured = transaction;
      };
      editor.on("transaction", onTr);
      const handled = simulatePaste(editor, "toki");
      editor.off("transaction", onTr);

      expect(handled).toBe(true);
      expect(captured).not.toBeNull();
      expect(
        captured!.getMeta(pasteHandlerKey)
      ).toEqual({ paste: true });
      editor.destroy();
    }
  );
});
