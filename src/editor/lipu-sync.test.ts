import { describe, it, expect, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from
  "./extensions/sitelen-pona";
import { Verbatim } from "./extensions/verbatim";
import {
  LipuModel,
  lipuModelKey,
} from "./extensions/lipu-model";
import {
  LIPU_SYNC_META,
  getLipuSync,
  minimalReplaceTr,
} from "./lipu-sync";
import { lipuToContent } from "./lipu-doc";
import type { Lipu } from "../lipu";

function mkLipu(words: string[][]): Lipu {
  return {
    version: 2,
    blocks: words.map((ws) => ({
      anchors: ws.map((w) => ({
        kind: "word" as const,
        word: w,
      })),
      gaps: [
        { sp: "", latin: "" },
        ...ws.map((_w, i) => ({
          sp: i < ws.length - 1 ? " " : "",
          latin: i < ws.length - 1 ? " " : "",
        })),
      ],
      spans: [],
    })),
  };
}

function mkEditor(lipu: Lipu): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ history: false }),
      SitelenPona,
      Verbatim,
      LipuModel.configure({ initialLipu: lipu }),
    ],
    content: lipuToContent(lipu),
  });
}

describe("minimalReplaceTr", () => {
  it("returns null when the doc already matches", () => {
    const lipu = mkLipu([["toki"]]);
    const ed = mkEditor(lipu);
    expect(
      minimalReplaceTr(
        ed.state,
        lipuToContent(lipu)
      )
    ).toBeNull();
  });

  it("produces steps whose result equals the " +
     "target and leaves the common prefix " +
     "unmapped", () => {
    const lipu = mkLipu([["toki"], ["pona"]]);
    const ed = mkEditor(lipu);
    const next = mkLipu([["toki"], ["mute"]]);
    const tr = minimalReplaceTr(
      ed.state,
      lipuToContent(next)
    )!;
    expect(tr).not.toBeNull();
    // prefix position stays fixed under mapping
    expect(tr.mapping.map(1)).toBe(1);
    ed.view.dispatch(tr);
    expect(
      JSON.stringify(ed.getJSON())
    ).toBe(JSON.stringify(lipuToContent(next)));
  });

  it("diffs the FULL inline stream: a verbatim " +
     "MARK-only change still produces steps",
    () => {
      const lipu: Lipu = {
        version: 2,
        blocks: [
          {
            anchors: [
              {
                kind: "verbatim",
                text: "xq",
                marked: true,
              },
            ],
            gaps: [
              { sp: "", latin: "" },
              { sp: "", latin: "" },
            ],
            spans: [],
          },
        ],
      };
      const ed = mkEditor(lipu);
      const next: Lipu = JSON.parse(
        JSON.stringify(lipu)
      );
      delete next.blocks[0].anchors[0].marked;
      // identical TEXT, different marks
      expect(
        JSON.stringify(
          lipuToContent(next).content![0].content![0]
            .text
        )
      ).toBe(
        JSON.stringify(
          lipuToContent(lipu).content![0].content![0]
            .text
        )
      );
      const tr = minimalReplaceTr(
        ed.state,
        lipuToContent(next)
      );
      expect(tr).not.toBeNull();
      ed.view.dispatch(tr!);
      expect(
        JSON.stringify(ed.getJSON())
      ).toBe(JSON.stringify(lipuToContent(next)));
    }
  );

  it("handles repeated content (the crossing " +
     "diff-start/diff-end case)", () => {
    const lipu = mkLipu([["toki", "toki", "toki"]]);
    const ed = mkEditor(lipu);
    const next = mkLipu([["toki", "toki"]]);
    const tr = minimalReplaceTr(
      ed.state,
      lipuToContent(next)
    )!;
    ed.view.dispatch(tr);
    expect(
      JSON.stringify(ed.getJSON())
    ).toBe(JSON.stringify(lipuToContent(next)));
  });
});

describe("adoption gate", () => {
  it("adopts a carried lipu with derived steps; " +
     "version advances", () => {
    const lipu = mkLipu([["toki"]]);
    const ed = mkEditor(lipu);
    const v0 = lipuModelKey.getState(
      ed.state
    )!.version;
    const next = mkLipu([["pona"]]);
    const tr = minimalReplaceTr(
      ed.state,
      lipuToContent(next)
    )!;
    tr.setMeta(LIPU_SYNC_META, {
      lipu: next,
      originSide: "latin",
      origin: "edit",
      latinSelBefore: null,
      latinSelAfter: null,
    });
    expect(getLipuSync(tr)).not.toBeNull();
    ed.view.dispatch(tr);
    const st = lipuModelKey.getState(ed.state)!;
    expect(st.lipu).toEqual(next);
    expect(st.version).toBe(v0 + 1);
  });

  it("a Latin-LOCAL adoption (ZERO steps) still " +
     "advances the version", () => {
    const lipu = mkLipu([["toki"]]);
    const ed = mkEditor(lipu);
    const v0 = lipuModelKey.getState(
      ed.state
    )!.version;
    const next: Lipu = JSON.parse(
      JSON.stringify(lipu)
    );
    next.blocks[0].gaps[1].latin = "!";
    const tr = ed.state.tr.setMeta(
      LIPU_SYNC_META,
      {
        lipu: next,
        originSide: "latin",
        origin: "edit",
        latinSelBefore: null,
        latinSelAfter: null,
      }
    );
    expect(tr.docChanged).toBe(false);
    ed.view.dispatch(tr);
    const st = lipuModelKey.getState(ed.state)!;
    expect(st.lipu).toEqual(next);
    expect(st.version).toBe(v0 + 1);
  });

  it("adopts VERBATIM: the carried lipu is stored " +
     "as-is, never re-parsed from the doc", () => {
    // gap.latin content is invisible to the SP doc,
    // so a re-parse would silently drop it.
    const lipu = mkLipu([["toki", "pona"]]);
    const ed = mkEditor(lipu);
    const next: Lipu = JSON.parse(
      JSON.stringify(lipu)
    );
    next.blocks[0].gaps[1].latin = ", ";
    next.blocks[0].anchors[0].case = "capital";
    ed.view.dispatch(
      ed.state.tr.setMeta(LIPU_SYNC_META, {
        lipu: next,
        originSide: "latin",
        origin: "edit",
        latinSelBefore: null,
        latinSelAfter: null,
      })
    );
    const st = lipuModelKey.getState(ed.state)!;
    expect(st.lipu).toBe(next);
  });

  it("a history-origin adoption advances the " +
     "version too", () => {
    const lipu = mkLipu([["toki"]]);
    const ed = mkEditor(lipu);
    const v0 = lipuModelKey.getState(
      ed.state
    )!.version;
    const next = mkLipu([["pona"]]);
    const tr = minimalReplaceTr(
      ed.state,
      lipuToContent(next)
    )!;
    tr.setMeta(LIPU_SYNC_META, {
      lipu: next,
      originSide: "sp",
      origin: "history",
      latinSelBefore: null,
      latinSelAfter: null,
    });
    ed.view.dispatch(tr);
    const st = lipuModelKey.getState(ed.state)!;
    expect(st.lipu).toEqual(next);
    expect(st.version).toBe(v0 + 1);
  });

  it("an ordinary SP edit still parses (no meta, " +
     "no adoption)", () => {
    const lipu = mkLipu([["toki"]]);
    const ed = mkEditor(lipu);
    const v0 = lipuModelKey.getState(
      ed.state
    )!.version;
    ed.commands.insertContentAt(
      ed.state.doc.content.size - 1,
      "\u{F1988}"
    );
    const st = lipuModelKey.getState(ed.state)!;
    expect(st.version).toBe(v0 + 1);
    expect(st.lipu.blocks[0].anchors).toHaveLength(2);
  });

  it("dev/test adoption verification THROWS on a " +
     "lipu whose SP stream disagrees with the " +
     "doc (marks included)", () => {
    const lipu = mkLipu([["toki"]]);
    const ed = mkEditor(lipu);
    const bogus: Lipu = mkLipu([["pona"]]);
    const tr = ed.state.tr.setMeta(
      LIPU_SYNC_META,
      {
        lipu: bogus,
        originSide: "latin",
        origin: "edit",
        latinSelBefore: null,
        latinSelAfter: null,
      }
    );
    expect(() => ed.view.dispatch(tr)).toThrow(
      /adoption/
    );
  });

  it("dev/test verification catches a MARK-only " +
     "disagreement (the diff is not text-only)", () => {
    const lipu: Lipu = {
      version: 2,
      blocks: [
        {
          anchors: [
            {
              kind: "verbatim",
              text: "xq",
              marked: true,
            },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    };
    const ed = mkEditor(lipu);
    const bogus: Lipu = JSON.parse(
      JSON.stringify(lipu)
    );
    // same SP TEXT, different verbatim mark
    delete bogus.blocks[0].anchors[0].marked;
    const tr = ed.state.tr.setMeta(
      LIPU_SYNC_META,
      {
        lipu: bogus,
        originSide: "latin",
        origin: "edit",
        latinSelBefore: null,
        latinSelAfter: null,
      }
    );
    expect(() => ed.view.dispatch(tr)).toThrow(
      /adoption/
    );
  });

  it("dev/test verification catches a paragraph " +
     "COUNT disagreement", () => {
    const lipu = mkLipu([["toki"]]);
    const ed = mkEditor(lipu);
    const bogus = mkLipu([["toki"], ["toki"]]);
    const tr = ed.state.tr.setMeta(
      LIPU_SYNC_META,
      {
        lipu: bogus,
        originSide: "latin",
        origin: "edit",
        latinSelBefore: null,
        latinSelAfter: null,
      }
    );
    expect(() => ed.view.dispatch(tr)).toThrow(
      /adoption/
    );
  });
});

/**
 * The meta is adopted VERBATIM and goes straight to
 * storage, and in production the dev assertion is
 * compiled out — so a malformed meta would corrupt
 * the document silently. getLipuSync shape-checks it
 * and IGNORES anything unrecognizable.
 */
describe("getLipuSync shape check", () => {
  const malformed: Array<[string, unknown]> = [
    ["not an object", "lipuSync"],
    ["no lipu", { originSide: "latin",
      origin: "edit" }],
    ["lipu without blocks", {
      lipu: { version: 2 },
      originSide: "latin",
      origin: "edit",
    }],
    ["unknown originSide", {
      lipu: mkLipu([["toki"]]),
      originSide: "middle",
      origin: "edit",
    }],
    ["unknown origin", {
      lipu: mkLipu([["toki"]]),
      originSide: "latin",
      origin: "paste",
    }],
  ];

  for (const [name, meta] of malformed) {
    it(`ignores a malformed meta (${name}) with a ` +
       "warning, adopting nothing", () => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      try {
        const lipu = mkLipu([["toki"]]);
        const ed = mkEditor(lipu);
        const v0 = lipuModelKey.getState(
          ed.state
        )!.version;
        const tr = ed.state.tr.setMeta(
          LIPU_SYNC_META,
          meta
        );

        expect(getLipuSync(tr)).toBeNull();
        expect(warn).toHaveBeenCalled();

        // and the plugin agrees: nothing adopted,
        // no version advance on the zero-step tr
        ed.view.dispatch(tr);
        const st = lipuModelKey.getState(ed.state)!;
        expect(st.lipu).toEqual(lipu);
        expect(st.version).toBe(v0);
      } finally {
        warn.mockRestore();
      }
    });
  }

  it("accepts a well-formed meta without warning",
    () => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      try {
        const ed = mkEditor(mkLipu([["toki"]]));
        const tr = ed.state.tr.setMeta(
          LIPU_SYNC_META,
          {
            lipu: mkLipu([["toki"]]),
            originSide: "sp",
            origin: "history",
            latinSelBefore: null,
            latinSelAfter: null,
          }
        );
        expect(getLipuSync(tr)).not.toBeNull();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    }
  );

  it("returns null for a transaction with no meta " +
     "at all, silently", () => {
    const warn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    try {
      const ed = mkEditor(mkLipu([["toki"]]));
      expect(getLipuSync(ed.state.tr)).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
