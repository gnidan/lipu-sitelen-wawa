import React from "react";

const shortcuts = [
  { key: "Space", desc: "Commit word as glyph" },
  { key: "1–8", desc: "Choose glyph variant" },
  { key: "0", desc: "Reset to default variant" },
  { key: "+", desc: "Scale glyph (combine)" },
  { key: "-", desc: "Stack glyphs vertically" },
  { key: "[ ]", desc: "Cartouche (proper name)" },
  { key: "( )", desc: "Long glyph" },
  {
    key: "click glyph",
    desc: "Open variant picker",
  },
];

export function HelpPanel() {
  return (
    <details className="help-panel">
      <summary>keyboard reference</summary>
      <div className="help-panel__list">
        {shortcuts.map(({ key, desc }) => (
          <React.Fragment key={key}>
            <span className="help-panel__key">
              {key}
            </span>
            <span className="help-panel__desc">
              {desc}
            </span>
          </React.Fragment>
        ))}
      </div>
    </details>
  );
}
