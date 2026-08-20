/**
 * One-time orphan cleanup for the newline-coupling
 * fix (doc-merge.ts's applyEnterDefaults keeps latin
 * newlines in step with sp newlines at every break):
 * before the fix, every SP-side line join left its
 * companion latin "\n" behind (the "newline ratchet"),
 * so an Enter/delete cycle at the same break could
 * accrete latin "\n"s without bound. This pass caps
 * every stored gap's latin "\n" count at its sp "\n"
 * count, trimming the trailing-most orphaned "\n"s and
 * leaving all other latin content untouched
 * (capLatinNewlines, doc-merge.ts).
 *
 * Safe exactly now because the Latin pane is
 * read-only: every stored latin "\n" beyond the sp
 * count is a machine default, never user content typed
 * into the Latin side.
 *
 * Machinery pattern is the one-shot flagged pass
 * (mirrored from
 * lipu-migration.ts): its OWN marker key
 * (LATIN_NEWLINE_TRIM_KEY), whose value doubles as the
 * durable report; per-doc isolation (a doc that fails
 * to load is skipped, never aborts the pass); the
 * marker is set even when zero docs needed trimming
 * (an empty report is still a completed pass); a quota
 * throw aborts WITHOUT the marker so the next init
 * retries — docs already saved by that point are
 * skipped on the retry because capLatinNewlines finds
 * nothing left to trim (idempotent per doc).
 *
 * Loads via the normal loadDocLipuClassified and writes
 * via the normal saveDocDual (mirror-first, hash) — this
 * pass never hand-writes storage. rollPrev is FALSE: this
 * pass runs over EVERY doc in the index at startup, and
 * rollPrev: true would unconditionally overwrite each
 * trimmed doc's existing prev:<id> — a real recovery
 * point from a past edit session, possibly holding
 * genuinely divergent content — with the pre-trim
 * snapshot, which differs from the current state only
 * by machine-default newlines and so has essentially no
 * recovery value of its own. capLatinNewlines is a
 * bounded character-count strip with no plausible
 * failure mode that a roll would insure against; rolling
 * here is all cost (destroying a real recovery point)
 * and no benefit. Leaving prev:<id> exactly as it was is
 * the recoverable-by-construction choice for this pass.
 *
 * The classify gate: this pass is NOT guaranteed
 * to be its own browser's first-ever run — a quota-
 * interrupted retry (this file's own supported/tested
 * shape) or multi-tab concurrency can hand it a doc
 * that ALREADY carries `classified: true` and still has
 * un-trimmed newline debt (e.g. a normal edit + save
 * landed between an aborted pass and its retry). Running
 * classifyProvenance unconditionally on such a doc would
 * re-harden its already-correctly-unmarked derived
 * punctuation to AUTHORED — the exact re-classification
 * bug the stored `classified` flag exists to stop,
 * surviving through this path. So classification here is
 * gated on the SAME `classified` cue as the load chain:
 * skip it when the loaded payload already carries the
 * flag (flagged docs arrive with correct marks by
 * construction, and capLatinNewlines is already
 * mark-gated, so it needs no classification
 * pass of its own on them).
 */

import {
  capLatinNewlines,
  classifyProvenance,
} from "../lipu";
import type { Lipu } from "../lipu";
import { lipuToContent } from "../editor/lipu-doc";
import {
  LATIN_NEWLINE_TRIM_KEY,
  loadDocLipuClassified,
  loadIndex,
  saveDocDual,
} from "./documents";

function hasMarker(): boolean {
  const raw = localStorage.getItem(
    LATIN_NEWLINE_TRIM_KEY
  );
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

/** Runtime-safe id read from an index entry, mirrored
 *  from lipu-migration.ts's entryId: the index comes
 *  from unchecked JSON, so a corrupt entry must be
 *  skipped rather than throw and kill the whole pass. */
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

export function trimLatinNewlines(): void {
  if (hasMarker()) return;

  let trimmed = 0;
  let docs = 0;

  try {
    for (const rawEntry of loadIndex()) {
      const id = entryId(rawEntry);
      if (id === undefined) continue;

      const loaded = loadDocLipuClassified(id);
      if (loaded === undefined) continue;

      // One-time passes run AFTER classification,
      // gated as rewriters — an unmarked, punctuated
      // gap.latin from a mirror-migrated doc must
      // classify
      // AUTHORED before capLatinNewlines ever sees it.
      // And gated on the SAME
      // `classified` cue as the load chain — a payload
      // that already carries the flag must NOT be
      // reclassified (see module header).
      const classified = loaded.classified
        ? loaded.lipu
        : classifyProvenance(loaded.lipu);
      let docTrimmed = 0;
      const blocks = classified.blocks.map((b) => {
        const result = capLatinNewlines(b);
        docTrimmed += result.trimmed;
        return result.block;
      });
      if (docTrimmed === 0) continue;

      const next: Lipu = { version: 2, blocks };
      // rollPrev: false — see module header.
      const saved = saveDocDual(
        id,
        next,
        lipuToContent(next),
        false
      );
      if (!saved) {
        // quota mid-write: abort the whole pass so no
        // marker is written; the outer catch handles
        // the retry-next-init bookkeeping identically
        // to migrateToLipu's un-wrapped writeLipu call
        throw new Error(
          "latin-newline-trim: saveDocDual failed"
        );
      }
      trimmed += docTrimmed;
      docs += 1;
    }

    try {
      localStorage.setItem(
        LATIN_NEWLINE_TRIM_KEY,
        JSON.stringify({
          v: 1,
          at: Date.now(),
          trimmed,
          docs,
        })
      );
    } catch {
      // marker/report is best-effort; the pass is
      // idempotent and retries next init (mirrors
      // migrateToLipu's marker write)
    }
  } catch {
    // quota mid-pass: leave unmarked; docs already
    // saved before the failure are skipped on the
    // retry (capLatinNewlines finds nothing left to
    // trim for them — idempotent per doc)
    console.error(
      "lipu-sitelen-wawa: latin-newline-trim " +
        "interrupted; will retry"
    );
  }
}
