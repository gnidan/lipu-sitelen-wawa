import React, { useCallback } from "react";
import { Editor } from "@tiptap/core";
import { useDocumentExport } from "../hooks";

interface OutputPanelProps {
  editor: Editor | null;
}

export function OutputPanel({
  editor,
}: OutputPanelProps) {
  const { latin, ucsur } = useDocumentExport(
    editor
  );

  const copyLatin = useCallback(() => {
    navigator.clipboard.writeText(latin);
  }, [latin]);

  const copyUcsur = useCallback(() => {
    navigator.clipboard.writeText(ucsur);
  }, [ucsur]);

  return (
    <div className="output-panel">
      <div className="output-panel__section">
        <h3>sitelen Lasina</h3>
        <pre className="output-panel__text">
          {latin}
        </pre>
        <button
          className="output-panel__copy"
          onClick={copyLatin}
        >
          Copy
        </button>
      </div>
      <div className="output-panel__section">
        <h3>sitelen pona (UCSUR)</h3>
        <pre className="output-panel__text">
          {ucsur}
        </pre>
        <button
          className="output-panel__copy"
          onClick={copyUcsur}
        >
          Copy
        </button>
      </div>
    </div>
  );
}
