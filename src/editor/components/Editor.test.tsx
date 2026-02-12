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

  it("contains copy bar", () => {
    const { container } = render(<Editor />);
    expect(
      container.querySelector(".copy-bar")
    ).toBeTruthy();
  });

  it("contains help panel", () => {
    const { container } = render(<Editor />);
    expect(
      container.querySelector(".help-panel")
    ).toBeTruthy();
  });
});
