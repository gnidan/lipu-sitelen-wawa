import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  mergeLatinBlock,
  mergeStructural,
} from "./doc-merge";
import { withMark } from "./provenance";
import { parseLatin } from "./parse-latin";
import { renderSp } from "./render-sp";
import { renderLatin } from "./render-latin";
import { COLON_CH, MIDDLE_DOT_CH } from "./chars";
import {
  conservationErrors,
} from "../../test/provenance-oracle";
import type {
  Anchor,
  Block,
  ParsedSide,
} from "./types";
import {
  blockOf as block,
  cart,
  gap as g,
  glyph,
  latText,
  mvb as V,
  word,
} from "../../test/helpers";

/** Parser OUTPUT, hand-built. The real parser
 *  produces these shapes too; hand-building keeps a
 *  fixture's anchor split explicit (and lets a pin
 *  simulate parser shapes the live parser no longer
 *  emits). */
const side = (
  anchors: Anchor[],
  gaps: string[]
): ParsedSide => ({ anchors, gaps });

describe("fusion rescue — containment " +
         "signature", () => {
  // Fuse by EDITING THE INTERIOR GAP
  // (`toki pona` -> the space becomes `.`).
  it("live gap-edit fusion: authored sp \\n on " +
     "the dying trailing gap survives into the " +
     "slot after the token (per-block site pin)", () => {
    const prev = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        g(" ", " "),
        withMark(g("\n", ""), "sp", true),
      ]
    );
    const out = mergeLatinBlock(
      prev,
      side([V("toki.pona")], ["", ""])
    );
    expect(out.anchors).toEqual([V("toki.pona")]);
    // slot after A: carried gap-1 sp " ", then the
    // rescued dying gap-2 sp "\n", OR-marked
    expect(out.gaps[1].sp).toBe(" \n");
    expect(out.gaps[1].spAuthored).toBe(true);
  });

  // Fuse by DELETING THE SPACE in `toki. pona` —
  // hand-built twin of the LIVE variant below (same
  // fixture shape): the carried gap-1 default "\n"
  // is the ". "-triggered consumed break (prev
  // anchor "toki" + "." now sits inside
  // "toki.pona"); withdrawal strips exactly that
  // leading default "\n", leaving the rescued
  // authored "\n" alone.
  it("space-deletion fusion: authored sp " +
     "survives, the consumed trigger's default " +
     "break is withdrawn (per-block site pin)", () => {
    const prev = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        g("\n", ". "),
        withMark(g("\n", ""), "sp", true),
      ]
    );
    const out = mergeLatinBlock(
      prev,
      side([V("toki.pona")], ["", ""])
    );
    expect(out.gaps[1].sp).toBe("\n");
    expect(out.gaps[1].spAuthored).toBe(true);
  });

  // Single prev anchor — frozen pairing alone
  // carries everything; the >=2 restriction is
  // harmless at N=1 (no rescue must fire;
  // rescueFusedGaps is untouched by this fixture).
  // This fixture is the exact "toki." -> "toki.p"
  // consumed-trigger shape (hand-built here, typed
  // via the real parser in the withdrawal pins
  // below), so the carried default "\n" is
  // withdrawn to the block-final default "".
  it("single-anchor growth 'toki.' -> 'toki.p': " +
     "bytes carried by frozen pairing, no rescue " +
     "needed, and the consumed trigger's break is " +
     "withdrawn", () => {
    const prev = block(
      [word("toki")],
      [g("", ""), g("\n", ".")]
    );
    const out = mergeLatinBlock(
      prev,
      side([V("toki.p")], ["", ""])
    );
    expect(out.gaps).toHaveLength(2);
    expect(out.gaps[1].sp).not.toContain("\n");
    expect(out.gaps[1].sp).toBe("");
  });

  // Slot ORDER — carried gap p+1 bytes first,
  // then dying interiors in prev document order,
  // then the trailing gap.
  it("slot order: 3-anchor fusion appends " +
     "carried, then interior glyph, then trailing " +
     "\\n — exact bytes, OR mark, sane render", () => {
    const prev = block(
      [
        V("https"),
        V("example"),
        V("com"),
      ],
      [
        g("", ""),
        g(" ", "://"),
        withMark(g(glyph("toki"), "."), "sp", true),
        withMark(g("\n", ""), "sp", true),
      ]
    );
    const out = mergeLatinBlock(
      prev,
      side([V("https://example.com")], ["", ""])
    );
    expect(out.gaps[1].sp).toBe(
      " " + glyph("toki") + "\n"
    );
    expect(out.gaps[1].spAuthored).toBe(true);
    expect(renderSp(out).text).toBe(
      "https://example.com " + glyph("toki") + "\n"
    );
  });

  // Long-URL batch — 5 anchors -> 2 in one merge;
  // the authored dwell "\n\n" survives.
  it("long URL: 5 -> 2 anchors, authored dwell " +
     "\\n\\n survives", () => {
    const prev = block(
      [
        V("https"),
        V("example"),
        V("com"),
        V("path"),
        word("pona"),
      ],
      [
        g("", ""),
        g(" ", "://"),
        g(" ", "."),
        g(" ", "/"),
        withMark(g("\n\n", " "), "sp", true),
        g("", ""),
      ]
    );
    const out = mergeLatinBlock(
      prev,
      side(
        [
          V("https://example.com/path"),
          word("pona"),
        ],
        ["", " ", ""]
      )
    );
    expect(out.anchors).toHaveLength(2);
    const dwell = out.gaps.find(
      (gp) => gp.spAuthored && gp.sp.includes("\n\n")
    );
    expect(dwell).toBeDefined();
  });

  // Batch-safety claim (the function's doc
  // comment): TWO disjoint fusion
  // runs inside the SAME merge each rescue
  // independently, with an ordinary preserved
  // anchor between them.
  it("batch: two independent fusions in one merge " +
     "each rescue their own dying gap", () => {
    const prev = block(
      [
        V("aaa"),
        V("bbb"),
        word("mid"),
        V("ccc"),
        V("ddd"),
      ],
      [
        g("", ""),
        g(" ", ""),
        withMark(g("\n", ""), "sp", true),
        g(" ", ""),
        g("|", ""),
        withMark(g("\n\n", ""), "sp", true),
      ]
    );
    const out = mergeLatinBlock(
      prev,
      side(
        [
          V("aaabbb"),
          word("mid"),
          V("cccddd"),
        ],
        ["", "", "", ""]
      )
    );
    expect(out.anchors).toEqual([
      V("aaabbb"),
      word("mid"),
      V("cccddd"),
    ]);
    expect(out.gaps[1].sp).toBe(" \n");
    expect(out.gaps[1].spAuthored).toBe(true);
    expect(out.gaps[3].sp).toBe("|\n\n");
    expect(out.gaps[3].spAuthored).toBe(true);
    expect(
      conservationErrors(
        [prev],
        [side(
          [V("aaabbb"), word("mid"), V("cccddd")],
          ["", "", "", ""]
        )],
        [out],
        "latin"
      )
    ).toEqual([]);
  });

  // Containment discriminator: a genuine DELETION
  // is not a fusion — deleted formatting must NOT
  // be resurrected.
  it("deletion is not fusion: deleting ' pona' " +
     "does not rescue its trailing gap", () => {
    const prev = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        g(" ", " "),
        withMark(g("\n", ""), "sp", true),
      ]
    );
    const out = mergeLatinBlock(
      prev,
      latText("toki")
    );
    for (const gp of out.gaps) {
      expect(gp.sp).not.toContain("\n");
    }
  });

  // Reachable with the real parser — adjacent
  // alpha verbatims fused by space deletion. The
  // rescue fixes a silent-loss shape that shipped.
  it("real-parser alpha fusion ('ab cd' -> " +
     "'abcd'): authored sp survives today", () => {
    const p0 = mergeLatinBlock(
      block([], [g("", "")]),
      latText("ab cd")
    );
    expect(p0.anchors).toEqual([
      V("ab"),
      V("cd"),
    ]);
    const gaps = p0.gaps.map((gp, i) =>
      i === 2
        ? { ...gp, sp: "\n", spAuthored: true as const }
        : gp
    );
    const prev: Block = { ...p0, gaps };
    const out = mergeLatinBlock(
      prev,
      latText("abcd")
    );
    expect(out.anchors).toEqual([V("abcd")]);
    const rescued = out.gaps.find(
      (gp) => gp.spAuthored && gp.sp.includes("\n")
    );
    expect(rescued).toBeDefined();
  });
});

describe("fusion rescue: batch, flat path, mint, " +
         "spans, oracle", () => {
  const urlBlock = (): Block =>
    block(
      [V("https"), V("x"), word("pona")],
      [
        g("", ""),
        g(" ", "://"),
        withMark(g("\n", " "), "sp", true),
        g("", ""),
      ]
    );
  const boundSide = (): ParsedSide =>
    side(
      [V("https://x"), word("pona")],
      ["", " ", ""]
    );

  it("en-masse equal-count: one " +
     "mergeStructural call transitions BOTH " +
     "blocks, authored sp survives in both", () => {
    const out = mergeStructural(
      [urlBlock(), urlBlock()],
      [boundSide(), boundSide()],
      "latin"
    );
    expect(out).toHaveLength(2);
    for (const b of out) {
      expect(
        b.gaps.some(
          (gp) =>
            gp.spAuthored && gp.sp.includes("\n")
        )
      ).toBe(true);
    }
  });

  it("flat-path fusion (count change in the " +
     "same merge): authored sp survives through " +
     "the flat arm (flat-path site pin — a fixture " +
     "whose unpaired anchor coincides 1:1 with the " +
     "fresh boundary sentinel would pass on frozen " +
     "positional pairing alone, with this site " +
     "fully disabled. This fixture keeps a " +
     "surviving 'toki' between the fusion run and " +
     "the boundary so pairing can't coincidentally " +
     "absorb the dying anchor)", () => {
    // 1 prev block, 3-anchor URL fusion
    // (https/example/com), a surviving 'toki'
    // between the fusion and the paragraph split,
    // then 'pona' after the split -- forces the
    // flat path (1 block -> 2 parses) with the
    // fusion's dying interior NOT adjacent to the
    // fresh sentinel.
    const prev = block(
      [
        V("https"),
        V("example"),
        V("com"),
        word("toki"),
        word("pona"),
      ],
      [
        g("", ""),
        g(" ", "://"),
        g("", "."),
        withMark(g("\n", " "), "sp", true),
        g(" ", " "),
        g("", ""),
      ]
    );
    const out = mergeStructural(
      [prev],
      [
        side(
          [V("https://example.com"), word("toki")],
          ["", " ", ""]
        ),
        side([word("pona")], ["", ""]),
      ],
      "latin"
    );
    expect(out).toHaveLength(2);
    // the conservation oracle is QUIET on this
    // loss either way (it does not see authored-sp
    // loss on a dying gap), so this exact-byte pin
    // is the ONLY guard the flat-path site has.
    expect(out[0].gaps[1].sp).toBe(" \n");
    expect(out[0].gaps[1].spAuthored).toBe(true);
  });

  it("mint shape: '3:30' minted from " +
     "pure gap bytes — authored sp glyph survives " +
     "BEFORE the token, mark intact (no new code; " +
     "pins frozen routing)", () => {
    const prev = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(
          g(glyph("toki"), " 3:30 "),
          "sp",
          true
        ),
        g("", ""),
      ]
    );
    const out = mergeLatinBlock(
      prev,
      side(
        [word("toki"), V("3:30"), word("pona")],
        ["", " ", " ", ""]
      )
    );
    expect(out.gaps[1].sp).toContain(glyph("toki"));
    expect(out.gaps[1].spAuthored).toBe(true);
  });

  it("span death: a cartouche " +
     "over the fusing run DIES " +
     "(dropKindChangedSpans' standing job); its " +
     "interior naming bytes land as prose after " +
     "the token; prev is unmutated (undo " +
     "recovers)", () => {
    const prev: Block = {
      anchors: [word("toki"), word("pona")],
      gaps: [
        g("", ""),
        withMark(
          g(" " + MIDDLE_DOT_CH + " ", " "),
          "sp",
          true
        ),
        g("", ""),
      ],
      spans: [
        cart(0, 1),
      ],
    };
    const before = JSON.stringify(prev);
    const out = mergeLatinBlock(
      prev,
      side([V("toki:pona")], ["", ""])
    );
    expect(out.spans).toEqual([]);
    // the dying interior gap's mid-dot is the
    // CARRIED gap p+1 here (frozen pairing), so it
    // rides into the slot; a longer fused run's
    // naming bytes arrive via the rescue append —
    // either way they are prose in the slot now
    expect(out.gaps[1].sp).toContain(MIDDLE_DOT_CH);
    expect(out.gaps[1].spAuthored).toBe(true);
    // lipu-history holds references: input
    // immutability IS undo recoverability
    expect(JSON.stringify(prev)).toBe(before);
  });

  it("span death, 3-anchor variant: " +
     "the 2-anchor " +
     "pin above only exercises the CARRIED gap " +
     "(its own comment admits this); a 3-anchor " +
     "cartouche forces a genuine RESCUED interior " +
     "gap too, and only the rescue produces both " +
     "dots", () => {
    const dot = " " + MIDDLE_DOT_CH + " ";
    const prev: Block = {
      anchors: [
        word("toki"),
        word("pona"),
        word("li"),
      ],
      gaps: [
        g("", ""),
        withMark(g(dot, ""), "sp", true),
        withMark(g(dot, ""), "sp", true),
        g("", ""),
      ],
      spans: [
        cart(0, 2),
      ],
    };
    const out = mergeLatinBlock(
      prev,
      side([V("toki:pona:li")], ["", ""])
    );
    expect(out.spans).toEqual([]);
    // carried gap (prev gap 1) + rescued gap
    // (prev gap 2) concatenated, both dots present
    expect(out.gaps[1].sp).toBe(dot + dot);
    expect(out.gaps[1].spAuthored).toBe(true);
  });

  it("the conservation oracle stays quiet on a " +
     "rescued fusion merge — no new whitelist " +
     "entry", () => {
    const prev = urlBlock();
    const s = boundSide();
    const out = mergeLatinBlock(prev, s);
    expect(
      conservationErrors([prev], [s], [out], "latin")
    ).toEqual([]);
  });
});

describe("verbatim-binding transition through " +
         "the REAL parser", () => {
  it("LIVE gap-edit fusion: 'toki pona' + authored \\n, then " +
     "the space becomes '.' — one bound anchor, " +
     "authored sp survives, SP shows the literal " +
     "text", () => {
    const p0 = mergeLatinBlock(
      block([], [g("", "")]),
      latText("toki pona")
    );
    const gaps = p0.gaps.map((gp, i) =>
      i === 2
        ? { ...gp, sp: "\n", spAuthored: true as const }
        : gp
    );
    const out = mergeLatinBlock(
      { ...p0, gaps },
      latText("toki.pona")
    );
    expect(out.anchors).toEqual([V("toki.pona")]);
    expect(out.gaps[1].sp).toContain("\n");
    expect(out.gaps[1].spAuthored).toBe(true);
    expect(renderSp(out).text).toContain(
      "toki.pona"
    );
  });

  // The ". " gap's sentence-rule "\n" is consumed
  // into "toki.pona" (fusion), so
  // withdrawConsumedBreaks removes it, leaving only
  // the authored final break — never a stray
  // two-break sum ("\n\n").
  it("LIVE space-deletion fusion: deleting the space in 'toki. pona' " +
     "fuses; authored sp survives, the consumed " +
     "trigger's stray default break is withdrawn", () => {
    const p0 = mergeLatinBlock(
      block([], [g("", "")]),
      latText("toki. pona")
    );
    // the sentence rule fired on the fresh ". "
    // gap at build time
    expect(p0.gaps[1].sp).toBe("\n");
    const gaps = p0.gaps.map((gp, i) =>
      i === 2
        ? { ...gp, sp: "\n", spAuthored: true as const }
        : gp
    );
    const out = mergeLatinBlock(
      { ...p0, gaps },
      latText("toki.pona")
    );
    expect(out.gaps[1].sp).toBe("\n");
    expect(out.gaps[1].spAuthored).toBe(true);
  });

  it("en-masse: one whole-doc no-op reparse " +
     "transitions every URL-shaped run; authored " +
     "sp survives in untouched blocks; ONE merge", () => {
    // pre-transition prev needs the OLD anchor
    // shape; build it hand-split since the live
    // parser now binds
    const pre = (): Block =>
      block(
        [V("https"), V("x"), word("pona")],
        [
          g("", ""),
          g(" ", "://"),
          withMark(g("\n", " "), "sp", true),
          g("", ""),
        ]
      );
    const prevBlocks = [pre(), pre()];
    const sides = prevBlocks.map((b) =>
      parseLatin(renderLatin(b).inlines)
    );
    const out = mergeStructural(
      prevBlocks,
      sides,
      "latin"
    );
    expect(out).toHaveLength(2);
    for (const b of out) {
      expect(
        b.anchors.some(
          (a) =>
            a.kind === "verbatim" &&
            a.text === "https://x"
        )
      ).toBe(true);
      expect(
        b.gaps.some(
          (gp) =>
            gp.spAuthored && gp.sp.includes("\n")
        )
      ).toBe(true);
    }
  });

  // A fixture whose dying gap IS the split seam
  // passes with `rescueFusedGaps` completely
  // disabled (split routing alone carries the byte)
  // and adds no rescue coverage — so this one keeps
  // a surviving "toki" between the fusion and the
  // split boundary, with the real parser on both
  // sides (`latText(...)`, not hand-built
  // `side(...)`). Mutation-verified: stubbing
  // `rescueFusedGaps` turns this RED (the authored
  // "\n" and its OR-mark both vanish from
  // `out[0].gaps[1]`).
  it("flat-path LIVE: Enter splits while the " +
     "URL fuses (count change, real parser both " +
     "sides)", () => {
    const prev = block(
      [
        V("https"),
        V("example"),
        V("com"),
        word("toki"),
        word("pona"),
      ],
      [
        g("", ""),
        g(" ", "://"),
        g("", "."),
        withMark(g("\n", " "), "sp", true),
        g(" ", " "),
        g("", ""),
      ]
    );
    const out = mergeStructural(
      [prev],
      [
        latText("https://example.com toki"),
        latText("pona"),
      ],
      "latin"
    );
    expect(out).toHaveLength(2);
    expect(out[0].anchors).toEqual([
      V("https://example.com"),
      word("toki"),
    ]);
    expect(out[0].gaps[1].sp).toBe(" \n");
    expect(out[0].gaps[1].spAuthored).toBe(true);
    expect(out[1].anchors).toEqual([word("pona")]);
  });

  it("rollback re-anchor: an OLD " +
     "build's split parse over a bound anchor " +
     "re-absorbs it WHOLE — block-stable, render " +
     "byte-identical", () => {
    const prev = block(
      [V("https://x"), word("pona")],
      [g("", ""), g(" ", " "), g("", "")]
    );
    // hand-built OLD-parser output (the real one
    // now binds, so the old shape is simulated —
    // same convention as the future-parse sides)
    const out = mergeLatinBlock(
      prev,
      side(
        [V("https"), V("x"), word("pona")],
        ["", "://", " ", ""]
      )
    );
    expect(out.anchors).toEqual(prev.anchors);
    expect(renderSp(out).text).toBe(
      renderSp(prev).text
    );
  });

  it("undo-then-redo across a batch transition: " +
     "inputs are never mutated (history references " +
     "stay valid = undo) and the merge is " +
     "deterministic (= redo)", () => {
    const pre = block(
      [V("https"), V("x"), word("pona")],
      [
        g("", ""),
        g(" ", "://"),
        withMark(g("\n", " "), "sp", true),
        g("", ""),
      ]
    );
    const prevBlocks = [pre];
    const before = JSON.stringify(prevBlocks);
    const sides = prevBlocks.map((b) =>
      parseLatin(renderLatin(b).inlines)
    );
    const once = mergeStructural(
      prevBlocks,
      sides,
      "latin"
    );
    expect(JSON.stringify(prevBlocks)).toBe(before);
    const again = mergeStructural(
      prevBlocks,
      sides,
      "latin"
    );
    expect(JSON.stringify(again)).toBe(
      JSON.stringify(once)
    );
  });
});

describe("consumed-trigger break " +
         "withdrawal", () => {
  const typeSeq = (
    b: Block,
    texts: string[]
  ): Block => {
    let cur = b;
    for (const t of texts) {
      cur = mergeLatinBlock(cur, latText(t));
    }
    return cur;
  };
  const empty = (): Block => block([], [g("", "")]);

  it("'toki.' fires; 'toki.p' binds => the break " +
     "is withdrawn; restored bytes are the " +
     "block-final default \"\"", () => {
    const fired = typeSeq(empty(), [
      "toki",
      "toki.",
    ]);
    expect(
      fired.gaps.some((gp) => gp.sp === "\n")
    ).toBe(true);
    const out = mergeLatinBlock(
      fired,
      latText("toki.p")
    );
    expect(out.anchors).toEqual([V("toki.p")]);
    for (const gp of out.gaps) {
      expect(gp.sp).not.toContain("\n");
    }
    expect(out.gaps[1].sp).toBe("");
  });

  it("interior variant: 'toki. mi' -> 'toki.p mi' " +
     "withdraws to the interior default \" \"", () => {
    const fired = typeSeq(empty(), [
      "toki mi",
      "toki. mi",
    ]);
    const out = mergeLatinBlock(
      fired,
      latText("toki.p mi")
    );
    expect(out.gaps[1].sp).toBe(" ");
    expect(out.gaps[1].spAuthored).toBeUndefined();
  });

  it("NOT consumed: 'toki.' -> " +
     "'toki. p' keeps the dot in the gap => the " +
     "break STAYS (stateless discrimination)", () => {
    const fired = typeSeq(empty(), [
      "toki",
      "toki.",
    ]);
    const out = mergeLatinBlock(
      fired,
      latText("toki. p")
    );
    expect(
      out.gaps.some((gp) =>
        gp.latin.includes(".")
      )
    ).toBe(true);
    expect(
      out.gaps.some((gp) => gp.sp.includes("\n"))
    ).toBe(true);
  });

  it("'toki.' -> 'toki.pona' (whole word lands in " +
     "one merge): withdrawn — no stray break on " +
     "the finished identifier", () => {
    const fired = typeSeq(empty(), [
      "toki",
      "toki.",
    ]);
    const out = mergeLatinBlock(
      fired,
      latText("toki.pona")
    );
    for (const gp of out.gaps) {
      expect(gp.sp).not.toContain("\n");
    }
  });

  it("composed batch: 'toki.' -> 'toki.pona!' — " +
     "the consumed trigger's break goes, the NEW " +
     "'!' trigger owns exactly one break in the " +
     "same merge", () => {
    const fired = typeSeq(empty(), [
      "toki",
      "toki.",
    ]);
    const out = mergeLatinBlock(
      fired,
      latText("toki.pona!")
    );
    expect(out.anchors).toEqual([V("toki.pona")]);
    expect(out.gaps[1].latin).toBe("!");
    expect(out.gaps[1].sp).toBe("\n");
    expect(out.gaps[1].spAuthored).toBeUndefined();
  });

  it("an authored break is NEVER withdrawn, even " +
     "when its gap's trigger is consumed", () => {
    const prev = block(
      [word("toki")],
      [
        g("", ""),
        withMark(g("\n", "."), "sp", true),
      ]
    );
    const out = mergeLatinBlock(
      prev,
      latText("toki.p")
    );
    expect(
      out.gaps.some(
        (gp) =>
          gp.spAuthored && gp.sp.includes("\n")
      )
    ).toBe(true);
  });

  // The composite restore
  // shape, exact bytes. rescueFusedGaps appends the
  // dying gap's bytes AFTER the carried default
  // "\n", so when the surviving remainder is itself
  // an authored break, withdrawal's restore prepends
  // the position-rule default in FRONT of it rather
  // than replacing the whole gap — an interior
  // consumed-trigger fusion with a following anchor
  // (unlike the space-deletion pins' block-final
  // shape) restores
  // " " + the untouched authored "\n", i.e. " \n",
  // and the gap stays authored (the surviving byte
  // is the user's). Real pipeline: authored SP Enter
  // placed after the second word of a "toki. pona
  // li" run (simulated the same way the LIVE
  // pins do —
  // stamp the gap authored, matching an SP-side
  // Enter), then the Latin-side space between
  // "toki." and "pona" is deleted, fusing them.
  it("interior composite restore: " +
     "the position-rule space lands " +
     "BEFORE the surviving authored break, not " +
     "in place of it", () => {
    const p0 = mergeLatinBlock(
      empty(),
      latText("toki. pona li")
    );
    expect(p0.gaps[1].sp).toBe("\n");
    const gaps = p0.gaps.map((gp, i) =>
      i === 2
        ? { ...gp, sp: "\n", spAuthored: true as const }
        : gp
    );
    const out = mergeLatinBlock(
      { ...p0, gaps },
      latText("toki.pona li")
    );
    expect(out.anchors).toEqual([
      V("toki.pona"),
      word("li"),
    ]);
    expect(out.gaps[1].sp).toBe(" \n");
    expect(out.gaps[1].spAuthored).toBe(true);
  });

  // The `prevGap.sp !== "\n"` exactness guard.
  // Relaxing it to `!prevGap.sp.startsWith("\n")`
  // leaves every other pin green
  // (mutation-verified) — the withdrawable byte is
  // "a generated DEFAULT lone '\n'", singular, so
  // a DEFAULT double-break gap (both bytes
  // unauthored, e.g. a blank-line-preserving
  // surplus ahead of the trigger) is one byte away
  // from the shape that fires but must NOT: the
  // guard's exactness is what keeps it out.
  // Hand-built (a default "\n\n" is not reachable
  // by typing through the real parser here).
  it("default DOUBLE break is NOT withdrawn: " +
     "the exactness " +
     "guard rejects one byte away from the " +
     "firing shape", () => {
    const prev = block(
      [word("toki")],
      [g("", ""), g("\n\n", ".")]
    );
    const out = mergeLatinBlock(
      prev,
      side([V("toki.p")], ["", ""])
    );
    expect(out.gaps[1].sp).toBe("\n\n");
    expect(out.gaps[1].spAuthored).toBeUndefined();
  });

  // The consumed anchor must NOT sit sentinel-
  // adjacent to the new split boundary, or the
  // fixture stops discriminating: generateSpFromLatin
  // (and withdrawConsumedBreaks alike) already never
  // generates/touches a gap immediately next to a
  // split sentinel, so a naive fixture
  // that splits right after the consumed anchor
  // (`["toki.p", "mi"]`, one word per output block)
  // passes with the flat-path site fully disabled —
  // verified by mutation. Keeping "mi" in the SAME
  // output block as "toki.p" (interior gap, not
  // sentinel-adjacent) before the Enter boundary
  // makes this pin a genuine flat-path
  // discriminator.
  it("flat-arm wiring (flat-path site): Enter + consumed " +
     "trigger in ONE structural merge withdraws " +
     "through the flat path", () => {
    const fired = typeSeq(empty(), [
      "toki",
      "toki.",
    ]);
    const out = mergeStructural(
      [fired],
      [latText("toki.p mi"), latText("pan")],
      "latin"
    );
    expect(out).toHaveLength(2);
    expect(out[0].anchors.map((a) =>
      a.kind === "word" ? a.word : "V"
    )).toEqual(["V", "mi"]);
    expect(out[0].gaps[1].sp).toBe(" ");
    for (const gp of out.flatMap((b) => b.gaps)) {
      expect(gp.sp).not.toContain("\n");
    }
  });
});

describe("colon transients + regeneration", () => {
  const empty = (): Block => block([], [g("", "")]);
  const anyColon = (b: Block): boolean =>
    b.gaps.some((gp) => gp.sp.includes(COLON_CH));

  it("glyph fires at 'https:', withdrawn at " +
     "'https:/', no debris after the real bind at " +
     "'https://x'", () => {
    let b = mergeLatinBlock(
      empty(),
      latText("https")
    );
    b = mergeLatinBlock(b, latText("https:"));
    expect(anyColon(b)).toBe(true);
    b = mergeLatinBlock(b, latText("https:/"));
    expect(anyColon(b)).toBe(false);
    b = mergeLatinBlock(b, latText("https://"));
    const out = mergeLatinBlock(
      b,
      latText("https://x")
    );
    expect(out.anchors).toEqual([V("https://x")]);
    expect(anyColon(out)).toBe(false);
  });

  it("hand-built variant: a bind straight from " +
     "'https:/' leaves no COLON_CH debris " +
     "either", () => {
    let b = mergeLatinBlock(
      empty(),
      latText("https")
    );
    b = mergeLatinBlock(b, latText("https:"));
    const out = mergeLatinBlock(
      b,
      side([V("https:/")], ["", ""])
    );
    expect(anyColon(out)).toBe(false);
  });

  // A fixture seeding the trailing gap ALREADY
  // broken (g("\n", ". ")) stays green with
  // sentence generation disabled entirely — it pins
  // carry, not regeneration. Seeding
  // the same gap UNBROKEN (g("", ". ")) forces the
  // merge to regenerate the break from scratch: no
  // "\n" exists anywhere in prev to carry, so a
  // break appearing at all is proof of regeneration.
  it("survives-by-regeneration: a break " +
     "after a URL sentence is REGENERATED (not " +
     "carried) across the transition — present " +
     "EXACTLY once", () => {
    const prev = block(
      [
        word("toki"),
        V("https"),
        V("x"),
        word("pona"),
      ],
      [
        g("", ""),
        g(" ", " "),
        g(" ", "://"),
        g("", ". "),
        g("", ""),
      ]
    );
    const out = mergeLatinBlock(
      prev,
      latText("toki https://x. pona")
    );
    const breaks = out.gaps
      .map((gp) => gp.sp)
      .join("")
      .split("")
      .filter((c) => c === "\n").length;
    expect(breaks).toBe(1);
  });
});

describe("user-visible binding behaviors (each " +
         "-> pin or pointer)", () => {
  // - URLs/times/identifiers render literally and
  //   the transient cleans itself: the LIVE
  //   gap-edit renderSp pin + the colon-transient
  //   + withdrawal pins above.
  // - first edit converts en-masse, one undo
  //   restores, no bytes lost: the en-masse and
  //   undo/redo pins + the conservation law below.
  // - hand formatting relocates after the token:
  //   the slot-order pin.
  // - an edited-into-shape span DIES, undo
  //   recovers, spelling survives as plain text:
  //   the span-death pin.
  // The remaining two get their own pins here:
  const empty = (): Block => block([], [g("", "")]);

  it("quoted prose is untouched — typing " +
     "'\"toki!\" pona' keeps the glyph and fires " +
     "the sentence break exactly as before", () => {
    const out = mergeLatinBlock(
      empty(),
      latText('"toki!" pona')
    );
    expect(
      out.anchors.some(
        (a) => a.kind === "word" && a.word === "toki"
      )
    ).toBe(true);
    expect(
      out.gaps.some(
        (gp) =>
          gp.latin.includes('!"') &&
          gp.sp.includes("\n")
      )
    ).toBe(true);
  });

  // FONT COLLISION, accepted: the natural fixture
  // here would be "toki,pona", but the active
  // font's codepointOverrides remap the tally-mark
  // codepoint to ASCII "," (0x2C), so "," is a hard
  // boundary in this repo and never binds (see
  // parse-latin.test.ts's trim-first table). Using
  // ";" instead, which is unaffected, so this pin
  // demonstrates the intended behavior (missed
  // punctuation binds literal, space recovers).
  it("missed punctuation: 'toki;pona' shows as " +
     "literal text; " +
     "adding the space splits it back and the " +
     "glyphs return (recovery)", () => {
    const bound = mergeLatinBlock(
      empty(),
      latText("toki;pona")
    );
    expect(bound.anchors).toEqual([
      V("toki;pona"),
    ]);
    const recovered = mergeLatinBlock(
      bound,
      latText("toki; pona")
    );
    expect(
      recovered.anchors.map((a) =>
        a.kind === "word" ? a.word : "V"
      )
    ).toEqual(["toki", "pona"]);
    expect(renderSp(recovered).text).toContain(
      glyph("toki")
    );
  });
});

describe("conservation re-run, URL-shaped " +
         "seeds (standalone law)", () => {
  // Pre- and post-transition URL-shaped docs.
  const SEEDS: Array<() => Block> = [
    () =>
      block(
        [V("https"), V("x"), word("pona")],
        [
          g("", ""),
          g(" ", "://"),
          g("\n", ". "),
          g("", ""),
        ]
      ),
    () =>
      block(
        [V("https://x"), word("pona")],
        [g("", ""), g(" ", ". "), g("", "")]
      ),
    () =>
      block(
        [word("toki"), word("pona")],
        [g("", ""), g(" ", "."), g("", "")]
      ),
    () =>
      block(
        [word("toki")],
        [g("", ""), g("", " 3:30")]
      ),
  ];
  const URL_INSERTS = [
    "",
    " ",
    ".",
    ":",
    "/",
    "://",
    "x",
    "! ",
  ];
  // deterministic mark seeding, xorshift32 — the
  // provenance-laws.test.ts harness shape; the
  // fast-check global seed stays untouched
  const seedMarks = (b: Block, seed: number): Block => {
    let s = seed >>> 0 || 1;
    const bit = (): boolean => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s % 4 === 0;
    };
    return {
      ...b,
      gaps: b.gaps.map((gp) => {
        let out = gp;
        if (bit()) out = withMark(out, "sp", true);
        if (bit()) {
          out = withMark(out, "latin", true);
        }
        return out;
      }),
    };
  };
  const latinTextOf = (b: Block): string =>
    renderLatin(b)
      .inlines.map((inl) => inl.text)
      .join("");

  it("no pass destroys authored bytes across " +
     "random URL-flavored edits and the " +
     "verbatim-binding transition " +
     "(conservationErrors empty)", () => {
    fc.assert(
      fc.property(
        fc.nat(SEEDS.length - 1),
        fc.nat(),
        fc.array(
          fc.record({
            pos: fc.nat(60),
            del: fc.nat(3),
            ins: fc.nat(URL_INSERTS.length - 1),
          }),
          { minLength: 1, maxLength: 4 }
        ),
        (si, seed, edits) => {
          let cur = seedMarks(SEEDS[si](), seed);
          for (const e of edits) {
            const text = latinTextOf(cur);
            const from = Math.min(
              e.pos,
              text.length
            );
            const to = Math.min(
              from + e.del,
              text.length
            );
            const next =
              text.slice(0, from) +
              URL_INSERTS[e.ins] +
              text.slice(to);
            const parsed = latText(next);
            const out = mergeLatinBlock(
              cur,
              parsed
            );
            const errs = conservationErrors(
              [cur],
              [parsed],
              [out],
              "latin"
            );
            if (errs.length > 0) {
              throw new Error(
                errs.join("; ") +
                  " on " +
                  JSON.stringify({ si, e, next })
              );
            }
            cur = out;
          }
          return true;
        }
      ),
      { numRuns: 150 }
    );
  });
});
