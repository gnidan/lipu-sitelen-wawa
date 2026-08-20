import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from "./sitelen-pona";
import { LipuModel, lipuModelKey } from "./lipu-model";
import {
  MirrorHighlight,
  mirrorHighlightKey,
  setMirrorHighlights,
} from "./mirror-highlight";

function createEditor() {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      LipuModel,
      MirrorHighlight,
    ],
    content: "<p>toki pona</p>",
  });
}

describe("MirrorHighlight", () => {
  it(
    "meta transaction sets decorations covering " +
      "the given ranges",
    () => {
      const editor = createEditor();

      setMirrorHighlights(editor, [
        { from: 1, to: 5 },
      ]);

      const decos = mirrorHighlightKey.getState(
        editor.state
      );
      expect(decos).toBeDefined();
      const found = decos!.find(1, 5);
      expect(found).toHaveLength(1);
      expect(found[0].from).toBe(1);
      expect(found[0].to).toBe(5);

      editor.destroy();
    }
  );

  it(
    "zero-width ranges (to <= from) are filtered " +
      "out",
    () => {
      const editor = createEditor();

      setMirrorHighlights(editor, [
        { from: 3, to: 3 },
        { from: 5, to: 2 },
      ]);

      const decos = mirrorHighlightKey.getState(
        editor.state
      );
      expect(decos!.find()).toHaveLength(0);

      editor.destroy();
    }
  );

  it("a doc change clears the decorations", () => {
    const editor = createEditor();

    setMirrorHighlights(editor, [
      { from: 1, to: 5 },
    ]);
    expect(
      mirrorHighlightKey.getState(editor.state)!.find()
    ).toHaveLength(1);

    editor.commands.insertContent("x");

    expect(
      mirrorHighlightKey.getState(editor.state)!.find()
    ).toHaveLength(0);

    editor.destroy();
  });

  it(
    "a non-doc-changing, non-meta transaction " +
      "leaves prior decorations untouched",
    () => {
      const editor = createEditor();

      setMirrorHighlights(editor, [
        { from: 1, to: 5 },
      ]);

      // selection-only change: no doc change, no
      // mirrorHighlight meta
      editor.commands.setTextSelection(2);

      expect(
        mirrorHighlightKey
          .getState(editor.state)!
          .find()
      ).toHaveLength(1);

      editor.destroy();
    }
  );

  it(
    "meta-only mirrorHighlight dispatch does not " +
      "bump the lipu model's version (the value the " +
      "save trigger keys on) — confirms the " +
      "transaction is a true no-op for lipu-model",
    () => {
      const editor = createEditor();
      const before = lipuModelKey.getState(
        editor.state
      )!.version;

      setMirrorHighlights(editor, [
        { from: 1, to: 5 },
      ]);

      const after = lipuModelKey.getState(
        editor.state
      )!.version;
      expect(after).toBe(before);

      editor.destroy();
    }
  );
});
