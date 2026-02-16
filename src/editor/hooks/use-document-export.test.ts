import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  SitelenPona,
} from "../extensions/sitelen-pona";
import {
  useDocumentExport,
} from "./use-document-export";
import {
  codepointToChar,
  SCALING_JOINER,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  START_OF_LONG_GLYPH,
  END_OF_LONG_GLYPH,
} from "../../data";

function createEditor(content = "") {
  return new Editor({
    extensions: [StarterKit, SitelenPona],
    content,
  });
}

describe("useDocumentExport", () => {
  it(
    "returns empty strings for null editor",
    () => {
      const { result } = renderHook(() =>
        useDocumentExport(null)
      );
      expect(result.current.latin).toBe("");
      expect(result.current.ucsur).toBe("");
    }
  );

  it(
    "returns empty strings for empty doc",
    () => {
      const editor = createEditor("<p></p>");
      const { result } = renderHook(() =>
        useDocumentExport(editor)
      );
      expect(result.current.latin).toBe("");
      expect(result.current.ucsur).toBe("");
      editor.destroy();
    }
  );

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

  it(
    "extracts sitelenPona via insertSitelenPona",
    () => {
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
    }
  );

  it(
    "handles variation on UCSUR output",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni", 2);

      const { result } = renderHook(() =>
        useDocumentExport(editor)
      );

      expect(result.current.latin).toBe("ni");

      // UCSUR char + arrow (up), no ZWJ
      const niChar = codepointToChar(0xF1941);
      expect(result.current.ucsur).toBe(
        niChar + "\u2191"
      );
      editor.destroy();
    }
  );

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

  it(
    "strips SCALING_JOINER in Latin export",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("toki");
      // Insert UCSUR control char directly
      const joinerChar = String.fromCodePoint(
        SCALING_JOINER
      );
      editor.commands.insertContent(joinerChar);
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
        `${tokiChar}${joinerChar}${ponaChar}`
      );
      editor.destroy();
    }
  );

  it(
    "abbreviates cartouche words in Latin export",
    () => {
      const editor = createEditor("<p></p>");
      const startChar = String.fromCodePoint(
        START_OF_CARTOUCHE
      );
      const endChar = String.fromCodePoint(
        END_OF_CARTOUCHE
      );
      editor.commands.insertContent(startChar);
      editor.commands.insertSitelenPona("toki");
      editor.commands.insertContent(endChar);

      const { result } = renderHook(() =>
        useDocumentExport(editor)
      );

      expect(result.current.latin).toBe("T");

      const tokiChar = codepointToChar(0xF196C);
      expect(result.current.ucsur).toBe(
        `${startChar}${tokiChar}${endChar}`
      );
      editor.destroy();
    }
  );

  it(
    "strips long glyph chars in Latin export",
    () => {
      const editor = createEditor("<p></p>");
      const startChar = String.fromCodePoint(
        START_OF_LONG_GLYPH
      );
      const endChar = String.fromCodePoint(
        END_OF_LONG_GLYPH
      );
      editor.commands.insertContent(startChar);
      editor.commands.insertSitelenPona("toki");
      editor.commands.insertContent(endChar);

      const { result } = renderHook(() =>
        useDocumentExport(editor)
      );

      expect(result.current.latin).toBe("toki");

      const tokiChar = codepointToChar(0xF196C);
      expect(result.current.ucsur).toBe(
        `${startChar}${tokiChar}${endChar}`
      );
      editor.destroy();
    }
  );
});
