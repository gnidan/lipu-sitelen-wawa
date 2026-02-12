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
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  SitelenPona,
} from "../extensions/sitelen-pona";
import { CopyBar } from "./CopyBar";

function createEditor(content = "") {
  return new Editor({
    extensions: [StarterKit, SitelenPona],
    content,
  });
}

describe("CopyBar", () => {
  afterEach(cleanup);

  it("renders two copy buttons", () => {
    const editor = createEditor("<p></p>");
    render(<CopyBar editor={editor} />);
    expect(
      screen.getByText("Copy as Latin")
    ).toBeTruthy();
    expect(
      screen.getByText("Copy as UCSUR")
    ).toBeTruthy();
    editor.destroy();
  });

  it("handles null editor", () => {
    render(<CopyBar editor={null} />);
    expect(
      screen.getByText("Copy as Latin")
    ).toBeTruthy();
  });

  it("calls clipboard on click", () => {
    const writeText = vi.fn().mockResolvedValue(
      undefined
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const editor = createEditor(
      "<p>hello</p>"
    );
    render(<CopyBar editor={editor} />);
    fireEvent.click(
      screen.getByText("Copy as Latin")
    );
    expect(writeText).toHaveBeenCalledWith(
      "hello"
    );
    editor.destroy();
  });
});
