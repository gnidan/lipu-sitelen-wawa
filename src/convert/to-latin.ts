import {
  codepointToWord,
  isUcsurChar,
  isControlChar,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  VARIATION_SELECTOR_BASE,
  ZWJ,
  isNiArrowCp,
} from "../data";

const VARIATION_SELECTOR_END =
  VARIATION_SELECTOR_BASE + 7;

function isVariationSelector(cp: number): boolean {
  return (
    cp >= VARIATION_SELECTOR_BASE &&
    cp <= VARIATION_SELECTOR_END
  );
}

/**
 * Convert UCSUR sitelen pona text back to Latin
 * toki pona.
 *
 * - UCSUR chars map to their word names
 * - Variation selectors (U+FE00-FE07) are stripped
 * - Control chars (joiners, cartouche markers, etc.)
 *   are skipped
 * - Words inside cartouches are abbreviated to
 *   their first letter, concatenated, with the
 *   first letter capitalized (e.g. [o,monsuta,o]
 *   -> "Omo")
 * - All other characters pass through unchanged
 */
export function toLatin(input: string): string {
  const result: string[] = [];
  let needsSpace = false;
  let inCartouche = false;
  let cartoucheFirst = false;
  let skipNextDirectionChars = false;

  for (const char of input) {
    const cp = char.codePointAt(0)!;

    if (isVariationSelector(cp)) {
      continue;
    }

    if (cp === ZWJ) {
      skipNextDirectionChars = true;
      continue;
    }

    if (skipNextDirectionChars) {
      if (isNiArrowCp(cp)) continue;
      skipNextDirectionChars = false;
    }

    if (cp === START_OF_CARTOUCHE) {
      inCartouche = true;
      cartoucheFirst = true;
      if (needsSpace) {
        result.push(" ");
        needsSpace = false;
      }
      continue;
    }

    if (cp === END_OF_CARTOUCHE) {
      inCartouche = false;
      needsSpace = true;
      continue;
    }

    if (isControlChar(cp)) {
      continue;
    }

    if (isUcsurChar(char)) {
      const word = codepointToWord[cp];
      if (word) {
        if (inCartouche) {
          // Abbreviate: first letter only
          const letter = word[0];
          result.push(
            cartoucheFirst
              ? letter.toUpperCase()
              : letter
          );
          cartoucheFirst = false;
        } else {
          if (needsSpace) {
            result.push(" ");
          }
          result.push(word);
          needsSpace = true;
        }
        continue;
      }
    }

    // Non-UCSUR character: pass through as-is
    needsSpace = false;
    result.push(char);
  }

  return result.join("");
}
