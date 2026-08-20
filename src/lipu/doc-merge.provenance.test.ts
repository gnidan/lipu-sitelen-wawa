import { describe, expect, it } from "vitest";
import {
  applyMarkedVerbatimSpDefault,
  applySeparationDefaults,
  capLatinNewlines,
  inCartoucheContext,
  mergeLatinBlock,
  mergeSpBlock,
  mergeStructural,
} from "./doc-merge";
import { classifyBlock, withMark } from "./provenance";
import { parseSp, spInlinesFromText } from
  "./parse-sp";
import { parseLatin, latinInlinesFromText } from
  "./parse-latin";
import { renderLatin } from "./render-latin";
import { renderSp } from "./render-sp";
import {
  CARTOUCHE_END,
  CARTOUCHE_START,
  COLON_CH,
  MIDDLE_DOT_CH,
  STACK,
} from "./chars";
import type {
  Block,
} from "./types";
import {
  blockOf as block,
  cart,
  countNl,
  gap as g,
  glyph,
  latText,
  mvb as V,
  span,
  spText,
  word,
} from "../../test/helpers";

describe("reattach wiring — one pin per call " +
         "site", () => {
  // Site 1: mergeSpBlock. mkGap rebuilds every gap,
  // so a surviving mark PROVES reattach ran here.
  it("site 1 (mergeSpBlock): a carried authored " +
     "latin mark survives an unrelated SP edit", () => {
    const prev = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(g(" ", ". "), "latin", true),
        g("", ""),
      ]
    );
    const out = mergeSpBlock(
      prev,
      spText(
        glyph("toki") + " " + glyph("pona") +
          glyph("mi")
      )
    );
    const gp = out.gaps[1];
    expect(gp.latin).toBe(". ");
    expect(gp.latinAuthored).toBe(true);
  });

  // Site 2: mergeLatinBlock. Edited-side re-decide:
  // only reattach can stamp the pasted punctuation.
  it("site 2 (mergeLatinBlock): pasting '. ' into " +
     "a latin gap stamps latinAuthored", () => {
    const prev = block(
      [word("toki"), word("pona")],
      [g("", ""), g(" ", " "), g("", "")]
    );
    const out = mergeLatinBlock(
      prev,
      latText("toki. pona")
    );
    expect(out.gaps[1].latin).toBe(". ");
    expect(out.gaps[1].latinAuthored).toBe(true);
  });

  // Site 3: mergeStructural EQUAL-COUNT arm
  // (delegates per-block; the pin goes through the
  // mergeStructural entry so breaking the delegation
  // is also caught).
  it("site 3 (mergeStructural equal-count): marks " +
     "survive a positional latin merge", () => {
    const b = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(g(" ", ". "), "latin", true),
        g("", ""),
      ]
    );
    const out = mergeStructural(
      [b],
      [parseLatin(renderLatin(b).inlines)],
      "latin"
    );
    expect(out[0].gaps[1].latinAuthored).toBe(true);
  });

  // Site 4: mergeStructural FLAT arm (count change).
  it("site 4 (mergeStructural flat): marks survive " +
     "a latin paragraph join", () => {
    const b0 = block(
      [word("toki")],
      [g("", ""), withMark(g(" ", ". "), "latin", true)]
    );
    const b1 = block(
      [word("pona")],
      [g("", ""), g("", "")]
    );
    const out = mergeStructural(
      [b0, b1],
      [latText("toki. pona")],
      "latin"
    );
    expect(out).toHaveLength(1);
    const gp = out[0].gaps[1];
    expect(gp.latin.startsWith(". ")).toBe(true);
    expect(gp.latinAuthored).toBe(true);
  });

  // Site 5: the latin-editor drain call shape —
  // processFull merges every paragraph through
  // mergeLatinBlock against the model blocks
  // (latin-editor.ts:688-697). Same-shape pin.
  it("site 5 (drain shape): per-paragraph " +
     "mergeLatinBlock over a multi-block lipu " +
     "keeps marks in untouched blocks", () => {
    const b0 = block(
      [word("toki")],
      [g("", ""), withMark(g("", ": "), "latin", true)]
    );
    const b1 = block(
      [word("pona")],
      [g("", ""), g("", "")]
    );
    const blocks = [b0, b1].map((pb) =>
      mergeLatinBlock(
        pb,
        parseLatin(renderLatin(pb).inlines)
      )
    );
    expect(blocks[0].gaps[1].latinAuthored).toBe(
      true
    );
    expect(blocks[0].gaps[1].latin).toBe(": ");
  });
});

describe("frozen-consumption restamp through the " +
         "real merge", () => {
  it("cleanupJoiners: deleting the Latin word next " +
     "to an authored STACK strips the joiner (frozen) " +
     "and the carried sp restamps DEFAULT by " +
     "recognizer", () => {
    // SP: toki STACK pona — the STACK is literal
    // authored gap.sp content.
    const prev0 = mergeSpBlock(
      block([], [g("", "")]),
      spText(glyph("toki") + STACK + glyph("pona"))
    );
    expect(prev0.gaps[1].sp).toBe(STACK);
    expect(prev0.gaps[1].spAuthored).toBe(true);
    // Latin: delete "pona" => the STACK gap is
    // disturbed; frozen cleanupJoiners strips it.
    const out = mergeLatinBlock(
      prev0,
      latText("toki")
    );
    const joinerGap = out.gaps.find((gp) =>
      gp.sp.includes(STACK)
    );
    expect(joinerGap).toBeUndefined();
    for (const gp of out.gaps) {
      expect(gp.spAuthored).toBeUndefined();
    }
  });

  it("marker-pair consumption through the real " +
     "merge: completing '[..]' promotes the pair; " +
     "the residual \"\\n\" restamps DEFAULT even " +
     "though the same merge carried a user edit " +
     "(consumption-restamp precedence)", () => {
    const s1 = mergeSpBlock(
      block([], [g("", "")]),
      spText(glyph("toki"))
    );
    // type "[" + Enter before toki: unmatched
    // marker = literal authored gap bytes
    const s2 = mergeSpBlock(
      s1,
      spText(
        CARTOUCHE_START + "\n" + glyph("toki")
      )
    );
    expect(s2.gaps[0].sp).toBe(
      CARTOUCHE_START + "\n"
    );
    expect(s2.gaps[0].spAuthored).toBe(true);
    // type "]" after toki: the pair promotes to a
    // span (frozen matchStructuralPairs /
    // removePairChars); gap 0's residual is "\n".
    const s3 = mergeSpBlock(
      s2,
      spText(
        CARTOUCHE_START + "\n" + glyph("toki") +
          CARTOUCHE_END
      )
    );
    expect(
      s3.spans.filter(
        (s) => s.kind === "cartouche"
      )
    ).toHaveLength(1);
    expect(s3.gaps[0].sp).toBe("\n");
    // originDefault("\n") would say AUTHORED; the
    // consumption restamp (recognizer) wins.
    expect(s3.gaps[0].spAuthored).toBeUndefined();
  });
});

describe("mark plumbing in the routing passes " +
         "(the OR rule)", () => {
  it("rescueJoinedGaps ORs the dead gap's authored " +
     "mark into the seam (latin join, carried sp)", () => {
    // prev: [toki] | [pona], where P1's gaps[0].sp
    // carries an authored mid-dot+break
    const b0 = block(
      [word("toki")],
      [g("", ""), g(" ", "")]
    );
    const b1: Block = {
      anchors: [{ ...word("pona") }],
      gaps: [
        withMark(g(MIDDLE_DOT_CH, ""), "sp", true),
        g("", ""),
      ],
      spans: [],
    };
    const out = mergeStructural(
      [b0, b1],
      [latText("toki pona")],
      "latin"
    );
    expect(out).toHaveLength(1);
    const seam = out[0].gaps[1];
    expect(seam.sp).toContain(MIDDLE_DOT_CH);
    expect(seam.spAuthored).toBe(true);
  });

  it("routeSplitGaps division: an authored carried " +
     "latin's right half ORs into the receiving " +
     "gap 0 (sp split)", () => {
    // one block, authored latin "x\ny" in the gap
    // after toki; SP split at that gap's "\n"
    const b = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(g("\n", "x\ny"), "latin", true),
        g("", ""),
      ]
    );
    const out = mergeStructural(
      [b],
      [
        spText(glyph("toki")),
        spText(glyph("pona")),
      ],
      "sp"
    );
    expect(out).toHaveLength(2);
    // left half stays with its source gap
    expect(out[0].gaps[1].latin).toContain("x");
    expect(out[0].gaps[1].latinAuthored).toBe(true);
    // right half ORed into P1's gap 0
    expect(out[1].gaps[0].latin).toContain("y");
    expect(out[1].gaps[0].latinAuthored).toBe(true);
  });

  it("demoteStraddlers stamps restored marker " +
     "bytes AUTHORED into the receiving gap", () => {
    // On an sp-edited merge, merge.ts (frozen)
    // rebuilds structural spans from LITERAL marker
    // chars in the freshly parsed sp text
    // (matchStructuralPairs), not from prev.spans
    // metadata — so the split's two parsedSides
    // must carry the cartouche's own start/end
    // chars for a straddling span to exist at all.
    // Splitting "[toki|pona]" between the words
    // gives mergeBlockDetailed exactly that pair,
    // straddling the new sentinel; demoteStraddlers
    // then restores both marker chars as literal
    // gap.sp bytes.
    const b: Block = {
      anchors: [
        { ...word("toki") },
        { ...word("pona") },
      ],
      gaps: [g("", ""), g(" ", " "), g("", "")],
      spans: [
        cart(0, 1),
      ],
    };
    const out = mergeStructural(
      [b],
      [
        spText(CARTOUCHE_START + glyph("toki")),
        spText(glyph("pona") + CARTOUCHE_END),
      ],
      "sp"
    );
    expect(out).toHaveLength(2);
    const withMarker = out
      .flatMap((ob) => ob.gaps)
      .filter((gp) =>
        gp.sp.includes(CARTOUCHE_START) ||
        gp.sp.includes(CARTOUCHE_END)
      );
    expect(withMarker.length).toBeGreaterThan(0);
    for (const gp of withMarker) {
      expect(gp.spAuthored).toBe(true);
    }
  });

  it("collapseSeamRuns needs no plumbing: the seam " +
     "invention on a DEFAULT seam leaves it default " +
     "(\" \\n\" image), and marks ride the collapse", () => {
    const b0 = block(
      [word("toki")],
      [g("", ""), g(" ", "")]
    );
    const b1 = block(
      [word("pona")],
      [g("", ""), g("", "")]
    );
    const out = mergeStructural(
      [b0, b1],
      [latText("toki pona")],
      "latin"
    );
    expect(out).toHaveLength(1);
    const seam = out[0].gaps[1];
    expect(seam.sp).toBe(" \n"); // the seam image
    expect(seam.spAuthored).toBeUndefined();
  });
});

describe("authored Latin is untouchable by " +
         "SP edits", () => {
  const pasted = () =>
    block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(g(" ", ". "), "latin", true),
        g("", ""),
      ]
    );

  it("SP Enter next to authored '. ' adds the " +
     "newline in SP only — no companion", () => {
    const out = mergeSpBlock(
      pasted(),
      spText(
        glyph("toki") + "\n" + glyph("pona")
      )
    );
    expect(out.gaps[1].sp).toBe("\n");
    expect(out.gaps[1].latin).toBe(". "); // stable
  });

  it("deleting the SP break never rewrites the " +
     "authored latin bytes (gated delta rule)", () => {
    const withBreak = mergeSpBlock(
      pasted(),
      spText(
        glyph("toki") + "\n" + glyph("pona")
      )
    );
    const deleted = mergeSpBlock(
      withBreak,
      spText(
        glyph("toki") + " " + glyph("pona")
      )
    );
    expect(deleted.gaps[1].latin).toBe(". ");
  });

  it("regression: pure-typing delta coupling " +
     "is unchanged in the all-default world", () => {
    const b = block(
      [word("toki"), word("pona")],
      [g("", ""), g(" ", " "), g("", "")]
    );
    const entered = mergeSpBlock(
      b,
      spText(
        glyph("toki") + "\n" + glyph("pona")
      )
    );
    expect(entered.gaps[1].latin).toBe(" \n");
    const deleted = mergeSpBlock(
      entered,
      spText(
        glyph("toki") + " " + glyph("pona")
      )
    );
    expect(deleted.gaps[1].latin).toBe(" ");
  });
});

describe("content already present at load gains " +
         "protection", () => {
  it("an old doc's punctuated latin '.\\n' is " +
     "safe from the delta rule after " +
     "classification", () => {
    const b = classifyBlock(
      block(
        [word("toki"), word("pona")],
        [g("", ""), g("\n", ".\n"), g("", "")]
      )
    );
    const out = mergeSpBlock(
      b,
      spText(
        glyph("toki") + " " + glyph("pona")
      )
    );
    expect(out.gaps[1].latin).toBe(".\n");
  });
});

describe("gated rewriters and creators", () => {
  it("capLatinNewlines skips authored latin sides " +
     "and still trims default ones", () => {
    const b = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(g("", ".\n\n"), "latin", true),
        g("", "\n\n"),
      ]
    );
    const { block: out, trimmed } =
      capLatinNewlines(b);
    expect(out.gaps[1].latin).toBe(".\n\n");
    expect(out.gaps[2].latin).toBe("");
    expect(trimmed).toBe(2);
  });

  it("the separation default skips an authored " +
     "latin side", () => {
    const b = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(g(" ", ""), "latin", true),
        g("", ""),
      ]
    );
    expect(
      applySeparationDefaults(b).gaps[1].latin
    ).toBe("");
  });

  it("applyMarkedVerbatimSpDefault skips an " +
     "authored sp side", () => {
    const prev: Block = {
      anchors: [V("xq"), word("n")],
      gaps: [g("", ""), g("", " "), g("", "")],
      spans: [],
    };
    const minted: Block = {
      anchors: [V("xq"), V("no")],
      gaps: [
        g("", ""),
        withMark(g("", " "), "sp", true),
        g("", ""),
      ],
      spans: [],
    };
    const out = applyMarkedVerbatimSpDefault(
      minted,
      prev,
      [0, 1]
    );
    expect(out.gaps[1].sp).toBe("");
  });

  it("regression: letterish latin from older " +
     "storage (classified AUTHORED) still gets the " +
     "fusion padding, and a Latin no-op does NOT " +
     "fuse the flanking word anchors", () => {
    const b = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(g(" ", "x"), "latin", true),
        g("", ""),
      ]
    );
    const padded = mergeSpBlock(
      b,
      parseSp(renderSp(b).inlines)
    );
    expect(padded.gaps[1].latin).toBe(" x ");
    expect(padded.gaps[1].latinAuthored).toBe(true);
    const noop = mergeLatinBlock(
      padded,
      parseLatin(renderLatin(padded).inlines)
    );
    const words = noop.anchors.filter(
      (a) => a.kind === "word"
    );
    expect(
      words.map((a) => a.word)
    ).toEqual(["toki", "pona"]);
    // A render-identity assertion is NOT satisfiable
    // here: parseLatin (frozen) tokenizes ANY
    // free-standing letter run into its own anchor
    // candidate independent of prev state (verified
    // mark-independent), so mergeBlockDetailed
    // (frozen) necessarily promotes "x" to a fresh
    // marked verbatim anchor, whose text then renders
    // in SP too — the documented "first Latin edit"
    // anchor-material behavior
    // (normalizeLetterishLatin's own docstring), not
    // a gate regression. What the title actually pins
    // -- "does NOT fuse the flanking word anchors" --
    // is the `words` assertion above. The
    // conservation pin below is the satisfiable
    // stronger rung -- both SP glyphs survive, in
    // order, and the authored byte is not lost. Fails
    // under a gated or half-broken padding guard; a
    // fixpoint-only check does not (fusion is itself
    // a fixpoint).
    expect(renderSp(noop).text).toBe(
      glyph("toki") + " x" + glyph("pona")
    );
  });
});

describe("a join collapses authored " +
         "newline RUNS at the seam; punctuation " +
         "survives verbatim", () => {
  it("authored '·\\n' + carried '\\n' joins to ONE " +
     "break, mid-dot intact; the join does not " +
     "re-split", () => {
    const b0 = block(
      [word("toki")],
      [
        g("", ""),
        withMark(
          g(MIDDLE_DOT_CH + "\n", ""),
          "sp",
          true
        ),
      ]
    );
    const b1 = block(
      [word("pona")],
      [g("\n", ""), g("", "")]
    );
    const out = mergeStructural(
      [b0, b1],
      [latText("toki pona")],
      "latin"
    );
    expect(out).toHaveLength(1);
    const seam = out[0].gaps[1];
    expect(seam.sp).toBe(MIDDLE_DOT_CH + "\n");
    expect(seam.spAuthored).toBe(true);
    // no re-split: a latin no-op keeps one block
    const again = mergeStructural(
      out,
      [parseLatin(renderLatin(out[0]).inlines)],
      "latin"
    );
    expect(again).toHaveLength(1);
  });
});

describe("the marked-verbatim SP default on the " +
         "flat (count-changing) arm", () => {

  it("a latin JOIN minting a verbatim-verbatim " +
     "adjacency gets the SP-side default", () => {
    const b0: Block = {
      anchors: [V("xq")],
      gaps: [g("", ""), g("", "")],
      spans: [],
    };
    const b1: Block = {
      anchors: [V("ax")],
      gaps: [g("", ""), g("", "")],
      spans: [],
    };
    const out = mergeStructural(
      [b0, b1],
      [latText("xq ax")],
      "latin"
    );
    expect(out).toHaveLength(1);
    expect(out[0].gaps[1].sp).toContain(" ");
  });

  it("kind-change mint across the flat path " +
     "(\"n\" -> \"no\" during a join) gets the " +
     "default despite stable positions", () => {
    const b0: Block = {
      anchors: [V("xq"), { ...word("n") }],
      gaps: [g("", ""), g("", " "), g("", "")],
      spans: [],
    };
    const b1: Block = {
      anchors: [{ ...word("pona") }],
      gaps: [g("", ""), g("", "")],
      spans: [],
    };
    const out = mergeStructural(
      [b0, b1],
      [latText("xq no pona")],
      "latin"
    );
    expect(out).toHaveLength(1);
    expect(out[0].anchors[1]).toEqual(V("no"));
    expect(out[0].gaps[1].sp).toBe(" ");
  });

  it("sentinel-adjacent gaps count as boundary: a " +
     "latin SPLIT between two marked verbatims " +
     "writes no ' ' at the new block edge", () => {
    const b: Block = {
      anchors: [V("xq"), { ...word("n") }, V("ax")],
      gaps: [
        g("", ""),
        g("", " "),
        g("", " "),
        g("", ""),
      ],
      spans: [],
    };
    const out = mergeStructural(
      [b],
      [latText("xq"), latText("ax")],
      "latin"
    );
    expect(out).toHaveLength(2);
    // block-final gap of P0 and gap 0 of P1 stay
    // free of the minted separator
    expect(
      out[0].gaps[out[0].gaps.length - 1].sp
    ).toBe("");
    expect(out[1].gaps[0].sp).toBe("");
  });
});

describe("Latin => SP generation", () => {
  const plain = () =>
    block(
      [word("toki"), word("pona")],
      [g("", ""), g(" ", " "), g("", "")]
    );

  it("typing a sentence-ending '.' breaks the SP " +
     "line at that gap, stamped default", () => {
    const out = mergeLatinBlock(
      plain(),
      latText("toki. pona")
    );
    expect(out.gaps[1].sp).toBe("\n");
    expect(out.gaps[1].spAuthored).toBeUndefined();
    expect(out.gaps[1].latinAuthored).toBe(true);
  });

  it("curly-quote closers fire too", () => {
    const out = mergeLatinBlock(
      plain(),
      latText("toki.” pona")
    );
    expect(out.gaps[1].sp).toBe("\n");
  });

  it("terminal ':' mints the SP colon glyph as a " +
     "default", () => {
    const out = mergeLatinBlock(
      plain(),
      latText("toki: pona")
    );
    expect(out.gaps[1].sp).toBe(COLON_CH + " ");
    expect(out.gaps[1].spAuthored).toBeUndefined();
  });

  it("'http://x' and '3:30' never fire (colon not " +
     "terminal — non-goals by construction)", () => {
    const url = mergeLatinBlock(
      plain(),
      latText("toki http://x pona")
    );
    const time = mergeLatinBlock(
      plain(),
      latText("toki 3:30 pona")
    );
    for (const out of [url, time]) {
      for (const gp of out.gaps) {
        expect(gp.sp).not.toContain(COLON_CH);
        expect(gp.sp).not.toContain("\n");
      }
    }
  });

  it("abbreviations false-fire — accepted cost " +
     "(one deletable SP break each; a " +
     "lexicon guard is future work)", () => {
    const out = mergeLatinBlock(
      plain(),
      latText("e.g. pona")
    );
    // the gap after the "g" anchor ends ". " and
    // fires; this pin documents the accepted cost.
    expect(
      out.gaps.some((gp) => gp.sp === "\n")
    ).toBe(true);
  });

  it("typing 'pona.'/'pona!'/'pona?' at the " +
     "block end breaks the SP line at that " +
     "keystroke (block-final no longer suppressed)",
     () => {
    for (const end of [".", "!", "?"]) {
      const out = mergeLatinBlock(
        plain(),
        latText("toki pona" + end)
      );
      const last = out.gaps.length - 1;
      expect(out.gaps[last].sp).toBe("\n");
      expect(
        out.gaps[last].spAuthored
      ).toBeUndefined();
    }
  });

  it("continuing to type after a block-final " +
     "break lands the next word on the new line " +
     "(the dwell guard blocks a double break)", () => {
    const once = mergeLatinBlock(
      plain(),
      latText("toki pona.")
    );
    const twice = mergeLatinBlock(
      once,
      latText("toki pona. mi")
    );
    // the break minted at the previous keystroke
    // survives untouched
    expect(twice.gaps[2].sp).toBe("\n");
    // no new break is minted at the fresh
    // block-final gap "mi" now owns
    expect(
      twice.gaps[twice.gaps.length - 1].sp
    ).toBe("");
  });

  it("a terminal ':' at the block end also " +
     "mints the SP colon glyph", () => {
    const out = mergeLatinBlock(
      plain(),
      latText("toki pona:")
    );
    const last = out.gaps.length - 1;
    expect(out.gaps[last].sp).toBe(COLON_CH);
    expect(
      out.gaps[last].spAuthored
    ).toBeUndefined();
  });

  it("a sentence fire on a gap carrying a " +
     "marker offset DEFERS (never a silent marker " +
     "move)", () => {
    const b: Block = {
      ...block(
        [word("toki"), word("pona")],
        [
          g("", ""),
          g(" " + CARTOUCHE_START, " "),
          g(CARTOUCHE_END, ""),
        ]
      ),
      spans: [
        cart(1, 1, { startOffset: 1 }),
      ],
    };
    const out = mergeLatinBlock(
      b,
      latText("toki. pona")
    );
    // the sentence REPLACE would DESTROY the "["
    // byte and strand startOffset 1 in a "\n" gap
    expect(out.gaps[1].sp).toBe(
      " " + CARTOUCHE_START
    );
    expect(out.spans[0].startOffset).toBe(1);
  });

  it("a colon " +
     "PREPEND target whose gap carries an endOffset " +
     "interior region counts as IN CONTEXT — the " +
     "generator is suppressed rather than shifting " +
     "the offset into the cartouche name", () => {
    const b: Block = {
      ...block(
        [word("toki"), word("pona")],
        [
          g(CARTOUCHE_START, ""),
          g(" " + CARTOUCHE_END, " "),
          g("", ""),
        ]
      ),
      spans: [
        cart(0, 0, { endOffset: 1 }),
      ],
    };
    const out = mergeLatinBlock(
      b,
      latText("toki: pona")
    );
    // suppressed: the gap and its offset are BOTH
    // untouched, not shifted into the interior region
    expect(out.gaps[1].sp).toBe(
      " " + CARTOUCHE_END
    );
    expect(out.spans[0].endOffset).toBe(1);
  });

  it("an AUTHORED sp with no newline is not " +
     "clobbered by a sentence fire (the " +
     "default-target trigger, not the dwell guard)", () => {
    const prev = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(
          g(MIDDLE_DOT_CH + " ", " "),
          "sp",
          true
        ),
        g("", ""),
      ]
    );
    const out = mergeLatinBlock(
      prev,
      latText("toki. pona")
    );
    expect(out.gaps[1].sp).toBe(MIDDLE_DOT_CH + " ");
    expect(out.gaps[1].spAuthored).toBe(true);
  });

  it("a machine break the user deleted stays " +
     "deleted across an unrelated latin edit (the " +
     "byte-change trigger)", () => {
    const once = mergeLatinBlock(
      plain(),
      latText("toki. pona")
    );
    const cleared: Block = {
      ...once,
      gaps: once.gaps.map((gp, i) =>
        i === 1 ? { ...gp, sp: " " } : gp
      ),
    };
    const later = mergeLatinBlock(
      cleared,
      latText("toki. pona a")
    );
    expect(later.gaps[1].sp).toBe(" ");
  });

  it("colon generation is idempotent: a second " +
     "latin edit to an already-generated colon gap " +
     "does not double the glyph", () => {
    const once = mergeLatinBlock(
      plain(),
      latText("toki: pona")
    );
    const twice = mergeLatinBlock(
      once,
      latText("toki:  pona")
    );
    expect(twice.gaps[1].sp).toBe(COLON_CH + " ");
  });

  it("generation runs BEFORE the marked-verbatim " +
     "default in both tails, so a fresh " +
     "colon-firing gap between " +
     "two newly-minted marked verbatims does not " +
     "also receive that default's space (ordering is " +
     "user-visible, now enforced by a pin)", () => {
    const prev = block(
      [word("toki")],
      [g("", ""), g("", "")]
    );
    const out = mergeLatinBlock(
      prev,
      latText("xqz: wvu")
    );
    expect(out.gaps[1].sp).toBe(COLON_CH);
  });

  it("dwell guard: a pending '\\n\\n' " +
     "carried across a pane hop survives 'foo.'", () => {
    const b = block(
      [word("toki"), word("pona")],
      [g("", ""), g("\n\n", "\n\n"), g("", "")]
    );
    const out = mergeLatinBlock(
      b,
      latText("toki.\n\npona")
    );
    expect(out.gaps[1].sp).toBe("\n\n");
  });

  it("defaults never trigger: a latin no-op after " +
     "generation re-fires nothing (fixpoint)", () => {
    const once = mergeLatinBlock(
      plain(),
      latText("toki. pona")
    );
    const twice = mergeLatinBlock(
      once,
      parseLatin(renderLatin(once).inlines)
    );
    expect(twice.gaps.map((gp) => gp.sp)).toEqual(
      once.gaps.map((gp) => gp.sp)
    );
  });

  it("mark re-deciding re-arms generation: type " +
     "':', delete it, later ':' fires again", () => {
    const typed = mergeLatinBlock(
      plain(),
      latText("toki: pona")
    );
    const deleted = mergeLatinBlock(
      typed,
      latText("toki pona")
    );
    expect(deleted.gaps[1].latinAuthored)
      .toBeUndefined();
    const retyped = mergeLatinBlock(
      deleted,
      latText("toki: pona")
    );
    expect(
      retyped.gaps[1].sp.includes(COLON_CH)
    ).toBe(true);
  });

  it("suppressed in cartouche context: an " +
     "unmatched '[' upstream shadows the block", () => {
    const b = block(
      [word("toki"), word("pona")],
      [
        g(CARTOUCHE_START, ""),
        g(" ", " "),
        g("", ""),
      ]
    );
    const out = mergeLatinBlock(
      classifyBlock(b),
      latText("toki: pona")
    );
    expect(out.gaps[1].sp).not.toContain(COLON_CH);
  });

  // The SENTENCE rule must be gated
  // on inCartoucheContext just like the colon rule:
  // a latin "." typed inside a cartouche would
  // plant a machine "\n" straight into the name,
  // with no owned class able to clean it up (class
  // 2's own freshly-entered restriction correctly
  // declines once the gap is ALREADY in context).
  it("the SENTENCE rule is suppressed " +
     "in a MATCHED cartouche's interior — no sp " +
     "'\\n' plants inside the name", () => {
    const b: Block = {
      ...block(
        [word("toki"), word("pona")],
        [g("", ""), g(" ", " "), g("", "")]
      ),
      spans: [
        cart(0, 1),
      ],
    };
    const out = mergeLatinBlock(
      b,
      latText("toki. pona")
    );
    expect(out.gaps[1].sp).not.toContain("\n");
  });

  it("the SENTENCE rule is suppressed " +
     "in an UNMATCHED-'[' shadow too", () => {
    const b = block(
      [word("toki"), word("pona")],
      [
        g(CARTOUCHE_START, ""),
        g(" ", " "),
        g("", ""),
      ]
    );
    const out = mergeLatinBlock(
      classifyBlock(b),
      latText("toki. pona")
    );
    expect(out.gaps[1].sp).not.toContain("\n");
  });

  it("negative control: a '.' OUTSIDE " +
     "cartouche context (adjacent, not interior) " +
     "still generates — the gate does not " +
     "over-suppress the rest of the block", () => {
    const b: Block = {
      ...block(
        [word("toki"), word("pona"), word("mi")],
        [
          g("", ""),
          g(" ", " "),
          g(" ", " "),
          g("", ""),
        ]
      ),
      spans: [
        cart(0, 1),
      ],
    };
    const out = mergeLatinBlock(
      b,
      latText("toki pona. mi")
    );
    expect(out.gaps[2].sp).toBe("\n");
  });

  // The prepend remap is dead for cartouche spans
  // (any gap holding "[" is in-context via the
  // shadow scan, so generation never reaches it)
  // but still live for other structural spans —
  // hence a non-cartouche "long" span here.
  it("a colon PREPEND shifts a marker " +
     "offset on a NON-cartouche structural span " +
     "(the remap is still reachable there)", () => {
    const b: Block = {
      ...block(
        [word("toki"), word("pona")],
        [g("", ""), g(" x", " "), g("", "")]
      ),
      spans: [
        span("long", 0, 0, { endOffset: 1 }),
      ],
    };
    const out = mergeLatinBlock(
      b,
      latText("toki: pona")
    );
    expect(out.gaps[1].sp).toBe(COLON_CH + " x");
    // COLON_CH is a surrogate pair: 1 -> 3
    expect(out.spans[0].endOffset).toBe(3);
  });
});

describe("symmetric colon withdrawal", () => {
  const plain = () =>
    block(
      [word("toki"), word("pona")],
      [g("", ""), g(" ", " "), g("", "")]
    );
  /** Drives mergeLatinBlock once per state, the way
   *  latin-editor.ts presents every keystroke. */
  const typeSeq = (
    start: Block,
    states: string[]
  ): Block =>
    states.reduce(
      (b, s) => mergeLatinBlock(b, latText(s)),
      start
    );
  const anyColon = (b: Block): boolean =>
    b.gaps.some((gp) => gp.sp.includes(COLON_CH));

  // A one-shot exclusion ("digits are gap
  // content") holds for FINAL strings but not for
  // keystroke intermediates — "http:" and "3:" are
  // colon-terminal for one keystroke, the plant
  // fires, and without withdrawal nothing removes
  // it. Withdrawal makes the transient self-correct
  // at the lapsing keystroke.
  it("typing 'http://x' char-by-char — the " +
     "transient glyph at 'http:' is withdrawn by " +
     "the next keystroke; the final state is " +
     "glyph-free", () => {
    const atColon = typeSeq(plain(), [
      "toki pona ",
      "toki pona h",
      "toki pona ht",
      "toki pona htt",
      "toki pona http",
      "toki pona http:",
    ]);
    // documentation of the transient: the colon
    // default legitimately fires at the ":"
    // keystroke
    expect(anyColon(atColon)).toBe(true);
    const done = typeSeq(atColon, [
      "toki pona http:/",
      "toki pona http://",
      "toki pona http://x",
    ]);
    expect(anyColon(done)).toBe(false);
  });

  it("typing '3:30' char-by-char mid-doc — " +
     "final state glyph-free", () => {
    const atColon = typeSeq(plain(), [
      "toki  pona",
      "toki 3 pona",
      "toki 3: pona",
    ]);
    expect(anyColon(atColon)).toBe(true);
    const done = typeSeq(atColon, [
      "toki 3:3 pona",
      "toki 3:30 pona",
    ]);
    expect(anyColon(done)).toBe(false);
  });

  // The headline gesture.
  it("'nimi:' generates the glyph; deleting " +
     "the latin ':' withdraws it — both sides " +
     "clean, both default", () => {
    const nimiPona = block(
      [word("nimi"), word("pona")],
      [g("", ""), g(" ", " "), g("", "")]
    );
    const generated = mergeLatinBlock(
      nimiPona,
      latText("nimi: pona")
    );
    expect(generated.gaps[1].sp).toBe(
      COLON_CH + " "
    );
    const deleted = mergeLatinBlock(
      generated,
      latText("nimi pona")
    );
    expect(deleted.gaps[1].sp).toBe(" ");
    expect(
      deleted.gaps[1].spAuthored
    ).toBeUndefined();
    expect(deleted.gaps[1].latin).toBe(" ");
    expect(
      deleted.gaps[1].latinAuthored
    ).toBeUndefined();
  });

  // COLON GLYPHS ONLY: generated breaks stay
  // monotone (the dwell guard's direction —
  // paragraph flow may build on a generated "\n").
  it("break-monotone negative: deleting the '.' " +
     "does NOT withdraw its generated '\\n'", () => {
    const fired = mergeLatinBlock(
      plain(),
      latText("toki. pona")
    );
    expect(fired.gaps[1].sp).toBe("\n");
    const deleted = mergeLatinBlock(
      fired,
      latText("toki pona")
    );
    expect(deleted.gaps[1].sp).toBe("\n");
    expect(
      deleted.gaps[1].spAuthored
    ).toBeUndefined();
  });

  it("authored-glyph negative: a user-touched sp " +
     "colon survives a latin edit that lapses the " +
     "colon pattern", () => {
    const prev = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(g(COLON_CH + " ", ": "), "sp", true),
        g("", ""),
      ]
    );
    const out = mergeLatinBlock(
      prev,
      latText("toki, pona")
    );
    expect(out.gaps[1].sp).toContain(COLON_CH);
    expect(out.gaps[1].spAuthored).toBe(true);
  });

  // Context gating: in-context machine colons are
  // the context re-derivation's class-1 property
  // (presence-based, no trigger-lapse needed) —
  // withdrawal's own in-context abstention is
  // OWNERSHIP hygiene, and the observable outcome
  // is class 1's either way. This pin guards the
  // combined behavior (and the fixpoint pins
  // alongside it stay green).
  it("cartouche guard: a machine colon carried " +
     "into an unmatched-'[' shadow is removed by " +
     "context re-derivation on the latin edit, " +
     "not left stale", () => {
    // hand-built, NOT classifyBlock: the sp sides
    // must stay DEFAULT (a machine-planted colon
    // and a shadow marker), which the load
    // recognizer would mark authored
    const b = block(
      [word("toki"), word("pona")],
      [
        g(CARTOUCHE_START, ""),
        g(COLON_CH + " ", ": "),
        g("", ""),
      ]
    );
    const out = mergeLatinBlock(
      b,
      latText("toki, pona")
    );
    expect(out.gaps[1].sp).not.toContain(COLON_CH);
  });

  // Mirror of the plant-side shift pin: the
  // withdrawal's CUT remap. Reachable only on a
  // NON-cartouche structural span (a cartouche
  // offset gap is in-context, where withdrawal
  // abstains), same reason as the plant pin's
  // re-homing. Round-trips the same fixture: plant
  // shifts endOffset 1 -> 3, the lapsing
  // keystroke's withdrawal cuts it back 3 -> 1.
  it("withdrawal remaps a marker offset on a " +
     "non-cartouche structural span (the cut " +
     "remap, mirror of the plant's shift)", () => {
    const b: Block = {
      ...block(
        [word("toki"), word("pona")],
        [g("", ""), g(" x", " "), g("", "")]
      ),
      spans: [
        span("long", 0, 0, { endOffset: 1 }),
      ],
    };
    const planted = mergeLatinBlock(
      b,
      latText("toki: pona")
    );
    expect(planted.gaps[1].sp).toBe(
      COLON_CH + " x"
    );
    expect(planted.spans[0].endOffset).toBe(3);
    const withdrawn = mergeLatinBlock(
      planted,
      latText("toki, pona")
    );
    expect(withdrawn.gaps[1].sp).toBe(" x");
    // COLON_CH is a surrogate pair: 3 -> 1
    expect(withdrawn.spans[0].endOffset).toBe(1);
  });
});

describe("generation slot — flat path " +
         "reads post-rescue, post-route bytes", () => {
  it("a multi-paragraph Latin paste plants NO " +
     "stray SP break at pasted paragraph " +
     "boundaries, and splits sentences inside " +
     "paragraphs", () => {
    // paste "toki. pona sina.\nmi" over a
    // one-block doc. Paragraph 1 ITSELF ends with a
    // sentence-ender (with an empty block-final
    // latin the boundary assertions below could
    // never fail; the block-final gap generates
    // like any interior one, so this shape is the
    // load-bearing
    // proof that the SENTINEL-ADJACENT exclusion
    // -- not block-final suppression, which no
    // longer exists -- is what protects the paste
    // seam).
    const prev = block(
      [word("toki")],
      [g("", ""), g("", "")]
    );
    const out = mergeStructural(
      [prev],
      [latText("toki. pona sina."), latText("mi")],
      "latin"
    );
    expect(out).toHaveLength(2);
    // sentence break INSIDE paragraph 1
    expect(out[0].gaps[1].sp).toBe("\n");
    // NO machine break at the paragraph boundary,
    // even though this gap's latin genuinely ends
    // ". " -- the sentinel-adjacent exclusion holds
    expect(
      out[0].gaps[out[0].gaps.length - 1].sp
    ).toBe("");
    expect(out[1].gaps[0].sp).toBe("");
  });

  it("paste at a paragraph seam: pasting " +
     "'foo.\\n\\nbar' generates nothing at the " +
     "paragraph seam", () => {
    const prev = block([], [g("", "")]);
    const out = mergeStructural(
      [prev],
      [latText("foo."), latText("bar")],
      "latin"
    );
    expect(out).toHaveLength(2);
    for (const b of out) {
      for (const gp of b.gaps) {
        expect(gp.sp).toBe("");
      }
    }
  });

  it("rescued authored seam: a rescued " +
     "authored seam blocks generation (no machine " +
     "break ahead of authored '·\\n')", () => {
    const b0 = block(
      [word("toki")],
      [g("", ""), g("", "")]
    );
    const b1 = block(
      [word("pona")],
      [
        withMark(
          g(MIDDLE_DOT_CH + "\n", ""),
          "sp",
          true
        ),
        g("", ""),
      ]
    );
    // latin join whose seam gap latin newly ends
    // ". "
    const out = mergeStructural(
      [b0, b1],
      [latText("toki. pona")],
      "latin"
    );
    expect(out).toHaveLength(1);
    const seam = out[0].gaps[1];
    // rescue appended the authored '·\n'; the
    // post-rescue guards (sp authored + contains
    // "\n") both block the sentence rule: exactly
    // the rescued bytes, no extra "\n" in front.
    expect(seam.sp).toBe(MIDDLE_DOT_CH + "\n");
    expect(seam.spAuthored).toBe(true);
  });
});

describe("SP => Latin transliteration + derived " +
         "lifecycle", () => {
  const plain = () =>
    block(
      [word("toki"), word("pona")],
      [g("", ""), g(" ", " "), g("", "")]
    );
  const spDot = (mid: string) =>
    spText(
      glyph("toki") + mid + glyph("pona")
    );

  it("'·' between words derives latin '. ' " +
     "(interior append), stamped default", () => {
    const out = mergeSpBlock(
      plain(),
      spDot(MIDDLE_DOT_CH)
    );
    expect(out.gaps[1].latin).toBe(". ");
    expect(out.gaps[1].latinAuthored)
      .toBeUndefined();
    expect(out.gaps[1].spAuthored).toBe(true);
  });

  it("colon glyph derives ': '", () => {
    const out = mergeSpBlock(
      plain(),
      spDot(COLON_CH)
    );
    expect(out.gaps[1].latin).toBe(": ");
  });

  it("'·' then Enter derives '.\\n' EXACTLY ONCE — " +
     "the Enter companion never also fires " +
     "(no parity check)", () => {
    const s1 = mergeSpBlock(
      plain(),
      spDot(MIDDLE_DOT_CH)
    );
    const s2 = mergeSpBlock(
      s1,
      spDot(MIDDLE_DOT_CH + "\n")
    );
    expect(s2.gaps[1].latin).toBe(".\n");
  });

  it("'·'+Enter+delete => '. ' — the ratchet is " +
     "dead (prev-baselined surplus)", () => {
    const s1 = mergeSpBlock(
      plain(),
      spDot(MIDDLE_DOT_CH)
    );
    const s2 = mergeSpBlock(
      s1,
      spDot(MIDDLE_DOT_CH + "\n")
    );
    const s3 = mergeSpBlock(
      s2,
      spDot(MIDDLE_DOT_CH)
    );
    expect(s3.gaps[1].latin).toBe(". ");
  });

  it("deleting the last '·' re-derives to the " +
     "plain separator — no stale '. ' " +
     "(the prev-side disjunct)", () => {
    const s1 = mergeSpBlock(
      plain(),
      spDot(MIDDLE_DOT_CH)
    );
    const s2 = mergeSpBlock(s1, spDot(" "));
    expect(s2.gaps[1].latin).toBe(" ");
  });

  it("true dwell survives: prev latin '\\n\\n' " +
     "over prev sp '' + typed '·' => '. \\n\\n' " +
     "(newline-monotone)", () => {
    const b = block(
      [word("toki"), word("pona")],
      [g("", ""), g("", "\n\n"), g("", "")]
    );
    const out = mergeSpBlock(
      b,
      spDot(MIDDLE_DOT_CH)
    );
    expect(out.gaps[1].latin).toBe(". \n\n");
  });

  it("a pre-existing Enter-companion gap turning " +
     "derived absorbs the companion once, no " +
     "double", () => {
    const b = block(
      [word("toki"), word("pona")],
      [g("", ""), g("\n", "\n"), g("", "")]
    );
    const out = mergeSpBlock(
      b,
      spDot(MIDDLE_DOT_CH + "\n")
    );
    expect(out.gaps[1].latin).toBe(".\n");
  });

  it("marked-verbatim interaction: a '·' typed " +
     "between two " +
     "MARKED verbatims still derives '. '", () => {
    const b: Block = {
      anchors: [V("xq"), V("ax")],
      gaps: [g("", ""), g(" ", " "), g("", "")],
      spans: [],
    };
    const out = mergeSpBlock(
      b,
      parseSp([
        { type: "text", text: "xq",
          verbatim: true },
        { type: "text", text: MIDDLE_DOT_CH,
          verbatim: false },
        { type: "text", text: "ax",
          verbatim: true },
      ])
    );
    expect(out.gaps[1].latin).toBe(". ");
  });

  it("a user who edits the Latin side takes the " +
     "gap over: authored latin stops derivation", () => {
    const s1 = mergeSpBlock(
      plain(),
      spDot(MIDDLE_DOT_CH)
    );
    const taken = mergeLatinBlock(
      s1,
      latText("toki? pona")
    );
    expect(taken.gaps[1].latinAuthored).toBe(true);
    const s2 = mergeSpBlock(
      taken,
      spDot(MIDDLE_DOT_CH + "\n")
    );
    // derived lifecycle is off; the plain delta
    // arithmetic is ALSO gated (authored latin):
    // sp gains the break, latin bytes stay.
    expect(s2.gaps[1].latin).toBe("? ");
  });

  it("a shadowed dot is not mappable: in-context " +
     "gaps keep plain delta arithmetic (the " +
     "shadowed-mid-dot attack)", () => {
    const b = block(
      [word("toki"), word("pona")],
      [
        withMark(g(CARTOUCHE_START, ""), "sp", true),
        g(" ", " "),
        g("", ""),
      ]
    );
    const out = mergeSpBlock(
      b,
      parseSp(
        spInlinesFromText(
          CARTOUCHE_START + glyph("toki") +
            MIDDLE_DOT_CH + glyph("pona")
        )
      )
    );
    // suppressed: no '. ' derived...
    expect(out.gaps[1].latin).not.toContain(".");
    // ...and SP Enter in shadow still gets its
    // companion (non-derived => delta arithmetic)
    const entered = mergeSpBlock(
      out,
      parseSp(
        spInlinesFromText(
          CARTOUCHE_START + glyph("toki") +
            MIDDLE_DOT_CH + "\n" + glyph("pona")
        )
      )
    );
    expect(
      countNl(entered.gaps[1].latin)
    ).toBe(1);
  });

  // per-site wiring pin: the FLAT sp arm (count
  // change) runs transliteration too — remove the
  // flat wiring and only this pin fails
  it("flat sp arm: a split transaction still " +
     "re-derives a derived gap", () => {
    const b = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(g(MIDDLE_DOT_CH, " "), "sp", true),
        g("", ""),
      ]
    );
    const out = mergeStructural(
      [b],
      [
        spText(
          glyph("toki") + MIDDLE_DOT_CH +
            glyph("pona")
        ),
        spText(glyph("mi")),
      ],
      "sp"
    );
    expect(out).toHaveLength(2);
    expect(out[0].gaps[1].latin).toBe(". ");
  });

  // The stale-glyph resurrection scenario is cured
  // at the SOURCE — deleting the generated latin
  // ": " WITHDRAWS the default sp colon in the same
  // merge (symmetric colon withdrawal), so no stale
  // machine glyph even exists for a later sp edit
  // to resurrect. The vouching guard itself stays
  // load-bearing (machine glyphs still never derive
  // — e.g. the facet-unfold net's reinstated
  // colon); this fixture pins the lifecycle
  // end-to-end.
  it("deleting the generated latin " +
     "': ' withdraws the sp colon; a later " +
     "unrelated SP edit finds nothing to " +
     "resurrect", () => {
    const s0 = plain();
    const generated = mergeLatinBlock(
      s0,
      latText("toki: pona")
    );
    // the colon default plants a DEFAULT sp colon
    // alongside the authored latin ": " it
    // generated
    expect(generated.gaps[1].sp).toBe(COLON_CH + " ");
    expect(
      generated.gaps[1].spAuthored
    ).toBeUndefined();
    expect(generated.gaps[1].latin).toBe(": ");
    expect(generated.gaps[1].latinAuthored).toBe(
      true
    );
    // user deletes the colon in the Latin pane:
    // BOTH sides come back clean in ONE merge
    // (withdrawal + mark re-decide)
    const deleted = mergeLatinBlock(
      generated,
      latText("toki pona")
    );
    expect(deleted.gaps[1].sp).toBe(" ");
    expect(
      deleted.gaps[1].spAuthored
    ).toBeUndefined();
    expect(deleted.gaps[1].latin).toBe(" ");
    expect(
      deleted.gaps[1].latinAuthored
    ).toBeUndefined();
    // an UNRELATED sp edit elsewhere in the block
    // (a third word appended at the tail; the pane
    // holds no colon — withdrawal removed it from
    // the render) must not touch gap 1
    const after = mergeSpBlock(
      deleted,
      spText(
        glyph("toki") + " " + glyph("pona") +
          glyph("mi")
      )
    );
    expect(after.gaps[1].latin).toBe(" ");
    expect(after.gaps[1].latinAuthored).toBeUndefined();
    expect(after.gaps[1].sp).not.toContain(COLON_CH);
  });

  // The position-formula fork's correctness
  // argument rests on this exact property — remove
  // it and every other pin stays green while
  // block-final typing silently stops deriving.
  it("a block-final '·' still derives: " +
     "'.' now, '. ' once the next word makes it " +
     "interior", () => {
    const s1 = mergeSpBlock(
      plain(),
      spText(glyph("toki") + " " + glyph("pona") +
             MIDDLE_DOT_CH)
    );
    expect(s1.gaps[2].latin).toBe(".");
    const s2 = mergeSpBlock(
      s1,
      spText(glyph("toki") + " " + glyph("pona") +
             MIDDLE_DOT_CH + glyph("mi"))
    );
    expect(s2.gaps[2].latin).toBe(". ");
  });

  // SP=>Latin is a faithful mapping, not a
  // break-inserter — unlike Latin=>SP, gap 0 is
  // not excluded, so a leading '·' derives.
  it("a leading '·' in gap 0 derives '.' " +
     "(no gap-0 exclusion in SP=>Latin)", () => {
    const out = mergeSpBlock(
      plain(),
      spText(
        MIDDLE_DOT_CH + glyph("toki") + " " +
          glyph("pona")
      )
    );
    expect(out.gaps[0].latin).toBe(".");
  });
});

describe("cartouche shadow + " +
         "re-derivation", () => {
  it("shadow keystroke sequence: type '[', " +
     "name, spelling dots, ']' — ZERO latin " +
     "periods at every keystroke", () => {
    const states = [
      CARTOUCHE_START,
      CARTOUCHE_START + glyph("nimi"),
      CARTOUCHE_START + glyph("nimi") +
        MIDDLE_DOT_CH,
      CARTOUCHE_START + glyph("nimi") +
        MIDDLE_DOT_CH + MIDDLE_DOT_CH,
      CARTOUCHE_START + glyph("nimi") +
        MIDDLE_DOT_CH + MIDDLE_DOT_CH +
        CARTOUCHE_END,
    ];
    let b = block([], [g("", "")]);
    for (const text of states) {
      b = mergeSpBlock(b, spText(text));
      for (const gp of b.gaps) {
        expect(gp.latin).not.toContain(".");
      }
    }
  });

  it("'['-deletion variant: the freed dot becomes " +
     "prose and re-derivation generates AT THAT " +
     "keystroke (shadow exit, no byte change on " +
     "the dot gap)", () => {
    // "[·toki": the dot precedes the word, so it
    // never folds — a free-standing literal in the
    // shadow.
    const s1 = mergeSpBlock(
      block([], [g("", "")]),
      spText(
        CARTOUCHE_START + MIDDLE_DOT_CH +
          glyph("toki")
      )
    );
    expect(s1.gaps[0].sp).toBe(
      CARTOUCHE_START + MIDDLE_DOT_CH
    );
    expect(s1.gaps[0].latin).not.toContain(".");
    // delete the "[": context exits; the dot gap's
    // own bytes change here too, but the point is
    // the derivation fires against the NEW context
    const s2 = mergeSpBlock(
      s1,
      spText(MIDDLE_DOT_CH + glyph("toki"))
    );
    expect(s2.gaps[0].sp).toBe(MIDDLE_DOT_CH);
    expect(s2.gaps[0].latin).toBe(".");
  });

  it("shadow ENTRY over a derived gap " +
     "clears the derived '. ' (latin is carried " +
     "on the sp merge, so the strip may fire)", () => {
    const plainB = block(
      [word("toki"), word("pona")],
      [g("", ""), g(" ", " "), g("", "")]
    );
    const s1 = mergeSpBlock(
      plainB,
      spText(
        glyph("toki") + MIDDLE_DOT_CH +
          glyph("pona")
      )
    );
    expect(s1.gaps[1].latin).toBe(". ");
    const s2 = mergeSpBlock(
      s1,
      spText(
        CARTOUCHE_START + glyph("toki") +
          MIDDLE_DOT_CH + glyph("pona")
      )
    );
    for (const gp of s2.gaps) {
      expect(gp.latin).not.toContain(".");
    }
  });

  it("re-derivation narrowness: a demoted " +
     "marker byte on a DEFAULT sp side survives", () => {
    // synthetic default-marked marker inside a
    // shadow (the old-doc / demote-restore shape)
    const b: Block = {
      anchors: [
        { ...word("toki") },
        { ...word("pona") },
      ],
      gaps: [
        g(CARTOUCHE_START, ""),
        g(CARTOUCHE_START + " ", " "),
        g("", ""),
      ],
      spans: [],
    };
    const out = mergeLatinBlock(
      b,
      latText("toki pona")
    );
    expect(out.gaps[1].sp).toBe(
      CARTOUCHE_START + " "
    );
  });

  it("parse authority: never rewrite " +
     "sp bytes on an SP-edited merge — the machine " +
     "colon persists as a suppressed default " +
     "literal; the NEXT latin merge is the " +
     "carried-side opportunity and removes it", () => {
    // machine colon after a VERBATIM anchor (the
    // no-fold shape).
    // The state the colon generator leaves behind:
    // machine colon DEFAULT in sp, typed ': '
    // AUTHORED in latin
    const b: Block = {
      anchors: [V("xq"), { ...word("pona") }],
      gaps: [
        g("", ""),
        withMark(
          g(COLON_CH + " ", ": "),
          "latin",
          true
        ),
        g("", ""),
      ],
      spans: [],
    };
    // SP edit: type "[" before xq
    const spEdited = mergeSpBlock(
      b,
      parseSp([
        {
          type: "text",
          text: CARTOUCHE_START,
          verbatim: false,
        },
        { type: "text", text: "xq",
          verbatim: true },
        {
          type: "text",
          text: COLON_CH + " ",
          verbatim: false,
        },
        {
          type: "text",
          text: glyph("pona"),
          verbatim: false,
        },
      ])
    );
    // the colon SURVIVES the sp-edited merge
    expect(spEdited.gaps[1].sp).toContain(
      COLON_CH
    );
    expect(
      spEdited.gaps[1].spAuthored
    ).toBeUndefined();
    // a latin no-op is the carried-side
    // opportunity: the suppressed machine colon
    // is removed
    const latinNoOp = mergeLatinBlock(
      spEdited,
      parseLatin(renderLatin(spEdited).inlines)
    );
    for (const gp of latinNoOp.gaps) {
      expect(gp.sp).not.toContain(COLON_CH);
    }
  });

  // per-site wiring pins: the FLAT arms run the
  // re-derivation too — remove one flat wiring and
  // exactly its pin fails
  it("flat latin arm: a latin JOIN is a " +
     "carried-side opportunity — the in-context " +
     "machine colon is removed", () => {
    const b0: Block = {
      anchors: [V("xq"), { ...word("pona") }],
      gaps: [
        withMark(g(CARTOUCHE_START, ""), "sp", true),
        withMark(
          g(COLON_CH + " ", ": "),
          "latin",
          true
        ),
        g("", ""),
      ],
      spans: [],
    };
    const b1 = block(
      [word("mi")],
      [g("", ""), g("", "")]
    );
    const out = mergeStructural(
      [b0, b1],
      [latText("xq: pona mi")],
      "latin"
    );
    expect(out).toHaveLength(1);
    for (const gp of out[0].gaps) {
      expect(gp.sp).not.toContain(COLON_CH);
    }
  });

  it("flat sp arm: a split transaction still " +
     "clears a derived '. ' inside a shadow " +
     "(through the flat tail)", () => {
    const b = block(
      [word("toki"), word("pona")],
      [
        withMark(g(CARTOUCHE_START, ""), "sp", true),
        withMark(g(MIDDLE_DOT_CH, ". "), "sp", true),
        g("", ""),
      ]
    );
    // NOTE: gap 1's latin '. ' is DEFAULT (no
    // latin mark) — the derived image inside a
    // shadow, minted before the '[' appeared.
    const out = mergeStructural(
      [b],
      [
        spText(
          CARTOUCHE_START + glyph("toki") +
            MIDDLE_DOT_CH + glyph("pona")
        ),
        spText(glyph("mi")),
      ],
      "sp"
    );
    expect(out).toHaveLength(2);
    for (const gp of out[0].gaps) {
      expect(gp.latin).not.toContain(".");
    }
  });

  // Span membership can ride marker OFFSETS, not
  // just gap position: a cartouche whose closing
  // ']' sits mid-gap (endOffset > 0) still owns the
  // gap BYTES BEFORE the offset — reproduced
  // against mergeLatinBlock's colon generation
  // (generateSpFromLatin relies on the SAME
  // inCartoucheContext predicate).
  it("endOffset context leak: a colon " +
     "generation trigger must not land inside a " +
     "cartouche whose closing gap carries an " +
     "endOffset interior region", () => {
    const b: Block = {
      ...block(
        [word("toki"), word("pona")],
        [
          g(CARTOUCHE_START, ""),
          g(" " + CARTOUCHE_END, " "),
          g("", ""),
        ]
      ),
      spans: [
        cart(0, 0, { endOffset: 1 }),
      ],
    };
    const out = mergeLatinBlock(
      b,
      latText("toki: pona")
    );
    expect(out.gaps[1].sp).not.toContain(COLON_CH);
  });

  // Class 1's own offset remap (the strip's shift,
  // distinct from generateSpFromLatin's prepend
  // shift covered above), on a reachable fixture: a
  // closing gap that ALREADY holds a machine colon
  // ahead of the endOffset-carried interior region.
  it("class 1's remap: stripping a " +
     "machine colon from an endOffset-carried " +
     "closing gap shifts the offset correctly " +
     "(not an identity remap)", () => {
    const b: Block = {
      ...block(
        [word("toki"), word("pona")],
        [
          g(CARTOUCHE_START, ""),
          g(
            COLON_CH + " " + CARTOUCHE_END,
            " "
          ),
          g("", ""),
        ]
      ),
      spans: [
        cart(0, 0, { endOffset: 3 }),
      ],
    };
    // a latin NO-OP is the carried-side opportunity
    const out = mergeLatinBlock(
      b,
      parseLatin(renderLatin(b).inlines)
    );
    expect(out.gaps[1].sp).toBe(
      " " + CARTOUCHE_END
    );
    // COLON_CH is a surrogate pair: 3 -> 1, not 3 -> 3
    expect(out.spans[0].endOffset).toBe(1);
  });

  // Distinguishes "closing gap with a real
  // endOffset interior region" from "any closing
  // gap" — broadening the context predicate to
  // unconditionally suppress every `gi === s.to+1`
  // gap must fail here.
  it("negative pin: a closing gap with " +
     "NO endOffset (edge-adjacent marker) still " +
     "generates its colon — the offset-context " +
     "extension does not over-suppress", () => {
    const b: Block = {
      ...block(
        [word("toki"), word("pona")],
        [
          g(CARTOUCHE_START, ""),
          g(" " + CARTOUCHE_END, " "),
          g("", ""),
        ]
      ),
      spans: [
        cart(0, 0),
      ],
    };
    const out = mergeLatinBlock(
      b,
      latText("toki: pona")
    );
    expect(out.gaps[1].sp).toBe(
      COLON_CH + " " + CARTOUCHE_END
    );
  });

  // Parse authority is implemented symmetrically,
  // so both directions get a pin. Mirror of "parse
  // authority" above: on a LATIN-edited merge,
  // latin is the EDITED/authoritative side, so a
  // default derived latin image in cartouche
  // context must survive untouched (only the NEXT
  // sp merge may strip it).
  it("parse-authority mirror: a latin-edited " +
     "no-op never strips a default derived latin " +
     "'. ' sitting in cartouche context (sp marked " +
     "AUTHORED so it WOULD vouch for the class-3 " +
     "strip if editedSide stopped gating class 3's " +
     "reach — isolating the two arms is what " +
     "protects it)", () => {
    const b: Block = {
      ...block(
        [word("toki"), word("pona")],
        [
          g(CARTOUCHE_START, ""),
          withMark(
            g(MIDDLE_DOT_CH, ". "),
            "sp",
            true
          ),
          g("", ""),
        ]
      ),
      spans: [],
    };
    const out = mergeLatinBlock(
      b,
      parseLatin(renderLatin(b).inlines)
    );
    expect(out.gaps[1].latin).toBe(". ");
  });

  // Owned class 2 (the generated "\n" reset) gets
  // two targeted pins: one firing (an orphaned "["
  // survives a Latin word deletion that drops its
  // matching "]", newly shadowing a plain generated
  // break) and one refusal (an old-doc break that
  // was ALREADY in context in prev must never be
  // eaten).
  it("class 2 FIRES: a Latin word " +
     "deletion orphans '[' (its ']' partner dies " +
     "with it), newly shadowing a plain generated " +
     "break — reset to the interior default", () => {
    const prev = block(
      [
        word("toki"),
        word("olin"),
        word("pona"),
        word("mi"),
      ],
      [
        g("", ""),
        g(CARTOUCHE_START, " "),
        g(CARTOUCHE_END, " "),
        g("\n", ". "),
        g("", ""),
      ]
    );
    const out = mergeLatinBlock(
      prev,
      latText("toki pona mi")
    );
    // "olin" died; only "[" survives the fusion
    expect(out.gaps[1].sp).toBe(CARTOUCHE_START);
    // the plain "\n" is now shadowed and freshly
    // entered (prev had it balanced/out of context)
    expect(out.gaps[2].sp).toBe(" ");
  });

  it("class 2 REFUSES: an old-doc " +
     "break that was ALREADY in cartouche context " +
     "in prev survives a latin no-op untouched " +
     "(freshly-entered guard declines)", () => {
    const b: Block = {
      ...block(
        [word("toki"), word("pona")],
        [
          g(CARTOUCHE_START, ""),
          g("\n", ". "),
          g("", ""),
        ]
      ),
      spans: [
        cart(0, 1),
      ],
    };
    const out = mergeLatinBlock(
      b,
      parseLatin(renderLatin(b).inlines)
    );
    expect(out.gaps[1].sp).toBe("\n");
    expect(out.gaps[1].latin).toBe(". ");
  });

  // Class 3's vouching test must carry the
  // authored-sp conjunct, same as isDerivedGap — a
  // machine-planted (default) colon must not vouch
  // for stripping a co-default derived latin image
  // next to it.
  it("a machine-planted (default) sp " +
     "colon does not vouch for stripping a " +
     "co-default derived latin ':' on shadow " +
     "entry (vouching parity)", () => {
    const b: Block = {
      anchors: [V("xq"), { ...word("pona") }],
      gaps: [
        g("", ""),
        g(COLON_CH + " ", ": "),
        g("", ""),
      ],
      spans: [],
    };
    const spEdited = mergeSpBlock(
      b,
      parseSp([
        {
          type: "text",
          text: CARTOUCHE_START,
          verbatim: false,
        },
        { type: "text", text: "xq",
          verbatim: true },
        {
          type: "text",
          text: COLON_CH + " ",
          verbatim: false,
        },
        {
          type: "text",
          text: glyph("pona"),
          verbatim: false,
        },
      ])
    );
    expect(spEdited.gaps[1].sp).toContain(COLON_CH);
    expect(
      spEdited.gaps[1].spAuthored
    ).toBeUndefined();
    expect(spEdited.gaps[1].latin).toBe(": ");
  });
});

describe("facet-unfold net", () => {
  const nimiPona = () =>
    block(
      [word("nimi"), word("pona")],
      [g("", ""), g(" ", " "), g("", "")]
    );

  it("headline: Latin 'nimi: pona', then SP " +
     "'[' before nimi — no minted scheme, the colon " +
     "survives as a default literal, render is " +
     "byte-identical to the pane, and the state is " +
     "STABLE across subsequent keystrokes", () => {
    const s1 = mergeLatinBlock(
      nimiPona(),
      latText("nimi: pona")
    );
    expect(s1.gaps[1].sp).toBe(COLON_CH + " ");
    const paneText =
      CARTOUCHE_START + glyph("nimi") +
      COLON_CH + " " + glyph("pona");
    const s2 = mergeSpBlock(s1, spText(paneText));
    expect(
      s2.anchors.every(
        (a) => a.nameScheme === undefined
      )
    ).toBe(true);
    expect(
      s2.gaps[1].sp.startsWith(COLON_CH)
    ).toBe(true);
    expect(s2.gaps[1].spAuthored).toBeUndefined();
    expect(renderSp(s2).text).toBe(paneText);
    // stability: the next SP keystroke re-parses
    // the pane; the fold re-mints and the net
    // re-fires — byte-stable fixpoint
    const s3 = mergeSpBlock(
      s2,
      parseSp(renderSp(s2).inlines)
    );
    expect(renderSp(s3).text).toBe(paneText);
    expect(
      s3.anchors.every(
        (a) => a.nameScheme === undefined
      )
    ).toBe(true);
  });

  it("the reinstated " +
     "colon stays INSIDE a cartouche whose end " +
     "marker is edge-adjacent — byte ORDER is " +
     "preserved, and the state is stable across " +
     "subsequent merges", () => {
    const s1 = mergeLatinBlock(
      nimiPona(),
      latText("nimi: pona")
    );
    const paneText =
      CARTOUCHE_START + glyph("nimi") + COLON_CH +
      CARTOUCHE_END + " " + glyph("pona");
    const s2 = mergeSpBlock(s1, spText(paneText));
    // "[nimi:] pona", NOT "[nimi]: pona" — the
    // reinstated colon must land BEFORE the edge-
    // adjacent close marker, not after it
    expect(renderSp(s2).text).toBe(paneText);
    const s3 = mergeSpBlock(
      s2,
      parseSp(renderSp(s2).inlines)
    );
    expect(renderSp(s3).text).toBe(paneText);
  });

  it("paste-scramble: pasting '[sina' " +
     "between the word and the machine colon — the " +
     "FRESH fold host is caught by block-level " +
     "detection", () => {
    const b = block(
      [word("toki"), word("pona")],
      [g("", ""), g(COLON_CH + " ", " "), g("", "")]
    );
    const paneText =
      glyph("toki") + CARTOUCHE_START +
      glyph("sina") + COLON_CH + " " +
      glyph("pona");
    const out = mergeSpBlock(b, spText(paneText));
    expect(
      out.anchors.every(
        (a) => a.nameScheme === undefined
      )
    ).toBe(true);
    expect(renderSp(out).text).toBe(paneText);
  });

  it("authored-colon control: a user-typed colon's " +
     "fold KEEPS its scheme (authored folds are " +
     "intentional)", () => {
    const b = block(
      [word("nimi"), word("pona")],
      [
        g(CARTOUCHE_START, ""),
        withMark(g(COLON_CH + " ", " "), "sp", true),
        g("", ""),
      ]
    );
    const out = mergeSpBlock(
      b,
      parseSp(renderSp(b).inlines)
    );
    expect(out.anchors[0].nameScheme).toEqual({
      style: "word",
    });
  });

  it("delete-and-retype tie-break: one " +
     "transaction deletes the machine colon and " +
     "types a real colon after the OTHER word — " +
     "the typed scheme is NOT unfolded", () => {
    const b = block(
      [word("nimi"), word("pona")],
      [
        withMark(g(CARTOUCHE_START, ""), "sp", true),
        g(COLON_CH + " ", " "),
        g("", ""),
      ]
    );
    const out = mergeSpBlock(
      b,
      spText(
        CARTOUCHE_START + glyph("nimi") + " " +
          glyph("pona") + COLON_CH
      )
    );
    // pona (the RIGHT flank of the vanished
    // colon's gap) keeps its typed scheme
    expect(out.anchors[1].nameScheme).toEqual({
      style: "word",
    });
    // and the machine colon stays deleted
    expect(
      out.gaps.some((gp) =>
        gp.sp.includes(COLON_CH)
      )
    ).toBe(false);
  });

  it("name-edit-exemption statement: a CARRIED " +
     "word-scheme with no vanished colon anywhere " +
     "in the block is untouched (name-edit paths " +
     "are exempt by construction). " +
     "This fixture has no vanished default colon, so " +
     "it never reaches gate 1 and does NOT " +
     "discriminate the 'carried, not minted' guard — " +
     "see the guard pin below for that", () => {
    const b: Block = {
      anchors: [
        {
          kind: "word",
          word: "nimi",
          nameScheme: { style: "word" },
        },
        { kind: "word", word: "pona" },
      ],
      gaps: [
        g(CARTOUCHE_START, ""),
        g(" ", " "),
        g(CARTOUCHE_END, ""),
      ],
      spans: [],
    };
    const out = mergeSpBlock(
      b,
      parseSp(renderSp(b).inlines)
    );
    expect(out.anchors[0].nameScheme).toEqual({
      style: "word",
    });
  });

  it("carried-scheme " +
     "guard: an extra typed colon, then a delete, " +
     "does NOT demote the carried scheme — REACHABLE " +
     "via three ordinary SP keystrokes, no hand-built " +
     "Blocks", () => {
    const s1 = mergeLatinBlock(
      nimiPona(),
      latText("nimi: pona")
    );
    const open = CARTOUCHE_START + glyph("nimi");
    const s2 = mergeSpBlock(
      s1,
      spText(open + COLON_CH + " " + glyph("pona"))
    );
    // a SECOND typed colon: parseSp folds the FIRST
    // into nimi.nameScheme and leaves the second as
    // default gap content — gate 2 (a colon still
    // present in an output gap) makes the net a
    // no-op, leaving a CARRIED word-scheme sitting
    // next to a default colon: exactly the guard's
    // precondition
    const s3 = mergeSpBlock(
      s2,
      spText(
        open + COLON_CH + COLON_CH + " " +
          glyph("pona")
      )
    );
    expect(s3.anchors[0].nameScheme).toEqual({
      style: "word",
    });
    expect(s3.gaps[1].sp).toBe(COLON_CH + " ");
    expect(s3.gaps[1].spAuthored).toBeUndefined();
    // delete one colon: gate 1 (prev had a default
    // colon) and gate 2 (none survives) both now
    // hold, and the carried scheme must survive
    const s4 = mergeSpBlock(
      s3,
      spText(open + COLON_CH + " " + glyph("pona"))
    );
    expect(s4.anchors[0].nameScheme).toEqual({
      style: "word",
    });
  });

  // per-site wiring pin: the FLAT sp arm runs the
  // net too — remove the flat wiring and only this
  // pin fails
  it("flat sp arm: a paste that both scrambles " +
     "and SPLITS still unfolds the minted scheme", () => {
    const b = block(
      [word("toki"), word("pona")],
      [g("", ""), g(COLON_CH + " ", " "), g("", "")]
    );
    const out = mergeStructural(
      [b],
      [
        spText(
          glyph("toki") + CARTOUCHE_START +
            glyph("sina") + COLON_CH + " " +
            glyph("pona")
        ),
        spText(glyph("mi")),
      ],
      "sp"
    );
    expect(out).toHaveLength(2);
    expect(
      out
        .flatMap((ob) => ob.anchors)
        .every((a) => a.nameScheme === undefined)
    ).toBe(true);
    expect(
      out[0].gaps.some((gp) =>
        gp.sp.includes(COLON_CH)
      )
    ).toBe(true);
  });
});
