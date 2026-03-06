import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
} from "react";
import type { DocEntry } from "./documents";
import {
  SP,
} from "../components/SitelenPona";
import {
  DocumentListItem,
} from "./DocumentListItem";

interface DocumentPanelProps {
  index: DocEntry[];
  activeId: string;
  onSwitch: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  newDocId: string | null;
}

interface ScrollInfo {
  canScroll: boolean;
  atTop: boolean;
  atBottom: boolean;
  fraction: number;
}

function getScrollInfo(
  el: HTMLElement
): ScrollInfo {
  const overflow =
    el.scrollHeight - el.clientHeight;
  if (overflow <= 2) {
    return {
      canScroll: false,
      atTop: true,
      atBottom: true,
      fraction: 0,
    };
  }
  return {
    canScroll: true,
    atTop: el.scrollTop <= 0,
    atBottom: el.scrollTop >= overflow - 1,
    fraction: el.scrollTop / overflow,
  };
}

export function DocumentPanel({
  index,
  activeId,
  onSwitch,
  onRename,
  onDelete,
  onCreate,
  newDocId,
}: DocumentPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] =
    useState<ScrollInfo>({
      canScroll: false,
      atTop: true,
      atBottom: true,
      fraction: 0,
    });

  const updateScroll = useCallback(() => {
    if (listRef.current) {
      setScroll(getScrollInfo(listRef.current));
    }
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    updateScroll();
    el.addEventListener("scroll", updateScroll);
    const ro = new ResizeObserver(updateScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener(
        "scroll", updateScroll
      );
      ro.disconnect();
    };
  }, [updateScroll]);

  // Update when index changes
  useEffect(updateScroll, [
    index.length, updateScroll,
  ]);

  const listClasses =
    "document-panel__list-wrap"
    + (scroll.canScroll && !scroll.atTop
      ? " document-panel__list-wrap--fade-top"
      : "")
    + (scroll.canScroll && !scroll.atBottom
      ? " document-panel__list-wrap--fade-bottom"
      : "");

  return (
    <div className="document-panel">
      <div className={listClasses}>
        <div
          className="document-panel__list"
          ref={listRef}
        >
          {index.map((entry) => (
            <DocumentListItem
              key={entry.id}
              entry={entry}
              isActive={entry.id === activeId}
              onSwitch={() =>
                onSwitch(entry.id)
              }
              onRename={(name) =>
                onRename(entry.id, name)
              }
              onDelete={() =>
                onDelete(entry.id)
              }
              autoFocusName={
                entry.id === newDocId
              }
            />
          ))}
        </div>
      </div>
      {scroll.canScroll && (
        <div className="document-panel__scroll">
          <div className="scroll-track">
            <div
              className="scroll-dot"
              style={{
                top: `${scroll.fraction * 100}%`,
              }}
            />
          </div>
        </div>
      )}
      <div className="document-panel__actions">
        <button
          type="button"
          className="tab-toggle"
          onClick={onCreate}
          onMouseDown={(e) =>
            e.preventDefault()}
        >
          <SP>sin</SP>
        </button>
      </div>
    </div>
  );
}
