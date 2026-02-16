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
import { NI_DIRECTIONS } from "./ni-directions";
import {
  wordToCodepoint as rawWordToCodepoint,
} from "./ucsur";
import {
  asciiToUcsurControl as rawAsciiToUcsurControl,
  isVariationSelector,
} from "./structural-map";
import {
  words as rawWords,
} from "./words";
import type { WordEntry } from "./words";

export { isVariationSelector };

export interface FontCapabilities {
  /** Words that have glyph variations (with VS) */
  variations: Record<string, VariationInfo[]>;
  /** Words that have a long glyph form */
  longGlyphWords: Set<string>;
  /** Whether the font supports ZWJ joining */
  supportsZwj: boolean;
  /** ni directions the font supports */
  niDirections: NiDirection[];
  /** Standard CP → font CP. Applied to all maps. */
  codepointOverrides: Record<number, number>;
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
    0x300C: 0xF199E,   // te
    0x300D: 0xF199F,   // to
    0xF1989: 0xF19A0,  // pake
    0xF198A: 0xF19A1,  // apeja
    0xF198B: 0xF19A2,  // majuna
    0xF198C: 0xF19A4,  // linluwi
    0xF199E: 0x2C,     // tally mark → ","
  },
};

// ── Codepoint override helper ───────────────────

function mapCodepoint(cp: number): number {
  return currentFont.codepointOverrides[cp] ?? cp;
}

// ── Effective word maps ─────────────────────────

export const wordToCodepoint:
  Record<string, number> = Object.fromEntries(
    Object.entries(rawWordToCodepoint).map(
      ([word, cp]) => [word, mapCodepoint(cp)]
    )
  );

export const codepointToWord:
  Record<number, string> = Object.fromEntries(
    Object.entries(wordToCodepoint).map(
      ([word, cp]) => [cp, word]
    )
  );

// ── Effective words record ──────────────────────

export const words: Record<string, WordEntry> =
  Object.fromEntries(
    Object.entries(rawWords).map(
      ([key, entry]) => [
        key,
        {
          ...entry,
          codepoint: mapCodepoint(entry.codepoint),
        },
      ]
    )
  );

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
    const effectiveCp = mapCodepoint(rawCp);
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
    mapCodepoint(rawCp)
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
