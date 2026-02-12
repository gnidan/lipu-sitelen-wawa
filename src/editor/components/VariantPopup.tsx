import React, {
  useEffect,
  useState,
  useCallback,
} from "react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
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
 * Given a text string and an offset within it (in
 * UTF-16 code units), find the UCSUR character at
 * that offset. Returns the codepoint and the range
 * [charStart, charEnd) covering the base char and
 * any following variation selector, or null.
 */
function findUcsurCharAt(
  text: string,
  offset: number
): {
  cp: number;
  charStart: number;
  charEnd: number;
} | null {
  // Walk through the text by codepoints to find
  // which character spans the given offset.
  let idx = 0;
  while (idx < text.length) {
    const cp = text.codePointAt(idx)!;
    const len = cp > 0xFFFF ? 2 : 1;

    if (idx <= offset && offset < idx + len) {
      // The offset falls within this character.
      if (
        isUcsurChar(String.fromCodePoint(cp))
      ) {
        // Check for a trailing variation selector
        let end = idx + len;
        if (end < text.length) {
          const nextCp =
            text.codePointAt(end)!;
          if (isVariationSelector(nextCp)) {
            end += 1; // VS is BMP, 1 code unit
          }
        }
        return { cp, charStart: idx, charEnd: end };
      }

      // If we clicked on a variation selector,
      // look back for the preceding UCSUR char.
      if (isVariationSelector(cp) && idx > 0) {
        // Walk back to find the preceding char
        // UCSUR chars are 2 code units (surrogates)
        const prevStart = idx >= 2 ? idx - 2 : 0;
        const prevCp =
          text.codePointAt(prevStart);
        if (
          prevCp !== undefined &&
          prevCp > 0xFFFF &&
          isUcsurChar(
            String.fromCodePoint(prevCp)
          )
        ) {
          return {
            cp: prevCp,
            charStart: prevStart,
            charEnd: idx + 1, // include the VS
          };
        }
      }

      return null;
    }

    idx += len;
  }

  return null;
}

/**
 * ProseMirror plugin that detects clicks on UCSUR
 * chars and stores state for the variant popup.
 */
export function createVariantPopupPlugin() {
  return new Plugin<VariantPopupState | null>({
    key: variantPopupPluginKey,

    state: {
      init() {
        return null;
      },
      apply(tr, prev) {
        const meta = tr.getMeta(
          variantPopupPluginKey
        );
        if (meta !== undefined) return meta;
        if (tr.docChanged) return null;
        return prev;
      },
    },

    props: {
      handleClick(view, pos) {
        const $pos = view.state.doc.resolve(pos);
        const parent = $pos.parent;
        if (!parent.isTextblock) {
          view.dispatch(
            view.state.tr.setMeta(
              variantPopupPluginKey,
              null
            )
          );
          return false;
        }

        const text = parent.textContent;
        const textOffset = pos - $pos.start();

        if (
          textOffset < 0 ||
          textOffset >= text.length
        ) {
          view.dispatch(
            view.state.tr.setMeta(
              variantPopupPluginKey,
              null
            )
          );
          return false;
        }

        const found = findUcsurCharAt(
          text,
          textOffset
        );

        if (!found) {
          view.dispatch(
            view.state.tr.setMeta(
              variantPopupPluginKey,
              null
            )
          );
          return false;
        }

        const word = codepointToWord[found.cp];
        if (!word || !hasVariations(word)) {
          view.dispatch(
            view.state.tr.setMeta(
              variantPopupPluginKey,
              null
            )
          );
          return false;
        }

        // Convert text-relative offsets to
        // document positions
        const start = $pos.start();
        const from = start + found.charStart;
        const to = start + found.charEnd;

        let coords: {
          left: number;
          top: number;
        } | null = null;
        try {
          const c = view.coordsAtPos(from);
          coords = {
            left: c.left,
            top: c.bottom,
          };
        } catch {
          // coordsAtPos can throw
        }

        view.dispatch(
          view.state.tr.setMeta(
            variantPopupPluginKey,
            { word, from, to, coords }
          )
        );
        return false;
      },

      handleKeyDown(view, event) {
        if (event.key === "Escape") {
          const st =
            variantPopupPluginKey.getState(
              view.state
            );
          if (st) {
            view.dispatch(
              view.state.tr.setMeta(
                variantPopupPluginKey,
                null
              )
            );
            return true;
          }
        }
        return false;
      },
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
