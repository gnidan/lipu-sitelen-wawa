/**
 * Char tables, CHAR-level API: this model stores
 * literal chars in gap.sp, so it needs chars, not
 * marker enums. All chars come from the
 * font-capabilities layer (effective codepoints),
 * exactly as the app's existing renderer — this is
 * what keeps renderSp byte-identical to it.
 */

import {
  asciiToUcsurControl,
  niDirectionByIndex,
  niDirectionByArrowCp,
} from "../data";
import type {
  NameScheme,
  StructuralKind,
} from "./types";

/** marker name -> ASCII input shortcut */
const ASCII: Record<string, string> = {
  "cartouche-start": "[",
  "cartouche-end": "]",
  "cart-ext": "=",
  stack: "-",
  scale: "+",
  zwj: "&",
  "long-start": "(",
  "long-end": ")",
  "rev-long-start": "{",
  "rev-long-end": "}",
  "middle-dot": ".",
  colon: ":",
  tally: ",",
  "ideo-space": "|",
};

function ch(name: string): string {
  const c = asciiToUcsurControl(ASCII[name]);
  if (c === undefined) {
    throw new Error(`unmapped char: ${name}`);
  }
  return c;
}

export const CARTOUCHE_START = ch("cartouche-start");
export const CARTOUCHE_END = ch("cartouche-end");
export const CART_EXT = ch("cart-ext");
export const STACK = ch("stack");
export const SCALE = ch("scale");
export const ZWJ_CH = ch("zwj");
export const LONG_START = ch("long-start");
export const LONG_END = ch("long-end");
export const REV_LONG_START = ch("rev-long-start");
export const REV_LONG_END = ch("rev-long-end");
export const MIDDLE_DOT_CH = ch("middle-dot");
export const COLON_CH = ch("colon");
export const TALLY_CH = ch("tally");
export const IDEO_SPACE = ch("ideo-space");

export const JOINER_CHARS = new Set([
  STACK,
  SCALE,
  ZWJ_CH,
]);

export const STRUCTURAL_BY_CHAR = new Map<
  string,
  { kind: StructuralKind; role: "start" | "end" }
>([
  [CARTOUCHE_START,
    { kind: "cartouche", role: "start" }],
  [CARTOUCHE_END,
    { kind: "cartouche", role: "end" }],
  [LONG_START, { kind: "long", role: "start" }],
  [LONG_END, { kind: "long", role: "end" }],
  [REV_LONG_START,
    { kind: "rev-long", role: "start" }],
  [REV_LONG_END,
    { kind: "rev-long", role: "end" }],
]);

const STRUCTURAL_CHAR: Record<string, string> = {
  "cartouche:start": CARTOUCHE_START,
  "cartouche:end": CARTOUCHE_END,
  "long:start": LONG_START,
  "long:end": LONG_END,
  "rev-long:start": REV_LONG_START,
  "rev-long:end": REV_LONG_END,
};

export function structuralChar(
  kind: StructuralKind,
  role: "start" | "end"
): string {
  return STRUCTURAL_CHAR[kind + ":" + role];
}

/** Naming chars a nameScheme facet renders as
 *  (matches the app's existing SP renderer). */
export function schemeChars(
  s: NameScheme | undefined
): string {
  if (!s) return "";
  if (s.style === "word") return COLON_CH;
  const c =
    s.style === "morae"
      ? MIDDLE_DOT_CH
      : TALLY_CH;
  return c.repeat(s.count);
}

export function arrowChar(
  direction: number
): string {
  const dir = niDirectionByIndex(direction);
  if (!dir) {
    throw new Error(
      `arrow needs direction 1-8, ` +
        `got ${direction}`
    );
  }
  return dir.arrow;
}

export function isArrowChar(c: string): boolean {
  const cp = c.codePointAt(0);
  return (
    cp !== undefined &&
    niDirectionByArrowCp(cp) !== undefined
  );
}

/** The full marker-char domain (the chars that
 *  terminate an unmarked-Latin run in parseSp):
 *  every mapped control char, ASCII space, and the
 *  ni arrows. */
const MARKER_CPS = new Set<number>(
  [
    CARTOUCHE_START, CARTOUCHE_END, CART_EXT,
    STACK, SCALE, ZWJ_CH, LONG_START, LONG_END,
    REV_LONG_START, REV_LONG_END, MIDDLE_DOT_CH,
    COLON_CH, TALLY_CH, IDEO_SPACE,
  ].map((c) => c.codePointAt(0)!)
);
MARKER_CPS.add(0x20);

export function isMarkerChar(cp: number): boolean {
  return (
    MARKER_CPS.has(cp) ||
    niDirectionByArrowCp(cp) !== undefined
  );
}
