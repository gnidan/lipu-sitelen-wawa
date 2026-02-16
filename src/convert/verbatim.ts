import {
  wordToCodepoint,
  codepointToChar,
  codepointToWord,
  isControlChar,
  asciiToUcsurControl,
  ucsurControlToAscii,
  isVariationSelector,
  ZWJ,
  isNiArrowCp,
  niDirectionByArrowCp,
  parseVerbatimDirection,
} from "../data";

/**
 * Iterate codepoints in a string, yielding each
 * codepoint and its JS string offset.
 */
export function* codepoints(
  text: string
): Generator<[number, number]> {
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    yield [cp, i];
    i += cp > 0xffff ? 2 : 1;
  }
}

/**
 * Check if a codepoint is a word glyph (a UCSUR
 * word character or a special non-UCSUR word like
 * te/to). Excludes control characters like joiners
 * and cartouche markers.
 */
export function isWordGlyph(cp: number): boolean {
  return cp in codepointToWord;
}

/**
 * Check if a codepoint is a Latin letter
 * (a-z/A-Z).
 */
export function isLatinLetter(cp: number): boolean {
  return (
    (cp >= 0x41 && cp <= 0x5a) ||
    (cp >= 0x61 && cp <= 0x7a)
  );
}

/**
 * Convert UCSUR text to verbatim ASCII
 * representation. Word glyphs become word names,
 * control chars become ASCII equivalents (e.g. ")"
 * for END_OF_LONG_GLYPH), variation selectors are
 * stripped. ZWJ becomes "&".
 */
export function toVerbatim(text: string): string {
  const result: string[] = [];
  let needsSpace = false;
  const cps = [...codepoints(text)];

  for (let i = 0; i < cps.length; i++) {
    const [cp] = cps[i];

    if (isVariationSelector(cp)) continue;

    if (isWordGlyph(cp)) {
      const word = codepointToWord[cp];
      if (word) {
        if (needsSpace) result.push(" ");
        result.push(word);
        needsSpace = true;

        // For "ni", check for arrow (or
        // legacy ZWJ + arrow) after it
        // (output as ni<dir> shorthand)
        if (
          word === "ni" &&
          i + 1 < cps.length
        ) {
          const [nextCp] = cps[i + 1];
          // Direct arrow after ni
          const dir1 =
            niDirectionByArrowCp(nextCp);
          if (dir1) {
            result.push(dir1.verbatim);
            i += 1; // skip arrow
          } else if (
            nextCp === ZWJ &&
            i + 2 < cps.length
          ) {
            // Legacy ZWJ + arrow
            const [arrowCp] = cps[i + 2];
            const dir2 =
              niDirectionByArrowCp(arrowCp);
            if (dir2) {
              result.push(dir2.verbatim);
              i += 2; // skip ZWJ + arrow
            }
          }
        }
        continue;
      }
    }

    // Control chars (including ZWJ) → ASCII
    const ascii = ucsurControlToAscii(cp);
    if (ascii !== undefined) {
      needsSpace = false;
      result.push(ascii);
      continue;
    }

    needsSpace = false;
    result.push(String.fromCodePoint(cp));
  }

  return result.join("");
}

/**
 * Convert verbatim ASCII text back to UCSUR.
 * Word names become UCSUR glyphs, ASCII
 * structural chars become UCSUR control chars,
 * spaces between UCSUR tokens are stripped (font
 * handles spacing). "&" inserts ZWJ. Direction
 * chars after "ni" (e.g. "ni^") produce
 * ni + ZWJ + arrow.
 */
export function fromVerbatim(text: string): string {
  const tokens: Array<{
    ucsur: boolean;
    value: string;
  }> = [];
  let wordBuf = "";
  let i = 0;

  const flush = () => {
    if (!wordBuf) return;
    const word = wordBuf.toLowerCase();
    const cp = wordToCodepoint[word];
    if (cp !== undefined) {
      tokens.push({
        ucsur: true,
        value: codepointToChar(cp),
      });
    } else {
      tokens.push({
        ucsur: false,
        value: wordBuf,
      });
    }
    wordBuf = "";
  };

  while (i < text.length) {
    const ch = text[i];
    i++;

    const cp = ch.codePointAt(0)!;
    if (isLatinLetter(cp)) {
      wordBuf += ch;
      continue;
    }

    // Direction char after "ni" → ni + arrow
    // (e.g. "ni^" → ni + ↑)
    if (
      (ch === "<" || ch === "^" || ch === ">") &&
      wordBuf.toLowerCase() === "ni"
    ) {
      // Back up one char so parseVerbatimDirection
      // sees the direction from the start
      const parsed = parseVerbatimDirection(
        text, i - 1
      );
      if (parsed) {
        const niCp =
          wordToCodepoint[
            wordBuf.toLowerCase()
          ]!;
        tokens.push({
          ucsur: true,
          value:
            codepointToChar(niCp) +
            parsed.dir.arrow,
        });
        wordBuf = "";
        i += parsed.length - 1;
        continue;
      }
    }

    const ctrl = asciiToUcsurControl(ch);
    if (ctrl !== undefined) {
      flush();
      tokens.push({ ucsur: true, value: ctrl });
      continue;
    }

    flush();
    tokens.push({
      ucsur: false,
      value: ch,
    });
  }
  flush();

  // Strip spaces between UCSUR-producing tokens
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (
      t.value === " " &&
      i > 0 &&
      i < tokens.length - 1 &&
      tokens[i - 1].ucsur &&
      tokens[i + 1].ucsur
    ) {
      continue;
    }
    result.push(t.value);
  }

  return result.join("");
}
