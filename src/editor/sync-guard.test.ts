/**
 * The PRODUCTION projection guard. isDevBuild is
 * mocked to
 * false for this whole file: the dev assertion
 * (lipu-model's assertAdoption) throws on exactly
 * the disagreements this guard exists to survive, so
 * the production path is unreachable with it on.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
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
  LipuHistory,
  lipuHistoryKey,
  sharedUndo,
} from "./extensions/lipu-history";
import { LIPU_SYNC_META } from "./lipu-sync";
import * as guard from "./sync-guard";
import { lipuToContent } from "./lipu-doc";
import type { Lipu } from "../lipu";

// `zeroStep` reproduces a latent hazard shape:
// Transform.replace returns `this`
// even when the fit yields nothing, so
// minimalReplaceTr CAN hand back a transaction with
// no steps. Dispatching it changes nothing and the
// guard re-enters — the recursion the structural
// one-shot rules exist to make impossible.
const hoisted = vi.hoisted(() => ({
  zeroStep: false,
}));

vi.mock("./lipu-sync", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./lipu-sync")
  >();
  return {
    ...actual,
    isDevBuild: () => false,
    minimalReplaceTr: (
      state: Parameters<
        typeof actual.minimalReplaceTr
      >[0],
      content: Parameters<
        typeof actual.minimalReplaceTr
      >[1]
    ) =>
      hoisted.zeroStep
        ? state.tr
        : actual.minimalReplaceTr(state, content),
  };
});

function mkLipu(words: string[][]): Lipu {
  return {
    version: 2,
    blocks: words.map((ws) => ({
      anchors: ws.map((w) => ({
        kind: "word" as const,
        word: w,
      })),
      gaps: ws.map(() => ({ sp: "", latin: "" })).
        concat([{ sp: "", latin: "" }]),
      spans: [],
    })),
  };
}

function mkEditor(
  lipu: Lipu,
  history = false
): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({
        history: history ? {} : false,
      }),
      SitelenPona,
      Verbatim,
      LipuModel.configure({ initialLipu: lipu }),
    ],
    content: lipuToContent(lipu),
  });
}

/** The same editor plus the SHARED lipu-layer
 *  stack. LipuHistory is declared BEFORE LipuModel —
 *  TipTap reverses, and the history plugin's state
 *  must apply AFTER the model's. */
function mkHistoryEditor(lipu: Lipu): Editor {
  return new Editor({
    extensions: [
      LipuHistory,
      LipuModel.configure({ initialLipu: lipu }),
      StarterKit.configure({ history: false }),
      SitelenPona,
      Verbatim,
    ],
    content: lipuToContent(lipu),
  });
}

function adopt(ed: Editor, lipu: Lipu): void {
  ed.view.dispatch(
    ed.state.tr.setMeta(LIPU_SYNC_META, {
      lipu,
      originSide: "latin",
      origin: "edit",
      latinSelBefore: null,
      latinSelAfter: null,
    })
  );
}

describe("verifySpProjection", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hoisted.zeroStep = false;
    warn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("passes silently when the doc projects the " +
     "model", () => {
    const ed = mkEditor(mkLipu([["toki"], ["pona"]]));
    const before = guard.adoptionMismatches;
    expect(guard.verifySpProjection(ed)).toBe(true);
    expect(guard.adoptionMismatches).toBe(before);
    expect(warn).not.toHaveBeenCalled();
  });

  it("on a per-paragraph LENGTH mismatch the MODEL " +
     "WINS: the doc is re-derived from " +
     "renderSp(lipu)", () => {
    const ed = mkEditor(mkLipu([["toki"]]));
    const bogus = mkLipu([["toki", "pona"]]);
    adopt(ed, bogus);
    const before = guard.adoptionMismatches;

    expect(guard.verifySpProjection(ed)).toBe(false);

    expect(guard.adoptionMismatches).toBe(before + 1);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(ed.getJSON())).toBe(
      JSON.stringify(lipuToContent(bogus))
    );
    // the correction is itself an adoption, so the
    // model survives it unchanged and a re-check is
    // clean
    expect(
      lipuModelKey.getState(ed.state)!.lipu
    ).toEqual(bogus);
    expect(guard.verifySpProjection(ed)).toBe(true);
  });

  it("catches a paragraph COUNT mismatch", () => {
    const ed = mkEditor(mkLipu([["toki"]]));
    const bogus = mkLipu([["toki"], ["pona"]]);
    adopt(ed, bogus);

    expect(guard.verifySpProjection(ed)).toBe(false);
    expect(ed.state.doc.childCount).toBe(2);
    expect(JSON.stringify(ed.getJSON())).toBe(
      JSON.stringify(lipuToContent(bogus))
    );
  });

  it("the recovery is INVISIBLE TO UNDO: it never " +
     "enters the history stack", () => {
    // RE-DERIVED when undo moved to the shared
    // lipu-layer stack. This used to run through
    // StarterKit's native history, which is now
    // OFF; undo is a lipu-layer operation, so the
    // property is now carried by the SHARED stack's
    // identity check: a correction re-adopts the
    // model's OWN lipu, so there is nothing to undo
    // and no entry is minted. `addToHistory: false`
    // on the correction is inert now — kept as
    // documented intent, not relied on.
    const lipu = mkLipu([["toki"]]);
    const bogus = mkLipu([["toki", "pona"]]);
    const ed = mkHistoryEditor(lipu);
    adopt(ed, bogus);
    // the ADOPTION is a genuine edit: one entry
    expect(
      lipuHistoryKey.getState(ed.state)!.done
    ).toHaveLength(1);

    expect(guard.verifySpProjection(ed)).toBe(false);
    expect(JSON.stringify(ed.getJSON())).toBe(
      JSON.stringify(lipuToContent(bogus))
    );
    // the CORRECTION minted nothing
    expect(
      lipuHistoryKey.getState(ed.state)!.done
    ).toHaveLength(1);

    // Cmd-Z pops the ADOPTION, not the correction:
    // one undo lands on a doc and a model that
    // AGREE, and the guard is clean. Were the
    // correction recorded, this undo would be the
    // dead step — doc and model both left on the
    // bogus lipu, with the real edit still needing
    // a second Cmd-Z.
    expect(sharedUndo(ed)).toBe(true);
    expect(
      lipuModelKey.getState(ed.state)!.lipu
    ).toEqual(lipu);
    expect(JSON.stringify(ed.getJSON())).toBe(
      JSON.stringify(lipuToContent(lipu))
    );
    expect(guard.verifySpProjection(ed)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never dispatches a ZERO-STEP correction " +
     "(the recursion hazard above)", () => {
    const ed = mkEditor(mkLipu([["toki"]]));
    adopt(ed, mkLipu([["toki", "pona"]]));
    hoisted.zeroStep = true;
    const dispatch = vi.spyOn(ed.view, "dispatch");

    expect(guard.verifySpProjection(ed)).toBe(false);

    expect(dispatch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    dispatch.mockRestore();
  });

  it("is one-shot under RE-ENTRY: a guard call " +
     "from inside the correction dispatches " +
     "nothing", () => {
    const ed = mkEditor(mkLipu([["toki"]]));
    adopt(ed, mkLipu([["toki", "pona"]]));
    let depth = 0;
    let inner: boolean | null = null;
    const real = ed.view.dispatch.bind(ed.view);
    const dispatch = vi
      .spyOn(ed.view, "dispatch")
      .mockImplementation((tr) => {
        depth += 1;
        // the chain re-enters the guard BEFORE the
        // correction has landed, which is exactly
        // the window the latch closes
        if (depth === 1) {
          inner = guard.verifySpProjection(ed);
        }
        real(tr);
      });

    expect(guard.verifySpProjection(ed)).toBe(false);

    expect(inner).toBe(false);
    expect(depth).toBe(1);
    dispatch.mockRestore();
  });

  it("DEFERS to composition end: no dispatch while " +
     "the view is composing; the re-check corrects " +
     "afterwards", () => {
    const ed = mkEditor(mkLipu([["toki"]]));
    const bogus = mkLipu([["toki", "pona"]]);
    adopt(ed, bogus);
    // view.composing is a getter over the input
    // handler's state; shadow it rather than fake an
    // IME session in happy-dom
    let composing = true;
    Object.defineProperty(ed.view, "composing", {
      configurable: true,
      get: () => composing,
    });
    const dispatch = vi.spyOn(ed.view, "dispatch");

    expect(guard.verifySpProjection(ed)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    // a second transaction mid-composition stays
    // quiet too (no warn per keystroke)
    expect(guard.verifySpProjection(ed)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    composing = false;
    ed.view.dom.dispatchEvent(
      new Event("compositionend")
    );

    expect(dispatch).toHaveBeenCalled();
    expect(JSON.stringify(ed.getJSON())).toBe(
      JSON.stringify(lipuToContent(bogus))
    );
    expect(guard.verifySpProjection(ed)).toBe(true);
    dispatch.mockRestore();
  });

  it("is LENGTH-only by design: an equal-length " +
     "divergence passes (the cheap guard's " +
     "accepted blind spot)", () => {
    const ed = mkEditor(mkLipu([["toki"]]));
    const bogus = mkLipu([["pona"]]);
    adopt(ed, bogus);

    expect(guard.verifySpProjection(ed)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
