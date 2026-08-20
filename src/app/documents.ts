import type { JSONContent } from "@tiptap/core";
import {
  contentToLipu,
  lipuToContent,
} from "../editor/lipu-doc";
import { checkBlock } from "../lipu";
import type { Block, Lipu } from "../lipu";

export const KEY_PREFIX = "lipu-sitelen-wawa:";
export const DOC_PREFIX = KEY_PREFIX + "doc:";
// LIPUDOC_PREFIX: a retired development-era key
// namespace (production never wrote it). Nothing
// reads or writes it anymore — the one-shot
// migration that once consumed it has already run on
// every machine that ever had these keys, deleting
// them in the process. Constant kept only so tooling
// and tests still have a name for the retired shape.
// Reserved, never-rebindable key names in the same
// retired family: "format", "backup:1",
// "migration-abort", "migration-report",
// "companions" (values still present in some stored
// collections are recovery assets; leave them).
export const LIPUDOC_PREFIX = KEY_PREFIX + "lipudoc:";
export const PREV_PREFIX = KEY_PREFIX + "prev:";
export const INDEX_KEY = KEY_PREFIX + "doc-index";
export const ACTIVE_KEY = KEY_PREFIX + "active-doc";

// THE STORAGE FLIP: lipu values live under
// lipu:<id> — the one and only key move; the value's
// {version: 2} field carries format versioning from
// here on.
export const LIPU_PREFIX = KEY_PREFIX + "lipu:";
// Marker for the one-shot mirror -> lipu: migration
// pass; its value doubles as the durable report.
// Deliberately independent of the retired
// development-era migration markers — production
// collections never ran that earlier pass.
export const LIPU_FORMAT_KEY =
  KEY_PREFIX + "lipu-format";
// Load-time mirror-wins event counter (the event is
// also warned to the console at each occurrence).
export const MIRROR_WINS_KEY =
  KEY_PREFIX + "mirror-wins";
// Marker for the one-shot orphaned-latin-newline
// cleanup pass (latin newlines are kept in step with
// sp newlines at every break; old builds left
// orphans behind): its value doubles as the durable
// report, same as LIPU_FORMAT_KEY above.
export const LATIN_NEWLINE_TRIM_KEY =
  KEY_PREFIX + "latin-newline-trim";

const LEGACY_KEY = "lipu-sitelen-wawa:doc";
const QUARANTINE_PREFIX = KEY_PREFIX + "quarantine:";

// Disambiguates quarantine keys written within the same
// millisecond (Date.now() resolution); the id + raw dedup
// check below is what actually prevents duplicate copies.
let quarantineSeq = 0;

/**
 * Preserves a stored value under a timestamped
 * quarantine key instead of silently discarding or
 * overwriting it, so a later autosave (or migration
 * conversion) can never actually lose the original
 * bytes. Called for genuinely corrupt/unparseable
 * data, but just as often for perfectly healthy bytes
 * a caller is about to delete or overwrite for other
 * reasons (e.g. a superseded value whose prev: slot
 * is occupied) — the wording below must stay neutral,
 * true for every caller, not just the corrupt-data
 * one. Deduped: a repeat call for the same id with
 * identical bytes (e.g. a stuck retry loop) does not
 * pile up quarantine keys. Quarantine writes are
 * best-effort: a quota error here must not prevent
 * the caller from reporting the doc as unloadable.
 * Returns whether a copy is CONFIRMED in storage
 * (already-deduped or freshly written) — a caller
 * about to delete or overwrite the only other copy of
 * `raw` must check this before doing so; a `false`
 * return means the bytes are not safely preserved
 * anywhere else, so the caller must not destroy the
 * source.
 */
export function quarantineRaw(
  id: string,
  raw: string
): boolean {
  const prefix = QUARANTINE_PREFIX + id + ":";
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (
      key &&
      key.startsWith(prefix) &&
      localStorage.getItem(key) === raw
    ) {
      return true;
    }
  }

  const key = prefix + Date.now() + "-" + quarantineSeq++;
  try {
    localStorage.setItem(key, raw);
    console.error(
      "lipu-sitelen-wawa: stored value for " +
        `"${id}" preserved under quarantine key ` +
        `"${key}"`
    );
    return true;
  } catch {
    // quota exceeded or similar; nothing more we can
    // do to preserve the data here, but this must not
    // be silent: a caller that goes on to destroy the
    // source anyway (this function cannot prevent
    // that) would lose the bytes outright
    console.error(
      "lipu-sitelen-wawa: failed to preserve " +
        `stored value for "${id}" under quarantine ` +
        `key "${key}"`
    );
    return false;
  }
}

/**
 * Synchronous 64-bit hash of the mirror bytes as
 * written — two mixed
 * Math.imul lanes (cyrb-style) over UTF-16 code
 * units, hex-encoded, with an exact-length suffix.
 * The hash IS the forward contract: written with the
 * mirror on every dual-write, nothing more.
 * Direction of failure is safe by construction:
 * mismatch routes to mirror-wins (recovery). The
 * residual hazard is a COLLISION masking an
 * old-build mirror edit as hash-match, routing it to
 * the silent drift re-canonicalization; 64 bits plus
 * exact length makes that ~2^-64 per event.
 * Accepted risk.
 */
export function hashMirror(raw: string): string {
  let h1 = 0xdeadbeef ^ raw.length;
  let h2 = 0x41c6ce57 ^ raw.length;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, "0") +
    (h1 >>> 0).toString(16).padStart(8, "0") +
    "-" +
    raw.length.toString(36)
  );
}

/** What `lipu:<id>` holds. savedAt kept for parity
 *  with the retired lipudoc value; mirrorHash is the
 *  dual-write contract (absent = pre-hash or foreign
 *  value: cannot certify the mirror, so load treats
 *  it as a hash MISMATCH — the recovery flow).
 *  classified: written `true` on every save by
 *  provenance-aware builds; absent means genuinely
 *  pre-provenance bytes that still need the load
 *  classifier (loadDocLipuClassified reads this to
 *  decide, never validated by parseStoredLipu — an
 *  optional field, same as the mark fields). */
export interface StoredLipu {
  version: 2;
  blocks: Block[];
  savedAt?: number;
  mirrorHash?: string;
  classified?: true;
}

/** Validated read of a `lipu:<id>` raw value.
 *  Structural gate: every block must pass the
 *  library's checkBlock — grossly malformed
 *  shapes throw inside the try and read as invalid.
 *  checkBlock does NOT police newline runs: a
 *  dwelled-run transient ("\n\n" in a gap.sp saved
 *  mid-composition) is LEGAL stored content
 *  (decided behavior; pinned in
 *  documents.test.ts). */
export function parseStoredLipu(
  raw: string
): StoredLipu | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      parsed.version !== 2 ||
      !Array.isArray(parsed.blocks)
    ) {
      return undefined;
    }
    if (
      parsed.mirrorHash !== undefined &&
      typeof parsed.mirrorHash !== "string"
    ) {
      return undefined;
    }
    for (const b of parsed.blocks) {
      if (checkBlock(b as Block).length > 0) {
        return undefined;
      }
    }
    return parsed as StoredLipu;
  } catch {
    return undefined;
  }
}

export interface DocEntry {
  id: string;
  name: string;
  updatedAt: number;
}

export function loadIndex(): DocEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as DocEntry[];
      }
    }
  } catch {
    // corrupt data
  }
  return [];
}

export function saveIndex(
  entries: DocEntry[]
): void {
  localStorage.setItem(
    INDEX_KEY,
    JSON.stringify(entries)
  );
}

export function loadDocContent(
  id: string
): JSONContent | undefined {
  const raw = localStorage.getItem(DOC_PREFIX + id);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as JSONContent;
  } catch {
    quarantineRaw(id, raw);
    return undefined;
  }
}

export function saveDocContent(
  id: string,
  content: JSONContent
): void {
  localStorage.setItem(
    DOC_PREFIX + id,
    JSON.stringify(content)
  );
}

/** Eager mirror-wins preservation: the
 *  superseded lipu: value must survive BEFORE any
 *  save can overwrite it. Never overwrites an
 *  existing different prev: value. */
function preserveSuperseded(
  id: string,
  raw: string
): void {
  const prevKey = PREV_PREFIX + id;
  const existing = localStorage.getItem(prevKey);
  if (existing === raw) return;
  if (existing === null) {
    try {
      localStorage.setItem(prevKey, raw);
      return;
    } catch {
      // quota: fall through to quarantine
    }
  }
  quarantineRaw(id, raw);
}

/** Diagnostics are best-effort and must never break
 *  a load. */
function countMirrorWins(id: string): void {
  // The READ is scoped in its own try: a corrupt
  // counter value must restart the count from zero,
  // not disable the counter forever (a parse throw
  // sharing the write's try would skip the setItem
  // that heals it).
  let count = 0;
  try {
    const prev = localStorage.getItem(
      MIRROR_WINS_KEY
    );
    if (prev) {
      count =
        (JSON.parse(prev).count as number) || 0;
    }
  } catch {
    count = 0;
  }
  try {
    localStorage.setItem(
      MIRROR_WINS_KEY,
      JSON.stringify({
        count: count + 1,
        lastAt: Date.now(),
        lastId: id,
      })
    );
  } catch {
    // best-effort
  }
}

/** RENDERER DRIFT: lipu wins; the mirror is
 *  silently rewritten from the current render and
 *  the recorded hash updated — mirror-first, so a
 *  tear here leaves a stale hash and the next load
 *  simply re-runs this branch. Failures are logged,
 *  never thrown: the doc still loads. */
function recanonicalizeMirror(
  id: string,
  lipuRaw: string,
  fresh: string
): void {
  try {
    localStorage.setItem(DOC_PREFIX + id, fresh);
  } catch {
    console.error(
      "lipu-sitelen-wawa: failed to " +
        `re-canonicalize mirror for doc "${id}"`
    );
    return;
  }
  try {
    const stored = JSON.parse(lipuRaw) as Record<
      string,
      unknown
    >;
    localStorage.setItem(
      LIPU_PREFIX + id,
      JSON.stringify({
        ...stored,
        mirrorHash: hashMirror(fresh),
      })
    );
  } catch {
    console.error(
      "lipu-sitelen-wawa: failed to update " +
        `recorded hash for doc "${id}"`
    );
  }
}

/** loadDocLipuClassified's result: `classified` is
 *  the caller's cue for the load-boundary classifier
 *  (loadNormalizeLipu's alreadyClassified param) —
 *  true means `lipu`'s marks are
 *  ALREADY FULLY RESOLVED and must NOT be run through
 *  classifyProvenance again (either the stored payload
 *  carried `classified: true`, or `lipu` was freshly
 *  parsed via contentToLipu, whose parsedToBlock chain
 *  already classifies before any gap-rebuilding
 *  default runs). false means genuinely
 *  pre-provenance stored bytes that still need it. */
export interface LoadedLipu {
  lipu: Lipu;
  classified: boolean;
}

/**
 * The load path. `lipu:<id>`
 * is preferred; the recorded mirrorHash separates the
 * two disagreement modes exactly:
 *
 *  - hash(stored mirror) !== recorded hash: the
 *    mirror was written by an OLD BUILD or edited
 *    externally — the MIRROR IS AUTHORITY. The doc
 *    re-derives from the mirror (best effort;
 *    latin-side gap content and span attrs die for
 *    the live doc), and the superseded lipu: value is
 *    preserved FIRST — eagerly, at detection, so no
 *    save can outrun it: to prev:<id> when prev is
 *    absent or already equal, else to quarantine
 *    (never overwriting an existing different
 *    prev). Counted in MIRROR_WINS_KEY + warned.
 *  - hash matches but a fresh render differs:
 *    RENDERER DRIFT — the LIPU IS AUTHORITY; the
 *    mirror is silently re-canonicalized (rewritten
 *    from the current render, hash updated,
 *    mirror-first write order). This is the forward
 *    contract: SP rendering may evolve; a renderer
 *    change routes every doc through here once.
 *
 * Docs with no lipu: key (strict-gate migration
 * skips; docs last saved by production builds) read
 * through the mirror fallback (contentToLipu), as
 * ever. A valid lipu: value whose mirror is MISSING
 * stands alone (next save re-mints the mirror).
 * Corrupt bytes quarantine on every path — no read
 * ever silently discards stored bytes.
 */
export function loadDocLipuClassified(
  id: string
): LoadedLipu | undefined {
  const lipuRaw = localStorage.getItem(
    LIPU_PREFIX + id
  );
  if (lipuRaw !== null) {
    const stored = parseStoredLipu(lipuRaw);
    if (stored === undefined) {
      quarantineRaw(id, lipuRaw);
    } else {
      const lipu: Lipu = {
        version: 2,
        blocks: stored.blocks,
      };
      const classified = stored.classified === true;
      const mirrorRaw = localStorage.getItem(
        DOC_PREFIX + id
      );
      if (mirrorRaw === null) {
        return { lipu, classified };
      }
      if (
        stored.mirrorHash !== undefined &&
        hashMirror(mirrorRaw) === stored.mirrorHash
      ) {
        // our own bytes; drift check (normalized
        // compare)
        let mirrorNorm: string | undefined;
        try {
          mirrorNorm = JSON.stringify(
            JSON.parse(mirrorRaw)
          );
        } catch {
          mirrorNorm = undefined;
        }
        if (mirrorNorm === undefined) {
          // hash-matching yet unparseable bytes:
          // storage corruption; preserve and let the
          // next save rewrite the mirror
          quarantineRaw(id, mirrorRaw);
          return { lipu, classified };
        }
        const fresh = JSON.stringify(
          lipuToContent(lipu)
        );
        if (mirrorNorm !== fresh) {
          recanonicalizeMirror(id, lipuRaw, fresh);
        }
        return { lipu, classified };
      }
      // hash mismatch (or hash-less value):
      // mirror is authority
      let mirrorParsed: JSONContent | undefined;
      try {
        mirrorParsed = JSON.parse(
          mirrorRaw
        ) as JSONContent;
      } catch {
        // the newer mirror is unreadable: preserve
        // its bytes; the lipu stands as the best
        // remaining content
        quarantineRaw(id, mirrorRaw);
        return { lipu, classified };
      }
      preserveSuperseded(id, lipuRaw);
      countMirrorWins(id);
      console.warn(
        "lipu-sitelen-wawa: mirror for doc " +
          `"${id}" fails the recorded hash; ` +
          "using mirror (old-build/external edit); " +
          "superseded lipu value preserved"
      );
      return {
        lipu: contentToLipu(mirrorParsed),
        classified: true,
      };
    }
  }

  const content = loadDocContent(id);
  if (content === undefined) return undefined;
  return { lipu: contentToLipu(content), classified: true };
}

/** Bytes-only convenience wrapper over
 *  loadDocLipuClassified, kept for every caller that
 *  does not need the classified cue (pinned
 *  contract: documents.test.ts's many `Lipu | undefined`
 *  pins). NOT safe as a classification cue: a caller
 *  that classifies what it loads must use
 *  loadDocLipuClassified and gate on the flag —
 *  quota-interrupted retries and multi-tab runs DO see
 *  docs already `classified: true` (the trim pass's
 *  classify gate exists because a first-run-ordering
 *  argument once made here was
 *  wrong; pinned in latin-newline-trim.test.ts). */
export function loadDocLipu(
  id: string
): Lipu | undefined {
  return loadDocLipuClassified(id)?.lipu;
}

/**
 * The dual-write. Order is
 * load-bearing: the mirror (`doc:<id>`, the PM-JSON
 * format pre-flip builds read — and keep reading
 * indefinitely, which is why it stays correct
 * forever, not just through the migration)
 * is written FIRST; the `lipu:<id>` value carries the
 * hash of those exact mirror bytes SECOND. A tear
 * between the writes leaves the recorded hash stale,
 * and loadDocLipu's hash check recovers the newer
 * mirror. The retired development-era lipudoc
 * serialization no longer runs on saves; the mirror
 * render (lipuToContent) is unchanged.
 *
 * Separation-default carry (accepted): the separation
 * default's gap.latin " " content is stored directly
 * in the lipu: value's gaps, as bare
 * one-char strings. SP-invisible; the mirror is
 * untouched by it. Pinned in documents.test.ts.
 *
 * RETURNS whether the `lipu:<id>` write actually
 * completed. A `false` return means this doc's stored
 * lipu value is NOT this payload — either nothing was
 * written at all (mirror failure), or the write was
 * deliberately skipped to protect an unpreservable
 * pre-open baseline, or the write itself threw. The
 * caller must NOT record the prev roll as done on
 * false: the next save has to attempt the full
 * roll-or-preserve sequence again, which is what
 * makes the protection converge once quota heals
 * (pinned in useDocuments.test.ts).
 */
export function saveDocDual(
  id: string,
  lipu: Lipu,
  content: JSONContent,
  rollPrev: boolean
): boolean {
  const mirrorJson = JSON.stringify(content);
  try {
    localStorage.setItem(
      DOC_PREFIX + id,
      mirrorJson
    );
  } catch {
    console.error(
      "lipu-sitelen-wawa: failed to write mirror " +
        `for doc "${id}"`
    );
    return false;
  }

  // PRESERVE BEFORE DESTROY: the lipu: write below
  // OVERWRITES the pre-open baseline this roll is
  // meant to save, so the overwrite is gated on the
  // baseline having actually landed somewhere. Quota
  // on prev: falls back to quarantine; if THAT fails
  // too, the lipu: write is skipped entirely and the
  // baseline stays intact in its own key — the
  // mirror (written first) already carries this
  // save, so the next load resolves it through the
  // ordinary hash-mismatch mirror-wins path. No
  // failure combination loses bytes.
  if (rollPrev) {
    const superseded = localStorage.getItem(
      LIPU_PREFIX + id
    );
    if (superseded !== null) {
      let rolled = false;
      try {
        localStorage.setItem(
          PREV_PREFIX + id,
          superseded
        );
        rolled = true;
      } catch {
        console.error(
          "lipu-sitelen-wawa: failed to roll prev " +
            `for doc "${id}"`
        );
      }
      if (
        !rolled &&
        !quarantineRaw(id, superseded)
      ) {
        console.error(
          "lipu-sitelen-wawa: could not preserve " +
            `the pre-open lipu value for doc "${id}"; ` +
            "leaving it in place (the mirror carries " +
            "this save; the next load recovers it)"
        );
        return false;
      }
    }
  }

  try {
    localStorage.setItem(
      LIPU_PREFIX + id,
      JSON.stringify({
        version: 2,
        blocks: lipu.blocks,
        savedAt: Date.now(),
        mirrorHash: hashMirror(mirrorJson),
        // Every save by a provenance-aware
        // build is fully classified already (the live
        // model's marks are authoritative) — the load
        // boundary must not re-run classifyProvenance
        // over them.
        classified: true,
      })
    );
  } catch {
    console.error(
      "lipu-sitelen-wawa: failed to write lipu " +
        `value for doc "${id}"`
    );
    return false;
  }
  return true;
}

export function removeDoc(id: string): void {
  const index = loadIndex().filter(
    (e) => e.id !== id
  );
  saveIndex(index);
  localStorage.removeItem(DOC_PREFIX + id);
  localStorage.removeItem(LIPU_PREFIX + id);
  localStorage.removeItem(PREV_PREFIX + id);
}

export function getActiveDocId():
  string | null
{
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveDocId(
  id: string
): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function createDoc(): DocEntry {
  const entry: DocEntry = {
    id: crypto.randomUUID(),
    name: "",
    updatedAt: Date.now(),
  };
  const index = loadIndex();
  index.unshift(entry);
  saveIndex(index);
  return entry;
}

export function getFirstLineText(
  content: JSONContent
): string {
  if (!content.content) return "";

  const firstBlock = content.content[0];
  if (!firstBlock || !firstBlock.content) {
    return "";
  }

  return firstBlock.content
    .filter(
      (node) =>
        node.type === "text" && node.text
    )
    .map((node) => node.text!)
    .join("");
}

export function migrate(): void {
  // No-op if index already exists
  if (loadIndex().length > 0) return;

  // No-op if no legacy key
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;

  let legacyContent: JSONContent;
  try {
    legacyContent = JSON.parse(raw) as JSONContent;
  } catch {
    // corrupt legacy data; quarantine, then remove
    // and start fresh. The removal is GATED on the
    // preservation having actually landed (the
    // preserve-before-destroy rule): if
    // quarantineRaw failed (quota), the legacy key
    // stays put and this runs again next init —
    // never delete bytes whose only other copy is an
    // unconfirmed quarantine.
    if (quarantineRaw(LEGACY_KEY, raw)) {
      localStorage.removeItem(LEGACY_KEY);
    }
    return;
  }

  const entry: DocEntry = {
    id: crypto.randomUUID(),
    name: getFirstLineText(legacyContent),
    updatedAt: Date.now(),
  };

  saveIndex([entry]);
  saveDocContent(entry.id, legacyContent);
  setActiveDocId(entry.id);
  localStorage.removeItem(LEGACY_KEY);
}
