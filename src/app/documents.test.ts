import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  loadIndex,
  saveIndex,
  loadDocContent,
  saveDocContent,
  removeDoc,
  getActiveDocId,
  setActiveDocId,
  createDoc,
  getFirstLineText,
  migrate,
  loadDocLipu,
  loadDocLipuClassified,
  saveDocDual,
  hashMirror,
  parseStoredLipu,
  KEY_PREFIX,
  DOC_PREFIX,
  LIPUDOC_PREFIX,
  LIPU_PREFIX,
  MIRROR_WINS_KEY,
  PREV_PREFIX,
} from "./documents";
import {
  contentToLipu,
  lipuToContent,
  loadNormalizeLipu,
} from "../editor/lipu-doc";
import type { Lipu } from "../lipu";
import {
  emptyBlock,
  mergeSpBlock,
  parseSp,
  spInlinesFromText,
} from "../lipu";
import { MIDDLE_DOT_CH } from "../lipu/chars";
import { glyph, pmDoc } from "../../test/helpers";

/** What a dual-write save writes to lipu:<id>: the
 *  `lipu:<id>` value holds the
 *  blocks plus the hash of the mirror bytes as
 *  written, and `lipudoc:` is retired — no fixture in
 *  this file writes retired-format bytes except where
 *  a test is explicitly about the retirement. */
function storedLipu(
  lipu: Lipu,
  mirrorJson: string,
  savedAt = 1
) {
  return {
    version: 2 as const,
    blocks: lipu.blocks,
    savedAt,
    mirrorHash: hashMirror(mirrorJson),
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("loadIndex / saveIndex", () => {
  it("returns empty array when nothing stored",
    () => {
      expect(loadIndex()).toEqual([]);
    }
  );

  it("round-trips entries", () => {
    const entries = [
      {
        id: "a",
        name: "doc-a",
        updatedAt: 100,
      },
      {
        id: "b",
        name: "doc-b",
        updatedAt: 200,
      },
    ];
    saveIndex(entries);
    expect(loadIndex()).toEqual(entries);
  });

  it("returns empty array on corrupt data",
    () => {
      localStorage.setItem(
        "lipu-sitelen-wawa:doc-index",
        "not json"
      );
      expect(loadIndex()).toEqual([]);
    }
  );

  it("returns empty array on non-array JSON",
    () => {
      localStorage.setItem(
        "lipu-sitelen-wawa:doc-index",
        '{"not": "array"}'
      );
      expect(loadIndex()).toEqual([]);
    }
  );
});

describe("loadDocContent / saveDocContent",
  () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it("returns undefined when nothing stored",
      () => {
        expect(
          loadDocContent("x")
        ).toBeUndefined();
      }
    );

    it("round-trips content", () => {
      const content: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "hello" },
            ],
          },
        ],
      };
      saveDocContent("x", content);
      expect(
        loadDocContent("x")
      ).toEqual(content);
    });

    it("returns undefined on corrupt data",
      () => {
        localStorage.setItem(
          "lipu-sitelen-wawa:doc:x",
          "bad"
        );
        expect(
          loadDocContent("x")
        ).toBeUndefined();
      }
    );

    it(
      "quarantines corrupt data instead of " +
        "losing it",
      () => {
        localStorage.setItem(
          "lipu-sitelen-wawa:doc:x",
          "bad"
        );

        expect(
          loadDocContent("x")
        ).toBeUndefined();

        // original key untouched
        expect(
          localStorage.getItem(
            "lipu-sitelen-wawa:doc:x"
          )
        ).toBe("bad");

        const quarantineKeys = Object.keys(
          localStorage
        ).filter((k) =>
          k.startsWith(
            "lipu-sitelen-wawa:quarantine:x:"
          )
        );
        expect(quarantineKeys).toHaveLength(1);
        expect(
          localStorage.getItem(quarantineKeys[0])
        ).toBe("bad");
        expect(errorSpy).toHaveBeenCalledTimes(1);
      }
    );

    it(
      "creates no quarantine key for valid data",
      () => {
        saveDocContent("x", { type: "doc" });
        loadDocContent("x");

        const quarantineKeys = Object.keys(
          localStorage
        ).filter((k) =>
          k.startsWith(
            "lipu-sitelen-wawa:quarantine:"
          )
        );
        expect(quarantineKeys).toHaveLength(0);
      }
    );
  }
);

describe("removeDoc", () => {
  it("removes from index and content", () => {
    saveIndex([
      { id: "a", name: "", updatedAt: 1 },
      { id: "b", name: "", updatedAt: 2 },
    ]);
    saveDocContent("a", { type: "doc" });
    saveDocContent("b", { type: "doc" });

    removeDoc("a");

    expect(loadIndex()).toEqual([
      { id: "b", name: "", updatedAt: 2 },
    ]);
    expect(
      loadDocContent("a")
    ).toBeUndefined();
    expect(loadDocContent("b")).toEqual({
      type: "doc",
    });
  });

  it(
    "clears lipu and prev keys too",
    () => {
      saveIndex([
        { id: "a", name: "", updatedAt: 1 },
      ]);
      saveDocContent("a", { type: "doc" });
      localStorage.setItem(
        LIPU_PREFIX + "a",
        "{}"
      );
      localStorage.setItem(
        PREV_PREFIX + "a",
        "{}"
      );

      removeDoc("a");

      expect(
        localStorage.getItem(LIPU_PREFIX + "a")
      ).toBeNull();
      expect(
        localStorage.getItem(PREV_PREFIX + "a")
      ).toBeNull();
    }
  );
});

describe("getActiveDocId / setActiveDocId",
  () => {
    it("returns null when nothing stored",
      () => {
        expect(
          getActiveDocId()
        ).toBeNull();
      }
    );

    it("round-trips id", () => {
      setActiveDocId("abc");
      expect(getActiveDocId()).toBe("abc");
    });
  }
);

describe("createDoc", () => {
  it("generates unique IDs", () => {
    const a = createDoc();
    const b = createDoc();
    expect(a.id).not.toBe(b.id);
  });

  it("adds to beginning of index", () => {
    const a = createDoc();
    const b = createDoc();
    const index = loadIndex();
    expect(index[0].id).toBe(b.id);
    expect(index[1].id).toBe(a.id);
  });

  it("creates entry with empty name", () => {
    const entry = createDoc();
    expect(entry.name).toBe("");
    expect(entry.updatedAt).toBeGreaterThan(0);
  });
});

describe("getFirstLineText", () => {
  it("extracts text from first paragraph",
    () => {
      const content: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "\u{F1978}\u{F196E}",
              },
            ],
          },
        ],
      };
      expect(
        getFirstLineText(content)
      ).toBe("\u{F1978}\u{F196E}");
    }
  );

  it("returns empty string for empty doc",
    () => {
      expect(
        getFirstLineText({ type: "doc" })
      ).toBe("");
    }
  );

  it("returns empty string for doc with " +
    "empty paragraph",
    () => {
      expect(
        getFirstLineText({
          type: "doc",
          content: [
            { type: "paragraph" },
          ],
        })
      ).toBe("");
    }
  );

  it("joins multiple text nodes", () => {
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "aa" },
            { type: "text", text: "bb" },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "cc" },
          ],
        },
      ],
    };
    expect(
      getFirstLineText(content)
    ).toBe("aabb");
  });
});

describe("migrate", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("migrates legacy key to new format",
    () => {
      const legacy: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "\u{F1978}\u{F196E}",
              },
            ],
          },
        ],
      };
      localStorage.setItem(
        "lipu-sitelen-wawa:doc",
        JSON.stringify(legacy)
      );

      migrate();

      const index = loadIndex();
      expect(index).toHaveLength(1);
      expect(index[0].name).toBe(
        "\u{F1978}\u{F196E}"
      );
      expect(
        loadDocContent(index[0].id)
      ).toEqual(legacy);
      expect(
        getActiveDocId()
      ).toBe(index[0].id);
      expect(
        localStorage.getItem(
          "lipu-sitelen-wawa:doc"
        )
      ).toBeNull();
    }
  );

  it("no-op when index already exists", () => {
    saveIndex([
      { id: "x", name: "", updatedAt: 1 },
    ]);
    localStorage.setItem(
      "lipu-sitelen-wawa:doc",
      '{"type":"doc"}'
    );

    migrate();

    // Legacy key still present
    expect(
      localStorage.getItem(
        "lipu-sitelen-wawa:doc"
      )
    ).toBe('{"type":"doc"}');
    // Index unchanged
    expect(loadIndex()).toHaveLength(1);
    expect(loadIndex()[0].id).toBe("x");
  });

  it("no-op when no legacy key", () => {
    migrate();
    expect(loadIndex()).toEqual([]);
  });

  it("handles corrupt legacy data", () => {
    localStorage.setItem(
      "lipu-sitelen-wawa:doc",
      "not json"
    );

    migrate();

    expect(loadIndex()).toEqual([]);
    expect(
      localStorage.getItem(
        "lipu-sitelen-wawa:doc"
      )
    ).toBeNull();
  });

  it(
    "quarantines corrupt legacy data before " +
      "removing it",
    () => {
      localStorage.setItem(
        "lipu-sitelen-wawa:doc",
        "not json"
      );

      migrate();

      const quarantineKeys = Object.keys(
        localStorage
      ).filter((k) =>
        k.startsWith(
          "lipu-sitelen-wawa:quarantine:" +
            "lipu-sitelen-wawa:doc:"
        )
      );
      expect(quarantineKeys).toHaveLength(1);
      expect(
        localStorage.getItem(quarantineKeys[0])
      ).toBe("not json");
      expect(errorSpy).toHaveBeenCalledTimes(1);
    }
  );
});

describe("quarantine dedup", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function quarantineKeysFor(id: string): string[] {
    return Object.keys(localStorage).filter((k) =>
      k.startsWith(KEY_PREFIX + "quarantine:" + id + ":")
    );
  }

  it(
    "does not duplicate identical raw on repeat",
    () => {
      localStorage.setItem(DOC_PREFIX + "x", "bad");

      loadDocContent("x");
      loadDocContent("x");

      expect(quarantineKeysFor("x")).toHaveLength(1);
    }
  );

  it("still quarantines when raw differs", () => {
    localStorage.setItem(DOC_PREFIX + "x", "bad-a");
    loadDocContent("x");

    localStorage.setItem(DOC_PREFIX + "x", "bad-b");
    loadDocContent("x");

    expect(quarantineKeysFor("x")).toHaveLength(2);
  });
});

describe("loadDocLipu", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  function quarantineKeysFor(id: string): string[] {
    return Object.keys(localStorage).filter((k) =>
      k.startsWith(
        KEY_PREFIX + "quarantine:" + id + ":"
      )
    );
  }

  /** Seeds a doc exactly as a dual-write save leaves it:
   *  mirror bytes first, then the lipu: value
   *  carrying the hash of those exact bytes. Returns
   *  both raw strings so tests can assert against the
   *  stored bytes rather than re-deriving them. */
  function seed(
    id: string,
    text: string
  ): { lipu: Lipu; mirror: string; raw: string } {
    const lipu = contentToLipu(pmDoc(text));
    const mirror = JSON.stringify(
      lipuToContent(lipu)
    );
    const raw = JSON.stringify(
      storedLipu(lipu, mirror)
    );
    localStorage.setItem(DOC_PREFIX + id, mirror);
    localStorage.setItem(LIPU_PREFIX + id, raw);
    return { lipu, mirror, raw };
  }

  /** `vi.spyOn(Storage.prototype, "setItem")` is
   *  VACUOUS in this project's happy-dom environment:
   *  `localStorage.setItem` is an OWN instance
   *  property, not inherited from Storage.prototype,
   *  so a prototype spy never observes a real write
   *  and "not.toHaveBeenCalled()" passes
   *  unconditionally, even on a real regression.
   *  Spying the instance directly works -- proven here
   *  with a positive-control write before the caller
   *  trusts a later zero-calls assertion. */
  function spyOnStorageWrites(): ReturnType<
    typeof vi.spyOn
  > {
    const spy = vi.spyOn(localStorage, "setItem");
    localStorage.setItem("__spy-control__", "1");
    expect(spy).toHaveBeenCalledTimes(1);
    localStorage.removeItem("__spy-control__");
    spy.mockClear();
    return spy;
  }

  it(
    "prefers a valid lipu: value whose recorded " +
      "hash matches the mirror, and writes nothing",
    () => {
      const { lipu } = seed("x", "toki");

      const setSpy = spyOnStorageWrites();
      const result = loadDocLipu("x");

      expect(JSON.stringify(result)).toBe(
        JSON.stringify({
          version: 2,
          blocks: lipu.blocks,
        })
      );
      // hash matched and the render agrees: a clean
      // load touches storage not at all. ASSERT BEFORE
      // RESTORE: mockRestore() also resets recorded
      // calls (jest/vitest semantics), so checking
      // afterward would be vacuously true.
      expect(setSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      setSpy.mockRestore();
    }
  );

  it(
    "hash mismatch: the mirror is authority, the " +
      "superseded lipu: value rolls to prev:, the " +
      "event is counted and warned",
    () => {
      const { raw } = seed("x", "a");
      // an OLD BUILD (or an external edit) rewrote
      // the mirror: its bytes no longer hash to the
      // value recorded beside the lipu
      const contentB = pmDoc("b");
      const mirrorB = JSON.stringify(contentB);
      localStorage.setItem(DOC_PREFIX + "x", mirrorB);

      const result = loadDocLipu("x");

      expect(JSON.stringify(result)).toBe(
        JSON.stringify(contentToLipu(contentB))
      );
      expect(
        localStorage.getItem(PREV_PREFIX + "x")
      ).toBe(raw);
      expect(
        JSON.parse(
          localStorage.getItem(MIRROR_WINS_KEY)!
        ).count
      ).toBe(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      // the winning mirror is READ, never rewritten:
      // its bytes are the authority this branch
      // defers to
      expect(
        localStorage.getItem(DOC_PREFIX + "x")
      ).toBe(mirrorB);
    }
  );

  it(
    "hash mismatch with prev: already occupied by " +
      "DIFFERENT bytes: prev is never overwritten; " +
      "the superseded value is quarantined",
    () => {
      const { raw } = seed("x", "a");
      localStorage.setItem(
        DOC_PREFIX + "x",
        JSON.stringify(pmDoc("b"))
      );
      localStorage.setItem(
        PREV_PREFIX + "x",
        "older-baseline"
      );

      loadDocLipu("x");

      expect(
        localStorage.getItem(PREV_PREFIX + "x")
      ).toBe("older-baseline");
      const keys = quarantineKeysFor("x");
      expect(keys).toHaveLength(1);
      expect(
        localStorage.getItem(keys[0])
      ).toBe(raw);
    }
  );

  it(
    "a corrupt mirror-wins counter heals itself " +
      "instead of staying disabled",
    () => {
      seed("x", "a");
      localStorage.setItem(
        DOC_PREFIX + "x",
        JSON.stringify(pmDoc("b"))
      );
      localStorage.setItem(
        MIRROR_WINS_KEY,
        "not json"
      );

      loadDocLipu("x");

      expect(
        JSON.parse(
          localStorage.getItem(MIRROR_WINS_KEY)!
        ).count
      ).toBe(1);
    }
  );

  it(
    "hash mismatch, repeat load: preservation is " +
      "deduped, the counter still increments",
    () => {
      seed("x", "a");
      localStorage.setItem(
        DOC_PREFIX + "x",
        JSON.stringify(pmDoc("b"))
      );
      localStorage.setItem(
        PREV_PREFIX + "x",
        "older-baseline"
      );

      loadDocLipu("x");
      loadDocLipu("x");

      expect(quarantineKeysFor("x")).toHaveLength(1);
      expect(
        JSON.parse(
          localStorage.getItem(MIRROR_WINS_KEY)!
        ).count
      ).toBe(2);
    }
  );

  it(
    "a hash-LESS lipu: value cannot certify the " +
      "mirror, so it takes the mirror-wins flow",
    () => {
      const content = pmDoc("a");
      const lipu = contentToLipu(content);
      const mirror = JSON.stringify(
        lipuToContent(lipu)
      );
      const raw = JSON.stringify({
        version: 2,
        blocks: lipu.blocks,
        savedAt: 1,
      });
      localStorage.setItem(DOC_PREFIX + "x", mirror);
      localStorage.setItem(LIPU_PREFIX + "x", raw);

      const result = loadDocLipu("x");

      // even though the mirror agrees byte-for-byte,
      // an uncertifiable value routes to recovery
      expect(JSON.stringify(result)).toBe(
        JSON.stringify(contentToLipu(content))
      );
      expect(
        localStorage.getItem(PREV_PREFIX + "x")
      ).toBe(raw);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    }
  );

  it(
    "RENDERER DRIFT (hash matches, render differs): " +
      "the lipu wins and the mirror is silently " +
      "re-canonicalized",
    () => {
      const { lipu, mirror } = seed("x", "toki");
      // fabricate drift: the stored blocks gain one
      // extra SP space while the RECORDED hash keeps
      // certifying the untouched mirror bytes — the
      // exact shape a renderer change produces
      const altered: Lipu = JSON.parse(
        JSON.stringify(lipu)
      );
      altered.blocks[0].gaps[0].sp += " ";
      localStorage.setItem(
        LIPU_PREFIX + "x",
        JSON.stringify(storedLipu(altered, mirror))
      );

      const result = loadDocLipu("x");

      expect(JSON.stringify(result)).toBe(
        JSON.stringify({
          version: 2,
          blocks: altered.blocks,
        })
      );
      const rewritten = JSON.stringify(
        lipuToContent(altered)
      );
      expect(rewritten).not.toBe(mirror);
      expect(
        localStorage.getItem(DOC_PREFIX + "x")
      ).toBe(rewritten);
      expect(
        JSON.parse(
          localStorage.getItem(LIPU_PREFIX + "x")!
        ).mirrorHash
      ).toBe(hashMirror(rewritten));
      // silent, per spec: no warn, no mirror-wins
      expect(warnSpy).not.toHaveBeenCalled();
      expect(
        localStorage.getItem(MIRROR_WINS_KEY)
      ).toBeNull();
    }
  );

  it(
    "corrupt lipu: bytes are quarantined and the " +
      "load falls back to the mirror",
    () => {
      const content = pmDoc("mirror-only");
      saveDocContent("x", content);
      localStorage.setItem(
        LIPU_PREFIX + "x",
        "not json"
      );

      const result = loadDocLipu("x");

      expect(JSON.stringify(result)).toBe(
        JSON.stringify(contentToLipu(content))
      );
      const keys = quarantineKeysFor("x");
      expect(keys).toHaveLength(1);
      expect(localStorage.getItem(keys[0])).toBe(
        "not json"
      );
    }
  );

  it(
    "a checkBlock-invalid lipu: value is " +
      "quarantined and falls back to the mirror",
    () => {
      const content = pmDoc("mirror-only");
      saveDocContent("x", content);
      // gaps.length !== anchors.length + 1
      const raw = JSON.stringify({
        version: 2,
        blocks: [{ anchors: [], gaps: [], spans: [] }],
        savedAt: 1,
      });
      localStorage.setItem(LIPU_PREFIX + "x", raw);

      const result = loadDocLipu("x");

      expect(JSON.stringify(result)).toBe(
        JSON.stringify(contentToLipu(content))
      );
      const keys = quarantineKeysFor("x");
      expect(keys).toHaveLength(1);
      expect(localStorage.getItem(keys[0])).toBe(raw);
    }
  );

  it(
    "a valid lipu: value with NO mirror stands " +
      "alone",
    () => {
      const lipu = contentToLipu(pmDoc("toki"));
      const mirror = JSON.stringify(
        lipuToContent(lipu)
      );
      localStorage.setItem(
        LIPU_PREFIX + "x",
        JSON.stringify(storedLipu(lipu, mirror))
      );

      const setSpy = spyOnStorageWrites();
      const result = loadDocLipu("x");

      expect(JSON.stringify(result)).toBe(
        JSON.stringify({
          version: 2,
          blocks: lipu.blocks,
        })
      );
      // ASSERT BEFORE RESTORE (see the helper's doc
      // comment): mockRestore() also resets recorded
      // calls.
      expect(setSpy).not.toHaveBeenCalled();
      setSpy.mockRestore();
    }
  );

  it(
    "hash mismatch with an UNREADABLE mirror: the " +
      "mirror bytes are preserved and the lipu " +
      "stands as the best remaining content",
    () => {
      const { lipu } = seed("x", "toki");
      localStorage.setItem(
        DOC_PREFIX + "x",
        "not json"
      );

      const result = loadDocLipu("x");

      expect(JSON.stringify(result)).toBe(
        JSON.stringify({
          version: 2,
          blocks: lipu.blocks,
        })
      );
      const keys = quarantineKeysFor("x");
      expect(keys).toHaveLength(1);
      expect(localStorage.getItem(keys[0])).toBe(
        "not json"
      );
      // the mirror never wins on unreadable bytes
      expect(
        localStorage.getItem(MIRROR_WINS_KEY)
      ).toBeNull();
    }
  );

  it(
    "no lipu: key falls back to the mirror " +
      "(migration-skipped and production docs)",
    () => {
      const content = pmDoc("mirror-only");
      saveDocContent("x", content);

      expect(
        JSON.stringify(loadDocLipu("x"))
      ).toBe(
        JSON.stringify(contentToLipu(content))
      );
    }
  );

  it("returns undefined when neither key exists",
    () => {
      expect(loadDocLipu("y")).toBeUndefined();
    }
  );
});

describe("saveDocDual", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it(
    "writes the mirror FIRST, then the lipu: value " +
      "carrying the hash of those exact mirror bytes",
    () => {
      const content = pmDoc("toki");
      const lipu = contentToLipu(content);

      const keys: string[] = [];
      const original =
        localStorage.setItem.bind(localStorage);
      const setSpy = vi
        .spyOn(localStorage, "setItem")
        .mockImplementation((key, value) => {
          keys.push(key);
          original(key, value);
        });

      saveDocDual("x", lipu, content, false);

      setSpy.mockRestore();

      expect(keys).toEqual([
        DOC_PREFIX + "x",
        LIPU_PREFIX + "x",
      ]);
      const mirrorRaw = localStorage.getItem(
        DOC_PREFIX + "x"
      )!;
      expect(mirrorRaw).toBe(
        JSON.stringify(content)
      );
      const stored = JSON.parse(
        localStorage.getItem(LIPU_PREFIX + "x")!
      );
      expect(stored.version).toBe(2);
      expect(stored.blocks).toEqual(lipu.blocks);
      expect(stored.mirrorHash).toBe(
        hashMirror(mirrorRaw)
      );
    }
  );

  it(
    "a failed mirror write aborts the save: no prev " +
      "roll, no lipu: write",
    () => {
      const contentA = pmDoc("a");
      const lipuA = contentToLipu(contentA);
      saveDocDual("x", lipuA, contentA, false);
      const rawA = localStorage.getItem(
        LIPU_PREFIX + "x"
      )!;

      const contentB = pmDoc("b");
      const lipuB = contentToLipu(contentB);
      const original =
        localStorage.setItem.bind(localStorage);
      const setSpy = vi
        .spyOn(localStorage, "setItem")
        .mockImplementation((key, value) => {
          if (key === DOC_PREFIX + "x") {
            throw new Error("quota exceeded");
          }
          original(key, value);
        });

      saveDocDual("x", lipuB, contentB, true);

      setSpy.mockRestore();

      expect(errorSpy).toHaveBeenCalled();
      expect(
        localStorage.getItem(DOC_PREFIX + "x")
      ).toBe(JSON.stringify(contentA));
      expect(
        localStorage.getItem(LIPU_PREFIX + "x")
      ).toBe(rawA);
      expect(
        localStorage.getItem(PREV_PREFIX + "x")
      ).toBeNull();
    }
  );

  it(
    "a torn save (lipu: write fails) leaves a stale " +
      "recorded hash, and the next load recovers the " +
      "NEWER mirror",
    () => {
      const contentA = pmDoc("a");
      const lipuA = contentToLipu(contentA);
      saveDocDual("x", lipuA, contentA, false);

      const contentB = pmDoc("b");
      const lipuB = contentToLipu(contentB);
      const original =
        localStorage.setItem.bind(localStorage);
      const setSpy = vi
        .spyOn(localStorage, "setItem")
        .mockImplementation((key, value) => {
          if (key === LIPU_PREFIX + "x") {
            throw new Error("quota exceeded");
          }
          original(key, value);
        });

      saveDocDual("x", lipuB, contentB, false);

      setSpy.mockRestore();

      expect(errorSpy).toHaveBeenCalled();
      expect(
        localStorage.getItem(DOC_PREFIX + "x")
      ).toBe(JSON.stringify(contentB));

      // the recovery composes: hash mismatch ->
      // mirror wins -> the newer content loads
      const result = loadDocLipu("x");
      expect(JSON.stringify(result)).toBe(
        JSON.stringify(contentToLipu(contentB))
      );
      expect(warnSpy).toHaveBeenCalled();
    }
  );

  it(
    "rolls prev: from the CURRENT lipu: value, and " +
      "only when rollPrev",
    () => {
      const contentA = pmDoc("a");
      const lipuA = contentToLipu(contentA);
      saveDocDual("x", lipuA, contentA, true);

      // nothing to roll on the very first save
      expect(
        localStorage.getItem(PREV_PREFIX + "x")
      ).toBeNull();
      const rawA = localStorage.getItem(
        LIPU_PREFIX + "x"
      )!;

      const contentB = pmDoc("b");
      const lipuB = contentToLipu(contentB);
      saveDocDual("x", lipuB, contentB, true);

      expect(
        localStorage.getItem(PREV_PREFIX + "x")
      ).toBe(rawA);

      const contentC = pmDoc("c");
      const lipuC = contentToLipu(contentC);
      saveDocDual("x", lipuC, contentC, false);

      expect(
        localStorage.getItem(PREV_PREFIX + "x")
      ).toBe(rawA);
    }
  );

  it(
    "a failed prev roll falls back to quarantine, " +
      "and the lipu: overwrite then proceeds",
    () => {
      const contentA = pmDoc("a");
      const lipuA = contentToLipu(contentA);
      saveDocDual("x", lipuA, contentA, false);
      const rawA = localStorage.getItem(
        LIPU_PREFIX + "x"
      )!;

      const contentB = pmDoc("b");
      const lipuB = contentToLipu(contentB);
      const original =
        localStorage.setItem.bind(localStorage);
      const setSpy = vi
        .spyOn(localStorage, "setItem")
        .mockImplementation((key, value) => {
          if (key.startsWith(PREV_PREFIX)) {
            throw new Error("quota exceeded");
          }
          original(key, value);
        });

      saveDocDual("x", lipuB, contentB, true);

      setSpy.mockRestore();

      // the baseline survives, just in a different
      // key -- so overwriting lipu: is safe
      expect(
        localStorage.getItem(PREV_PREFIX + "x")
      ).toBeNull();
      const keys = Object.keys(localStorage).filter(
        (k) =>
          k.startsWith(
            KEY_PREFIX + "quarantine:x:"
          )
      );
      expect(keys).toHaveLength(1);
      expect(localStorage.getItem(keys[0])).toBe(
        rawA
      );
      expect(
        localStorage.getItem(DOC_PREFIX + "x")
      ).toBe(JSON.stringify(contentB));
      expect(
        JSON.parse(
          localStorage.getItem(LIPU_PREFIX + "x")!
        ).blocks
      ).toEqual(lipuB.blocks);
    }
  );

  it(
    "when BOTH prev roll and quarantine fail, the " +
      "lipu: overwrite is skipped and the next load " +
      "recovers the save from the mirror",
    () => {
      const contentA = pmDoc("a");
      const lipuA = contentToLipu(contentA);
      saveDocDual("x", lipuA, contentA, false);
      const rawA = localStorage.getItem(
        LIPU_PREFIX + "x"
      )!;

      const contentB = pmDoc("b");
      const lipuB = contentToLipu(contentB);
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

      saveDocDual("x", lipuB, contentB, true);

      setSpy.mockRestore();

      expect(errorSpy).toHaveBeenCalled();
      // the pre-open baseline is untouched, in place
      expect(
        localStorage.getItem(LIPU_PREFIX + "x")
      ).toBe(rawA);
      // ...and the save is not lost: the mirror was
      // written first and carries it
      expect(
        localStorage.getItem(DOC_PREFIX + "x")
      ).toBe(JSON.stringify(contentB));

      // recovery composes: stale recorded hash ->
      // mirror wins -> the new content loads, with
      // the baseline preserved by that path
      const result = loadDocLipu("x");
      expect(JSON.stringify(result)).toBe(
        JSON.stringify(contentToLipu(contentB))
      );
      expect(
        localStorage.getItem(PREV_PREFIX + "x")
      ).toBe(rawA);
    }
  );

  it(
    "returns true on every path that completes the " +
      "lipu: write",
    () => {
      const contentA = pmDoc("a");
      const lipuA = contentToLipu(contentA);
      // plain save, nothing to roll
      expect(
        saveDocDual("x", lipuA, contentA, false)
      ).toBe(true);

      // roll lands in prev:
      const contentB = pmDoc("b");
      const lipuB = contentToLipu(contentB);
      expect(
        saveDocDual("x", lipuB, contentB, true)
      ).toBe(true);
      expect(
        localStorage.getItem(PREV_PREFIX + "x")
      ).not.toBeNull();

      // roll falls back to quarantine
      const contentC = pmDoc("c");
      const lipuC = contentToLipu(contentC);
      const original =
        localStorage.setItem.bind(localStorage);
      const setSpy = vi
        .spyOn(localStorage, "setItem")
        .mockImplementation((key, value) => {
          if (key.startsWith(PREV_PREFIX)) {
            throw new Error("quota exceeded");
          }
          original(key, value);
        });

      expect(
        saveDocDual("x", lipuC, contentC, true)
      ).toBe(true);

      setSpy.mockRestore();

      expect(
        JSON.parse(
          localStorage.getItem(LIPU_PREFIX + "x")!
        ).blocks
      ).toEqual(lipuC.blocks);
    }
  );

  it(
    "returns false when it cannot complete the " +
      "lipu: write, and says so before writing " +
      "anything it would have to take back",
    () => {
      const contentA = pmDoc("a");
      const lipuA = contentToLipu(contentA);
      saveDocDual("x", lipuA, contentA, false);
      const rawA = localStorage.getItem(
        LIPU_PREFIX + "x"
      )!;

      const contentB = pmDoc("b");
      const lipuB = contentToLipu(contentB);
      const original =
        localStorage.setItem.bind(localStorage);

      // double preservation failure: the baseline
      // could not be copied anywhere
      const bothSpy = vi
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

      expect(
        saveDocDual("x", lipuB, contentB, true)
      ).toBe(false);

      bothSpy.mockRestore();

      expect(
        localStorage.getItem(LIPU_PREFIX + "x")
      ).toBe(rawA);

      // mirror write failure: nothing written at all
      const mirrorSpy = vi
        .spyOn(localStorage, "setItem")
        .mockImplementation((key, value) => {
          if (key.startsWith(DOC_PREFIX)) {
            throw new Error("quota exceeded");
          }
          original(key, value);
        });

      expect(
        saveDocDual("x", lipuB, contentB, false)
      ).toBe(false);

      mirrorSpy.mockRestore();

      expect(
        localStorage.getItem(LIPU_PREFIX + "x")
      ).toBe(rawA);
    }
  );

  it(
    "never writes a lipudoc: key (that " +
      "serialization is retired)",
    () => {
      const content = pmDoc("toki");
      const lipu = contentToLipu(content);
      saveDocDual("x", lipu, content, true);
      saveDocDual("x", lipu, content, true);

      expect(
        Object.keys(localStorage).filter((k) =>
          k.startsWith(LIPUDOC_PREFIX)
        )
      ).toEqual([]);
    }
  );
});


describe("hashMirror / parseStoredLipu", () => {
  it("is deterministic and length-suffixed", () => {
    const h = hashMirror("abc");
    expect(hashMirror("abc")).toBe(h);
    expect(h.endsWith("-" + (3).toString(36))).toBe(
      true
    );
    expect(hashMirror("abd")).not.toBe(h);
    expect(hashMirror("ab")).not.toBe(h);
  });

  it("distinguishes same-length near-misses", () => {
    // surrogate-pair content: hash runs over UTF-16
    // units, so UCSUR glyphs are 2 units each
    const a = "\u{F1900}\u{F1901}";
    const b = "\u{F1901}\u{F1900}";
    expect(hashMirror(a)).not.toBe(hashMirror(b));
  });

  it("parseStoredLipu accepts a saved shape", () => {
    const lipu = contentToLipu(pmDoc("toki"));
    const raw = JSON.stringify({
      version: 2,
      blocks: lipu.blocks,
      savedAt: 1,
      mirrorHash: "00-0",
    });
    const stored = parseStoredLipu(raw);
    expect(stored).toBeDefined();
    expect(stored!.blocks).toEqual(lipu.blocks);
    expect(stored!.mirrorHash).toBe("00-0");
  });

  it("rejects wrong version, non-array blocks, " +
    "non-string mirrorHash, checkBlock failures, " +
    "and non-JSON", () => {
    const blocks = contentToLipu(
      pmDoc("toki")
    ).blocks;
    expect(
      parseStoredLipu(
        JSON.stringify({ version: 1, blocks })
      )
    ).toBeUndefined();
    expect(
      parseStoredLipu(
        JSON.stringify({ version: 2, blocks: {} })
      )
    ).toBeUndefined();
    expect(
      parseStoredLipu(
        JSON.stringify({
          version: 2,
          blocks,
          mirrorHash: 7,
        })
      )
    ).toBeUndefined();
    // gaps.length !== anchors.length + 1 fails
    // checkBlock
    expect(
      parseStoredLipu(
        JSON.stringify({
          version: 2,
          blocks: [
            { anchors: [], gaps: [], spans: [] },
          ],
        })
      )
    ).toBeUndefined();
    expect(parseStoredLipu("not json"))
      .toBeUndefined();
  });

  it("provenance marks survive the lipu:<id> " +
     "JSON round-trip (no version bump)", () => {
    const raw = JSON.stringify({
      version: 2,
      blocks: [
        {
          anchors: [{ kind: "word", word: "toki" }],
          gaps: [
            { sp: "", latin: "" },
            {
              sp: " ",
              latin: ". ",
              latinAuthored: true,
            },
          ],
          spans: [],
        },
      ],
    });
    const parsed = parseStoredLipu(raw);
    expect(parsed).toBeDefined();
    expect(
      parsed!.blocks[0].gaps[1].latinAuthored
    ).toBe(true);
  });
});

// Two inherited storage facts: dwelled-run
// transients are legal in the lipu: format, and the
// separation default's gap.latin content carries
// into lipu: values. Both are the load
// boundary's job — the load path stores and returns
// stored content untouched, no normalization or
// quarantine; the editor normalizer (line-breaks) is
// the only place that owns the split invariant, and
// it runs post-crystallization, never at load.
describe("inherited storage pins", () => {
  /** the actual UCSUR glyph char for a word — the
   *  separation default only fires between real
   *  SP word anchors; plain Latin spelling parses as
   *  a single verbatim run with no anchor seam. */
  const ucsur = glyph;

  it(
    "a dwelled-run transient (mid-composition " +
      "\"\\n\\n\" autosave shape) round-trips " +
      "through lipu: verbatim: no normalization, " +
      "no quarantine, no mirror-wins",
    () => {
      const lipu = contentToLipu(pmDoc("toki"));
      lipu.blocks[0].gaps[1].sp = "\n\n";
      lipu.blocks[0].gaps[1].latin = "\n\n";
      const content = lipuToContent(lipu);

      saveDocDual("x", lipu, content, false);

      const rawLipu = JSON.parse(
        localStorage.getItem(LIPU_PREFIX + "x")!
      );
      expect(rawLipu.blocks[0].gaps[1].sp).toBe(
        "\n\n"
      );

      const result = loadDocLipu("x");
      expect(result).toEqual(lipu);
    }
  );

  it(
    "the separation default's gap.latin \" \" " +
      "survives the lipu: round trip byte-exactly, " +
      "SP-invisible on the mirror",
    () => {
      const lipu = contentToLipu(
        pmDoc(
          ucsur("toki") + " " + ucsur("pona")
        )
      );
      // premise: the separation default put " " on
      // the shared gap's latin side
      expect(lipu.blocks[0].gaps[1].latin).toBe(" ");
      const content = lipuToContent(lipu);

      saveDocDual("x", lipu, content, false);

      const result = loadDocLipu("x");
      expect(
        result!.blocks[0].gaps[1].latin
      ).toBe(" ");

      // SP-invisible: the mirror is renderSp(lipu),
      // which projects gap.sp only — a lipu whose
      // shared gap carries a DIFFERENT latin value
      // renders the identical mirror bytes, so the
      // latin default leaves no trace there
      const altLipu: Lipu = {
        version: 2,
        blocks: [
          {
            ...lipu.blocks[0],
            gaps: lipu.blocks[0].gaps.map((g, i) =>
              i === 1 ? { ...g, latin: "" } : g
            ),
          },
        ],
      };
      expect(
        JSON.stringify(lipuToContent(altLipu))
      ).toBe(JSON.stringify(content));
    }
  );
});

// The re-classification bug and its fix: the `lipu:`
// payload carries optional `classified: true`, written
// on every save; the load classifier (loadNormalizeLipu's
// classify step) runs ONLY when it is absent. Without
// this gate, EVERY normal save+reload re-classified
// machine-generated punctuation (derived Latin ". ",
// the machine-minted colon glyph) as AUTHORED, freezing
// the derived lifecycle after one reload.
describe("stored classification flag", () => {

  /** Drives a Lipu through the REAL production load
   *  chain: documents.ts's classified cue, threaded
   *  into lipu-doc.ts's load-boundary chain exactly as
   *  Editor.tsx wires it (lipu ? loadNormalizeLipu(lipu,
   *  lipuClassified) : null). */
  function realLoad(id: string): Lipu {
    const loaded = loadDocLipuClassified(id)!;
    return loadNormalizeLipu(
      loaded.lipu,
      loaded.classified
    );
  }

  it(
    "a machine-derived default Latin ('. ' from a " +
      "typed SP mid-dot) survives a REAL save + REAL " +
      "reload as still-default, and a subsequent " +
      "dot-delete re-derives instead of staying stale",
    () => {
      // in-session: the SP=>Latin derivation
      // -- sp is user-typed
      // (authored), latin is MACHINE-derived (default,
      // no latinAuthored mark)
      const derived = mergeSpBlock(
        emptyBlock(),
        parseSp(
          spInlinesFromText(
            glyph("toki") +
              MIDDLE_DOT_CH +
              glyph("pona")
          )
        )
      );
      const gp = derived.gaps[1];
      expect(gp.sp).toBe(MIDDLE_DOT_CH);
      expect(gp.spAuthored).toBe(true);
      expect(gp.latin).toBe(". ");
      expect(gp.latinAuthored).toBeUndefined();

      const lipu: Lipu = {
        version: 2,
        blocks: [derived],
      };
      const content = lipuToContent(lipu);
      const saved = saveDocDual(
        "classified-a",
        lipu,
        content,
        false
      );
      expect(saved).toBe(true);

      // REAL reload: documents.ts's classified cue,
      // through loadNormalizeLipu exactly as
      // Editor.tsx's initialLipu wires it
      const reloaded = realLoad("classified-a");
      const reloadedGap = reloaded.blocks[0].gaps[1];
      // SURVIVES: still default. Without the
      // classified gate, classifyProvenance would stamp this
      // AUTHORED here (looksDefault(". ") is false —
      // it contains a ".") and this assertion fails.
      expect(
        reloadedGap.latinAuthored
      ).toBeUndefined();
      expect(reloadedGap.latin).toBe(". ");

      // BEHAVIOR HALF: delete the '·' post-reload.
      // With the mark correctly still default, the
      // derived latin RE-DERIVES (not stale ". ") --
      // exactly the stale-image failure the
      // re-classification bug produced.
      const afterDelete = mergeSpBlock(
        reloaded.blocks[0],
        parseSp(
          spInlinesFromText(
            glyph("toki") + glyph("pona")
          )
        )
      );
      expect(afterDelete.gaps[1].latin).not.toBe(
        ". "
      );
    }
  );

  it(
    "MUTATION CHECK: dropping the flag gate " +
      "(classifying unconditionally on reload) " +
      "reproduces the stale image -- proves the " +
      "pin above is load-bearing on the gate, not " +
      "on incidental behavior",
    () => {
      const derived = mergeSpBlock(
        emptyBlock(),
        parseSp(
          spInlinesFromText(
            glyph("toki") +
              MIDDLE_DOT_CH +
              glyph("pona")
          )
        )
      );
      const lipu: Lipu = {
        version: 2,
        blocks: [derived],
      };
      const content = lipuToContent(lipu);
      saveDocDual("classified-b", lipu, content, false);

      const loaded = loadDocLipuClassified(
        "classified-b"
      )!;
      expect(loaded.classified).toBe(true);
      // simulate the pre-flag bug: ignore the
      // classified cue (alreadyClassified omitted =>
      // default false => unconditional classify)
      const buggyReload = loadNormalizeLipu(
        loaded.lipu
      );
      expect(
        buggyReload.blocks[0].gaps[1].latinAuthored
      ).toBe(true);
    }
  );

  it(
    "every saved payload carries classified: true",
    () => {
      const content = lipuToContent(
        contentToLipu(undefined)
      );
      const lipu = contentToLipu(content);
      saveDocDual("classified-c", lipu, content, false);
      const raw = JSON.parse(
        localStorage.getItem(LIPU_PREFIX + "classified-c")!
      );
      expect(raw.classified).toBe(true);
    }
  );

  it(
    "old-doc pin unchanged: a stored payload WITHOUT " +
      "the flag still classifies through the real " +
      "load path",
    () => {
      const lipu = contentToLipu({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text:
                  glyph("toki") +
                  MIDDLE_DOT_CH +
                  glyph("pona"),
              },
            ],
          },
        ],
      });
      // pre-provenance stored shape: bytes only, no
      // marks, NO classified flag -- exactly what an
      // old build (or a manual localStorage seed) left
      const strippedBlocks = lipu.blocks.map((b) => ({
        anchors: b.anchors,
        gaps: b.gaps.map((g) => ({
          sp: g.sp,
          latin: g.latin,
        })),
        spans: b.spans,
      }));
      localStorage.setItem(
        LIPU_PREFIX + "classified-d",
        JSON.stringify({
          version: 2,
          blocks: strippedBlocks,
          mirrorHash: hashMirror(
            JSON.stringify(lipuToContent(lipu))
          ),
        })
      );
      localStorage.setItem(
        DOC_PREFIX + "classified-d",
        JSON.stringify(lipuToContent(lipu))
      );

      const loaded = loadDocLipuClassified(
        "classified-d"
      )!;
      expect(loaded.classified).toBe(false);
      const reloaded = realLoad("classified-d");
      // classifies: the mid-dot's SP byte hardens
      // AUTHORED same as always (unaffected by the flag)
      expect(
        reloaded.blocks[0].gaps[1].spAuthored
      ).toBe(true);
    }
  );

  it(
    "ROLLBACK SHAPE (documenting): a payload " +
      "with real provenance marks but NO flag (an old " +
      "build's re-save) re-classifies -- machine " +
      "punctuation hardens AUTHORED. This is the " +
      "already-priced degraded-but-safe cost, not a " +
      "regression.",
    () => {
      const derived = mergeSpBlock(
        emptyBlock(),
        parseSp(
          spInlinesFromText(
            glyph("toki") +
              MIDDLE_DOT_CH +
              glyph("pona")
          )
        )
      );
      // an old, flag-unaware build strips the
      // classified field on re-save but keeps whatever
      // marks it happens to carry (mkGap on re-merge
      // preserves marks; it just never writes the new
      // field) -- gaps[1].latin stays UNMARKED default,
      // same in-session shape as the lifecycle pin above
      const lipu: Lipu = {
        version: 2,
        blocks: [derived],
      };
      const content = lipuToContent(lipu);
      localStorage.setItem(
        DOC_PREFIX + "classified-e",
        JSON.stringify(content)
      );
      localStorage.setItem(
        LIPU_PREFIX + "classified-e",
        JSON.stringify({
          version: 2,
          blocks: lipu.blocks,
          mirrorHash: hashMirror(
            JSON.stringify(content)
          ),
          // no `classified` field -- the rollback shape
        })
      );

      const loaded = loadDocLipuClassified(
        "classified-e"
      )!;
      expect(loaded.classified).toBe(false);
      const reloaded = realLoad("classified-e");
      // documented cost: the derived default hardens
      // authored, exactly like any other pre-provenance
      // punctuation would
      expect(
        reloaded.blocks[0].gaps[1].latinAuthored
      ).toBe(true);
      expect(reloaded.blocks[0].gaps[1].latin).toBe(
        ". "
      );
    }
  );
});
