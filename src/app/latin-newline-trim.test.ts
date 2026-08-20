import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { trimLatinNewlines } from "./latin-newline-trim";
import {
  DOC_PREFIX,
  LATIN_NEWLINE_TRIM_KEY,
  LIPU_PREFIX,
  PREV_PREFIX,
  hashMirror,
  loadIndex,
  parseStoredLipu,
  saveIndex,
  type DocEntry,
} from "./documents";
import { lipuToContent } from "../editor/lipu-doc";
import type { Block, Lipu } from "../lipu";

function entry(id: string): DocEntry {
  return { id, name: id, updatedAt: 1 };
}

const word = (w: string) =>
  ({ kind: "word", word: w }) as const;

/** A single-block Lipu with one word anchor and a
 *  trailing gap holding the given sp/latin newline
 *  content directly — the shape a pre-hotfix ratchet
 *  session leaves behind (latin "\n" count beyond the
 *  sp "\n" count). */
function orphanedLipu(sp: string, latin: string): Lipu {
  const block: Block = {
    anchors: [word("toki")],
    gaps: [{ sp: "", latin: "" }, { sp, latin }],
    spans: [],
  };
  return { version: 2, blocks: [block] };
}

/** Seeds storage as if a prior (pre-hotfix) session
 *  had already saved `lipu` through the normal dual
 *  write — mirror and lipu: value hash-consistent, as
 *  saveDocDual would leave them. `classified`:
 *  when true, the seeded lipu:
 *  value carries `classified: true`, the shape a
 *  provenance-aware build's own save (or an earlier,
 *  partially-completed run of this very trim pass)
 *  leaves behind. Defaults false (pre-provenance /
 *  never-flagged), the original behavior every
 *  existing call site relies on. */
function seedLipuDoc(
  id: string,
  lipu: Lipu,
  classified = false
): void {
  saveIndex([...loadIndex(), entry(id)]);
  const mirrorJson = JSON.stringify(
    lipuToContent(lipu)
  );
  localStorage.setItem(DOC_PREFIX + id, mirrorJson);
  localStorage.setItem(
    LIPU_PREFIX + id,
    JSON.stringify({
      version: 2,
      blocks: lipu.blocks,
      savedAt: 1,
      mirrorHash: hashMirror(mirrorJson),
      ...(classified ? { classified: true } : {}),
    })
  );
}

/** A two-anchor Lipu combining BOTH hazards the
 *  classify gate exists for, in one doc: gap 1 is a
 *  derived-punctuation image (latin ". ", UNMARKED
 *  — exactly what the SP=>Latin derivation leaves
 *  behind, non-default-LOOKING bytes but a genuinely
 *  default gap); gap 2 is un-trimmed legacy newline
 *  debt (latin "\n\n\n" against sp "\n" — budget 1,
 *  excess 2), the same shape orphanedLipu builds. */
function flaggedDebtLipu(): Lipu {
  const block: Block = {
    anchors: [word("toki"), word("pona")],
    gaps: [
      { sp: "", latin: "" },
      { sp: "", latin: ". " },
      { sp: "\n", latin: "\n\n\n" },
    ],
    spans: [],
  };
  return { version: 2, blocks: [block] };
}

function storedLipu(id: string): Lipu {
  const raw = parseStoredLipu(
    localStorage.getItem(LIPU_PREFIX + id)!
  )!;
  return { version: 2, blocks: raw.blocks };
}

function report(): {
  v: number;
  at: number;
  trimmed: number;
  docs: number;
} {
  return JSON.parse(
    localStorage.getItem(LATIN_NEWLINE_TRIM_KEY)!
  );
}

/** vi.spyOn(Storage.prototype, "setItem") is vacuous
 *  in this project's happy-dom environment --
 *  localStorage.setItem is an own instance property,
 *  not inherited, so a prototype spy never observes a
 *  real write. Spy the instance, proven with a
 *  positive-control write before the caller trusts a
 *  later zero-calls assertion (mirrored from
 *  useDocuments.test.ts's spyOnStorageWrites). */
function spyOnStorageWrites(): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(localStorage, "setItem");
  localStorage.setItem("__spy-control__", "1");
  expect(spy).toHaveBeenCalledTimes(1);
  localStorage.removeItem("__spy-control__");
  spy.mockClear();
  return spy;
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  errorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("trimLatinNewlines: caps orphaned latin " +
         "'\\n's at the sp count", () => {
  it("latin '\\n\\n\\n' against sp count 1 is " +
     "trimmed to 1 through a real run; the marker " +
     "is set", () => {
    seedLipuDoc("a", orphanedLipu("\n", "\n\n\n"));

    trimLatinNewlines();

    expect(
      storedLipu("a").blocks[0].gaps[1]
    ).toEqual({ sp: "\n", latin: "\n" });
    expect(report()).toMatchObject({
      v: 1,
      trimmed: 2,
      docs: 1,
    });
  });

  it("trims TRAILING-MOST first, not leading-most: " +
     "a DEFAULT " +
     "gap can mix spaces and newlines, so this " +
     "still discriminates removeTrailingNewlines' " +
     "order even though letter-content fixtures " +
     "now classify AUTHORED and skip the pass", () => {
    // latin "\n \n\n" with sp "\n": budget 1, excess
    // 2. trailing-most-first => "\n "; a
    // leading-most-first bug would give " \n".
    seedLipuDoc("t", orphanedLipu("\n", "\n \n\n"));

    trimLatinNewlines();

    expect(
      storedLipu("t").blocks[0].gaps[1]
    ).toEqual({ sp: "\n", latin: "\n " });
  });

  it("a healthy doc (latin '\\n' count already at " +
     "or under its sp count) is left untouched", () => {
    seedLipuDoc("h", orphanedLipu("\n\n", "\n"));
    const before = localStorage.getItem(
      LIPU_PREFIX + "h"
    );

    trimLatinNewlines();

    expect(localStorage.getItem(LIPU_PREFIX + "h")).toBe(
      before
    );
    expect(report()).toMatchObject({
      trimmed: 0,
      docs: 0,
    });
  });

  it("leaves a doc with real letter content " +
     "untouched (it classifies AUTHORED at the " +
     "boundary) while a plain-newline " +
     "doc in the same pass still trims", () => {
    // EXPECTATION CHANGE (from the mark gating):
    // before
    // gating, this fixture's "x\n\n\ny" was trimmed to
    // "xy" on the (unfounded) assumption that every
    // excess latin "\n" beyond the sp budget is a
    // stale creation default, never user content. The
    // gap contains real letters, so classifyProvenance
    // now marks it AUTHORED at the boundary (same rule
    // the punctuation test below pins), and
    // capLatinNewlines skips an authored side outright
    // -- trimming an authored gap's trailing "\n"s
    // would risk deleting deliberately-typed content,
    // exactly the bug the gating fixed. docTrimmed stays
    // 0 for doc "a", so it is never re-saved.
    seedLipuDoc("a", orphanedLipu("", "x\n\n\ny"));
    seedLipuDoc("b", orphanedLipu("\n", "\n\n\n"));

    trimLatinNewlines();

    expect(
      storedLipu("a").blocks[0].gaps[1]
    ).toEqual({ sp: "", latin: "x\n\n\ny" });
    expect(
      storedLipu("b").blocks[0].gaps[1]
    ).toEqual({ sp: "\n", latin: "\n" });
  });
});

describe("trimLatinNewlines: marker idempotence", () => {
  it("a second run performs zero writes (spied on " +
     "the instance, positive-controlled)", () => {
    seedLipuDoc("a", orphanedLipu("\n", "\n\n\n"));
    trimLatinNewlines();
    expect(
      localStorage.getItem(LATIN_NEWLINE_TRIM_KEY)
    ).not.toBeNull();

    const setItemSpy = spyOnStorageWrites();
    trimLatinNewlines();

    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("a doc that fails to load is skipped, never " +
     "aborts the pass", () => {
    saveIndex([entry("bad"), entry("a")]);
    localStorage.setItem(
      LIPU_PREFIX + "bad",
      "not json"
    );
    seedLipuDoc("a", orphanedLipu("\n", "\n\n\n"));

    trimLatinNewlines();

    expect(
      storedLipu("a").blocks[0].gaps[1]
    ).toEqual({ sp: "\n", latin: "\n" });
    expect(
      localStorage.getItem(LATIN_NEWLINE_TRIM_KEY)
    ).not.toBeNull();
  });

  it("the marker is set even when zero docs need " +
     "trimming", () => {
    seedLipuDoc("h", orphanedLipu("\n\n", "\n"));

    trimLatinNewlines();

    expect(report()).toMatchObject({
      v: 1,
      trimmed: 0,
      docs: 0,
    });
  });
});

describe("trimLatinNewlines: quota interruption " +
         "retries", () => {
  it("a throw on the first doc's mirror write " +
     "leaves no marker and destroys nothing; a " +
     "retry converges", () => {
    seedLipuDoc("a", orphanedLipu("\n", "\n\n\n"));
    const rawMirrorBefore = localStorage.getItem(
      DOC_PREFIX + "a"
    );
    const rawLipuBefore = localStorage.getItem(
      LIPU_PREFIX + "a"
    );

    const original =
      localStorage.setItem.bind(localStorage);
    const setItemSpy = vi
      .spyOn(localStorage, "setItem")
      .mockImplementation((key, value) => {
        if (key === DOC_PREFIX + "a") {
          throw new Error("quota exceeded");
        }
        original(key, value);
      });

    trimLatinNewlines();

    expect(
      localStorage.getItem(LATIN_NEWLINE_TRIM_KEY)
    ).toBeNull();
    // nothing partially destroyed by the abort
    expect(localStorage.getItem(DOC_PREFIX + "a")).toBe(
      rawMirrorBefore
    );
    expect(localStorage.getItem(LIPU_PREFIX + "a")).toBe(
      rawLipuBefore
    );

    setItemSpy.mockRestore();

    trimLatinNewlines();

    expect(
      localStorage.getItem(LATIN_NEWLINE_TRIM_KEY)
    ).not.toBeNull();
    expect(
      storedLipu("a").blocks[0].gaps[1]
    ).toEqual({ sp: "\n", latin: "\n" });
  });
});

describe("trimLatinNewlines: mirror stays " +
         "consistent", () => {
  it("after trimming, the mirror equals " +
     "JSON.stringify(lipuToContent(stored lipu)) " +
     "and mirrorHash matches", () => {
    seedLipuDoc("a", orphanedLipu("\n", "\n\n\n"));

    trimLatinNewlines();

    const lipu = storedLipu("a");
    const mirrorRaw = localStorage.getItem(
      DOC_PREFIX + "a"
    )!;
    expect(mirrorRaw).toBe(
      JSON.stringify(lipuToContent(lipu))
    );
    const stored = parseStoredLipu(
      localStorage.getItem(LIPU_PREFIX + "a")!
    )!;
    expect(stored.mirrorHash).toBe(
      hashMirror(mirrorRaw)
    );
  });
});

describe("trimLatinNewlines: authored latin is " +
         "never trimmed", () => {
  it("punctuated latin content classifies " +
     "AUTHORED at the boundary and is never " +
     "trimmed", () => {
    seedLipuDoc("p", orphanedLipu("", ".\n\n"));

    trimLatinNewlines();

    // untrimmed => the doc was not re-saved; the
    // stored bytes are the seeded ones
    expect(
      storedLipu("p").blocks[0].gaps[1].latin
    ).toBe(".\n\n");
    expect(report()).toMatchObject({
      v: 1,
      trimmed: 0,
      docs: 0,
    });
  });
});

describe("trimLatinNewlines: does not roll prev:", () => {
  it("a pre-existing prev:<id> (a real recovery " +
     "point from a past edit session) survives " +
     "byte-identical after trimming a doc that " +
     "needed it", () => {
    seedLipuDoc("a", orphanedLipu("\n", "\n\n\n"));
    const priorRecovery = "arbitrary distinct bytes " +
      "from a past edit session";
    localStorage.setItem(
      PREV_PREFIX + "a",
      priorRecovery
    );

    trimLatinNewlines();

    // the doc really was trimmed -- this isn't a
    // no-op skip masking the assertion below
    expect(
      storedLipu("a").blocks[0].gaps[1]
    ).toEqual({ sp: "\n", latin: "\n" });
    expect(localStorage.getItem(PREV_PREFIX + "a")).toBe(
      priorRecovery
    );
  });
});

describe("trimLatinNewlines: classify gate on " +
         "flagged payloads", () => {
  it(
    "a FLAGGED payload with un-trimmed newline debt " +
      "AND an unmarked derived-punctuation gap, hit " +
      "on a quota-interrupted RETRY: the default " +
      "mark SURVIVES and the debt still trims",
    () => {
      // "z" precedes "a" in the index and its write
      // is made to throw, so round 1 aborts BEFORE
      // "a" is ever reached (no marker written) --
      // the exact quota-interruption shape the
      // existing retry test above models. "a" is
      // seeded ALREADY classified: true (a prior
      // provenance-aware save, or an earlier partial
      // run of this pass) with debt still present.
      seedLipuDoc("z", orphanedLipu("\n", "\n\n\n"));
      seedLipuDoc("a", flaggedDebtLipu(), true);

      const original =
        localStorage.setItem.bind(localStorage);
      const setItemSpy = vi
        .spyOn(localStorage, "setItem")
        .mockImplementation((key, value) => {
          if (key === DOC_PREFIX + "z") {
            throw new Error("quota exceeded");
          }
          original(key, value);
        });

      trimLatinNewlines(); // round 1: aborts on "z"

      expect(
        localStorage.getItem(LATIN_NEWLINE_TRIM_KEY)
      ).toBeNull();
      // "a" untouched by round 1
      expect(
        storedLipu("a").blocks[0].gaps[1].latinAuthored
      ).toBeUndefined();

      setItemSpy.mockRestore();

      trimLatinNewlines(); // retry: "z" now succeeds,
      // "a" is reached for the first time

      expect(
        localStorage.getItem(LATIN_NEWLINE_TRIM_KEY)
      ).not.toBeNull();

      const aGaps = storedLipu("a").blocks[0].gaps;
      // MARK SURVIVES: without the gate, classifyProvenance
      // would re-run over this already-flagged payload and
      // stamp gap 1's derived ". " AUTHORED (looksDefault
      // is false for it) -- exactly the re-classification
      // bug surviving through the trim path.
      expect(aGaps[1].latinAuthored).toBeUndefined();
      expect(aGaps[1].latin).toBe(". ");
      // the debt STILL trims -- the gate does not
      // disable capLatinNewlines itself (already
      // mark-gated, independently of this gate)
      expect(aGaps[2]).toEqual({ sp: "\n", latin: "\n" });
    }
  );
});
