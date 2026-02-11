import React from "react";
import {
  describe,
  it,
  expect,
  afterEach,
} from "vitest";
import {
  render,
  screen,
  cleanup,
} from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  afterEach(cleanup);

  it("renders without crashing", () => {
    const { container } = render(<App />);
    expect(
      container.querySelector(".app")
    ).toBeTruthy();
  });

  it("shows title", () => {
    render(<App />);
    expect(
      screen.getByText("lipu sitelen wawa")
    ).toBeTruthy();
  });

  it("contains Editor component", () => {
    const { container } = render(<App />);
    expect(
      container.querySelector(".editor-wrapper")
    ).toBeTruthy();
  });

  it("shows footer attribution", () => {
    render(<App />);
    expect(
      screen.getByText(
        "nasin nanpa font by ETBCOR"
      )
    ).toBeTruthy();
  });
});
