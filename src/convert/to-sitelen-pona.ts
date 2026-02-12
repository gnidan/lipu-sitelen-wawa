import {
  wordToCodepoint,
  codepointToChar,
  wordByFirstLetter,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
} from "../data";
import { tokenize } from "./tokenize";
import type { Token } from "./tokenize";

function wordChar(word: string): string {
  const cp = wordToCodepoint[word];
  if (cp === undefined) return word;
  return codepointToChar(cp);
}

const cartStart = String.fromCodePoint(
  START_OF_CARTOUCHE
);
const cartEnd = String.fromCodePoint(
  END_OF_CARTOUCHE
);
const cartExt = String.fromCodePoint(
  CARTOUCHE_EXTENSION
);

function isCapitalized(value: string): boolean {
  return (
    value.length > 0 &&
    value[0] !== value[0].toLowerCase()
  );
}

/**
 * Try to expand a capitalized word as a cartouche
 * abbreviation: each letter maps to a toki pona
 * word starting with that letter.
 *
 * Returns an array of words, or null if any letter
 * can't be mapped.
 */
function expandCartouche(
  text: string
): string[] | null {
  const lower = text.toLowerCase();
  const words: string[] = [];
  for (const letter of lower) {
    const word = wordByFirstLetter(letter);
    if (!word) return null;
    words.push(word);
  }
  return words;
}

/**
 * Check if a token will produce UCSUR output.
 */
function willBeUcsur(token: Token): boolean {
  // Recognized tp word (any case)
  if (token.type === "word" && token.word) {
    return true;
  }
  // Capitalized unknown word that can be expanded
  // as a cartouche abbreviation
  if (
    token.type === "unknown" &&
    isCapitalized(token.value) &&
    expandCartouche(token.value) !== null
  ) {
    return true;
  }
  return false;
}

/**
 * Emit a cartouche wrapping the given words.
 */
function emitCartouche(
  words: string[],
  result: string[]
): void {
  result.push(cartStart);
  for (let k = 0; k < words.length; k++) {
    if (k > 0) result.push(cartExt);
    result.push(wordChar(words[k]));
  }
  result.push(cartEnd);
}

/**
 * Convert Latin toki pona text to UCSUR sitelen
 * pona with cartouche detection.
 *
 * - Recognized lowercase toki pona words -> UCSUR
 * - Capitalized recognized tp words -> single-word
 *   cartouche
 * - Capitalized unknown words -> try as cartouche
 *   abbreviation (each letter -> a tp word)
 * - Spaces between consecutive UCSUR tokens are
 *   stripped (the font handles spacing)
 * - Everything else -> pass through unchanged
 */
export function toSitelenPona(
  input: string
): string {
  const tokens = tokenize(input);
  const result: string[] = [];
  let prevWasUcsur = false;
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    // Whitespace: strip between UCSUR tokens
    if (token.type === "whitespace") {
      const next = tokens[i + 1];
      if (prevWasUcsur && next && willBeUcsur(next)) {
        i++;
        continue;
      }
      result.push(token.value);
      prevWasUcsur = false;
      i++;
      continue;
    }

    // Capitalized recognized tp word -> cartouche
    if (
      token.type === "word" &&
      token.word &&
      isCapitalized(token.value)
    ) {
      emitCartouche([token.word], result);
      prevWasUcsur = true;
      i++;
      continue;
    }

    // Capitalized unknown -> cartouche abbreviation
    if (
      token.type === "unknown" &&
      isCapitalized(token.value)
    ) {
      const expanded = expandCartouche(
        token.value
      );
      if (expanded) {
        emitCartouche(expanded, result);
        prevWasUcsur = true;
        i++;
        continue;
      }
    }

    // Lowercase recognized tp word -> UCSUR
    if (token.type === "word" && token.word) {
      result.push(wordChar(token.word));
      prevWasUcsur = true;
      i++;
      continue;
    }

    // Everything else: pass through
    result.push(token.value);
    prevWasUcsur = false;
    i++;
  }

  return result.join("");
}
