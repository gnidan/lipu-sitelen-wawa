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
  niDirectionByVerbatim,
  niZwjString,
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

interface CompassCell {
  key: string;
  arrow: string;
  verbatim: string;
  enabled: boolean;
  buffered: boolean;
  gridArea: string;
}

const COMPASS_POSITIONS: {
  key: string;
  gridArea: string;
}[] = [
  { key: "^", gridArea: "up" },
  { key: "<", gridArea: "left" },
  { key: ">", gridArea: "right" },
  { key: "v", gridArea: "down" },
];

function compassCells(
  buf: string
): CompassCell[] {
  return COMPASS_POSITIONS.map(
    ({ key, gridArea }) => {
      const full = buf + key;
      const dir = niDirectionByVerbatim(full);
      if (dir) {
        return {
          key,
          arrow: dir.arrow,
          verbatim: full,
          enabled: true,
          buffered: false,
          gridArea,
        };
      }
      const isBuf = buf === key;
      const bufDir = isBuf
        ? niDirectionByVerbatim(buf)
        : undefined;
      return {
        key,
        arrow: bufDir ? bufDir.arrow : "",
        verbatim: "",
        enabled: false,
        buffered: isBuf,
        gridArea,
      };
    }
  );
}

function niPreviewChar(buf: string): string {
  const cp = wordToCodepoint["ni"];
  if (cp === undefined) return "";
  if (!buf) return codepointToChar(cp);
  const dir = niDirectionByVerbatim(buf);
  if (!dir) return codepointToChar(cp);
  return niZwjString(cp, dir);
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

  const handleCompassClick = useCallback(
    (verbatim: string) => {
      if (!state?.range) return;
      const { from, to } = state.range;
      const cp = wordToCodepoint["ni"];
      if (cp === undefined) return;
      const dir = niDirectionByVerbatim(verbatim);
      if (!dir) return;
      const text = niZwjString(cp, dir);
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

  const niDirBuf = state.niDirBuf ?? null;
  const isNiActive = activeWord === "ni";
  const cells = isNiActive
    ? compassCells(
        niDirBuf !== null ? niDirBuf : ""
      )
    : [];
  const niPreview = isNiActive
    ? niPreviewChar(
        niDirBuf !== null ? niDirBuf : ""
      )
    : "";

  return (
    <div
      className="autocomplete-popup"
      style={style}
      ref={listRef}
    >
      {state.matches.map((entry, i) => {
        if (
          isNiActive &&
          niDirBuf !== null &&
          entry.word !== "ni"
        ) {
          return null;
        }
        return (
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
          <span className={
            "autocomplete-item__glyph"
            + (hasVariations(entry.word)
              ? entry.word === "ni"
                ? " autocomplete-item"
                  + "__glyph--ni-variants"
                : " autocomplete-item"
                  + "__glyph--has-variants"
              : "")
          }>
            {entry.word === "ni" &&
            niDirBuf !== null &&
            niDirBuf.length > 0
              ? niPreview
              : glyphChar(entry.word)}
          </span>
          <span className="autocomplete-item__info">
            <span className="autocomplete-item__word">
              {entry.word}
            </span>{" "}
            <span className="autocomplete-item__def">
              {entry.definition}
            </span>
          </span>
          {i === state.activeIndex && (
            <span
              className={
                "autocomplete-item__hint"
              }
            >
              {activeWord === "ni"
                ? niDirBuf !== null
                  ? (
                    <>
                      <kbd className="keycap">
                        {"\u2423"}
                      </kbd>
                      <kbd className="keycap">
                        {"\u21B5"}
                      </kbd>
                    </>
                  )
                  : (
                    <>
                      <kbd className="keycap">
                        {"\u2423"}
                      </kbd>
                      <kbd className="keycap">
                        &
                      </kbd>
                    </>
                  )
                : activeHasVariants
                  ? (
                    <>
                      <kbd className="keycap">
                        {"\u2423"}
                      </kbd>
                      <kbd className="keycap">
                        1
                      </kbd>
                      <span
                        className="keycap-range"
                      >
                        {"\u2026"}
                      </span>
                      <kbd className="keycap">
                        8
                      </kbd>
                    </>
                  )
                  : (
                    <kbd className="keycap">
                      {"\u2423"}
                    </kbd>
                  )}
            </span>
          )}
        </div>
        );
      })}
      {isNiActive && niDirBuf !== null ? (
        <div className="autocomplete-compass">
          {cells.map((cell) => (
            <div
              key={cell.key}
              className={[
                "compass-key",
                cell.enabled &&
                  "compass-key--enabled",
                cell.buffered &&
                  "compass-key--buffered",
                !cell.enabled &&
                  !cell.buffered &&
                  "compass-key--disabled",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                gridArea: cell.gridArea,
              }}
              onMouseDown={(e) => {
                if (!cell.enabled) return;
                e.preventDefault();
                handleCompassClick(
                  cell.verbatim
                );
              }}
            >
              <span className="compass-arrow">
                {cell.arrow || cell.key}
              </span>
              <span className="compass-keylabel">
                {cell.key}
              </span>
            </div>
          ))}
          <div
            className="compass-center"
            style={{ gridArea: "center" }}
          >
            <span className="compass-glyph">
              {niPreview}
            </span>
          </div>
        </div>
      ) : isNiActive ? (
        <div className="autocomplete-ni-hint">
          <span className="autocomplete-ni-arrows">
            {"←↑→↓↖↗↘↙"}
          </span>
          <span className="autocomplete-ni-key">
            {"&"}
          </span>
        </div>
      ) : (
        activeHasVariants &&
        activeVariations.length > 0 && (
          <div className="autocomplete-variants">
            {activeVariations.map((v) => (
              <button
                key={v.index}
                type="button"
                className={
                  "autocomplete-variant-btn"
                }
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
                  className={
                    "autocomplete-variant-key"
                  }
                >
                  {v.index}
                </span>
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}
