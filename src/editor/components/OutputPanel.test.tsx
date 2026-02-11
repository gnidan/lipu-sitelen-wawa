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
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  SitelenPonaNode,
} from "../extensions/sitelen-pona-node";
import { OutputPanel } from "./OutputPanel";

function createEditor(content = "") {
  return new Editor({
    extensions: [StarterKit, SitelenPonaNode],
    content,
  });
}

describe("OutputPanel", () => {
  afterEach(cleanup);
  it("renders both sections", () => {
    const editor = createEditor("<p></p>");
    render(<OutputPanel editor={editor} />);
    expect(
      screen.getByText("sitelen Lasina")
    ).toBeDefined();
    expect(
      screen.getByText("sitelen pona (UCSUR)")
    ).toBeDefined();
    editor.destroy();
  });

  it("renders copy buttons", () => {
    const editor = createEditor("<p></p>");
    render(<OutputPanel editor={editor} />);
    const copyButtons = screen.getAllByText("Copy");
    expect(copyButtons).toHaveLength(2);
    editor.destroy();
  });

  it("shows plain text content", () => {
    const editor = createEditor(
      "<p>hello world</p>"
    );
    render(<OutputPanel editor={editor} />);
    const pres = document.querySelectorAll(
      ".output-panel__text"
    );
    expect(pres[0]?.textContent).toBe(
      "hello world"
    );
    expect(pres[1]?.textContent).toBe(
      "hello world"
    );
    editor.destroy();
  });
});
