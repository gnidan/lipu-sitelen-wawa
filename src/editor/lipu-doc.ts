/**
 * Doc <-> lipu bridge. contentToLipu is the
 * legacy-mirror import path (
 * mirror-only docs convert via parseSp with the
 * both-sides "\n" default, which subsumes
 * the companion backfill); docToLipu is the plugin
 * re-derive fallback and applies the same
 * defaults. lipuToContent's output is
 * byte-equivalent (serialized) to editor.getJSON()
 * for editor-produced content — test-enforced.
 *
 * Load-time canonicalizations carried from the
 * pre-model editor
 * (adjacent same-mark text nodes join; legacy-ni
 * codepoint folds happen inside parseSp) still
 * hold: ProseMirror's own construction paths keep
 * the joined invariant, and the editor initializes
 * from lipuToContent, so only foreign stored JSON
 * exhibits the split shape. Test-pinned.
 *
 * Stored JSON containing non-paragraph top-level
 * nodes or non-verbatim marks is silently
 * normalized away on load (schema-equivalent to
 * main's behavior; implicit canonicalization).
 *
 * Import normal form is PROMOTION-ONLY: the
 * PM normalizer stays the single empty-line
 * authority, so no block splits happen here, and
 * no facet folds (SP bytes must not move on load).
 * Separation defaults apply so parsed content
 * is Latin-no-op-safe from the start.
 */

import type { JSONContent } from "@tiptap/core";
import type { Node as PmNode }
  from "@tiptap/pm/model";
import {
  applySeparationDefaults,
  applySeparationDefaultsLipu,
  classifyBlock,
  classifyProvenance,
  emptyBlock,
  normalizeLetterishLatinLipu,
  parseSp,
  promoteBlock,
  renderSp,
} from "../lipu";
import type {
  Block,
  Lipu,
  ParsedSide,
  SpInline,
} from "../lipu";

export function emptyLipu(): Lipu {
  return { version: 2, blocks: [emptyBlock()] };
}

// Snapshotted together from the same plugin state
// (or the same doc, on the no-state fallback) --
// coherent by construction. See documents.ts
// saveDocDual for how this is dual-written.
export interface SavePayload {
  lipu: Lipu;
  content: JSONContent;
}

function countNl(s: string): number {
  let n = 0;
  for (const c of s) if (c === "\n") n += 1;
  return n;
}

/** One parsed SP side -> a load-normal Block:
 *  both-sides "\n" default, promotion-only
 *  normal form, classify, separation
 *  default — in that order. */
export function parsedToBlock(
  parsed: ParsedSide
): Block {
  return applySeparationDefaults(
    classifyBlock(
      promoteBlock({
        anchors: parsed.anchors,
        gaps: parsed.gaps.map((sp) => ({
          sp,
          latin: "\n".repeat(countNl(sp)),
        })),
        spans: [],
      })
    )
  );
}

/** The load-boundary chain: classify FIRST,
 *  then the mark-gated separation default, then the
 *  deliberately ungated letterish guard (gating it
 *  would re-open an anchor-fusion data loss).
 *  Editor.tsx's initialLipu calls exactly this.
 *
 *  alreadyClassified (default false): when
 *  true, the classify step is SKIPPED — `lipu`'s
 *  marks are trusted as already fully resolved (a
 *  storage payload that carried `classified: true`,
 *  or any other pre-resolved source). Running
 *  classifyProvenance a second time on such a lipu
 *  would misclassify machine-generated defaults whose
 *  bytes don't "look default" (derived
 *  punctuation) as AUTHORED — the exact bug this param exists
 *  to prevent. Default false preserves this
 *  function's original unconditional-classify
 *  behavior for every other caller (old/unflagged
 *  storage payloads, and every existing pin). */
export function loadNormalizeLipu(
  lipu: Lipu,
  alreadyClassified = false
): Lipu {
  return normalizeLetterishLatinLipu(
    applySeparationDefaultsLipu(
      alreadyClassified
        ? lipu
        : classifyProvenance(lipu)
    )
  );
}

function hasVerbatimMark(
  marks: Array<{ type: string }> | undefined
): boolean {
  return (marks ?? []).some(
    (m) => m.type === "verbatim"
  );
}

// Twin of contentInlines/blockInlines — a new inline
// node type must be handled in both.
function contentInlines(
  node: JSONContent
): SpInline[] {
  const out: SpInline[] = [];
  for (const child of node.content ?? []) {
    if (child.type === "hardBreak") {
      out.push({ type: "break" });
      continue;
    }
    if (child.type === "text" && child.text) {
      out.push({
        type: "text",
        text: child.text,
        verbatim: hasVerbatimMark(
          child.marks as
            | Array<{ type: string }>
            | undefined
        ),
      });
    }
  }
  return out;
}

export function contentToLipu(
  content: JSONContent | undefined
): Lipu {
  const paras = (content?.content ?? []).filter(
    (n) => n.type === "paragraph"
  );
  if (paras.length === 0) return emptyLipu();
  return {
    version: 2,
    blocks: paras.map((p) =>
      parsedToBlock(parseSp(contentInlines(p)))
    ),
  };
}

// Twin of contentInlines/blockInlines — a new inline
// node type must be handled in both.
export function blockInlines(
  node: PmNode
): SpInline[] {
  const out: SpInline[] = [];
  node.forEach((child) => {
    if (child.type.name === "hardBreak") {
      out.push({ type: "break" });
      return;
    }
    if (child.isText && child.text) {
      out.push({
        type: "text",
        text: child.text,
        verbatim: child.marks.some(
          (m) => m.type.name === "verbatim"
        ),
      });
    }
  });
  return out;
}

export function docToLipu(doc: PmNode): Lipu {
  const blocks: Block[] = [];
  doc.forEach((child) => {
    if (child.type.name === "paragraph") {
      blocks.push(
        parsedToBlock(parseSp(blockInlines(child)))
      );
    }
  });
  if (blocks.length === 0) return emptyLipu();
  return { version: 2, blocks };
}

export function lipuToContent(
  lipu: Lipu
): JSONContent {
  return {
    type: "doc",
    content: lipu.blocks.map((b) => {
      const { inlines } = renderSp(b);
      const content: JSONContent[] = [];
      for (const inline of inlines) {
        if (inline.type === "break") {
          content.push({ type: "hardBreak" });
          continue;
        }
        if (inline.text.length === 0) continue;
        const node: JSONContent = {
          type: "text",
        };
        if (inline.verbatim) {
          node.marks = [{ type: "verbatim" }];
        }
        node.text = inline.text;
        content.push(node);
      }
      return content.length > 0
        ? { type: "paragraph", content }
        : { type: "paragraph" };
    }),
  };
}
