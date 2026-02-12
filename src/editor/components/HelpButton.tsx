import React from "react";
import {
  SP,
} from "../../components/SitelenPona";

interface HelpButtonProps {
  active: boolean;
  onToggle: () => void;
}

export function HelpButton({
  active,
  onToggle,
}: HelpButtonProps) {
  return (
    <button
      type="button"
      className={
        "help-button"
        + (active
          ? " help-button--active"
          : "")
      }
      onClick={onToggle}
      onMouseDown={(e) => e.preventDefault()}
    >
      <SP>sona</SP>
    </button>
  );
}
