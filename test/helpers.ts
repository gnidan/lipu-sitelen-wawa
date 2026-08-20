// Shared fixture builders for the lipu core library's
// tests. Keep these semantics byte-identical to what
// they replace — the pins that use them are what
// matters, not this file.

import { codepointToChar, wordToCodepoint } from "../src/data";
import type {
  Anchor,
  Block,
  Gap,
  Lipu,
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
