import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render, screen, cleanup,
} from "@testing-library/react";
import { SitelenPonaGlyph } from "./SitelenPonaGlyph";
import {
  wordToCodepoint,
  codepointToChar,
  applyVariation,
} from "../../data";
import type { NodeViewProps } from "@tiptap/react";

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({
    children,
    className,
    as: _as,
  }: {
    children: React.ReactNode;
    className?: string;
    as?: string;
  }) => (
    <span data-testid="node-view-wrapper" className={className}>
      {children}
    </span>
  ),
}));

function makeProps(
  attrs: { word: string; variation?: number },
  selected = false
): NodeViewProps {
  return {
    node: { attrs } as unknown as NodeViewProps["node"],
    selected,
    updateAttributes: vi.fn(),
    deleteNode: vi.fn(),
    getPos: vi.fn(),
    editor: {} as NodeViewProps["editor"],
    extension: {} as NodeViewProps["extension"],
    decorations: [] as unknown as NodeViewProps["decorations"],
    HTMLAttributes: {},
  } as unknown as NodeViewProps;
}

describe("SitelenPonaGlyph", () => {
  afterEach(cleanup);

  it("renders the UCSUR character for a word", () => {
    render(<SitelenPonaGlyph {...makeProps({ word: "toki" })} />);
    const cp = wordToCodepoint["toki"];
    const expected = codepointToChar(cp);
    expect(screen.getByTitle("toki").textContent)
      .toBe(expected);
  });

  it("shows word name as tooltip", () => {
    render(<SitelenPonaGlyph {...makeProps({ word: "pona" })} />);
    expect(screen.getByTitle("pona")).toBeTruthy();
  });

  it("applies selected class when selected", () => {
    render(
      <SitelenPonaGlyph {...makeProps({ word: "toki" }, true)} />
    );
    const wrapper = screen.getByTestId("node-view-wrapper");
    expect(wrapper.className).toContain(
      "sitelen-pona-glyph--selected"
    );
  });

  it("does not apply selected class when not selected", () => {
    render(
      <SitelenPonaGlyph
        {...makeProps({ word: "toki" }, false)}
      />
    );
    const wrapper = screen.getByTestId("node-view-wrapper");
    expect(wrapper.className).not.toContain(
      "sitelen-pona-glyph--selected"
    );
    expect(wrapper.className).toContain(
      "sitelen-pona-glyph"
    );
  });

  it("handles variation attribute", () => {
    render(
      <SitelenPonaGlyph
        {...makeProps({ word: "ni", variation: 1 })}
      />
    );
    const cp = wordToCodepoint["ni"];
    const expected = applyVariation(
      codepointToChar(cp),
      1
    );
    expect(screen.getByTitle("ni").textContent)
      .toBe(expected);
  });

  it("renders base glyph when variation is 0", () => {
    render(
      <SitelenPonaGlyph
        {...makeProps({ word: "ni", variation: 0 })}
      />
    );
    const cp = wordToCodepoint["ni"];
    const expected = codepointToChar(cp);
    expect(screen.getByTitle("ni").textContent)
      .toBe(expected);
  });
});
