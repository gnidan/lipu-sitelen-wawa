/**
 * Shared invariant checks for the lipu model.
 *
 * 1. Render invariant: renderSp of each lipu block
 *    reproduces blockInlines of the matching doc
 *    paragraph EXACTLY (text + verbatim flags) —
 *    the editor cannot tell the model swap
 *    happened.
 * 2. Merge agreement (SP-visible scope): the
 *    merged block's anchors (latin facets
 *    stripped), gap.sp strings, and structural
 *    span geometry deep-equal a from-scratch
 *    promotion-normalized reparse of the doc
 *    paragraph — after folding the unmarked-
 *    verbatim space-absorption ambiguity, which
 *    moves an anchor/gap boundary but never a byte
 *    (an earlier implementation's
 *    canonicalization, restated).
 *    gap.latin, span attrs, formatting spans, and
 *    the `case` facet are latin-local BY DESIGN
 *    and have no SP projection — excluded exactly
 *    as the earlier implementation's visibility
 *    filter excluded latin
 *    tokens.
 * 3. Structural soundness: checkBlock is clean and
 *    no sentinel anchor ever leaks out of the flat
 *    merge (the split-sentinel tripwire). This
 *    replaces the earlier
 *    companion-ownership orphan check: gaps cannot
 *    outlive anchors by construction (arity), so
 *    the orphan class is structurally gone.
 *
 * NOT checked here, deliberately:
 * "no run of 2+ '\n' in one gap.sp outside a
 * structural span" is a POST-CRYSTALLIZATION
 * invariant, not a per-transaction one. COMPOSITION
 * DWELL lets a run the selection is attending live
 * in the model (and in storage, if an autosave fires
 * mid-dwell) until the caret leaves or the editor
 * blurs; the three checks above all hold across that
 * transient state, and callers assert them mid-dwell.
 */

import { expect } from "vitest";
import type { Editor } from "@tiptap/core";
import type { Node as PmNode }
  from "@tiptap/pm/model";
import {
  checkBlock,
  isSentinel,
  isStructural,
  parseSp,
  promoteBlock,
  renderSp,
} from "../lipu";
import type { Anchor, Block } from "../lipu";
import { blockInlines } from "./lipu-doc";
import { lipuModelKey }
  from "./extensions/lipu-model";

interface SpView {
  anchors: Anchor[];
  gapsSp: string[];
  structural: Array<{
    from: number;
    to: number;
    kind: string;
  }>;
}

function stripLatin(a: Anchor): Anchor {
  const out = { ...a };
  delete out.case;
  return out;
}

/** Fold gap.sp spaces directly after an UNMARKED
 *  verbatim into the anchor text (the absorption
 *  ambiguity; see properties.test spCanon). */
function spView(block: Block): SpView {
  const anchors = block.anchors.map((a) =>
    stripLatin(a)
  );
  const gapsSp = block.gaps.map((g) => g.sp);
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    if (a.kind !== "verbatim" || a.marked) {
      continue;
    }
    let sp = gapsSp[i + 1];
    while (sp.startsWith(" ")) {
      a.text = (a.text ?? "") + " ";
      sp = sp.slice(1);
    }
    gapsSp[i + 1] = sp;
  }
  return {
    anchors,
    gapsSp,
    structural: block.spans
      .filter((s) => isStructural(s.kind))
      .map((s) => ({
        from: s.from,
        to: s.to,
        kind: s.kind,
      })),
  };
}

export function assertInvariants(
  editor: Editor
): void {
  const modelState = lipuModelKey.getState(
    editor.state
  );
  expect(modelState).toBeDefined();
  const { lipu } = modelState!;

  const paragraphs: PmNode[] = [];
  editor.state.doc.forEach((child) => {
    if (child.type.name === "paragraph") {
      paragraphs.push(child);
    }
  });

  expect(lipu.blocks.length).toBe(
    paragraphs.length
  );

  paragraphs.forEach((para, i) => {
    const block = lipu.blocks[i];
    const docInlines = blockInlines(para);

    // 1. render invariant
    const { inlines } = renderSp(block);
    expect(inlines).toEqual(docInlines);

    // 2. merge agreement, SP-visible scope
    const parsed = parseSp(docInlines);
    const reparsed = promoteBlock({
      anchors: parsed.anchors,
      gaps: parsed.gaps.map((sp) => ({
        sp,
        latin: "",
      })),
      spans: [],
    });
    expect(spView(block)).toEqual(spView(reparsed));

    // 3. structural soundness + sentinel tripwire
    expect(checkBlock(block)).toEqual([]);
    block.anchors.forEach((a, ai) => {
      expect(
        isSentinel(a),
        "sentinel leaked at block " +
          i +
          " anchor " +
          ai
      ).toBe(false);
    });
  });
}
