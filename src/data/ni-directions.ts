/**
 * ZWJ-based directional encoding for the "ni"
 * glyph in nasin-nanpa. The font renders
 * ni + ZWJ + Unicode arrow as arrow variants.
 *
 * Verbatim format uses ASCII shortcuts:
 *   ni&< ni&^ ni&> ni&v ni&^< ni&^> ni&>v ni&<v
 *
 * UCSUR encoding uses Unicode arrows:
 *   ni + ZWJ + ← ↑ → ↓ ↖ ↗ ↘ ↙
 */

import { ZWJ } from "./control-chars";
export { ZWJ };

export interface NiDirection {
  index: number;
  /** ASCII shortcut for verbatim: "<", "^>", etc */
  verbatim: string;
  /** Unicode arrow codepoint used after ZWJ */
  arrowCp: number;
  /** Unicode arrow character */
  arrow: string;
  description: string;
}

export const NI_DIRECTIONS: NiDirection[] = [
  {
    index: 1,
    verbatim: "<",
    arrowCp: 0x2190,
    arrow: "\u2190",
    description: "left arrow",
  },
  {
    index: 2,
    verbatim: "^",
    arrowCp: 0x2191,
    arrow: "\u2191",
    description: "up arrow",
  },
  {
    index: 3,
    verbatim: ">",
    arrowCp: 0x2192,
    arrow: "\u2192",
    description: "right arrow",
  },
  {
    index: 4,
    verbatim: "v",
    arrowCp: 0x2193,
    arrow: "\u2193",
    description: "down arrow",
  },
  {
    index: 5,
    verbatim: "^<",
    arrowCp: 0x2196,
    arrow: "\u2196",
    description: "upper-left arrow",
  },
  {
    index: 6,
    verbatim: "^>",
    arrowCp: 0x2197,
    arrow: "\u2197",
    description: "upper-right arrow",
  },
  {
    index: 7,
    verbatim: ">v",
    arrowCp: 0x2198,
    arrow: "\u2198",
    description: "lower-right arrow",
  },
  {
    index: 8,
    verbatim: "<v",
    arrowCp: 0x2199,
    arrow: "\u2199",
    description: "lower-left arrow",
  },
];

/** Set of Unicode arrow codepoints used after ZWJ */
const ARROW_CPS = new Set(
  NI_DIRECTIONS.map((d) => d.arrowCp)
);

export function isNiArrowCp(cp: number): boolean {
  return ARROW_CPS.has(cp);
}

/** Lookup: verbatim string -> NiDirection */
const BY_VERBATIM = new Map(
  NI_DIRECTIONS.map((d) => [d.verbatim, d])
);

/** Lookup: arrow codepoint -> NiDirection */
const BY_ARROW_CP = new Map(
  NI_DIRECTIONS.map((d) => [d.arrowCp, d])
);

/** Lookup: variation index -> NiDirection */
const BY_INDEX = new Map(
  NI_DIRECTIONS.map((d) => [d.index, d])
);

export function niDirectionByVerbatim(
  v: string
): NiDirection | undefined {
  return BY_VERBATIM.get(v);
}

export function niDirectionByArrowCp(
  cp: number
): NiDirection | undefined {
  return BY_ARROW_CP.get(cp);
}

export function niDirectionByIndex(
  index: number
): NiDirection | undefined {
  return BY_INDEX.get(index);
}

/**
 * Build the UCSUR string for a ni directional
 * variant: ni codepoint + arrow character.
 * The font combines these via GSUB ligature
 * without needing ZWJ.
 */
export function niDirString(
  niCp: number,
  dir: NiDirection
): string {
  return (
    String.fromCodePoint(niCp) +
    dir.arrow
  );
}

/**
 * Try to parse verbatim direction shortcuts
 * starting at the given position in a string
 * (after "&" in verbatim text).
 * Returns the matched NiDirection and its
 * character length, or null if no match.
 */
export function parseVerbatimDirection(
  text: string,
  startIdx: number
): { dir: NiDirection; length: number } | null {
  if (startIdx >= text.length) return null;

  // Try 2-char verbatim first
  if (startIdx + 1 < text.length) {
    const two = text.substring(
      startIdx, startIdx + 2
    );
    const d = BY_VERBATIM.get(two);
    if (d) return { dir: d, length: 2 };
  }

  // Try 1-char verbatim
  const one = text[startIdx];
  const d = BY_VERBATIM.get(one);
  if (d) return { dir: d, length: 1 };

  return null;
}
