import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  classifyProvenance,
  gapPosition,
  looksDefault,
  orInto,
  originDefault,
  reattachProvenance,
  withMark,
} from "./provenance";
import {
  COLON_CH,
  MIDDLE_DOT_CH,
  CARTOUCHE_START,
  STACK,
} from "./chars";
import type { Block, Lipu } from "./types";
import { arbLipu } from "../../test/lipu-arbitraries";
import {
  blockOf as block,
  cart,
  gap as g,
  word,
} from "../../test/helpers";

describe("originDefault (the live origin rule)", () => {
  it("space-only runs and empty are default", () => {
    expect(originDefault("")).toBe(true);
    expect(originDefault(" ")).toBe(true);
    expect(originDefault("   ")).toBe(true);
  });
  it("newlines are NOT space-only: a typed Enter " +
     "is authored", () => {
    expect(originDefault("\n")).toBe(false);
    expect(originDefault(" \n")).toBe(false);
  });
  it("punctuation and letters are authored", () => {
    expect(originDefault(". ")).toBe(false);
    expect(originDefault(":")).toBe(false);
    expect(originDefault("x")).toBe(false);
  });
});

describe("looksDefault (boundary classifier, " +
         "unordered grammar)", () => {
  const cases: Array<[string, boolean]> = [
    ["", true],           // block-final creation
    [" ", true],          // interior creation
    ["\n", true],         // load-classified break
    ["\n\n", true],       // dwelled run at rest
    [" \n", true],        // latin-join seam image
                          // (layout BEFORE newline)
    ["\n ", true],
    [" \n \n ", true],
    [". ", false],
    [":", false],
    [MIDDLE_DOT_CH, false],
    [COLON_CH, false],
    [CARTOUCHE_START, false],
    [STACK, false],
    ["e", false],
    ["\t", false],
  ];
  for (const [bytes, want] of cases) {
    it(
      JSON.stringify(bytes) + " => " + want,
      () => {
        expect(
          looksDefault("sp", bytes, "interior")
        ).toBe(want);
        expect(
          looksDefault("latin", bytes, "final")
        ).toBe(want);
      }
    );
  }
});

describe("marks: withMark / orInto / gapPosition", () => {
  it("withMark never stores false and is CoW", () => {
    const a = g(" ", " ");
    const b = withMark(a, "sp", true);
    expect(b).not.toBe(a);
    expect(b.spAuthored).toBe(true);
    expect(a.spAuthored).toBeUndefined();
    const c = withMark(b, "sp", false);
    expect("spAuthored" in c).toBe(false);
    // identity when nothing changes
    expect(withMark(a, "sp", false)).toBe(a);
  });
  it("orInto is the concatenation OR rule", () => {
    const a = g(" ", " ");
    expect(orInto(a, "latin", undefined)).toBe(a);
    expect(
      orInto(a, "latin", true).latinAuthored
    ).toBe(true);
    const auth = withMark(a, "latin", true);
    expect(orInto(auth, "latin", undefined)).toBe(
      auth
    );
  });
  it("gapPosition", () => {
    expect(gapPosition(0, 3)).toBe("gap0");
    expect(gapPosition(1, 3)).toBe("interior");
    expect(gapPosition(2, 3)).toBe("final");
  });
});

describe("classifyProvenance (load boundary)", () => {
  it("classifies unmarked sides per-side; leaves " +
     "marked sides alone; idempotent", () => {
    const lipu: Lipu = {
      version: 2,
      blocks: [
        block(
          [word("toki"), word("pona")],
          [
            g("", ""),
            g(". ", " \n"), // sp authored, latin
                            // default (seam image)
            g("", ""),
          ]
        ),
      ],
    };
    // pre-mark the latin side AUTHORED by hand: the
    // classifier must not overrule an existing mark
    lipu.blocks[0].gaps[1] = withMark(
      lipu.blocks[0].gaps[1],
      "latin",
      true
    );
    const out = classifyProvenance(lipu);
    const gp = out.blocks[0].gaps[1];
    expect(gp.spAuthored).toBe(true);
    expect(gp.latinAuthored).toBe(true); // untouched
    expect(classifyProvenance(out)).toBe(out);
  });
  it("idempotent and per-side over arbLipu " +
     "(property)", () => {
    fc.assert(
      fc.property(arbLipu, (lipu) => {
        const once = classifyProvenance(
          lipu as Lipu
        );
        return classifyProvenance(once) === once;
      }),
      { numRuns: 500 }
    );
  });
});

describe("reattachProvenance (mark algebra)", () => {
  it("matched gap, carried side, bytes unchanged: " +
     "inherits the prev mark", () => {
    const prev = block(
      [word("toki")],
      [g("", ""), withMark(g(" ", ". "), "latin", true)]
    );
    const out = block(
      [word("toki")],
      [g("", ""), g("  ", ". ")] // sp edited
    );
    const r = reattachProvenance(
      prev,
      out,
      [0],
      "sp"
    );
    expect(r.gaps[1].latinAuthored).toBe(true);
    // edited sp "  " re-decides default
    expect(r.gaps[1].spAuthored).toBeUndefined();
  });
  it("edited side re-decides by originDefault: " +
     "typing ':' stamps authored; deleting back " +
     "to a space restores default", () => {
    const prev = block(
      [word("toki")],
      [g("", ""), g(" ", " ")]
    );
    const typed = reattachProvenance(
      prev,
      block([word("toki")], [g("", ""), g(" ", ": ")]),
      [0],
      "latin"
    );
    expect(typed.gaps[1].latinAuthored).toBe(true);
    const deleted = reattachProvenance(
      typed,
      block([word("toki")], [g("", ""), g(" ", " ")]),
      [0],
      "latin"
    );
    expect(
      deleted.gaps[1].latinAuthored
    ).toBeUndefined();
  });
  it("edited-side Enter (\"\\n\") stamps authored " +
     "(newlines are not space-only)", () => {
    const prev = block(
      [word("toki")],
      [g("", ""), g(" ", " ")]
    );
    const r = reattachProvenance(
      prev,
      block(
        [word("toki")],
        [g("", ""), g(" ", " \n")]
      ),
      [0],
      "latin"
    );
    expect(r.gaps[1].latinAuthored).toBe(true);
  });
  it("fresh gap classifies both sides with " +
     "looksDefault: a pasted '. ' lands authored " +
     "immediately", () => {
    const prev = block([], [g("", "")]);
    const out = block(
      [word("toki"), word("pona")],
      [g("", ""), g(" ", ". "), g("", "")]
    );
    const r = reattachProvenance(
      prev,
      out,
      [undefined, undefined],
      "latin"
    );
    expect(r.gaps[1].latinAuthored).toBe(true);
    expect(r.gaps[1].spAuthored).toBeUndefined();
  });
  it("carried side whose bytes CHANGED restamps by " +
     "recognizer (frozen consumption): a " +
     "consumed-to-space side goes default even if " +
     "prev was authored", () => {
    const prev = block(
      [word("toki")],
      [g("", ""), withMark(g(STACK, ""), "sp", true)]
    );
    // latin merge: frozen cleanupJoiners stripped
    // the joiner from the carried sp
    const r = reattachProvenance(
      prev,
      block([word("toki")], [g("", ""), g("", "")]),
      [0],
      "latin"
    );
    expect(r.gaps[1].spAuthored).toBeUndefined();
  });
  it("precedence: a same-merge user edit " +
     "AND a registered pair consumption on the " +
     "edited side => the recognizer restamp wins " +
     "(residual \"\\n\" is DEFAULT, not authored)", () => {
    // prev: gap 1 sp "[\n" (authored); the user
    // types "]" downstream; the pair consumes both
    // markers into a span; residual "\n".
    const prev = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(
          g(CARTOUCHE_START + "\n", " "),
          "sp",
          true
        ),
        g("", ""),
      ]
    );
    const out: Block = {
      anchors: [word("toki"), word("pona")].map(
        (a) => ({ ...a })
      ),
      gaps: [g("", ""), g("\n", " "), g("", "")],
      spans: [cart(1, 1)],
    };
    const r = reattachProvenance(
      prev,
      out,
      [0, 1],
      "sp"
    );
    // originDefault("\n") is false, but the
    // consumption restamp (looksDefault) wins.
    expect(r.gaps[1].spAuthored).toBeUndefined();
  });
  it("facet-fold consumption on the edited side " +
     "restamps by recognizer too: " +
     "residual \"\\n\" where originDefault and " +
     "looksDefault DISAGREE, so the branch is " +
     "load-bearing", () => {
    // prev gap 1 sp held an authored mid-dot run
    // ending in a newline; the merge folds the
    // mid-dot into a morae scheme (anchor 0 gained
    // nameScheme), leaving residual sp "\n".
    // originDefault("\n") is false (would stamp
    // authored on the plain edited-side fallback);
    // looksDefault("\n") is true. Only the
    // consumption-restamp branch produces the
    // asserted (default) outcome.
    const prev = block(
      [word("toki"), word("pona")],
      [
        g("", ""),
        withMark(
          g(MIDDLE_DOT_CH + "\n", " "),
          "sp",
          true
        ),
        g("", ""),
      ]
    );
    const out: Block = {
      anchors: [
        {
          kind: "word",
          word: "toki",
          nameScheme: { style: "morae", count: 1 },
        },
        { kind: "word", word: "pona" },
      ],
      gaps: [g("", ""), g("\n", " "), g("", "")],
      spans: [],
    };
    const r = reattachProvenance(
      prev,
      out,
      [0, 1],
      "sp"
    );
    expect(r.gaps[1].spAuthored).toBeUndefined();
  });
  it("returns the same object when nothing " +
     "changes (CoW identity)", () => {
    const prev = block(
      [word("toki")],
      [g("", ""), g(" ", " ")]
    );
    const out = block(
      [word("toki")],
      [g("", ""), g(" ", " ")]
    );
    expect(
      reattachProvenance(prev, out, [0], "sp")
    ).toBe(out);
  });
});
