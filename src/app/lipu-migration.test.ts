import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import type { JSONContent } from "@tiptap/core";
import { migrateToLipu } from "./lipu-migration";
import {
  DOC_PREFIX,
  KEY_PREFIX,
  LIPU_FORMAT_KEY,
  LIPU_PREFIX,
  hashMirror,
  loadIndex,
  parseStoredLipu,
  saveIndex,
  type DocEntry,
} from "./documents";
import {
  contentToLipu,
  lipuToContent,
} from "../editor/lipu-doc";
import type { Lipu } from "../lipu";
import { pmDoc } from "../../test/helpers";

function entry(id: string): DocEntry {
  return { id, name: id, updatedAt: 1 };
}

/** Writes an index entry + mirror for `text`, returns
 *  the lipu the mirror encodes. */
function seedDoc(id: string, text: string): Lipu {
  const lipu = contentToLipu(pmDoc(text));
  saveIndex([...loadIndex(), entry(id)]);
  localStorage.setItem(
    DOC_PREFIX + id,
    JSON.stringify(lipuToContent(lipu))
  );
  return lipu;
}

const QUARANTINE_PREFIX = KEY_PREFIX + "quarantine:";

function quarantineKeysFor(id: string): string[] {
  const prefix = QUARANTINE_PREFIX + id + ":";
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

function report(): {
  fromMirror: number;
  skipped: string[];
} {
  return JSON.parse(
    localStorage.getItem(LIPU_FORMAT_KEY)!
  );
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
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

describe("migrateToLipu: marker idempotence", () => {
  it("a second run performs zero writes", () => {
    seedDoc("a", "hello");

    migrateToLipu();

    const setItemSpy = vi.spyOn(localStorage, "setItem");
    migrateToLipu();

    expect(setItemSpy).not.toHaveBeenCalled();
  });
});

describe("migrateToLipu: mirror-only production shape", () => {
  it(
    "converts a mirror-only doc via contentToLipu, " +
      "companion newlines included, mirror " +
      "untouched",
    () => {
      // a hardBreak so the both-sides "\n" default
      // (backfill subsumption) actually matters
      const content: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "a" },
              { type: "hardBreak" },
              { type: "text", text: "b" },
            ],
          },
        ],
      };
      const mirrorRaw = JSON.stringify(content);
      saveIndex([entry("x")]);
      localStorage.setItem(DOC_PREFIX + "x", mirrorRaw);

      migrateToLipu();

      const storedRaw = localStorage.getItem(
        LIPU_PREFIX + "x"
      );
      expect(storedRaw).not.toBeNull();
      const stored = parseStoredLipu(storedRaw!);
      expect(stored).toBeDefined();
      expect(stored!.blocks).toEqual(
        contentToLipu(content).blocks
      );
      expect(stored!.mirrorHash).toBe(
        hashMirror(mirrorRaw)
      );
      expect(
        localStorage.getItem(DOC_PREFIX + "x")
      ).toBe(mirrorRaw);
      expect(report()).toMatchObject({ fromMirror: 1 });
    }
  );
});

describe("migrateToLipu: strict-gate skip", () => {
  it(
    "a non-round-tripping mirror is skipped, bytes " +
      "untouched",
    () => {
      // two adjacent same-mark text nodes: contentToLipu
      // joins them into one gap segment, so the render
      // reproduces "ab" as a single node, not two
      const content: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "a" },
              { type: "text", text: "b" },
            ],
          },
        ],
      };

      // verify the premise: this fixture genuinely
      // fails strict round-trip
      expect(
        JSON.stringify(
          lipuToContent(contentToLipu(content))
        )
      ).not.toBe(JSON.stringify(content));

      const mirrorRaw = JSON.stringify(content);
      saveIndex([entry("x")]);
      localStorage.setItem(DOC_PREFIX + "x", mirrorRaw);

      migrateToLipu();

      expect(
        localStorage.getItem(LIPU_PREFIX + "x")
      ).toBeNull();
      expect(
        localStorage.getItem(DOC_PREFIX + "x")
      ).toBe(mirrorRaw);
      expect(report().skipped).toEqual(["x"]);
      expect(
        localStorage.getItem(LIPU_FORMAT_KEY)
      ).not.toBeNull();
    }
  );
});

describe("migrateToLipu: hash seeding is load-consistent", () => {
  it(
    "hashMirror of the stored mirror matches the " +
      "recorded mirrorHash",
    () => {
      seedDoc("x", "consistent");

      migrateToLipu();

      const mirrorRaw = localStorage.getItem(
        DOC_PREFIX + "x"
      )!;
      const result = parseStoredLipu(
        localStorage.getItem(LIPU_PREFIX + "x")!
      )!;
      expect(hashMirror(mirrorRaw)).toBe(
        result.mirrorHash
      );
    }
  );
});

describe(
  "migrateToLipu: invalid pre-existing lipu: value",
  () => {
    it(
      "quarantines the invalid value before " +
        "overwriting it with the mirror conversion",
      () => {
        const lipu = contentToLipu(pmDoc("fresh"));
        const mirrorRaw = JSON.stringify(
          lipuToContent(lipu)
        );
        saveIndex([entry("x")]);
        localStorage.setItem(DOC_PREFIX + "x", mirrorRaw);
        localStorage.setItem(
          LIPU_PREFIX + "x",
          "not json"
        );

        migrateToLipu();

        const qkeys = quarantineKeysFor("x");
        expect(qkeys).toHaveLength(1);
        expect(localStorage.getItem(qkeys[0])).toBe(
          "not json"
        );
        const result = parseStoredLipu(
          localStorage.getItem(LIPU_PREFIX + "x")!
        )!;
        expect(result.blocks).toEqual(lipu.blocks);
      }
    );
  }
);

describe("migrateToLipu: quota interruption retries", () => {
  it(
    "a throw on the first lipu: write leaves no " +
      "marker and destroys nothing; a retry " +
      "converts every doc and marks",
    () => {
      saveIndex([entry("a"), entry("b")]);

      const lipuA = contentToLipu(pmDoc("a-text"));
      const mirrorARaw = JSON.stringify(
        lipuToContent(lipuA)
      );
      localStorage.setItem(DOC_PREFIX + "a", mirrorARaw);

      const lipuB = contentToLipu(pmDoc("b-text"));
      const mirrorBRaw = JSON.stringify(
        lipuToContent(lipuB)
      );
      localStorage.setItem(DOC_PREFIX + "b", mirrorBRaw);

      const original =
        localStorage.setItem.bind(localStorage);
      let thrown = false;
      const setItemSpy = vi
        .spyOn(localStorage, "setItem")
        .mockImplementation((key, value) => {
          if (
            !thrown &&
            key.startsWith(LIPU_PREFIX)
          ) {
            thrown = true;
            throw new Error("quota exceeded");
          }
          original(key, value);
        });

      migrateToLipu();

      expect(
        localStorage.getItem(LIPU_FORMAT_KEY)
      ).toBeNull();
      // nothing partially destroyed by the abort
      expect(
        localStorage.getItem(DOC_PREFIX + "a")
      ).toBe(mirrorARaw);
      expect(
        localStorage.getItem(DOC_PREFIX + "b")
      ).toBe(mirrorBRaw);
      expect(
        localStorage.getItem(LIPU_PREFIX + "a")
      ).toBeNull();

      setItemSpy.mockRestore();

      migrateToLipu();

      expect(
        localStorage.getItem(LIPU_FORMAT_KEY)
      ).not.toBeNull();
      expect(
        parseStoredLipu(
          localStorage.getItem(LIPU_PREFIX + "a")!
        )
      ).toBeDefined();
      expect(
        parseStoredLipu(
          localStorage.getItem(LIPU_PREFIX + "b")!
        )
      ).toBeDefined();
    }
  );
});
