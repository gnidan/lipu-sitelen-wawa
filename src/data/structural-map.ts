/**
 * Shared ASCII <-> UCSUR control character mappings
 * for sitelen pona structural operators.
 */

import {
  SCALING_JOINER,
  STACKING_JOINER,
  START_OF_LONG_GLYPH,
  END_OF_LONG_GLYPH,
  START_OF_REVERSE_LONG_GLYPH,
  END_OF_REVERSE_LONG_GLYPH,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
} from "./control-chars";

const ASCII_TO_UCSUR: Record<string, number> = {
  "+": SCALING_JOINER,
  "-": STACKING_JOINER,
  "[": START_OF_CARTOUCHE,
  "]": END_OF_CARTOUCHE,
  "(": START_OF_LONG_GLYPH,
  ")": END_OF_LONG_GLYPH,
  "{": START_OF_REVERSE_LONG_GLYPH,
  "}": END_OF_REVERSE_LONG_GLYPH,
  "=": CARTOUCHE_EXTENSION,
  "_": CARTOUCHE_EXTENSION,
};

const UCSUR_TO_ASCII: Record<number, string> = {
  [SCALING_JOINER]: "+",
  [STACKING_JOINER]: "-",
  [START_OF_CARTOUCHE]: "[",
  [END_OF_CARTOUCHE]: "]",
  [START_OF_LONG_GLYPH]: "(",
  [END_OF_LONG_GLYPH]: ")",
  [START_OF_REVERSE_LONG_GLYPH]: "{",
  [END_OF_REVERSE_LONG_GLYPH]: "}",
  [CARTOUCHE_EXTENSION]: "=",
};

const VS_START = 0xFE00;
const VS_END = 0xFE0F;

/**
 * Convert an ASCII structural char to a UCSUR
 * control character string.
 */
export function asciiToUcsurControl(
  ch: string
): string | undefined {
  const cp = ASCII_TO_UCSUR[ch];
  if (cp === undefined) return undefined;
  return String.fromCodePoint(cp);
}

/**
 * Convert a UCSUR control codepoint to the
 * corresponding ASCII character.
 */
export function ucsurControlToAscii(
  cp: number
): string | undefined {
  return UCSUR_TO_ASCII[cp];
}

/**
 * Check if a codepoint is a Unicode variation
 * selector (U+FE00-U+FE0F).
 */
export function isVariationSelector(
  cp: number
): boolean {
  return cp >= VS_START && cp <= VS_END;
}
