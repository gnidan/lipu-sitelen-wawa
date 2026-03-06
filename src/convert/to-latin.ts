import {
  codepointToWord,
  isUcsurChar,
  isControlChar,
  isVariationSelector,
  ucsurControlToAscii,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  IDEOGRAPHIC_SPACE,
  ZWJ,
  isNiArrowCp,
  niDirectionByCp,
} from "../data";

const VOWELS = new Set("aeiou");
const CONSONANTS = new Set("jklmnpstw");

/**
 * Split a toki pona word into morae.
 *
 * A mora is (C)V or a coda "n".
 * e.g. "tan" → ["ta", "n"]
 *      "toki" → ["to", "ki"]
 *      "a" → ["a"]
 *      "jan" → ["ja", "n"]
 */
export function splitMorae(word: string): string[] {
  const morae: string[] = [];
  let i = 0;
  while (i < word.length) {
    const ch = word[i];
    if (
      CONSONANTS.has(ch) &&
      i + 1 < word.length &&
      VOWELS.has(word[i + 1])
    ) {
      morae.push(ch + word[i + 1]);
      i += 2;
    } else if (VOWELS.has(ch)) {
      morae.push(ch);
      i += 1;
    } else if (ch === "n") {
      morae.push("n");
      i += 1;
    } else {
      i += 1;
    }
  }
  return morae;
}

/**
 * Look ahead from `start` in `chars` for cartouche
 * markers (., :, ,) and resolve how much of `word`
 * to include.
 *
 * Naming schemes:
 * - No markers: first letter (original)
 * - "." (middle dot): morae (nasin sitelen kalama)
 * - ":" (colon): whole word (nasin sitelen kalama)
 * - "," (tally mark): letters (nasin sitelen
 *   kalama pi linja lili)
 */
function resolveCartoucheWord(
  word: string,
  chars: string[],
  start: number,
  isFirst: boolean
): { text: string; advance: number } {
  let idx = start;
  let dots = 0;
  let commas = 0;
  let hasColon = false;

  while (idx < chars.length) {
    const cp = chars[idx].codePointAt(0)!;
    if (isVariationSelector(cp)) {
      idx++;
      continue;
    }
    const ascii = ucsurControlToAscii(cp);
    if (ascii === ".") {
      dots++;
      idx++;
      continue;
    }
    if (ascii === ":") {
      hasColon = true;
      idx++;
      break;
    }
    if (ascii === ",") {
      commas++;
      idx++;
      continue;
    }
    break;
  }

  let text: string;
  if (hasColon) {
    text = word;
  } else if (dots > 0) {
    const morae = splitMorae(word);
    text = morae.slice(0, dots).join("");
  } else if (commas > 0) {
    text = word.slice(0, commas);
  } else {
    text = word[0];
  }

  if (isFirst) {
    text = text[0].toUpperCase() + text.slice(1);
  }

  return { text, advance: idx - start };
}

/**
 * Convert UCSUR sitelen pona text back to Latin
 * toki pona.
 *
 * - UCSUR chars map to their word names
 * - Variation selectors (U+FE00-FE07) are stripped
 * - Control chars (joiners, cartouche markers, etc.)
 *   are skipped
 * - Ideographic space (U+3000) becomes a regular
 *   space
 * - Words inside cartouches are resolved based on
 *   the naming scheme:
 *   - No markers: first letter (original)
 *   - "." (middle dot): morae-based
 *     (nasin sitelen kalama)
 *   - ":" (colon): whole word
 *     (nasin sitelen kalama)
 *   - "," (tally mark): letter-based
 *     (nasin sitelen kalama pi linja lili)
 * - All other characters pass through unchanged
 */
export function toLatin(input: string): string {
  const result: string[] = [];
  const chars = [...input];
  let needsSpace = false;
  let inCartouche = false;
  let cartoucheFirst = false;
  let skipNextArrow = false;
  let i = 0;

  while (i < chars.length) {
    const char = chars[i];
    const cp = char.codePointAt(0)!;

    if (isVariationSelector(cp)) {
      i++;
      continue;
    }

    // Skip arrow chars that follow "ni" (or
    // legacy "ni" + ZWJ). The direction is
    // implicit in the glyph, not in Latin.
    if (skipNextArrow) {
      if (cp === ZWJ) { i++; continue; }
      if (isNiArrowCp(cp)) {
        skipNextArrow = false;
        i++;
        continue;
      }
      skipNextArrow = false;
    }

    if (cp === START_OF_CARTOUCHE) {
      inCartouche = true;
      cartoucheFirst = true;
      if (needsSpace) {
        result.push(" ");
        needsSpace = false;
      }
      i++;
      continue;
    }

    if (cp === END_OF_CARTOUCHE) {
      inCartouche = false;
      needsSpace = true;
      i++;
      continue;
    }

    if (cp === IDEOGRAPHIC_SPACE) {
      result.push(" ");
      needsSpace = false;
      i++;
      continue;
    }

    if (isControlChar(cp)) {
      i++;
      continue;
    }

    if (isUcsurChar(char)) {
      const word = codepointToWord[cp];
      if (word) {
        // Only skip the following arrow for the
        // base ni CP (F1941). Standard direction
        // CPs (F1989/F198A/F198B) are
        // self-contained.
        if (
          word === "ni" &&
          !niDirectionByCp(cp)
        ) {
          skipNextArrow = true;
        }
        if (inCartouche) {
          const { text, advance } =
            resolveCartoucheWord(
              word, chars, i + 1, cartoucheFirst
            );
          result.push(text);
          cartoucheFirst = false;
          i += 1 + advance;
        } else {
          if (needsSpace) {
            result.push(" ");
          }
          result.push(word);
          needsSpace = true;
          i++;
        }
        continue;
      }
    }

    // Non-UCSUR character: pass through as-is
    // Insert space after UCSUR word before Latin
    // letters (composing words), but not before
    // punctuation, whitespace, or other symbols.
    if (needsSpace && /[a-zA-Z]/.test(char)) {
      result.push(" ");
    }
    needsSpace = false;
    result.push(char);
    i++;
  }

  return result.join("");
}
