import {
  codepointToWord,
  isUcsurChar,
  isControlChar,
  VARIATION_SELECTOR_BASE,
} from "../data";

const VARIATION_SELECTOR_END = VARIATION_SELECTOR_BASE + 7;

function isVariationSelector(cp: number): boolean {
  return (
    cp >= VARIATION_SELECTOR_BASE &&
    cp <= VARIATION_SELECTOR_END
  );
}

/**
 * Convert UCSUR sitelen pona text back to Latin toki pona.
 *
 * - UCSUR chars map to their word names
 * - Variation selectors (U+FE00–FE07) are stripped
 * - Control chars (joiners, cartouche markers) are skipped
 * - All other characters pass through unchanged
 */
export function toLatin(input: string): string {
  const result: string[] = [];
  let needsSpace = false;

  for (const char of input) {
    const cp = char.codePointAt(0)!;

    if (isVariationSelector(cp)) {
      continue;
    }

    if (isControlChar(cp)) {
      continue;
    }

    if (isUcsurChar(char)) {
      const word = codepointToWord[cp];
      if (word) {
        if (needsSpace) {
          result.push(" ");
        }
        result.push(word);
        needsSpace = true;
        continue;
      }
    }

    // Non-UCSUR character: pass through as-is
    needsSpace = false;
    result.push(char);
  }

  return result.join("");
}
