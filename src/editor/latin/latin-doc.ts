/**
 * Latin doc <-> lipu bridges. Paragraph <-> Block
 * one-to-one; inline content from renderLatin's
 * LatinInline stream; "\n" <-> hardBreak; name
 * chips <-> latinName atoms. The builders are the
 * coordinate invariant's implementation:
 * renderLatin counts atoms as 1 and "\n" as 1,
 * and so does the PM doc built here.
 *
 * Both cartouche shapes flow through unchanged: a
 * NAMED cartouche arrives as one `name` inline
 * (one atom), a NAMELESS one never atomizes at all
 * (the ATOMIZATION RULE) and arrives as ordinary
 * text — so an
 * atomization FLIP between merges is just a
 * different inline stream here, and the reconcile's
 * structure-keyed diff sees it as a node-kind
 * change (which a text diff provably cannot).
 */

import type { JSONContent } from "@tiptap/core";
import type { Node as PmNode } from
  "@tiptap/pm/model";
import { renderLatin } from "../../lipu";
import type {
  Anchor,
  Block,
  LatinInline,
  Lipu,
} from "../../lipu";

/** Per-block build cache, keyed on Block IDENTITY
 *  — the same gate (and the same staleness
 *  exposure) as latin-projections' projectBlock,
 *  for the same reason: the SP->Latin reconcile
 *  rebuilds the whole doc content on EVERY
 *  keystroke, while updateLipu's incremental path
 *  preserves identity for untouched blocks.
 *  Measured in happy-dom at 1000 blocks x 3
 *  anchors: ~0.9ms/keystroke saved (8.2ms -> 7.3ms
 *  end-to-end SP dispatch). Results are treated as
 *  immutable; every consumer feeds them to
 *  schema.nodeFromJSON, which only reads. */
const contentCache = new WeakMap<
  Block,
  JSONContent
>();

export function latinBlockContent(
  block: Block
): JSONContent {
  const hit = contentCache.get(block);
  if (hit) return hit;
  const built = buildLatinBlockContent(block);
  contentCache.set(block, built);
  return built;
}

function buildLatinBlockContent(
  block: Block
): JSONContent {
  const content: JSONContent[] = [];
  for (const inline of renderLatin(block)
    .inlines) {
    if (inline.type === "name") {
      content.push({
        type: "latinName",
        attrs: {
          anchors: inline.anchors,
          interiorLatin: inline.interiorLatin,
          text: inline.text,
        },
      });
      continue;
    }
    const parts = inline.text.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) {
        content.push({ type: "hardBreak" });
      }
      // PM forbids empty text nodes; the "\n"
      // already contributed its own position as
      // the hardBreak above.
      if (p.length === 0) return;
      const last = content[content.length - 1];
      if (
        last &&
        last.type === "text" &&
        typeof last.text === "string"
      ) {
        last.text += p;
      } else {
        content.push({ type: "text", text: p });
      }
    });
  }
  return content.length > 0
    ? { type: "paragraph", content }
    : { type: "paragraph" };
}

export function latinDocContent(
  lipu: Lipu
): JSONContent {
  return {
    type: "doc",
    content: lipu.blocks.map(latinBlockContent),
  };
}

export function paragraphLatinInlines(
  node: PmNode
): LatinInline[] {
  const out: LatinInline[] = [];
  const pushText = (t: string): void => {
    const last = out[out.length - 1];
    if (last && last.type === "text") {
      last.text += t;
    } else {
      out.push({ type: "text", text: t });
    }
  };
  node.forEach((child) => {
    if (child.type.name === "hardBreak") {
      pushText("\n");
      return;
    }
    if (child.type.name === "latinName") {
      out.push({
        type: "name",
        anchors: child.attrs
          .anchors as Anchor[],
        interiorLatin: child.attrs
          .interiorLatin as string[],
        text: child.attrs.text as string,
      });
      return;
    }
    if (child.isText && child.text) {
      pushText(child.text);
    }
  });
  return out;
}
