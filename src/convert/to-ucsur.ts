import {
  wordToCodepoint,
  codepointToChar,
  applyVariation,
} from "../data";
import { tokenize } from "./tokenize";

/**
 * Convert a single toki pona word to its UCSUR character.
 * Returns undefined if the word is not recognized.
 * Optionally applies a variation selector (1-based index).
 */
export function wordToUcsur(
  word: string,
  variation?: number
): string | undefined {
  const lower = word.toLowerCase();
  const cp = wordToCodepoint[lower];
  if (cp === undefined) {
    return undefined;
  }

  const ch = codepointToChar(cp);
  if (variation !== undefined) {
    return applyVariation(ch, variation);
  }
  return ch;
}

/**
 * Convert toki pona Latin text to UCSUR sitelen pona.
 * Recognized words become UCSUR characters; everything
 * else passes through unchanged.
 */
export function toUcsur(input: string): string {
  const tokens = tokenize(input);
  return tokens
    .map((token) => {
      if (token.type === "word" && token.word) {
        return wordToUcsur(token.word) ?? token.value;
      }
      return token.value;
    })
    .join("");
}
