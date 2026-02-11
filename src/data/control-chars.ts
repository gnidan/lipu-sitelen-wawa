/**
 * UCSUR control characters for sitelen pona layout.
 */

export const STACKING_JOINER = 0xF1995;
export const SCALING_JOINER = 0xF1996;
export const START_OF_LONG_GLYPH = 0xF1997;
export const END_OF_LONG_GLYPH = 0xF1998;
export const START_OF_REVERSE_LONG_GLYPH = 0xF199A;
export const END_OF_REVERSE_LONG_GLYPH = 0xF199B;
export const START_OF_CARTOUCHE = 0xF1990;
export const END_OF_CARTOUCHE = 0xF1991;
export const CARTOUCHE_EXTENSION = 0xF1992;

const ALL_CONTROL_CHARS = new Set([
  STACKING_JOINER,
  SCALING_JOINER,
  START_OF_LONG_GLYPH,
  END_OF_LONG_GLYPH,
  START_OF_REVERSE_LONG_GLYPH,
  END_OF_REVERSE_LONG_GLYPH,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
]);

const JOINERS = new Set([
  STACKING_JOINER,
  SCALING_JOINER,
]);

const CARTOUCHE_CHARS = new Set([
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
]);

const CONTROL_CHAR_NAMES: Record<number, string> = {
  [STACKING_JOINER]: "STACKING_JOINER",
  [SCALING_JOINER]: "SCALING_JOINER",
  [START_OF_LONG_GLYPH]: "START_OF_LONG_GLYPH",
  [END_OF_LONG_GLYPH]: "END_OF_LONG_GLYPH",
  [START_OF_REVERSE_LONG_GLYPH]:
    "START_OF_REVERSE_LONG_GLYPH",
  [END_OF_REVERSE_LONG_GLYPH]:
    "END_OF_REVERSE_LONG_GLYPH",
  [START_OF_CARTOUCHE]: "START_OF_CARTOUCHE",
  [END_OF_CARTOUCHE]: "END_OF_CARTOUCHE",
  [CARTOUCHE_EXTENSION]: "CARTOUCHE_EXTENSION",
};

export function isControlChar(cp: number): boolean {
  return ALL_CONTROL_CHARS.has(cp);
}

export function isJoiner(cp: number): boolean {
  return JOINERS.has(cp);
}

export function isCartoucheChar(cp: number): boolean {
  return CARTOUCHE_CHARS.has(cp);
}

export function controlCharToName(
  cp: number
): string | undefined {
  return CONTROL_CHAR_NAMES[cp];
}
