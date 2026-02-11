import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import {
  wordToCodepoint,
  codepointToChar,
  applyVariation,
} from "../../data";

export function SitelenPonaGlyph({
  node,
  selected,
}: NodeViewProps) {
  const word: string = node.attrs.word;
  const variation: number = node.attrs.variation ?? 0;

  const codepoint = wordToCodepoint[word];
  let display = "";
  if (codepoint !== undefined) {
    const base = codepointToChar(codepoint);
    display = variation > 0
      ? applyVariation(base, variation)
      : base;
  }

  const className = [
    "sitelen-pona-glyph",
    selected ? "sitelen-pona-glyph--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <NodeViewWrapper as="span" className={className}>
      <span title={word}>{display}</span>
    </NodeViewWrapper>
  );
}
