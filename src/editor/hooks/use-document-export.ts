import { useMemo } from "react";
import { Editor } from "@tiptap/core";
import { toLatin } from "../../convert";

export interface DocumentExport {
  latin: string;
  ucsur: string;
}

/**
 * Walk a ProseMirror doc and extract parallel Latin
 * and UCSUR representations.
 *
 * UCSUR export: raw text content (already UCSUR).
 * Latin export: toLatin() handles word mapping,
 * space insertion, control char stripping, and
 * cartouche capitalization.
 */
function extractDocument(
  editor: Editor
): DocumentExport {
  const { doc } = editor.state;
  const ucsur = doc.textBetween(
    0,
    doc.content.size,
    "\n"
  );

  return {
    latin: toLatin(ucsur),
    ucsur,
  };
}

export function useDocumentExport(
  editor: Editor | null
): DocumentExport {
  const json = editor?.getJSON();

  return useMemo(() => {
    if (!editor || editor.isDestroyed) {
      return { latin: "", ucsur: "" };
    }
    return extractDocument(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, json]);
}
