/**
 * HAND-WRITTEN MUTANTS for the join-direction
 * (seam) rule. No mutation infra: each test is a
 * deliberate MISUSE of the exported pass
 * (collapseSeamRuns) standing in for a plausible
 * implementation mistake, and asserts that a pinned
 * fixture tells it apart from the real pipeline's
 * call. A mutant nothing distinguishes is a pin with
 * no discriminating power.
 */
import { describe, it, expect } from "vitest";
import {
  collapseSeamRuns,
  flattenBlocks,
} from "./doc-merge";
import type { Anchor, Block } from "./types";
import { word as W } from "../../test/helpers";
// a REAL sentinel (its text is private to
// doc-merge.ts): derive it via flattenBlocks
const SENT: Anchor = flattenBlocks([
  { anchors: [], gaps: [{ sp: "", latin: "" }],
    spans: [] },
  { anchors: [], gaps: [{ sp: "", latin: "" }],
    spans: [] },
]).anchors[0];

/** The latin-join fixture, reduced to the flat
 *  stage collapseSeamRuns sees. */
const prevFlat: Block = {
  anchors: [W("toki"), SENT, W("pona")],
  gaps: [
    { sp: "", latin: "" },
    { sp: "\n", latin: "\n" },
    { sp: "\n", latin: "" },
    { sp: "", latin: "" },
  ],
  spans: [],
};
const merged: Block = {
  anchors: [W("toki"), W("pona")],
  gaps: [
    { sp: "", latin: "" },
    { sp: "\n\n", latin: " " },
    { sp: "", latin: "" },
  ],
  spans: [],
};

describe("join-direction law power (hand " +
         "mutants)", () => {
  // the edit is LATIN here, so the carried
  // (collapsible) side of the seam gap is sp
  const real = collapseSeamRuns(
    prevFlat, merged, [0, 2], true, "latin"
  );

  it("MUTANT guard-always-false (skipping the " +
     "collapse) is caught by the seam-rule pin", () => {
    const mutant = collapseSeamRuns(
      prevFlat, merged, [0, 2], false, "latin"
    );
    expect(mutant.gaps[1].sp).not.toBe(
      real.gaps[1].sp
    );
  });

  it("MUTANT wrong-prevIndexOf (treating the " +
     "sentinel as alive) is caught", () => {
    const mutant = collapseSeamRuns(
      prevFlat, merged, [0, 1], true, "latin"
    );
    // sentinel 'alive' -> no dead seam -> no
    // collapse
    expect(mutant.gaps[1].sp).toBe("\n\n");
    expect(real.gaps[1].sp).toBe("\n");
  });

  /** a newline-free seam gap. prevFlat's dead gap
   *  contributes 1 char, so the seam junction sits at
   *  offset 0 of this gap. */
  const clean: Block = {
    ...merged,
    gaps: [
      { sp: "", latin: "" },
      { sp: " ", latin: " " },
      { sp: "", latin: "" },
    ],
  };

  // Since a Latin-side join INVENTS the missing
  // seam "\n", "none is invented" holds for the
  // SP-side direction only, so that is where this
  // mutant lives. Its latin-direction counterpart
  // is the idempotence mutant below.
  it("MUTANT inventing-a-newline on an SP-side join " +
     "is caught by the none-invented pin", () => {
    const out = collapseSeamRuns(
      prevFlat, clean, [0, 2], true, "sp"
    );
    expect(out.gaps[1].latin).toBe(" ");
    expect(out.gaps[1].sp).toBe(" ");
  });

  // ...and the seam-invention rule's own failure
  // mode in the latin direction: inventing MORE
  // than one, the shape a "just append a \n on
  // every join" reading produces. The pass must be
  // a FIXED POINT — a seam that already has its one
  // "\n" gets nothing added, which is also what
  // keeps the single-"\n" seam pins byte-identical
  // whether or not the invention fires.
  it("MUTANT double-invention (the pass run twice) " +
     "is caught by the exactly-one pin", () => {
    const once = collapseSeamRuns(
      prevFlat, clean, [0, 2], true, "latin"
    );
    // invented AT THE SEAM (offset 0), not appended
    expect(once.gaps[1].sp).toBe("\n ");
    const twice = collapseSeamRuns(
      prevFlat, once, [0, 2], true, "latin"
    );
    expect(twice.gaps[1].sp).toBe("\n ");
    // the latin side is untouched in this direction
    expect(twice.gaps[1].latin).toBe(" ");
  });

  // The mistake the flat path's SP
  // CONSERVATION law actually caught — collapsing the
  // PARSE-AUTHORITATIVE side. Expressed here as the
  // wrong `side` argument, which is exactly what a
  // both-sides collapse does to the edited half.
  it("MUTANT wrong-side (collapsing the " +
     "parse-authoritative half) is caught: it eats " +
     "a user SP byte AND leaves the carried latin " +
     "run uncollapsed", () => {
    // an SP-side join: the seam gap's sp came from
    // the user's fresh parse ("\n\n"), its latin is
    // the survivor's + the rescued dead one
    const spMerged: Block = {
      anchors: [W("toki"), W("pona")],
      gaps: [
        { sp: "", latin: "" },
        { sp: "\n\n", latin: "\n\n\n" },
        { sp: "", latin: "" },
      ],
      spans: [],
    };
    const realSp = collapseSeamRuns(
      prevFlat, spMerged, [0, 2], true, "sp"
    );
    expect(realSp.gaps[1].sp).toBe("\n\n");
    expect(realSp.gaps[1].latin).toBe("\n");
    const mutant = collapseSeamRuns(
      prevFlat, spMerged, [0, 2], true, "latin"
    );
    expect(mutant.gaps[1].sp).not.toBe(
      realSp.gaps[1].sp
    );
    expect(mutant.gaps[1].latin).not.toBe(
      realSp.gaps[1].latin
    );
  });
});
