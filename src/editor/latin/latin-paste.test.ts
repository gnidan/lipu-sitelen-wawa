import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Slice } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import {
  buildLatinPasteFragment,
  buildLatinPasteSliceFromHtml,
} from "./latin-paste";
import { NameAtom } from "./name-atom";
import {
  createLatinEditor,
  flushLatinEdits,
  latinSyncState,
} from "./latin-editor";
import { LineBreaks } from
  "../extensions/line-breaks";
import { LipuModel, lipuModelKey } from
  "../extensions/lipu-model";
import { SitelenPona } from
  "../extensions/sitelen-pona";
import { Verbatim } from
  "../extensions/verbatim";
import {
  LipuHistory,
  lipuHistoryKey,
  sharedUndo,
} from "../extensions/lipu-history";
import { pasteHandlerKey } from
  "../extensions/paste-handler";
import { lipuToContent } from "../lipu-doc";
import {
  emptyBlock,
  renderLatin,
  withMark,
} from "../../lipu";
import type { Block, Lipu } from "../../lipu";
import { MIDDLE_DOT_CH } from "../../lipu/chars";
import {
  codepointToChar,
  wordToCodepoint,
  ZWJ,
} from "../../data";

const glyph = (w: string): string =>
  codepointToChar(wordToCodepoint[w]);

function mkSchemaEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ history: false }),
      NameAtom,
    ],
    content: { type: "doc", content: [] },
  });
}

/** copied from latin-editor.test.ts so this file
 *  stands alone. */
function mkSp(lipu: Lipu): Editor {
  return new Editor({
    extensions: [
      LineBreaks,
      LipuModel.configure({ initialLipu: lipu }),
      StarterKit.configure({ history: false }),
      SitelenPona,
      Verbatim,
    ],
    content: lipuToContent(lipu),
  });
}

function lipu1(latin: string): Lipu {
  return {
    version: 2,
    blocks: [
      {
        anchors: [
          { kind: "word", word: "toki" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: "", latin },
        ],
        spans: [],
      },
    ],
  };
}

function emptyLipu(): Lipu {
  return { version: 2, blocks: [emptyBlock()] };
}

/** mkSp + the shared history, for the group-close
 *  pins below only: the reshape/chip pins above
 *  have no
 *  need of it, and adding it there would be
 *  needless coupling. */
function mkSpWithHistory(lipu: Lipu): Editor {
  return new Editor({
    extensions: [
      LineBreaks,
      LipuHistory,
      LipuModel.configure({ initialLipu: lipu }),
      StarterKit.configure({ history: false }),
      SitelenPona,
      Verbatim,
    ],
    content: lipuToContent(lipu),
  });
}

const doneOf = (sp: Editor) =>
  lipuHistoryKey.getState(sp.state)!.done;

/** The one plugin in the Latin editor's state that
 *  owns handlePaste (latinPaste itself) — used to
 *  drive a GENUINE paste through the real callback
 *  rather than hand-building the transaction it
 *  would produce. */
function findPastePlugin(latin: Editor) {
  return latin.view.state.plugins.find(
    (p) => p.props.handlePaste !== undefined
  )!;
}

function fakePlainTextPaste(
  text: string
): ClipboardEvent {
  return {
    clipboardData: {
      getData: (type: string) =>
        type === "text/plain" ? text : "",
    },
    preventDefault: () => {},
  } as unknown as ClipboardEvent;
}

describe("buildLatinPasteFragment", () => {
  it("UCSUR codepoints are STRIPPED; the " +
     "remainder pastes normally", () => {
    const ed = mkSchemaEditor();
    const frag = buildLatinPasteFragment(
      ed.schema,
      "toki" + glyph("pona") + "pona"
    )!;
    expect(frag.childCount).toBe(1);
    expect(
      frag.child(0).textContent
    ).toBe("tokipona");
    ed.destroy();
  });

  it("blank lines separate paragraphs; single " +
     "newlines become hardBreaks", () => {
    const ed = mkSchemaEditor();
    const frag = buildLatinPasteFragment(
      ed.schema,
      "a\nb\n\nc"
    )!;
    expect(frag.childCount).toBe(2);
    const kinds: string[] = [];
    frag.child(0).forEach((n) =>
      kinds.push(n.type.name)
    );
    expect(kinds).toEqual([
      "text",
      "hardBreak",
      "text",
    ]);
    ed.destroy();
  });

  it("all-UCSUR input strips to nothing and is " +
     "consumed as a no-op (null)", () => {
    const ed = mkSchemaEditor();
    expect(
      buildLatinPasteFragment(
        ed.schema,
        glyph("toki") + glyph("pona")
      )
    ).toBeNull();
    ed.destroy();
  });

  it("MINOR 1: IDEOGRAPHIC_SPACE (U+3000, non-PUA " +
     "SP control char) is also stripped", () => {
    const ed = mkSchemaEditor();
    const frag = buildLatinPasteFragment(
      ed.schema,
      "toki" + String.fromCodePoint(0x3000) + "pona"
    )!;
    expect(frag.childCount).toBe(1);
    expect(
      frag.child(0).textContent
    ).toBe("tokipona");
    ed.destroy();
  });

  it("MINOR 1: a legacy ni+ZWJ+arrow sequence " +
     "(data/ni-directions.ts's UCSUR encoding for " +
     "directional ni variants) loses the ni glyph " +
     "and the ZWJ (both non-Latin SP content) but " +
     "KEEPS the bare arrow — an ordinary Unicode " +
     "symbol, not exclusively SP's, so it survives " +
     "as visible Latin text rather than a " +
     "silently-dropped byte", () => {
    const ed = mkSchemaEditor();
    // upper-right, NI_DIRECTIONS index 6 — a
    // diagonal, so it has no standalone UCSUR
    // codepoint and MUST use the ni+ZWJ+arrow form
    const arrow = "↗";
    const legacy =
      glyph("ni") +
      String.fromCodePoint(ZWJ) +
      arrow;
    const frag = buildLatinPasteFragment(
      ed.schema,
      legacy
    )!;
    expect(frag.childCount).toBe(1);
    expect(frag.child(0).textContent).toBe(arrow);
    ed.destroy();
  });
});

describe("buildLatinPasteSliceFromHtml", () => {
  it("UCSUR embedded in an HTML-only " +
     "clipboard (no text/plain) is stripped " +
     "the same as the plain-text path — the raw " +
     "HTML STRING is cleaned before any DOM/schema " +
     "parsing runs, so this holds regardless of " +
     "where in the markup the glyph sits", () => {
    const ed = mkSchemaEditor();
    const html =
      '<span data-latin-name="" ' +
      'class="latin-name">' +
      glyph("toki") +
      "Toki</span> mi" +
      glyph("pona");
    const slice = buildLatinPasteSliceFromHtml(
      ed.schema,
      html
    )!;
    expect(slice.content.childCount).toBe(1);
    expect(slice.content.child(0).text).toBe(
      "Toki mi"
    );
    ed.destroy();
  });

  it("FIX ROUND 2: an HTML entity-encoded SP-only " +
     "codepoint is caught by the POST-parse pass " +
     "— the pre-parse string strip cannot see it " +
     "(plain ASCII in the raw string; it only " +
     "becomes a real codepoint once the DOM parser " +
     "decodes it, AFTER the pre-parse strip runs)",
     () => {
    const ed = mkSchemaEditor();
    // ZWJ (U+200D) via a 4-hex-digit numeric char
    // ref. NOT a 5-hex-digit UCSUR ref like
    // "&#xf196c;": verified happy-dom (this test's
    // environment) mis-decodes those, truncating to
    // the last 4 hex digits (U+196C, dropping the
    // leading "f") — a real browser / jsdom decodes
    // "&#xf196c;" correctly to U+F196C (confirmed via
    // jsdom directly). A 4-hex-digit SP-only char
    // sidesteps that environment bug while still
    // exercising exactly the entity-decode gap this
    // fix targets.
    const entity = "&#x" + ZWJ.toString(16) + ";";
    const html = "a" + entity + "b";
    const slice = buildLatinPasteSliceFromHtml(
      ed.schema,
      html
    )!;
    expect(slice.content.childCount).toBe(1);
    expect(slice.content.child(0).text).toBe("ab");
    ed.destroy();
  });
});

describe("chip clipboard: copy, cut, paste", () => {
  it("a name atom copies as its plain spelling " +
     "(leafText)", () => {
    const sp = mkSp({
      version: 2,
      blocks: [
        {
          anchors: [
            { kind: "word", word: "toki" },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [
            {
              from: 0,
              to: 0,
              kind: "cartouche",
              side: "both",
            },
          ],
        },
      ],
    });
    const latin = createLatinEditor(sp);
    const text = latin.state.doc.textBetween(
      0,
      latin.state.doc.content.size,
      "\n",
      (leaf) =>
        (leaf.attrs.text as string) ?? ""
    );
    // nameText(["toki"], no nameScheme) ==
    // nameFragment -> w[0] == "t", then the whole
    // joined string is capitalized -> "T"
    // (render-latin.ts's nameText).
    expect(text).toBe("T");
    // and the node type itself serializes text
    const atom = latin.state.doc
      .child(0)
      .child(0);
    expect(atom.type.name).toBe("latinName");
    latin.destroy();
    sp.destroy();
  });

  it("pasting a chip's spelling yields a " +
     "WORD (case facet), not a cartouche — the " +
     "cut-then-paste cartouche loss, pinned", () => {
    const sp = mkSp(lipu1(""));
    const latin = createLatinEditor(sp);
    // simulate cut-then-paste of a chip spelling
    latin.commands.setTextSelection(
      latin.state.doc.content.size
    );
    latin.view.dispatch(
      latin.state.tr.insertText(" Toki")
    );
    const st = lipuModelKey.getState(sp.state)!;
    const last =
      st.lipu.blocks[0].anchors.at(-1)!;
    expect(last).toEqual({
      kind: "word",
      word: "toki",
      case: "capital",
    });
    expect(st.lipu.blocks[0].spans).toEqual([]);
    latin.destroy();
    sp.destroy();
  });

  it("accepted reshape (equal-count " +
     "paste-over-selection): " +
     "reshape): pinned EXACT at editor level", () => {
    const sp = mkSp({
      version: 2,
      blocks: [
        {
          anchors: [
            { kind: "word", word: "toki" },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: ". " },
          ],
          spans: [],
        },
        {
          anchors: [
            { kind: "word", word: "pona" },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
      ],
    });
    const latin = createLatinEditor(sp);
    // select across the boundary and replace
    // with a two-paragraph fragment: count is
    // unchanged -> the equal-count fast path
    const frag = buildLatinPasteFragment(
      latin.schema,
      "mi\n\nsina"
    )!;
    const from = 2; // inside "toki"
    const to =
      latin.state.doc.child(0).nodeSize + 2;
    const tr = latin.state.tr.replace(
      from,
      to,
      Slice.maxOpen(frag)
    );
    tr.setMeta(pasteHandlerKey, {
      paste: true,
    });
    latin.view.dispatch(tr);
    const st = lipuModelKey.getState(sp.state)!;
    // FROZEN golden-master: observed
    // once and pinned exact. The pinned VALUE below
    // is correct; this comment corrects a WRONG
    // earlier derivation (a reader following the
    // old comment would misattribute regressions to
    // gap handling instead of the fusion guard).
    //
    // The replace range [2, 10) keeps the surviving
    // "t" (before it) and "ona" (after it), and
    // DESTROYS everything between: "oki" from
    // "toki", BOTH bytes of the ". " gap (the "."
    // and the space alike — position math: para0's
    // content is "toki. " at PM offsets 0-5, and
    // position 10 lands after consuming offset0
    // ("p") of para1, so [2,10) spans past the
    // entire gap, not just the "."), and "p" from
    // "pona". Instrumented directly
    // (deadSeamOffsets + paragraphLatinInlines on
    // tr.doc before injectFusionSpaces runs): the
    // RAW parse of block 0, with the guard
    // neutralized, is "tmi" — one word, NO space —
    // confirming the gap contributes nothing here.
    // The old para0/para1 boundary (PM position 8)
    // falls inside the deleted range, so it reports
    // as a DEAD SEAM at block 0, offset 1 (between
    // "t" and "mi"); injectFusionSpaces then
    // splices " " in at that offset — precisely
    // because "t" and "mi" are both letter runs that
    // would otherwise silently fuse into "tmi", a
    // real word-boundary corruption. THAT injected
    // space is the " " in "t mi", not a surviving
    // gap byte. "t" alone is not a toki pona word,
    // so it parses VERBATIM; "mi" is, so it parses
    // as a word — the accepted positional-pairing
    // artifact (a single pasted paragraph landing as
    // two anchors, split by the fusion-guard space).
    // Block 1's text is "sina" + "ona" = "sinaona"
    // with no dead seam on that side (the boundary
    // that died was para0/para1, not para1/para2 —
    // there is no para2), so no space is injected
    // there either; it parses as ONE verbatim token
    // (not a recognized word).
    expect(st.lipu).toEqual({
      version: 2,
      blocks: [
        {
          anchors: [
            {
              kind: "verbatim",
              text: "t",
              marked: true,
            },
            { kind: "word", word: "mi" },
          ],
          gaps: [
            { sp: "", latin: "" },
            { sp: "", latin: " " },
            { sp: "", latin: "" },
          ],
          spans: [],
        },
        {
          anchors: [
            {
              kind: "verbatim",
              text: "sinaona",
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
    });
    latin.destroy();
    sp.destroy();
  });
});

describe(
  "the GROUP-CLOSE HOLE, direct half: a Latin " +
    "paste closes the shared-history group",
  () => {
    it(
      "a Latin paste closes the group; a " +
        "keystroke right after does not merge " +
        "back into it",
      () => {
        // EVERY insert here is INSIDE the
        // paragraph (offset 1), same side (latin),
        // inside NEW_GROUP_MS: the block count
        // never moves and the side never
        // switches, so the paste rule is the
        // ONLY rule available to split these
        // three edits into three entries
        // (mirrors lipu-history.test.ts's SP-side
        // "a PASTE closes the group" pin).
        const sp = mkSpWithHistory(lipu1(""));
        const latin = createLatinEditor(sp);
        latin.view.dispatch(
          latin.state.tr.insertText("a", 1)
        );
        expect(doneOf(sp)).toHaveLength(1);
        const tr = latin.state.tr.insertText(
          "b",
          1
        );
        tr.setMeta(pasteHandlerKey, {
          paste: true,
        });
        latin.view.dispatch(tr);
        expect(
          latin.state.doc.childCount
        ).toBe(1);
        expect(doneOf(sp)).toHaveLength(2);
        // the group is CLOSED after the paste: the
        // next keystroke does not merge into it
        latin.view.dispatch(
          latin.state.tr.insertText("c", 1)
        );
        expect(
          latin.state.doc.childCount
        ).toBe(1);
        expect(doneOf(sp)).toHaveLength(3);
        latin.destroy();
        sp.destroy();
      }
    );

    /**
     * THE QUEUED HALF (processFull is the DRAIN,
     * not just the
     * compositionend pass). A paste that lands while
     * the loop is busy — or under an IME — is QUEUED
     * as a flag and drained by a full-doc pass that
     * never sees the original transaction. Before the
     * fix that pass called dispatchSync with no paste
     * argument at all, so the paste meta died on
     * exactly the paths that queue, and the paste
     * coalesced into adjacent typing.
     */
    it(
      "a paste that arrives MID-FLIGHT is drained " +
        "through the full pass and STILL closes " +
        "its group (the queued half)",
      () => {
        const sp = mkSpWithHistory(lipu1(""));
        const latin = createLatinEditor(sp);
        latin.view.dispatch(
          latin.state.tr.insertText("a", 1)
        );
        expect(doneOf(sp)).toHaveLength(1);

        // the loop is busy: this transaction is
        // QUEUED, not processed (same shape as a
        // genuine reentrant arrival)
        const st = latinSyncState(latin)!;
        st.inFlight = true;
        const tr = latin.state.tr.insertText("b", 1);
        tr.setMeta(pasteHandlerKey, { paste: true });
        latin.view.dispatch(tr);
        expect(st.pendingEdit).toBe(true);
        expect(st.pendingPaste).toBe(true);
        // ...and nothing reached the model yet
        expect(doneOf(sp)).toHaveLength(1);

        st.inFlight = false;
        flushLatinEdits(latin);
        // the drain closed the group: two entries,
        // and the flag is consumed
        expect(doneOf(sp)).toHaveLength(2);
        expect(st.pendingPaste).toBe(false);
        // the next keystroke does not merge back in
        latin.view.dispatch(
          latin.state.tr.insertText("c", 1)
        );
        expect(doneOf(sp)).toHaveLength(3);
        latin.destroy();
        sp.destroy();
      }
    );

    it(
      "the queued flag is CONSUMED, not sticky: an " +
        "ordinary queued edit after a drained paste " +
        "does not claim to be one",
      () => {
        const sp = mkSpWithHistory(lipu1(""));
        const latin = createLatinEditor(sp);
        const st = latinSyncState(latin)!;
        st.inFlight = true;
        const tr = latin.state.tr.insertText("a", 1);
        tr.setMeta(pasteHandlerKey, { paste: true });
        latin.view.dispatch(tr);
        st.inFlight = false;
        flushLatinEdits(latin);
        expect(doneOf(sp)).toHaveLength(1);

        // an ordinary QUEUED edit: the paste closed
        // the group, so this one opens its own entry
        st.inFlight = true;
        latin.view.dispatch(
          latin.state.tr.insertText("b", 1)
        );
        expect(st.pendingPaste).toBe(false);
        st.inFlight = false;
        flushLatinEdits(latin);
        expect(doneOf(sp)).toHaveLength(2);

        // ...and a SECOND ordinary queued edit
        // coalesces into it. A sticky flag would tag
        // this drain as a paste too and mint a third
        // entry.
        st.inFlight = true;
        latin.view.dispatch(
          latin.state.tr.insertText("c", 1)
        );
        st.inFlight = false;
        flushLatinEdits(latin);
        expect(doneOf(sp)).toHaveLength(2);
        latin.destroy();
        sp.destroy();
      }
    );
  }
);

describe(
  "the NAME-ATOM parseHTML " +
    "GUARD holds through the Latin paste pipeline",
  () => {
    it(
      "an HTML-only paste (no text/plain) is " +
        "handled by latinPaste's OWN html path " +
        "— UCSUR is " +
        "stripped AND the data-latin-name span " +
        "still degrades to text, no span/atom " +
        "created",
      () => {
        const sp = mkSp(emptyLipu());
        const latin = createLatinEditor(sp);
        const pastePlugin = findPastePlugin(latin);
        // a UCSUR glyph rides both inside the
        // chip's own text and in the surrounding
        // plain text, so this one paste covers
        // both the guard and the strip
        // together, end to end.
        const html =
          '<span data-latin-name="" ' +
          'class="latin-name">' +
          glyph("toki") +
          "Toki</span> mi" +
          glyph("pona");
        const fakeEvent = {
          clipboardData: {
            getData: (type: string) =>
              type === "text/html" ? html : "",
          },
          preventDefault: () => {},
        } as unknown as ClipboardEvent;
        // latinPaste now OWNS every paste, HTML
        // included (Important 1): a text/plain-less
        // clipboard no longer defers to PM's
        // default rich-paste path, because that
        // path never strips SP-only codepoints.
        const handled =
          pastePlugin.props.handlePaste!.call(
            pastePlugin,
            latin.view,
            fakeEvent,
            // ProseMirror passes a Slice; unused by
            // our handler (it reads the event).
            null as never
          );
        expect(handled).toBe(true);
        // No span/atom created (no "latinName"
        // node): the guard degraded it to text,
        // which parses as ordinary words/verbatims
        // — no span created. (name-atom.test.ts
        // pins the
        // guard itself; this pins that the Latin
        // paste plugin does not shadow it.)
        const kinds: string[] = [];
        latin.state.doc
          .child(0)
          .forEach((n) => kinds.push(n.type.name));
        expect(kinds).not.toContain("latinName");
        // and the UCSUR glyphs are GONE, not just
        // invisible: byte-exact, not "toContain".
        expect(
          latin.state.doc.child(0).textContent
        ).toBe("Toki mi");
        latin.destroy();
        sp.destroy();
      }
    );
  }
);

describe(
  "MINOR 2: end-to-end structural paste through " +
    "the REAL handlePaste callback",
  () => {
    it(
      "a genuine multi-paragraph paste (\"mi\\n\\n" +
        "sina\") drives block count 1 -> 2, one " +
        "ParsedSide per pasted paragraph",
      () => {
        const sp = mkSp(emptyLipu());
        const latin = createLatinEditor(sp);
        const pastePlugin = findPastePlugin(latin);
        const before = lipuModelKey.getState(
          sp.state
        )!;
        expect(before.lipu.blocks).toHaveLength(1);
        const handled =
          pastePlugin.props.handlePaste!.call(
            pastePlugin,
            latin.view,
            fakePlainTextPaste("mi\n\nsina"),
            null as never
          );
        expect(handled).toBe(true);
        expect(latin.state.doc.childCount).toBe(2);
        const after = lipuModelKey.getState(
          sp.state
        )!;
        expect(after.lipu.blocks).toHaveLength(2);
        // one ParsedSide per paragraph: each block
        // holds exactly the anchor its OWN paragraph
        // pasted, not a merge/split across the two.
        expect(after.lipu.blocks[0].anchors).toEqual(
          [{ kind: "word", word: "mi" }]
        );
        expect(after.lipu.blocks[1].anchors).toEqual(
          [{ kind: "word", word: "sina" }]
        );
        latin.destroy();
        sp.destroy();
      }
    );
  }
);

describe(
  "paste + undo byte-identity, and the " +
    "paste is its own undo step (group-close)",
  () => {
    it(
      "a structural multi-paragraph paste (covering " +
        "the structural undo path, not just the " +
        "equal-count fast path) carries the " +
        "paste meta on the dispatch lipu-history " +
        "observes, closes the group as its OWN " +
        "entry, and undoes back byte-identically",
      () => {
        const sp = mkSpWithHistory(lipu1(""));
        const latin = createLatinEditor(sp);
        // a prior Latin keystroke opens a group, so
        // "the paste is its own step" is meaningful
        // (coalescing would otherwise merge it in —
        // same side, well inside NEW_GROUP_MS).
        latin.view.dispatch(
          latin.state.tr.insertText("x", 1)
        );
        expect(doneOf(sp)).toHaveLength(1);
        const preSnapshot = JSON.stringify(
          lipuModelKey.getState(sp.state)!.lipu
        );
        // direct pin of the paste meta ITSELF: a
        // structural change closes the history group
        // on its own (block count moves), which would
        // mask a broken meta-forward — so this listens
        // for the meta on the SP dispatch lipu-history
        // actually observes, independent of that.
        let sawPasteMeta = false;
        const listener = ({
          transaction,
        }: {
          transaction: Transaction;
        }): void => {
          if (
            transaction.getMeta(pasteHandlerKey) !==
            undefined
          ) {
            sawPasteMeta = true;
          }
        };
        sp.on("transaction", listener);
        const pastePlugin = findPastePlugin(latin);
        const handled =
          pastePlugin.props.handlePaste!.call(
            pastePlugin,
            latin.view,
            fakePlainTextPaste("mi\n\nsina"),
            null as never
          );
        sp.off("transaction", listener);
        expect(handled).toBe(true);
        expect(sawPasteMeta).toBe(true);
        expect(latin.state.doc.childCount).toBe(2);
        expect(doneOf(sp)).toHaveLength(2);
        // undo restores the pre-paste lipu BYTE-
        // IDENTICALLY, and as ONE step: the prior
        // keystroke survives this undo.
        expect(sharedUndo(sp)).toBe(true);
        expect(
          JSON.stringify(
            lipuModelKey.getState(sp.state)!.lipu
          )
        ).toBe(preSnapshot);
        expect(doneOf(sp)).toHaveLength(1);
        latin.destroy();
        sp.destroy();
      }
    );
  }
);

describe(
  "the paste-over-existing guarantee, end " +
    "to end through the REAL latin paste path",
  () => {
    it(
      "a select-all paste of an externally-reworded " +
        "doc keeps every surviving word's sp gap " +
        "bytes + marks byte-exact; only the " +
        "reworded region's gaps change",
      () => {
        const word = (w: string) =>
          ({ kind: "word", word: w }) as const;
        const g = (sp: string, latin: string) => ({
          sp,
          latin,
        });
        // block 0: AUTHORED sp formatting on both
        // flanks of the phrase that gets reworded —
        // a hand newline up front, a mid-dot +
        // authored latin punctuation at the back.
        const block0: Block = {
          anchors: [
            word("mi"),
            word("sina"),
            word("toki"),
            word("pona"),
            word("mute"),
            word("awen"),
          ],
          gaps: [
            g("", ""),
            withMark(g("\n", " "), "sp", true),
            g(" ", " "),
            g(" ", " "),
            g(" ", " "),
            withMark(
              withMark(
                g(MIDDLE_DOT_CH, ". "),
                "sp",
                true
              ),
              "latin",
              true
            ),
            g("", ""),
          ],
          spans: [],
        };
        // block 1: a second block, left untouched by
        // the reworded region entirely.
        const block1: Block = {
          anchors: [word("jan"), word("lipu")],
          gaps: [g("", ""), g(" ", " "), g("", "")],
          spans: [],
        };
        const lipu: Lipu = {
          version: 2,
          blocks: [block0, block1],
        };
        const beforeText0 = renderLatin(block0)
          .inlines.map((i) => i.text)
          .join("");
        const beforeText1 = renderLatin(block1)
          .inlines.map((i) => i.text)
          .join("");

        const sp = mkSp(lipu);
        const latin = createLatinEditor(sp);
        const before =
          lipuModelKey.getState(sp.state)!.lipu;
        const beforeGaps0 = before.blocks[0].gaps;

        // external-style edit: reword "toki pona"
        // (2 words) into "lukin e kama" (3 words) —
        // a genuine rework, not a same-count swap —
        // while every other word is retyped
        // VERBATIM, as an external editor's re-save
        // would produce.
        const reworded0 = beforeText0.replace(
          /\btoki pona\b/,
          "lukin e kama"
        );
        expect(reworded0).not.toBe(beforeText0);
        const pasteText =
          reworded0 + "\n\n" + beforeText1;

        latin.commands.selectAll();
        const pastePlugin = findPastePlugin(latin);
        const handled =
          pastePlugin.props.handlePaste!.call(
            pastePlugin,
            latin.view,
            fakePlainTextPaste(pasteText),
            null as never
          );
        expect(handled).toBe(true);

        const after =
          lipuModelKey.getState(sp.state)!.lipu;
        // block 1 (nowhere near the reworded
        // region) survives the whole doc-level
        // paste byte-for-byte, marks included.
        expect(after.blocks[1]).toEqual(
          before.blocks[1]
        );
        // block 0: the surviving words are mi,
        // sina, mute, awen (toki/pona are gone,
        // replaced by lukin/e/kama).
        expect(
          after.blocks[0].anchors.map((a) =>
            a.kind === "word" ? a.word : a.kind
          )
        ).toEqual([
          "mi",
          "sina",
          "lukin",
          "e",
          "kama",
          "mute",
          "awen",
        ]);
        const afterGaps0 = after.blocks[0].gaps;
        // the hand-newline gap (mi | sina), FAR
        // from the reworded phrase, survives
        // byte-exact — sp text, latin text, AND
        // the authorship marks on both sides.
        expect(afterGaps0[1]).toEqual(
          beforeGaps0[1]
        );
        // the mid-dot + authored latin punctuation
        // gap (mute | awen) also survives
        // byte-exact — it shifts from index 5 to
        // index 6 because two words were inserted
        // upstream, but its CONTENT is untouched.
        expect(afterGaps0[6]).toEqual(
          beforeGaps0[5]
        );
        // only the reworded region's gap set
        // actually changed (the boundary the
        // deleted "pona" | "mute" gap owned lost
        // its space, replaced by the inserted
        // "kama" | "mute" boundary) — confirming
        // the survivors above are not vacuously
        // trivial (something in this block DID
        // change).
        expect(afterGaps0[5]).not.toEqual(
          beforeGaps0[4]
        );

        latin.destroy();
        sp.destroy();
      }
    );
  }
);
