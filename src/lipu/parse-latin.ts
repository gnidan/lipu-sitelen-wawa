/**
 * Latin projection -> one side of a Block. Total.
 * Boundary rule: a maximal run of Unicode letters
 * plus interior apostrophes is anchor material
 * (toki pona word -> word anchor with case facet;
 * otherwise a marked verbatim anchor); digits,
 * punctuation, and ALL whitespace are literal
 * gap.latin content — nothing is synthesized, so
 * nothing is dropped. Name atoms pass through
 * opaquely: their covered anchors and interior
 * latin gap strings re-emerge untouched.
 *
 * INTERIOR-PUNCTUATION BINDING: a candidate run
 * (chars between hard boundaries) that contains
 * interior punctuation, after trimming edge
 * punctuation, binds WHOLE to one marked verbatim
 * token instead of decomposing into separate
 * letter/gap pieces.
 */

import {
  isControlChar,
  isUcsurChar,
  isWord,
} from "../data";
import type {
  Anchor,
  LatinInline,
  ParsedSide,
} from "./types";

const APOSTROPHES = new Set(["'", "’"]);

function isLetter(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

/** Combining marks CONTINUE a letter run but can
 *  never START one. NFD-decomposed accents ("cafe"
 *  + U+0301) must not split the run — and admitting
 *  the mark to the run keeps the author's ORIGINAL
 *  bytes, where normalizing the input would silently
 *  rewrite stored content. */
function isMark(ch: string): boolean {
  return /\p{M}/u.test(ch);
}

function isDigit(ch: string): boolean {
  return /\p{Nd}/u.test(ch);
}

/** Hard run boundaries — the same family as the
 *  latin-paste UCSUR strip (latin-paste.ts
 *  isSpOnlyChar): SP-content codepoints never bind
 *  and terminate a run on either side. Whitespace
 *  likewise. */
function isHardBoundary(ch: string): boolean {
  if (/\s/u.test(ch)) return true;
  if (isUcsurChar(ch)) return true;
  const cp = ch.codePointAt(0);
  return cp !== undefined && isControlChar(cp);
}

export interface LTok {
  type: "word" | "alpha" | "bound" | "other";
  value: string;
  word?: string;
}

/** TRIM-FIRST predicate. Iteratively trim boundary
 *  PUNCT from both ends (letters, marks, and digits
 *  stop the trim; apostrophes are edge-trimmable —
 *  they are LETTERISH only interior). The core
 *  BINDS iff it contains at least one interior
 *  PUNCT char: any char that is not a letter, mark,
 *  digit, or interior apostrophe. All-punct runs
 *  trim to an empty core and never bind. Digits
 *  ride, never trigger. */
export function splitRun(run: string): {
  leading: string;
  core: string;
  trailing: string;
  binds: boolean;
} {
  const chars = [...run];
  const keep = (i: number): boolean =>
    isLetter(chars[i]) ||
    isMark(chars[i]) ||
    isDigit(chars[i]);
  let s = 0;
  let e = chars.length;
  while (s < e && !keep(s)) s += 1;
  while (e > s && !keep(e - 1)) e -= 1;
  let binds = false;
  for (let i = s; i < e; i++) {
    if (keep(i)) continue;
    const interiorApostrophe =
      APOSTROPHES.has(chars[i]) &&
      i > s &&
      i + 1 < e &&
      (isLetter(chars[i - 1]) ||
        isMark(chars[i - 1])) &&
      isLetter(chars[i + 1]);
    if (!interiorApostrophe) {
      binds = true;
      break;
    }
  }
  return {
    leading: chars.slice(0, s).join(""),
    core: chars.slice(s, e).join(""),
    trailing: chars.slice(e).join(""),
    binds,
  };
}

/** Today's letter-run scan, verbatim (was the body
 *  of tokenizeLatin): words, alpha verbatims,
 *  per-char "other" gap bytes. Operates on a
 *  boundary-free, non-binding core. */
function tokenizeRun(text: string): LTok[] {
  const out: LTok[] = [];
  const chars = [...text]; // code points
  let i = 0;
  while (i < chars.length) {
    if (isLetter(chars[i])) {
      let end = i + 1;
      while (end < chars.length) {
        if (
          isLetter(chars[end]) ||
          isMark(chars[end])
        ) {
          end += 1;
          continue;
        }
        if (
          APOSTROPHES.has(chars[end]) &&
          end + 1 < chars.length &&
          isLetter(chars[end + 1])
        ) {
          end += 1; // interior apostrophe
          continue;
        }
        break;
      }
      const value = chars.slice(i, end).join("");
      const lower = value.toLowerCase();
      if (isWord(lower)) {
        out.push({
          type: "word",
          value,
          word: lower,
        });
      } else {
        out.push({ type: "alpha", value });
      }
      i = end;
      continue;
    }
    out.push({ type: "other", value: chars[i] });
    i += 1;
  }
  return out;
}

/** Exported for direct testing. */
export function tokenizeLatin(text: string): LTok[] {
  const out: LTok[] = [];
  const chars = [...text];
  let i = 0;
  while (i < chars.length) {
    if (isHardBoundary(chars[i])) {
      out.push({ type: "other", value: chars[i] });
      i += 1;
      continue;
    }
    let end = i;
    while (
      end < chars.length &&
      !isHardBoundary(chars[end])
    ) {
      end += 1;
    }
    const run = chars.slice(i, end).join("");
    const { leading, core, trailing, binds } =
      splitRun(run);
    for (const ch of [...leading]) {
      out.push({ type: "other", value: ch });
    }
    if (binds) {
      out.push({ type: "bound", value: core });
    } else if (core !== "") {
      out.push(...tokenizeRun(core));
    }
    for (const ch of [...trailing]) {
      out.push({ type: "other", value: ch });
    }
    i = end;
  }
  return out;
}

function isCapitalized(value: string): boolean {
  return (
    value.length > 0 &&
    value[0] !== value[0].toLowerCase()
  );
}

export function parseLatin(
  inlines: LatinInline[]
): ParsedSide {
  const anchors: Anchor[] = [];
  const gaps: string[] = [];
  let cur = "";

  function pushAnchor(a: Anchor): void {
    gaps.push(cur);
    cur = "";
    anchors.push(a);
  }

  function parseText(text: string): void {
    for (const t of tokenizeLatin(text)) {
      if (t.type === "word") {
        const a: Anchor = {
          kind: "word",
          word: t.word!,
        };
        if (isCapitalized(t.value)) {
          a.case = "capital";
        }
        pushAnchor(a);
      } else if (
        t.type === "alpha" ||
        t.type === "bound"
      ) {
        pushAnchor({
          kind: "verbatim",
          text: t.value,
          marked: true,
        });
      } else {
        cur += t.value;
      }
    }
  }

  for (const inline of inlines) {
    if (inline.type === "name") {
      // opaque pass-through: covered anchors and
      // interior latin gaps re-emerge untouched
      inline.anchors.forEach((a, k) => {
        pushAnchor({ ...a });
        if (k < inline.interiorLatin.length) {
          cur = inline.interiorLatin[k];
        }
      });
      continue;
    }
    parseText(inline.text);
  }
  gaps.push(cur);
  return { anchors, gaps };
}

export function latinInlinesFromText(
  text: string
): LatinInline[] {
  return text.length > 0
    ? [{ type: "text", text }]
    : [];
}
