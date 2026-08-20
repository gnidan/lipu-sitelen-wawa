// Shared fixture builders for the lipu core library's
// tests. Keep these semantics byte-identical to what
// they replace — the pins that use them are what
// matters, not this file.

import type { JSONContent } from "@tiptap/core";
import { codepointToChar, wordToCodepoint } from "../src/data";
import { JOINER_CHARS } from "../src/lipu/chars";
import {
  parseLatin,
  latinInlinesFromText,
  tokenizeLatin,
} from "../src/lipu/parse-latin";
import {
  parseSp,
  spInlinesFromText,
} from "../src/lipu/parse-sp";
import { renderLatin } from "../src/lipu/render-latin";
import { renderSp } from "../src/lipu/render-sp";
import type {
  Anchor,
  Block,
  Gap,
  Lipu,
  ParsedSide,
  Span,
  SpanKind,
} from "../src/lipu/types";

/** The UCSUR glyph a toki pona word renders as. */
export function glyph(w: string): string {
  return codepointToChar(wordToCodepoint[w]);
}

/** A gap with the given SP/Latin content. */
export function gap(sp = "", latin = ""): Gap {
  return { sp, latin };
}

/** A word anchor. */
export function word(w: string): Anchor {
  return { kind: "word", word: w };
}

/** A verbatim anchor, optionally SP-marked. */
export function vb(
  text: string,
  marked?: true
): Anchor {
  return marked
    ? { kind: "verbatim", text, marked }
    : { kind: "verbatim", text };
}

/** A Block, defaulting to empty anchors/gaps/spans. */
export function block(partial: Partial<Block>): Block {
  return {
    anchors: [],
    gaps: [gap()],
    spans: [],
    ...partial,
  };
}

/** A Lipu document from its blocks. */
export function mkLipu(...blocks: Block[]): Lipu {
  return { version: 2, blocks };
}

/** A structural/formatting span, defaulting to
 *  side "both". */
export function span(
  kind: SpanKind,
  from: number,
  to: number,
  extra?: Partial<Omit<Span, "from" | "to" | "kind">>
): Span {
  return { from, to, kind, side: "both", ...extra };
}

/** A cartouche span, defaulting to side "both". */
export function cart(
  from: number,
  to: number,
  extra?: Partial<Omit<Span, "from" | "to" | "kind">>
): Span {
  return span("cartouche", from, to, extra);
}

/** A MARKED verbatim anchor (files alias this to
 *  their preferred local name). */
export function mvb(text: string): Anchor {
  return { kind: "verbatim", text, marked: true };
}

/** A Block from positional anchors + gaps, spans
 *  always empty, anchors shallow-copied — the shape
 *  the merge-engine test files share. */
export function blockOf(
  anchors: Anchor[],
  gaps: Gap[]
): Block {
  return {
    anchors: anchors.map((a) => ({ ...a })),
    gaps,
    spans: [],
  };
}

export function countNl(s: string): number {
  let n = 0;
  for (const c of s) if (c === "\n") n += 1;
  return n;
}

/** A ParsedSide from SP text. */
export function spText(t: string): ParsedSide {
  return parseSp(spInlinesFromText(t));
}

/** A ParsedSide from Latin text. */
export function latText(t: string): ParsedSide {
  return parseLatin(latinInlinesFromText(t));
}

/** The ParsedSide a no-op SP reparse of the block
 *  would assert. */
export function spParse(b: Block): ParsedSide {
  return parseSp(renderSp(b).inlines);
}

/** The ParsedSide a no-op Latin reparse of the
 *  block would assert. */
export function latParse(b: Block): ParsedSide {
  return parseLatin(renderLatin(b).inlines);
}

/** Does the block's Latin render contain a run that
 *  binds into ONE marked verbatim token (interior
 *  punctuation)? Blocks with such a run are exempt
 *  from the plain full-identity no-op laws — the
 *  bind transition changes their shape by design —
 *  and satisfy one-step convergence + authored
 *  SP-byte conservation instead. */
export function rendersBoundToken(
  b: Block
): boolean {
  return renderLatin(b).inlines.some(
    (inl) =>
      inl.type === "text" &&
      tokenizeLatin(inl.text).some(
        (t) => t.type === "bound"
      )
  );
}

/** rendersBoundToken over a whole document. */
export function rendersBoundTokenLipu(
  lipu: Lipu
): boolean {
  return lipu.blocks.some((b) =>
    renderLatin(b).inlines.some(
      (inl) =>
        inl.type === "text" &&
        tokenizeLatin(inl.text).some(
          (t) => t.type === "bound"
        )
    )
  );
}

/** Is `needle` a subsequence of `hay` (characters
 *  in order, not necessarily adjacent)? Used by the
 *  authored-byte conservation checks. */
export function isSpSubsequence(
  needle: string,
  hay: string
): boolean {
  const n = [...needle];
  let i = 0;
  for (const ch of hay) {
    if (i < n.length && n[i] === ch) i += 1;
  }
  return i === n.length;
}

export function stripJoiners(s: string): string {
  return [...s]
    .filter((c) => !JOINER_CHARS.has(c))
    .join("");
}

/** A one-paragraph ProseMirror doc holding `text` —
 *  the storage/app tests' shared fixture shape. */
export function pmDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}
