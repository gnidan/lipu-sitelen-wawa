import React from "react";
import {
  SP,
} from "../../components/SitelenPona";
import {
  wordToCodepoint,
  codepointToChar,
  applyVariation,
} from "../../data";

function glyphChar(word: string): string {
  const cp = wordToCodepoint[word];
  if (cp === undefined) return "";
  return codepointToChar(cp);
}

function glyphVar(
  word: string,
  index: number
): string {
  const cp = wordToCodepoint[word];
  if (cp === undefined) return "";
  const base = codepointToChar(cp);
  return applyVariation(base, index);
}


export function HelpPanel() {
  return (
    <div className="help-panel">
      <div className="help-panel__section">
        <div className="help-grid">
          {/* Input */}
          <div className="help-grid__cell">
            <span className="help-grid__before">
              <kbd>t</kbd><kbd>o</kbd><kbd>k</kbd><kbd>i</kbd>
              <kbd>{"\u23B5"}</kbd>
            </span>
            <span className="help-grid__arrow">
              {"\u2192"}
            </span>
            <span className="help-grid__after">
              <SP>toki</SP>
            </span>
          </div>
          <div className="help-grid__cell">
            <span className="help-grid__before">
              <kbd>t</kbd><kbd>o</kbd><kbd>k</kbd><kbd>i</kbd>
              <kbd>Esc</kbd>
            </span>
            <span className="help-grid__arrow">
              {"\u2192"}
            </span>
            <span className="help-grid__after">
              <span className={
                "help-grid__latin "
                + "help-grid__latin--muted"
              }>
                toki
              </span>
            </span>
          </div>
          <div className="help-grid__cell">
            <span className="help-grid__before">
              <kbd>`</kbd>
            </span>
            <span className="help-grid__arrow">
              {"\u2192"}
            </span>
            <span className="help-grid__after">
              <SP>sitelen+pona ala</SP>
            </span>
          </div>
          {/* Structure */}
          <div className="help-grid__cell">
            <span className="help-grid__before">
              <kbd>[</kbd>
              <SP>jan pona</SP>
              <kbd>]</kbd>
            </span>
            <span className="help-grid__arrow">
              {"\u2192"}
            </span>
            <span className="help-grid__after">
              <SP>[jan=pona]</SP>
            </span>
          </div>
          <div className="help-grid__cell">
            <span className="help-grid__before">
              <SP>tawa</SP>
              <kbd>(</kbd>
              <SP>pona</SP>
              <kbd>)</kbd>
            </span>
            <span className="help-grid__arrow">
              {"\u2192"}
            </span>
            <span className="help-grid__after">
              <SP>tawa(pona)</SP>
            </span>
          </div>
          <div className="help-grid__cell">
            <span className="help-grid__before">
              <span className="help-grid__glyph">
                {glyphChar("jaki")}
              </span>
              <kbd>1</kbd>
              <span className="keycap-range">
                {"\u2026"}
              </span>
              <kbd>8</kbd>
            </span>
            <span className="help-grid__arrow">
              {"\u2192"}
            </span>
            <span className="help-grid__after">
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className="help-grid__glyph"
                >
                  {glyphVar("jaki", n)}
                </span>
              ))}
            </span>
          </div>
          {/* Modifiers */}
          <div className="help-grid__cell">
            <span className="help-grid__before">
              <SP>toki</SP>
              <kbd>-</kbd>
              <SP>pona</SP>
            </span>
            <span className="help-grid__arrow">
              {"\u2192"}
            </span>
            <span className="help-grid__after">
              <SP>toki-pona</SP>
            </span>
          </div>
          <div className="help-grid__cell">
            <span className="help-grid__before">
              <SP>toki</SP>
              <kbd>+</kbd>
              <SP>pona</SP>
            </span>
            <span className="help-grid__arrow">
              {"\u2192"}
            </span>
            <span className="help-grid__after">
              <SP>toki+pona</SP>
            </span>
          </div>
          <div className="help-grid__cell">
            <span className="help-grid__before">
              <span className="help-grid__glyph">
                {glyphChar("ni")}
              </span>
              <kbd>{"^<"}</kbd>
            </span>
            <span className="help-grid__arrow">
              {"\u2192"}
            </span>
            <span className="help-grid__after">
              {["ni^<"].map((v) => (
                <SP key={v}>{v}</SP>
              ))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
