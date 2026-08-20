import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NameAtom } from "./name-atom";

function mkLatin(): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ history: false }),
      NameAtom,
    ],
    content: { type: "doc", content: [] },
  });
}

function nodeKinds(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.child(0).forEach((c) => {
    out.push(c.type.name);
  });
  return out;
}

describe("NameAtom", () => {
  it("renders its spelling inside a marked span " +
     "and copies as plain text", () => {
    const editor = mkLatin();
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "latinName",
              attrs: {
                anchors: [
                  { kind: "word", word: "toki" },
                ],
                interiorLatin: [],
                text: "Toki",
              },
            },
          ],
        },
      ],
    });
    expect(nodeKinds(editor)).toEqual([
      "latinName",
    ]);
    expect(editor.state.doc.child(0).nodeSize).toBe(
      3
    );
    expect(editor.getText()).toBe("Toki");
    editor.destroy();
  });

  it("PARSE-HTML GUARD: pasted chip " +
     "HTML degrades to its text, never to a " +
     "zero-width attr-less atom", () => {
    // The attrs carry an opaque payload no html
    // attribute encodes; a matching parse rule
    // would mint an atom with DEFAULT attrs —
    // text "", anchors [] — which occupies one map
    // position and shows nothing. latin-paste.ts
    // owns a real chip paste.
    const editor = mkLatin();
    editor.commands.setContent(
      '<p><span data-latin-name="" ' +
        'class="latin-name">Toki</span> mi</p>'
    );
    expect(nodeKinds(editor)).toEqual(["text"]);
    expect(
      editor.state.doc.child(0).textContent
    ).toBe("Toki mi");
    editor.destroy();
  });
});
