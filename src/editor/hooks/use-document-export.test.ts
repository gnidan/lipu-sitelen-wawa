import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  SitelenPonaNode,
} from "../extensions/sitelen-pona-node";
import {
  useDocumentExport,
} from "./use-document-export";
import { codepointToChar } from "../../data";

function createEditor(content = "") {
  return new Editor({
    extensions: [StarterKit, SitelenPonaNode],
    content,
  });
}

describe("useDocumentExport", () => {
  it("returns empty strings for null editor", () => {
    const { result } = renderHook(() =>
      useDocumentExport(null)
    );
    expect(result.current.latin).toBe("");
    expect(result.current.ucsur).toBe("");
  });

  it("returns empty strings for empty doc", () => {
    const editor = createEditor("<p></p>");
    const { result } = renderHook(() =>
      useDocumentExport(editor)
    );
    expect(result.current.latin).toBe("");
    expect(result.current.ucsur).toBe("");
    editor.destroy();
  });

  it("extracts plain text as-is", () => {
    const editor = createEditor(
      "<p>hello world</p>"
    );
    const { result } = renderHook(() =>
      useDocumentExport(editor)
    );
    expect(result.current.latin).toBe(
      "hello world"
    );
    expect(result.current.ucsur).toBe(
      "hello world"
    );
    editor.destroy();
  });

  it("extracts sitelenPona nodes correctly", () => {
    const editor = createEditor("<p></p>");
    editor.commands.insertSitelenPona("toki");
    editor.commands.insertContent(" ");
    editor.commands.insertSitelenPona("pona");

    const { result } = renderHook(() =>
      useDocumentExport(editor)
    );

    expect(result.current.latin).toBe(
      "toki pona"
    );

    const tokiChar = codepointToChar(0xF196C);
    const ponaChar = codepointToChar(0xF1954);
    expect(result.current.ucsur).toBe(
      `${tokiChar} ${ponaChar}`
    );
    editor.destroy();
  });

  it("handles variation on UCSUR output", () => {
    const editor = createEditor("<p></p>");
    editor.commands.insertSitelenPona("ni", 2);

    const { result } = renderHook(() =>
      useDocumentExport(editor)
    );

    expect(result.current.latin).toBe("ni");

    // UCSUR char + variation selector
    const niChar = codepointToChar(0xF1941);
    const vs = String.fromCodePoint(0xFE01);
    expect(result.current.ucsur).toBe(
      niChar + vs
    );
    editor.destroy();
  });

  it("handles multiple paragraphs", () => {
    const editor = createEditor(
      "<p>taso</p><p>pona</p>"
    );
    const { result } = renderHook(() =>
      useDocumentExport(editor)
    );
    expect(result.current.latin).toBe(
      "taso\npona"
    );
    editor.destroy();
  });
});
