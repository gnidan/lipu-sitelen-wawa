import React, {
  useState,
  useCallback,
  useEffect,
} from "react";
import { FaGithub } from "react-icons/fa";
import { Editor } from "../editor";
import {
  SP,
} from "../components/SitelenPona";
import {
  HelpButton,
} from "../editor/components/HelpButton";
import {
  HelpPanel,
} from "../editor/components/HelpPanel";
import {
  IndicatorTooltip,
} from "./IndicatorTooltip";
import { useDocuments } from "./useDocuments";
import {
  DocumentPanel,
} from "./DocumentPanel";
import "../styles/global.css";

const DEFAULT_FONT_SIZE = 3.5;
const FONT_SIZE_STEP = 0.5;
const MIN_FONT_SIZE = 1;
const MAX_FONT_SIZE = 6;
const FONT_SIZE_KEY =
  "lipu-sitelen-wawa:font-size";
const INDICATORS_KEY =
  "lipu-sitelen-wawa:indicators";

function loadFontSize(): number {
  try {
    const raw = localStorage.getItem(FONT_SIZE_KEY);
    if (raw) {
      const n = Number(raw);
      if (n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE) {
        return n;
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_FONT_SIZE;
}

type Panel = "lipu-ale" | "sona" | null;

export function App() {
  const [activePanel, setActivePanel] =
    useState<Panel>(null);
  const [controlsOpen, setControlsOpen] =
    useState(false);
  const [newDocId, setNewDocId] =
    useState<string | null>(null);
  const docs = useDocuments();
  const [fontSize, setFontSize] =
    useState(loadFontSize);
  const [tooltipDismissed, setTooltipDismissed] =
    useState(false);
  const [tooltipNoDelay, setTooltipNoDelay] =
    useState(false);
  const [indicators, setIndicators] =
    useState(() => {
      try {
        return localStorage.getItem(
          INDICATORS_KEY) !== "off";
      } catch {
        return true;
      }
    });

  useEffect(() => {
    try {
      if (fontSize === DEFAULT_FONT_SIZE) {
        localStorage.removeItem(FONT_SIZE_KEY);
      } else {
        localStorage.setItem(
          FONT_SIZE_KEY, String(fontSize)
        );
      }
    } catch {
      // ignore
    }
  }, [fontSize]);

  useEffect(() => {
    try {
      if (indicators) {
        localStorage.removeItem(INDICATORS_KEY);
      } else {
        localStorage.setItem(
          INDICATORS_KEY, "off"
        );
      }
    } catch {
      // ignore
    }
  }, [indicators]);
  const togglePanel = useCallback(
    (panel: Panel) => {
      setActivePanel(
        (prev) => prev === panel ? null : panel
      );
    },
    []
  );

  const toggleHelp = useCallback(
    () => togglePanel("sona"),
    [togglePanel]
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "?") return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active.closest(".ProseMirror")
      ) {
        return;
      }
      toggleHelp();
    }
    document.addEventListener(
      "keydown", onKeyDown
    );
    return () => {
      document.removeEventListener(
        "keydown", onKeyDown
      );
    };
  }, [toggleHelp]);

  return (
    <div
      className={
        "app"
        + (indicators
          ? ""
          : " app--hide-indicators")
        + (controlsOpen
          ? " app--controls-open"
          : "")
        + (activePanel
          ? " app--panel-open"
          : "")
      }
      style={{
        "--editor-font-size": `${fontSize}rem`,
      } as React.CSSProperties}
    >
      <header className="app__header">
        <div className="app__title">
          <h1><SP>lipu+sitelen wawa</SP></h1>
        </div>
        <div className="app__panels">
          {activePanel === "sona" && (
            <HelpPanel />
          )}
          {activePanel === "lipu-ale" && (
            <DocumentPanel
              index={docs.index}
              activeId={docs.activeId}
              onSwitch={(id) => {
                docs.switchDocument(id);
                setNewDocId(null);
              }}
              onRename={docs.renameDocument}
              onDelete={(id) => {
                docs.deleteDocument(id);
                setNewDocId(null);
              }}
              onCreate={() => {
                const id =
                  docs.createDocument();
                setNewDocId(id);
              }}
              newDocId={newDocId}
            />
          )}
        </div>
        <p className="app__subtitle">
          <SP>o sitelen lon(ni&lt;v)</SP>
        </p>
        <div className="app__toolbar">
          <div className={
            "button-group"
            + " button-group--allow-overflow"
            + (controlsOpen
              ? ""
              : " button-group--hidden")
          }>
            <span className="button-group__label">
              <SP>lukin</SP>
            </span>
            <div
              className={
                "indicator-tooltip-anchor"
                + (tooltipDismissed
                  ? " indicator-tooltip-anchor"
                    + "--dismissed"
                  : "")
                + (tooltipNoDelay
                  ? " indicator-tooltip-anchor"
                    + "--no-delay"
                  : "")
              }
              onMouseLeave={() => {
                setTooltipDismissed(false);
                setTooltipNoDelay(false);
              }}
              onTransitionEnd={(e) => {
                if (
                  e.target === e.currentTarget
                ) {
                  setTooltipNoDelay(false);
                }
              }}
            >
              <button
                type="button"
                className={
                  "toolbar-button"
                  + (indicators
                    ? " toolbar-button--active"
                    : "")
                }
                tabIndex={
                  controlsOpen ? 0 : -1
                }
                onClick={() => {
                  setTooltipDismissed(indicators);
                  setTooltipNoDelay(!indicators);
                  setIndicators(
                    (prev) => !prev
                  );
                }}
                onMouseDown={(e) =>
                  e.preventDefault()}
              >
                <SP>nasin-nena</SP>
              </button>
              {controlsOpen && (
                <IndicatorTooltip />
              )}
            </div>
          </div>
          <div className={
            "button-group"
            + (controlsOpen
              ? ""
              : " button-group--hidden")
          }>
            <span className="button-group__label">
              <SP>sitelen</SP>
            </span>
            <button
              type="button"
              className="toolbar-button"
              tabIndex={controlsOpen ? 0 : -1}
              disabled={
                fontSize <= MIN_FONT_SIZE}
              onClick={() => setFontSize((s) =>
                Math.max(s - FONT_SIZE_STEP,
                  MIN_FONT_SIZE))}
              onMouseDown={(e) =>
                e.preventDefault()}
            >
              <SP>lili</SP>
            </button>
            <button
              type="button"
              className="toolbar-button"
              tabIndex={controlsOpen ? 0 : -1}
              disabled={
                fontSize === DEFAULT_FONT_SIZE}
              onClick={() =>
                setFontSize(DEFAULT_FONT_SIZE)}
              onMouseDown={(e) =>
                e.preventDefault()}
            >
              <SP>meso</SP>
            </button>
            <button
              type="button"
              className="toolbar-button"
              tabIndex={controlsOpen ? 0 : -1}
              disabled={
                fontSize >= MAX_FONT_SIZE}
              onClick={() => setFontSize((s) =>
                Math.min(s + FONT_SIZE_STEP,
                  MAX_FONT_SIZE))}
              onMouseDown={(e) =>
                e.preventDefault()}
            >
              <SP>suli</SP>
            </button>
          </div>
          <button
            type="button"
            className={
              "toolbar-toggle"
              + (controlsOpen
                ? " toolbar-toggle--active"
                : "")
            }
            onClick={() => setControlsOpen(
              (prev) => !prev)}
            onMouseDown={(e) =>
              e.preventDefault()}
          >
            <SP>lawa</SP>
          </button>
          <button
            type="button"
            className={
              "tab-toggle"
              + (activePanel === "lipu-ale"
                ? " tab-toggle--active"
                : "")
            }
            onClick={() =>
              togglePanel("lipu-ale")
            }
            onMouseDown={(e) =>
              e.preventDefault()}
          >
            <SP>ante+lipu</SP>
          </button>
          <HelpButton
            active={activePanel === "sona"}
            onToggle={toggleHelp}
          />
        </div>
      </header>
      <main className="app__main">
        <Editor
          key={docs.activeId}
          content={docs.activeContent}
          onSave={docs.saveContent}
        />
      </main>
      <footer className="app__footer">
        <p>
          <SP>lipu+sitelen wawa li tan jan[kepeken.=nimi.=tan:=]</SP>
        </p><p>
          <SP>nasin sitelen[</SP>
          <a href="https://github.com/ETBCOR/nasin-nanpa">
            <SP>nasin-nanpa</SP>
          </a>
          <SP>] li tan jan[ijo tan anpa nanpa]</SP>
        </p>
        <p>
          <a
            href="https://github.com/gnidan/lipu-sitelen-wawa"
            aria-label="GitHub"
            className="app__github-link"
          >
            <FaGithub size={20} />
          </a>
        </p>
      </footer>
    </div>
  );
}
