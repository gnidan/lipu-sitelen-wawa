/**
 * Glyph variation data for sitelen pona characters.
 *
 * Uses Unicode Variation Selectors (U+FE00–U+FE07) to select
 * alternate glyph forms, as defined by nasin nanpa v4.0.2.
 */

export interface VariationInfo {
  selector: number;
  index: number;
  description: string;
}

export const VARIATION_SELECTOR_BASE = 0xFE00;

/**
 * Convert a human-readable index (1–8) to the corresponding
 * Unicode variation selector codepoint.
 */
export function variationIndexToSelector(
  index: number
): number {
  if (index < 1 || index > 8) {
    throw new RangeError(
      `Variation index must be 1–8, got ${index}`
    );
  }
  return VARIATION_SELECTOR_BASE + (index - 1);
}

function v(
  index: number,
  description: string
): VariationInfo {
  return {
    selector: VARIATION_SELECTOR_BASE + (index - 1),
    index,
    description,
  };
}

/**
 * Map of words to their available glyph variations.
 * 17 words have alternate forms in nasin nanpa v4.0.2.
 */
export const glyphVariations: Record<
  string,
  VariationInfo[]
> = {
  "jaki": [
    v(1, "splatter variant 1"),
    v(2, "splatter variant 2"),
    v(3, "splatter variant 3"),
    v(4, "splatter variant 4"),
    v(5, "splatter variant 5"),
    v(6, "splatter variant 6"),
    v(7, "splatter variant 7"),
    v(8, "splatter variant 8"),
  ],
  "ko": [
    v(1, "blob variant 1"),
    v(2, "blob variant 2"),
    v(3, "blob variant 3"),
    v(4, "blob variant 4"),
    v(5, "blob variant 5"),
    v(6, "blob variant 6"),
    v(7, "blob variant 7"),
    v(8, "blob variant 8"),
  ],
  "ni": [
    v(1, "left arrow"),
    v(2, "up arrow"),
    v(3, "right arrow"),
    v(4, "down arrow"),
    v(5, "upper-left arrow"),
    v(6, "upper-right arrow"),
    v(7, "lower-right arrow"),
    v(8, "lower-left arrow"),
  ],
  "akesi": [
    v(1, "six-legged variant"),
  ],
  "kala": [
    v(1, "variant with eyes"),
  ],
  "kiwen": [
    v(1, "alternate crystal shape"),
  ],
  "leko": [
    v(1, "alternate block shape"),
  ],
  "pipi": [
    v(1, "alternate insect shape"),
  ],
  "monsuta": [
    v(1, "alternate monster shape"),
  ],
  "waso": [
    v(1, "alternate bird shape"),
  ],
  "meli": [
    v(1, "circle with cross below"),
  ],
  "mije": [
    v(1, "circle with arrow"),
  ],
  "tonsi": [
    v(1, "alternate gender-neutral symbol"),
  ],
  "sike": [
    v(1, "alternate circle shape"),
  ],
  "sewi": [
    v(1, "secular form"),
  ],
  "kokosila": [
    v(1, "alternate speech symbol"),
  ],
  "lanpan": [
    v(1, "upside-down pana"),
  ],
};

/**
 * Append the appropriate variation selector to a UCSUR
 * character string. The index is 1-based (1–8).
 */
export function applyVariation(
  ucsurChar: string,
  index: number
): string {
  const selector = variationIndexToSelector(index);
  return ucsurChar + String.fromCodePoint(selector);
}
