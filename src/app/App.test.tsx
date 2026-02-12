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
    const { container } = render(<App />);
    const h1 = container.querySelector("h1");
    expect(h1).toBeTruthy();
    expect(
      h1!.querySelector(".sp-text")
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
