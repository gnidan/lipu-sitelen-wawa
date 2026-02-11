import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPonaNode } from "./sitelen-pona-node";
import {
  AutoConvert,
  extractWordBeforeSpace,
} from "./auto-convert";

function createEditor(content = "") {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPonaNode,
      AutoConvert,
    ],
    content,
  });
}

describe("extractWordBeforeSpace", () => {
  it("extracts word before trailing space", () => {
    const result = extractWordBeforeSpace(
      "hello toki "
    );
    expect(result).toEqual({
      word: "toki",
      start: 6,
    });
  });

  it("returns null without trailing space", () => {
    expect(
      extractWordBeforeSpace("toki")
    ).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractWordBeforeSpace("")).toBeNull();
  });

  it("returns null for only space", () => {
    expect(extractWordBeforeSpace(" ")).toBeNull();
  });

  it("extracts single word", () => {
    const result = extractWordBeforeSpace("pona ");
    expect(result).toEqual({
      word: "pona",
      start: 0,
    });
  });

  it("handles mixed case", () => {
    const result = extractWordBeforeSpace("Toki ");
    expect(result).toEqual({
      word: "toki",
      start: 0,
    });
  });
});

describe("AutoConvert plugin", () => {
  it("converts toki pona word on space", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");
    editor.commands.insertContent("toki ");

    const doc = editor.getJSON();
    const paragraph = doc.content?.[0];
    const sitelenNode = paragraph?.content?.find(
      (n: { type?: string }) =>
        n.type === "sitelenPona"
    );
    expect(sitelenNode).toBeDefined();
    expect(sitelenNode?.attrs?.word).toBe("toki");
    editor.destroy();
  });

  it("does not convert non-toki-pona words", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");
    editor.commands.insertContent("hello ");

    const doc = editor.getJSON();
    const paragraph = doc.content?.[0];
    const sitelenNode = paragraph?.content?.find(
      (n: { type?: string }) =>
        n.type === "sitelenPona"
    );
    expect(sitelenNode).toBeUndefined();
    editor.destroy();
  });

  it("converts multiple words in sequence", () => {
    const editor = createEditor("<p></p>");
    editor.commands.focus("end");
    editor.commands.insertContent("toki ");

    editor.commands.insertContent("pona ");

    const doc = editor.getJSON();
    const paragraph = doc.content?.[0];
    const sitelenNodes = (
      paragraph?.content ?? []
    ).filter(
      (n: { type?: string }) =>
        n.type === "sitelenPona"
    );
    expect(sitelenNodes.length).toBe(2);
    expect(sitelenNodes[0]?.attrs?.word).toBe(
      "toki"
    );
    expect(sitelenNodes[1]?.attrs?.word).toBe(
      "pona"
    );
    editor.destroy();
  });
});
