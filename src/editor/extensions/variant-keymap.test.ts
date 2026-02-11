import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection } from "@tiptap/pm/state";
import { SitelenPonaNode } from "./sitelen-pona-node";
import { VariantKeymap } from "./variant-keymap";

function createEditor(content = "") {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPonaNode,
      VariantKeymap,
    ],
    content,
  });
}

function selectSitelenPonaNode(editor: Editor) {
  const { doc } = editor.state;
  let nodePos: number | null = null;
  doc.descendants((node, pos) => {
    if (
      node.type.name === "sitelenPona" &&
      nodePos === null
    ) {
      nodePos = pos;
      return false;
    }
    return true;
  });
  if (nodePos === null) {
    throw new Error("No sitelenPona node found");
  }
  const resolved = editor.state.doc.resolve(nodePos);
  const sel = NodeSelection.create(
    editor.state.doc,
    resolved.pos
  );
  editor.view.dispatch(
    editor.state.tr.setSelection(sel)
  );
}

describe("VariantKeymap", () => {
  it("sets variation when node is selected", () => {
    const editor = createEditor("<p></p>");
    editor.commands.insertSitelenPona("ni");
    selectSitelenPonaNode(editor);

    // Simulate pressing "3" via keyboard shortcut
    const shortcuts =
      VariantKeymap.config.addKeyboardShortcuts!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = shortcuts.call({ editor } as any);
    const result = (
      handlers as Record<
        string,
        (args: { editor: Editor }) => boolean
      >
    )["3"]({ editor });
    expect(result).toBe(true);

    const doc = editor.getJSON();
    const paragraph = doc.content?.[0];
    const node = paragraph?.content?.find(
      (n: { type?: string }) =>
        n.type === "sitelenPona"
    );
    expect(node?.attrs?.variation).toBe(3);
    editor.destroy();
  });

  it("key 0 resets variation to null", () => {
    const editor = createEditor("<p></p>");
    editor.commands.insertSitelenPona("ni", 3);
    selectSitelenPonaNode(editor);

    const shortcuts =
      VariantKeymap.config.addKeyboardShortcuts!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = shortcuts.call({ editor } as any);
    const result = (
      handlers as Record<
        string,
        (args: { editor: Editor }) => boolean
      >
    )["0"]({ editor });
    expect(result).toBe(true);

    const doc = editor.getJSON();
    const paragraph = doc.content?.[0];
    const node = paragraph?.content?.find(
      (n: { type?: string }) =>
        n.type === "sitelenPona"
    );
    expect(node?.attrs?.variation).toBeNull();
    editor.destroy();
  });

  it("falls through when no node selected", () => {
    const editor = createEditor(
      "<p>hello world</p>"
    );
    editor.commands.focus("end");

    const shortcuts =
      VariantKeymap.config.addKeyboardShortcuts!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = shortcuts.call({ editor } as any);
    const result = (
      handlers as Record<
        string,
        (args: { editor: Editor }) => boolean
      >
    )["3"]({ editor });
    expect(result).toBe(false);
    editor.destroy();
  });

  it("falls through for word without variations", () => {
    const editor = createEditor("<p></p>");
    // "toki" has no variations in the data
    editor.commands.insertSitelenPona("toki");
    selectSitelenPonaNode(editor);

    const shortcuts =
      VariantKeymap.config.addKeyboardShortcuts!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = shortcuts.call({ editor } as any);
    const result = (
      handlers as Record<
        string,
        (args: { editor: Editor }) => boolean
      >
    )["3"]({ editor });
    expect(result).toBe(false);
    editor.destroy();
  });
});
