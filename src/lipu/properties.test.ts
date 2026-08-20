/**
 * The property-law suite: round-trip laws, merge
 * robustness corpora, byte-identity laws, and the
 * normal form, stated over the NORMAL-FORM
 * generators in test/lipu-arbitraries.ts.
 *
 * If a law fails, the suite is doing its job: shrink
 * it, pin the counterexample in the pinned describe,
 * and FIX THE LIBRARY. Never weaken a law and never
 * add a generator exclusion without recording it in
 * the arbitraries header.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  arbBlock,
  arbLipu,
  arbNameLines,
  arbRawBlock,
  arbRepetitive,
  arbSpText,
} from "../../test/lipu-arbitraries";
import { renderSp } from "./render-sp";
import { parseSp, spInlinesFromText }
  from "./parse-sp";
import { renderLatin } from "./render-latin";
import { parseLatin, tokenizeLatin } from "./parse-latin";
import { mergeBlock } from "./merge";
import {
  mergeLatinBlock,
  mergeSpBlock,
  mergeStructural,
} from "./doc-merge";
import {
  normalizeBlock,
  normalizeLipu,
} from "./normalize";
import {
  entryRangeAt,
  rangeForEntries,
} from "./source-map";
import { checkBlock, sortSpans } from "./types";
import type { Block, Lipu, SourceEntry }
  from "./types";
import { conservationErrors }
  from "../../test/provenance-oracle";
import {
  cart,
  isSpSubsequence,
  rendersBoundToken,
  stripJoiners,
} from "../../test/helpers";
import {
  CARTOUCHE_START,
  CARTOUCHE_END,
  CART_EXT,
  COLON_CH,
  IDEO_SPACE,
  LONG_START,
  LONG_END,
  MIDDLE_DOT_CH,
  SCALE,
  STACK,
  TALLY_CH,
} from "./chars";
import {
  codepointToChar,
  wordToCodepoint,
  VARIATION_SELECTOR_BASE,
} from "../data";

const RUNS = { numRuns: 300 };
const CORPUS_RUNS = { numRuns: 150 };

/** Key-order-insensitive structural stringify.
 *  Blocks are plain data: `{kind, word, case,
 *  variation}` and `{kind, word, variation, case}`
 *  are the SAME value, and the merge legitimately
 *  re-orders keys when it re-attaches a carried
 *  facet. The laws below are DEEP equality, so the
 *  comparison key must not be JSON key order. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (
      v === null ||
      typeof v !== "object" ||
      Array.isArray(v)
    ) {
      return v;
    }
    const rec = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(rec).sort()) {
      out[k] = rec[k];
    }
    return out;
  });
}

/** HONEST canonicalization for the SP round-trip
 *  law: the unmarked-verbatim space-absorption
 *  ambiguity — gap.sp leading spaces after an
 *  unmarked verbatim re-parse into the anchor's
 *  text, so the key folds them the same way.
 *  Everything else compares exactly, both gap
 *  sides included. Generators never place two
 *  unmarked verbatims adjacently, so no
 *  anchor-merge fold is needed.
 *
 *  This is the suite's ONLY law-statement
 *  carve-out. It is a documented ambiguity, not a
 *  code bug: an unmarked verbatim renders as bare
 *  SP
 *  chars, so the boundary between "text of the
 *  anchor" and "space in the gap" is not recoverable
 *  from the SP bytes. The bytes themselves ARE
 *  preserved exactly — see the SP-byte identity law
 *  below, which is stated with NO canonicalization
 *  at all. */
function spCanon(block: Block): string {
  const anchors = block.anchors.map((a) => ({
    ...a,
  }));
  const gaps = block.gaps.map((g) => ({ ...g }));
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    if (a.kind !== "verbatim" || a.marked) {
      continue;
    }
    let sp = gaps[i + 1].sp;
    while (sp.startsWith(" ")) {
      a.text = (a.text ?? "") + " ";
      sp = sp.slice(1);
    }
    gaps[i + 1] = { ...gaps[i + 1], sp };
  }
  return stable({
    anchors,
    gaps,
    spans: sortSpans(block.spans),
  });
}

function spRoundTrip(b: Block): Block {
  return mergeBlock(
    b,
    parseSp(renderSp(b).inlines),
    "sp"
  );
}
function latinRoundTrip(b: Block): Block {
  return mergeBlock(
    b,
    parseLatin(renderLatin(b).inlines),
    "latin"
  );
}
/** The REAL editor pipeline (mergeLatinBlock,
 *  not the bare frozen mergeBlock) — the fusion
 *  rescue only runs here; frozen merge.ts alone
 *  drops a fused run's dying gaps by design. "The
 *  transitioned block" and "conserve SP bytes
 *  through the transition (fusion rescue...)" are
 *  claims ABOUT the rescue, so the two transition
 *  laws below round-trip through the pipeline that
 *  actually contains it — the bind-free laws above
 *  keep the plain `latinRoundTrip` untouched. */
function latinPipelineRoundTrip(b: Block): Block {
  return mergeLatinBlock(
    b,
    parseLatin(renderLatin(b).inlines)
  );
}

/** An authored-only subsequence check alone would
 *  be VACUOUS over THIS FILE's generic corpora —
 *  arbBlock never mints `spAuthored: true` gaps
 *  (measured: 0 in 9000 samples), so the needle
 *  would always be `""`.
 *
 *  Replacing it outright with `conservationErrors`
 *  is necessary but NOT sufficient — verified by
 *  mutation (stub `rescueFusedGaps` to `return
 *  merged;`) on a hand-built fusion WITH real
 *  authored content (below): `conservationErrors`
 *  stayed GREEN even with the rescue fully
 *  disabled and the authored byte visibly dropped.
 *  Reason: its baseline (`mergeBlockDetailed` +
 *  `reattachProvenance`, frozen merge.ts only) is
 *  computed BEFORE the rescue runs, and frozen
 *  merge.ts already drops a fusion's dying gap on
 *  its own — so the baseline NEVER has the byte
 *  either, and a check stated relative to that
 *  baseline is structurally blind to whether the
 *  rescue restores it. `conservationErrors` still
 *  earns its place: it catches an ADDED pass
 *  destroying something the baseline DID have (its
 *  actual designed job, per every existing use of
 *  it in doc-merge.binding.test.ts, which always
 *  asserts it stays EMPTY — "no NEW violation",
 *  never "the rescue's bytes appear here"). So the
 *  bind-shaped branch below runs BOTH: the
 *  prev-vs-output authored-subsequence check
 *  (correct in form, just unexercised by this
 *  file's generators) catches whether the rescue
 *  itself restores prev's authored bytes;
 *  `conservationErrors` catches whether any
 *  doc-merge pass destroys something ELSE. Both
 *  are mutation-verified below on a hand-built
 *  case (see "the bind-shaped branch really
 *  discriminates"). */
const authoredSpConcat = (b: Block): string =>
  b.gaps
    .filter((gp) => gp.spAuthored)
    .map((gp) => gp.sp)
    .join("");

function lawsFor(
  name: string,
  arb: fc.Arbitrary<Block>,
  runs: { numRuns: number }
): void {
  describe(`round-trip laws over ${name}`, () => {
    it("SP round trip is identity under " +
       "spCanon", () => {
      fc.assert(
        fc.property(arb, (b) => {
          return (
            spCanon(spRoundTrip(b)) === spCanon(b)
          );
        }),
        runs
      );
    });

    // Stated with NO canonicalization: the
    // absorption ambiguity above moves the
    // anchor/gap BOUNDARY, never a byte.
    it("SP round trip is SP-BYTE identity " +
       "(inlines, verbatim flags included)", () => {
      fc.assert(
        fc.property(arb, (b) => {
          return (
            stable(
              renderSp(spRoundTrip(b)).inlines
            ) === stable(renderSp(b).inlines)
          );
        }),
        runs
      );
    });

    it("Latin no-op round trip is FULL identity " +
       "for bind-free blocks (bind-shaped " +
       "blocks transition — see convergence + " +
       "conservation below)", () => {
      fc.assert(
        fc.property(arb, (b) => {
          fc.pre(!rendersBoundToken(b));
          return (
            stable(latinRoundTrip(b)) === stable(b)
          );
        }),
        runs
      );
    });

    it("the bind transition converges in ONE " +
       "step: the " +
       "transitioned block is parse-stable", () => {
      fc.assert(
        fc.property(arb, (b) => {
          const r = latinPipelineRoundTrip(b);
          return (
            stable(latinPipelineRoundTrip(r)) ===
            stable(r)
          );
        }),
        runs
      );
    });

    it("anchor conservation: Latin no-op round " +
       "trip is " +
       "SP-IDENTITY for bind-free blocks; " +
       "bind-shaped blocks conserve their OWN " +
       "authored SP bytes AND pass the " +
       "conservation oracle through the " +
       "transition (fusion rescue)", () => {
      fc.assert(
        fc.property(arb, (b) => {
          if (!rendersBoundToken(b)) {
            const r = latinRoundTrip(b);
            return (
              stable(renderSp(r).inlines) ===
              stable(renderSp(b).inlines)
            );
          }
          const parsed = parseLatin(
            renderLatin(b).inlines
          );
          const r = latinPipelineRoundTrip(b);
          return (
            isSpSubsequence(
              stripJoiners(authoredSpConcat(b)),
              stripJoiners(authoredSpConcat(r))
            ) &&
            conservationErrors(
              [b],
              [parsed],
              [r],
              "latin"
            ).length === 0
          );
        }),
        runs
      );
    });

    it("merge outputs preserve the Block " +
       "invariants", () => {
      fc.assert(
        fc.property(arb, (b) => {
          return (
            checkBlock(spRoundTrip(b)).length ===
              0 &&
            checkBlock(latinRoundTrip(b))
              .length === 0
          );
        }),
        runs
      );
    });
  });
}

lawsFor("arbBlock", arbBlock, RUNS);
lawsFor("arbNameLines (REQUIRED corpus)",
  arbNameLines, CORPUS_RUNS);
lawsFor("arbRepetitive (REQUIRED corpus)",
  arbRepetitive, CORPUS_RUNS);

// Bind-shaped branch discrimination lock.
// Measured:
// arbBlock/arbNameLines/arbRepetitive mint ZERO
// `spAuthored` gaps (0 in 3000 arbBlock samples,
// checked directly), so NEITHER half of the
// bind-shaped branch is exercised by the generic
// corpora above — this pin is their only coverage,
// hand-built.
//
// TWO independently mutation-verified claims, not
// one (see the `authoredSpConcat` header comment for
// the full reasoning): stubbing `rescueFusedGaps` to
// `return merged;` turns the `isSpSubsequence` half
// RED (the authored "\n" is visibly dropped — the
// rescue's own job) while `conservationErrors` STAYS
// GREEN even then, because its pass-layer baseline is
// computed BEFORE the rescue runs and frozen merge.ts
// already drops a fusion's dying gap on its own, so
// the baseline never has the byte either and the
// oracle has nothing to compare it against. That is
// why the conservation law needs BOTH checks:
// dropping
// `isSpSubsequence` would
// have left the branch just as blind to a broken
// rescue, only via a different
// code path; `conservationErrors` alone is real
// coverage for a DIFFERENT class of regression (an
// added pass destroying something the baseline DID
// have) and is kept for that.
it("the bind-shaped branch really discriminates: " +
   "an authored dying-gap byte survives the real " +
   "fusion rescue, both by direct subsequence AND " +
   "by the conservation oracle (hand-built, since " +
   "no generator here reaches the shape)", () => {
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
  const r = mergeLatinBlock(prev, parsed);
  expect(
    isSpSubsequence(
      stripJoiners(authoredSpConcat(prev)),
      stripJoiners(authoredSpConcat(r))
    )
  ).toBe(true);
  expect(
    conservationErrors([prev], [parsed], [r], "latin")
  ).toEqual([]);
});

// THE SP CONSERVATION LAW:
// renderSp(normalizeBlock(parseSp(x))).text === x
// for all x — the promote path is byte-identity.
//
// The laws above are stated over BLOCKS, so they
// never see the promote path: they start from a
// model that is already promoted. This one starts
// from BYTES a user can type — which is where loss
// lived (a cartouche's trapped cart-ext ejected
// past the "]" on the first load, "[jan=]" ->
// "[jan]="; and the old scheme-reset loss,
// "[jan.," -> "[jan,").
const rawBlock = (text: string): Block => {
  const parsed = parseSp(spInlinesFromText(text));
  return {
    anchors: parsed.anchors,
    gaps: parsed.gaps.map((sp) => ({
      sp,
      latin: "",
    })),
    spans: [],
  };
};
const conserved = (text: string): string =>
  renderSp(normalizeBlock(rawBlock(text))).text;

/** A LONE SURROGATE survives [...s] iteration as a
 *  ONE-unit string in the surrogate range. Marker
 *  offsets are UTF-16 indices into gap.sp, which is
 *  full of surrogate PAIRS, so an offset off a
 *  codepoint boundary would make renderSp cut one in
 *  half (reachable through
 *  splitBlock before the rebase). Asserted on the
 *  LAW so the guarantee is global, not per-pin. */
const loneSurrogates = (s: string): string[] =>
  [...s].filter(
    (c) =>
      c.length === 1 &&
      c.charCodeAt(0) >= 0xd800 &&
      c.charCodeAt(0) <= 0xdfff
  );

describe("SP conservation (promote path)", () => {
  it("renderSp(normalizeBlock(parseSp(x))).text " +
     "=== x over raw SP text, and never emits a " +
     "lone surrogate", () => {
    fc.assert(
      fc.property(arbSpText, (x) => {
        const out = conserved(x);
        return (
          out === x &&
          loneSurrogates(out).length === 0
        );
      }),
      { numRuns: 2000 }
    );
  });

  // SCOPE ADDITION (a) — the merge records the same
  // offsets promotion does — guarded by a LAW rather
  // than by hand pins: an SP no-op merge is what the
  // editor runs on every keystroke, and it is where
  // the offsets were being stripped.
  it("...and through an SP NO-OP MERGE (what the " +
     "editor runs per keystroke)", () => {
    fc.assert(
      fc.property(arbSpText, (x) => {
        const b = normalizeBlock(rawBlock(x));
        const merged = mergeBlock(
          b,
          parseSp(renderSp(b).inlines),
          "sp"
        );
        return (
          renderSp(merged).text === x &&
          checkBlock(merged).length === 0
        );
      }),
      { numRuns: 2000 }
    );
  });

  it("...and the promoted Block is a checked, " +
     "normalized fixpoint", () => {
    fc.assert(
      fc.property(arbSpText, (x) => {
        const once = normalizeBlock(rawBlock(x));
        return (
          checkBlock(once).length === 0 &&
          stable(normalizeBlock(once)) ===
            stable(once)
        );
      }),
      { numRuns: 2000 }
    );
  });

  // renderSp now emits a gap's map entries PER
  // PIECE (a gap with an interior marker
  // contributes more than one entry with the same
  // ref), so the map helpers' contract is re-checked
  // over this corpus — arbBlock mints no offsets and
  // cannot reach the split shape.
  it("the SP source map stays MONOTONE with " +
     "interior markers", () => {
    fc.assert(
      fc.property(arbSpText, (x) => {
        const map = renderSp(
          normalizeBlock(rawBlock(x))
        ).map;
        let from = 0;
        let to = 0;
        for (const e of map) {
          if (
            e.to < e.from ||
            e.from < from ||
            e.to < to
          ) {
            return false;
          }
          from = e.from;
          to = e.to;
        }
        return true;
      }),
      { numRuns: 2000 }
    );
  });

  // Anti-vacuity: the corpus must actually reach
  // promotions with NON-EDGE marker offsets, which
  // is the whole point of the law.
  // (The sample is 2000 rather than 500 so the
  // margin is wide: the shape lands in roughly 3% of
  // cases, which at 500 sat one bad draw away from
  // the threshold. The global seed in test/setup.ts
  // makes the count deterministic on top of that.)
  it("the corpus really mints interior marker " +
     "offsets", () => {
    const samples = fc.sample(arbSpText, 2000);
    const withOffset = samples.filter((x) =>
      normalizeBlock(rawBlock(x)).spans.some(
        (s) =>
          s.startOffset !== undefined ||
          s.endOffset !== undefined
      )
    );
    expect(withOffset.length).toBeGreaterThan(40);
  });

  // PINS. The first two REVERSE earlier pins that
  // asserted the opposite (a "trapped-char
  // canonicalization" hop). The reversal came from
  // live use: the hop ejected SEMANTIC content —
  // the cart-ext and naming chars between the last
  // glyph and "]" are the anatomy of an abbreviated
  // cartouche, so "[jan=]" reloading as "[jan]=" is
  // content loss, not canonicalization.
  describe("pinned shapes (the reported bug and " +
           "the fuzz corpus that found it)", () => {
    const G = (w: string): string =>
      codepointToChar(wordToCodepoint[w]);
    const CS = CARTOUCHE_START;
    const CE = CARTOUCHE_END;

    const shapes: Record<string, string> = {
      // the sighting, char for char
      "[jan=]": CS + G("jan") + CART_EXT + CE,
      "[jan+]": CS + G("jan") + SCALE + CE,
      "[jan-]": CS + G("jan") + STACK + CE,
      "[jan ]": CS + G("jan") + " " + CE,
      "[jan,]": CS + G("jan") + TALLY_CH + CE,
      // start side
      "[=jan]": CS + CART_EXT + G("jan") + CE,
      "[,jan]": CS + TALLY_CH + G("jan") + CE,
      "[ toki]": CS + " " + G("toki") + CE,
      // long glyphs take the same path
      "(jan=)": LONG_START + G("jan") + CART_EXT +
        LONG_END,
      // in context
      "toki[jan=]kala":
        G("toki") + CS + G("jan") + CART_EXT + CE +
        G("kala"),
      // interior gaps were already stable — pinned
      // so the fix cannot regress them
      "[jan=toki]":
        CS + G("jan") + CART_EXT + G("toki") + CE,
      // nesting: same-range pairs of two kinds keep
      // the typed nesting (the sortSpans kind
      // tie-break was what rewrote them)
      "([toki])":
        LONG_START + CS + G("toki") + CE + LONG_END,
      "[(toki)]":
        CS + LONG_START + G("toki") + LONG_END + CE,
      // scheme-reset shapes (the old naming bug's
      // second half; these are the debugger's own)
      "[jan.,]":
        CS + G("jan") + MIDDLE_DOT_CH + TALLY_CH +
        CE,
      "[toki::]":
        CS + G("toki") + COLON_CH + COLON_CH + CE,
      "[jan.A.]":
        CS + G("jan") + MIDDLE_DOT_CH + "A" +
        MIDDLE_DOT_CH + CE,
      "[janA,]":
        CS + G("jan") + "A" + TALLY_CH + CE,
      "[jan:.]":
        CS + G("jan") + COLON_CH + MIDDLE_DOT_CH +
        CE,
      // ...and the runs that DO fold stay folded
      "[jan..]":
        CS + G("jan") + MIDDLE_DOT_CH +
        MIDDLE_DOT_CH + CE,
    };

    for (const [name, text] of Object.entries(
      shapes
    )) {
      it(`conserves ${name}`, () => {
        expect(conserved(text)).toBe(text);
      });
    }

    it("a naming char really did fold in the " +
       "folding shapes (anti-vacuity)", () => {
      const b = normalizeBlock(
        rawBlock(shapes["[jan..]"])
      );
      expect(b.anchors[0].nameScheme).toEqual({
        style: "morae",
        count: 2,
      });
      // ...and did NOT in the reset shape: the
      // second style stays literal gap content
      const r = normalizeBlock(
        rawBlock(shapes["[jan.,]"])
      );
      expect(r.anchors[0].nameScheme).toEqual({
        style: "morae",
        count: 1,
      });
      expect(r.gaps[1].sp).toBe(TALLY_CH);
    });

    // The one variation-selector interaction 5.5
    // fixes (arbitraries exclusion 2): a VS after a
    // naming char cannot fold, because
    // anchorSpText emits the variation BEFORE the
    // scheme chars — folding re-rendered
    // "[jan,VS]" as "[jan VS,]".
    it("conserves a variation selector typed " +
       "AFTER a naming char", () => {
      const text =
        CS +
        G("jan") +
        TALLY_CH +
        String.fromCodePoint(
          VARIATION_SELECTOR_BASE + 2
        ) +
        CE;
      expect(conserved(text)).toBe(text);
    });
  });
});

describe("normal form", () => {
  it("generated blocks are normalizeBlock " +
     "fixpoints and pass checkBlock", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          arbBlock,
          arbNameLines,
          arbRepetitive
        ),
        (b) => {
          return (
            checkBlock(b).length === 0 &&
            stable(normalizeBlock(b)) === stable(b)
          );
        }
      ),
      RUNS
    );
  });

  it("normalizeBlock is idempotent over " +
     "DENORMALIZED input (facet folds + span " +
     "promotion)", () => {
    fc.assert(
      fc.property(arbRawBlock, (b) => {
        const once = normalizeBlock(b);
        return (
          stable(normalizeBlock(once)) ===
            stable(once) &&
          checkBlock(once).length === 0
        );
      }),
      RUNS
    );
  });

  it("normalizeLipu is idempotent", () => {
    fc.assert(
      fc.property(arbLipu, (l) => {
        const once = normalizeLipu(l);
        return (
          stable(normalizeLipu(once)) ===
            stable(once) &&
          once.blocks.every(
            (b) => checkBlock(b).length === 0
          )
        );
      }),
      RUNS
    );
  });

  // Anti-vacuity guard: the idempotence law above
  // must actually travel THROUGH normal-form Block
  // splits — the unit test never reached one.
  it("the Lipu corpus really reaches normal-form " +
     "Block splits", () => {
    const samples = fc.sample(arbLipu, 200);
    const split = samples.filter(
      (l) =>
        normalizeLipu(l).blocks.length >
        l.blocks.length
    );
    expect(split.length).toBeGreaterThan(20);
  });

  it("parseSp output normalizes to a checked " +
     "fixpoint", () => {
    fc.assert(
      fc.property(arbBlock, (b) => {
        const parsed = parseSp(
          renderSp(b).inlines
        );
        const raw: Block = {
          anchors: parsed.anchors,
          gaps: parsed.gaps.map((sp) => ({
            sp,
            latin: "",
          })),
          spans: [],
        };
        const nb = normalizeBlock(raw);
        return (
          checkBlock(nb).length === 0 &&
          stable(normalizeBlock(nb)) === stable(nb)
        );
      }),
      RUNS
    );
  });
});

describe("source maps (entryRangeAt / " +
         "rangeForEntries helpers)", () => {
  const monotone = (map: SourceEntry[]): boolean => {
    let from = 0;
    let to = 0;
    for (const e of map) {
      if (
        e.to < e.from ||
        e.from < from ||
        e.to < to
      ) {
        return false;
      }
      from = e.from;
      to = e.to;
    }
    return true;
  };
  const coversItself = (
    map: SourceEntry[]
  ): boolean =>
    map.every((e, i) => {
      if (e.to === e.from) return true;
      const r = entryRangeAt(map, e.from, e.to);
      if (!r || r.start > i || r.end < i) {
        return false;
      }
      const back = rangeForEntries(
        map,
        r.start,
        r.end
      );
      return (
        !!back &&
        back.from <= e.from &&
        back.to >= e.to
      );
    });

  it("both renderers emit monotone maps whose " +
     "entries the query helpers recover", () => {
    fc.assert(
      fc.property(arbBlock, (b) => {
        const sp = renderSp(b).map;
        const la = renderLatin(b).map;
        return (
          monotone(sp) &&
          monotone(la) &&
          coversItself(sp) &&
          coversItself(la)
        );
      }),
      RUNS
    );
  });
});

/**
 * COPY-ON-WRITE (the shared-undo prerequisite).
 * Undo entries hold REFERENCES to the model's lipu
 * and to its Block objects — that is exactly what
 * keeps an incremental entry cheap, and it makes
 * the whole stack only as sound as
 * this law: a merge or a normalize never mutates
 * what it was handed. One in-place write would
 * silently rewrite history that was already
 * recorded, with no test anywhere else to catch it.
 *
 * Each block is paired with a DIFFERENT block's
 * parse rather than its own: a no-op merge exercises
 * far fewer paths than a real diff.
 */
describe("copy-on-write (shared-undo prerequisite)", () => {
  const rotate = (lipu: Lipu, i: number): Block =>
    lipu.blocks[(i + 1) % lipu.blocks.length];

  it("mergeSpBlock never mutates its inputs", () => {
    fc.assert(
      fc.property(arbLipu, (lipu) => {
        const before = JSON.stringify(lipu);
        lipu.blocks.forEach((b, i) => {
          const parsed = parseSp(
            renderSp(rotate(lipu, i)).inlines
          );
          const pBefore = JSON.stringify(parsed);
          mergeSpBlock(b, parsed);
          expect(JSON.stringify(parsed)).toBe(
            pBefore
          );
        });
        expect(JSON.stringify(lipu)).toBe(before);
      })
    );
  });

  it("mergeLatinBlock never mutates its inputs", () => {
    fc.assert(
      fc.property(arbLipu, (lipu) => {
        const before = JSON.stringify(lipu);
        lipu.blocks.forEach((b, i) => {
          const parsed = parseLatin(
            renderLatin(rotate(lipu, i)).inlines
          );
          const pBefore = JSON.stringify(parsed);
          mergeLatinBlock(b, parsed);
          expect(JSON.stringify(parsed)).toBe(
            pBefore
          );
        });
        expect(JSON.stringify(lipu)).toBe(before);
      })
    );
  });

  it("mergeStructural never mutates its inputs " +
     "(both sides)", () => {
    fc.assert(
      fc.property(arbLipu, (lipu) => {
        const before = JSON.stringify(lipu);
        const spSides = lipu.blocks.map((_, i) =>
          parseSp(renderSp(rotate(lipu, i)).inlines)
        );
        const latinSides = lipu.blocks.map((_, i) =>
          parseLatin(
            renderLatin(rotate(lipu, i)).inlines
          )
        );
        const spBefore = JSON.stringify(spSides);
        const latinBefore =
          JSON.stringify(latinSides);
        mergeStructural(lipu.blocks, spSides, "sp");
        mergeStructural(
          lipu.blocks,
          latinSides,
          "latin"
        );
        expect(JSON.stringify(spSides)).toBe(
          spBefore
        );
        expect(JSON.stringify(latinSides)).toBe(
          latinBefore
        );
        expect(JSON.stringify(lipu)).toBe(before);
      })
    );
  });

  it("normalizeLipu never mutates its input", () => {
    fc.assert(
      fc.property(arbLipu, (lipu) => {
        const before = JSON.stringify(lipu);
        normalizeLipu(lipu);
        expect(JSON.stringify(lipu)).toBe(before);
      })
    );
  });
});

// Pinned counterexamples: regressions stay pinned
// regardless of fast-check seed. When a property
// above finds a counterexample, FIX the code, then
// pin the shrunken case here.
describe("pinned counterexamples", () => {
  it("sp space after an unmarked verbatim folds " +
     "into the anchor (ported legacy pin)", () => {
    const b: Block = {
      anchors: [{ kind: "verbatim", text: "aa" }],
      gaps: [
        { sp: "", latin: "" },
        { sp: " ", latin: "" },
      ],
      spans: [],
    };
    expect(spCanon(spRoundTrip(b)))
      .toBe(spCanon(b));
    // the carve-out moves a boundary, not a byte
    expect(renderSp(spRoundTrip(b)).text)
      .toBe(renderSp(b).text);
  });

  it("sp space after an unmarked verbatim with " +
     "latin gap content (ported legacy pin: the " +
     "latin content survives on the shifted " +
     "gap)", () => {
    const b: Block = {
      anchors: [{ kind: "verbatim", text: "aa" }],
      gaps: [
        { sp: "", latin: "" },
        { sp: " ", latin: "," },
      ],
      spans: [],
    };
    const out = spRoundTrip(b);
    expect(spCanon(out)).toBe(spCanon(b));
    expect(
      out.gaps.map((g) => g.latin)
    ).toEqual(["", ","]);
  });

  it("'toki !' survives a Latin no-op " +
     "byte-for-byte (re-absorption)", () => {
    const b: Block = {
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "verbatim", text: "!" },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: " ", latin: " " },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    expect(latinRoundTrip(b)).toEqual(b);
    expect(renderSp(latinRoundTrip(b)).text)
      .toBe(renderSp(b).text);
  });

  it("'aa ' trailing-space flip survives a " +
     "Latin no-op (re-absorption across the " +
     "anchor/gap split)", () => {
    const b: Block = {
      anchors: [
        { kind: "verbatim", text: "aa " },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    expect(latinRoundTrip(b)).toEqual(b);
  });

  it("zero-anchor blocks satisfy every law", () => {
    const b: Block = {
      anchors: [],
      gaps: [{ sp: " \n ", latin: ", \n" }],
      spans: [],
    };
    expect(spCanon(spRoundTrip(b)))
      .toBe(spCanon(b));
    expect(latinRoundTrip(b)).toEqual(b);
    expect(checkBlock(b)).toEqual([]);
  });

  // An earlier version of the pin above used latin
  // "hello, \n". That is NOT a no-op shape:
  // gap.latin letters are Latin ANCHOR material
  // (generator exclusion 1), so the Latin side
  // legitimately GAINS an anchor. Pinned here as
  // the honest current behavior rather than
  // deleted, so
  // the exclusion is visible instead of implied.
  it("letters in gap.latin are anchor material: " +
     "the Latin side gains an anchor (NOT a " +
     "no-op)", () => {
    const b: Block = {
      anchors: [],
      gaps: [{ sp: " ", latin: "hello, " }],
      spans: [],
    };
    const out = latinRoundTrip(b);
    expect(out.anchors).toEqual([
      { kind: "verbatim", text: "hello",
        marked: true },
    ]);
    // the SP side keeps its content: the block-owned
    // gap.sp rides gaps[0]
    expect(out.gaps[0].sp).toBe(" ");
  });

  it("name-lines corpus: an SP deletion of one " +
     "line's word never deletes other lines' " +
     "latin bytes", () => {
    // [kili] li pona \n [kili] li pona
    const b: Block = {
      anchors: [
        { kind: "word", word: "kili",
          nameScheme: { style: "letters",
            count: 1 } },
        { kind: "word", word: "li" },
        { kind: "word", word: "pona" },
        { kind: "word", word: "kili",
          nameScheme: { style: "letters",
            count: 1 } },
        { kind: "word", word: "li" },
        { kind: "word", word: "pona" },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: " ", latin: " " },
        { sp: " ", latin: " " },
        { sp: "\n", latin: "\n" },
        { sp: " ", latin: " " },
        { sp: " ", latin: " " },
        { sp: "", latin: "" },
      ],
      spans: [
        cart(0, 0),
        cart(3, 3),
      ],
    };
    // SP edit deletes the SECOND line's pona
    const parsed = parseSp(renderSp(b).inlines);
    const next = {
      anchors: parsed.anchors.slice(0, 5),
      gaps: parsed.gaps.slice(0, 6),
    };
    const out = mergeBlock(b, next, "sp");
    const latin = out.gaps
      .map((g) => g.latin)
      .join("|");
    expect(latin.includes("\n")).toBe(true);
    expect(out.anchors).toHaveLength(5);
  });

  // CARVE-OUT PIN: an earlier parser folded a
  // naming char onto the last WORD token even
  // across intervening unmarked Latin text, which
  // MOVES the char on re-render. This parser
  // refuses to fold past pending Latin, so the same
  // bytes round-trip. The byte-parity law never
  // sees this shape (the generator mints no naming
  // chars in gaps); this pin asserts the current
  // behavior directly and demonstrates that the two
  // really do differ here, so nobody "fixes" this
  // parser toward the old one later.
  // FROZEN_LEGACY_REORDERED below is the old
  // parser's actual (buggy) output for this exact
  // `text`, captured before it was deleted — the
  // comma moves from after "xq" to before it.
  it("naming char after unmarked Latin inside a " +
     "cartouche: the bytes round-trip where an " +
     "earlier parser reordered them", () => {
    const text =
      CARTOUCHE_START +
      renderSp({
        anchors: [{ kind: "word", word: "kili" }],
        gaps: [
          { sp: "", latin: "" },
          { sp: "", latin: "" },
        ],
        spans: [],
      }).text +
      "xq" +
      TALLY_CH +
      CARTOUCHE_END;
    const inlines = spInlinesFromText(text);

    const cur = parseSp(inlines);
    const curText = renderSp({
      anchors: cur.anchors,
      gaps: cur.gaps.map((sp) => ({
        sp,
        latin: "",
      })),
      spans: [],
    }).text;
    expect(curText).toBe(text);
    // the naming char stayed LITERAL gap content
    expect(
      cur.anchors.some((a) => a.nameScheme)
    ).toBe(false);

    // the old parser's own inlines-to-text join,
    // over the raw codepoints its renderer actually
    // produced for this `text` (frozen; see comment
    // above).
    const FROZEN_LEGACY_REORDERED =
      String.fromCodePoint(
        0xf1990, 0xf191a, 0x2c, 0x78, 0x71, 0xf1991
      );
    expect(FROZEN_LEGACY_REORDERED).not.toBe(text);
  });

  // The SP-edits-only gate, SP half: an SP-side
  // bare substitution DECLINES re-absorption so the
  // parse keeps facet/kind authority.
  it("SP-edits-only gate, SP side: a markedness " +
     "flip is a " +
     "replacement, not a re-anchor (parse wins)", () => {
    const prev: Block = {
      anchors: [
        { kind: "verbatim", text: "hello" },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "," },
      ],
      spans: [],
    };
    const out = mergeBlock(
      prev,
      {
        anchors: [
          { kind: "verbatim", text: "hello",
            marked: true },
        ],
        gaps: ["", ""],
      },
      "sp"
    );
    expect(out.anchors).toEqual([
      { kind: "verbatim", text: "hello",
        marked: true },
    ]);
    // ownership still carries the other side
    expect(out.gaps[1].latin).toBe(",");
  });

  // The SP-edits-only gate, LATIN half: the Latin
  // parse has NO authority over kind, so
  // re-absorption never declines there — otherwise
  // an un-glyphed verbatim "toki" would be
  // reclassified into a word and GLYPHED, rewriting
  // SP bytes on a pure Latin no-op.
  it("SP-edits-only gate, Latin side: an " +
     "un-glyphed verbatim " +
     "'toki' survives a Latin no-op with its SP " +
     "bytes", () => {
    const b: Block = {
      anchors: [
        { kind: "verbatim", text: "toki" },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: " ", latin: " " },
      ],
      spans: [],
    };
    const out = latinRoundTrip(b);
    expect(out).toEqual(b);
    expect(renderSp(out).text)
      .toBe(renderSp(b).text);
  });

  // Decided behavior: NFD combining marks
  // CONTINUE a letter run in parseLatin, and no NFC
  // normalization happens anywhere — the author's
  // original bytes survive a Latin no-op.
  it("NFD verbatim survives a Latin no-op with " +
     "its exact bytes (no NFC rewrite)", () => {
    const nfd = "cafe\u0301";
    const b: Block = {
      anchors: [
        { kind: "verbatim", text: nfd,
          marked: true },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const out = latinRoundTrip(b);
    expect(out).toEqual(b);
    expect(out.anchors[0].text).toBe(nfd);
    expect(out.anchors[0].text).not.toBe(
      nfd.normalize("NFC")
    );
  });

  // DUPLICATE STRANDING (found by the
  // conservation law).
  // When alignment matched on identity KEYS, two
  // anchors the edited side cannot tell apart were
  // still split, and the split was arbitrary — so
  // an unmatched prev anchor could be stranded in a
  // region its own text never reaches, deleted with
  // the gap it owns. Content destroyed by a no-op.
  // Two distinct shapes of it:
  //   #1/#2/#3 the twin sits across the region
  //     boundary as a fresh insertion;
  //   #4 the anchor's text re-tokenized into GAP
  //     content one region to the right, so even a
  //     leftover-PAIRING repair could not reach it
  //     (there is no output position to pair with).
  // Both are closed by aligning on edited-side
  // rendered text (merge.ts ALIGNMENT KEY note).
  //
  // Discrimination, each verified by reverting
  // merge.ts to its pre-fix alignment: #1, #2 and
  // #4 FAIL there.
  //
  // #3 is different and is NOT a claim about the
  // shipped code: it discriminates against an
  // ALTERNATIVE FIX PATH that was tried and
  // rejected. Applied to the pre-fix code, flipping
  // lcsCore's tie-break (`>=` -> `>`) makes #1 pass
  // and #3 fail — which is how we learned the
  // tie-break was not the fix, only a way to move
  // the bug to its mirror image. The shipped
  // alignment passes all four; #3 stays pinned so
  // nobody revisits that route.
  it("stranding #1: an un-glyphed verbatim next " +
     "to its own glyph survives a Latin no-op", () => {
    const b: Block = {
      anchors: [
        { kind: "verbatim", text: "toki" },
        { kind: "word", word: "toki" },
        { kind: "verbatim", text: "xq" },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: " " },
        { sp: "", latin: " " },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const out = latinRoundTrip(b);
    expect(renderSp(out).text)
      .toBe(renderSp(b).text);
    expect(out).toEqual(b);
  });

  it("stranding #2: a marked/unmarked verbatim " +
     "twin keeps its mark AND its owned " +
     "IDEO_SPACE", () => {
    const b: Block = {
      anchors: [
        { kind: "verbatim", text: "xq" },
        { kind: "verbatim", text: "xq",
          marked: true },
        { kind: "verbatim", text: "qqq" },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: IDEO_SPACE, latin: " " },
        { sp: IDEO_SPACE, latin: " " },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const out = latinRoundTrip(b);
    expect(out.anchors[0].marked).toBeUndefined();
    expect(out.gaps.map((g) => g.sp)).toEqual([
      "", IDEO_SPACE, IDEO_SPACE, "",
    ]);
    expect(out).toEqual(b);
  });

  it("stranding #3 (MIRROR): the shape that " +
     "defeats the LCS tie-break flip", () => {
    const b: Block = {
      anchors: [
        { kind: "verbatim", text: "xq" },
        { kind: "word", word: "toki" },
        { kind: "verbatim", text: "toki" },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: " " },
        { sp: "", latin: " " },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const out = latinRoundTrip(b);
    expect(renderSp(out).text)
      .toBe(renderSp(b).text);
    expect(out).toEqual(b);
  });

  it("stranding #4: an anchor whose text " +
     "re-tokenizes into GAP content is not " +
     "stranded by a duplicate alignment", () => {
    const b: Block = {
      anchors: [
        { kind: "verbatim", text: "toki",
          marked: true },
        // NOT "3.14": a digit run with an INTERIOR
        // dot binds whole into one verbatim token
        // (digits ride but the dot still triggers),
        // which would make this anchor's text mint
        // a NEW bound anchor on reparse rather than
        // dissolve to gap, defeating this pin's
        // actual point. A dot-free digit run has no
        // interior punctuation at all, so it
        // dissolves to invisible per-digit gap
        // bytes — the shape this pin needs.
        { kind: "verbatim", text: "314",
          marked: true },
        { kind: "word", word: "toki" },
        { kind: "verbatim", text: "hi there",
          marked: true },
      ],
      gaps: [
        { sp: CARTOUCHE_END, latin: "" },
        { sp: IDEO_SPACE, latin: "" },
        { sp: "", latin: "" },
        { sp: "", latin: " " },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    // the Latin projection really does dissolve
    // the "314" anchor into gap text — the
    // side-gated tokenization difference, one
    // region away from where the key alignment put
    // its owner
    expect(renderLatin(b).text).toBe(
      "toki314toki hi there"
    );
    const out = latinRoundTrip(b);
    expect(renderSp(out).text)
      .toBe(renderSp(b).text);
    expect(out).toEqual(b);
  });

  // Future pins land here: when fc.assert above
  // reports a counterexample, reproduce it as a
  // fixed Block in this describe before fixing,
  // and keep it after.
});
