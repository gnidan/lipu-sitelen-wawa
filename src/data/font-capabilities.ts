/**
 * Font capability abstraction.
 *
 * Centralizes font-specific knowledge so the rest
 * of the codebase queries capabilities rather than
 * checking hardcoded tables. This makes it possible
 * to swap fonts without changing call sites.
 *
 * This module owns all codepoint override logic:
 * it imports raw maps from sub-modules, applies
 * the font's codepoint remapping, and exports the
 * effective versions that the rest of the codebase
 * should use.
 */

import type { VariationInfo } from "./variations";
import { glyphVariations } from "./variations";
import type { NiDirection } from "./ni-directions";
import {
  NI_DIRECTIONS,
  niDirectionByCp,
} from "./ni-directions";
import {
  wordToCodepoint as rawWordToCodepoint,
} from "./ucsur";
import {
  asciiToUcsurControl as rawAsciiToUcsurControl,
  isVariationSelector,
} from "./structural-map";
import {
  STACKING_JOINER,
  SCALING_JOINER,
  START_OF_LONG_GLYPH,
  END_OF_LONG_GLYPH,
  START_OF_REVERSE_LONG_GLYPH,
  END_OF_REVERSE_LONG_GLYPH,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
  MIDDLE_DOT,
  COLON,
  COMBINING_TALLY_MARK,
  IDEOGRAPHIC_SPACE,
  ZWJ,
} from "./control-chars";
import {
  words as rawWords,
} from "./words";
import type { WordEntry, WordCategory } from "./words";

export { isVariationSelector };

export interface ExtraWordEntry {
  codepoint: number;
  category: WordCategory;
  definition: string;
}

export interface FontCapabilities {
  /** Words that have glyph variations (with VS) */
  variations: Record<string, VariationInfo[]>;
  /** Words that have a long glyph form */
  longGlyphWords: Set<string>;
  /** Whether the font supports ZWJ joining */
  supportsZwj: boolean;
  /** ni directions the font supports */
  niDirections: NiDirection[];
  /**
   * Standard CP → font CP (single remap) or
   * standard CP → font CP[] (multi-char expansion).
   */
  codepointOverrides:
    Record<number, number | number[]>;
  /**
   * Font-specific words not in the standard
   * baseline (e.g. pake, apeja, kokosila for
   * nasin-nanpa).
   */
  extraWords: Record<string, ExtraWordEntry>;
}

/**
 * Current font capabilities (nasin nanpa v4.0.2).
 */
export const currentFont: FontCapabilities = {
  variations: glyphVariations,
  longGlyphWords: new Set([
    "a",
    "alasa",
    "anu",
    "awen",
    "kama",
    "ken",
    "kepeken",
    "la",
    "lon",
    "nanpa",
    "open",
    "pi",
    "pini",
    "sona",
    "tawa",
    "wile",
    "n",
  ]),
  supportsZwj: true,
  niDirections: NI_DIRECTIONS,
  codepointOverrides: {
    0x300C: 0xF199E,              // te
    0x300D: 0xF199F,              // to
    0xF199E: 0x2C,                // tally mark
    0xF1989: [0xF1941, 0x2190],   // ni-left
    0xF198A: [0xF1941, 0x2191],   // ni-up
    0xF198B: [0xF1941, 0x2192],   // ni-right
  },
  extraWords: {
    pake: {
      codepoint: 0xF19A0,
      category: "sandbox",
      definition:
        "to stop, to block, to prevent",
    },
    apeja: {
      codepoint: 0xF19A1,
      category: "sandbox",
      definition:
        "shame, guilt, stigma, disgrace",
    },
    kokosila: {
      codepoint: 0xF1984,
      category: "uncommon",
      definition:
        "to speak a non-toki-pona language",
    },
  },
};

// ── Codepoint override helpers ──────────────────

/**
 * Map a codepoint via overrides, returning a single
 * codepoint. For multi-char expansions, returns the
 * first codepoint (used for building word→cp maps).
 */
function mapCodepointSingle(cp: number): number {
  const override =
    currentFont.codepointOverrides[cp];
  if (override === undefined) return cp;
  if (Array.isArray(override)) return override[0];
  return override;
}

/**
 * Map a codepoint via overrides, returning the full
 * string. For multi-char expansions, returns the
 * complete multi-character string.
 */
function mapCodepointToString(
  cp: number
): string {
  const override =
    currentFont.codepointOverrides[cp];
  if (override === undefined) {
    return String.fromCodePoint(cp);
  }
  if (Array.isArray(override)) {
    return override
      .map((c) => String.fromCodePoint(c))
      .join("");
  }
  return String.fromCodePoint(override);
}

// ── Effective word maps ─────────────────────────

const _wordToCp: Record<string, number> = {};
for (const [word, cp] of
  Object.entries(rawWordToCodepoint)) {
  _wordToCp[word] = mapCodepointSingle(cp);
}
// Merge in extraWords
for (const [word, entry] of
  Object.entries(currentFont.extraWords)) {
  _wordToCp[word] = entry.codepoint;
}

export const wordToCodepoint:
  Record<string, number> = _wordToCp;

// First entry per codepoint wins, so canonical
// forms are preferred over synonyms.
const _cpToWord: Record<number, string> = {};
for (const [word, cp] of
  Object.entries(wordToCodepoint)) {
  if (!(cp in _cpToWord)) _cpToWord[cp] = word;
}
// Map standard ni direction CPs → "ni" so that
// toLatin and toVerbatim can recognize documents
// using standard encoding.
for (const dir of NI_DIRECTIONS) {
  if (
    dir.codepoint !== undefined &&
    !(dir.codepoint in _cpToWord)
  ) {
    _cpToWord[dir.codepoint] = "ni";
  }
}
export const codepointToWord:
  Record<number, string> = _cpToWord;

// ── Effective words record ──────────────────────

const _words: Record<string, WordEntry> = {};
for (const [key, entry] of
  Object.entries(rawWords)) {
  _words[key] = {
    ...entry,
    codepoint: mapCodepointSingle(entry.codepoint),
  };
}
// Merge in extraWords
for (const [word, extra] of
  Object.entries(currentFont.extraWords)) {
  _words[word] = {
    word,
    codepoint: extra.codepoint,
    category: extra.category,
    definition: extra.definition,
  };
}

export const words: Record<string, WordEntry> =
  _words;

// ── Effective word query functions ──────────────

export function isWord(s: string): boolean {
  return s in words;
}

export function getWord(
  s: string
): WordEntry | undefined {
  return words[s];
}

const CATEGORY_RANK: Record<WordCategory, number> =
  {
    core: 0,
    common: 1,
    uncommon: 2,
    obscure: 3,
    sandbox: 4,
  };

export function wordsByCategory(
  cat: WordCategory
): WordEntry[] {
  return Object.values(words).filter(
    (entry) => entry.category === cat
  );
}

export function wordsByPrefix(
  prefix: string
): WordEntry[] {
  const lower = prefix.toLowerCase();
  if (lower.length === 0) return [];

  const matches = Object.values(words).filter(
    (entry) => entry.word.startsWith(lower)
  );

  matches.sort((a, b) => {
    const aExact = a.word === lower ? 0 : 1;
    const bExact = b.word === lower ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;

    const aCat = CATEGORY_RANK[a.category];
    const bCat = CATEGORY_RANK[b.category];
    if (aCat !== bCat) return aCat - bCat;

    return a.word.localeCompare(b.word);
  });

  return matches;
}

const FIRST_LETTER_MAP: Record<string, string> =
  {};
for (const entry of Object.values(words)) {
  const letter = entry.word[0];
  if (
    !(letter in FIRST_LETTER_MAP) ||
    entry.word < FIRST_LETTER_MAP[letter]
  ) {
    FIRST_LETTER_MAP[letter] = entry.word;
  }
}

export function wordByFirstLetter(
  letter: string
): string | undefined {
  return FIRST_LETTER_MAP[letter.toLowerCase()];
}

// ── Effective conversion functions ──────────────

const UCSUR_RANGE_START = 0xF1900;
const UCSUR_RANGE_END = 0xF19FF;

/**
 * Non-UCSUR codepoints that map to toki pona words
 * after overrides are applied.
 */
const SPECIAL_WORD_CPS = new Set(
  Object.values(wordToCodepoint).filter(
    (cp) => cp < UCSUR_RANGE_START ||
      cp > UCSUR_RANGE_END
  )
);

export function codepointToChar(
  cp: number
): string {
  return String.fromCodePoint(cp);
}

export function charToCodepoint(
  char: string
): number | undefined {
  const cp = char.codePointAt(0);
  if (cp === undefined) return undefined;
  if (
    cp >= UCSUR_RANGE_START &&
    cp <= UCSUR_RANGE_END
  ) {
    return cp;
  }
  if (SPECIAL_WORD_CPS.has(cp)) return cp;
  return undefined;
}

export function isUcsurChar(
  char: string
): boolean {
  const cp = char.codePointAt(0);
  if (cp === undefined) return false;
  if (
    cp >= UCSUR_RANGE_START &&
    cp <= UCSUR_RANGE_END
  ) {
    return true;
  }
  if (SPECIAL_WORD_CPS.has(cp)) return true;
  return false;
}

// ── Effective ni direction string ───────────────

/**
 * Build the effective string for a directional ni
 * variant, respecting font overrides.
 *
 * For directions with a standard UCSUR codepoint,
 * applies the font's override (which may be a
 * multi-char expansion). For diagonals without
 * standard CPs, falls back to the effective ni
 * codepoint + arrow character.
 */
export function niDirStringEffective(
  dir: NiDirection
): string {
  if (dir.codepoint !== undefined) {
    return mapCodepointToString(dir.codepoint);
  }
  // Diagonals: ni CP (effective) + arrow
  const niCp = wordToCodepoint["ni"];
  return (
    String.fromCodePoint(niCp) + dir.arrow
  );
}

// ── Effective control char mappings ─────────────

const STRUCTURAL_ASCII = [
  "+", "-", "[", "]", "(", ")", "{", "}",
  "=", "_", ".", ":", ",", "|", "&",
  "<", "^", ">",
];

const effectiveUcsurToAscii:
  Record<number, string> = {};
for (const ch of STRUCTURAL_ASCII) {
  const rawStr = rawAsciiToUcsurControl(ch);
  if (rawStr !== undefined) {
    const rawCp = rawStr.codePointAt(0)!;
    const effectiveCp =
      mapCodepointSingle(rawCp);
    if (
      !(effectiveCp in effectiveUcsurToAscii)
    ) {
      effectiveUcsurToAscii[effectiveCp] = ch;
    }
  }
}

export function asciiToUcsurControl(
  ch: string
): string | undefined {
  const rawStr = rawAsciiToUcsurControl(ch);
  if (rawStr === undefined) return undefined;
  const rawCp = rawStr.codePointAt(0)!;
  return String.fromCodePoint(
    mapCodepointSingle(rawCp)
  );
}

export function ucsurControlToAscii(
  cp: number
): string | undefined {
  return effectiveUcsurToAscii[cp];
}

// ── Other font capability queries ───────────────

export function hasVariations(
  word: string
): boolean {
  return word in currentFont.variations;
}

export function getVariations(
  word: string
): VariationInfo[] {
  return currentFont.variations[word] ?? [];
}

export function isLongGlyphWord(
  word: string
): boolean {
  return currentFont.longGlyphWords.has(word);
}

// ── Effective control char predicates ─────────
//
// Raw control char sets in control-chars.ts use
// raw UCSUR codepoints, but callers pass effective
// (post-override) codepoints. Build effective sets
// by mapping each raw control char through the
// font's codepoint overrides.

const RAW_CONTROL_CPS = [
  STACKING_JOINER, SCALING_JOINER,
  START_OF_LONG_GLYPH, END_OF_LONG_GLYPH,
  START_OF_REVERSE_LONG_GLYPH,
  END_OF_REVERSE_LONG_GLYPH,
  START_OF_CARTOUCHE, END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
  MIDDLE_DOT, COLON, COMBINING_TALLY_MARK,
  IDEOGRAPHIC_SPACE, ZWJ,
];

const effectiveControlChars = new Set(
  RAW_CONTROL_CPS.map(mapCodepointSingle)
);

const effectiveJoiners = new Set(
  [STACKING_JOINER, SCALING_JOINER, ZWJ]
    .map(mapCodepointSingle)
);

const effectiveCartoucheChars = new Set(
  [
    START_OF_CARTOUCHE, END_OF_CARTOUCHE,
    CARTOUCHE_EXTENSION,
  ].map(mapCodepointSingle)
);

export function isControlChar(
  cp: number
): boolean {
  return effectiveControlChars.has(cp);
}

export function isJoiner(
  cp: number
): boolean {
  return effectiveJoiners.has(cp);
}

export function isCartoucheChar(
  cp: number
): boolean {
  return effectiveCartoucheChars.has(cp);
}
