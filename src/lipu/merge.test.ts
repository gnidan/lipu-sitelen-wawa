import { describe, it, expect } from "vitest";
import {
  mergeBlock,
  mergeBlockDetailed,
} from "./merge";
import { renderSp } from "./render-sp";
import { parseSp } from "./parse-sp";
import { renderLatin } from "./render-latin";
import { parseLatin } from "./parse-latin";
import {
  CARTOUCHE_START,
  CARTOUCHE_END,
  STACK,
} from "./chars";
import type { Anchor, Block, ParsedSide } from
  "./types";
import { glyph, gap, word, vb, block, cart, span }
  from "../../test/helpers";

const CS = CARTOUCHE_START;
const CE = CARTOUCHE_END;

function latinNoOp(prev: Block): Block {
  return mergeBlock(
    prev,
    parseLatin(renderLatin(prev).inlines),
    "latin"
  );
}
function spNoOp(prev: Block): Block {
  return mergeBlock(
    prev,
    parseSp(renderSp(prev).inlines),
    "sp"
  );
}

describe("mergeBlock — gap ownership", () => {
  it("founding example: deleting B from " +
     "'A, B, C' on the SP side leaves Latin " +
     "'A, C'", () => {
    const prev = block({
      anchors: [
        word("toki"), word("pona"), word("mute"),
      ],
      gaps: [
        gap(),
        gap(" ", ", "),
        gap(" ", ", "),
        gap(),
      ],
    });
    const next: ParsedSide = {
      anchors: [word("toki"), word("mute")],
      gaps: ["", " ", ""],
    };
    expect(
      mergeBlock(prev, next, "sp")
    ).toEqual(
      block({
        anchors: [word("toki"), word("mute")],
        gaps: [gap(), gap(" ", ", "), gap()],
      })
    );
  });

  it("insertion lands after the left anchor's " +
     "owned content ('moku, ala li')", () => {
    const prev = block({
      anchors: [
        word("mi"), word("moku"),
        word("li"), word("lape"),
      ],
      gaps: [
        gap(), gap(" ", " "), gap(" ", ", "),
        gap(" ", " "), gap(),
      ],
    });
    const next: ParsedSide = {
      anchors: [
        word("mi"), word("moku"), word("ala"),
        word("li"), word("lape"),
      ],
      gaps: ["", " ", " ", " ", " ", ""],
    };
    expect(mergeBlock(prev, next, "sp")).toEqual(
      block({
        anchors: next.anchors,
        gaps: [
          gap(), gap(" ", " "), gap(" ", ", "),
          gap(" ", " "), gap(" ", " "), gap(),
        ],
      })
    );
  });

  it("end-of-block insertion: the new anchor's " +
     "owned (final) gap gets no separator; the " +
     "left neighbor's owned gap carries " +
     "(ownership-consistent)", () => {
    const prev = block({
      anchors: [word("toki"), word("pona")],
      gaps: [gap(), gap(" ", " "), gap()],
    });
    const next: ParsedSide = {
      anchors: [
        word("toki"), word("pona"), word("mute"),
      ],
      gaps: ["", " ", " ", ""],
    };
    expect(mergeBlock(prev, next, "sp")).toEqual(
      block({
        anchors: next.anchors,
        gaps: [
          gap(), gap(" ", " "), gap(" ", ""),
          gap(),
        ],
      })
    );
  });

  it("deleting every anchor leaves only the " +
     "Block-owned gaps[0]", () => {
    const prev = block({
      anchors: [word("toki"), word("pona")],
      gaps: [
        gap("", "lead"),
        gap(" ", ", "),
        gap("", "!"),
      ],
      spans: [
        cart(0, 1),
      ],
    });
    expect(
      mergeBlock(
        prev,
        { anchors: [], gaps: [""] },
        "sp"
      )
    ).toEqual(
      block({ gaps: [gap("", "lead")] })
    );
  });

  it("count-mismatched retype: surplus prev " +
     "anchors die with their owned gaps", () => {
    const prev = block({
      anchors: [word("toki"), word("pona")],
      gaps: [
        gap(), gap(" ", ", "), gap("", "!"),
      ],
    });
    const next: ParsedSide = {
      anchors: [word("kili")],
      gaps: ["", ""],
    };
    // kili replacement-pairs with toki (carries
    // toki's owned gap); pona dies with "!"
    expect(mergeBlock(prev, next, "sp")).toEqual(
      block({
        anchors: [word("kili")],
        gaps: [gap(), gap("", ", ")],
      })
    );
  });

  it("zero-anchor prev: gaps[0] carries under an " +
     "SP edit that adds the first anchor", () => {
    const prev = block({
      gaps: [gap("", "hello ")],
    });
    const next: ParsedSide = {
      anchors: [word("toki")],
      gaps: ["", ""],
    };
    expect(mergeBlock(prev, next, "sp")).toEqual(
      block({
        anchors: [word("toki")],
        gaps: [gap("", "hello "), gap()],
      })
    );
  });

  it("an SP line-join deletes only gap.sp's " +
     "newline; gap.latin keeps its own", () => {
    const prev = block({
      anchors: [word("toki"), word("pona")],
      gaps: [gap(), gap("\n", "\n"), gap()],
    });
    const next: ParsedSide = {
      anchors: [word("toki"), word("pona")],
      gaps: ["", "", ""],
    };
    expect(mergeBlock(prev, next, "sp")).toEqual(
      block({
        anchors: prev.anchors,
        gaps: [gap(), gap("", "\n"), gap()],
      })
    );
  });
});

describe("mergeBlock — re-absorption", () => {
  it("Latin no-op keeps an SP-typed punctuation " +
     "verbatim byte-for-byte ('toki !')", () => {
    const prev = block({
      anchors: [word("toki"), vb("!")],
      gaps: [gap(), gap(" ", " "), gap()],
    });
    expect(latinNoOp(prev)).toEqual(prev);
  });

  it("Latin no-op keeps a digit verbatim " +
     "('nanpa 42')", () => {
    const prev = block({
      anchors: [word("nanpa"), vb("42")],
      gaps: [gap(), gap(" ", " "), gap()],
    });
    expect(latinNoOp(prev)).toEqual(prev);
  });

  it("trailing-space absorption flip: 'aa ' " +
     "re-anchors across the split anchor and " +
     "gap", () => {
    const prev = block({
      anchors: [vb("aa ")],
      gaps: [gap(), gap()],
    });
    expect(latinNoOp(prev)).toEqual(prev);
  });

  it("a mixed-run verbatim ('a.b') re-anchors " +
     "across scattered next anchors", () => {
    const prev = block({
      anchors: [vb("a.b")],
      gaps: [gap(), gap()],
    });
    expect(latinNoOp(prev)).toEqual(prev);
  });

  it("inverse guard: a digit verbatim whose whole " +
     "text re-tokenized as GAP content still " +
     "re-anchors", () => {
    // the sole covered item is a GAP, not an
    // anchor, so the SP-edits-only gate's
    // bare-substitution decline must not fire here
    const prev = block({
      anchors: [vb("42")],
      gaps: [gap(), gap()],
    });
    const parsed = parseLatin(
      renderLatin(prev).inlines
    );
    expect(parsed.anchors).toEqual([]);
    expect(parsed.gaps).toEqual(["42"]);
    expect(
      mergeBlock(prev, parsed, "latin")
    ).toEqual(prev);
  });

  it("the SP-edits-only gate is SP-ONLY: a Latin " +
     "no-op over an un-glyphed verbatim 'toki' " +
     "keeps the SP bytes (the Latin parse has no " +
     "authority over kind)", () => {
    // parseLatin re-reads "toki" as a WORD anchor;
    // letting the gate decline here would
    // replacement-pair it and silently glyph the
    // SP pane
    const prev = block({
      anchors: [vb("toki")],
      gaps: [gap(), gap()],
    });
    const out = latinNoOp(prev);
    expect(renderSp(out).text).toBe(
      renderSp(prev).text
    );
    expect(out).toEqual(prev);
  });

  it("NFD verbatim survives a Latin no-op with " +
     "its SP bytes exactly", () => {
    const nfd = "cafe\u0301"; // e + U+0301
    expect(nfd).toHaveLength(5);
    const prev = block({
      anchors: [vb(nfd, true)],
      gaps: [gap(), gap()],
    });
    const out = latinNoOp(prev);
    expect(renderSp(out).text).toBe(
      renderSp(prev).text
    );
    expect(out).toEqual(prev);
  });

  it("a real Latin deletion still deletes (no " +
     "occurrence, no resurrection)", () => {
    const prev = block({
      anchors: [word("toki"), vb("!")],
      gaps: [gap(), gap(" ", " "), gap()],
    });
    const next: ParsedSide = {
      anchors: [word("toki")],
      gaps: ["", ""],
    };
    expect(
      mergeBlock(prev, next, "latin")
    ).toEqual(
      block({
        anchors: [word("toki")],
        gaps: [gap(), gap(" ", "")],
      })
    );
  });
});

describe("mergeBlock — attr carry", () => {
  it("Latin word swap resets variation, keeps " +
     "the joiner between anchors", () => {
    const prev = block({
      anchors: [
        { kind: "word", word: "toki",
          variation: 2 },
        word("pona"),
      ],
      gaps: [gap(), gap(STACK, " "), gap()],
    });
    const next: ParsedSide = {
      anchors: [word("kili"), word("pona")],
      gaps: ["", " ", ""],
    };
    expect(
      mergeBlock(prev, next, "latin")
    ).toEqual(
      block({
        anchors: [word("kili"), word("pona")],
        gaps: [gap(), gap(STACK, " "), gap()],
      })
    );
  });

  it("unchanged word keeps every attr on a " +
     "Latin no-op", () => {
    const prev = block({
      anchors: [
        { kind: "word", word: "sewi",
          variation: 1, case: "capital" },
      ],
      gaps: [gap(), gap()],
    });
    expect(latinNoOp(prev)).toEqual(prev);
  });

  it("SP word swap keeps case", () => {
    const prev = block({
      anchors: [
        { kind: "word", word: "toki",
          case: "capital" },
      ],
      gaps: [gap(), gap()],
    });
    const next: ParsedSide = {
      anchors: [word("kili")],
      gaps: ["", ""],
    };
    expect(
      mergeBlock(prev, next, "sp").anchors
    ).toEqual([
      { kind: "word", word: "kili",
        case: "capital" },
    ]);
  });

  it("marked-flip on same text is a replacement, " +
     "not a match (SP edit: parse wins)", () => {
    const prev = block({
      anchors: [vb("hello")],
      gaps: [gap(), gap()],
    });
    const next: ParsedSide = {
      anchors: [vb("hello", true)],
      gaps: ["", ""],
    };
    expect(
      mergeBlock(prev, next, "sp").anchors
    ).toEqual([vb("hello", true)]);
  });

  it("Latin edits have no authority over " +
     "markedness: replacement keeps prev's " +
     "unmarked state", () => {
    const prev = block({
      anchors: [vb("xq")],
      gaps: [gap(), gap()],
    });
    const next: ParsedSide = {
      anchors: [vb("zz", true)],
      gaps: ["", ""],
    };
    expect(
      mergeBlock(prev, next, "latin").anchors
    ).toEqual([vb("zz")]);
  });

  it("slot semantics: retyping the word inside a " +
     "cartouche keeps nameScheme, the span, and " +
     "latinSpelling", () => {
    const prev = block({
      anchors: [
        { kind: "word", word: "nena",
          nameScheme: { style: "word" } },
      ],
      gaps: [gap(), gap()],
      spans: [
        cart(0, 0, { attrs: { latinSpelling: "Nena" } }),
      ],
    });
    const next: ParsedSide = {
      anchors: [word("kili")],
      gaps: ["", ""],
    };
    expect(
      mergeBlock(prev, next, "latin")
    ).toEqual(
      block({
        anchors: [
          { kind: "word", word: "kili",
            nameScheme: { style: "word" } },
        ],
        gaps: [gap(), gap()],
        spans: prev.spans,
      })
    );
  });
});

describe("mergeBlock — span reconciliation", () => {
  it("SP no-op round trip re-promotes spans with " +
     "their attrs (triple pairing)", () => {
    const prev = block({
      anchors: [
        { kind: "word", word: "nena",
          nameScheme: { style: "morae",
            count: 1 } },
      ],
      gaps: [gap(), gap(" ")],
      spans: [
        cart(0, 0, { attrs: { latinSpelling: "Ne" } }),
      ],
    });
    expect(spNoOp(prev)).toEqual(prev);
  });

  it("identical-range nested cartouches keep " +
     "BOTH attrs on an SP no-op (depth ties " +
     "resolve in span-array order)", () => {
    // normalizeBlock produces this from doubled
    // markers "[[x]]"; anchor ranges cannot tell
    // the two apart, but the marker stream can
    const prev = block({
      anchors: [word("nena")],
      gaps: [gap(), gap()],
      spans: [
        cart(0, 0, { attrs: { latinSpelling: "Outer" } }),
        cart(0, 0, { attrs: { latinSpelling: "Inner" } }),
      ],
    });
    expect(renderSp(prev).text).toBe(
      CS + CS + renderSp(
        block({ anchors: [word("nena")],
                gaps: [gap(), gap()] })
      ).text + CE + CE
    );
    expect(spNoOp(prev)).toEqual(prev);
  });

  it("deleting a start marker demotes: the span " +
     "dies, the end marker stays transitional", () => {
    const prev = block({
      anchors: [word("nena")],
      gaps: [gap(), gap()],
      spans: [
        cart(0, 0, { attrs: { latinSpelling: "N" } }),
      ],
    });
    const next: ParsedSide = {
      anchors: [word("nena")],
      gaps: ["", CE],
    };
    expect(mergeBlock(prev, next, "sp")).toEqual(
      block({
        anchors: [word("nena")],
        gaps: [gap(), gap(CE)],
      })
    );
  });

  it("demote then re-promote drops attrs (fresh " +
     "pair)", () => {
    const prev = block({
      anchors: [word("nena")],
      gaps: [gap(), gap(CE)],
    });
    const next: ParsedSide = {
      anchors: [word("nena")],
      gaps: [CS, CE],
    };
    expect(mergeBlock(prev, next, "sp")).toEqual(
      block({
        anchors: [word("nena")],
        gaps: [gap(), gap()],
        spans: [
          cart(0, 0),
        ],
      })
    );
  });

  it("a new inner pair promotes fresh; the outer " +
     "span keeps its attrs", () => {
    const prev = block({
      anchors: [word("nena"), word("kili")],
      gaps: [gap(), gap(), gap()],
      spans: [
        cart(0, 1, { attrs: { latinSpelling: "Nk" } }),
      ],
    });
    const next: ParsedSide = {
      anchors: [word("nena"), word("kili")],
      gaps: [CS, CS, CE + CE],
    };
    expect(
      mergeBlock(prev, next, "sp").spans
    ).toEqual([
      cart(0, 1, { attrs: { latinSpelling: "Nk" } }),
      cart(1, 1),
    ]);
  });

  // Promotion is BYTE-PRESERVING for all marker
  // positions. The merge promotes on the same code
  // path as normalizeBlock, so an SP edit that
  // CLOSES a pair around a trapped char keeps the
  // char where the user typed it and records the
  // marker's offset. Recording the offset in the
  // MERGE (not just normalizeBlock) is what keeps
  // this correct through live typing, since every
  // SP keystroke re-promotes from the parse.
  it("SP edit closing a pair around a trapped " +
     "char keeps the bytes ('[ toki]')", () => {
    const prev = block({
      anchors: [word("toki")],
      gaps: [gap(" "), gap()],
    });
    const next: ParsedSide = {
      anchors: [word("toki")],
      gaps: [CS + " ", CE],
    };
    const out = mergeBlock(prev, next, "sp");
    expect(out).toEqual(
      block({
        anchors: [word("toki")],
        gaps: [gap(" "), gap()],
        spans: [
          cart(0, 0, { startOffset: 0 }),
        ],
      })
    );
    // ...which is byte-for-byte the SP text the
    // parse asserted (gaps[0] + anchor + gaps[1])
    expect(renderSp(out).text).toBe(
      next.gaps[0] + glyph("toki") + next.gaps[1]
    );
    // stable: an SP no-op over the result changes
    // nothing
    expect(spNoOp(out)).toEqual(out);
  });

  // ATTR POSITION VALIDATION: positions are compared
  // through the anchor mapping. The (kind, depth,
  // ordinal) triple
  // RENUMBERS, so without the position check a
  // fresh pair inherits a shifted ordinal and
  // steals another span's latinSpelling.
  it("a cartouche prepended by an SP edit does " +
     "NOT steal the following span's " +
     "latinSpelling", () => {
    const prev = block({
      anchors: [word("nena"), word("pona")],
      gaps: [gap(), gap(" "), gap()],
      spans: [
        cart(0, 0, { attrs: { latinSpelling: "Xena" } }),
      ],
    });
    // the user typed a new [kili] cartouche in
    // front; nena's markers are unchanged
    const next: ParsedSide = {
      anchors: [
        word("kili"), word("nena"), word("pona"),
      ],
      gaps: [CS, CE + CS, CE + " ", ""],
    };
    expect(
      mergeBlock(prev, next, "sp").spans
    ).toEqual([
      cart(0, 0),
      cart(1, 1, { attrs: { latinSpelling: "Xena" } }),
    ]);
  });

  it("deleting the FIRST of two attred " +
     "cartouches leaves the survivor with ITS " +
     "OWN attrs", () => {
    const prev = block({
      anchors: [word("nena"), word("kili")],
      gaps: [gap(), gap(" "), gap()],
      spans: [
        cart(0, 0, { attrs: { latinSpelling: "Aaa" } }),
        cart(1, 1, { attrs: { latinSpelling: "Bbb" } }),
      ],
    });
    // the user deleted the FIRST pair's markers;
    // the second pair renumbers to ordinal 0
    const next: ParsedSide = {
      anchors: [word("nena"), word("kili")],
      gaps: ["", " " + CS, CE],
    };
    expect(
      mergeBlock(prev, next, "sp").spans
    ).toEqual([
      cart(1, 1, { attrs: { latinSpelling: "Bbb" } }),
    ]);
  });

  it("REGRESSION GUARD: an ordinary single-" +
     "cartouche SP edit still carries attrs " +
     "(validation must not veto a real carry)", () => {
    const prev = block({
      anchors: [word("nena")],
      gaps: [gap(), gap()],
      spans: [
        cart(0, 0, { attrs: { latinSpelling: "Ne" } }),
      ],
    });
    // word retyped inside the same cartouche: a
    // replacement pair, so the anchor mapping is
    // what keeps the attrs attached
    const next: ParsedSide = {
      anchors: [word("kili")],
      gaps: [CS, CE],
    };
    expect(
      mergeBlock(prev, next, "sp").spans
    ).toEqual([
      cart(0, 0, { attrs: { latinSpelling: "Ne" } }),
    ]);
  });

  it("formatting spans carry via the anchor " +
     "mapping: interior deletion shrinks, " +
     "endpoint deletion snaps inward, full " +
     "deletion kills", () => {
    const prev = block({
      anchors: [
        word("toki"), word("pona"), word("mute"),
      ],
      gaps: [
        gap(), gap(" ", " "), gap(" ", " "),
        gap(),
      ],
      spans: [
        span("bold", 0, 2),
      ],
    });
    const delMiddle: ParsedSide = {
      anchors: [word("toki"), word("mute")],
      gaps: ["", " ", ""],
    };
    expect(
      mergeBlock(prev, delMiddle, "latin").spans
    ).toEqual([
      span("bold", 0, 1),
    ]);
    const delFirst: ParsedSide = {
      anchors: [word("pona"), word("mute")],
      gaps: ["", " ", ""],
    };
    expect(
      mergeBlock(prev, delFirst, "latin").spans
    ).toEqual([
      span("bold", 0, 1),
    ]);
    expect(
      mergeBlock(
        prev,
        { anchors: [], gaps: [""] },
        "latin"
      ).spans
    ).toEqual([]);
  });

  it("Latin edits cannot destroy a cartouche " +
     "except by deleting all covered anchors", () => {
    const prev = block({
      anchors: [word("nena"), word("kili")],
      gaps: [gap(), gap(), gap()],
      spans: [
        cart(0, 1),
      ],
    });
    expect(latinNoOp(prev)).toEqual(prev);
    expect(
      mergeBlock(
        prev,
        { anchors: [], gaps: [""] },
        "latin"
      ).spans
    ).toEqual([]);
  });
});

describe("mergeBlock — joiner cleanup", () => {
  it("drops a joiner dangling after a Latin " +
     "deletion", () => {
    const prev = block({
      anchors: [word("toki"), word("pona")],
      gaps: [gap(), gap(STACK, ""), gap()],
    });
    const next: ParsedSide = {
      anchors: [word("toki")],
      gaps: ["", ""],
    };
    expect(
      mergeBlock(prev, next, "latin")
    ).toEqual(
      block({
        anchors: [word("toki")],
        gaps: [gap(), gap()],
      })
    );
  });

  it("keeps a joiner whose new neighbors are " +
     "both anchors", () => {
    const prev = block({
      anchors: [
        word("toki"), word("pona"), word("mute"),
      ],
      gaps: [
        gap(), gap(STACK, ""), gap("", " "),
        gap(),
      ],
    });
    // Latin deletes mute: toki(-stack-)pona stays
    const next: ParsedSide = {
      anchors: [word("toki"), word("pona")],
      gaps: ["", "", ""],
    };
    expect(
      mergeBlock(prev, next, "latin").gaps[1]
    ).toEqual(gap(STACK, ""));
  });

  it("SP-side merges pass dangling joiners " +
     "through untouched", () => {
    const prev = block({
      anchors: [word("toki")],
      gaps: [gap(), gap(STACK)],
    });
    const next: ParsedSide = {
      anchors: [word("toki")],
      gaps: ["", STACK],
    };
    expect(
      mergeBlock(prev, next, "sp").gaps[1]
    ).toEqual(gap(STACK));
  });
});

describe("mergeBlock — LCS ceiling (ported " +
         "shapes)", () => {
  const filler = (
    n: number,
    tag: string
  ): Anchor[] =>
    Array.from({ length: n }, (_, i) =>
      word(tag + i)
    );
  const gapsFor = (count: number) => [
    gap(),
    ...Array.from({ length: count - 1 }, () =>
      gap(" ", " ")
    ),
    gap(),
  ];

  it("below the ceiling: a moved anchor is " +
     "MATCHED and its owned latin travels", () => {
    const prev = block({
      anchors: [
        word("toki"), ...filler(2, "a"),
        word("kili"), word("pona"),
      ],
      gaps: [
        gap(), gap(" ", " "), gap(" ", " "),
        gap(" ", " "), gap(" ", ","), gap(),
      ],
    });
    const next: ParsedSide = {
      anchors: [
        word("toki"), word("kili"),
        ...filler(2, "b"), word("pona"),
      ],
      gaps: ["", " ", " ", " ", " ", ""],
    };
    const out = mergeBlock(prev, next, "sp");
    expect(out.anchors).toEqual(next.anchors);
    // kili is out index 1; its owned gap is
    // gaps[2] and carries the ","
    expect(out.gaps[2].latin).toBe(",");
  });

  it("above the ceiling: positional pairing, " +
     "nothing lost (equal middles)", () => {
    const n = 1500;
    const prev = block({
      anchors: [
        word("toki"), ...filler(n, "a"),
        word("kili"), word("pona"),
      ],
      gaps: [
        ...gapsFor(n + 3).slice(0, n + 2),
        gap(" ", ","), gap(),
      ],
    });
    const next: ParsedSide = {
      anchors: [
        word("toki"), word("kili"),
        ...filler(n, "b"), word("pona"),
      ],
      gaps: [
        "",
        ...Array.from({ length: n + 2 }, () =>
          " "
        ),
        "",
      ],
    };
    const out = mergeBlock(prev, next, "sp");
    expect(out.anchors).toEqual(next.anchors);
    const commas = out.gaps.filter(
      (g) => g.latin === ","
    );
    expect(commas).toHaveLength(1);
    // this model improves on the app's existing
    // degraded mode here: even with the LCS middle
    // unmatched,
    // RE-ABSORPTION finds prev kili's exact
    // rendered glyph at next's kili anchor and
    // re-anchors it, so the comma travels WITH
    // kili (owned gap of out anchor 1) instead of
    // landing on a positional slot at the end.
    expect(out.gaps[2].latin).toBe(",");
  });

  it("above the ceiling, UNEQUAL middles: " +
     "surplus prev anchors lose their owned " +
     "latin", () => {
    const prevLen = 2000;
    const nextLen = 1001;
    const prev = block({
      anchors: filler(prevLen, "p"),
      gaps: [
        gap(),
        ...Array.from(
          { length: prevLen },
          (_, i) => gap(" ", "x" + i)
        ),
      ],
    });
    const next: ParsedSide = {
      anchors: filler(nextLen, "n"),
      gaps: [
        "",
        ...Array.from(
          { length: nextLen },
          () => " "
        ),
      ],
    };
    const out = mergeBlock(prev, next, "sp");
    expect(out.anchors).toHaveLength(nextLen);
    const latins = out.gaps.map((g) => g.latin);
    expect(latins).toContain("x1000");
    expect(latins).not.toContain("x1999");
  });

  // absorbInto's SP-edits-only gate is normally
  // carried by pairedAnchor: rendered-text alignment
  // MATCHES a markedness flip, and the matched path
  // re-derives `matched` from key equality so the SP
  // parse wins. Above the ceiling there are no
  // middle pairs at all, so the flip arrives at
  // re-absorption unmatched — this is the ONLY
  // regime where absorbInto's gate is still
  // reachable, and without it the flip is silently
  // reverted.
  it("above the ceiling: the SP-edits-only gate " +
     "still holds — an SP-side markedness flip in " +
     "an unmatched middle is not re-anchored away", () => {
    const half = 707;
    const len = half * 2 + 1;
    // the gate only lives past the DP ceiling; if
    // either the sizes or LCS_CELL_LIMIT move, this
    // test must fail loudly rather than quietly
    // testing the matched path instead
    expect(len * len).toBeGreaterThan(2_000_000);
    const prev = block({
      anchors: [
        ...filler(half, "p"),
        vb("hello"),
        ...filler(half, "q"),
      ],
      gaps: gapsFor(len),
    });
    const next: ParsedSide = {
      anchors: [
        ...filler(half, "n"),
        vb("hello", true),
        ...filler(half, "m"),
      ],
      gaps: Array.from({ length: len + 1 }, () =>
        " "
      ),
    };
    const out = mergeBlock(prev, next, "sp");
    expect(out.anchors).toHaveLength(len);
    // prev's fillers share no characters with
    // next's, so "hello" has exactly one occurrence
    // in the region and the decline is unambiguous
    const hellos = out.anchors.filter(
      (a) => a.kind === "verbatim"
    );
    expect(hellos).toEqual([
      { kind: "verbatim", text: "hello",
        marked: true },
    ]);
  });
});

describe("library pins", () => {
  it("outer-wins: evidentially ambiguous " +
     "same-range attr reclaim goes to the OUTER " +
     "span", () => {
    // doubled same-range cartouches ("[[toki]]"
    // shape), both carrying attrs; the SP edit
    // deletes one marker pair, leaving ONE parsed
    // pair at the same range. structuralTriples'
    // array-order tie rule makes the earlier span
    // the outer (depth 0); pass 1 claims its attrs
    // for the surviving pair; the inner span's
    // attrs die with its demoted markers.
    const prev: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [
        cart(0, 0, { attrs: { latinSpelling: "Sewi" } }),
        cart(0, 0, { attrs: { latinSpelling: "Insa" } }),
      ],
    };
    // the post-edit doc renders a SINGLE pair
    const singlePair: Block = {
      anchors: [{ kind: "word", word: "toki" }],
      gaps: [
        { sp: "", latin: "" },
        { sp: "", latin: "" },
      ],
      spans: [
        cart(0, 0),
      ],
    };
    const next = parseSp(
      renderSp(singlePair).inlines
    );
    const out = mergeBlock(prev, next, "sp");
    expect(out.spans).toEqual([
      cart(0, 0, { attrs: { latinSpelling: "Sewi" } }),
    ]);
  });

  it("free-floating joiner survives a Latin no-op " +
     "(the SP no-op still passes it through)", () => {
    const b: Block = {
      anchors: [
        { kind: "word", word: "toki" },
        { kind: "word", word: "pona" },
      ],
      gaps: [
        { sp: "", latin: "" },
        { sp: " " + STACK + " ", latin: " " },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const spRt = mergeBlock(
      b,
      parseSp(renderSp(b).inlines),
      "sp"
    );
    expect(spRt.gaps[1].sp).toBe(
      " " + STACK + " "
    );
    const latinRt = mergeBlock(
      b,
      parseLatin(renderLatin(b).inlines),
      "latin"
    );
    // A Latin no-op carries every flank
    // contiguously, so no gap is disturbed and
    // cleanupJoiners does not run over this gap —
    // the joiner survives and the anchor-conservation
    // law (a no-op merge never fuses or deletes
    // anchors) holds over the shape.
    expect(latinRt.gaps[1].sp).toBe(
      " " + STACK + " "
    );
  });

  it("free-floating joiner survives a Latin no-op: " +
     "the whole block comes back unchanged, not " +
     "just gaps[1].sp", () => {
    const b = block({
      anchors: [word("toki"), word("pona")],
      gaps: [
        gap(),
        gap(" " + STACK + " ", " "),
        gap(),
      ],
    });
    expect(latinNoOp(b)).toEqual(b);
  });
});

describe("joiner cleanup — offset remap", () => {
  it("joiner deletion REMAPS a marker offset in the " +
     "same gap (shift left, never clamp into " +
     "foreign content)", () => {
    // span end marker sits AFTER a free joiner that
    // the deletion of "pona" leaves dangling; the
    // joiner is cut, the offset follows its char
    // boundary left by the joiner's length.
    const prev = block({
      anchors: [word("toki"), word("pona")],
      gaps: [
        gap(),
        gap(" ", " "),
        gap(STACK + "  ", ""),
      ],
      spans: [
        cart(0, 1, { endOffset: STACK.length + 1 }),
      ],
    });
    const next: ParsedSide = {
      anchors: [word("toki"), word("pona")],
      gaps: ["", " ", ""],
    };
    // no-op on anchors; but make the trailing gap
    // DISTURBED by deleting nothing — a true no-op
    // leaves it undisturbed, so instead delete pona:
    const nextDel: ParsedSide = {
      anchors: [word("toki")],
      gaps: ["", ""],
    };
    const out = mergeBlock(prev, nextDel, "latin");
    // pona died -> span contracts to toki..toki; its
    // endOffset indexed prev gaps[2] which no longer
    // carries into the output end gap -> dropped
    // (anchor-adjacent default), NOT clamped.
    expect(out.spans).toEqual([
      cart(0, 0),
    ]);
    // and the undisturbed variant keeps the offset
    const noop = mergeBlock(prev, next, "latin");
    expect(noop.spans[0].endOffset).toBe(
      STACK.length + 1
    );
  });

  // gaps[1].sp is "   ", NOT " ": with a 1-char
  // surviving gap the assertion passed for the WRONG
  // reason — clampSpanOffsets'
  // edge rule dropped startOffset 1 as == sp.length,
  // so removing the ownership-carry rule left the
  // suite green. Widened, the two outcomes differ:
  // with the rule the offset is dropped, without it
  // it survives as startOffset 1 pointing into a
  // FOREIGN surviving gap.
  it("ownership-carry remap: startOffset whose owning " +
     "gap died snaps to the anchor-adjacent default " +
     "(absent), never into the surviving gap", () => {
    const prev = block({
      anchors: [
        word("toki"), word("mute"), word("pona"),
      ],
      gaps: [
        gap(),
        gap("   ", " "),
        gap("  ", " "),
        gap(),
      ],
      spans: [
        cart(2, 2, { startOffset: 1 }),
      ],
    });
    // Latin deletes "mute": the gap the startOffset
    // indexed (prev gaps[2], owned by mute) dies.
    const next: ParsedSide = {
      anchors: [word("toki"), word("pona")],
      gaps: ["", " ", ""],
    };
    const out = mergeBlock(prev, next, "latin");
    expect(out.spans).toEqual([
      cart(1, 1),
    ]);
  });

  // The CUT remap inside cleanupJoiners had no
  // discriminating coverage — in the test above the
  // ownership-carry drop fires
  // first, so the cut remap never runs. This shape
  // separates them: the offset's owning prev gap
  // SURVIVES the merge (it is owned by "mute", which
  // lives), so the carry rule keeps the offset, and
  // the very same gap is DISTURBED (pona died to its
  // right), so the joiner in it is cut underneath the
  // offset. Without the cut remap the stale offset
  // (STACK.length + 1 = 3) clamps to sp.length of the
  // rewritten "  " and the marker is dropped
  // entirely.
  it("cut remap: an offset in a SURVIVING gap follows " +
     "the joiner cleanup's deletion, instead of " +
     "clamping away", () => {
    const prev = block({
      anchors: [
        word("toki"), word("mute"),
        word("pona"), word("sina"),
      ],
      gaps: [
        gap(),
        gap(" ", " "),
        gap(STACK + "  ", " "),
        gap(" ", " "),
        gap(),
      ],
      spans: [
        cart(2, 3, { startOffset: STACK.length + 1 }),
      ],
    });
    // Latin deletes "pona": prev gaps[2] (mute's own)
    // carries into out gaps[2], but its right flank
    // is no longer contiguous -> disturbed -> the now
    // free-floating STACK is cut from the front.
    const next: ParsedSide = {
      anchors: [
        word("toki"), word("mute"), word("sina"),
      ],
      gaps: ["", " ", " ", ""],
    };
    const out = mergeBlock(prev, next, "latin");
    expect(out.gaps[2]).toEqual(gap("  ", " "));
    expect(out.spans).toEqual([
      cart(2, 2, { startOffset: 1 }),
    ]);
  });
});

// LCS OCCURRENCE-AWARE SECONDARY KEYING.
// The rendered-text alignment key (see mergeBlock's
// ALIGNMENT KEY note) is right about WHICH TEXT the
// edited side is evidence about, but it cannot tell two
// anchors that render the SAME text apart. When the two
// sides hold DIFFERENT COUNTS of such a text — the Latin
// parse returns a punctuation-only anchor to gap.latin,
// or a cartouche atomizes one occurrence away — the LCS
// pairs prev's FIRST occurrence with next's, and prev's
// other occurrence is stranded in a region whose next
// side holds no matching text at all. Re-absorption gets
// an empty haystack, the anchor dies, and its SP bytes
// die with it — on a NO-OP.
describe("occurrence-aware secondary keying", () => {
  // this is what the user TYPED in the SP pane —
  // "-", ideographic space, then a cartouche holding
  // "-" and the toki glyph.
  const REPEATED_DASH_SP =
    "-　" + CS + "-" + glyph("toki") + CE;
  const repeatedDashBlock = (): Block =>
    mergeBlock(
      block({}),
      parseSp([
        { type: "text", text: REPEATED_DASH_SP, verbatim: false },
      ]),
      "sp"
    );

  it("the minimal repro: three anchors, two of them " +
     "rendering '-', survive a Latin NO-OP with " +
     "their SP bytes", () => {
    const prev = repeatedDashBlock();
    // the shape: the cartouche ATOMIZES (non-empty
    // projected name), so the Latin pane shows the
    // FIRST "-" as gap text and the second only inside
    // the atom — one "-" on the next side, two on prev.
    expect(prev.anchors).toEqual([
      vb("-"), vb("-"), word("toki"),
    ]);
    expect(renderLatin(prev).text).toBe("- T");
    // a no-op is identity, bytes and all
    const out = latinNoOp(prev);
    expect(out).toEqual(prev);
    expect(renderSp(out).text).toBe(REPEATED_DASH_SP);
  });

  it("...and through a position-dependent Latin " +
     "INSERT (typing at the end of the pane)", () => {
    const prev = repeatedDashBlock();
    // the same block, one "x" typed after the atom.
    // Pre-fix this destroyed the cartouche's "-" (and
    // its SP bytes) exactly as the no-op did.
    const next = parseLatin([
      ...renderLatin(prev).inlines,
      { type: "text", text: "x" },
    ]);
    const out = mergeBlock(prev, next, "latin");
    expect(out.anchors.length).toBe(4);
    expect(
      out.anchors.slice(0, 3)
    ).toEqual(prev.anchors);
    // every SP byte the user typed is still there,
    // with the new "x" after it
    expect(renderSp(out).text).toBe(REPEATED_DASH_SP + "x");
  });

  it("CONSERVATION GATE: the refined alignment is " +
     "REFUSED when it would strand an anchor the " +
     "primary keys kept", () => {
    // Found live by the edit corpus against an
    // UNGATED version of this fix. Two "ni" anchors
    // render alike and next holds one, so the
    // secondary key is built — but here NEITHER prev
    // "ni" has a flank-agreeing partner, so the
    // refined keys pair nothing, and the region that
    // results cannot reclaim the UNRELATED "314"
    // verbatim: the next side re-tokenized it into
    // gap text that no single occurrence covers.
    // Ungated, "314" and its SP bytes were destroyed.
    // Gated, the primary pairing wins on survivor
    // count and every anchor lives.
    //
    // FIXTURE NOTE: this was originally "3.14" — a
    // digit-dot-digit run that has an INTERIOR PUNCT
    // char and so binds WHOLE, welding onto the
    // immediately following "ni" with no separating
    // space ("...3.14ni" has no gap between them) and
    // erasing the second "ni" occurrence this pin
    // depends on to exercise the secondary-key
    // conflict at all. A dot-free digit run has no
    // interior PUNCT and so still dissolves to
    // invisible per-digit gap bytes, same as before —
    // the shape this pin needs.
    const prev = block({
      anchors: [
        { kind: "word", word: "ni", niDirection: 1 },
        vb("314", true),
        { kind: "word", word: "ni", niDirection: 1 },
      ],
      gaps: [
        gap("", ". "),
        gap("\u{F1991}", " "),
        gap(),
        gap("\u{F1990}"),
      ],
    });
    // the user typed over the head of the pane:
    // ". ni 314ni" -> "ani 314ni"
    const next = parseLatin([
      { type: "text", text: "ani 314ni" },
    ]);
    const out = mergeBlock(prev, next, "latin");
    expect(out.anchors).toHaveLength(3);
    expect(out.anchors[1]).toEqual(vb("314", true));
    expect(renderSp(out).text).toBe(
      "ani\u{F1991}314\u{F1941}\u{2190}\u{F1990}"
    );
  });

  it("CONSERVATION GATE is SET INCLUSION, not a " +
     "count: an alignment that carries MORE anchors " +
     "but DROPS one the primary carried is REFUSED",
     () => {
    // Distilled from the edit corpus: the refined
    // alignment carries prev {0,1,2} where the
    // primary carries {0,3} — more
    // anchors, but prev 3 and the gap it OWNS
    // (gaps[4].sp) would die. Bytes ride on gap
    // ownership, not on anchor count, so "more anchors"
    // is not "more content"; under set inclusion the
    // primary pairing simply stands. (In the corpus the
    // twin anchors were a document-level merge's split
    // sentinels; spelled here as an ordinary verbatim
    // text that appears in NEITHER next gap, which is
    // the shape that matters
    // — two anchors rendering alike, prev holding one
    // more of them than next does, and no occurrence of
    // that text for re-absorption to reclaim.)
    const twin = "@@";
    const prev = block({
      anchors: [
        vb("?!", true),
        vb(twin, true),
        vb("-", true),
        vb(twin, true),
      ],
      gaps: [
        gap("\u3000", " - "),
        gap(STACK + CS, ". "),
        gap("\n", "; "),
        gap(),
        gap(CE + "\u3000", "; "),
      ],
      spans: [
        cart(2, 2),
        span("bold", 0, 0),
      ],
    });
    const next: ParsedSide = {
      anchors: [vb(twin, true)],
      gaps: [" - ?!. ", "; -; "],
    };
    const out = mergeBlockDetailed(
      prev,
      next,
      "latin"
    );
    // the PRIMARY alignment, kept: prev 0 and prev 3
    expect(out.prevIndexOf).toEqual([0, 3]);
    // prev 3's owned gap survives with it
    expect(
      out.block.gaps.map((g) => g.sp)
    ).toEqual([
      "\u3000",
      STACK + CS,
      CE + "\u3000",
    ]);
    // under a COUNT gate this is [0, 1, 2]: three
    // anchors, and prev 3's gap bytes gone
  });

  it("TIE RULE: when both alignments carry the SAME " +
     "prev set, the PRIMARY pairing stands — `>`, " +
     "not `>=`", () => {
    // Distilled from the corpus tie hunt (50 such
    // cases per 12 000 runs). Both alignments carry
    // prev {0,1}; they differ in WHICH duplicate pairs
    // with the surviving next "Toki", and that decides
    // gap OWNERSHIP — so a `>=` would silently
    // relocate SP gap content between the anchors.
    const prev = block({
      anchors: [
        {
          kind: "word",
          word: "toki",
          variation: 3,
          case: "capital",
        },
        {
          kind: "word",
          word: "toki",
          variation: 3,
          case: "capital",
        },
      ],
      gaps: [
        gap(CE + "\n", "ni ; "),
        gap(" ", "; "),
        gap("\n", "  "),
      ],
      spans: [
        span("bold", 0, 1),
      ],
    });
    const next: ParsedSide = {
      anchors: [
        word("ni"),
        {
          kind: "word",
          word: "toki",
          case: "capital",
        },
        word("pona"),
      ],
      gaps: ["", " ; ", ";", "  "],
    };
    const out = mergeBlockDetailed(
      prev,
      next,
      "latin"
    );
    expect(out.prevIndexOf).toEqual([0, 1, undefined]);
    // ownership: prev gap " " stays behind prev 0 and
    // "\n" behind prev 1. Under `>=` these two swap.
    expect(
      out.block.gaps.map((g) => g.sp)
    ).toEqual([CE + "\n", " ", "\n", ""]);
  });

  it("LATIN-ONLY scoping: an SP merge takes the " +
     "PRIMARY pairing even where the tie-breaker " +
     "would have fired", () => {
    // The SP arm was excluded because its two flanks
    // are not comparable strings: prev's gap.sp is
    // marker-FREE (structural markers live in spans)
    // while parseSp's gaps still carry the raw marker
    // characters, so the same anchor's flanks differ
    // by construction — SP adoptions typically have
    // marker-bearing flanks that would make this
    // tie-breaker fire on unrelated grounds.
    //
    // Fixture: shrunk from the edit corpus to the
    // smallest shape whose OUTCOME depends on the
    // scoping; the twin anchors were a document-level
    // merge's split sentinels there and are spelled
    // "@@" here. With the SP side re-included the merge
    // adopts the refined alignment and returns
    // prevIndexOf [0,1,2,3,4,5] with a trailing
    // gap.latin "  ".
    const twin = "@@";
    const prev = block({
      anchors: [
        {
          kind: "word",
          word: "mi",
          variation: 1,
          case: "capital",
        },
        { kind: "word", word: "li", variation: 1 },
        {
          kind: "word",
          word: "li",
          variation: 1,
          case: "capital",
        },
        { kind: "word", word: "mi", variation: 3 },
        {
          kind: "word",
          word: "nena",
          variation: 2,
          case: "capital",
        },
        {
          kind: "word",
          word: "nena",
          variation: 2,
          case: "capital",
        },
      ],
      gaps: [
        gap(" ", ", "),
        gap("  ", " - "),
        gap("\u200D", " "),
        gap("\n", ""),
        gap("\n", " - \u0301ax "),
        gap("  ", "  "),
        gap("\n", "  "),
      ],
    });
    const next: ParsedSide = {
      anchors: [
        { kind: "word", word: "mi", variation: 1 },
        word("toki"),
        vb(twin, true),
        { kind: "word", word: "pona", variation: 2 },
        { kind: "word", word: "nena", variation: 2 },
        vb(twin, true),
      ],
      gaps: [" ", " ", "", "", "  ", "", ""],
    };
    const out = mergeBlockDetailed(prev, next, "sp");
    expect(out.prevIndexOf).toEqual([
      0, 1, 2, 3, 5, undefined,
    ]);
    expect(
      out.block.gaps[6].latin
    ).toBe("");
  });

  // ACCEPTED LIMITATION — identical-word VICTIM
  // SELECTION: deleting a non-last duplicate retires
  // the WRONG occurrence and one gap.sp byte dies
  // with it; only observable when the duplicates
  // differ, which is what the variation tracers are
  // for. This shape is unaffected by the secondary
  // keying (both alignments carry two of the three,
  // so the gate is a tie) — it is not the `>`-vs-`>=`
  // discriminator; that pin is the one above.
  it("deleting the FIRST of three identical word " +
     "anchors retires the THIRD, and gaps[3].sp " +
     "\"c\" dies with it", () => {
    const prev = block({
      anchors: [
        { kind: "word", word: "toki", variation: 1 },
        { kind: "word", word: "toki", variation: 2 },
        { kind: "word", word: "toki", variation: 3 },
      ],
      gaps: [
        gap(),
        gap("a", " "),
        gap("b", " "),
        gap("c"),
      ],
    });
    const next = parseLatin([
      { type: "text", text: "toki toki" },
    ]);
    const out = mergeBlock(prev, next, "latin");
    // the SECOND and THIRD should have survived a
    // delete of the first; instead the third retires
    expect(out.anchors).toEqual([
      { kind: "word", word: "toki", variation: 1 },
      { kind: "word", word: "toki", variation: 2 },
    ]);
    // ...and "c", the third anchor's owned gap.sp, is
    // the byte that dies. Everything else survives.
    expect(out.gaps.map((g) => g.sp)).toEqual([
      "",
      "a",
      "b",
    ]);
    expect(
      renderSp(out).text.includes("c")
    ).toBe(false);
  });

  // INERTNESS pin, honestly labelled: this shape is
  // unchanged by the fix and is unchanged even by an
  // always-on secondary key (the region's
  // re-absorption rebuilds the same alignment when no
  // text collides). It is a regression lock on the
  // ordinary path, NOT a discriminator for the
  // narrowing — an always-on trigger (refine EVERY
  // key) is what breaks the narrowing's other pins
  // elsewhere in this suite and in edit-corpus.
  it("ordinary alignment is untouched where the " +
     "rendered texts do not collide: a Latin word " +
     "swap still carries its neighbours' ownership " +
     "across differing flanking gaps", () => {
    // toki/pona/mute all render differently, so no
    // secondary key is ever built here.
    const prev = block({
      anchors: [
        word("toki"), word("pona"), word("mute"),
      ],
      gaps: [gap(), gap(" ", " "), gap(" ", " "),
             gap()],
      spans: [],
    });
    const next: ParsedSide = {
      anchors: [
        word("toki"), word("sina"), word("mute"),
      ],
      gaps: ["", "  ", "   ", ""],
    };
    const out = mergeBlock(prev, next, "latin");
    expect(out.anchors).toEqual([
      word("toki"), word("sina"), word("mute"),
    ]);
    // ownership: the SP gaps follow the prev anchors
    // they were matched to, unchanged
    expect(out.gaps.map((g) => g.sp)).toEqual([
      "", " ", " ", "",
    ]);
  });
});
