import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPonaNode } from "./sitelen-pona-node";

function createEditor() {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPonaNode,
    ],
    content: "",
  });
}

describe("SitelenPonaNode", () => {
  it("has name 'sitelenPona'", () => {
    expect(SitelenPonaNode.name).toBe("sitelenPona");
  });

  it("is inline and atom", () => {
    const editor = createEditor();
    const nodeType =
      editor.schema.nodes.sitelenPona;
    expect(nodeType).toBeDefined();
    expect(nodeType.isInline).toBe(true);
    expect(nodeType.isAtom).toBe(true);
    editor.destroy();
  });

  it("has word and variation attributes", () => {
    const editor = createEditor();
    const nodeType =
      editor.schema.nodes.sitelenPona;
    const spec = nodeType.spec.attrs;
    expect(spec).toHaveProperty("word");
    expect(spec).toHaveProperty("variation");
    editor.destroy();
  });

  it("can create node via command", () => {
    const editor = createEditor();
    editor.commands.insertSitelenPona("toki");
    const doc = editor.getJSON();
    const paragraph = doc.content?.[0];
    const node = paragraph?.content?.find(
      (n: { type?: string }) =>
        n.type === "sitelenPona"
    );
    expect(node).toBeDefined();
    expect(node?.attrs?.word).toBe("toki");
    expect(node?.attrs?.variation).toBeNull();
    editor.destroy();
  });

  it("serializes to HTML with data attributes", () => {
    const editor = createEditor();
    editor.commands.insertSitelenPona("pona", 2);
    const html = editor.getHTML();
    expect(html).toContain("data-sitelen-pona");
    expect(html).toContain('data-word="pona"');
    expect(html).toContain('data-variation="2"');
    editor.destroy();
  });

  it("parses from HTML", () => {
    const editor = createEditor();
    editor.commands.setContent(
      '<p><span data-sitelen-pona="" ' +
      'data-word="jan" data-variation="1">' +
      "</span></p>"
    );
    const doc = editor.getJSON();
    const paragraph = doc.content?.[0];
    const node = paragraph?.content?.find(
      (n: { type?: string }) =>
        n.type === "sitelenPona"
    );
    expect(node).toBeDefined();
    expect(node?.attrs?.word).toBe("jan");
    expect(node?.attrs?.variation).toBe(1);
    editor.destroy();
  });
});
