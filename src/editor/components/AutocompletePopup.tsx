import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import type { Editor } from "@tiptap/react";
import {
  autocompletePluginKey,
} from "../extensions/autocomplete";
import type {
  AutocompleteState,
} from "../extensions/autocomplete";
import {
  wordToCodepoint,
  codepointToChar,
  hasVariations,
  getVariations,
  applyVariation,
} from "../../data";

interface AutocompletePopupProps {
  editor: Editor;
}

function glyphChar(word: string): string {
  const cp = wordToCodepoint[word];
  if (cp === undefined) return "";
  return codepointToChar(cp);
}

function glyphCharWithVariation(
  word: string,
  variation: number
): string {
  const cp = wordToCodepoint[word];
  if (cp === undefined) return "";
  const base = codepointToChar(cp);
  return applyVariation(base, variation);
}

export function AutocompletePopup({
  editor,
}: AutocompletePopupProps) {
  const [state, setState] =
    useState<AutocompleteState | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const pluginState =
        autocompletePluginKey.getState(
          editor.state
        ) as AutocompleteState | undefined;

      if (
        !pluginState ||
        pluginState.matches.length === 0
      ) {
        setState(null);
      } else {
        setState({ ...pluginState });
      }
    };

    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  const handleItemClick = useCallback(
    (word: string) => {
      if (!state?.range) return;
      const { from, to } = state.range;
      const cp = wordToCodepoint[word];
      if (cp === undefined) return;
      const text = codepointToChar(cp);
      const tr = editor.state.tr.insertText(
        text, from, to
      );
      editor.view.dispatch(tr);
      editor.commands.focus();
    },
    [editor, state]
  );

  const handleItemClickWithVariation = useCallback(
    (word: string, variation: number | null) => {
      if (!state?.range) return;
      const { from, to } = state.range;
      const cp = wordToCodepoint[word];
      if (cp === undefined) return;
      let text = codepointToChar(cp);
      if (variation != null && variation > 0) {
        text = applyVariation(text, variation);
      }
      const tr = editor.state.tr.insertText(
        text, from, to
      );
      editor.view.dispatch(tr);
      editor.commands.focus();
    },
    [editor, state]
  );

  // Scroll active item into view
  useEffect(() => {
    if (!state || !listRef.current) return;
    const active = listRef.current.querySelector(
      ".autocomplete-item--active"
    );
    if (active) {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [state?.activeIndex]);

  if (!state || state.matches.length === 0) {
    return null;
  }

  const style: React.CSSProperties = state.coords
    ? {
        left: `${state.coords.left}px`,
        top: `${state.coords.top + 4}px`,
        position: "fixed",
      }
    : { display: "none" };

  const activeWord =
    state.matches[state.activeIndex]?.word;
  const activeHasVariants =
    activeWord ? hasVariations(activeWord) : false;
  const activeVariations =
    activeWord ? getVariations(activeWord) : [];

  const hasExactMatch =
    state.matches.length > 0 &&
    state.matches[0].word === state.prefix;

  return (
    <div
      className="autocomplete-popup"
      style={style}
      ref={listRef}
    >
      {state.matches.map((entry, i) => (
        <div
          key={entry.word}
          className={
            "autocomplete-item" +
            (i === state.activeIndex
              ? " autocomplete-item--active"
              : "")
          }
          onMouseDown={(e) => {
            e.preventDefault();
            handleItemClick(entry.word);
          }}
        >
          <span className="autocomplete-item__glyph">
            {glyphChar(entry.word)}
          </span>
          <span className="autocomplete-item__info">
            <span className="autocomplete-item__word">
              {entry.word}
            </span>
            <span className="autocomplete-item__def">
              {entry.definition}
            </span>
          </span>
          {i === state.activeIndex && (
            <span className="autocomplete-item__hint">
              {activeHasVariants
                ? "\u2423 or 1\u20138"
                : "\u2423"}
            </span>
          )}
        </div>
      ))}
      {activeHasVariants &&
        activeVariations.length > 0 && (
          <div className="autocomplete-variants">
            {activeVariations.map((v) => (
              <button
                key={v.index}
                type="button"
                className="autocomplete-variant-btn"
                title={v.description}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleItemClickWithVariation(
                    activeWord!,
                    v.index
                  );
                }}
              >
                <span
                  className={
                    "autocomplete-variant-glyph"
                  }
                >
                  {glyphCharWithVariation(
                    activeWord!,
                    v.index
                  )}
                </span>
                <span
                  className="autocomplete-variant-key"
                >
                  {v.index}
                </span>
              </button>
            ))}
          </div>
        )}
      {hasExactMatch && (
        <div className="autocomplete-structural-hint">
          +scale &middot; -stack &middot; [cart]
          &middot; (long)
        </div>
      )}
    </div>
  );
}
