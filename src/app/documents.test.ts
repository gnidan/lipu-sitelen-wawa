import {
  describe,
  it,
  expect,
  beforeEach,
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
} from "./documents";

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
});
