import { describe, it, expect } from "vitest";
import {
  matchStructuralPairs,
  normalizeBlock,
  normalizeLipu,
  removePairChars,
} from "./normalize";
import {
  CARTOUCHE_START,
  CARTOUCHE_END,
  LONG_START,
  LONG_END,
  MIDDLE_DOT_CH,
  IDEO_SPACE,
  CART_EXT,
} from "./chars";
import { checkBlock } from "./types";
import { renderSp } from "./render-sp";
import {
  parseSp,
  spInlinesFromText,
} from "./parse-sp";
import {
  glyph,
  gap,
  word,
  block,
  mkLipu,
  cart,
  span,
} from "../../test/helpers";

const CS = CARTOUCHE_START;
const CE = CARTOUCHE_END;
const LS = LONG_START;
const LE = LONG_END;

describe("matchStructuralPairs", () => {
  it("matches a simple pair with covered " +
     "anchors", () => {
    const pairs = matchStructuralPairs([
      CS, "", CE,
    ]);
    expect(pairs).toEqual([
      {
        kind: "cartouche",
        start: { gap: 0, offset: 0,
          length: CS.length },
        end: { gap: 2, offset: 0,
          length: CE.length },
        from: 0,
        to: 1,
        depth: 0,
        ordinal: 0,
      },
    ]);
  });

  it("computes depth and per-depth ordinals " +
     "innermost-first", () => {
    // [ [ x ] ] [ y ]  (nested pair then sibling)
    const pairs = matchStructuralPairs([
      CS + CS, CE + CE + CS, CE,
    ]);
    const key = (p: (typeof pairs)[0]) =>
      [p.kind, p.depth, p.ordinal, p.from, p.to]
        .join("/");
    expect(pairs.map(key).sort()).toEqual([
      "cartouche/0/0/0/0",
      "cartouche/0/1/1/1",
      "cartouche/1/0/0/0",
    ].sort());
  });

  it("rejects crossing pairs of different " +
     "kinds — all stay transitional", () => {
    // [ ( ] )  in one gap: candidates cross
    expect(
      matchStructuralPairs([CS + LS + CE + LE])
    ).toEqual([]);
  });

  it("keeps an empty pair (to < from) in the " +
     "result for callers to filter", () => {
    const pairs = matchStructuralPairs([CS + CE]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].to).toBeLessThan(
      pairs[0].from
    );
  });

  it("leaves stray unmatched markers out", () => {
    expect(
      matchStructuralPairs([CE, CS])
    ).toEqual([]);
  });
});

describe("removePairChars", () => {
  it("removes exactly the pair chars, later " +
     "offsets first", () => {
    const gaps = [gap(CS + " " + CS), gap(CE)];
    const pairs = matchStructuralPairs(
      gaps.map((g) => g.sp)
    );
    expect(pairs).toHaveLength(1);
    expect(
      removePairChars(gaps, pairs)
    ).toEqual([gap(CS + " "), gap("")]);
  });
});

describe("normalizeBlock — promotion", () => {
  it("promotes a matched pair covering an " +
     "anchor", () => {
    const b = block({
      anchors: [word("toki")],
      gaps: [gap(CS), gap(CE + " ")],
    });
    expect(normalizeBlock(b)).toEqual({
      anchors: [word("toki")],
      gaps: [gap(""), gap(" ")],
      spans: [
        cart(0, 0),
      ],
    });
  });

  it("never promotes an empty pair (typing [ " +
     "then ] never self-deletes)", () => {
    const b = block({
      anchors: [word("toki")],
      gaps: [gap(CS + CE), gap()],
    });
    expect(normalizeBlock(b)).toEqual(b);
  });

  it("keeps crossing pairs transitional", () => {
    const b = block({
      anchors: [word("toki")],
      gaps: [gap(CS + LS), gap(CE + LE)],
    });
    expect(normalizeBlock(b)).toEqual(b);
  });

  it("promotes nested pairs innermost and " +
     "outermost", () => {
    const b = block({
      anchors: [word("toki"), word("pona")],
      gaps: [gap(CS), gap(LS), gap(LE + CE)],
    });
    expect(normalizeBlock(b).spans).toEqual([
      cart(0, 1),
      span("long", 1, 1),
    ]);
  });

  it("is idempotent on promoted output", () => {
    const b = block({
      anchors: [word("toki")],
      gaps: [gap(CS), gap(CE)],
    });
    const once = normalizeBlock(b);
    expect(normalizeBlock(once)).toEqual(once);
  });

  it("checkBlock accepts a properly-nested " +
     "structural span pair (long inside " +
     "cartouche)", () => {
    const b = block({
      anchors: [word("toki"), word("pona")],
      gaps: [gap(CS), gap(LS), gap(LE + CE)],
    });
    const normalized = normalizeBlock(b);
    expect(normalized.spans).toEqual([
      cart(0, 1),
      span("long", 1, 1),
    ]);
    expect(checkBlock(normalized)).toEqual([]);
  });

  // Promotion and demotion are BYTE-PRESERVING for
  // ALL marker positions. An earlier canonicalization
  // — "[ toki]" promoting to " [toki]", the space
  // hopping OUTSIDE the markers — was reversed. Live
  // use showed that hop ejecting
  // SEMANTIC content (the cart-ext/naming chars of
  // an abbreviated cartouche), so the marker's
  // position inside its gap is now RECORDED
  // (Span.startOffset / endOffset) and re-emitted
  // there. The bytes are conserved and there is
  // nothing left to converge.
  it("promotion RECORDS a trapped gap char's side " +
     "of the marker: the bytes never move", () => {
    const b = block({
      anchors: [word("toki")],
      gaps: [gap(CS + " "), gap(CE)],
    });
    expect(renderSp(b).text).toBe(
      CS + " " + glyph("toki") + CE
    );

    const once = normalizeBlock(b);
    expect(once.gaps.map((g) => g.sp)).toEqual([
      " ",
      "",
    ]);
    // startOffset 0: the "[" sat BEFORE the space,
    // so the space stays interior to the span
    expect(once.spans).toEqual([
      cart(0, 0, { startOffset: 0 }),
    ]);
    expect(renderSp(once).text).toBe(
      CS + " " + glyph("toki") + CE
    );

    const twice = normalizeBlock(once);
    expect(twice).toEqual(once);
    expect(checkBlock(twice)).toEqual([]);
  });

  // The mirror shape: a char trapped between the
  // last covered anchor and the END marker — the
  // user-visible bug that triggered the reversal
  // ("[jan=]" reloading as "[jan]="). CART_EXT is a
  // surrogate pair, so the recorded endOffset is 2
  // UTF-16 units, computed from the char itself.
  it("a char trapped before the END marker stays " +
     "inside too ('[jan=]', the reported bug)", () => {
    const b = block({
      anchors: [word("kili")],
      gaps: [gap(CS), gap(CART_EXT + CE)],
    });
    const once = normalizeBlock(b);
    expect(once.gaps.map((g) => g.sp)).toEqual([
      "",
      CART_EXT,
    ]);
    expect(once.spans).toEqual([
      cart(0, 0, { endOffset: CART_EXT.length }),
    ]);
    expect(renderSp(once).text).toBe(
      CS + glyph("kili") + CART_EXT + CE
    );
    expect(checkBlock(once)).toEqual([]);
    expect(normalizeBlock(once)).toEqual(once);
  });
});

describe("normalizeBlock — facet folds", () => {
  it("moves ni variation 1-8 to niDirection", () => {
    const b = block({
      anchors: [
        { kind: "word", word: "ni",
          variation: 3 },
      ],
      gaps: [gap(), gap()],
    });
    expect(normalizeBlock(b).anchors).toEqual([
      { kind: "word", word: "ni",
        niDirection: 3 },
    ]);
  });

  it("demotes nameScheme outside cartouches to " +
     "gap chars", () => {
    const b = block({
      anchors: [
        { kind: "word", word: "nena",
          nameScheme: { style: "morae",
            count: 2 } },
      ],
      gaps: [gap(), gap(" ")],
    });
    expect(normalizeBlock(b)).toEqual(
      block({
        anchors: [word("nena")],
        gaps: [
          gap(),
          gap(MIDDLE_DOT_CH + MIDDLE_DOT_CH +
            " "),
        ],
      })
    );
  });

  it("keeps nameScheme inside a promoted span " +
     "and inside literal-char depth", () => {
    const withSpan = block({
      anchors: [
        { kind: "word", word: "nena",
          nameScheme: { style: "word" } },
      ],
      gaps: [gap(), gap()],
      spans: [
        cart(0, 0),
      ],
    });
    expect(normalizeBlock(withSpan))
      .toEqual(withSpan);
    const withChars = block({
      anchors: [
        { kind: "word", word: "nena",
          nameScheme: { style: "word" } },
      ],
      gaps: [gap(CS), gap()],
    });
    // unmatched "[" still counts as depth
    expect(
      normalizeBlock(withChars).anchors[0]
        .nameScheme
    ).toEqual({ style: "word" });
  });
});

describe("normalizeLipu — empty-line splits", () => {
  it("splits at a \\n\\n run, consuming the " +
     "whole run on both sides", () => {
    const b = block({
      anchors: [word("toki"), word("pona")],
      gaps: [
        gap(),
        gap(" \n\n ", ". \n\n"),
        gap(),
      ],
    });
    expect(normalizeLipu(mkLipu(b)).blocks).toEqual([
      block({
        anchors: [word("toki")],
        gaps: [gap(), gap(" ", ". ")],
      }),
      block({
        anchors: [word("pona")],
        gaps: [gap(" ", ""), gap()],
      }),
    ]);
  });

  it("spec checks: latin \"\\n\\n\" fully " +
     "consumed; \"one\\ntwo\" splits at the " +
     "interior run; no \\n stays left", () => {
    const cases: Array<[string, string, string]> =
      [
        ["\n\n", "", ""],
        [". \n\n", ". ", ""],
        ["one\ntwo", "one", "two"],
        [", ", ", ", ""],
      ];
    for (const [latin, l, r] of cases) {
      const b = block({
        anchors: [word("mi"), word("moku")],
        gaps: [gap(), gap("\n\n", latin), gap()],
      });
      const [left, right] =
        normalizeLipu(mkLipu(b)).blocks;
      expect(left.gaps[1].latin).toBe(l);
      expect(right.gaps[0].latin).toBe(r);
    }
  });

  it("whitespace-only lines are content and do " +
     "not split", () => {
    const b = block({
      anchors: [word("toki")],
      gaps: [gap(), gap("\n \n")],
    });
    expect(normalizeLipu(mkLipu(b)).blocks)
      .toEqual([b]);
  });

  it("never splits inside a structural span's " +
     "interior gaps", () => {
    const b = block({
      anchors: [word("toki"), word("pona")],
      gaps: [gap(), gap("\n\n"), gap()],
      spans: [
        cart(0, 1),
      ],
    });
    expect(normalizeLipu(mkLipu(b)).blocks)
      .toEqual([b]);
  });

  it("a \\n\\n run in gaps[0] splits off a " +
     "zero-anchor Block", () => {
    const b = block({
      anchors: [word("toki")],
      gaps: [gap(" \n\n"), gap()],
    });
    expect(normalizeLipu(mkLipu(b)).blocks).toEqual([
      block({ anchors: [], gaps: [gap(" ")] }),
      block({
        anchors: [word("toki")],
        gaps: [gap(), gap()],
      }),
    ]);
  });

  it("divides a straddling formatting span in " +
     "two", () => {
    const b = block({
      anchors: [word("toki"), word("pona")],
      gaps: [gap(), gap("\n\n"), gap()],
      spans: [
        span("bold", 0, 1),
      ],
    });
    const [l, r] = normalizeLipu(mkLipu(b)).blocks;
    expect(l.spans).toEqual([
      span("bold", 0, 0),
    ]);
    expect(r.spans).toEqual([
      span("bold", 0, 0),
    ]);
  });

  it("handles multiple runs in one gap " +
     "(iterates to fixpoint)", () => {
    const b = block({
      anchors: [],
      gaps: [gap("a\n\nb\n\nc")],
    });
    expect(
      normalizeLipu(mkLipu(b)).blocks.map(
        (x) => x.gaps[0].sp
      )
    ).toEqual(["a", "b", "c"]);
  });

  it("is idempotent", () => {
    const l = mkLipu(
      block({
        anchors: [word("toki")],
        gaps: [gap(IDEO_SPACE), gap("\n")],
      })
    );
    const once = normalizeLipu(l);
    expect(normalizeLipu(once)).toEqual(once);
  });

  // OFFSET REBASING AT A SPLIT. splitBlock SLICES
  // the splitting gap, so a marker offset that
  // indexes it has to move with its half. Without
  // the rebase the offset kept indexing the OLD
  // string: clampSpanOffsets then silently relocated
  // the marker and could leave it MID-SURROGATE,
  // which makes renderSp emit lone surrogates. Each
  // case below is stated as the raw
  // SP text a user types, and asserts the text comes
  // back unchanged.
  describe("marker offsets survive a split", () => {
    /** a lone surrogate survives [...s] iteration as
     *  a ONE-unit string in the surrogate range */
    const loneSurrogates = (s: string): string[] =>
      [...s].filter(
        (c) =>
          c.length === 1 &&
          c.charCodeAt(0) >= 0xd800 &&
          c.charCodeAt(0) <= 0xdfff
      );
    /** raw SP text -> the SP text of each Block the
     *  normalizer produces */
    const halves = (text: string): string[] => {
      const parsed = parseSp(
        spInlinesFromText(text)
      );
      const raw = block({
        anchors: parsed.anchors,
        gaps: parsed.gaps.map((sp) => gap(sp)),
      });
      return normalizeLipu(mkLipu(raw)).blocks.map(
        (b) => renderSp(b).text
      );
    };

    it("start-side: the trapped space is not " +
       "ejected by the split", () => {
      const tail = CS + " " + glyph("jan") + CE;
      expect(
        halves(glyph("toki") + "\n\n" + tail)
      ).toEqual([glyph("toki"), tail]);
    });

    it("end-side: an end offset in a gap the split " +
       "only RENUMBERS keeps its position", () => {
      const tail =
        CS + glyph("jan") + CART_EXT + CE;
      expect(
        halves(glyph("toki") + "\n\n" + tail)
      ).toEqual([glyph("toki"), tail]);
    });

    it("no lone surrogates: an offset that would " +
       "land mid-surrogate after the slice", () => {
      // three "\n"s make the consumed run an ODD
      // number of UTF-16 units, so an un-rebased
      // offset lands between the two units of the
      // second CART_EXT in the right half
      const tail =
        CS + CART_EXT + CART_EXT + glyph("jan") + CE;
      const out = halves(
        glyph("toki") + "\n\n\n" + tail
      );
      expect(out).toEqual([glyph("toki"), tail]);
      expect(loneSurrogates(out.join(""))).toEqual(
        []
      );
    });
  });
});

// findSplit segments each gap around recorded marker
// offsets before scanning for a "\n\n"+ run,
// mirroring the line-breaks normalizer's
// suppressedRanges authority (which reads RENDERED
// marker positions).
describe("findSplit marker offsets", () => {
  it(
    "endOffset with the run BEFORE it stays " +
      "interior: no split. DISCRIMINATING CASE — " +
      "the pre-fix predicate only checked " +
      "s.from < g <= s.to (gap fully inside a " +
      "span), which is false here (s.to=0, g=1), " +
      "so the old findSplit split this block; the " +
      "offset-aware predicate correctly does not",
    () => {
      const gap1 = "\n\n x";
      const b = block({
        anchors: [word("toki")],
        gaps: [gap(), gap(gap1)],
        spans: [
          cart(0, 0, { side: "sp", endOffset: gap1.indexOf(" x") }),
        ],
      });
      expect(normalizeLipu(mkLipu(b)).blocks).toEqual([
        b,
      ]);
    }
  );

  it(
    "endOffset with the run AFTER it stays " +
      "exterior: splits; the right block's " +
      "gaps[0].sp is empty and the left block " +
      "keeps the span with its offset intact",
    () => {
      const gap1 = "x\n\n";
      const b = block({
        anchors: [word("toki")],
        gaps: [gap(), gap(gap1)],
        spans: [
          cart(0, 0, { side: "sp", endOffset: 1 }),
        ],
      });
      const blocks = normalizeLipu(mkLipu(b)).blocks;
      expect(blocks).toHaveLength(2);
      expect(blocks[1].gaps[0].sp).toBe("");
      expect(blocks[0].spans).toEqual([
        cart(0, 0, { side: "sp", endOffset: 1 }),
      ]);
    }
  );

  it(
    "startOffset with the run BEFORE it stays " +
      "exterior: splits",
    () => {
      const inner = "q";
      const gap0 = "\n\n " + inner;
      const b = block({
        anchors: [word("toki")],
        gaps: [gap(gap0), gap()],
        spans: [
          cart(0, 0, { side: "sp", startOffset: "\n\n ".length }),
        ],
      });
      const blocks = normalizeLipu(mkLipu(b)).blocks;
      expect(blocks).toHaveLength(2);
    }
  );

  it(
    "a run straddling an endOffset splits neither " +
      "side (neither half has a 2+ run)",
    () => {
      const b = block({
        anchors: [word("toki")],
        gaps: [gap(), gap("\n\n")],
        spans: [
          cart(0, 0, { side: "sp", endOffset: 1 }),
        ],
      });
      expect(normalizeLipu(mkLipu(b)).blocks).toEqual([
        b,
      ]);
    }
  );

  it(
    "regression: an offset-free (edge-adjacent) " +
      "span's interior gap still does not split",
    () => {
      const b = block({
        anchors: [word("toki"), word("pona")],
        gaps: [gap(), gap("\n\n"), gap()],
        spans: [
          cart(0, 1),
        ],
      });
      expect(normalizeLipu(mkLipu(b)).blocks).toEqual([
        b,
      ]);
    }
  );

  it(
    "regression: a plain no-span run still splits",
    () => {
      const b = block({
        anchors: [word("toki")],
        gaps: [gap(), gap("\n\n")],
      });
      expect(
        normalizeLipu(mkLipu(b)).blocks
      ).toHaveLength(2);
    }
  );
});
