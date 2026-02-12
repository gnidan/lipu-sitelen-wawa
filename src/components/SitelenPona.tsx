import React from "react";
import { fromVerbatim } from "../convert";

export function SP({
  children,
}: {
  children: string;
}) {
  return (
    <span className="sp-text">
      {fromVerbatim(children)}
    </span>
  );
}

export function Verbatim({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span className="verbatim-label">
      {children}
    </span>
  );
}
