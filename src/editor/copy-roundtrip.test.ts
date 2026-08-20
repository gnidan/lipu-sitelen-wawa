import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from "./extensions/sitelen-pona";
import { PasteHandler } from "./extensions/paste-handler";
import { contentToLipu } from "./lipu-doc";
import { LineBreaks } from "./extensions/line-breaks";
import {
  LipuModel,
  lipuModelKey,
} from "./extensions/lipu-model";
import { assertInvariants } from "./test-invariants";
import {
  projectLipu,
  copyText,
} from "../app/latin-projections";
import { glyph as ucsur } from "../../test/helpers";

function createEditor(content = "") {
  return new Editor({
    extensions: [StarterKit, SitelenPona, PasteHandler],
    content,
  });
}

/**
 * The Latin copy channel is a projection of the LIPU,
 * not of the doc, so its laws have to be stated over a
 * lipu the app can actually reach: LipuModel to own
 * it, LineBreaks to own Enter. Constructing the lipu
 * by hand (or by a bare contentToLipu) would test a
 * shape the editor never produces — notably it would
 * skip the paragraph-split path entirely, which is
 * exactly where companions can go wrong.
 */
function createModelEditor(content = "<p></p>") {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      PasteHandler,
      LineBreaks,
      LipuModel,
    ],
    content,
  });
}

function pressEnter(editor: Editor) {
  const { view } = editor;
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
  });
  for (const plugin of view.state.plugins) {
    const handler = plugin.props.handleKeyDown;
    if (handler && handler.call(plugin, view, event)) {
      return;
    }
  }
  throw new Error("Enter was not handled");
}

/** copyText of the editor's own live lipu. */
function copyFrom(editor: Editor): string {
  const state = lipuModelKey.getState(editor.state);
  expect(state).toBeDefined();
  return copyText(projectLipu(state!.lipu));
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
  const plugins = editor.view.state.plugins;
  for (const plugin of plugins) {
    const handlePaste = plugin.props.handlePaste;
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

/**
 * Builds "toki<br>pona" / "jan" by REAL keystrokes:
 * one Enter for the soft break, two for the paragraph
 * (LineBreaks deletes the run and splits). Driving it
 * this way is the point — it is the split path, not
 * the paste path, that can strand a companion.
 */
function typeTokiPonaJan(): Editor {
  const editor = createModelEditor(
    `<p>${ucsur("toki")}</p>`
  );
  editor.commands.focus("end");
  pressEnter(editor);
  editor.commands.insertContent(ucsur("pona"));
  pressEnter(editor);
  pressEnter(editor);
  editor.commands.insertContent(ucsur("jan"));
  return editor;
}

function countHardBreaks(
  editor: Editor,
  paragraphIndex: number
): number {
  let n = 0;
  const para = editor.state.doc.child(paragraphIndex);
  para.forEach((child) => {
    if (child.type.name === "hardBreak") n += 1;
  });
  return n;
}

describe("copy round-trip", () => {
  it(
    "SP-editor copy text round-trips through paste",
    () => {
      const toki = ucsur("toki");
      const pona = ucsur("pona");
      const jan = ucsur("jan");

      const editorA = createEditor(
        `<p>${toki}<br>${pona}</p><p>${jan}</p>`
      );

      // TipTap's getText uses the same
      // textSerializers as the always-on
      // ClipboardTextSerializer (hardBreak -> "\n",
      // blockSeparator default "\n\n"), so this
      // stands in for the clipboard payload.
      const text = editorA.getText();
      expect(text).toBe(
        `${toki}\n${pona}\n\n${jan}`
      );

      const editorB = createEditor("<p></p>");
      editorB.commands.focus("end");
      const handled = simulatePaste(editorB, text);
      expect(handled).toBe(true);

      expect(
        contentToLipu(editorB.getJSON())
      ).toEqual(contentToLipu(editorA.getJSON()));

      editorA.destroy();
      editorB.destroy();
    }
  );

  it(
    "Latin copyText round-trips STRUCTURE through " +
      "paste",
    () => {
      const editorA = typeTokiPonaJan();
      assertInvariants(editorA);
      const text = copyFrom(editorA);
      expect(text).toBe("toki\npona\n\njan");

      const editorC = createModelEditor();
      editorC.commands.focus("end");
      const handled = simulatePaste(editorC, text);
      expect(handled).toBe(true);
      assertInvariants(editorC);

      // The break itself is SP-owned and invisible to
      // renderLatin, but its COMPANION is ordinary
      // latin content, so the Latin channel carries
      // line structure again: paragraph AND line
      // counts both round-trip. Token arrays are NOT
      // compared — a pasted break is a fresh
      // insertion and gets a fresh companion, so the
      // law is about structure, not identity.
      expect(editorC.state.doc.childCount).toBe(
        editorA.state.doc.childCount
      );
      const paragraphCount =
        editorA.state.doc.childCount;
      expect(countHardBreaks(editorA, 0)).toBe(1);
      for (let i = 0; i < paragraphCount; i++) {
        expect(countHardBreaks(editorC, i)).toBe(
          countHardBreaks(editorA, i)
        );
      }

      editorA.destroy();
      editorC.destroy();
    }
  );

  // Structure round-tripping is not enough on its own:
  // a stray companion changes the TEXT without
  // changing the paragraph or line counts (the
  // orphan-on-split bug re-copied "toki\npona\n\njan"
  // as "toki\npona\n\n\njan"). Idempotence is the
  // check that notices.
  it(
    "copy -> paste -> copy is idempotent",
    () => {
      const editorA = typeTokiPonaJan();
      const copy1 = copyFrom(editorA);

      const editorB = createModelEditor();
      editorB.commands.focus("end");
      expect(simulatePaste(editorB, copy1)).toBe(true);
      assertInvariants(editorB);
      const copy2 = copyFrom(editorB);

      const editorC = createModelEditor();
      editorC.commands.focus("end");
      expect(simulatePaste(editorC, copy2)).toBe(true);
      assertInvariants(editorC);
      const copy3 = copyFrom(editorC);

      expect(copy2).toBe(copy1);
      expect(copy3).toBe(copy2);

      editorA.destroy();
      editorB.destroy();
      editorC.destroy();
    }
  );

  // The gesture from the bug report, end to end:
  // Enter-Enter with nothing between the paragraphs.
  it(
    "Enter-Enter copies as exactly one blank line",
    () => {
      const editor = createModelEditor(
        `<p>${ucsur("toki")}</p>`
      );
      editor.commands.focus("end");
      pressEnter(editor);
      pressEnter(editor);
      editor.commands.insertContent(ucsur("pona"));

      expect(editor.state.doc.childCount).toBe(2);
      expect(copyFrom(editor)).toBe("toki\n\npona");
      assertInvariants(editor);

      editor.destroy();
    }
  );
});
