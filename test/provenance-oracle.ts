import {
  flattenBlocks,
  flattenParsed,
  isAuthored,
  JOINER_CHARS,
  mergeBlockDetailed,
  reattachProvenance,
} from "../src/lipu";
import type {
  Block,
  ParsedSide,
  Side,
} from "../src/lipu";

export interface OracleOpts {
  /** Seam collapse + split division: newline-only
   *  deletions at seams/splits are lawful. */
  stripNewlines?: boolean; // default true
  /** parse-authority: the edited side is what the
   *  user's parse asserts — never conserved BY
   *  DEFAULT. On conservationErrors this widens the
   *  baseline-vs-final comparison to include the
   *  edited side too; it never fires on a REAL merge
   *  (doc-merge.ts's added passes are carried-side
   *  writers, with one harmless prepend exception —
   *  unfoldMintedScheme — that cannot break a
   *  subsequence check), so enabling it costs
   *  nothing. It is NOT what exempts the registry's
   *  pair-consumption / facet-fold items — see
   *  registryErrors' own checkEditedSide below for
   *  that. */
  checkEditedSide?: boolean; // default false
}

/** The pass-layer baseline: mergeBlockDetailed +
 *  reattachProvenance only (per-block when counts
 *  match — mirroring mergeStructural's fast path —
 *  else the flat stream). Everything the FROZEN
 *  layer does (cleanupJoiners, pair consumption,
 *  facet folds, anchor/gap ownership death) is
 *  BELOW this baseline, so the conservation check
 *  isolates exactly the passes this project adds. */
export function passBaseline(
  prevBlocks: Block[],
  sides: ParsedSide[],
  editedSide: Side
): Block[] {
  if (prevBlocks.length === sides.length) {
    return prevBlocks.map((b, i) => {
      const { block, prevIndexOf } =
        mergeBlockDetailed(b, sides[i], editedSide);
      return reattachProvenance(
        b,
        block,
        prevIndexOf,
        editedSide
      );
    });
  }
  const pf = flattenBlocks(prevBlocks);
  const nf = flattenParsed(sides);
  const { block, prevIndexOf } =
    mergeBlockDetailed(pf, nf, editedSide);
  return [
    reattachProvenance(
      pf,
      block,
      prevIndexOf,
      editedSide
    ),
  ];
}

function authoredConcat(
  blocks: Block[],
  side: Side
): string {
  let out = "";
  for (const b of blocks) {
    for (const g of b.gaps) {
      if (isAuthored(g, side)) {
        out += side === "sp" ? g.sp : g.latin;
      }
    }
  }
  return out;
}

function isSubsequence(
  needle: string,
  hay: string
): boolean {
  // code-point-wise: UCSUR chars are surrogate
  // PAIRS, so unit-indexed comparison would never
  // match them
  const n = [...needle];
  let i = 0;
  for (const ch of hay) {
    if (i < n.length && n[i] === ch) i += 1;
  }
  return i === n.length;
}

const stripNl = (s: string): string =>
  s.split("\n").join("");

/** A known silence, PRINCIPLED rather than a
 *  hole: generateSpFromLatin writes a generated
 *  "\n" (or a prepended COLON_CH) into the carried
 *  sp side constantly over the edit-corpus suites,
 *  and this oracle stays silent every time.
 *  authoredConcat only ever sums gaps where
 *  isAuthored(g, side) is true, and
 *  generateSpFromLatin has its own unconditional,
 *  source-level guard — `if (isAuthored(g, "sp"))
 *  return g;` — that refuses to write into a gap
 *  already marked spAuthored, regardless of whether
 *  any oracle is watching. So the write only ever
 *  lands on gaps this oracle was never obligated to
 *  protect in the first place; a real authored sp
 *  byte at or adjacent to the trigger site is
 *  provably untouched, independent of oracle
 *  coverage. provenance-laws.test.ts's "blind-spot
 *  check" group pins both directions (guard skip on
 *  an already-authored target; an authored neighbor
 *  surviving byte-exact while generation fires next
 *  to it) as a permanent regression guard, and its
 *  conservation property already fuzzes
 *  ". "/": "/"! " inserts against randomly seeded
 *  authored marks through the real merge
 *  entrypoints every run. No oracle extension
 *  needed here. */
export function conservationErrors(
  prevBlocks: Block[],
  sides: ParsedSide[],
  outBlocks: Block[],
  editedSide: Side,
  opts: {
    stripNewlines?: boolean;
    checkEditedSide?: boolean;
  } = {}
): string[] {
  const {
    stripNewlines = true,
    checkEditedSide = false,
  } = opts;
  const baseline = passBaseline(
    prevBlocks,
    sides,
    editedSide
  );
  const carried: Side =
    editedSide === "sp" ? "latin" : "sp";
  const sidesToCheck: Side[] = checkEditedSide
    ? ["sp", "latin"]
    : [carried];
  const errs: string[] = [];
  for (const side of sidesToCheck) {
    let base = authoredConcat(baseline, side);
    let fin = authoredConcat(outBlocks, side);
    if (stripNewlines) {
      base = stripNl(base);
      fin = stripNl(fin);
    }
    if (!isSubsequence(base, fin)) {
      errs.push(
        `authored ${side} bytes destroyed by a ` +
          `pass: ${JSON.stringify(base)} not in ` +
          JSON.stringify(fin)
      );
    }
  }
  return errs;
}

/** Registry items 2
 *  (marker-pair consumption, matchStructuralPairs /
 *  removePairChars) and 3 (parseSp facet folds) act
 *  ON THE EDITED SIDE, INSIDE mergeBlockDetailed —
 *  i.e. inside passBaseline itself, before this
 *  function's own prev-vs-baseline comparison ever
 *  runs. registryErrors' DEFAULT (checkEditedSide
 *  false) only ever inspects the CARRIED side, so it
 *  structurally cannot see items 2/3 — that omission
 *  IS their whitelist; there is no separate flag for
 *  it the way allowJoinerDeletion is item 1's. This
 *  knob removes that implicit exemption by comparing
 *  prev to baseline on the EDITED side instead, so a
 *  caller can prove items 2/3 are real, registrable
 *  consumptions (prev authored bytes genuinely do
 *  not survive to baseline) and not silent by
 *  accident. */
export function registryErrors(
  prevBlocks: Block[],
  sides: ParsedSide[],
  editedSide: Side,
  opts: {
    allowJoinerDeletion?: boolean;
    checkEditedSide?: boolean;
  } = {}
): string[] {
  const {
    allowJoinerDeletion = true,
    checkEditedSide = false,
  } = opts;
  const baseline = passBaseline(
    prevBlocks,
    sides,
    editedSide
  );
  const carried: Side =
    editedSide === "sp" ? "latin" : "sp";
  const side: Side = checkEditedSide
    ? editedSide
    : carried;
  let prevBytes = stripNl(
    authoredConcat(prevBlocks, side)
  );
  const baseBytes = stripNl(
    authoredConcat(baseline, side)
  );
  if (allowJoinerDeletion && side === "sp") {
    for (const j of JOINER_CHARS) {
      prevBytes = prevBytes.split(j).join("");
    }
  }
  return isSubsequence(prevBytes, baseBytes)
    ? []
    : [
        "frozen layer consumed authored " +
          `${side} bytes outside the registry`,
      ];
}
