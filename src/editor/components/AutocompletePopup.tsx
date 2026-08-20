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
import { focusTracker } from "../focus-tracker";
import type {
  AutocompleteState,
} from "../extensions/autocomplete";
import {
  SP
} from "../../components/SitelenPona";
import {
  wordToCodepoint,
  codepointToChar,
  hasVariations,
  getVariations,
  applyVariation,
  niDirectionByVerbatim,
  niDirStringEffective,
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
  return niDirStringEffective(dir);
}

export function AutocompletePopup({
  editor,
}: AutocompletePopupProps) {
  const [state, setState] =
    useState<AutocompleteState | null>(null);
  const [coords, setCoords] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Gated on the PEER holding
  // focus, never on "the SP editor is unfocused".
  // A click into this popup blurs the SP editor to
  // NULL, and that path must keep today's behavior;
  // what must never happen is an SP suggestion list
  // sprouting while the writer types Latin one pane
  // over. The gate is the POPUP only — the
  // composing-text decoration in autocomplete.ts is
  // the global ligature suppressor and stays
  // ungated (it serves NameInput too).
  const [peerFocused, setPeerFocused] =
    useState(
      () => focusTracker.focused() === "latin"
    );
  useEffect(
    () =>
      focusTracker.subscribe(() =>
        setPeerFocused(
          focusTracker.focused() === "latin"
        )
      ),
    []
  );

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
        setCoords(null);
      } else {
        setState({ ...pluginState });
        if (pluginState.range) {
          try {
            const c =
              editor.view.coordsAtPos(
                pluginState.range.from
              );
            setCoords({
              left: c.left,
              top: c.bottom,
            });
          } catch {
            setCoords(null);
          }
        } else {
          setCoords(null);
        }
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
      const text = niDirStringEffective(dir);
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

  // Lock popup width so it doesn't jitter as
  // the active item changes. Reset when the
  // match list changes (new prefix typed).
  const lockedWidth = useRef(0);
  const matchKey = state?.matches
    .map((m) => m.word).join(",") ?? "";

  useEffect(() => {
    lockedWidth.current = 0;
  }, [matchKey]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current;
    // Temporarily clear min-width to measure
    // natural width
    el.style.minWidth = "";
    const w = el.offsetWidth;
    if (w > lockedWidth.current) {
      lockedWidth.current = w;
    }
    el.style.minWidth =
      lockedWidth.current + "px";
  }, [state?.activeIndex, matchKey]);

  if (!state || state.matches.length === 0) {
    return null;
  }
  // ...and only for the SP pane's own popup:
  // NameInput shares this component but is not a
  // pane, so the peer holding focus says nothing
  // about it (and a stale "latin" would otherwise
  // suppress its suggestions outright). The claim
  // is read at RENDER, so it needs no subscription
  // of its own — it is established once, at the SP
  // editor's mount.
  if (
    peerFocused &&
    focusTracker.isSpView(editor.view)
  ) {
    return null;
  }

  const style: React.CSSProperties = coords
    ? {
        left: `${coords.left}px`,
        top: `${coords.top + 4}px`,
        position: "fixed",
      }
    : { display: "none" };

  const activeWord =
    state.matches[state.activeIndex]?.word;
  const activeHasVariants =
    activeWord ? hasVariations(activeWord) : false;
  const activeVariations =
    activeWord ? getVariations(activeWord) : [];

  const isNiActive = activeWord === "ni";
  const niDirBuf = state.niDirBuffer;
  const showCompass =
    isNiActive && niDirBuf.length > 0;
  const cells = showCompass
    ? compassCells(niDirBuf)
    : [];
  const niPreview = showCompass
    ? niPreviewChar(niDirBuf)
    : "";

  return (
    <div
      className="autocomplete-popup"
      style={style}
      ref={listRef}
    >
      {state.matches.map((entry, i) => {
        if (
          showCompass &&
          entry.word !== "ni"
        ) {
          return null;
        }
        const isActive =
          i === state.activeIndex;
        return (
        <React.Fragment key={entry.word}>
        <div
          className={
            "autocomplete-item" +
            (isActive
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
              ? " autocomplete-item"
                + "__glyph--has-variants"
              : "")
          }>
            {entry.word === "ni" &&
            showCompass
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
          {isActive && (
            <span
              className={
                "autocomplete-item__hint"
              }
            >
              <kbd>
                {"\u23B5"}
              </kbd>
              <kbd>
                {"\u21B5"}
              </kbd>
            </span>
          )}
        </div>
        {isActive && (
          showCompass ? (
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
                  <span
                    className="compass-arrow"
                  >
                    {cell.arrow || cell.key}
                  </span>
                  <span
                    className={
                      "compass-keylabel"
                    }
                  >
                    {cell.key}
                  </span>
                </div>
              ))}
              <div
                className="compass-center"
                style={{
                  gridArea: "center",
                }}
              >
                <span
                  className="compass-glyph"
                >
                  {niPreview}
                </span>
              </div>
            </div>
          ) : isNiActive ? (
            <div
              className="autocomplete-ni-hint"
            >
              <div
                className={
                  "ni-hint-compass"
                }
              >
                <kbd
                  className={
                    "ni-hint-compass__key"
                  }
                  style={{
                    gridArea: "up",
                  }}
                >
                  {"^"}
                </kbd>
                <kbd
                  className={
                    "ni-hint-compass__key"
                  }
                  style={{
                    gridArea: "left",
                  }}
                >
                  {"<"}
                </kbd>
                <span
                  className={
                    "ni-hint-compass__label"
                  }
                  style={{
                    gridArea: "center",
                  }}
                >
                  <SP>nasin seme</SP>
                </span>
                <kbd
                  className={
                    "ni-hint-compass__key"
                  }
                  style={{
                    gridArea: "right",
                  }}
                >
                  {">"}
                </kbd>
              </div>
            </div>
          ) : (
            activeHasVariants &&
            activeVariations.length > 0 && (
              <div
                className={
                  "autocomplete-variants"
                }
              >
                {activeVariations.map((v) => (
                  <button
                    key={v.index}
                    type="button"
                    className={
                      "autocomplete-variant"
                      + "-btn"
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
                        "autocomplete-variant"
                        + "-glyph"
                      }
                    >
                      {glyphCharWithVariation(
                        activeWord!,
                        v.index
                      )}
                    </span>
                    <kbd>
                      {v.index}
                    </kbd>
                  </button>
                ))}
              </div>
            )
          )
        )}
        </React.Fragment>
        );
      })}
    </div>
  );
}
