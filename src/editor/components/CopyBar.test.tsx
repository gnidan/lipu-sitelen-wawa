import React from "react";
import {
  describe,
  it,
  expect,
  afterEach,
} from "vitest";
import {
  render,
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

  it("renders collapsed by default", () => {
    const editor = createEditor(
      "<p>hello</p>"
    );
    const { container } = render(
      <CopyBar editor={editor} />
    );
    expect(
      container.querySelector(
        ".latin-panel__text"
      )
    ).toBeNull();
    editor.destroy();
  });

  it("expands on toggle click", () => {
    const editor = createEditor(
      "<p>hello</p>"
    );
    const { container } = render(
      <CopyBar editor={editor} />
    );
    const toggle = container.querySelector(
      ".latin-panel__toggle"
    )!;
    fireEvent.click(toggle);
    const text = container.querySelector(
      ".latin-panel__text"
    );
    expect(text).toBeTruthy();
    expect(text?.textContent).toBe("hello");
    editor.destroy();
  });

  it("handles null editor", () => {
    const { container } = render(
      <CopyBar editor={null} />
    );
    expect(
      container.querySelector(".latin-panel")
    ).toBeNull();
  });
});
