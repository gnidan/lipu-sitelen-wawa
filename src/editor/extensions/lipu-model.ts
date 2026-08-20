/**
 * The authoritative lipu, maintained per
 * transaction. The PM doc is a projection: it is
 * initialized from renderSp(lipu) and every
 * docChanged transaction is parsed back in.
 * Passive: dispatches nothing, decorates nothing.
 * Plugin state is a Lipu; merges run
 * through the editor-merge layer (doc-merge) —
 * per-block mergeSpBlock for inline edits, the
 * flat structural merge for block-boundary edits.
 *
 * ONE PARSED SIDE PER FRESH PARAGRAPH (binding,
 * from the flat merge's design): mergeStructural's
 * output block count follows the fresh parse by
 * construction, so parsedParagraphs must emit
 * exactly one ParsedSide per doc paragraph — never
 * a pre-chunked or re-grouped stream.
 *
 * The editing-time marker hop is CLOSED:
 * promotion records MARKER OFFSETS
 * and renderSp re-emits each marker where it sat,
 * so completing a cartouche/long pair no longer
 * moves a gap char next to the cursor. Nothing in
 * this file changed for it — the merge and the flat
 * demotion both preserve the bytes now.
 *
 * RESHAPE CAVEAT (known limitation, recorded): a
 * transaction that both splits and joins while
 * leaving the paragraph COUNT unchanged (paste over
 * a multi-paragraph selection) merges positionally,
 * so prev-side content hanging off re-created
 * anchors (gap.latin, facets) falls back to
 * creation defaults. SP bytes are safe — the edited
 * side is parse-authoritative. A real fix needs
 * transaction-level position mapping; that is
 * deliberately NOT built here (recorded as future
 * work). Pinned by a demonstrating test.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import type { Node as PmNode }
  from "@tiptap/pm/model";
import {
  ReplaceStep,
  ReplaceAroundStep,
  AddMarkStep,
  RemoveMarkStep,
} from "@tiptap/pm/transform";
import {
  emptyBlock,
  mergeSpBlock,
  mergeStructural,
  parseSp,
  renderSp,
} from "../../lipu";
import type {
  Block,
  Lipu,
  ParsedSide,
} from "../../lipu";
import {
  blockInlines,
  docToLipu,
  lipuToContent,
} from "../lipu-doc";
import {
  getLipuSync,
  isDevBuild,
} from "../lipu-sync";

export interface LipuModelState {
  lipu: Lipu;
  version: number;
}

export const lipuModelKey =
  new PluginKey<LipuModelState>("lipuModel");

/** Affected range in NEW-doc coordinates, or
 *  structural (block boundaries touched). */
function analyze(
  tr: Transaction,
  newDoc: PmNode,
  oldDoc: PmNode
):
  | { structural: true }
  | { structural: false; from: number; to: number } {
  if (newDoc.childCount !== oldDoc.childCount) {
    return { structural: true };
  }
  let from = Infinity;
  let to = -Infinity;
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    let stepFrom: number;
    let stepTo: number;
    if (
      step instanceof ReplaceStep ||
      step instanceof ReplaceAroundStep
    ) {
      const slice = step.slice;
      if (
        slice.openStart > 0 ||
        slice.openEnd > 0 ||
        (slice.content.firstChild !== null &&
          slice.content.firstChild.isBlock)
      ) {
        return { structural: true };
      }
      stepFrom = step.from;
      stepTo = step.to;
    } else if (
      step instanceof AddMarkStep ||
      step instanceof RemoveMarkStep
    ) {
      stepFrom = step.from;
      stepTo = step.to;
    } else {
      return { structural: true };
    }
    const own = step.getMap();
    let f = own.map(stepFrom, -1);
    let t = own.map(stepTo, 1);
    const rest = tr.mapping.slice(i + 1);
    f = rest.map(f, -1);
    t = rest.map(t, 1);
    from = Math.min(from, f);
    to = Math.max(to, t);
  }
  if (from === Infinity) {
    return { structural: true };
  }
  return { structural: false, from, to };
}

/** Whole-doc structural merge (exported for unit
 *  tests; see doc-merge.ts for the machinery and
 *  the FLAT-MERGE OWNERSHIP LAYOUT notes). */
export function structuralMerge(
  prevBlocks: Block[],
  parsedSides: ParsedSide[]
): Block[] {
  return mergeStructural(prevBlocks, parsedSides, "sp");
}

function parsedParagraphs(doc: PmNode): ParsedSide[] {
  const sides: ParsedSide[] = [];
  doc.forEach((child) => {
    if (child.type.name === "paragraph") {
      sides.push(parseSp(blockInlines(child)));
    }
  });
  return sides;
}

function updateLipu(
  prev: LipuModelState,
  tr: Transaction,
  newDoc: PmNode,
  oldDoc: PmNode
): LipuModelState {
  const res = analyze(tr, newDoc, oldDoc);
  if (res.structural) {
    return {
      lipu: {
        version: 2,
        blocks: structuralMerge(
          prev.lipu.blocks,
          parsedParagraphs(newDoc)
        ),
      },
      version: prev.version + 1,
    };
  }
  const clamp = (p: number) =>
    Math.max(0, Math.min(p, newDoc.content.size));
  const $f = newDoc.resolve(clamp(res.from));
  const $t = newDoc.resolve(clamp(res.to));
  const startBlock =
    $f.depth === 0
      ? Math.max(0, $f.index(0) - 1)
      : $f.index(0);
  const endBlock =
    $t.depth === 0
      ? Math.min(
          newDoc.childCount - 1,
          $t.index(0)
        )
      : $t.index(0);
  const blocks = prev.lipu.blocks.slice();
  for (
    let b = startBlock;
    b <= endBlock && b < newDoc.childCount;
    b++
  ) {
    const parsed = parseSp(
      blockInlines(newDoc.child(b))
    );
    blocks[b] = mergeSpBlock(
      blocks[b] ?? emptyBlock(),
      parsed
    );
  }
  return {
    lipu: { version: 2, blocks },
    version: prev.version + 1,
  };
}

/** Dev/test adoption verification: the
 *  adopted lipu's FULL SpInline stream — text AND
 *  verbatim marks and every attr the doc carries,
 *  not text alone — must equal the
 *  post-transaction doc's. Throwing here surfaces
 *  through the Latin handler's error policy
 *  (dev builds throw; production recovers). */
function assertAdoption(
  lipu: Lipu,
  doc: PmNode
): void {
  const paras: PmNode[] = [];
  doc.forEach((child) => {
    if (child.type.name === "paragraph") {
      paras.push(child);
    }
  });
  const fail = (msg: string): never => {
    throw new Error(
      "lipu adoption verification failed: " + msg
    );
  };
  if (paras.length !== lipu.blocks.length) {
    fail(
      `paragraph count ${paras.length} != ` +
        `${lipu.blocks.length}`
    );
  }
  lipu.blocks.forEach((b, i) => {
    const want = JSON.stringify(
      renderSp(b).inlines
    );
    const got = JSON.stringify(
      blockInlines(paras[i])
    );
    if (want !== got) {
      // Read the message DIRECTIONALLY: got is the
      // DOC's stream, want the adopted lipu's.
      fail(`block ${i}: ${got} != ${want}`);
    }
  });
}

export interface LipuModelOptions {
  // The lipu the editor was loaded with. When it is
  // byte-verified equal to the doc it seeds plugin
  // state directly, preserving latin-side gap
  // content (e.g. the "\n" Enter writes to
  // gap.latin) the doc itself cannot express and
  // that a docToLipu re-derive would silently drop.
  // A stale/foreign lipu must never win over the
  // doc, so the check is mandatory, not a
  // trust-on-honor optimization.
  initialLipu: Lipu | null;
}

export const LipuModel = Extension.create<
  LipuModelOptions
>({
  name: "lipuModel",

  addOptions() {
    return { initialLipu: null };
  },

  addProseMirrorPlugins() {
    const { initialLipu } = this.options;
    return [
      new Plugin<LipuModelState>({
        key: lipuModelKey,
        state: {
          // Seeded from initialLipu when it verifies
          // against the doc (see LipuModelOptions);
          // otherwise state derives from the doc — the
          // doc is built from renderSp(lipu), and the
          // round trip is test-proven, so deriving
          // here keeps plugin state consistent with
          // the doc by construction (no separate
          // initial input to drift).
          init: (_config, state) => {
            if (initialLipu) {
              const seededContent = JSON.stringify(
                lipuToContent(initialLipu)
              );
              const docContent = JSON.stringify(
                state.doc.toJSON()
              );
              if (seededContent === docContent) {
                return { lipu: initialLipu, version: 0 };
              }
              console.warn(
                "lipu-sitelen-wawa: initial lipu does " +
                  "not match doc; re-deriving"
              );
            }
            return {
              lipu: docToLipu(state.doc),
              version: 0,
            };
          },
          apply: (tr, prev, oldState, newState) => {
            // A Latin-LOCAL edit has zero SP
            // steps; gating on docChanged alone
            // would return prev and never advance
            // the version — and version-tracked
            // saves would miss the edit.
            const sync = getLipuSync(tr);
            if (sync) {
              if (isDevBuild()) {
                assertAdoption(
                  sync.lipu,
                  newState.doc
                );
              }
              return {
                lipu: sync.lipu,
                version: prev.version + 1,
              };
            }
            return tr.docChanged
              ? updateLipu(
                  prev,
                  tr,
                  newState.doc,
                  oldState.doc
                )
              : prev;
          },
        },
      }),
    ];
  },
});
