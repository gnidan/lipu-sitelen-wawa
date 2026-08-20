import { describe, expect, it, vi } from "vitest";
import * as fc from "fast-check";
import {
  applySeparationDefaults,
  collapseSeamRuns,
  flattenBlocks,
  flattenParsed,
  isSentinel,
  mergeLatinBlock,
  mergeSpBlock,
  mergeStructural,
  normalizeLetterishLatin,
  rechunk,
  revalidateSpanOffsets,
} from "./doc-merge";
import { renderSp, anchorSpText }
  from "./render-sp";
import { parseSp } from "./parse-sp";
import { renderLatin } from "./render-latin";
import { parseLatin, tokenizeLatin }
  from "./parse-latin";
import { mergeBlock } from "./merge";
import { checkBlock } from "./types";
import {
  CARTOUCHE_START,
  CARTOUCHE_END,
  IDEO_SPACE,
  LONG_START,
  LONG_END,
  STACK,
} from "./chars";
import type {
  Anchor,
  Block,
  Lipu,
  ParsedSide,
} from "./types";
import {
  arbBlock,
  arbLipu,
} from "../../test/lipu-arbitraries";
import { conservationErrors }
  from "../../test/provenance-oracle";

import {
  blockOf as block,
  cart,
  countNl,
  gap as g,
  isSpSubsequence,
  latParse,
  rendersBoundTokenLipu,
  span,
  spParse,
  stripJoiners,
  word,
} from "../../test/helpers";

const stable = (v: unknown): string =>
  JSON.stringify(v);

/** The `conservationErrors` oracle alone is NOT a
 *  sufficient check for the fusion rescue —
 *  mutation-verified (same method as
 *  properties.test.ts's own note, full reasoning
 *  there): its pass-layer baseline is computed
 *  BEFORE the fusion rescue runs, and frozen
 *  merge.ts already drops a fusion's dying gap on
 *  its own, so the baseline never has the byte
 *  either and the oracle cannot see whether the
 *  rescue restored it — verified by stubbing
 *  `rescueFusedGaps` on a hand-built authored
 *  fusion, where `conservationErrors` stayed green
 *  while the byte was visibly dropped. So this
 *  file's bind-shaped branch, like
 *  properties.test.ts's, runs BOTH: the
 *  authored-subsequence check (correct in form,
 *  just unexercised by arbLipu, which never mints
 *  `spAuthored: true` gaps — measured: 0 in 2000
 *  samples) catches the rescue itself;
 *  `conservationErrors` catches any OTHER
 *  doc-merge pass destroying authored content the
 *  baseline did have. Both mutation-verified below
 *  ("the bind-shaped branch really
 *  discriminates"). */
const authoredSpConcat = (blocks: Block[]): string =>
  blocks
    .flatMap((b) => b.gaps)
    .filter((gp) => gp.spAuthored)
    .map((gp) => gp.sp)
    .join("");

/** Every law in this file runs over the WIDE
 *  arbLipu domain. An earlier narrowing (two flat
 *  LATIN laws over an array-of-arbBlock domain)
 *  existed only because cleanupJoiners used to drop
 *  a stranded joiner on EVERY Latin merge; it now
 *  fires only on DISTURBED gaps (see merge.ts), a
 *  no-op disturbs nothing, and the wide domain is
 *  legal — measured clean over 5000 runs x 3 seeds
 *  before widening.
 *
 *  (arbBlock stays imported — other laws further
 *  down draw single blocks from it directly.) */

describe("flatten / rechunk", () => {
  // flatten/rechunk are mutually inverse only for
  // n >= 1, not over all of arbLipu. At n = 0
  // flattenBlocks synthesizes {anchors: [], gaps:
  // [{sp:"", latin:""}]} — which is EXACTLY what one
  // zero-anchor Block flattens to (gaps are always
  // anchors + 1), so no rechunk could separate the
  // two cases. The empty document is pinned
  // separately below and handled in mergeStructural.
  it("rechunk(flattenBlocks(x)) is identity " +
     "(property, incl. zero-anchor blocks; n >= 1 " +
     "— see the empty-doc pin)", () => {
    fc.assert(
      fc.property(arbLipu, (lipu) => {
        const blocks = (lipu as Lipu).blocks;
        if (blocks.length === 0) return true;
        const rt = rechunk(flattenBlocks(blocks));
        return stable(rt) === stable(blocks);
      }),
      { numRuns: 2000 }
    );
  });

  it("empty document: flattenBlocks synthesizes " +
     "the empty Block and rechunk yields one " +
     "chunk (mergeStructural resolves the " +
     "ambiguity)", () => {
    const flat = flattenBlocks([]);
    expect(flat).toEqual({
      anchors: [],
      gaps: [g("", "")],
      spans: [],
    });
    expect(flat).toEqual(
      flattenBlocks([
        { anchors: [], gaps: [g("", "")], spans: [] },
      ])
    );
    expect(rechunk(flat)).toHaveLength(1);
    // mergeStructural resolves it by the parse count
    expect(mergeStructural([], [], "sp")).toEqual([]);
    expect(
      mergeStructural([], [flattenParsed([])], "sp")
    ).toHaveLength(1);
  });

  it("flat arity: gaps = anchors + 1, always", () => {
    fc.assert(
      fc.property(arbLipu, (lipu) => {
        const flat = flattenBlocks(
          (lipu as Lipu).blocks
        );
        return (
          flat.gaps.length ===
          flat.anchors.length + 1
        );
      }),
      { numRuns: 2000 }
    );
  });
});

describe("mergeStructural — no-op laws (the " +
         "editor-path gates)", () => {
  it("SP no-op: per-block SP bytes and block " +
     "count are unchanged (wide arbLipu domain)",
     () => {
    fc.assert(
      fc.property(arbLipu, (lipu) => {
        const blocks = (lipu as Lipu).blocks;
        const out = mergeStructural(
          blocks,
          blocks.map(spParse),
          "sp"
        );
        if (out.length !== blocks.length) {
          return false;
        }
        return out.every(
          (b, i) =>
            stable(renderSp(b).inlines) ===
            stable(renderSp(blocks[i]).inlines)
        );
      }),
      { numRuns: 2000 }
    );
  });

  // Block count is always stable here (this is the
  // equal-count structural path — one parsed side
  // per block, no flat/count-changing edit), so
  // that half of the claim stays unconditional.
  // SP-IDENTITY does not: a bind-shaped Lipu
  // conserves its OWN authored SP bytes AND passes
  // the conservation oracle through the real
  // pipeline instead (see rendersBoundToken's
  // docstring in test/helpers.ts).
  it("anchor conservation: Latin no-op through the " +
     "FLAT merge is " +
     "SP-IDENTITY for bind-free Lipus, and " +
     "block-count-stable always (wide arbLipu " +
     "domain; bind-shaped Lipus conserve their " +
     "own authored SP bytes AND pass " +
     "conservation)", () => {
    fc.assert(
      fc.property(arbLipu, (lipu) => {
        const blocks = (lipu as Lipu).blocks;
        const sides = blocks.map((b) =>
          parseLatin(renderLatin(b).inlines)
        );
        const out = mergeStructural(
          blocks,
          sides,
          "latin"
        );
        if (out.length !== blocks.length) {
          return false;
        }
        if (!rendersBoundTokenLipu(lipu as Lipu)) {
          return out.every(
            (b, i) =>
              stable(renderSp(b).inlines) ===
              stable(renderSp(blocks[i]).inlines)
          );
        }
        return (
          isSpSubsequence(
            stripJoiners(authoredSpConcat(blocks)),
            stripJoiners(authoredSpConcat(out))
          ) &&
          conservationErrors(
            blocks,
            sides,
            out,
            "latin"
          ).length === 0
        );
      }),
      { numRuns: 2000 }
    );
  });

  // Bind-shaped branch discrimination lock (same
  // note as properties.test.ts's own lock — full
  // reasoning there): arbLipu mints ZERO
  // `spAuthored` gaps (0 in 2000 samples), so
  // neither half of the bind-shaped branch is
  // exercised by the generator — this pin is their
  // only coverage, hand-built, through the SAME
  // `mergeStructural` call the conservation law
  // uses. TWO independently mutation-verified
  // claims: stubbing `rescueFusedGaps` turns the
  // `isSpSubsequence` half RED (the rescue's own
  // job) while `conservationErrors` stays green
  // even then (its baseline is computed before the
  // rescue runs, so it cannot see whether the
  // rescue restored the byte) — which is exactly
  // why the law needs both.
  it("the bind-shaped branch really discriminates: " +
     "an authored dying-gap byte survives the real " +
     "fusion rescue, both by direct subsequence AND " +
     "by the conservation oracle (hand-built)", () => {
    const prev: Block = {
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "word", word: "pona" },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: " ", latin: " " },
        { sp: "\n", latin: "", spAuthored: true },
      ],
      spans: [],
    };
    const parsed = parseLatin([
      { type: "text", text: "toki.pona" },
    ]);
    const out = mergeStructural(
      [prev],
      [parsed],
      "latin"
    );
    expect(
      isSpSubsequence(
        stripJoiners(authoredSpConcat([prev])),
        stripJoiners(authoredSpConcat(out))
      )
    ).toBe(true);
    expect(
      conservationErrors(
        [prev],
        [parsed],
        out,
        "latin"
      )
    ).toEqual([]);
  });

  // FULL identity holds only for bind-free Lipus;
  // a bind-shaped Lipu transitions by design
  // instead of no-opping, and converges in one
  // further step — see the companion law below.
  it("Latin no-op through the flat merge is FULL " +
     "identity for bind-free Lipus (wide arbLipu " +
     "domain; bind-shaped Lipus transition — see " +
     "convergence below)", () => {
    fc.assert(
      fc.property(arbLipu, (lipu) => {
        fc.pre(!rendersBoundTokenLipu(lipu as Lipu));
        const blocks = (lipu as Lipu).blocks;
        const out = mergeStructural(
          blocks,
          blocks.map((b) =>
            parseLatin(renderLatin(b).inlines)
          ),
          "latin"
        );
        return stable(out) === stable(blocks);
      }),
      { numRuns: 2000 }
    );
  });

  // The bind transition converges in ONE step,
  // over the flat/mergeStructural path — same claim
  // as properties.test.ts's own convergence law,
  // one file over.
  it("the bind transition through the flat merge " +
     "converges in ONE step (wide arbLipu " +
     "domain)", () => {
    fc.assert(
      fc.property(arbLipu, (lipu) => {
        const blocks = (lipu as Lipu).blocks;
        const once = mergeStructural(
          blocks,
          blocks.map((b) =>
            parseLatin(renderLatin(b).inlines)
          ),
          "latin"
        );
        const twice = mergeStructural(
          once,
          once.map((b) =>
            parseLatin(renderLatin(b).inlines)
          ),
          "latin"
        );
        return stable(twice) === stable(once);
      }),
      { numRuns: 2000 }
    );
  });

  it("outputs satisfy checkBlock and never leak " +
     "a sentinel (wide arbLipu domain)", () => {
    fc.assert(
      fc.property(arbLipu, (lipu) => {
        const blocks = (lipu as Lipu).blocks;
        const out = mergeStructural(
          blocks,
          blocks.map(spParse),
          "sp"
        );
        return out.every(
          (b) =>
            checkBlock(b).length === 0 &&
            b.anchors.every((a) => !isSentinel(a))
        );
      }),
      { numRuns: 2000 }
    );
  });

  // ANTI-HIDING PIN: on a no-op the flat machinery
  // (sentinels, join rescue, split routing, straddler
  // demotion) must be INERT — the result must equal
  // what per-block mergeBlock (merge.ts) produces
  // block by block. It was written as the guard that
  // kept the (now retired) narrow-domain exclusion
  // from hiding a sentinel bug; it keeps its value
  // as an ATTRIBUTION pin, separating "the flat
  // merge is inert" from "the block merge is
  // correct" — the laws above would pass on a doc
  // where BOTH were wrong in the same way.
  // The per-block reference must be the
  // pipeline-aware `mergeLatinBlock`, not the bare
  // frozen `mergeBlock` core — same
  // reference-function correction as the
  // "equal-count ... byte-identical" law below, for
  // the same reason given there.
  it("the flat merge adds nothing over per-block " +
     "mergeBlock on no-ops (incl. the non-normal-" +
     "form arbLipu shapes)",
     () => {
    fc.assert(
      fc.property(arbLipu, (lipu) => {
        const blocks = (lipu as Lipu).blocks;
        if (blocks.length === 0) return true;
        const latinNoop = mergeStructural(
          blocks,
          blocks.map((b) =>
            parseLatin(renderLatin(b).inlines)
          ),
          "latin"
        );
        const perBlockLatin = blocks.map((b) =>
          mergeLatinBlock(
            b,
            parseLatin(renderLatin(b).inlines)
          )
        );
        return (
          stable(latinNoop) === stable(perBlockLatin)
        );
      }),
      { numRuns: 2000 }
    );
  });

  // The one pin comparing the doc-merge PIPELINE
  // against the FROZEN core directly — and it shows
  // something, not just imports the name: for a
  // bind-shaped fusion, the frozen core alone drops
  // the dying anchor's authored gap ("the remaining
  // fused anchors' owned gaps DIE in frozen code");
  // the pipeline's fusion rescue is the only reason
  // `mergeLatinBlock` differs. This is the SAME
  // fixture the discrimination lock uses, viewed
  // from the other side (frozen core vs. pipeline,
  // not rescue-present vs. rescue-stubbed).
  it("mergeBlock cross-check: the frozen core alone " +
     "drops what the pipeline's fusion rescue " +
     "restores", () => {
    const prev: Block = {
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "word", word: "pona" },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: " ", latin: " " },
        { sp: "\n", latin: "", spAuthored: true },
      ],
      spans: [],
    };
    const parsed = parseLatin([
      { type: "text", text: "toki.pona" },
    ]);
    const bare = mergeBlock(prev, parsed, "latin");
    const piped = mergeLatinBlock(prev, parsed);
    // the frozen core alone: gap count matches the
    // fused anchor, but the authored "\n" is gone
    expect(bare.gaps).toHaveLength(2);
    expect(bare.gaps[1].sp).not.toContain("\n");
    // the pipeline: the same frozen pairing, PLUS the
    // rescued authored byte
    expect(piped.gaps[1].sp).toBe(" \n");
    expect(piped.gaps[1].spAuthored).toBe(true);
  });
});

describe("mergeStructural — equal-count fast " +
         "path", () => {
  // (i) THE CROSS-BLOCK STRANDING COUNTEREXAMPLE.
  // Two blocks, equal counts, pure Latin no-op.
  //
  // MECHANISM (corrected on closer analysis): the
  // root
  // cause is that the merge is a GLOBAL computation
  // over the whole stream — LCS prefix/suffix
  // trimming, the region partition it induces, and
  // re-absorption's occurrence search all shift when
  // the concatenation changes. Flattening n
  // paragraphs into one stream therefore lets one
  // paragraph's content change how ANOTHER
  // paragraph's anchors are matched.
  //
  // DUPLICATE rendered keys across the boundary (the
  // shape pinned below) are one SUFFICIENT trigger,
  // not the mechanism: a second divergence exists
  // with NO shared key between the
  // blocks (block 0 plus a "?!" verbatim), which
  // duplicate-key reasoning cannot explain. The fast
  // path subsumes BOTH triggers by construction,
  // because it never concatenates in the first
  // place.
  //
  // What the flat path did on THIS shape (measured
  // via a local reconstruction of the pre-fix code):
  // the flat latin stream is "toki toki" + SENTINEL
  // + "toki ", block 0's second anchor lost its
  // pairing across the boundary, and the latin parse
  // won its KIND — glyphing an un-glyphed verbatim,
  // so SP "toki toki" became "toki" + GLYPH. SP byte
  // loss on a no-op: exactly what the
  // anchor-conservation law forbids.
  it("the cross-block stranding counterexample is " +
     "SP-identical (and fully identical) now", () => {
    const blocks: Block[] = [
      {
        anchors: [
          { kind: "verbatim", text: "toki " },
          { kind: "verbatim", text: "toki" },
        ],
        gaps: [g("", ""), g("", ""), g("", "")],
        spans: [],
      },
      {
        anchors: [{ kind: "verbatim", text: "toki " }],
        gaps: [g("", ""), g("", "")],
        spans: [],
      },
    ];
    const out = mergeStructural(
      blocks,
      blocks.map((b) =>
        parseLatin(renderLatin(b).inlines)
      ),
      "latin"
    );
    expect(out).toHaveLength(2);
    expect(
      stable(out.map((b) => renderSp(b).inlines))
    ).toBe(
      stable(blocks.map((b) => renderSp(b).inlines))
    );
    expect(stable(out)).toBe(stable(blocks));
  });

  // (ii) the fast path IS the per-block path.
  //
  // `ltPer` must compare against the pipeline-aware
  // `mergeLatinBlock`, not the BARE `mergeBlock`
  // (frozen merge.ts core only): `mergeStructural`'s
  // flat latin path — like `mergeLatinBlock` —
  // always runs the full doc-merge PIPELINE per
  // block (provenance reattachment, the fusion
  // rescue, SP generation), and the difference
  // shows up as a `latinAuthored` provenance flag
  // the pipeline sets and the bare core does not.
  // `mergeLatinBlock` is the correct per-block
  // reference for what this law actually claims
  // ("the fast path IS the per-block path" — i.e.
  // the SAME pipeline run per block vs. flattened),
  // matching how the SP side already used the
  // pipeline-aware `mergeSpBlock`.
  it("equal-count structural merge is byte-" +
     "identical to merging block by block", () => {
    const arbMulti = fc.array(arbBlock, {
      minLength: 2,
      maxLength: 3,
    });
    fc.assert(
      fc.property(arbMulti, (blocks) => {
        const sp = mergeStructural(
          blocks,
          blocks.map(spParse),
          "sp"
        );
        const spPer = blocks.map((b) =>
          mergeSpBlock(b, spParse(b))
        );
        const lt = mergeStructural(
          blocks,
          blocks.map((b) =>
            parseLatin(renderLatin(b).inlines)
          ),
          "latin"
        );
        const ltPer = blocks.map((b) =>
          mergeLatinBlock(
            b,
            parseLatin(renderLatin(b).inlines)
          )
        );
        return (
          stable(sp) === stable(spPer) &&
          stable(lt) === stable(ltPer)
        );
      }),
      { numRuns: 2000 }
    );
  });

  // Coverage hole closed: every test passed when
  // the fast path's sp branch was mutated to a raw
  // mergeBlockDetailed(...).block — i.e. with the
  // Enter default and the separation default
  // DROPPED on every multi-paragraph transaction.
  // Nothing else in the suite exercises the editor
  // semantics through mergeStructural: the no-op
  // laws add no "\n" and mint no letter-adjacency,
  // and the single-block unit tests call
  // mergeSpBlock directly.
  //
  // This is the discriminating case: two paragraphs
  // (equal count -> fast path) where block 1 gains
  // an anchor AND a fresh "\n". Both defaults must
  // fire inside the fast path.
  //  - gaps[2] is owned by the INSERTED anchor
  //    (moku): its sp gained one "\n" that no prev
  //    gap carried, so the Enter default appends
  //    "\n" to its latin. The creation default for
  //    a LAST gap is "", so the result is exactly
  //    "\n" (the mutant leaves latin "").
  //  - gaps[1] sits between two letter-rendering
  //    anchors with empty latin, so the separation
  //    default fills " " (the mutant leaves "").
  it("fast path applies the Enter and " +
     "separation defaults", () => {
    const prev = [
      block([word("lipu")], [g("", ""), g("", "")]),
      block([word("toki")], [g("", ""), g("", "")]),
    ];
    const parsed = [
      spParse(prev[0]),
      spParse(
        block(
          [word("toki"), word("moku")],
          [g("", ""), g(" ", ""), g("\n", "")]
        )
      ),
    ];
    const out = mergeStructural(prev, parsed, "sp");
    expect(out).toHaveLength(2);
    // Enter default: the inserted anchor's owned
    // gap
    expect(out[1].gaps[2]).toEqual({
      sp: "\n",
      latin: "\n",
    });
    // separation default: the shared gap of two
    // letter neighbours
    expect(out[1].gaps[1]).toEqual({
      sp: " ",
      latin: " ",
    });
    // block 0 is untouched
    expect(stable(out[0])).toBe(stable(prev[0]));
  });

  // (iii) guard against the fast path swallowing the
  // count-changing cases: the flat machinery must
  // still run for splits and joins. (The SPLIT /
  // JOIN describes below are the behavioral pins;
  // this one pins the ROUTING itself, so a future
  // "simplification" that always takes the fast path
  // fails here rather than silently dropping
  // sentinel semantics.)
  it("count-changing merges still route through " +
     "the flat path (join rescues, split routes)",
     () => {
    // 2 -> 1 : only the flat path rescues the dead
    // sentinel's owned latin
    const joinPrev = [
      block([word("toki")], [g("", ""), g("", ", ")]),
      block([word("pona")], [g("", "! "), g("", "")]),
    ];
    const joined = mergeStructural(
      joinPrev,
      [
        spParse(
          block(
            [word("toki"), word("pona")],
            [g("", ""), g("", ""), g("", "")]
          )
        ),
      ],
      "sp"
    );
    expect(joined).toHaveLength(1);
    expect(joined[0].gaps[1].latin).toBe(", ! ");
    // 1 -> 2 : only the flat path divides the latin
    const splitPrev = [
      block(
        [word("toki"), word("moku")],
        [g("", ""), g("\n\n", ". \n\n"), g("", "")]
      ),
    ];
    const split = mergeStructural(
      splitPrev,
      [
        spParse(block([word("toki")], [
          g("", ""),
          g("", ""),
        ])),
        spParse(block([word("moku")], [
          g("", ""),
          g("", ""),
        ])),
      ],
      "sp"
    );
    expect(split).toHaveLength(2);
    expect(split[0].gaps[1].latin).toBe(". ");
  });
});

/**
 * The equal-count LATIN arm of mergeStructural must
 * call mergeLatinBlock, not bare mergeBlockDetailed:
 * mergeLatinBlock is where the two editor-layer
 * post-passes live — the marked-verbatim SP-side
 * separation default and the span KIND-CHANGE rule —
 * and BOTH were otherwise only pinned through direct
 * mergeLatinBlock calls. Swapping that one arm back
 * to `mergeBlockDetailed(...).block` left the whole
 * suite green, so a refactor could have stripped
 * both passes from the reshape path (paste over a
 * multi-paragraph selection, drag reshapes) in
 * silence.
 *
 * These two drive the SAME shapes THROUGH
 * mergeStructural with EQUAL block counts, which is
 * the fast path by construction (doc-merge.ts's
 * `prevBlocks.length === parsedSides.length`
 * branch). Each carries an untouched second block,
 * so they also hold the per-block independence the
 * fast path exists for.
 */
describe("the equal-count LATIN arm runs the " +
         "mergeLatinBlock post-passes", () => {
  const V = (text: string): Anchor => ({
    kind: "verbatim",
    text,
    marked: true,
  });
  const other: Block = block([word("moku")], [
    g("", ""),
    g("", ""),
  ]);
  const lat = (b: Block): ParsedSide =>
    parseLatin(renderLatin(b).inlines);

  it("deleting a WORD between two marked " +
     "verbatims mints an adjacency, and the SP-side " +
     "separation default fires ON THIS PATH — the " +
     "follow-up SP no-op keeps both anchors (no " +
     "\"xqax\" fusion)", () => {
    const prev: Block = {
      anchors: [V("xq"), word("toki"), V("ax")],
      gaps: [
        g("", ""),
        g("", " "),
        g("", " "),
        g("", ""),
      ],
      spans: [],
    };
    expect(renderLatin(prev).text).toBe("xq toki ax");
    // the Latin delete of "toki" only, both flanking
    // spaces kept
    const out = mergeStructural(
      [prev, other],
      [
        parseLatin([{ type: "text", text: "xq  ax" }]),
        lat(other),
      ],
      "latin"
    );
    expect(out).toHaveLength(2);
    expect(out[0].anchors).toEqual([V("xq"), V("ax")]);
    // THE POST-PASS: an empty gap.sp here would let
    // renderSp coalesce the two marked runs into one
    // inline node
    expect(out[0].gaps[1]).toEqual({
      sp: " ",
      latin: "  ",
    });
    // ...which is what makes the SP round-trip a TRUE
    // no-op: without the default this fuses to a
    // single verbatim "xqax" and the anchor boundary
    // is gone
    const two = mergeStructural(
      out,
      out.map(spParse),
      "sp"
    );
    expect(stable(two)).toBe(stable(out));
    // the untouched block stayed byte-identical
    expect(stable(out[1])).toBe(stable(other));
  });

  it("a NAMELESS cartouche's covered verbatim " +
     "typed over as a WORD kills the span ON THIS " +
     "PATH — no chip", () => {
    const prev: Block = {
      anchors: [V("-")],
      gaps: [g("", ""), g("", "")],
      spans: [
        cart(0, 0),
      ],
    };
    // a nameless cartouche does not atomize:
    // its covered "-" is ordinary editable Latin
    expect(renderLatin(prev).text).toBe("-");
    const out = mergeStructural(
      [prev, other],
      [
        parseLatin([{ type: "text", text: "mi" }]),
        lat(other),
      ],
      "latin"
    );
    expect(out).toHaveLength(2);
    expect(out[0].anchors).toEqual([
      { kind: "word", word: "mi" },
    ]);
    // THE POST-PASS: the span does not follow a
    // kind-changing replacement pairing (licensed
    // span death) — carrying it would re-atomize
    // the typed word into a chip
    expect(out[0].spans).toEqual([]);
    expect(renderLatin(out[0]).text).toBe("mi");
    expect(checkBlock(out[0])).toEqual([]);
    expect(stable(out[1])).toBe(stable(other));
  });
});

/**
 * ADJACENCY-FRESHNESS SCOPING (found in live
 * acceptance testing):
 * the adjacency-freshness skip must test the PREV
 * flanks' KINDS, not positions alone. A replacement
 * pairing can turn a WORD flank into a marked
 * verbatim IN PLACE ("n" is a dictionary word, so
 * typing "not" passes through a word-anchor state),
 * which MINTS the SP-degenerate verbatim-verbatim
 * shape at an unchanged position — exactly what the
 * marked-verbatim default says a Latin merge cannot
 * leave behind. The positions-only skip concluded
 * "stale" and never applied the default, so the SP
 * pane rendered "isnot" fused; every later keystroke
 * kept the pair matched-and-adjacent, making the
 * swallow permanent. The skip now ALSO requires both
 * prev flanks to have been marked verbatims already —
 * the only shape where the carried gap.sp "" can be a
 * deliberate user byte state the default must
 * respect.
 */
describe("marked-verbatim default scoping — " +
         "kind-change mint", () => {
  const V = (text: string): Anchor => ({
    kind: "verbatim",
    text,
    marked: true,
  });
  const latText = (text: string): ParsedSide =>
    parseLatin([{ type: "text", text }]);
  const EMPTY: Block = {
    anchors: [],
    gaps: [{ sp: "", latin: "" }],
    spans: [],
  };

  it("typing \"kijetesantakalu is not real\" " +
     "keystroke-by-keystroke keeps the SP space " +
     "between \"is\" and \"not\" (the \"n\" " +
     "word-anchor interlude must not suppress the " +
     "default)", () => {
    const phrase = "kijetesantakalu is not real";
    let b = EMPTY;
    for (let i = 1; i <= phrase.length; i++) {
      b = mergeLatinBlock(
        b,
        latText(phrase.slice(0, i))
      );
    }
    expect(
      b.anchors.map((a) =>
        a.kind === "word" ? a.word : a.text
      )
    ).toEqual([
      "kijetesantakalu", "is", "not", "real",
    ]);
    expect(b.gaps.map((gp) => gp.sp)).toEqual(
      ["", "", " ", " ", ""]
    );
    // the SP-rendered bytes keep the space — no
    // "isnot" coalescing — and incremental typing
    // agrees with the one-shot paste parse
    expect(
      renderSp(b).text.endsWith("is not real")
    ).toBe(true);
    expect(renderSp(b).text).toBe(
      renderSp(
        mergeLatinBlock(EMPTY, latText(phrase))
      ).text
    );
  });

  it("minimal mint: a WORD flank replacement-paired " +
     "into a verbatim (\"n\" -> \"no\") gets the " +
     "SP-side default despite stable positions", () => {
    const prev: Block = {
      anchors: [V("xq"), word("n")],
      gaps: [g("", ""), g("", " "), g("", "")],
      spans: [],
    };
    const out = mergeLatinBlock(
      prev,
      latText("xq no")
    );
    expect(out.anchors).toEqual([V("xq"), V("no")]);
    expect(out.gaps[1].sp).toBe(" ");
  });

  it("the skip still fires when both prev flanks " +
     "were ALREADY marked verbatims: a user-deleted " +
     "SP space between two verbatims survives a " +
     "Latin no-op (no default spam)", () => {
    const prev: Block = {
      anchors: [V("xq"), V("ax")],
      gaps: [g("", ""), g("", " "), g("", "")],
      spans: [],
    };
    const out = mergeLatinBlock(
      prev,
      parseLatin(renderLatin(prev).inlines)
    );
    expect(out.anchors).toEqual([V("xq"), V("ax")]);
    expect(out.gaps[1].sp).toBe("");
  });
});

describe("mergeSpBlock — the Enter default", () => {
  it("a new '\\n' in an owned gap appends '\\n' " +
     "to that gap's latin: '. ' becomes '. \\n'", () => {
    const prev = block(
      [word("toki"), word("pona")],
      [g("", ""), g(" ", ". "), g("", "")]
    );
    // the edit inserts a hardBreak after the space
    const next = spParse(
      block(
        [word("toki"), word("pona")],
        [g("", ""), g(" \n", ""), g("", "")]
      )
    );
    const out = mergeSpBlock(prev, next);
    expect(out.gaps[1]).toEqual({
      sp: " \n",
      latin: ". \n",
      spAuthored: true,
    });
  });

  it("break-for-break no-op adds nothing", () => {
    const prev = block(
      [word("toki"), word("pona")],
      [g("", ""), g("\n", "\n"), g("", "")]
    );
    const out = mergeSpBlock(prev, spParse(prev));
    expect(out.gaps[1]).toEqual({
      sp: "\n",
      latin: "\n",
    });
  });

  it("SP line join removes the latin '\\n' — the " +
     "decrease branch empties the gap, then the " +
     "separation default " +
     "(chained in mergeSpBlock) restores the " +
     "mandatory letter-fusion space; the '\\n' does " +
     "NOT survive (an append-only reading " +
     "would leave the " +
     "ratcheting companion behind)", () => {
    const prev = block(
      [word("toki"), word("pona")],
      [g("", ""), g("\n", "\n"), g("", "")]
    );
    const next = spParse(
      block(
        [word("toki"), word("pona")],
        [g("", ""), g(" ", ""), g("", "")]
      )
    );
    const out = mergeSpBlock(prev, next);
    expect(out.gaps[1]).toEqual({
      sp: " ",
      latin: " ",
    });
  });

  it("a pasted word+break gets '\\n' without the " +
     "word-insertion space residue", () => {
    const prev = block([word("toki")], [
      g("", ""),
      g("", ""),
    ]);
    const next = spParse(
      block(
        [word("toki"), word("moku")],
        [g("", ""), g("\n", ""), g("", "")]
      )
    );
    const out = mergeSpBlock(prev, next);
    // moku is the insertion; toki's owned gap is
    // the one that gained the "\n"
    expect(out.gaps[1]).toEqual({
      sp: "\n",
      latin: "\n",
      spAuthored: true,
    });
  });
});

describe("mergeSpBlock — the newline delta rule " +
         "(newline ratchet regression)", () => {
  // Reproduction: Enter/delete cycles at
  // the same break used to grow gap.latin without
  // bound (" " -> " \n" -> " \n\n" -> " \n\n\n", ...)
  // because an append-only default only ever
  // appends on an sp "\n" increase and never takes
  // one away on the matching decrease. The delta
  // rule removes exactly the newlines the sp delta
  // says to remove, so the cycle is stable.
  it("Enter/delete/Enter/delete never exceeds one " +
     "latin '\\n' and ends at zero, with the " +
     "non-newline latin content (' ') preserved " +
     "throughout", () => {
    const withSp = (sp: string) =>
      spParse(
        block(
          [word("toki"), word("pona")],
          [g("", ""), g(sp, ""), g("", "")]
        )
      );

    let doc = block(
      [word("toki"), word("pona")],
      [g("", ""), g(" ", " "), g("", "")]
    );
    // sanity: the separation-default space is the
    // starting state
    expect(doc.gaps[1]).toEqual(g(" ", " "));

    for (let cycle = 0; cycle < 4; cycle++) {
      // Enter: sp " " -> "\n"
      doc = mergeSpBlock(doc, withSp("\n"));
      expect(countNl(doc.gaps[1].latin)).toBe(1);
      expect(
        doc.gaps[1].latin.replace(/\n/g, "")
      ).toBe(" ");

      // delete: sp "\n" -> " "
      doc = mergeSpBlock(doc, withSp(" "));
      expect(countNl(doc.gaps[1].latin)).toBe(0);
      expect(doc.gaps[1].latin).toBe(" ");
    }
  });

  it("non-parity: deleting the one sp '\\n' removes " +
     "exactly ONE trailing-most latin '\\n', leaving " +
     "other latin '\\n' runs and content untouched " +
     "(latin 'x\\n\\ny' -> 'x\\ny')", () => {
    const prev = block(
      [word("toki"), word("pona")],
      [g("", ""), g("\n", "x\n\ny"), g("", "")]
    );
    const next = spParse(
      block(
        [word("toki"), word("pona")],
        [g("", ""), g("", ""), g("", "")]
      )
    );
    // The fixture is
    // genuinely letter-adjacent ("toki"..."x\ny"..
    // "pona", both boundaries fuse), so
    // mergeSpBlock's normalizeLetterishLatin pass
    // separates it too. The
    // delta behavior this test is actually
    // about (one trailing latin "\n" removed) still
    // holds -- only the boundary bytes changed.
    const out = mergeSpBlock(prev, next);
    expect(out.gaps[1]).toEqual(g("", " x\ny "));
  });

  it("non-parity: a latin side with NO '\\n' is " +
     "untouched when the sp break is deleted (never " +
     "forces parity)", () => {
    const prev = block(
      [word("toki"), word("pona")],
      [g("", ""), g("\n", "hello"), g("", "")]
    );
    const next = spParse(
      block(
        [word("toki"), word("pona")],
        [g("", ""), g("", ""), g("", "")]
      )
    );
    // same reason as
    // above -- "hello" fuses on both boundaries.
    const out = mergeSpBlock(prev, next);
    expect(out.gaps[1]).toEqual(g("", " hello "));
  });
});

describe("mergeSpBlock — the separation " +
         "default", () => {
  it("linear typing 'toki pona' yields latin ' ' " +
     "in the shared gap", () => {
    const prev = block([word("toki")], [
      g("", ""),
      g("", ""),
    ]);
    const next = spParse(
      block(
        [word("toki"), word("pona")],
        [g("", ""), g(" ", ""), g("", "")]
      )
    );
    const out = mergeSpBlock(prev, next);
    expect(out.gaps[1]).toEqual({
      sp: " ",
      latin: " ",
    });
    // and the shape is now Latin-no-op safe:
    const noop = mergeStructural(
      [out],
      [parseLatin(renderLatin(out).inlines)],
      "latin"
    );
    expect(stable(noop)).toBe(stable([out]));
  });

  it("does not touch non-letter adjacency " +
     "(word + '?!' verbatim)", () => {
    const b: Block = {
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "verbatim", text: "?!", marked: true },
      ],
      gaps: [g("", ""), g(" ", ""), g("", "")],
      spans: [],
    };
    expect(
      applySeparationDefaults(b).gaps[1].latin
    ).toBe("");
  });

  // The predicate's two failure directions are
  // pinned in the OWNING module (the app's import
  // path uses this function too).
  it("a LONG span's interior gap IS separated " +
     "(long has no Latin form), while a CARTOUCHE-" +
     "covered gap is NOT (name atoms are opaque)",
     () => {
    // too-wide direction: an any-structural-span
    // predicate exempted this, leaving the lethal
    // shape — under a Latin no-op the two anchors'
    // letter runs fuse into ONE verbatim "tokipona",
    // destroying an anchor and its owned gap.
    const long: Block = {
      anchors: [word("toki"), word("pona")],
      gaps: [g("", ""), g("", ""), g("", "")],
      spans: [
        span("long", 0, 1),
      ],
    };
    expect(
      applySeparationDefaults(long).gaps[1].latin
    ).toBe(" ");

    // too-narrow direction: a cartouche renders as
    // one opaque name atom, so nothing can fuse and
    // a " " would be a spurious byte.
    const covered: Block = {
      anchors: [word("toki"), word("pona")],
      gaps: [g("", ""), g("", ""), g("", "")],
      spans: [cart(0, 1)],
    };
    expect(
      applySeparationDefaults(covered).gaps[1].latin
    ).toBe("");
  });

  it("too-wide, second half: a NAMELESS " +
     "cartouche does not atomize, so its flank IS " +
     "separated", () => {
    // render-latin only atomizes a
    // cartouche that projects a name. A cartouche
    // over a lone marked verbatim renders no name,
    // so "toki" and "xq" are two ordinary letter
    // runs — exempting the gap leaves the same
    // lethal shape the LONG case above pins
    // (verified: without the fix the Latin no-op
    // below collapses them into one verbatim
    // "tokixq" and the cartouche dies).
    const b: Block = {
      anchors: [
        word("toki"),
        { kind: "verbatim", text: "xq", marked: true },
      ],
      gaps: [
        g("", ""),
        g(CARTOUCHE_START, ""),
        g(CARTOUCHE_END, ""),
      ],
      spans: [
        cart(1, 1),
      ],
    };
    const sep = applySeparationDefaults(b);
    expect(sep.gaps[1].latin).toBe(" ");
    expect(renderLatin(sep).text).toBe("toki xq");
    const noop = mergeStructural(
      [sep],
      [parseLatin(renderLatin(sep).inlines)],
      "latin"
    );
    expect(stable(noop)).toBe(stable([sep]));
  });
});

describe("mergeStructural — SPLIT routing", () => {
  it("double-Enter split consumes both latin " +
     "'\\n's and routes '. ' left", () => {
    const prev = [
      block(
        [word("toki"), word("moku")],
        [g("", ""), g("\n\n", ". \n\n"), g("", "")]
      ),
    ];
    // the PM normalizer produced two paragraphs
    const parsed = [
      spParse(block([word("toki")], [
        g("", ""),
        g("", ""),
      ])),
      spParse(block([word("moku")], [
        g("", ""),
        g("", ""),
      ])),
    ];
    const out = mergeStructural(prev, parsed, "sp");
    expect(out).toHaveLength(2);
    expect(out[0].gaps).toEqual([
      g("", ""),
      g("", ". "),
    ]);
    expect(out[1].gaps).toEqual([
      g("", ""),
      g("", ""),
    ]);
  });

  it("latin 'one\\ntwo' divides at the interior " +
     "run: left 'one', right 'two'", () => {
    const prev = [
      block(
        [word("toki"), word("moku")],
        [g("", ""), g("\n\n", "one\ntwo"), g("", "")]
      ),
    ];
    const parsed = [
      spParse(block([word("toki")], [
        g("", ""),
        g("", ""),
      ])),
      spParse(block([word("moku")], [
        g("", ""),
        g("", ""),
      ])),
    ];
    // "toki"|"one" and
    // "two"|"moku" are both genuinely letter-adjacent
    // seams, so mergeStructural's sp arm runs
    // normalizeLetterishLatin too, same composition
    // as mergeSpBlock. The split-routing behavior
    // this test is actually about (the interior run
    // divides "one"/"two" at the right point) still
    // holds -- only the boundary bytes changed.
    const out = mergeStructural(prev, parsed, "sp");
    expect(out[0].gaps[1].latin).toBe(" one");
    expect(out[1].gaps[0].latin).toBe("two ");
  });

  it("no '\\n' in the carried latin: everything " +
     "stays left", () => {
    const prev = [
      block(
        [word("toki"), word("moku")],
        [g("", ""), g("\n\n", ", "), g("", "")]
      ),
    ];
    const parsed = [
      spParse(block([word("toki")], [
        g("", ""),
        g("", ""),
      ])),
      spParse(block([word("moku")], [
        g("", ""),
        g("", ""),
      ])),
    ];
    const out = mergeStructural(prev, parsed, "sp");
    expect(out[0].gaps[1].latin).toBe(", ");
    expect(out[1].gaps[0].latin).toBe("");
  });
});

// Two corrections to routeSplitGaps, pinned HERE
// (in the module's own tests) so the shipped
// semantics are described where the code lives —
// not only through the editor's tests.
describe("mergeStructural — SPLIT routing at " +
         "sentinel RUNS (two corrections)", () => {
  // CORRECTION (a): routing follows the consumed
  // run, not sentinel identity. Enter-Enter at a
  // paragraph END creates an EMPTY paragraph, so the
  // output holds two ADJACENT sentinels against one
  // prev sentinel; the LCS is free to call either the
  // insertion and picks the later one. Keying the
  // division on `inserted` alone (the
  // mutant `if (!inserted) return;`) leaves the
  // consumed run's latin in the split block.
  it("Enter-Enter in a MULTI-paragraph doc consumes " +
     "the run at the matched member of an adjacent " +
     "sentinel run", () => {
    const prev = [
      block([word("jan")], [g("", ""), g("", "")]),
      block([word("toki")], [
        g("", ""),
        g("\n\n", "\n\n"),
      ]),
      block([word("moku")], [g("", ""), g("", "")]),
    ];
    // the PM normalizer deleted the "\n\n" run and
    // split: 3 paragraphs become 4, the new one empty
    const parsed = [
      spParse(block([word("jan")], [
        g("", ""),
        g("", ""),
      ])),
      spParse(block([word("toki")], [
        g("", ""),
        g("", ""),
      ])),
      spParse(block([], [g("", "")])),
      spParse(block([word("moku")], [
        g("", ""),
        g("", ""),
      ])),
    ];
    const out = mergeStructural(prev, parsed, "sp");
    expect(out).toHaveLength(4);
    // BOTH runs consumed, on both sides of the seam
    expect(out[1].gaps[1].latin).toBe("");
    expect(out[2].gaps[0].latin).toBe("");
    // the untouched neighbours are untouched
    expect(out[0].gaps).toEqual([g("", ""), g("", "")]);
    expect(out[3].gaps).toEqual([g("", ""), g("", "")]);
  });

  // ...and the boundary condition on that widening:
  // a matched sentinel whose run holds
  // NO insertion is a boundary that merely SURVIVED,
  // so it must not divide even when the newline count
  // in the gap to its left shrank. Compound
  // transaction: block 0 loses its trailing break AND
  // blocks 1+2 join, in one count-changing step.
  //
  // The newline delta rule ALSO trims one latin
  // "\n" off this same gap (applyEnterDefaults'
  // decrease branch), so latin "\n" (a bare trailing
  // run with nothing else in it) is no longer a safe
  // fixture: splitLatin("\n") and the delta-decrease
  // trim both collapse it to "" by coincidence,
  // which would let a real routeSplitGaps regression
  // hide behind the correct trim. latin "\n\nz" keeps
  // the two mechanisms distinguishable: a wrongly
  // dividing boundary moves the post-run "z" into
  // block 1's leading gap (splitLatin("\n\nz") =
  // {left: "", right: "z"}); the correct decrease-
  // rule trim removes only the one trailing-most "\n"
  // and leaves "z" exactly where it was ("\nz"),
  // touching neither block 1 nor the earlier "\n".
  it("a SURVIVING boundary does not divide when an " +
     "unrelated edit shrinks the run in its left " +
     "gap (the newline delta rule trims the gap " +
     "directly; nothing may leak across the " +
     "boundary)", () => {
    const prev = [
      block([word("toki")], [
        g("", ""),
        g("\n", "\n\nz"),
      ]),
      block([word("moku")], [g("", ""), g("", "")]),
      block([word("jan")], [g("", ""), g("", "")]),
    ];
    const parsed = [
      // block 0's break is gone (sp shrank "\n" -> "")
      spParse(block([word("toki")], [
        g("", ""),
        g("", ""),
      ])),
      // blocks 1 and 2 joined
      spParse(
        block([word("moku"), word("jan")], [
          g("", ""),
          g("", ""),
          g("", ""),
        ])
      ),
    ];
    const out = mergeStructural(prev, parsed, "sp");
    expect(out).toHaveLength(2);
    // Newline delta: the sp "\n" count shrank
    // by 1, so exactly one trailing-most latin "\n"
    // is trimmed; "z" and the earlier "\n" are
    // untouched. Nothing split at block 0's boundary
    // (requirement 1 fails: the surviving sentinel's
    // run holds no insertion), so nothing here was
    // divided across it either.
    expect(out[0].gaps[1]).toEqual(g("", "\nz"));
    // ...and confirms nothing leaked across the
    // boundary via a wrongly-dividing routeSplitGaps.
    expect(out[1].gaps[0]).toEqual(g("", ""));
  });

  it("control: the same shrink WITHOUT a count " +
     "change (equal-count fast path) applies the " +
     "same newline-delta trim — the two " +
     "paths agree", () => {
    const prev = [
      block([word("toki")], [
        g("", ""),
        g("\n", "\n\nz"),
      ]),
      block([word("moku")], [g("", ""), g("", "")]),
      block([word("jan")], [g("", ""), g("", "")]),
    ];
    const parsed = [
      spParse(block([word("toki")], [
        g("", ""),
        g("", ""),
      ])),
      spParse(block([word("moku")], [
        g("", ""),
        g("", ""),
      ])),
      spParse(block([word("jan")], [
        g("", ""),
        g("", ""),
      ])),
    ];
    const out = mergeStructural(prev, parsed, "sp");
    expect(out).toHaveLength(3);
    expect(out[0].gaps[1]).toEqual(g("", "\nz"));
  });

  // ...and the OTHER half of the guard: requirement
  // 2 — the newline count in
  // the gap to the sentinel's left must have SHRANK.
  // Requirement 1 alone is not enough: an
  // Enter-Enter at the START of the NEXT paragraph
  // puts an insertion in the same sentinel run, so
  // requirement 1 holds at a boundary where nothing
  // was consumed. Without requirement 2 the
  // surviving boundary divides and splitLatin eats
  // paragraph 0's trailing latin "\n" (the newline
  // an SP line join deliberately leaves behind,
  // destroyed by an edit in another paragraph).
  // Discrimination verified against the mutant that
  // drops the countNl comparison from
  // routeSplitGaps: this test FAILS there, the rest
  // of the suite does not.
  it("a SURVIVING boundary does not divide when the " +
     "run's insertion is an Enter-Enter in the NEXT " +
     "paragraph (guard requirement 2)", () => {
    const prev = [
      block([word("toki")], [
        g("", ""),
        // no sp break: the latin "\n" is the
        // survivor of an earlier line join
        g("", "\n"),
      ]),
      block([word("moku")], [g("", ""), g("", "")]),
    ];
    // Enter-Enter at the very start of paragraph 1
    // -> an empty
    // paragraph appears between them
    const parsed = [
      spParse(block([word("toki")], [
        g("", ""),
        g("", ""),
      ])),
      spParse(block([], [g("", "")])),
      spParse(block([word("moku")], [
        g("", ""),
        g("", ""),
      ])),
    ];
    const out = mergeStructural(prev, parsed, "sp");
    expect(out).toHaveLength(3);
    // paragraph 0's boundary merely survived: its
    // latin "\n" is untouched
    expect(out[0].gaps[1]).toEqual(g("", "\n"));
  });

  // CORRECTION (b): no word-insertion default at a
  // paragraph edge. merge.ts's creation default is
  // "space unless this anchor is LAST" — block-local
  // by design; in the flat stream a paragraph's last
  // anchor is not stream-last, so without this the
  // flat path disagreed with the per-block path (and
  // the Latin copy channel's idempotence law failed).
  it("a NEWLY created anchor at a paragraph edge " +
     "gets the end-of-block creation default, not " +
     "the word-insertion ' '", () => {
    const prev = [block([], [g("", "")])];
    const parsed = [
      spParse(block([word("toki")], [
        g("", ""),
        g("", ""),
      ])),
      spParse(block([word("moku")], [
        g("", ""),
        g("", ""),
      ])),
    ];
    const out = mergeStructural(prev, parsed, "sp");
    expect(out).toHaveLength(2);
    // block-local agreement: merging the same parse
    // into an empty block on its own gives "" too
    expect(out[0].gaps[1].latin).toBe("");
    expect(
      mergeSpBlock(
        { anchors: [], gaps: [g("", "")], spans: [] },
        parsed[0]
      ).gaps[1].latin
    ).toBe("");
  });

  it("...and ONLY creation defaults: a prev-carried " +
     "latin ' ' in the gap left of a sentinel " +
     "survives", () => {
    const prev = [
      block([word("toki")], [g("", ""), g("", " ")]),
      block([word("moku")], [g("", ""), g("", "")]),
    ];
    // a split at the end of block 1: 2 -> 3, so the
    // flat path runs and block 0's boundary sentinel
    // sits directly right of the carried " "
    const parsed = [
      spParse(block([word("toki")], [
        g("", ""),
        g("", ""),
      ])),
      spParse(block([word("moku")], [
        g("", ""),
        g("", ""),
      ])),
      spParse(block([], [g("", "")])),
    ];
    const out = mergeStructural(prev, parsed, "sp");
    expect(out).toHaveLength(3);
    // "toki" came from prev, so its owned gap holds
    // CONTENT, not a creation default — clearing any
    // single-space gap left of a sentinel would eat
    // it silently.
    expect(out[0].gaps[1].latin).toBe(" ");
  });
});

describe("mergeStructural — JOIN rescue", () => {
  it("preserves the second block's leading-gap " +
     "latin (an accepted edge of the old editor, " +
     "FIXED)", () => {
    const prev = [
      block([word("toki")], [
        g("", ""),
        g("", ", "),
      ]),
      block([word("pona")], [
        g("", "! "),
        g("", ""),
      ]),
    ];
    const parsed = [
      spParse(
        block(
          [word("toki"), word("pona")],
          [g("", ""), g("", ""), g("", "")]
        )
      ),
    ];
    const out = mergeStructural(prev, parsed, "sp");
    expect(out).toHaveLength(1);
    expect(out[0].gaps[1].latin).toBe(", ! ");
  });

  // The dead sentinel's owned gap carries content
  // on BOTH sides; only the NON-edited side is
  // rescued — the edited (sp) side is
  // parse-authoritative and is already in the
  // joined doc, so rescuing it too would DOUBLE
  // those bytes. Asserting "appears exactly once"
  // (not merely "appears") is what kills that
  // mutation: verified by mutating rescueJoinedGaps
  // to append dead.sp on sp edits as well, which
  // makes this test fail with two IDEO_SPACEs while
  // every other test stays green.
  it("JOIN rescue does not duplicate the dead " +
     "sentinel's SP bytes (other-side-only)",
     () => {
    const prev = [
      block([word("toki")], [g("", ""), g("", ", ")]),
      {
        anchors: [word("pona")],
        gaps: [g(IDEO_SPACE, "! "), g("", "")],
        spans: [],
      } as Block,
    ];
    // the joined paragraph the user now has: the
    // IDEO_SPACE survives in the SP text, so the
    // fresh parse already contains it exactly once
    const joined = spParse({
      anchors: [word("toki"), word("pona")],
      gaps: [g("", ""), g(IDEO_SPACE, ""), g("", "")],
      spans: [],
    });
    const out = mergeStructural(prev, [joined], "sp");
    expect(out).toHaveLength(1);
    const allSp = out[0].gaps
      .map((x) => x.sp)
      .join("");
    expect(
      allSp.split(IDEO_SPACE).length - 1
    ).toBe(1);
    // and the latin side IS rescued (both pieces)
    expect(out[0].gaps[1]).toEqual({
      ...g(IDEO_SPACE, ", ! "),
      spAuthored: true,
    });
  });

  it("split -> join round-trips with no content " +
     "loss", () => {
    const start = [
      block(
        [word("toki"), word("moku")],
        [g("", ""), g(" ", ". "), g("", "")]
      ),
    ];
    // Enter-Enter (per-block path first)
    const withRun = [
      mergeSpBlock(
        start[0],
        spParse(
          block(
            [word("toki"), word("moku")],
            [g("", ""), g("\n\n", ""), g("", "")]
          )
        )
      ),
    ];
    expect(withRun[0].gaps[1].latin).toBe(". \n\n");
    // normalizer splits
    const split = mergeStructural(
      withRun,
      [
        spParse(block([word("toki")], [
          g("", ""),
          g("", ""),
        ])),
        spParse(block([word("moku")], [
          g("", ""),
          g("", ""),
        ])),
      ],
      "sp"
    );
    expect(split).toHaveLength(2);
    // user joins them back
    const joined = mergeStructural(
      split,
      [
        spParse(
          block(
            [word("toki"), word("moku")],
            [g("", ""), g("", ""), g("", "")]
          )
        ),
      ],
      "sp"
    );
    expect(joined).toHaveLength(1);
    expect(joined[0].gaps[1].latin).toBe(". ");
  });
});

describe("mergeStructural — promotion never " +
         "crosses a boundary", () => {
  it("'[' in block 1 and ']' in block 2 stay " +
     "transitional gap chars", () => {
    const prev = [
      {
        anchors: [word("toki")],
        gaps: [g("", ""), g(CARTOUCHE_START, "")],
        spans: [],
      } as Block,
      {
        anchors: [word("pona")],
        gaps: [g(CARTOUCHE_END, ""), g("", "")],
        spans: [],
      } as Block,
    ];
    const out = mergeStructural(
      prev,
      prev.map(spParse),
      "sp"
    );
    expect(stable(out)).toBe(stable(prev));
  });

  // Demotion restores the marker char at its
  // recorded offset — promotion and demotion are
  // both byte-preserving, with no trapped-char
  // canonicalization tier: this asserts the bytes
  // never move at all. No property covers the
  // cross-boundary shape: arbGapSp mints stray
  // CARTOUCHE_END only, so the generator can never
  // form a cross-boundary pair.
  //
  // Reachable ONLY through a count-CHANGING merge:
  // at equal counts the fast path never builds a
  // flat stream, so no cross-block pair can form in
  // the first place. This test therefore drives it
  // through a real SPLIT (1 Block -> 2 paragraphs,
  // the marker pair straddling the new boundary),
  // which is how a user reaches it: the "\n\n" run
  // between "[" and "]" is what the editor's
  // normalizer splits on.
  //
  // Derivation: the fresh parse's flat gaps are
  // ["", "[ ", " ]", ""] over anchors [toki,
  // SENTINEL, pona]; the pair promotes to a span
  // covering anchor 1 (the sentinel) with
  // startOffset 0 and endOffset 1 (post-splice
  // positions), removePairChars leaves ["", " ",
  // " ", ""], and demotion writes each char back at
  // its offset -> ["[ ", " ]"], the parse's bytes.
  it("a char TRAPPED between a cross-boundary " +
     "marker and the anchor STAYS PUT on a SPLIT " +
     "(demotion restores at the offset)",
     () => {
    const prev: Block[] = [
      {
        anchors: [word("toki"), word("pona")],
        gaps: [
          g("", ""),
          g(
            CARTOUCHE_START +
              " \n\n " +
              CARTOUCHE_END,
            ""
          ),
          g("", ""),
        ],
        spans: [],
      },
    ];
    // what the normalizer's two paragraphs parse to
    const parsed = [
      spParse({
        anchors: [word("toki")],
        gaps: [
          g("", ""),
          g(CARTOUCHE_START + " ", ""),
        ],
        spans: [],
      }),
      spParse({
        anchors: [word("pona")],
        gaps: [
          g(" " + CARTOUCHE_END, ""),
          g("", ""),
        ],
        spans: [],
      }),
    ];
    const once = mergeStructural(prev, parsed, "sp");
    expect(once).toHaveLength(2);
    expect(once.map((b) => b.gaps.map((x) => x.sp)))
      .toEqual([
        ["", CARTOUCHE_START + " "],
        [" " + CARTOUCHE_END, ""],
      ]);
    // no span survives the demotion
    expect(once.every((b) => b.spans.length === 0))
      .toBe(true);
    // the two paragraphs' SP bytes are exactly what
    // the parse asserted — nothing to converge
    expect(once.map(spTextOf)).toEqual(
      parsed.map(parsedSpText)
    );
    const twice = mergeStructural(
      once,
      once.map(spParse),
      "sp"
    );
    expect(stable(twice)).toBe(stable(once));
  });

  // DEMOTION vs a SURVIVING offset-bearing span
  // (a LIVE bug; this
  // combination had zero coverage). The straddler is
  // always the OUTER pair, so when its restored
  // marker lands at the same offset as a survivor's
  // marker the tie has to follow renderSp's own
  // order: the outer START goes first (a survivor's
  // start at that offset SHIFTS), the outer END goes
  // last (a survivor's end does not). Comparing both
  // with ">" swapped the two markers here —
  // "toki[( jan)" came back as "toki([ jan)".
  it("a demoted straddler restored at the same " +
     "offset as a surviving span's marker keeps " +
     "the nesting order", () => {
    // typed: "toki[( jan)" / "]" (the "]" is alone
    // in the second paragraph, so the cartouche pair
    // straddles the boundary and demotes; the long
    // pair is entirely inside paragraph 1 and
    // survives, with startOffset 0 in the same gap)
    const prev: Block[] = [
      {
        anchors: [word("toki"), word("jan")],
        gaps: [
          g("", ""),
          g(CARTOUCHE_START + LONG_START + " ", ""),
          g(LONG_END + "\n\n" + CARTOUCHE_END, ""),
        ],
        spans: [],
      },
    ];
    const parsed = [
      spParse({
        anchors: [word("toki"), word("jan")],
        gaps: [
          g("", ""),
          g(CARTOUCHE_START + LONG_START + " ", ""),
          g(LONG_END, ""),
        ],
        spans: [],
      }),
      spParse({
        anchors: [],
        gaps: [g(CARTOUCHE_END, "")],
        spans: [],
      }),
    ];
    const out = mergeStructural(prev, parsed, "sp");
    expect(out).toHaveLength(2);
    expect(out.map(spTextOf)).toEqual(
      parsed.map(parsedSpText)
    );
    // the long pair really did survive as a span
    // (otherwise this pins nothing)
    expect(out[0].spans).toEqual([
      {
        from: 1,
        to: 1,
        kind: "long",
        side: "both",
        // shifted past the restored "[" (2 units)
        startOffset: CARTOUCHE_START.length,
      },
    ]);
  });
});

/** SP text a Block projects (breaks encoded "\n"). */
function spTextOf(b: Block): string {
  return renderSp(b)
    .inlines.map((i) =>
      i.type === "break" ? "\n" : i.text
    )
    .join("");
}

/** SP text a PARSE asserts — the authority the merge
 *  is required to reproduce on the edited side. */
function parsedSpText(p: ParsedSide): string {
  let s = p.gaps[0];
  p.anchors.forEach((a, i) => {
    s += anchorSpText(a) + p.gaps[i + 1];
  });
  return s;
}

/** Cut a Block in two at gap k, dividing that gap's
 *  sp at `cut` — the shape the PM normalizer hands
 *  back after an empty-line split. */
function halves(
  b: Block,
  k: number,
  cut: number
): [Block, Block] {
  const gk = b.gaps[k];
  const at =
    gk.sp.length === 0 ? 0 : cut % (gk.sp.length + 1);
  return [
    {
      anchors: b.anchors.slice(0, k),
      gaps: [
        ...b.gaps.slice(0, k),
        { sp: gk.sp.slice(0, at), latin: "" },
      ],
      spans: b.spans.filter((s) => s.to < k),
    },
    {
      anchors: b.anchors.slice(k),
      gaps: [
        { sp: gk.sp.slice(at), latin: "" },
        ...b.gaps.slice(k + 1),
      ],
      spans: b.spans
        .filter((s) => s.from >= k)
        .map((s) => ({
          ...s,
          from: s.from - k,
          to: s.to - k,
        })),
    },
  ];
}

// THE FLAT PATH'S PROPERTY GATE.
// Every NO-OP law routes through the
// equal-count fast path, so the conservation law no
// longer reaches the flat merge and the "adds
// nothing over per-block" law is tautological on
// that domain.
// These two laws are what now hold the flat path to
// account, and they run on the only inputs that
// reach it: COUNT-CHANGING merges.
//
// The invariant is SP CONSERVATION: on the edited
// side the fresh parse is authoritative, so whatever
// the sentinel machinery does to gaps, spans and
// chunk boundaries, the SP text of the resulting
// document must equal the SP text the parse
// asserted — no byte invented, moved between blocks,
// duplicated by a rescue, or dropped by a demotion.
describe("mergeStructural — flat-path SP " +
         "conservation (count-changing merges)", () => {
  it("1 -> 2 (split): the document's SP text is " +
     "exactly the two parses' SP text", () => {
    fc.assert(
      fc.property(
        arbBlock,
        fc.nat(9),
        fc.nat(9),
        (b, kk, cut) => {
          const blk = b as Block;
          const k = kk % blk.gaps.length;
          const [l, r] = halves(blk, k, cut);
          const sides = [spParse(l), spParse(r)];
          const out = mergeStructural(
            [blk],
            sides,
            "sp"
          );
          return (
            out.length === 2 &&
            out.map(spTextOf).join("") ===
              sides.map(parsedSpText).join("")
          );
        }
      ),
      { numRuns: 2000 }
    );
  });

  it("2 -> 1 (join): the document's SP text is " +
     "exactly the single parse's SP text", () => {
    fc.assert(
      fc.property(arbBlock, arbBlock, (a, b) => {
        const x = a as Block;
        const y = b as Block;
        // the paragraph the user is left with after
        // deleting the boundary
        const joined: Block = {
          anchors: [...x.anchors, ...y.anchors],
          gaps: [
            ...x.gaps.slice(0, -1),
            {
              sp:
                x.gaps[x.gaps.length - 1].sp +
                y.gaps[0].sp,
              latin: "",
            },
            ...y.gaps.slice(1),
          ],
          spans: [],
        };
        const sides = [spParse(joined)];
        const out = mergeStructural(
          [x, y],
          sides,
          "sp"
        );
        return (
          out.length === 1 &&
          out.map(spTextOf).join("") ===
            sides.map(parsedSpText).join("")
        );
      }),
      { numRuns: 2000 }
    );
  });
});

// ...and its LATIN-SIDE twin. Nothing else held
// the flat path
// to account for the LATIN direction: the
// conservation laws
// above take the equal-count fast path. The invariant
// is the same one, on the other side: on the edited
// side the fresh parse is authoritative, so the Latin
// text of the resulting document must be exactly the
// Latin text the parse asserted.
//
// TWO THINGS THIS LAW GETS RIGHT ON PURPOSE:
//
//  (i) It compares RENDERED Latin text, taking the
//      expected value from the joined BLOCK — prev
//      spans carried in — not from the ParsedSide.
//      parseLatin passes name inlines through
//      opaquely and asserts NO spans, so a
//      ParsedSide-derived expectation cannot render a
//      cartouche back as its atom and false-fails on
//      every span-bearing block.
//  (ii) It is stated JOIN-DIRECTION-FIRST. The
//      split direction collides with the intended
//      Latin-split gesture (a Latin split consumes
//      the split gap's newline runs on BOTH sides),
//      whose consuming layer lives in the editor —
//      so a split-direction law here would be
//      asserting against machinery outside this
//      library. The join direction has no such
//      collision: the seam collapse is CARRIED-SIDE
//      ONLY, and on a Latin join the carried side
//      is SP.
function latinTextOf(b: Block): string {
  return renderLatin(b).text;
}

describe("mergeStructural — flat-path LATIN " +
         "conservation (join direction)", () => {
  it("2 -> 1 (join): the document's Latin text is " +
     "exactly the joined parse's Latin text", () => {
    fc.assert(
      fc.property(arbBlock, arbBlock, (a, b) => {
        const x = a as Block;
        const y = b as Block;
        // the paragraph the user is left with after
        // deleting the boundary in the LATIN pane
        const joined: Block = {
          anchors: [...x.anchors, ...y.anchors],
          gaps: [
            ...x.gaps.slice(0, -1),
            {
              sp: "",
              latin:
                x.gaps[x.gaps.length - 1].latin +
                y.gaps[0].latin,
            },
            ...y.gaps.slice(1),
          ],
          spans: [
            ...x.spans,
            ...y.spans.map((s) => ({
              ...s,
              from: s.from + x.anchors.length,
              to: s.to + x.anchors.length,
            })),
          ],
        };
        const out = mergeStructural(
          [x, y],
          [latParse(joined)],
          "latin"
        );
        return (
          out.length === 1 &&
          out.map(latinTextOf).join("") ===
            latinTextOf(joined)
        );
      }),
      { numRuns: 2000 }
    );
  });
});

describe("rechunk — zero-anchor chunks", () => {
  // A formatting span straddling ADJACENT sentinels
  // (an empty paragraph inside bold) clamps to
  // to = -1 < from = 0 for the empty chunk. Without
  // the guard that span is emitted as a bad range
  // and checkBlock rejects the block.
  it("drops a span clamped into an empty chunk " +
     "instead of emitting a bad range", () => {
    const sentinel = flattenBlocks([
      block([], [g("", "")]),
      block([], [g("", "")]),
    ]).anchors[0];
    expect(isSentinel(sentinel)).toBe(true);
    const flat: Block = {
      anchors: [
        word("toki"),
        sentinel,
        sentinel,
        word("pona"),
      ],
      gaps: [
        g("", ""),
        g("", ""),
        g("", ""),
        g("", ""),
        g("", ""),
      ],
      spans: [
        span("bold", 0, 3),
      ],
    };
    const chunks = rechunk(flat);
    expect(chunks).toHaveLength(3);
    expect(chunks[1].anchors).toHaveLength(0);
    expect(chunks[1].spans).toEqual([]);
    expect(
      chunks.every((b) => checkBlock(b).length === 0)
    ).toBe(true);
    // the surviving halves keep the formatting
    expect(chunks[0].spans).toEqual([
      span("bold", 0, 0),
    ]);
    expect(chunks[2].spans).toEqual([
      span("bold", 0, 0),
    ]);
  });

  it("end to end: a split that creates an EMPTY " +
     "middle paragraph under a bold span", () => {
    const prev: Block[] = [
      {
        anchors: [word("toki"), word("pona")],
        gaps: [
          g("", ""),
          g("\n\n\n\n", ""),
          g("", ""),
        ],
        spans: [
          span("bold", 0, 1),
        ],
      },
    ];
    const parsed = [
      spParse(block([word("toki")], [
        g("", ""),
        g("", ""),
      ])),
      spParse(block([], [g("", "")])),
      spParse(block([word("pona")], [
        g("", ""),
        g("", ""),
      ])),
    ];
    const out = mergeStructural(prev, parsed, "sp");
    expect(out).toHaveLength(3);
    expect(out[1].anchors).toHaveLength(0);
    expect(out[1].spans).toEqual([]);
    expect(
      out.every((b) => checkBlock(b).length === 0)
    ).toBe(true);
  });
});

describe("block count follows the fresh parse " +
         "(sentinel tripwire)", () => {
  // the JOIN direction of the flat path had only
  // unit coverage; this is its property.
  it("2 blocks against 1 parse always yields 1 " +
     "checkBlock-clean block", () => {
    fc.assert(
      fc.property(arbBlock, arbBlock, (a, b) => {
        const joined = mergeStructural(
          [a as Block, b as Block],
          [spParse(a as Block)],
          "sp"
        );
        return (
          joined.length === 1 &&
          checkBlock(joined[0]).length === 0 &&
          joined[0].anchors.every(
            (x) => !isSentinel(x)
          )
        );
      }),
      { numRuns: 500 }
    );
  });

  it("holds under arbitrary sp reparses of " +
     "arbitrary regroupings", () => {
    fc.assert(
      fc.property(
        arbBlock,
        arbBlock,
        (a, b) => {
          const out = mergeStructural(
            [a as Block],
            [
              spParse(a as Block),
              spParse(b as Block),
            ],
            "sp"
          );
          return out.length === 2;
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe("flat-path offset remaps and the " +
         "boundary marker-drop rule", () => {
  it("EXACT PIN: a Latin Enter-Enter split whose " +
     "gap strands an endOffset drops the offset by " +
     "RULE; content is intact; a re-join does not " +
     "restore it", () => {
    // one block; the latin side splits it in two.
    // endOffset points past the newline run, i.e.
    // its content crosses the new block boundary.
    const prev: Block[] = [
      {
        anchors: [
          { kind: "word", word: "toki" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: "\n\n toki", latin: "\n\n" },
        ],
        spans: [cart(0, 0, { endOffset: 4 })],
      },
    ];
    // latin parse of the two post-split paragraphs
    const sides: ParsedSide[] = [
      { anchors: prev[0].anchors, gaps: ["", ""] },
      { anchors: [], gaps: [""] },
    ];
    const out = mergeStructural(
      prev, sides, "latin"
    );
    expect(out).toHaveLength(2);
    // the split consumes the "\n\n" run
    // on BOTH sides; the post-run sp content " toki"
    // moves to block 1's gaps[0]; the offset whose
    // content crossed the boundary is DROPPED by
    // rule -> marker renders anchor-adjacent.
    expect(out[0].spans).toEqual([cart(0, 0)]);
    expect(out[0].gaps[1].sp).toBe("");
    expect(out[1].gaps[0].sp).toBe(" toki");
    for (const b of out) {
      expect(checkBlock(b)).toEqual([]);
    }
    // The rule's last clause, pinned as titled:
    // JOINS DO NOT RESTORE IT. Re-joining the two
    // paragraphs
    // rescues the sp content " toki" back onto the
    // survivor's trailing gap, but the offset is
    // gone from the model — rescueJoinedGaps'
    // restore scans prev.spans, and prev is now the
    // SPLIT document, whose span carries no offset
    // to find. The marker stays anchor-adjacent.
    const rejoined = mergeStructural(
      out,
      [
        {
          anchors: out[0].anchors,
          gaps: ["", ""],
        },
      ],
      "latin"
    );
    expect(rejoined).toHaveLength(1);
    expect(rejoined[0].spans).toEqual([
      cart(0, 0),
    ]);
    // Latin-join seam invention: this re-join's
    // seam gap holds no newline (the split consumed
    // the run), so the seam rule INVENTS the one
    // "\n" the seam must have, at the junction in
    // front of the rescued " toki". The clause
    // under test is untouched — the OFFSET is still
    // not restored (spans above), and the rescued
    // CONTENT is still intact; only the seam break
    // is added.
    expect(rejoined[0].gaps[1].sp).toBe("\n toki");
    expect(checkBlock(rejoined[0])).toEqual([]);
  });

  it("TAIL PASS PIN: a split whose consumed run " +
     "BEGINS the divided gap snaps an endOffset to " +
     "0, and only revalidateSpanOffsets " +
     "canonicalizes that away", () => {
    // splitLatin("\n\nabc"): left "", right "abc",
    // so runStart = 0 and crossAt = 2, and the
    // endOffset 1 sits INSIDE the consumed run. The
    // snap branch moves it to the deletion site
    // runStart = 0 — an EDGE-VALUED endOffset, which
    // checkBlock rejects ("stored at its edge").
    // Nothing between that snap and rechunk touches
    // it: the tail pass is what turns it into the
    // canonical absent offset. Deleting the
    // `flat = revalidateSpanOffsets(flat)` call
    // fails THIS test and no other (verified).
    const prev: Block[] = [
      {
        anchors: [
          { kind: "word", word: "toki" },
          { kind: "word", word: "pona" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: "\n\nabc", latin: "\n\n" },
          { sp: "", latin: "" },
        ],
        spans: [cart(0, 0, { endOffset: 1 })],
      },
    ];
    const sides: ParsedSide[] = [
      {
        anchors: [
          { kind: "word", word: "toki" },
        ],
        gaps: ["", ""],
      },
      {
        anchors: [
          { kind: "word", word: "pona" },
        ],
        gaps: ["", ""],
      },
    ];
    const out = mergeStructural(
      prev, sides, "latin"
    );
    expect(out).toHaveLength(2);
    expect(out[0].spans).toEqual([cart(0, 0)]);
    expect(out[1].gaps[0].sp).toBe("abc");
    for (const b of out) {
      expect(checkBlock(b)).toEqual([]);
    }
  });

  it("rescueJoinedGaps shifts a right-block " +
     "startOffset by the surviving prefix length", () => {
    // two blocks; block 1 starts with a span whose
    // startOffset indexes block 1's gaps[0] (the gap
    // the join's dead sentinel owns).
    const prev: Block[] = [
      {
        anchors: [
          { kind: "word", word: "toki" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: " ", latin: " " },
        ],
        spans: [],
      },
      {
        anchors: [
          { kind: "word", word: "pona" },
        ],
        gaps: [
          { sp: "  ", latin: "" },
          { sp: "", latin: "" },
        ],
        spans: [cart(0, 0, { startOffset: 1 })],
      },
    ];
    // latin join into one paragraph
    const sides: ParsedSide[] = [
      {
        anchors: [
          { kind: "word", word: "toki" },
          { kind: "word", word: "pona" },
        ],
        gaps: ["", " ", ""],
      },
    ];
    const out = mergeStructural(
      prev, sides, "latin"
    );
    expect(out).toHaveLength(1);
    // dead gap sp "  " rescued onto the survivor
    // gap's sp " " -> "   "; startOffset 1 indexed
    // the dead gap, so it shifts by the surviving
    // prefix length 1 -> 2.
    // Latin-join seam invention: the seam holds no
    // newline, so the seam rule invents one AT THE
    // JUNCTION (offset 1, in front of the rescued
    // "  ") -> " \n  ", and the insertion remap
    // carries the marker with the string it indexes:
    // 2 -> 3, still one char into the rescued half.
    // The subject here (the rescue's prefix shift)
    // is unchanged; this pins its composition with
    // the seam rule.
    expect(out[0].gaps[1].sp).toBe(" \n  ");
    expect(out[0].spans).toEqual([
      cart(1, 1, { startOffset: 3 }),
    ]);
    expect(checkBlock(out[0])).toEqual([]);
  });

  it("revalidateSpanOffsets: an out-of-bounds offset " +
     "after routing is dropped (never clamped), and " +
     "in-bounds offsets pass through untouched", () => {
    const flat: Block = {
      anchors: [
        { kind: "word", word: "toki" },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: " ", latin: "" },
      ],
      spans: [
        cart(0, 0, { endOffset: 9 }),
      ],
    };
    // an out-of-range offset is a MOVE nobody
    // registered, so the pass reports itself
    // (tripwire): a drop outside the registered
    // rule must be diagnosable, not silent.
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const out = revalidateSpanOffsets(flat);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain(
      "UNREGISTERED OFFSET DROP (endOffset)"
    );
    expect(out.spans).toEqual([cart(0, 0)]);
    expect(checkBlock(out)).toEqual([]);
    // ...while an EDGE-VALUED offset is mere
    // canonicalization and stays quiet.
    spy.mockClear();
    const edged: Block = {
      ...flat,
      spans: [cart(0, 0, { endOffset: 0 })],
    };
    expect(
      revalidateSpanOffsets(edged).spans
    ).toEqual([cart(0, 0)]);
    expect(spy).not.toHaveBeenCalled();
    const ok: Block = {
      ...flat,
      spans: [cart(0, 0, { endOffset: 1 })],
    };
    expect(revalidateSpanOffsets(ok)).toEqual(ok);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("regression net: structural " +
     "latin merges always emit checkBlock-clean " +
     "blocks over offset-bearing prevs", () => {
    // regression net for the class: run a latin
    // structural no-op over an offset-bearing block
    // and assert cleanliness.
    const prev: Block[] = [
      {
        anchors: [
          { kind: "word", word: "toki" },
          { kind: "word", word: "pona" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: "  ", latin: " " },
          { sp: " ", latin: "" },
        ],
        spans: [
          cart(0, 1, {
            startOffset: 1,
            endOffset: 1,
          }),
        ],
      },
      {
        anchors: [
          { kind: "word", word: "mute" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: "", latin: "" },
        ],
        spans: [],
      },
    ];
    const sides: ParsedSide[] = [
      {
        anchors: [
          ...prev[0].anchors,
          ...prev[1].anchors,
        ],
        gaps: ["", " ", " ", ""],
      },
    ];
    for (const b of mergeStructural(
      prev, sides, "latin"
    )) {
      expect(checkBlock(b)).toEqual([]);
    }
  });

  it("a Latin split rebases a right-block " +
     "startOffset that sat past the consumed run " +
     "(and drops one that sat before it)", () => {
    const prev: Block[] = [
      {
        anchors: [
          { kind: "word", word: "toki" },
          { kind: "word", word: "pona" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: " \n\n x", latin: " \n\n " },
          { sp: "", latin: "" },
        ],
        spans: [
          cart(1, 1, { startOffset: 4 }),
        ],
      },
    ];
    const sides: ParsedSide[] = [
      {
        anchors: [
          { kind: "word", word: "toki" },
        ],
        gaps: ["", ""],
      },
      {
        anchors: [
          { kind: "word", word: "pona" },
        ],
        gaps: ["", ""],
      },
    ];
    const out = mergeStructural(
      prev, sides, "latin"
    );
    expect(out).toHaveLength(2);
    // splitLatin(" \n\n x"): left " ", right " x";
    // crossAt = 3; startOffset 4 >= 3 -> rebases to
    // 1 inside block 1's gaps[0] " x".
    expect(out[1].gaps[0].sp).toBe(" x");
    expect(out[1].spans).toEqual([
      cart(0, 0, { startOffset: 1 }),
    ]);
    // variant: startOffset 1 (< crossAt) stays
    // dropped (crossed the boundary)
    const prev2: Block[] = [
      {
        ...prev[0],
        spans: [cart(1, 1, { startOffset: 1 })],
      },
    ];
    const out2 = mergeStructural(
      prev2, sides, "latin"
    );
    expect(out2[1].spans).toEqual([cart(0, 0)]);
  });
  it("a Latin split that also DELETES an anchor " +
     "carries the surviving offset with the gap it " +
     "indexes (no cross-gap relocation)", () => {
    // "mute" dies AND the paragraph splits at its
    // place in one latin transaction. merge.ts
    // REPLACEMENT-pairs the new sentinel with the
    // dead "mute", so the sentinel is not an
    // insertion, nothing divides, and prev gaps[2]
    // (" y z") is handed to the sentinel as its
    // owned gap: it becomes block 1's gaps[0] and
    // the startOffset that indexes it travels with
    // it, still pointing at the same string. The
    // rebase in routeSplitGaps must NOT fire here —
    // its ownership condition (prevRight ===
    // leftPrev) is what keeps offset 3 from being
    // re-read against the undivided " \n\n x".
    // (Block 0's newline gap is pinned below, with
    // the seam-run handling.)
    const prev: Block[] = [
      {
        anchors: [
          { kind: "word", word: "toki" },
          { kind: "word", word: "mute" },
          { kind: "word", word: "pona" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: " \n\n x", latin: " \n\n " },
          { sp: " y z", latin: " " },
          { sp: "", latin: "" },
        ],
        spans: [
          cart(2, 2, { startOffset: 3 }),
        ],
      },
    ];
    const sides: ParsedSide[] = [
      {
        anchors: [
          { kind: "word", word: "toki" },
        ],
        gaps: ["", ""],
      },
      {
        anchors: [
          { kind: "word", word: "pona" },
        ],
        gaps: ["", ""],
      },
    ];
    const out = mergeStructural(
      prev, sides, "latin"
    );
    expect(out).toHaveLength(2);
    expect(out[1].gaps[0].sp).toBe(" y z");
    expect(out[1].spans).toEqual([
      cart(0, 0, { startOffset: 3 }),
    ]);
    // Disposition of the matched-sentinel
    // non-division shape: the JOIN SEAM RULE
    // does NOT reach it, so the "\n\n" run stays
    // UNDIVIDED here and content stays conserved.
    // Two independent reasons, both structural: this
    // is a SPLIT (no paragraph-count DECREASE, so the
    // evidence guard refuses), and a one-block prev
    // has no sentinel at all, so no seam is even
    // enumerated. A collapse here would destroy a run
    // the transaction never consumed.
    expect(out[0].gaps[1].sp).toBe(" \n\n x");
    for (const b of out) {
      expect(checkBlock(b)).toEqual([]);
    }
  });

  it("a join that also INSERTS an anchor keeps the " +
     "right block's offset with the gap it indexes",
     () => {
    // The prefix-shift shape plus a word typed at
    // the join.
    // merge.ts replacement-pairs the new "mute"
    // with the dead sentinel, so the sentinel's
    // owned gap "  " is INHERITED (module header:
    // "a next sentinel replacing a real anchor
    // inherits that anchor's owned gap") rather
    // than rescued: nothing is appended, the
    // ownership rule keeps the offset, and it still
    // indexes the same "  ". The rescue restore
    // must not double-fire on this path.
    const prev: Block[] = [
      {
        anchors: [
          { kind: "word", word: "toki" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: " ", latin: " " },
        ],
        spans: [],
      },
      {
        anchors: [
          { kind: "word", word: "pona" },
        ],
        gaps: [
          { sp: "  ", latin: "" },
          { sp: "", latin: "" },
        ],
        spans: [cart(0, 0, { startOffset: 1 })],
      },
    ];
    const sides: ParsedSide[] = [
      {
        anchors: [
          { kind: "word", word: "toki" },
          { kind: "word", word: "mute" },
          { kind: "word", word: "pona" },
        ],
        gaps: ["", " ", " ", ""],
      },
    ];
    const out = mergeStructural(
      prev, sides, "latin"
    );
    expect(out).toHaveLength(1);
    expect(out[0].gaps.map((g) => g.sp)).toEqual([
      "", " ", "  ", "",
    ]);
    expect(out[0].spans).toEqual([
      cart(2, 2, { startOffset: 1 }),
    ]);
    expect(checkBlock(out[0])).toEqual([]);
  });

  it("COORDINATE MIX PIN: the split rebase refuses " +
     "a prev gap the merge itself rewrote — the " +
     "marker drops instead of sliding into " +
     "the survivors", () => {
    // crossAt/runStart are
    // measured on the MERGED gap; ps.startOffset
    // indexes the PREV gap. cleanupJoiners strips
    // the unflanked STACK (2 UTF-16 units) from this
    // DISTURBED gap inside mergeBlockDetailed, so
    // the two disagree by exactly 2: the pre-fix
    // rebase produced startOffset 3 in a 4-space
    // gap (correct would have been 1) — in range,
    // checkBlock-clean, tripwire-silent. The
    // byte-identity requirement drops it instead.
    // DISCRIMINATING: removing
    // `prev.gaps[leftPrev].sp === orig` from
    // routeSplitGaps fails this test.
    const prev: Block[] = [
      {
        anchors: [
          {
            kind: "verbatim",
            text: "aa",
            marked: true,
          },
        ],
        gaps: [
          {
            sp: STACK + "\n" + "    ",
            latin: "\n",
          },
          { sp: "", latin: "" },
        ],
        spans: [cart(0, 0, { startOffset: 4 })],
      },
    ];
    // latin split at position 0: an empty paragraph
    // is created BEFORE the anchor.
    const sides: ParsedSide[] = [
      { anchors: [], gaps: [""] },
      {
        anchors: prev[0].anchors,
        gaps: ["", ""],
      },
    ];
    const out = mergeStructural(
      prev, sides, "latin"
    );
    expect(out).toHaveLength(2);
    expect(out[0].gaps[0].sp).toBe("");
    // gap CONTENT is never lost by the drop rule:
    // the four spaces are all still here, in the
    // right block
    expect(out[1].gaps[0].sp).toBe("    ");
    expect(out[1].spans).toEqual([cart(0, 0)]);
    for (const b of out) {
      expect(checkBlock(b)).toEqual([]);
    }
  });

  it("a division SHIFTS a surviving startOffset in " +
     "the sentinel's owned gap by the prepended " +
     "right half", () => {
    // The `s.from === i + 1` shift branch, reached
    // live: with FOUR paragraphs and
    // a fifth created, the LCS suffix trim matches
    // the sentinel run from the RIGHT, so the run's
    // FIRST sentinel is the insertion and the one
    // next to "pona" is MATCHED — which is what lets
    // the ownership rule KEEP the offset (its
    // gap carried) while the matched sentinel still
    // divides on the evidence path. gaps[i] "\nxy"
    // divides into left "" / right "xy", so the
    // owned gap "abcdefg" becomes "xyabcdefg" and
    // the offset must move with its own characters:
    // 4 -> 6. No code change — this pins correct
    // existing behavior that had zero coverage.
    const prev: Block[] = [
      {
        anchors: [
          { kind: "word", word: "toki" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: "", latin: "" },
        ],
        spans: [],
      },
      {
        anchors: [],
        gaps: [{ sp: "", latin: "\n" }],
        spans: [],
      },
      {
        anchors: [],
        gaps: [{ sp: "\nxy", latin: "\n" }],
        spans: [],
      },
      {
        anchors: [
          { kind: "word", word: "pona" },
        ],
        gaps: [
          { sp: "abcdefg", latin: "" },
          { sp: "", latin: "" },
        ],
        spans: [cart(0, 0, { startOffset: 4 })],
      },
    ];
    for (const b of prev) {
      expect(checkBlock(b)).toEqual([]);
    }
    // latin edit: paragraph 0's word changes AND a
    // fifth paragraph appears.
    const sides: ParsedSide[] = [
      {
        anchors: [
          { kind: "word", word: "mute" },
        ],
        gaps: ["", ""],
      },
      { anchors: [], gaps: [""] },
      { anchors: [], gaps: [""] },
      { anchors: [], gaps: [""] },
      {
        anchors: [
          { kind: "word", word: "pona" },
        ],
        gaps: ["", ""],
      },
    ];
    const out = mergeStructural(
      prev, sides, "latin"
    );
    expect(out).toHaveLength(5);
    expect(out[4].gaps[0].sp).toBe("xyabcdefg");
    expect(out[4].spans).toEqual([
      cart(0, 0, { startOffset: 6 }),
    ]);
    for (const b of out) {
      expect(checkBlock(b)).toEqual([]);
    }
  });
});

describe("JOIN SEAM RULE + mergeLatinBlock", () => {
  const W = (w: string): Anchor => ({
    kind: "word",
    word: w,
  });

  it("Latin join: seam gap.sp collapses to one " +
     "\\n — two seam-adjacent SP soft breaks " +
     "become one (join-direction break " +
     "destruction)", () => {
    const prev: Block[] = [
      {
        anchors: [W("toki")],
        gaps: [
          { sp: "", latin: "" },
          { sp: "\n", latin: "\n" },
        ],
        spans: [],
      },
      {
        anchors: [W("pona")],
        gaps: [
          { sp: "\n", latin: "" },
          { sp: "", latin: "" },
        ],
        spans: [],
      },
    ];
    const sides: ParsedSide[] = [
      {
        anchors: [W("toki"), W("pona")],
        gaps: ["", " ", ""],
      },
    ];
    const out = mergeStructural(
      prev, sides, "latin"
    );
    expect(out).toHaveLength(1);
    // seam gap: survivor sp "\n" + rescued dead sp
    // "\n" would concatenate to "\n\n"; the seam
    // rule collapses to "\n". latin side is
    // parse-authoritative (" ").
    expect(out[0].gaps[1]).toEqual({
      sp: "\n",
      latin: " ",
    });
    // the ping-pong is structurally impossible: no
    // "\n\n" anywhere in gap.sp after a latin join
    for (const g of out[0].gaps) {
      expect(g.sp.includes("\n\n")).toBe(false);
    }
  });

  it("SP join: seam gap.latin collapses to one " +
     "\\n (generalizes the SP-join-leaves-one-'\\n' " +
     "rule; no \\n\\n\\n accumulation)", () => {
    const prev: Block[] = [
      {
        anchors: [W("toki")],
        gaps: [
          { sp: "", latin: "" },
          { sp: "", latin: "\n\n" },
        ],
        spans: [],
      },
      {
        anchors: [W("pona")],
        gaps: [
          { sp: "", latin: "\n" },
          { sp: "", latin: "" },
        ],
        spans: [],
      },
    ];
    const sides: ParsedSide[] = [
      {
        anchors: [W("toki"), W("pona")],
        gaps: ["", " ", ""],
      },
    ];
    const out = mergeStructural(prev, sides, "sp");
    expect(out).toHaveLength(1);
    expect(out[0].gaps[1].latin).toBe("\n");
  });

  const plainPair = (): Block[] => [
    {
      anchors: [W("toki")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    },
    {
      anchors: [W("pona")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    },
  ];
  const joinedPair: ParsedSide[] = [
    {
      anchors: [W("toki"), W("pona")],
      gaps: ["", " ", ""],
    },
  ];

  // "None is invented" holds for the SP-side
  // direction only (pinned directly below): a
  // LATIN-side join leaves EXACTLY ONE sp "\n" at
  // the seam — collapse a run to one, or INVENT one
  // when none existed. It is the mirror of the
  // standing "SP-join leaves Latin '\n'" rule:
  // deleting newlines in one pane reshapes that
  // pane's lines only; the other pane never loses a
  // break it was showing. The live shape: joining
  // two plain paragraphs from the Latin pane must
  // not run the SP glyphs together on one line — a
  // line break destroyed in a pane the user never
  // touched.
  it("LATIN join INVENTS the seam sp '\\n' when none " +
     "existed: the SP pane never loses a " +
     "line break to a Latin-side join", () => {
    const out = mergeStructural(
      plainPair(), joinedPair, "latin"
    );
    expect(out).toHaveLength(1);
    // sp: invented at the seam. latin: still
    // parse-authoritative (the fusion space), and
    // still newline-free — the invention is sp-only.
    expect(out[0].gaps[1]).toEqual({
      sp: "\n",
      latin: " ",
    });
    // the rendered SP text carries the break between
    // the two glyphs ("󱥬\n󱥔", not "󱥬󱥔")
    expect(renderSp(out[0]).text).toBe(
      anchorSpText(W("toki")) +
        "\n" +
        anchorSpText(W("pona"))
    );
    // exactly one, never a run
    for (const g of out[0].gaps) {
      expect(g.sp.includes("\n\n")).toBe(false);
    }
  });

  // ...and the invention is PER SEAM, not per dead
  // sentinel: two seams landing in ONE output gap
  // (the empty-paragraph shape) invent one break
  // between them, while two seams landing in
  // DIFFERENT gaps each get their own.
  it("multi-seam plain join: exactly one invented " +
     "'\\n' per output gap, never one per dead " +
     "sentinel", () => {
    const plain = (w: string): Block => ({
      anchors: [W(w)],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    });
    // [toki] [] [pona] -> one: both seams land in the
    // same output gap
    const viaEmpty = mergeStructural(
      [
        plain("toki"),
        { anchors: [], gaps: [{ sp: "", latin: "" }],
          spans: [] },
        plain("pona"),
      ],
      joinedPair,
      "latin"
    );
    expect(viaEmpty).toHaveLength(1);
    expect(viaEmpty[0].gaps.map((g) => g.sp)).toEqual(
      ["", "\n", ""]
    );
    // [toki] [pona] [mute] -> one: two seams, two
    // gaps, one break each
    const threeWords = mergeStructural(
      [plain("toki"), plain("pona"), plain("mute")],
      [
        {
          anchors: [W("toki"), W("pona"), W("mute")],
          gaps: ["", " ", " ", ""],
        },
      ],
      "latin"
    );
    expect(threeWords).toHaveLength(1);
    expect(
      threeWords[0].gaps.map((g) => g.sp)
    ).toEqual(["", "\n", "\n", ""]);
  });

  // ...and the OTHER direction: an SP-side join
  // invents nothing in the seam gap.latin (its "\n"
  // comes from the standing editor-layer rule only
  // when one was there to keep).
  it("none is invented (SP-side direction): a " +
     "newline-free seam gap.latin stays " +
     "newline-free", () => {
    const out = mergeStructural(
      plainPair(), joinedPair, "sp"
    );
    expect(out).toHaveLength(1);
    expect(
      out[0].gaps.some((g) => g.latin.includes("\n"))
    ).toBe(false);
  });

  /** a REAL sentinel anchor (isSentinel-true):
   *  its text is private to doc-merge.ts by
   *  design, so derive one via flattenBlocks. */
  const sentinel = (): Anchor =>
    flattenBlocks([
      { anchors: [],
        gaps: [{ sp: "", latin: "" }],
        spans: [] },
      { anchors: [],
        gaps: [{ sp: "", latin: "" }],
        spans: [] },
    ]).anchors[0];

  it("EVIDENCE GUARD (compound-transaction pin): a " +
     "dead sentinel WITHOUT a paragraph-count " +
     "decrease leaves the gap untouched", () => {
    // direct unit call: dead sentinel present but
    // countDecreased false -> no collapse
    const prevFlat: Block = {
      anchors: [W("toki"), sentinel(), W("pona")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "\n", latin: "" },
        { sp: "\n", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const merged: Block = {
      anchors: [W("toki"), W("pona")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "\n\n", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    // (the direct-call fixtures model a LATIN-side
    // join, so the carried — collapsible — side is
    // sp; see the parse-authority pin below)
    const out = collapseSeamRuns(
      prevFlat,
      merged,
      [0, 2],
      false,
      "latin"
    );
    expect(out).toBe(merged);
    // ...and with the decrease, it collapses
    const on = collapseSeamRuns(
      prevFlat,
      merged,
      [0, 2],
      true,
      "latin"
    );
    expect(on.gaps[1].sp).toBe("\n");
  });

  // PARSE AUTHORITY (forced by the flat path's SP
  // CONSERVATION law, whose fast-check
  // counterexample this reduces to a fixture). The
  // seam rule
  // owns the CARRIED side of the seam gap only. On an
  // SP-side join the seam gap's sp text IS the user's
  // fresh parse: prev [toki "\n"] + [empty "\n"]
  // joined into one paragraph parses as sp "\n\n"
  // there, and collapsing it deletes a byte the user
  // typed — the document's SP text would no longer be
  // the parse's SP text. Discriminating: the
  // both-sides collapse returns "\n" here.
  it("PARSE AUTHORITY: the EDITED side of the seam " +
     "gap is never collapsed (SP conservation)",
     () => {
    const prev: Block[] = [
      {
        anchors: [W("toki")],
        gaps: [
          { sp: "", latin: "" },
          { sp: "\n", latin: "" },
        ],
        spans: [],
      },
      {
        anchors: [],
        gaps: [{ sp: "\n", latin: "" }],
        spans: [],
      },
    ];
    const sides: ParsedSide[] = [
      { anchors: [W("toki")], gaps: ["", "\n\n"] },
    ];
    const out = mergeStructural(prev, sides, "sp");
    expect(out).toHaveLength(1);
    expect(out[0].gaps[1].sp).toBe("\n\n");
  });

  it("collapse deletions remap sp-side marker " +
     "offsets", () => {
    const prevFlat: Block = {
      anchors: [W("toki"), sentinel(), W("pona")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "\n", latin: "" },
        { sp: "\n", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const merged: Block = {
      anchors: [W("toki"), W("pona")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "\nx\n", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [
        cart(0, 0, { endOffset: 3 }),
      ],
    };
    const out = collapseSeamRuns(
      prevFlat,
      merged,
      [0, 2],
      true,
      "latin"
    );
    // second "\n" (index 2) deleted; endOffset 3
    // shifts to 2
    expect(out.gaps[1].sp).toBe("\nx");
    expect(out.spans[0].endOffset).toBe(2);
  });

  // The INSERTION direction of the same remap
  // duty (the remap was built for removal). The
  // invented "\n" goes AT THE SEAM — the junction
  // between the left survivor's carried sp and the
  // rescued dead sp, i.e. exactly where the paragraph
  // boundary used to be — so offsets left of it are
  // untouched and offsets right of it shift by one.
  // AT the seam the tie follows demoteStraddlers'
  // convention, for the same nesting reason: an END
  // marker stays LEFT of the break (it closes the
  // line that just ended), a START marker moves RIGHT
  // of it (it opens the line that follows).
  it("the INVENTED seam '\\n' remaps sp-side marker " +
     "offsets (insertion direction)", () => {
    const prevFlat: Block = {
      anchors: [W("toki"), sentinel(), W("pona")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "ab", latin: "" },
        { sp: "cd", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    // as rescueJoinedGaps leaves it: "ab" + "cd",
    // seam at offset 2
    const merged: Block = {
      anchors: [W("toki"), W("pona")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "abcd", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [
        cart(0, 0, { endOffset: 1 }),
        span("long", 0, 0, { endOffset: 2 }),
        cart(1, 1, { startOffset: 2 }),
      ],
    };
    const out = collapseSeamRuns(
      prevFlat,
      merged,
      [0, 2],
      true,
      "latin"
    );
    expect(out.gaps[1].sp).toBe("ab\ncd");
    // strictly left of the seam: untouched
    expect(out.spans[0].endOffset).toBe(1);
    // AT the seam: an END stays left of the break...
    expect(out.spans[1].endOffset).toBe(2);
    // ...a START moves right of it
    expect(out.spans[2].startOffset).toBe(3);
  });

  // END-TO-END remap duty: the tail
  // revalidation pass only DROPS, so the collapse
  // must remap by itself. Here the un-remapped offset
  // would still be in range and on a codepoint
  // boundary — the tripwire stays SILENT while the
  // marker slides one char right. Only this pin sees
  // it.
  it("a Latin join remaps a rescued startOffset " +
     "through the seam collapse (end to end)",
     () => {
    const prev: Block[] = [
      {
        anchors: [W("toki")],
        gaps: [
          { sp: "", latin: "" },
          { sp: "\n", latin: "" },
        ],
        spans: [],
      },
      {
        anchors: [W("pona")],
        gaps: [
          { sp: "\nxy", latin: "" },
          { sp: "", latin: "" },
        ],
        spans: [
          cart(0, 0, { startOffset: 1 }),
        ],
      },
    ];
    const sides: ParsedSide[] = [
      {
        anchors: [W("toki"), W("pona")],
        gaps: ["", " ", ""],
      },
    ];
    const out = mergeStructural(
      prev, sides, "latin"
    );
    expect(out).toHaveLength(1);
    // rescue concatenated "\n" + "\nxy" and rebased
    // the offset to 2; the seam rule then deleted
    // the second
    // "\n", so the marker moves back to 1 — still
    // between the "\n" and the "x", where it was.
    expect(out[0].gaps[1].sp).toBe("\nxy");
    expect(out[0].spans[0].startOffset).toBe(1);
    expect(checkBlock(out[0])).toEqual([]);
  });

  // ...and the same duty in the INSERTION
  // direction, end to end. Same silent-failure shape:
  // an un-remapped offset here is still in range and
  // still on a codepoint boundary, so the tripwire
  // says nothing while the marker slides one char
  // LEFT (it would end up between the invented "\n"
  // and the "c" instead of inside "cd").
  it("a Latin join remaps a rescued startOffset " +
     "through the INVENTED seam '\\n' (end to " +
     "end)", () => {
    const prev: Block[] = [
      {
        anchors: [W("toki")],
        gaps: [
          { sp: "", latin: "" },
          { sp: "ab", latin: "" },
        ],
        spans: [],
      },
      {
        anchors: [W("pona")],
        gaps: [
          { sp: "cd", latin: "" },
          { sp: "", latin: "" },
        ],
        spans: [
          cart(0, 0, { startOffset: 1 }),
        ],
      },
    ];
    const sides: ParsedSide[] = [
      {
        anchors: [W("toki"), W("pona")],
        gaps: ["", " ", ""],
      },
    ];
    const out = mergeStructural(
      prev, sides, "latin"
    );
    expect(out).toHaveLength(1);
    // rescue concatenated "ab" + "cd" and rebased the
    // offset to 3; the seam rule then inserted "\n"
    // at the seam (offset 2), so the marker moves to 4 —
    // still between the "c" and the "d".
    expect(out[0].gaps[1].sp).toBe("ab\ncd");
    expect(out[0].spans[0].startOffset).toBe(4);
    expect(checkBlock(out[0])).toEqual([]);
  });

  it("mergeLatinBlock applies no Enter/separation " +
     "defaults and " +
     "the equal-count fast path uses it", () => {
    const prev: Block = {
      anchors: [W("toki")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const parsed: ParsedSide = {
      anchors: [W("toki")],
      gaps: ["", "!"],
    };
    // no Latin analogue of the Enter default: a
    // latin "\n" gain must NOT create sp breaks; no
    // separation default on a parse-authoritative
    // latin edit.
    //
    // NOT "default-free", though: this merge
    // applies exactly ONE SP-side default,
    // applyMarkedVerbatimSpDefault, which separates
    // a FRESH degenerate adjacency between two
    // marked verbatim anchors. Neither of the
    // Latin-side defaults this test is about comes
    // with it.
    const withNl = mergeLatinBlock(prev, {
      anchors: [W("toki")],
      gaps: ["", "\n"],
    });
    expect(withNl.gaps[1]).toEqual({
      sp: "",
      latin: "\n",
      latinAuthored: true,
    });
    expect(mergeLatinBlock(prev, parsed)).toEqual(
      mergeStructural([prev], [parsed], "latin")[0]
    );
  });
});

describe("letter-ish gap.latin normalization", () => {
  const W = (w: string): Anchor => ({
    kind: "word",
    word: w,
  });

  it("DEMONSTRATION: un-normalized mark-leading " +
     "gap.latin destroys the word anchor on a " +
     "Latin no-op (why the pass exists)", () => {
    const b: Block = {
      anchors: [W("toki")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "\u0301x" },
      ],
      spans: [],
    };
    const rt = mergeLatinBlock(
      b,
      parseLatin(renderLatin(b).inlines)
    );
    expect(
      rt.anchors.some(
        (a) => a.kind === "word"
      )
    ).toBe(false);
  });

  it("EXACT PIN: normalization separates " +
     "fusing boundaries; the normalized form " +
     "latin-round-trips to identity", () => {
    const b: Block = {
      anchors: [W("toki")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "\u0301x" },
      ],
      spans: [],
    };
    const n = normalizeLetterishLatin(b);
    expect(n.gaps[1].latin).toBe(" \u0301x");
    // sp bytes untouched by normalization
    expect(
      renderSp(n).inlines
    ).toEqual(renderSp(b).inlines);
    // idempotent
    expect(normalizeLetterishLatin(n)).toBe(n);
    // stable under a latin no-op EXCEPT the
    // anchor-material promotion: "\u0301x" is a
    // free-standing run ("́" alone cannot
    // start a run; "x" can) and mints a marked
    // verbatim anchor on first touch — pinned:
    const rt = mergeLatinBlock(
      n,
      parseLatin(renderLatin(n).inlines)
    );
    expect(rt.anchors).toEqual([
      W("toki"),
      { kind: "verbatim", text: "x",
        marked: true },
    ]);
    // the word anchor SURVIVED — the destructive
    // fusion is dead
    const rt2 = mergeLatinBlock(
      rt,
      parseLatin(renderLatin(rt).inlines)
    );
    expect(rt2).toEqual(rt);
  });

  it("right-boundary fusion is separated too, and " +
     "cartouche-covered anchors are exempt (atom " +
     "opacity, the separation default's twin)", () => {
    const b: Block = {
      anchors: [W("toki"), W("pona")],
      gaps: [
        { sp: "", latin: "" },
        { sp: " ", latin: "ab" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const n = normalizeLetterishLatin(b);
    expect(n.gaps[1].latin).toBe(" ab ");
    const cov: Block = {
      ...b,
      spans: [
        cart(0, 1),
      ],
    };
    expect(normalizeLetterishLatin(cov)).toBe(cov);
  });

  it("a NAMELESS cartouche does not atomize, " +
     "so its flank is NOT exempt here either", () => {
    // The exemption carried the same "renders
    // inside an opaque atom" justification the
    // separation default's did, and the ATOMIZATION
    // RULE falsifies it for nameless cartouches.
    // With the wider predicate the stored "ab" is
    // declined a separator and the first Latin
    // no-op swallows it INTO the cartouche
    // ("[CART]xq[/CART]" -> "[CART]abxq[/CART]",
    // stored bytes rewritten and an anchor's
    // identity changed). Discrimination verified by
    // temporary revert of the narrowing.
    const b: Block = {
      anchors: [
        { kind: "verbatim", text: "xq", marked: true },
      ],
      gaps: [
        { sp: "", latin: "ab" },
        { sp: "", latin: "" },
      ],
      spans: [
        cart(0, 0),
      ],
    };
    expect(renderSp(b).text).toBe(
      CARTOUCHE_START + "xq" + CARTOUCHE_END
    );
    const n = normalizeLetterishLatin(b);
    expect(n.gaps[0].latin).toBe("ab ");
    expect(normalizeLetterishLatin(n)).toBe(n);
    const rt = mergeLatinBlock(
      n,
      parseLatin(renderLatin(n).inlines)
    );
    expect(renderSp(rt).text).toBe(
      "ab " + CARTOUCHE_START + "xq" + CARTOUCHE_END
    );
    // the cartouche still covers "xq" alone
    expect(rt.spans).toEqual([
      cart(1, 1),
    ]);
  });

  it("interior-apostrophe " +
     "fusion (parseLatin's continuation rule) " +
     "is caught on the LEFT " +
     "boundary", () => {
    const b: Block = {
      anchors: [W("toki")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "'x" },
      ],
      spans: [],
    };
    const n = normalizeLetterishLatin(b);
    expect(n.gaps[1].latin).toBe(" 'x");
    expect(normalizeLetterishLatin(n)).toBe(n);
  });

  it("interior-apostrophe " +
     "fusion is caught on the RIGHT boundary", () => {
    const b: Block = {
      anchors: [W("pona")],
      gaps: [
        { sp: "", latin: "x'" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const n = normalizeLetterishLatin(b);
    expect(n.gaps[0].latin).toBe("x' ");
    expect(normalizeLetterishLatin(n)).toBe(n);
  });

  it("a lone apostrophe gap " +
     "flanked by anchors on both sides fuses BOTH " +
     "ways (the interior-apostrophe letter it needs " +
     "on each side belongs to the adjacent anchor " +
     "itself, not to the gap) — one space each side",
     () => {
    const b: Block = {
      anchors: [W("toki"), W("pona")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "'" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const n = normalizeLetterishLatin(b);
    expect(n.gaps[1].latin).toBe(" ' ");
    expect(normalizeLetterishLatin(n)).toBe(n);
  });

  it("an apostrophe followed by " +
     "a non-letter does NOT fuse — no space " +
     "inserted (negative control for the " +
     "interior-apostrophe branch)", () => {
    const b: Block = {
      anchors: [W("toki")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "'." },
      ],
      spans: [],
    };
    const n = normalizeLetterishLatin(b);
    expect(n.gaps[1].latin).toBe("'.");
    expect(n).toBe(b);
    expect(normalizeLetterishLatin(n)).toBe(n);
  });

  it("a mark-terminated gap " +
     "(a letter immediately followed by a " +
     "combining mark, e.g. NFD \"á\") right-fuses " +
     "— marks continue a run just as much as the " +
     "letter under them", () => {
    const b: Block = {
      anchors: [W("pona")],
      gaps: [
        { sp: "", latin: "a\u0301" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const n = normalizeLetterishLatin(b);
    expect(n.gaps[0].latin).toBe("a\u0301 ");
    expect(normalizeLetterishLatin(n)).toBe(n);
  });

  it("a trailing mark NOT " +
     "preceded by a letter does NOT right-fuse " +
     "(negative control isolating the mark " +
     "precision fix \u2014 a bare combining mark can't " +
     "start a run, so it can't carry one into the " +
     "next anchor either)", () => {
    const b: Block = {
      anchors: [W("pona")],
      gaps: [
        { sp: "", latin: ".\u0301" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const n = normalizeLetterishLatin(b);
    expect(n.gaps[0].latin).toBe(".\u0301");
    expect(n).toBe(b);
    expect(normalizeLetterishLatin(n)).toBe(n);
  });
});

// SPAN KIND-CHANGE RULE. A structural span does
// not follow a REPLACEMENT PAIRING onto an anchor
// of a different KIND -- it dies instead, under the
// span-death licence ("structural span CREATION
// stays SP-side-only; span death by text edit is
// permitted").
//
// Why the pairing alone is not enough evidence: a
// replacement pair is the merge saying "the edited
// side put SOMETHING ELSE here", and on the Latin
// side the parse has no authority over kind at all.
// A cartouche carried onto a freshly typed WORD
// stops showing what the user typed -- the pane
// re-atomizes it into the span's projected name.
// Kind equality is the line: a word replaced by a
// word (a spelling change inside a name) keeps its
// span; a verbatim replaced by a word is a
// different THING, and the span does not follow.
describe("SPAN KIND-CHANGE RULE", () => {

  it("a NAMELESS cartouche's verbatim \"-\" typed " +
     "over as \"mi\" kills the span: the pane shows " +
     "plain \"mi\", not a chip", () => {
    const prev: Block = {
      anchors: [
        { kind: "verbatim", text: "-", marked: true },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [cart(0, 0)],
    };
    // a nameless cartouche does NOT atomize, so
    // its covered "-" is ordinary editable Latin
    // text
    expect(renderLatin(prev).text).toBe("-");
    const out = mergeLatinBlock(
      prev,
      parseLatin([{ type: "text", text: "mi" }])
    );
    expect(out.anchors).toEqual([
      { kind: "word", word: "mi" },
    ]);
    // the span DIES -- no chip, no re-atomization
    expect(out.spans).toEqual([]);
    expect(renderLatin(out).text).toBe("mi");
    expect(checkBlock(out)).toEqual([]);
  });

  it("INVERSE CONTROL: a SAME-KIND replacement keeps " +
     "the span (a word typed over a word is a " +
     "spelling change inside the name)", () => {
    const prev: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [cart(0, 0)],
    };
    const out = mergeLatinBlock(
      prev,
      parseLatin(
        // the cartouche atomizes here (non-empty
        // projected name), so the gesture is a chip
        // edit: replace the atom with the word "pona"
        [{ type: "text", text: "pona" }]
      )
    );
    expect(out.anchors).toEqual([
      { kind: "word", word: "pona" },
    ]);
    expect(out.spans).toEqual([cart(0, 0)]);
  });

  it("...and a VERBATIM replaced by a VERBATIM keeps " +
     "it too -- the rule reads KIND, not identity", () => {
    const prev: Block = {
      anchors: [
        { kind: "verbatim", text: "-", marked: true },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [cart(0, 0)],
    };
    const out = mergeLatinBlock(
      prev,
      parseLatin([{ type: "text", text: "xq" }])
    );
    expect(out.anchors[0].kind).toBe("verbatim");
    expect(out.spans).toEqual([cart(0, 0)]);
  });

  it("a FORMATTING span is NOT structural and is not " +
     "subject to the rule (the licence covers " +
     "STRUCTURAL " +
     "span death; bold/italic follow the text)", () => {
    const prev: Block = {
      anchors: [
        { kind: "verbatim", text: "-", marked: true },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [
        span("bold", 0, 0, { side: "latin" }),
      ],
    };
    const out = mergeLatinBlock(
      prev,
      parseLatin([{ type: "text", text: "mi" }])
    );
    expect(out.anchors).toEqual([
      { kind: "word", word: "mi" },
    ]);
    expect(out.spans).toEqual([
      span("bold", 0, 0, { side: "latin" }),
    ]);
  });

  it("a MATCHED anchor is untouched by the rule: no " +
     "replacement pairing, no kind change, span " +
     "survives a no-op", () => {
    const prev: Block = {
      anchors: [
        { kind: "verbatim", text: "-", marked: true },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [cart(0, 0)],
    };
    const out = mergeLatinBlock(
      prev,
      parseLatin(renderLatin(prev).inlines)
    );
    expect(out.spans).toEqual([cart(0, 0)]);
  });

  // SCOPE: LATIN merges only, per-block and flat
  // alike (the triggering gesture is a paste that
  // can land on either). The SP path is excluded on
  // principle: an SP merge REBUILDS structural
  // spans from the parsed marker stream, and
  // removePairChars has already consumed the user's
  // typed marker characters INTO the span, so
  // dropping one deletes bytes with no surviving
  // representation (merge.ts). On a Latin merge the
  // span is merely CARRIED, and declining to carry
  // it is licensed span death. Measured as well,
  // with a counting harness over both corpus
  // families: SP-side application destroys
  // edited-side document text; Latin-only is green
  // across families and seeds, and it lowers the
  // residual re-atomization count.
  it("the FLAT (count-changing) path applies it too " +
     "— this is the triggering gesture's own " +
     "route", () => {
    const prev: Block[] = [
      {
        anchors: [
          {
            kind: "verbatim",
            text: "-",
            marked: true,
          },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: "", latin: "" },
        ],
        spans: [cart(0, 0)],
      },
      {
        anchors: [{ kind: "word", word: "toki" }],
        gaps: [
          { sp: "", latin: "" },
          { sp: "", latin: "" },
        ],
        spans: [],
      },
    ];
    // a SPLIT (2 paragraphs -> 3) that also types "mi"
    // over the covered "-" -- the count-changing route
    // the corpus's paste-multi takes.
    const sides: ParsedSide[] = [
      {
        anchors: [{ kind: "word", word: "mi" }],
        gaps: ["", ""],
      },
      { anchors: [], gaps: [""] },
      {
        anchors: [{ kind: "word", word: "toki" }],
        gaps: ["", ""],
      },
    ];
    const out = mergeStructural(prev, sides, "latin");
    expect(out).toHaveLength(3);
    expect(out[0].anchors).toEqual([
      { kind: "word", word: "mi" },
    ]);
    expect(out[0].spans).toEqual([]);
    expect(renderLatin(out[0]).text).toBe("mi");
  });

  it("SP CONTROL: the rule stands down on SP edits — " +
     "there the span IS the user's own marker text, " +
     "and the SP parse is authoritative about kind",
     () => {
    // The same kind change (verbatim -> word) inside a
    // cartouche, made from the SP pane. The span must
    // survive: it is re-derived from the parsed
    // markers, so dropping it would destroy evidence
    // the user just typed rather than decline it.
    const prev: Block = {
      anchors: [
        { kind: "verbatim", text: "x", marked: true },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [cart(0, 0)],
    };
    const out = mergeSpBlock(
      prev,
      parseSp([
        {
          type: "text",
          text:
            CARTOUCHE_START +
            "\u{F196C}" +
            CARTOUCHE_END,
          verbatim: false,
        },
      ])
    );
    expect(out.anchors).toEqual([
      { kind: "word", word: "toki" },
    ]);
    expect(out.spans).toEqual([cart(0, 0)]);
  });
});
