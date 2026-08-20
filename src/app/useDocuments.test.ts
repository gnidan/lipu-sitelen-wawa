import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { JSONContent } from "@tiptap/core";
import { useDocuments } from "./useDocuments";
import {
  DOC_PREFIX,
  KEY_PREFIX,
  LATIN_NEWLINE_TRIM_KEY,
  LIPU_FORMAT_KEY,
  LIPU_PREFIX,
  MIRROR_WINS_KEY,
  PREV_PREFIX,
  hashMirror,
  loadDocLipu,
  parseStoredLipu,
  saveIndex,
  saveDocContent,
  setActiveDocId,
  type DocEntry,
} from "./documents";
import * as documentsModule from "./documents";
import * as lipuMigrationModule from "./lipu-migration";
import * as latinNewlineTrimModule
  from "./latin-newline-trim";
import {
  contentToLipu,
  emptyLipu,
  lipuToContent,
} from "../editor/lipu-doc";
import type { Block, Lipu } from "../lipu";
import { pmDoc, glyph } from "../../test/helpers";

function entry(id: string): DocEntry {
  return { id, name: id, updatedAt: 1 };
}

function payloadFor(text: string): {
  lipu: Lipu;
  content: JSONContent;
} {
  const content = pmDoc(text);
  return { lipu: contentToLipu(content), content };
}

/** Real SP glyph char for a word (as lipu-doc.test.ts's
 *  and documents.test.ts's own helpers of the same
 *  name) -- plain ASCII text does NOT parse as a word
 *  anchor, so any fixture that needs
 *  an actual word anchor must go through this. */
/** Total calls so far to the (already file-wide
 *  mocked) console.warn -- used to assert a specific
 *  step warned/did-not-warn without fighting the
 *  outer beforeEach's spy lifecycle. */
function warnCallCount(): number {
  return (
    console.warn as unknown as {
      mock: { calls: unknown[] };
    }
  ).mock.calls.length;
}

/** `vi.spyOn(Storage.prototype, "setItem")` is VACUOUS
 *  in this project's happy-dom environment:
 *  `localStorage.setItem` is an OWN instance property,
 *  not inherited from Storage.prototype, so a prototype
 *  spy never observes a real write and
 *  "not.toHaveBeenCalled()" passes unconditionally, even
 *  on a real regression. Spying the instance directly
 *  works -- proven here with a positive-control write
 *  before the caller trusts a later zero-calls
 *  assertion. */
function spyOnStorageWrites(): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(localStorage, "setItem");
  localStorage.setItem("__spy-control__", "1");
  expect(spy).toHaveBeenCalledTimes(1);
  localStorage.removeItem("__spy-control__");
  spy.mockClear();
  return spy;
}

/** What a dual-write save leaves at lipu:<id>
 *  (mirror-format bytes appear below only
 *  where a test is ABOUT migration input). */
function storedLipuRaw(
  lipu: Lipu,
  mirrorJson: string
): string {
  return JSON.stringify({
    version: 2,
    blocks: lipu.blocks,
    savedAt: 1,
    mirrorHash: hashMirror(mirrorJson),
  });
}

/** Seeds an already-migrated doc: mirror bytes plus
 *  a lipu: value whose recorded hash certifies them,
 *  as if left over from a prior session -- this is
 *  what a fresh doc-open rolls into prev: on its
 *  first save. Returns the stored lipu: raw so tests
 *  compare prev against the exact pre-open bytes. */
function seedMigratedDoc(
  id: string,
  text: string
): string {
  const { lipu } = payloadFor(text);
  const mirrorJson = JSON.stringify(
    lipuToContent(lipu)
  );
  localStorage.setItem(DOC_PREFIX + id, mirrorJson);
  const raw = storedLipuRaw(lipu, mirrorJson);
  localStorage.setItem(LIPU_PREFIX + id, raw);
  return raw;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(
    () => {}
  );
  vi.spyOn(console, "info").mockImplementation(
    () => {}
  );
  vi.spyOn(console, "warn").mockImplementation(
    () => {}
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDocuments: storage passes", () => {
  it(
    "runs migrateToLipu before any " +
      "loadDocLipuClassified read and before any " +
      "save, and the migrated lipu: value (not just " +
      "a fallback derive) is what loads",
    () => {
      // A spy-order assertion alone is weak. This
      // asserts the OUTCOME too: a lipu: value exists
      // and is what the load path actually returns --
      // if a load had snuck in before migration it
      // would have found no lipu: key yet
      // (loadDocLipuClassified still reads through the
      // mirror fallback either way, so a pure
      // call-order check alone could pass even with
      // the ordering broken).
      const content = pmDoc("toki pona");
      saveIndex([entry("a")]);
      setActiveDocId("a");
      localStorage.setItem(
        DOC_PREFIX + "a",
        JSON.stringify(content)
      );

      const migrateSpy = vi.spyOn(
        lipuMigrationModule,
        "migrateToLipu"
      );
      const loadSpy = vi.spyOn(
        documentsModule,
        "loadDocLipuClassified"
      );
      const saveSpy = vi.spyOn(
        documentsModule,
        "saveDocDual"
      );

      const { result } = renderHook(() =>
        useDocuments()
      );

      expect(migrateSpy).toHaveBeenCalled();
      expect(loadSpy).toHaveBeenCalled();
      expect(
        migrateSpy.mock.invocationCallOrder[0]
      ).toBeLessThan(
        loadSpy.mock.invocationCallOrder[0]
      );
      // nothing saved during init at all: the first
      // save can only come from an editor update
      expect(saveSpy).not.toHaveBeenCalled();

      expect(result.current.activeLipu.blocks).toEqual(
        contentToLipu(content).blocks
      );
      expect(
        localStorage.getItem(LIPU_PREFIX + "a")
      ).not.toBeNull();
    }
  );

  it(
    "a doc the strict byte gate skips keeps every " +
      "byte and still reads through the mirror " +
      "fallback",
    () => {
      // Split Latin runs (the trap case):
      // contentToLipu joins them, so the render does
      // not reproduce the stored bytes and the
      // migration must SKIP the doc rather than
      // rewrite its mirror.
      const splitRaw = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "he" },
              { type: "text", text: "llo" },
            ],
          },
        ],
      } as JSONContent;
      saveIndex([entry("a")]);
      saveDocContent("a", splitRaw);
      setActiveDocId("a");

      const { result } = renderHook(() =>
        useDocuments()
      );

      // proves the fixture really fails the gate
      const lipu = contentToLipu(splitRaw);
      expect(
        JSON.stringify(lipuToContent(lipu))
      ).not.toBe(JSON.stringify(splitRaw));

      expect(
        localStorage.getItem(DOC_PREFIX + "a")
      ).toBe(JSON.stringify(splitRaw));
      expect(
        localStorage.getItem(LIPU_PREFIX + "a")
      ).toBeNull();
      // the pass still completes and marks
      expect(
        localStorage.getItem(LIPU_FORMAT_KEY)
      ).not.toBeNull();
      // a skip is not a corruption: nothing is
      // quarantined on this path
      expect(
        Object.keys(localStorage).filter((k) =>
          k.startsWith(KEY_PREFIX + "quarantine:")
        )
      ).toEqual([]);
      expect(
        result.current.activeLipu.blocks
      ).toEqual(lipu.blocks);
    }
  );

  it(
    "runs trimLatinNewlines after migrateToLipu and " +
      "before any loadDocLipuClassified read, and " +
      "the trimmed lipu: value is what loads",
    () => {
      // an already-migrated doc whose gap holds an
      // orphaned latin "\n\n\n" against sp count 1 --
      // the shape a pre-hotfix Enter/delete ratchet
      // session leaves behind
      const word = (w: string) =>
        ({ kind: "word", word: w }) as const;
      const block: Block = {
        anchors: [word("toki")],
        gaps: [
          { sp: "", latin: "" },
          { sp: "\n", latin: "\n\n\n" },
        ],
        spans: [],
      };
      const lipu: Lipu = { version: 2, blocks: [block] };
      const mirrorJson = JSON.stringify(
        lipuToContent(lipu)
      );
      saveIndex([entry("a")]);
      setActiveDocId("a");
      localStorage.setItem(DOC_PREFIX + "a", mirrorJson);
      localStorage.setItem(
        LIPU_PREFIX + "a",
        JSON.stringify({
          version: 2,
          blocks: lipu.blocks,
          savedAt: 1,
          mirrorHash: hashMirror(mirrorJson),
        })
      );

      const trimSpy = vi.spyOn(
        latinNewlineTrimModule,
        "trimLatinNewlines"
      );
      const migrateSpy = vi.spyOn(
        lipuMigrationModule,
        "migrateToLipu"
      );
      const loadSpy = vi.spyOn(
        documentsModule,
        "loadDocLipuClassified"
      );

      const { result } = renderHook(() =>
        useDocuments()
      );

      expect(trimSpy).toHaveBeenCalled();
      expect(
        migrateSpy.mock.invocationCallOrder[0]
      ).toBeLessThan(
        trimSpy.mock.invocationCallOrder[0]
      );
      expect(
        trimSpy.mock.invocationCallOrder[0]
      ).toBeLessThan(
        loadSpy.mock.invocationCallOrder[0]
      );

      expect(
        result.current.activeLipu.blocks[0].gaps[1]
      ).toEqual({ sp: "\n", latin: "\n" });
      const stored = parseStoredLipu(
        localStorage.getItem(LIPU_PREFIX + "a")!
      )!;
      expect(stored.blocks[0].gaps[1]).toEqual({
        sp: "\n",
        latin: "\n",
      });
      expect(
        localStorage.getItem(LATIN_NEWLINE_TRIM_KEY)
      ).not.toBeNull();
    }
  );
});

describe(
  "useDocuments: switchDocument same-id guard",
  () => {
    it("same-id switch is a no-op", () => {
      saveIndex([entry("a")]);
      setActiveDocId("a");
      const seedRaw = seedMigratedDoc("a", "seed");
      const { result } = renderHook(() =>
        useDocuments()
      );

      act(() => {
        result.current.savePayload(payloadFor("wan"));
      });
      expect(
        localStorage.getItem(PREV_PREFIX + "a")
      ).toBe(seedRaw);

      act(() => {
        result.current.switchDocument("a");
      });

      act(() => {
        result.current.savePayload(payloadFor("tu"));
      });
      // A same-id switch must not clear the roll flag
      // -- prev still holds the pre-open baseline, not
      // an intermediate save, proving no re-roll
      // happened.
      expect(
        localStorage.getItem(PREV_PREFIX + "a")
      ).toBe(seedRaw);
    });
  }
);

describe("useDocuments: activeLipu fallback", () => {
  it(
    "falls back to emptyLipu when no doc content " +
      "exists",
    () => {
      const { result } = renderHook(() =>
        useDocuments()
      );
      // A fresh app auto-creates a doc with no
      // content yet.
      expect(result.current.activeLipu).toEqual(
        emptyLipu()
      );
    }
  );
});

describe("useDocuments: savePayload prev-roll", () => {
  it(
    "rolls prev once per doc-open across " +
      "multiple saves",
    () => {
      saveIndex([entry("a")]);
      setActiveDocId("a");
      const seedRaw = seedMigratedDoc("a", "seed");
      const { result } = renderHook(() =>
        useDocuments()
      );
      expect(result.current.activeId).toBe("a");

      act(() => {
        result.current.savePayload(payloadFor("wan"));
      });
      // First save of the open: rolls the
      // pre-existing (seed) lipu: value into prev.
      expect(
        localStorage.getItem(PREV_PREFIX + "a")
      ).toBe(seedRaw);

      act(() => {
        result.current.savePayload(payloadFor("tu"));
      });
      // Second save in the same doc-open must not
      // roll again -- prev still holds the seed.
      expect(
        localStorage.getItem(PREV_PREFIX + "a")
      ).toBe(seedRaw);
    }
  );

  it(
    "rolls again after switching away and back " +
      "to a doc",
    () => {
      saveIndex([entry("a")]);
      setActiveDocId("a");
      const seedRaw = seedMigratedDoc("a", "seed");
      const { result } = renderHook(() =>
        useDocuments()
      );

      act(() => {
        result.current.savePayload(payloadFor("wan"));
      });
      expect(
        localStorage.getItem(PREV_PREFIX + "a")
      ).toBe(seedRaw);

      let idB = "";
      act(() => {
        idB = result.current.createDocument();
      });
      expect(result.current.activeId).toBe(idB);

      act(() => {
        result.current.switchDocument("a");
      });
      expect(result.current.activeId).toBe("a");

      // the value "a" carries at re-open time: the
      // lipu: left by the first save
      const reopenedRaw = localStorage.getItem(
        LIPU_PREFIX + "a"
      )!;

      act(() => {
        result.current.savePayload(payloadFor("tu"));
      });
      // Re-opening "a" reset its roll tracking, so
      // this save rolls again -- this time from
      // "wan" (the lipu: left by the first save),
      // not "seed".
      expect(
        localStorage.getItem(PREV_PREFIX + "a")
      ).toBe(reopenedRaw);
      expect(
        JSON.parse(
          localStorage.getItem(PREV_PREFIX + "a")!
        ).blocks
      ).toEqual(payloadFor("wan").lipu.blocks);
    }
  );

  it(
    "does NOT retire the roll when the baseline " +
      "could not be preserved: the next autosave " +
      "retries and converges once quota heals",
    () => {
      // The realistic quota shape: NEW keys (prev:,
      // quarantine:) are refused while overwrites of
      // existing keys (doc:, lipu:) still succeed. If
      // the caller recorded the roll anyway, the
      // second autosave would run with rollPrev false
      // and overwrite the never-copied baseline.
      saveIndex([entry("a")]);
      setActiveDocId("a");
      const seedRaw = seedMigratedDoc("a", "seed");
      const { result } = renderHook(() =>
        useDocuments()
      );

      const original =
        localStorage.setItem.bind(localStorage);
      const setSpy = vi
        .spyOn(localStorage, "setItem")
        .mockImplementation((key, value) => {
          if (
            key.startsWith(PREV_PREFIX) ||
            key.startsWith(
              KEY_PREFIX + "quarantine:"
            )
          ) {
            throw new Error("quota exceeded");
          }
          original(key, value);
        });

      act(() => {
        result.current.savePayload(payloadFor("wan"));
      });
      // the baseline is untouched in its own key
      expect(
        localStorage.getItem(LIPU_PREFIX + "a")
      ).toBe(seedRaw);

      act(() => {
        result.current.savePayload(payloadFor("tu"));
      });
      // THE PIN: a second autosave in the same
      // session must take the RETRY path, not the
      // already-rolled skip path
      expect(
        localStorage.getItem(LIPU_PREFIX + "a")
      ).toBe(seedRaw);
      expect(
        localStorage.getItem(PREV_PREFIX + "a")
      ).toBeNull();

      setSpy.mockRestore();

      act(() => {
        result.current.savePayload(
          payloadFor("mute")
        );
      });
      // quota healed: the roll finally lands and the
      // save completes
      expect(
        localStorage.getItem(PREV_PREFIX + "a")
      ).toBe(seedRaw);
      expect(
        JSON.parse(
          localStorage.getItem(LIPU_PREFIX + "a")!
        ).blocks
      ).toEqual(payloadFor("mute").lipu.blocks);
    }
  );

  it(
    "keeps the active doc's roll flag when deleting " +
      "an unrelated doc (regression: deleting a doc " +
      "other than the active one is not a doc-open " +
      "transition for the still-open doc)",
    () => {
      saveIndex([entry("a"), entry("b")]);
      setActiveDocId("a");
      const seedRaw = seedMigratedDoc("a", "seed");

      const { result } = renderHook(() =>
        useDocuments()
      );
      expect(result.current.activeId).toBe("a");

      act(() => {
        result.current.savePayload(payloadFor("wan"));
      });
      expect(
        localStorage.getItem(PREV_PREFIX + "a")
      ).toBe(seedRaw);

      act(() => {
        result.current.deleteDocument("b");
      });
      // "a" stayed continuously open -- deleting the
      // unrelated "b" must not count as a doc-open.
      expect(result.current.activeId).toBe("a");

      act(() => {
        result.current.savePayload(payloadFor("tu"));
      });
      // Must NOT roll again: prev still holds the
      // pre-open baseline ("seed"), not the
      // intermediate "wan".
      expect(
        localStorage.getItem(PREV_PREFIX + "a")
      ).toBe(seedRaw);
    }
  );
});

describe("storage end-to-end", () => {
  it(
    "production-shaped collection: seeds index + two " +
      "mirror-only docs (one with a hardBreak), inits " +
      "via renderHook, and mints both lipu: values " +
      "without touching either mirror",
    () => {
      const breakMirror: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: glyph("toki") },
              { type: "hardBreak" },
              { type: "text", text: glyph("pona") },
            ],
          },
        ],
      };
      const plainMirror = pmDoc(glyph("toki"));
      const breakRaw = JSON.stringify(breakMirror);
      const plainRaw = JSON.stringify(plainMirror);

      saveIndex([entry("a"), entry("b")]);
      localStorage.setItem(DOC_PREFIX + "a", breakRaw);
      localStorage.setItem(DOC_PREFIX + "b", plainRaw);
      setActiveDocId("a");

      const { result, unmount } = renderHook(() =>
        useDocuments()
      );

      // both lipu: keys minted
      expect(
        localStorage.getItem(LIPU_PREFIX + "a")
      ).not.toBeNull();
      expect(
        localStorage.getItem(LIPU_PREFIX + "b")
      ).not.toBeNull();

      // BYTE-identical to the seeded strings -- the
      // pass never touches an existing mirror
      expect(
        localStorage.getItem(DOC_PREFIX + "a")
      ).toBe(breakRaw);
      expect(
        localStorage.getItem(DOC_PREFIX + "b")
      ).toBe(plainRaw);

      expect(result.current.activeLipu).toEqual(
        contentToLipu(breakMirror)
      );

      // Companion subsumption: the migrated doc's
      // gap.latin
      // carries the break's companion "\n" -- derived
      // from the real converter's own output, not a
      // hand-predicted gap index (standing caveat)
      const brokenLipu = contentToLipu(breakMirror);
      const companionGap = brokenLipu.blocks[0].gaps.find(
        (g) => g.sp.includes("\n")
      );
      expect(companionGap).toBeDefined();
      expect(companionGap!.latin).toBe("\n");
      const storedA = JSON.parse(
        localStorage.getItem(LIPU_PREFIX + "a")!
      );
      expect(storedA.blocks).toEqual(brokenLipu.blocks);

      // marker report present with fromMirror: 2
      const marker = JSON.parse(
        localStorage.getItem(LIPU_FORMAT_KEY)!
      );
      expect(marker.fromMirror).toBe(2);

      unmount();
    }
  );

  it(
    "old-build round trip: an old production build's " +
      "mirror overwrite wins on the next mount, " +
      "preserves the superseded lipu: byte-exactly, " +
      "and converges cleanly on the next save",
    () => {
      const first = renderHook(() => useDocuments());
      const activeId = first.result.current.activeId;

      act(() => {
        first.result.current.savePayload(
          payloadFor("toki")
        );
      });
      const preOverwriteRaw = localStorage.getItem(
        LIPU_PREFIX + activeId
      )!;
      expect(preOverwriteRaw).not.toBeNull();

      first.unmount();

      // simulate an old production build: it never
      // reads/writes lipu:, only the mirror
      const oldBuildMirror = JSON.stringify(
        lipuToContent(contentToLipu(pmDoc("sina")))
      );
      localStorage.setItem(
        DOC_PREFIX + activeId,
        oldBuildMirror
      );

      const second = renderHook(() => useDocuments());

      // activeLipu shows the mirror's content (the
      // "sina" anchor: plain ASCII parses as a single
      // verbatim anchor -- the
      // full-content compare below is the real pin)
      expect(second.result.current.activeLipu).toEqual(
        contentToLipu(pmDoc("sina"))
      );
      // the superseded lipu: raw is preserved
      // byte-exactly: prev: was empty at detection
      // time (this doc's very first save never rolled
      // anything), so preservation lands it in prev:
      // here -- NOT quarantine (an empty prev: slot
      // takes the value directly)
      expect(
        localStorage.getItem(PREV_PREFIX + activeId)
      ).toBe(preOverwriteRaw);
      expect(
        JSON.parse(
          localStorage.getItem(MIRROR_WINS_KEY)!
        ).count
      ).toBe(1);

      // first save after mirror-wins: a coherent
      // lipu+content pair derived from the now-live
      // (mirror-won) model
      act(() => {
        second.result.current.savePayload({
          lipu: second.result.current.activeLipu,
          content: lipuToContent(
            second.result.current.activeLipu
          ),
        });
      });
      const newMirror = localStorage.getItem(
        DOC_PREFIX + activeId
      )!;
      const newRaw = localStorage.getItem(
        LIPU_PREFIX + activeId
      )!;
      expect(JSON.parse(newRaw).mirrorHash).toBe(
        hashMirror(newMirror)
      );

      const lipuAfterSave =
        second.result.current.activeLipu;
      second.unmount();

      // recovery converges: a fresh load returns the
      // saved content with no warns
      const warnBefore = warnCallCount();
      const freshLoad = loadDocLipu(activeId);
      expect(freshLoad).toEqual(lipuAfterSave);
      expect(warnCallCount()).toBe(warnBefore);
    }
  );

  it(
    "strict-skip doc lifecycle: a non-round-tripping " +
      "mirror is skipped by the migration, loads via " +
      "the mirror fallback, mints lipu: on its first " +
      "save, and reloads from lipu: hash-clean next " +
      "init",
    () => {
      // Split Latin runs (same fixture family as the
      // byte-gate test above): contentToLipu always joins
      // adjacent same-mark text nodes on render, so
      // this never reproduces its own stored bytes.
      const splitRaw: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "he" },
              { type: "text", text: "llo" },
            ],
          },
        ],
      };
      // premise, asserted honestly rather than assumed
      expect(
        JSON.stringify(
          lipuToContent(contentToLipu(splitRaw))
        )
      ).not.toBe(JSON.stringify(splitRaw));

      saveIndex([entry("a")]);
      saveDocContent("a", splitRaw);
      setActiveDocId("a");

      const first = renderHook(() => useDocuments());

      // init -> no lipu: key; the doc loads via the
      // mirror fallback
      expect(
        localStorage.getItem(LIPU_PREFIX + "a")
      ).toBeNull();
      expect(
        localStorage.getItem(DOC_PREFIX + "a")
      ).toBe(JSON.stringify(splitRaw));
      expect(first.result.current.activeLipu).toEqual(
        contentToLipu(splitRaw)
      );

      // savePayload for it -> lipu: minted
      act(() => {
        first.result.current.savePayload({
          lipu: first.result.current.activeLipu,
          content: lipuToContent(
            first.result.current.activeLipu
          ),
        });
      });
      const mintedRaw = localStorage.getItem(
        LIPU_PREFIX + "a"
      );
      expect(mintedRaw).not.toBeNull();
      const mintedMirror = localStorage.getItem(
        DOC_PREFIX + "a"
      )!;
      expect(JSON.parse(mintedRaw!).mirrorHash).toBe(
        hashMirror(mintedMirror)
      );

      first.unmount();

      // second init: migration marker already set
      // (this doc stays in the `skipped` list forever,
      // but the pass itself is a no-op); the doc now
      // loads from lipu:, hash-clean -- a clean load
      // writes nothing at all
      const setSpy = spyOnStorageWrites();
      const second = renderHook(() => useDocuments());
      expect(setSpy).not.toHaveBeenCalled();
      setSpy.mockRestore();

      expect(
        JSON.stringify(second.result.current.activeLipu)
      ).toBe(
        JSON.stringify({
          version: 2,
          blocks: JSON.parse(mintedRaw!).blocks,
        })
      );

      second.unmount();
    }
  );

  // Downgrade note (not a test: the pre-flip
  // build is not importable from this tree). A
  // pre-flip build ignores lipu: keys entirely -- it
  // never reads or writes LIPU_PREFIX -- and reads the
  // mirror fallback exactly as loadDocContent does
  // today; on save it rewrites the mirror via its own
  // renderer. The NEXT run of a flipped build's
  // loadDocLipu after such a downgrade-then-upgrade
  // sees a hash-stale mirror ONLY IF the pre-flip build
  // actually changed it (its own save path always
  // rewrites the mirror, so any edit made under the
  // downgraded build stales the recorded hash) --
  // mirror-wins by construction, recovering exactly as
  // the old-build round trip above does. A downgrade
  // with no edits leaves the mirror hash-matching, and
  // the next flipped load reads lipu: untouched.
});
