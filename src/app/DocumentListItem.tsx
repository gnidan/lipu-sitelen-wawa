import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import type { DocEntry } from "./documents";
import {
  SP,
} from "../components/SitelenPona";
import { NameInput } from "./NameInput";

interface DocumentListItemProps {
  entry: DocEntry;
  isActive: boolean;
  onSwitch: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  autoFocusName?: boolean;
}

export function DocumentListItem({
  entry,
  isActive,
  onSwitch,
  onRename,
  onDelete,
  autoFocusName,
}: DocumentListItemProps) {
  const [confirmDelete, setConfirmDelete] =
    useState(false);
  const timerRef =
    useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleDeleteClick = useCallback(() => {
    if (confirmDelete) {
      clearTimeout(timerRef.current);
      setConfirmDelete(false);
      onDelete();
    } else {
      setConfirmDelete(true);
      timerRef.current = setTimeout(() => {
        setConfirmDelete(false);
      }, 2000);
    }
  }, [confirmDelete, onDelete]);

  return (
    <div
      className={
        "doc-list-item"
        + (isActive
          ? " doc-list-item--active"
          : "")
      }
    >
      <button
        type="button"
        className={
          "doc-list-item__delete"
          + (confirmDelete
            ? " doc-list-item__delete--confirm"
            : "")
        }
        onClick={handleDeleteClick}
        onMouseDown={(e) => e.preventDefault()}
      >
        <SP>weka</SP>
      </button>
      <div className="doc-list-item__name">
        {isActive ? (
          <NameInput
            value={entry.name}
            onChange={onRename}
            autoFocus={autoFocusName}
          />
        ) : (
          <button
            type="button"
            className="doc-list-item__label"
            onClick={onSwitch}
          >
            <span className="sp-text">
              {entry.name || "\u00A0"}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
