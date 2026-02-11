import { isWord } from "../data";

export type TokenType =
  | "word"
  | "whitespace"
  | "punctuation"
  | "unknown";

export interface Token {
  type: TokenType;
  value: string;
  word?: string;
}

const PUNCTUATION = new Set([".", ",", "!", "?", ":", ";"]);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (PUNCTUATION.has(ch)) {
      tokens.push({ type: "punctuation", value: ch });
      i++;
      continue;
    }

    if (/\s/.test(ch)) {
      let end = i + 1;
      while (end < input.length && /\s/.test(input[end])) {
        end++;
      }
      tokens.push({
        type: "whitespace",
        value: input.slice(i, end),
      });
      i = end;
      continue;
    }

    // Consume a run of non-whitespace, non-punctuation chars
    let end = i + 1;
    while (
      end < input.length &&
      !/\s/.test(input[end]) &&
      !PUNCTUATION.has(input[end])
    ) {
      end++;
    }

    const raw = input.slice(i, end);
    const lower = raw.toLowerCase();

    if (isWord(lower)) {
      tokens.push({
        type: "word",
        value: raw,
        word: lower,
      });
    } else {
      tokens.push({ type: "unknown", value: raw });
    }

    i = end;
  }

  return tokens;
}
