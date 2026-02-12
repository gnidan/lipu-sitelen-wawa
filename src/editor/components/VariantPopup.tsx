import React, {
  useEffect,
  useState,
  useCallback,
} from "react";
import type { Editor } from "@tiptap/react";
import {
  Plugin,
  PluginKey,
  type EditorState,
} from "@tiptap/pm/state";
import {
  wordToCodepoint,
  codepointToChar,
  codepointToWord,
  isUcsurChar,
  hasVariations,
  getVariations,
  applyVariation,
} from "../../data";
import {
  isVariationSelector,
} from "../../data/structural-map";
import {
  VARIATION_SELECTOR_BASE,
} from "../../data/variations";

export const variantPopupPluginKey = new PluginKey(
  "variantPopup"
);

interface VariantPopupState {
  word: string;
  from: number;
  to: number;
  coords: { left: number; top: number } | null;
}

/**
 * Check if the current selection spans exactly one
 * UCSUR glyph (optionally with a variation selector).
 * Returns popup state if so, null otherwise.
 */
function checkSelection(
  state: EditorState
): VariantPopupState | null {
  const { from, to } = state.selection;
  if (from === to) return null; // collapsed

  const $from = state.doc.resolve(from);
  const parent = $from.parent;
  if (!parent.isTextblock) return null;

  // Get the selected text
  const text = state.doc.textBetween(from, to);
  if (text.length === 0) return null;

  // Walk the selected text to find exactly one
  // UCSUR char (+ optional variation selector)
  let idx = 0;
  const cp = text.codePointAt(idx);
  if (cp === undefined) return null;

  const charLen = cp > 0xffff ? 2 : 1;
  if (!isUcsurChar(String.fromCodePoint(cp))) {
    return null;
  }

  let end = charLen;
  // Check for trailing variation selector
  if (end < text.length) {
    const nextCp = text.codePointAt(end);
    if (
      nextCp !== undefined &&
      isVariationSelector(nextCp)
    ) {
      end += 1; // VS is BMP
    }
  }

  // Must cover the entire selection
  if (end !== text.length) return null;

  const word = codepointToWord[cp];
  if (!word || !hasVariations(word)) return null;

  return { word, from, to, coords: null };
}

/**
 * ProseMirror plugin that detects when a single
 * UCSUR glyph is selected and shows a variant popup.
 */
export function createVariantPopupPlugin() {
  return new Plugin<VariantPopupState | null>({
    key: variantPopupPluginKey,

    state: {
      init() {
        return null;
      },
      apply(tr, prev, _oldState, newState) {
        // Explicit meta override (e.g. dismiss)
        const meta = tr.getMeta(
          variantPopupPluginKey
        );
        if (meta !== undefined) return meta;

        // On doc change, clear — selection will
        // be re-evaluated on the next transaction
        if (tr.docChanged) return null;

        // Check selection
        return checkSelection(newState);
      },
    },

    props: {
      handleKeyDown(view, event) {
        const st =
          variantPopupPluginKey.getState(
            view.state
          ) as VariantPopupState | null;

        if (!st) return false;

        // Escape: dismiss popup
        if (event.key === "Escape") {
          view.dispatch(
            view.state.tr.setMeta(
              variantPopupPluginKey,
              null
            )
          );
          return true;
        }

        // Digit keys: apply variation
        const digit = parseInt(event.key, 10);
        if (!isNaN(digit)) {
          const variations = getVariations(
            st.word
          );
          // 0 = default, 1-N = variation index
          if (
            digit !== 0 &&
            !variations.some(
              (v) => v.index === digit
            )
          ) {
            return false;
          }

          const cp = wordToCodepoint[st.word];
          if (cp === undefined) return false;

          let newText = codepointToChar(cp);
          if (digit > 0) {
            newText += String.fromCodePoint(
              VARIATION_SELECTOR_BASE +
                (digit - 1)
            );
          }

          const tr = view.state.tr.insertText(
            newText,
            st.from,
            st.to
          );
          tr.setMeta(
            variantPopupPluginKey,
            null
          );
          view.dispatch(tr);
          return true;
        }

        return false;
      },
    },

    view() {
      return {
        update(view) {
          const st =
            variantPopupPluginKey.getState(
              view.state
            ) as VariantPopupState | null;
          if (!st) return;

          try {
            const c = view.coordsAtPos(st.from);
            st.coords = {
              left: c.left,
              top: c.bottom,
            };
          } catch {
            // coordsAtPos can throw
          }
        },
      };
    },
  });
}

interface VariantPopupProps {
  editor: Editor;
}

function glyphChar(
  word: string,
  variation?: number
): string {
  const cp = wordToCodepoint[word];
  if (cp === undefined) return "";
  const base = codepointToChar(cp);
  if (variation && variation > 0) {
    return applyVariation(base, variation);
  }
  return base;
}

export function VariantPopup({
  editor,
}: VariantPopupProps) {
  const [popupState, setPopupState] =
    useState<VariantPopupState | null>(null);

  useEffect(() => {
    const update = () => {
      const st = variantPopupPluginKey.getState(
        editor.state
      ) as VariantPopupState | null;
      setPopupState(st ?? null);
    };

    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  const handleSelect = useCallback(
    (variation: number) => {
      if (!popupState) return;
      const { word, from, to } = popupState;

      const cp = wordToCodepoint[word];
      if (cp === undefined) return;

      let newText = codepointToChar(cp);
      if (variation > 0) {
        newText += String.fromCodePoint(
          VARIATION_SELECTOR_BASE +
            (variation - 1)
        );
      }

      const tr = editor.state.tr.insertText(
        newText,
        from,
        to
      );
      // Clear popup state
      tr.setMeta(variantPopupPluginKey, null);
      editor.view.dispatch(tr);
    },
    [editor, popupState]
  );

  if (!popupState || !popupState.coords) {
    return null;
  }

  const variations = getVariations(
    popupState.word
  );

  const style: React.CSSProperties = {
    left: `${popupState.coords.left}px`,
    top: `${popupState.coords.top + 4}px`,
    position: "fixed",
    zIndex: 100,
  };

  return (
    <div className="variant-popup" style={style}>
      <div className="variant-grid">
        <button
          className="variant-option"
          onClick={() => handleSelect(0)}
          title="Default"
          type="button"
        >
          <span className="variant-popup__glyph">
            {glyphChar(popupState.word)}
          </span>
          <span className="variant-label">
            0
          </span>
        </button>
        {variations.map((v) => (
          <button
            key={v.index}
            className="variant-option"
            onClick={() => handleSelect(v.index)}
            title={v.description}
            type="button"
          >
            <span
              className="variant-popup__glyph"
            >
              {glyphChar(
                popupState.word,
                v.index
              )}
            </span>
            <span className="variant-label">
              {v.index}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
