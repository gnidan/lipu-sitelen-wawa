import React from "react";
import {
  describe,
  it,
  expect,
  afterEach,
} from "vitest";
import {
  render,
  cleanup,
} from "@testing-library/react";
import { HelpPanel } from "./HelpPanel";

describe("HelpPanel", () => {
  afterEach(cleanup);

  it("renders without crashing", () => {
    const { container } = render(<HelpPanel />);
    expect(
      container.querySelector(".help-panel")
    ).toBeTruthy();
  });

  it("is collapsed by default", () => {
    const { container } = render(<HelpPanel />);
    const details =
      container.querySelector("details");
    expect(details).toBeTruthy();
    expect(details!.open).toBe(false);
  });

  it("contains keyboard reference entries", () => {
    const { container } = render(<HelpPanel />);
    const keys = container.querySelectorAll(
      ".help-panel__key"
    );
    expect(keys.length).toBeGreaterThan(0);

    const keyTexts = Array.from(keys).map(
      (k) => k.textContent
    );
    expect(keyTexts).toContain("Space");
    expect(keyTexts).toContain("+");
    expect(keyTexts).toContain("[ ]");
  });

  it("shows summary text", () => {
    const { container } = render(<HelpPanel />);
    const summary =
      container.querySelector("summary");
    expect(summary?.textContent).toBe(
      "keyboard reference"
    );
  });
});
