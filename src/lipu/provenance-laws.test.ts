import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
// A Vite `?raw` string import (typed by vite/client,
// no @types/node in this project) instead of
// node:fs + node:url: this project has neither
// @types/node nor any other node:-prefixed import,
// and happy-dom's polyfilled global URL resolves a
// relative URL against its own document location
// rather than a file: base, so `new URL("./x",
// import.meta.url)` + fileURLToPath is a dead end
// here too.
import docMergeSrc from "./doc-merge.ts?raw";
import {
  checkBlock,
  looksDefault,
  mergeLatinBlock,
  mergeSpBlock,
  mergeStructural,
  parseLatin,
  parseSp,
  renderLatin,
  renderSp,
  withMark,
} from "./index";
import {
  latinInlinesFromText,
} from "./parse-latin";
import { spInlinesFromText } from "./parse-sp";
import {
  CARTOUCHE_END,
  CARTOUCHE_START,
  COLON_CH,
  MIDDLE_DOT_CH,
  STACK,
} from "./chars";
import { parsedToBlock } from "../editor/lipu-doc";
import { gapPosition } from "./provenance";
import type { GapPosition } from "./provenance";
import type {
  Block,
  Lipu,
  ParsedSide,
  Side,
} from "./types";
import {
  conservationErrors,
  registryErrors,
} from "../../test/provenance-oracle";
import {
  arbEditLipuPlain,
} from "../../test/edit-corpus";
import {
  blockOf as block,
  gap as g,
  glyph,
  mvb as verbatim,
  word,
} from "../../test/helpers";

// ---- deterministic mark seeding (xorshift32;
// NOT fast-check's seed — the global 20260818
// stays untouched) ----
function seedMarks(lipu: Lipu, seed: number): Lipu {
  let s = seed >>> 0 || 1;
  const bit = (): boolean => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s % 4 === 0; // ~25% authored
  };
  return {
    version: 2,
    blocks: lipu.blocks.map((b) => ({
      ...b,
      gaps: b.gaps.map((gp) => {
        let out = gp;
        if (bit()) out = withMark(out, "sp", true);
        if (bit()) {
          out = withMark(out, "latin", true);
        }
        return out;
      }),
    })),
  };
}

const spSideOf = (b: Block): string =>
  renderSp(b).text;
const latinTextOf = (b: Block): string =>
  renderLatin(b)
    .inlines.map((inl) => inl.text)
    .join("");

function snapDown(text: string, pos: number): number {
  let p = Math.max(
    0,
    Math.min(pos, text.length)
  );
  while (
    p > 0 &&
    text.charCodeAt(p) >= 0xdc00 &&
    text.charCodeAt(p) <= 0xdfff
  ) {
    p -= 1;
  }
  return p;
}

const SP_INSERTS = [
  "",
  " ",
  "\n",
  MIDDLE_DOT_CH,
  COLON_CH,
  CARTOUCHE_START,
  STACK,
];
const LATIN_INSERTS = [
  "",
  " ",
  "\n",
  ". ",
  ": ",
  "! ",
  "toki",
  "'",
];

interface RandomEdit {
  side: Side;
  pos: number;
  del: number;
  ins: number;
}

const arbEdit: fc.Arbitrary<RandomEdit> = fc.record({
  side: fc.constantFrom<Side>("sp", "latin"),
  pos: fc.nat(300),
  del: fc.nat(3),
  ins: fc.nat(7),
});

/** Applies one random text edit to one block
 *  through the REAL merge entrypoints and returns
 *  everything the oracle needs. */
function applyRandomEdit(
  b: Block,
  e: RandomEdit
): {
  sides: ParsedSide[];
  out: Block[];
  side: Side;
} {
  const text =
    e.side === "sp" ? spSideOf(b) : latinTextOf(b);
  const from = snapDown(text, e.pos % (text.length + 1));
  const to = snapDown(
    text,
    Math.min(from + e.del, text.length)
  );
  const inserts =
    e.side === "sp" ? SP_INSERTS : LATIN_INSERTS;
  const next =
    text.slice(0, from) +
    inserts[e.ins % inserts.length] +
    text.slice(to);
  const parsed: ParsedSide =
    e.side === "sp"
      ? parseSp(spInlinesFromText(next))
      : parseLatin(latinInlinesFromText(next));
  const out =
    e.side === "sp"
      ? mergeSpBlock(b, parsed)
      : mergeLatinBlock(b, parsed);
  return {
    sides: [parsed],
    out: [out],
    side: e.side,
  };
}

describe("conservation law: no merge destroys " +
         "authored bytes, modulo the registry", () => {
  it("no pass ever destroys authored bytes " +
     "(property, random authored-mark seeding; " +
     "family 2 corpus shapes)", () => {
    fc.assert(
      fc.property(
        arbEditLipuPlain,
        fc.array(arbEdit, {
          minLength: 1,
          maxLength: 4,
        }),
        fc.nat(),
        (lipu, edits, seed) => {
          let cur = seedMarks(lipu as Lipu, seed);
          for (const e of edits) {
            const bi =
              e.pos % cur.blocks.length;
            const b = cur.blocks[bi];
            const { sides, out, side } =
              applyRandomEdit(b, e);
            const errs = conservationErrors(
              [b],
              sides,
              out,
              side
            );
            if (errs.length > 0) {
              throw new Error(
                errs.join("; ") +
                  " on " +
                  JSON.stringify(e)
              );
            }
            for (const ob of out) {
              const bad = checkBlock(ob);
              if (bad.length > 0) {
                throw new Error(bad.join("; "));
              }
            }
            const blocks = cur.blocks.slice();
            blocks[bi] = out[0];
            cur = { version: 2, blocks };
          }
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });

  it("structural conservation: split and join " +
     "under seeded marks", () => {
    fc.assert(
      fc.property(
        arbEditLipuPlain,
        fc.nat(),
        fc.nat(300),
        (lipu, seed, rawPos) => {
          const cur = seedMarks(
            lipu as Lipu,
            seed
          );
          // SPLIT block 0 at a random sp position
          const b = cur.blocks[0];
          const text = spSideOf(b);
          const at = snapDown(
            text,
            rawPos % (text.length + 1)
          );
          const sides = [
            parseSp(
              spInlinesFromText(
                text.slice(0, at)
              )
            ),
            parseSp(
              spInlinesFromText(text.slice(at))
            ),
            ...cur.blocks
              .slice(1)
              .map((ob) =>
                parseSp(renderSp(ob).inlines)
              ),
          ];
          const out = mergeStructural(
            cur.blocks,
            sides,
            "sp"
          );
          const errs = conservationErrors(
            cur.blocks,
            sides,
            out,
            "sp"
          );
          if (errs.length > 0) {
            throw new Error(errs.join("; "));
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("whitelist-removal mutation pin (seam-run " +
     "collapse): with stripNewlines OFF, the oracle FIRES on " +
     "the authored seam-run collapse — proving " +
     "the entry is load-bearing", () => {
    // The surviving (live-anchor-owned) gap itself
    // carries an authored "\n\n" run: collapseSeamRuns
    // (the JOIN SEAM RULE) collapses a carried-sp
    // run to at most one "\n", keeping the FIRST and
    // deleting the rest — even when every "\n" in the
    // run is authored. b1's own gaps are empty so
    // rescueJoinedGaps has nothing to append; the run
    // already lives in b0's trailing gap before the
    // join, so this isolates collapseSeamRuns' own
    // newline-deleting behavior from the separate
    // rescue-append mechanism.
    const b0 = block(
      [word("toki")],
      [
        g("", ""),
        withMark(g("\n\n", ""), "sp", true),
      ]
    );
    const b1 = block(
      [word("pona")],
      [g("", ""), g("", "")]
    );
    const sides = [
      parseLatin(
        latinInlinesFromText("toki pona")
      ),
    ];
    const out = mergeStructural(
      [b0, b1],
      sides,
      "latin"
    );
    expect(
      conservationErrors(
        [b0, b1],
        sides,
        out,
        "latin"
      )
    ).toEqual([]);
    expect(
      conservationErrors(
        [b0, b1],
        sides,
        out,
        "latin",
        { stripNewlines: false }
      ).length
    ).toBeGreaterThan(0);
  });

  it("whitelist-removal mutation pin " +
     "(cleanupJoiners): authored STACK next to a " +
     "Latin-deleted word — registry oracle quiet " +
     "with the whitelist, FIRES without it", () => {
    const b = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(g(STACK, ""), "sp", true),
        g("", ""),
      ]
    );
    const sides = [
      parseLatin(latinInlinesFromText("toki")),
    ];
    expect(
      registryErrors([b], sides, "latin")
    ).toEqual([]);
    expect(
      registryErrors([b], sides, "latin", {
        allowJoinerDeletion: false,
      }).length
    ).toBeGreaterThan(0);
  });

  // checkEditedSide's no-op on a REAL merge
  // (doc-merge.ts's added passes never rewrite the
  // edited side, and pair consumption/facet folds
  // already run inside mergeBlockDetailed, hence
  // inside passBaseline — see registryErrors' own
  // checkEditedSide pins below for THAT registry
  // coverage) does not by itself prove the check is
  // non-vacuous. A cartouche construction with
  // base === "" (the residual "\n" alone never
  // classifies authored) would let
  // isSubsequence("", anything) hold
  // unconditionally, so no output — not even total
  // destruction — could fail it. This construction
  // instead keeps a real, non-empty authored
  // edited-side byte alive through a real merge
  // (the SP edit lands on a DIFFERENT gap, several
  // anchors away), so `base` is genuinely
  // populated; the discrimination check below
  // confirms a corrupted output — not a
  // hypothetical — fires.
  it("whitelist pin (pair consumption + facet " +
     "folds act on the EDITED side): checkEditedSide " +
     "stays clean on a real merge with real " +
     "surviving authored bytes at stake, and FIRES " +
     "on a corrupted one", () => {
    const b = block(
      [word("mi"), word("toki"), word("pona")],
      [
        g("", ""),
        g(" ", " "),
        withMark(
          g(MIDDLE_DOT_CH, ""),
          "sp",
          true
        ),
        g(" ", " "),
        g("", ""),
      ]
    );
    const paneText =
      glyph("mi") + " " + glyph("toki") +
      MIDDLE_DOT_CH + glyph("pona") + " " +
      glyph("sina");
    const sides = [
      parseSp(spInlinesFromText(paneText)),
    ];
    const out = [mergeSpBlock(b, sides[0])];
    // non-vacuous: the mid-dot gap really did carry
    // an authored byte through, unchanged.
    expect(out[0].gaps[2].sp).toBe(MIDDLE_DOT_CH);
    expect(out[0].gaps[2].spAuthored).toBe(true);
    expect(
      conservationErrors([b], sides, out, "sp")
    ).toEqual([]);
    expect(
      conservationErrors([b], sides, out, "sp", {
        checkEditedSide: true,
      })
    ).toEqual([]);
    // DISCRIMINATION: a corrupted output (the same
    // gap, blanked and unmarked) is caught — proving
    // the clean result above reflects a real check,
    // not an empty-string tautology.
    const corrupted = [
      {
        ...out[0],
        gaps: out[0].gaps.map((gp, i) =>
          i === 2 ? g("", "") : gp
        ),
      },
    ];
    expect(
      conservationErrors(
        [b],
        sides,
        corrupted,
        "sp",
        { checkEditedSide: true }
      ).length
    ).toBeGreaterThan(0);
    // and checkEditedSide really is load-bearing for
    // this catch: the default (carried-side-only)
    // check stays blind to the same corruption.
    expect(
      conservationErrors([b], sides, corrupted, "sp")
    ).toEqual([]);
  });

  // Registry items 2
  // (marker-pair consumption) and 3 (parseSp facet
  // folds) had no removal pin anywhere:
  // conservationErrors cannot see them (baked into
  // passBaseline before it ever compares anything),
  // and registryErrors' DEFAULT only ever inspects
  // the CARRIED side. registryErrors' new
  // checkEditedSide knob removes that implicit
  // exemption; both pins below show the SAME
  // registered flow going quiet under the default
  // (item 2/3's actual whitelist: carried-side-only
  // inspection) and firing once that's switched off.
  it("registry item 2 (marker-pair consumption) " +
     "removal pin: quiet under the default " +
     "carried-side check, FIRES with " +
     "checkEditedSide", () => {
    const b = block(
      [word("toki")],
      [
        withMark(
          g(CARTOUCHE_START + "\n", ""),
          "sp",
          true
        ),
        g("", ""),
      ]
    );
    const paneText =
      CARTOUCHE_START + "\n" + glyph("toki") +
      CARTOUCHE_END;
    const sides = [
      parseSp(spInlinesFromText(paneText)),
    ];
    expect(
      registryErrors([b], sides, "sp")
    ).toEqual([]);
    expect(
      registryErrors([b], sides, "sp", {
        checkEditedSide: true,
      }).length
    ).toBeGreaterThan(0);
  });

  it("registry item 3 (parseSp facet folds) " +
     "removal pin: quiet under the default " +
     "carried-side check, FIRES with " +
     "checkEditedSide", () => {
    const b = block(
      [word("nena")],
      [
        withMark(
          g(CARTOUCHE_START, ""),
          "sp",
          true
        ),
        withMark(
          g(MIDDLE_DOT_CH, ""),
          "sp",
          true
        ),
        g("", ""),
      ]
    );
    // a mid-dot inside a cartouche folds onto the
    // preceding word's nameScheme (morae), consuming
    // the literal dot out of gap text (parse-sp.ts
    // "naming chars and cartouche depth").
    const paneText =
      CARTOUCHE_START + glyph("nena") +
      MIDDLE_DOT_CH + CARTOUCHE_END;
    const sides = [
      parseSp(spInlinesFromText(paneText)),
    ];
    expect(
      sides[0].anchors[0].nameScheme
    ).toEqual({ style: "morae", count: 1 });
    expect(
      registryErrors([b], sides, "sp")
    ).toEqual([]);
    expect(
      registryErrors([b], sides, "sp", {
        checkEditedSide: true,
      }).length
    ).toBeGreaterThan(0);
  });
});

describe("blind-spot check: " +
         "generateSpFromLatin's generated \"\\n\" " +
         "into a DEFAULT sp side is PRINCIPLED, " +
         "not a hole — its own source-level guard " +
         "protects any authored sp byte, so the " +
         "oracle's silence never masks damage", () => {
  it("an authored sp gap elsewhere in the block " +
     "survives byte-exact while the sentence rule " +
     "fires next to it", () => {
    const prev = block(
      [word("mi"), word("toki"), word("pona")],
      [
        withMark(g("xq", ""), "sp", true),
        g(" ", " "),
        g(" ", " "),
        g("", ""),
      ]
    );
    const sides = parseLatin(
      latinInlinesFromText("mi toki. pona")
    );
    const out = mergeLatinBlock(prev, sides);
    // generation actually fired (not a vacuous
    // probe): the default gap gained "\n"
    expect(out.gaps[2].sp).toBe("\n");
    expect(out.gaps[2].spAuthored).toBeUndefined();
    // the distant authored gap is untouched
    expect(out.gaps[0].sp).toBe("xq");
    expect(out.gaps[0].spAuthored).toBe(true);
    expect(
      conservationErrors(
        [prev],
        [sides],
        [out],
        "latin"
      )
    ).toEqual([]);
  });

  it("generateSpFromLatin's own guard skips an " +
     "already-authored trigger-site gap: the " +
     "authored byte survives even though the " +
     "sentence-end shape is present", () => {
    const prev = block(
      [word("mi"), word("toki"), word("pona")],
      [
        g("", ""),
        g(" ", " "),
        withMark(
          g(MIDDLE_DOT_CH, ""),
          "sp",
          true
        ),
        g("", ""),
      ]
    );
    const sides = parseLatin(
      latinInlinesFromText("mi toki. pona")
    );
    const out = mergeLatinBlock(prev, sides);
    // the guard refused to overwrite: still the
    // authored middle dot, not a generated "\n"
    expect(out.gaps[2].sp).toBe(MIDDLE_DOT_CH);
    expect(out.gaps[2].spAuthored).toBe(true);
    expect(
      conservationErrors(
        [prev],
        [sides],
        [out],
        "latin"
      )
    ).toEqual([]);
  });
});

describe("classification stability law", () => {
  it("the recognizer accepts every creator's byte " +
     "image (generative: run the creators, feed " +
     "the recognizer)", () => {
    // each image
    // carries the SIDE and POSITION its own creator
    // actually wrote, and the check below asserts
    // looksDefault EXACTLY on that (side, position)
    // pair — not an OR across both sides with
    // "interior" hardcoded. looksDefault itself
    // ignores side/position today (a future
    // narrowing's reserved slot, per its own
    // docstring), so this tightening changes nothing
    // that currently passes; it exists so a later
    // side/position-aware narrowing gets exercised
    // against the RIGHT call the first time it
    // lands, instead of being silently satisfied by
    // the wrong disjunct.
    const images: {
      side: Side;
      position: GapPosition;
      text: string;
    }[] = [];
    // Enter companion (latin "\n" append)
    const plain = block(
      [word("toki"), word("pona")],
      [g("", ""), g(" ", " "), g("", "")]
    );
    const entered = mergeSpBlock(
      plain,
      parseSp(
        spInlinesFromText(
          glyph("toki") + "\n" + glyph("pona")
        )
      )
    );
    images.push({
      side: "latin",
      position: gapPosition(
        1,
        entered.gaps.length
      ),
      text: entered.gaps[1].latin, // " \n"
    });
    // latin-join seam invention (sp " \n")
    const j0 = block(
      [word("toki")],
      [g("", ""), g(" ", "")]
    );
    const j1 = block(
      [word("pona")],
      [g("", ""), g("", "")]
    );
    const joined = mergeStructural(
      [j0, j1],
      [
        parseLatin(
          latinInlinesFromText("toki pona")
        ),
      ],
      "latin"
    );
    images.push({
      side: "sp",
      position: gapPosition(
        1,
        joined[0].gaps.length
      ),
      text: joined[0].gaps[1].sp, // " \n"
    });
    // merge creation defaults (fresh word insert)
    const inserted = mergeSpBlock(
      plain,
      parseSp(
        spInlinesFromText(
          glyph("toki") + " " + glyph("pona") +
            glyph("mi")
        )
      )
    );
    images.push(
      {
        side: "latin",
        position: gapPosition(
          2,
          inserted.gaps.length
        ),
        text: inserted.gaps[2].latin, // " " (interior)
      },
      {
        side: "latin",
        position: gapPosition(
          3,
          inserted.gaps.length
        ),
        text: inserted.gaps[3].latin, // "" (final)
      }
    );
    // the separation default's " "
    const p10 = mergeLatinBlock(
      plain,
      parseLatin(
        latinInlinesFromText("toki pona")
      )
    );
    p10.gaps.forEach((gp, gi) => {
      images.push({
        side: "latin",
        position: gapPosition(gi, p10.gaps.length),
        text: gp.latin,
      });
    });
    // parsedToBlock's companion mint (the editor
    // bridge's load-boundary chain): each "\n" in a
    // loaded sp side gets a matching latin "\n".
    const loaded = parsedToBlock({
      anchors: [word("toki"), word("pona")],
      gaps: ["", "\n", ""],
    });
    // non-vacuous: the companion mint really fired
    // (not e.g. silently skipped, which would leave
    // "" and trivially satisfy looksDefault anyway)
    expect(loaded.gaps[1].latin).toBe("\n");
    images.push({
      side: "latin",
      position: gapPosition(1, loaded.gaps.length),
      text: loaded.gaps[1].latin, // "\n"
    });
    // applyMarkedVerbatimSpDefault's " ": a fresh
    // degenerate adjacency between two marked
    // verbatims minted by the SAME latin merge gets
    // a separating sp " " (else renderSp coalesces
    // them into one inline run).
    const verbatimPrev = block(
      [verbatim("xq"), word("mi"), verbatim("ax")],
      [g("", ""), g("", " "), g("", " "), g("", "")]
    );
    const verbatimOut = mergeLatinBlock(
      verbatimPrev,
      {
        anchors: [verbatim("xq"), verbatim("ax")],
        gaps: ["", "", ""],
      }
    );
    // non-vacuous: the marked-verbatim default
    // really fired
    expect(verbatimOut.gaps[1].sp).toBe(" ");
    images.push({
      side: "sp",
      position: gapPosition(
        1,
        verbatimOut.gaps.length
      ),
      text: verbatimOut.gaps[1].sp, // " "
    });
    for (const img of images) {
      expect(
        looksDefault(img.side, img.text, img.position)
      ).toBe(true);
    }
    // and the creators STAMPED default: none of
    // these outputs carries a mark on the side the
    // creator wrote
    expect(
      entered.gaps[1].latinAuthored
    ).toBeUndefined();
    expect(
      joined[0].gaps[1].spAuthored
    ).toBeUndefined();
    expect(
      loaded.gaps[1].latinAuthored
    ).toBeUndefined();
    expect(
      verbatimOut.gaps[1].spAuthored
    ).toBeUndefined();
  });
});

describe("no ping-pong / one-pass fixpoint " +
         "law", () => {
  const NOOP_ROUNDS = 3;
  function settle(b: Block): Block[] {
    const states: Block[] = [b];
    let cur = b;
    for (let i = 0; i < NOOP_ROUNDS; i++) {
      cur = mergeSpBlock(
        cur,
        parseSp(renderSp(cur).inlines)
      );
      cur = mergeLatinBlock(
        cur,
        parseLatin(renderLatin(cur).inlines)
      );
      states.push(cur);
    }
    return states;
  }

  it("generation reaches a byte-stable fixpoint " +
     "within one alternating no-op round, for " +
     "every generation flow", () => {
    const plain = () =>
      block(
        [word("toki"), word("pona")],
        [g("", ""), g(" ", " "), g("", "")]
      );
    const flows: Block[] = [
      mergeLatinBlock(
        plain(),
        parseLatin(
          latinInlinesFromText("toki. pona")
        )
      ),
      mergeLatinBlock(
        plain(),
        parseLatin(
          latinInlinesFromText("toki: pona")
        )
      ),
      mergeSpBlock(
        plain(),
        parseSp(
          spInlinesFromText(
            glyph("toki") + MIDDLE_DOT_CH +
              glyph("pona")
          )
        )
      ),
    ];
    for (const state of flows) {
      const states = settle(state);
      const bytes = (b: Block): string =>
        JSON.stringify(b.gaps);
      expect(bytes(states[2])).toBe(
        bytes(states[1])
      );
      expect(bytes(states[3])).toBe(
        bytes(states[2])
      );
    }
  });
});

// doc-merge.ts-LOCAL
// hygiene only: a new top-level function, arrow
// const, or function-expression const declared in
// THIS file fails the roster below until it's
// classified. It is NOT the mechanism that catches
// an unknown default-writer in general — that's the
// job of the conservation property above, which
// quantifies over every REAL merge byte regardless
// of which file or function produced it. This sweep
// cannot see: writes added inside an EXISTING
// function's body, declarations in any other file
// (merge.ts, parse-sp.ts, and the editor layers
// host default creators too), or
// any declaration shape this regex set doesn't name.
const DECL_PATTERNS = [
  /^(?:export )?(?:async )?function (\w+)/gm,
  /^(?:export )?const (\w+) = (?:async )?\(/gm,
  /^(?:export )?const (\w+) = (?:async )?function/gm,
];

describe("closed-list sweep (doc-merge.ts-" +
         "local; see the conservation property " +
         "for the cross-file guard)", () => {
  it("doc-merge.ts's top-level function/const-" +
     "function roster is pinned: a new top-level " +
     "declaration of one of the covered shapes " +
     "fails here until it is classified in the " +
     "roster below", () => {
    const names = DECL_PATTERNS.flatMap((re) =>
      [...docMergeSrc.matchAll(re)].map((m) => m[1])
    ).sort();
    expect(names).toEqual(
      [
        "anchorLatinText",
        "applyContextRederivation",
        "applyDerivedTransliteration",
        "applyEnterDefaults",
        "applyMarkedVerbatimSpDefault",
        "applySeparationDefaults",
        "applySeparationDefaultsLipu",
        "capLatinNewlines",
        // the shared carry-rule helper: pure index
        // arithmetic factored out of the five
        // passes that each restated it; not a
        // default-writing site.
        "carriedPrevGap",
        "collapseNl",
        "collapseSeamRuns",
        "containsMappable",
        "countNl",
        "demoteStraddlers",
        "dropKindChangedSpans",
        "flattenBlocks",
        "flattenParsed",
        "fusesLeft",
        "fusesRight",
        "generateSpFromLatin",
        "inCartoucheContext",
        // spacing-position predicate; not a
        // default-writing site.
        "isInteriorForSpacing",
        "isDerivedGap",
        "isSentinel",
        "mergeLatinBlock",
        "mergeSpBlock",
        "mergeStructural",
        "normalizeLetterishLatin",
        "normalizeLetterishLatinLipu",
        "rechunk",
        // shared offset-remap plumbing factored out
        // of the passes that delete gap.sp bytes
        // (seam collapse, colon withdrawal, context
        // re-derivation); they rewrite span offsets
        // only, never gap bytes or marks.
        "remapGapOffsets",
        "remapThroughCuts",
        "removeTrailingNewlines",
        // the fusion byte-rescue (containment
        // signature): a default-writing site,
        // sibling in duty to rescueJoinedGaps.
        "rescueFusedGaps",
        "rescueJoinedGaps",
        "revalidateSpanOffsets",
        "routeSplitGaps",
        // the shared per-side pass chains: pure
        // compositions of already-classified passes
        // (one chain per edit side, shared by the
        // per-block and flat structural paths so
        // the two cannot drift); no writes of their
        // own.
        "runLatinPasses",
        "runSpPasses",
        "sentinelAnchor",
        // the shared colon-glyph deletion walk
        // factored out of the two colon-withdrawal
        // sites; the callers own the write and the
        // classification, this returns bytes+cuts.
        "stripColonGlyphs",
        "transliterateSp",
        "unfoldMintedScheme",
        // derivation-vouching predicate; not a
        // default-writing site.
        "vouchesForDerivation",
        // the consumed-trigger break withdrawal:
        // a default-writing site (stamps the
        // position-rule " "/"" separator), sibling
        // in duty to generateSpFromLatin.
        "withdrawConsumedBreaks",
      ].sort()
    );
  });

  // DISCRIMINATION: the broadened pattern set
  // really does cover the shapes a plain `function`
  // regex misses (mutation-verified: arrow consts,
  // function expressions, `export async function`
  // all went undetected before). Probed against
  // synthetic source text —
  // not the real file — so this cannot itself flip
  // the roster pin above; it only proves the sweep's
  // OWN matching logic, not the roster itself.
  it("the broadened decl-shape patterns catch an " +
     "arrow const, a function-expression const, " +
     "and an export async function — the shapes " +
     "the plain `function` regex missed " +
     "(mutation-verified)", () => {
    const probe = [
      "const arrowSite = (g) => g;",
      "const exprSite = function (g) { return g; };",
      "export async function asyncSite() {}",
    ].join("\n");
    const names = DECL_PATTERNS.flatMap((re) =>
      [...probe.matchAll(re)].map((m) => m[1])
    ).sort();
    expect(names).toEqual([
      "arrowSite",
      "asyncSite",
      "exprSite",
    ]);
  });
});
