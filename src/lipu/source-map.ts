/**
 * Query helpers over render-emitted source maps.
 * Ephemeral: rebuilt on every render, never
 * persisted.
 */

import type { SourceEntry } from "./types";

/** Smallest entry-index range covering [from, to). */
export function entryRangeAt(
  map: SourceEntry[],
  from: number,
  to: number
): { start: number; end: number } | null {
  let start: number | null = null;
  let end: number | null = null;
  for (let i = 0; i < map.length; i++) {
    const e = map[i];
    const collapsed = from === to;
    const overlaps =
      e.from < to && e.to > from
        ? true
        : e.from === e.to &&
          (collapsed
            ? e.from >= from && e.from <= to
            : e.from > from && e.from < to);
    if (overlaps) {
      if (start === null) start = i;
      end = i;
    }
  }

  // Fallback for collapsed queries at boundaries
  if (
    (start === null || end === null) &&
    from === to
  ) {
    for (let i = 0; i < map.length; i++) {
      const e = map[i];
      const touches = e.to === from || e.from === to;
      if (touches) {
        if (start === null) start = i;
        end = i;
      }
    }
  }

  if (start === null || end === null) return null;
  return { start, end };
}

/** Position range covering the entry-index range. */
export function rangeForEntries(
  map: SourceEntry[],
  start: number,
  end: number
): { from: number; to: number } | null {
  let from: number | null = null;
  let to: number | null = null;
  for (let i = 0; i < map.length; i++) {
    const e = map[i];
    if (i >= start && i <= end) {
      if (from === null || e.from < from) {
        from = e.from;
      }
      if (to === null || e.to > to) to = e.to;
    }
  }
  if (from === null || to === null) return null;
  return { from, to };
}
