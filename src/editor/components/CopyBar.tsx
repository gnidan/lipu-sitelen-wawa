import React, { useState } from "react";
import { Editor } from "@tiptap/core";
import { useDocumentExport } from "../hooks";

interface CopyBarProps {
  editor: Editor | null;
}

export function CopyBar({ editor }: CopyBarProps) {
  const { latin } = useDocumentExport(editor);
  const [open, setOpen] = useState(false);
  const empty = !latin;

  if (empty) return null;

  const cls = "latin-panel__toggle"
    + (open ? " latin-panel__toggle--open" : "");

  return (
    <div className="latin-panel">
      <button
        type="button"
        className={cls}
        onClick={() => setOpen(!open)}
      >
        <span className="latin-panel__arrow">
          {"\u25B6"}
        </span>
        <span className="latin-panel__label sp-text">
          {"󱥠󱦐󱤡󱦒\u{003A}󱦒󱥞󱦒\u{003A}󱦒󱦑"}
        </span>
      </button>
      {open && latin && (
        <div className="latin-panel__text">
          {latin}
        </div>
      )}
    </div>
  );
}
