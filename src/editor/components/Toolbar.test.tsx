import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from "vitest";
import {
  render,
  screen,
  cleanup,
} from "@testing-library/react";
import { Toolbar } from "./Toolbar";

describe("Toolbar", () => {
  afterEach(cleanup);
  it("renders all 4 buttons", () => {
    render(<Toolbar editor={null} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
  });

  it("renders correct button labels", () => {
    render(<Toolbar editor={null} />);
    expect(
      screen.getByText("Cartouche")
    ).toBeDefined();
    expect(
      screen.getByText("Long Glyph")
    ).toBeDefined();
    expect(
      screen.getByText("Stack")
    ).toBeDefined();
    expect(
      screen.getByText("Scale")
    ).toBeDefined();
  });

  it("disables buttons when editor is null", () => {
    render(<Toolbar editor={null} />);
    const buttons = screen.getAllByRole("button");
    for (const button of buttons) {
      expect(button).toBeDisabled();
    }
  });
});
