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
import { Editor } from "./Editor";

describe("Editor", () => {
  afterEach(cleanup);

  it("renders without crashing", () => {
    const { container } = render(<Editor />);
    expect(
      container.querySelector(".editor-wrapper")
    ).toBeTruthy();
  });

  it("contains editor content area", () => {
    const { container } = render(<Editor />);
    expect(
      container.querySelector(
        ".editor-content-wrapper"
      )
    ).toBeTruthy();
  });

  it("contains toolbar", () => {
    const { container } = render(<Editor />);
    expect(
      container.querySelector(".toolbar")
    ).toBeTruthy();
  });

  it("contains output panel", () => {
    const { container } = render(<Editor />);
    expect(
      container.querySelector(".output-panel")
    ).toBeTruthy();
  });
});
