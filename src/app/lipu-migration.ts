/**
 * One-shot storage flip: the `doc:` mirror (every
 * production doc) -> `lipu:<id>` values. The
 * retired development-era `lipudoc:`
 * migration support is gone: it was
 * development-only (production never had lipudoc
 * keys), and every machine that had them has already
 * run the migration that consumed and deleted those
 * keys. What remains is simply: mirror -> lipu via
 * parseSp (contentToLipu applies the both-sides
 * "\n" default, subsuming any companion
 * backfill), under a strict byte gate.
 *
 * Machinery pattern is the one-shot flagged pass:
 * its OWN marker key
 * (LIPU_FORMAT_KEY — deliberately not the retired
 * development-era "format" marker:
 * production collections never ran that pass), whose
 * value doubles as the durable report; idempotent per
 * doc (valid lipu: present -> skip); per-doc
 * isolation (malformed data skips one doc, never the
 * pass); marker only after a complete pass, so a
 * quota interruption retries next init (the outer
 * catch below leaves no marker; a doc already
 * converted before the interruption is skipped on the
 * retry via the idempotent check at the top of the
 * loop).
 *
 * The byte gate is STRICT (no one-step-convergence
 * allowance — promotion is byte-preserving, so exact
 * reproduction is achievable):
 * contentToLipu(mirror) must render back to the
 * normalized mirror bytes exactly via lipuToContent.
 * Failure -> the doc is SKIPPED with all bytes
 * untouched: loadDocLipu's mirror fallback keeps it
 * readable, and its first save mints the lipu: key
 * from the live model.
 *
 * The recorded mirrorHash is seeded from the mirror
 * bytes AS STORED (raw), so the first post-migration
 * load hash-matches and stays on the lipu: value.
 *
 * MIRRORS ARE NEVER WRITTEN by this pass — the mirror
 * is the fallback production builds actually read, and
 * its untouchability is the production-safety
 * invariant of this pass.
 *
 * A pre-existing but INVALID `lipu:` value (corrupt
 * JSON, wrong shape) is preserved to quarantine
 * before this doc's conversion overwrites it —
 * mirrored from the load path's
 * quarantine-then-fall-through. That preservation is
 * best-effort like the load path: it proceeds either
 * way, since the value was already unusable — a quota
 * failure there does not withhold the marker, unlike a
 * quota failure during the primary conversion write
 * below, which throws out to the outer catch and
 * withholds it.
 */

import type { JSONContent } from "@tiptap/core";
import {
  contentToLipu,
  lipuToContent,
} from "../editor/lipu-doc";
import type { Lipu } from "../lipu";
import {
  DOC_PREFIX,
  LIPU_FORMAT_KEY,
  LIPU_PREFIX,
  hashMirror,
  loadIndex,
  parseStoredLipu,
  quarantineRaw,
} from "./documents";

function hasMarker(): boolean {
  const raw = localStorage.getItem(LIPU_FORMAT_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return (
      !!parsed &&
      typeof parsed === "object" &&
      parsed.v === 1
    );
  } catch {
    return false;
  }
}

/** Runtime-safe id read from an index entry: the
 *  index itself comes from unchecked JSON, so a
 *  corrupt entry (null, non-object, non-string id)
 *  must be skipped rather than throw and kill the
 *  whole pass for every later doc too. */
function entryId(raw: unknown): string | undefined {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof (raw as { id?: unknown }).id !== "string"
  ) {
    return undefined;
  }
  return (raw as { id: string }).id;
}

/** STRICT mirror conversion: parse, convert,
 *  and require the render to reproduce the normalized
 *  mirror bytes exactly. undefined = skip the doc. */
function tryMirrorToLipu(
  mirrorRaw: string
): Lipu | undefined {
  let normalized: string;
  let parsed: JSONContent;
  try {
    parsed = JSON.parse(mirrorRaw) as JSONContent;
    normalized = JSON.stringify(parsed);
  } catch {
    return undefined;
  }
  try {
    const lipu = contentToLipu(parsed);
    const rendered = JSON.stringify(
      lipuToContent(lipu)
    );
    return rendered === normalized
      ? lipu
      : undefined;
  } catch {
    return undefined;
  }
}

function writeLipu(
  id: string,
  lipu: Lipu,
  mirrorRaw: string
): void {
  localStorage.setItem(
    LIPU_PREFIX + id,
    JSON.stringify({
      version: 2,
      blocks: lipu.blocks,
      savedAt: Date.now(),
      mirrorHash: hashMirror(mirrorRaw),
    })
  );
}

/** Total localStorage footprint in bytes (UTF-16:
 *  two bytes per code unit). Report diagnostic. */
function storageUsageBytes(): number {
  let units = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null) continue;
    units += key.length;
    units += (localStorage.getItem(key) ?? "")
      .length;
  }
  return units * 2;
}

export function migrateToLipu(): void {
  if (hasMarker()) return;

  let fromMirror = 0;
  const skipped: string[] = [];

  try {
    for (const rawEntry of loadIndex()) {
      const id = entryId(rawEntry);
      if (id === undefined) continue;

      const lipuKey = LIPU_PREFIX + id;
      const existing = localStorage.getItem(lipuKey);
      if (existing !== null) {
        if (parseStoredLipu(existing) !== undefined) {
          // idempotent re-run: already converted
          continue;
        }
        // an INVALID pre-existing lipu: value is about
        // to be overwritten by this doc's conversion
        // below: preserve it first — mirrored from
        // the load path's quarantine-
        // then-fall-through. Best-effort like the
        // load path: proceeds either way, since the
        // value was already unusable.
        quarantineRaw(id, existing);
      }

      const mirrorRaw = localStorage.getItem(
        DOC_PREFIX + id
      );
      if (mirrorRaw === null) continue;

      const converted = tryMirrorToLipu(mirrorRaw);
      if (converted === undefined) {
        skipped.push(id);
        continue;
      }
      writeLipu(id, converted, mirrorRaw);
      fromMirror += 1;
    }

    try {
      localStorage.setItem(
        LIPU_FORMAT_KEY,
        JSON.stringify({
          v: 1,
          at: Date.now(),
          fromMirror,
          skipped,
          usageBytes: storageUsageBytes(),
        })
      );
    } catch {
      // marker/report is best-effort; the pass is
      // idempotent and retries next init
    }
    if (skipped.length > 0) {
      console.warn(
        "lipu-sitelen-wawa: lipu migration " +
          "skipped (strict byte gate; docs stay " +
          "mirror-read): " +
          skipped.join(", ")
      );
    }
  } catch {
    // quota mid-pass (e.g. the writeLipu call above):
    // leave unmarked; converted docs are skipped on
    // the retry (idempotent per doc)
    console.error(
      "lipu-sitelen-wawa: lipu migration " +
        "interrupted; will retry"
    );
  }
}
