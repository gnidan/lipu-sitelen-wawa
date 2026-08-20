import React from "react";
import {
  describe,
  it,
  expect,
  afterEach,
} from "vitest";
import {
  render,
  cleanup,
  act,
} from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  SitelenPona,
} from "../extensions/sitelen-pona";
import {
  Autocomplete,
} from "../extensions/autocomplete";
import {
  SelectionMenu,
  createSelectionMenuPlugin,
  selectionMenuPluginKey,
} from "./SelectionMenu";
import type {
  SelectionMenuPluginState,
} from "./SelectionMenu";
import {
  getVariations,
  codepointToChar,
  START_OF_LONG_GLYPH,
  END_OF_LONG_GLYPH,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  STACKING_JOINER,
  ZWJ,
} from "../../data";
import { Verbatim } from "../extensions/verbatim";
import { docToLipu, lipuToContent } from "../lipu-doc";
import { LineBreaks } from "../extensions/line-breaks";
import { focusTracker } from "../focus-tracker";
import {
  LipuModel,
  lipuModelKey,
} from "../extensions/lipu-model";
import { glyph as ucsur } from "../../../test/helpers";

const SelectionMenuExtension = Extension.create({
  name: "selectionMenuPlugin",
  addProseMirrorPlugins() {
    return [createSelectionMenuPlugin()];
  },
});

function createEditor(content = "") {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      Autocomplete,
      SelectionMenuExtension,
    ],
    content,
  });
}

function mockCoordsAtPos(editor: Editor) {
  (editor as any).view.coordsAtPos = () => ({
    left: 100,
    right: 110,
    top: 190,
    bottom: 200,
  });
}

/** The shared mount sequence: stub coords, render
 *  the menu over `editor`, hand back the render
 *  result for container queries. */
function mountMenu(editor: Editor) {
  mockCoordsAtPos(editor);
  return render(
    <SelectionMenu editor={editor as any} />
  );
}

function mockAnalysis(overrides: any = {}) {
  return {
    text: "\uD83C",
    from: 1,
    to: 3,
    singleGlyphWithVariants: {
      word: "ni",
      currentIndex: 1,
    },
    containsUcsur: true,
    containsLatin: false,
    isSingleParagraph: true,
    glyphCount: 1,
    firstGlyphWord: "ni",
    secondGlyphWord: null,
    hasStackingJoiner: false,
    hasScalingJoiner: false,
    hasLongGlyphMarkers: false,
    hasCartoucheMarkers: false,
    insideCartouche: null,
    insideLongGlyph: null,
    adjacentLongGlyph: null,
    precedingLongGlyph: null,
    longGlyphContainerWord: null,
    cartoucheContentPreview: null,
    verbatimPreview: "ni",
    sitelenPonaPreview: null,
    ...overrides,
  };
}

describe("SelectionMenu", () => {
  afterEach(cleanup);

  it(
    "does not render without selection",
    () => {
      const editor = createEditor("<p></p>");
      const { container } = render(
        <SelectionMenu
          editor={editor as any}
        />
      );
      expect(
        container.querySelector(
          ".selection-menu"
        )
      ).toBeNull();
      editor.destroy();
    }
  );

  it(
    "renders variant grid when single glyph " +
      "with variants is set via meta",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");
      const { container } = mountMenu(editor);

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          mockAnalysis()
        );
        editor.view.dispatch(tr);
      });

      const menu = container.querySelector(
        ".selection-menu"
      );
      expect(menu).toBeTruthy();

      const variations = getVariations("ni");
      const buttons = container.querySelectorAll(
        ".variant-row__btn"
      );
      // "ni" has no default option (variant 4 is
      // the default glyph), so count = variations
      expect(buttons.length).toBe(
        variations.length
      );
      editor.destroy();
    }
  );

  it(
    "hides menu when dismissed via meta",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");
      const { container } = mountMenu(editor);

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          mockAnalysis()
        );
        editor.view.dispatch(tr);
      });

      expect(
        container.querySelector(
          ".selection-menu"
        )
      ).toBeTruthy();

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          null
        );
        editor.view.dispatch(tr);
      });

      expect(
        container.querySelector(
          ".selection-menu"
        )
      ).toBeNull();
      editor.destroy();
    }
  );

  it(
    "shows only variation buttons (no default)",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("jaki");
      const { container } = mountMenu(editor);

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          mockAnalysis({
            singleGlyphWithVariants: {
              word: "jaki",
              currentIndex: 1,
            },
            firstGlyphWord: "jaki",
            verbatimPreview: "jaki",
          })
        );
        editor.view.dispatch(tr);
      });

      const defaultBtn = container.querySelector(
        '[title="Default"]'
      );
      expect(defaultBtn).toBeNull();

      const buttons = container.querySelectorAll(
        ".variant-row__btn"
      );
      const variations = getVariations("jaki");
      expect(buttons.length).toBe(
        variations.length
      );
      editor.destroy();
    }
  );

  it(
    "plugin state contains actions array",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          mockAnalysis({
            glyphCount: 1,
            containsUcsur: true,
          })
        );
        editor.view.dispatch(tr);
      });

      const st =
        selectionMenuPluginKey.getState(
          editor.state
        ) as SelectionMenuPluginState;

      expect(st.analysis).toBeTruthy();
      expect(st.actions).toBeDefined();
      expect(
        Array.isArray(st.actions)
      ).toBe(true);
      // -1 = variant row is active initially
      expect(st.activeActionIndex).toBe(-1);
      editor.destroy();
    }
  );

  it(
    "ArrowDown meta advances activeActionIndex",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");

      // Set up with analysis that has actions
      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          mockAnalysis({
            glyphCount: 1,
            containsUcsur: true,
            verbatimPreview: "ni",
          })
        );
        editor.view.dispatch(tr);
      });

      const st1 =
        selectionMenuPluginKey.getState(
          editor.state
        ) as SelectionMenuPluginState;

      if (st1.actions.length < 1) {
        // Not enough actions to test nav
        editor.destroy();
        return;
      }

      // -1 = variant row initially
      expect(st1.activeActionIndex).toBe(-1);

      // Dispatch ArrowDown navigate meta
      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          {
            navigate: true,
            activeActionIndex: 0,
          }
        );
        editor.view.dispatch(tr);
      });

      const st2 =
        selectionMenuPluginKey.getState(
          editor.state
        ) as SelectionMenuPluginState;
      expect(st2.activeActionIndex).toBe(0);

      editor.destroy();
    }
  );

  it(
    "null meta resets plugin state",
    () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          mockAnalysis()
        );
        editor.view.dispatch(tr);
      });

      const st1 =
        selectionMenuPluginKey.getState(
          editor.state
        ) as SelectionMenuPluginState;
      expect(st1.analysis).toBeTruthy();

      act(() => {
        const tr = editor.state.tr.setMeta(
          selectionMenuPluginKey,
          null
        );
        editor.view.dispatch(tr);
      });

      const st2 =
        selectionMenuPluginKey.getState(
          editor.state
        ) as SelectionMenuPluginState;
      expect(st2.analysis).toBeNull();
      expect(st2.actions).toEqual([]);
      expect(st2.activeActionIndex).toBe(0);

      editor.destroy();
    }
  );
});

// ── hardBreak-safe offsets (no split surrogates) ──

const LONG_START = codepointToChar(
  START_OF_LONG_GLYPH
);
const LONG_END = codepointToChar(END_OF_LONG_GLYPH);

/**
 * One "line" shape used by these fixtures: a
 * container glyph immediately followed by a long
 * glyph wrap (container(inner)).
 */
function longGlyphLine(
  container: string,
  inner: string
): string {
  return (
    ucsur(container) +
    LONG_START +
    ucsur(inner) +
    LONG_END
  );
}

/**
 * Scan derived strings for isolated UTF-16
 * surrogate halves — the visible symptom of an
 * offset that split a UCSUR glyph's surrogate pair
 * — and for the leaf placeholder character
 * (U+FFFC), which must never reach user-visible
 * text.
 */
function assertNoCorruption(
  strings: Array<string | null | undefined>
): void {
  for (const s of strings) {
    if (!s) continue;
    expect(s.includes("￼")).toBe(false);
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = s.charCodeAt(i + 1);
        const isPair =
          next >= 0xdc00 && next <= 0xdfff;
        expect(isPair).toBe(true);
        if (isPair) i++; // consumed as a pair
      } else if (
        code >= 0xdc00 &&
        code <= 0xdfff
      ) {
        // Reached without being consumed above as
        // the tail of a pair: it's lone.
        expect(
          `lone low surrogate in ${
            JSON.stringify(s)
          }`
        ).toBe(null);
      }
    }
  }
}

function derivedStrings(
  analysis: NonNullable<
    SelectionMenuPluginState["analysis"]
  >
): Array<string | null | undefined> {
  return [
    analysis.text,
    analysis.verbatimPreview,
    analysis.sitelenPonaPreview,
    analysis.cartoucheContentPreview,
    analysis.longGlyphContentPreview,
    analysis.longGlyphTailHeadPreview,
    analysis.adjacentLongGlyphPreview,
    analysis.firstGlyphWord,
    analysis.secondGlyphWord,
    analysis.longGlyphContainerWord,
    analysis.precedingLongGlyph?.word,
  ];
}

function analyzeAt(
  editor: Editor,
  from: number,
  to: number
): NonNullable<SelectionMenuPluginState["analysis"]> {
  act(() => {
    editor.commands.setTextSelection({ from, to });
  });
  const st = selectionMenuPluginKey.getState(
    editor.state
  ) as SelectionMenuPluginState;
  expect(st.analysis).toBeTruthy();
  return st.analysis!;
}

describe(
  "SelectionMenu hardBreak-safe offsets",
  () => {
    afterEach(cleanup);

    it(
      "selection spanning a break: no lone " +
        "surrogates or U+FFFC in derived strings",
      () => {
        const line1 = longGlyphLine(
          "toki", "pona"
        );
        const line2 = longGlyphLine(
          "mute", "suli"
        );
        const editor = createEditor(
          `<p>${line1}<br>${line2}</p>`
        );

        const line2Start =
          1 + line1.length + 1;

        // From just after line1's START marker
        // (start of "pona") to just after line2's
        // "mute" glyph (before its START marker) —
        // crosses line1's END, the hardBreak, and
        // into line2.
        const from =
          1 +
          ucsur("toki").length +
          LONG_START.length;
        const to =
          line2Start + ucsur("mute").length;

        const analysis = analyzeAt(
          editor, from, to
        );
        assertNoCorruption(
          derivedStrings(analysis)
        );

        editor.destroy();
      }
    );

    it(
      "selection entirely after a break: no " +
        "corruption, and extracted text matches " +
        "the selected glyph exactly",
      () => {
        const line1 = longGlyphLine(
          "toki", "pona"
        );
        const line2 = longGlyphLine(
          "mute", "suli"
        );
        const editor = createEditor(
          `<p>${line1}<br>${line2}</p>`
        );

        const line2Start =
          1 + line1.length + 1;
        // The "suli" glyph, inside line2's long
        // glyph wrap.
        const from =
          line2Start +
          ucsur("mute").length +
          LONG_START.length;
        const to = from + ucsur("suli").length;

        const analysis = analyzeAt(
          editor, from, to
        );
        assertNoCorruption(
          derivedStrings(analysis)
        );

        // The wrap was correctly resolved against
        // line 2's content, not shifted into line
        // 1's by the hardBreak.
        expect(
          analysis.longGlyphContainerWord
        ).toBe("mute");
        expect(
          editor.state.doc.textBetween(
            analysis.from, analysis.to
          )
        ).toBe(ucsur("suli"));

        editor.destroy();
      }
    );

    it(
      "no-break control: behavior unchanged",
      () => {
        const line1 = longGlyphLine(
          "toki", "pona"
        );
        const editor = createEditor(
          `<p>${line1}</p>`
        );

        const from =
          1 +
          ucsur("toki").length +
          LONG_START.length;
        const to = from + ucsur("pona").length;

        const analysis = analyzeAt(
          editor, from, to
        );
        assertNoCorruption(
          derivedStrings(analysis)
        );

        expect(
          analysis.longGlyphContainerWord
        ).toBe("toki");
        expect(
          editor.state.doc.textBetween(
            analysis.from, analysis.to
          )
        ).toBe(ucsur("pona"));

        editor.destroy();
      }
    );
  }
);

// ── Actions preserve soft breaks ──────────────────

const BREAK = "￼";
const CART_START = codepointToChar(
  START_OF_CARTOUCHE
);
const CART_END = codepointToChar(END_OF_CARTOUCHE);
const STACK = codepointToChar(STACKING_JOINER);
const JOIN = codepointToChar(ZWJ);

function createFullEditor(content = "") {
  return new Editor({
    extensions: [
      StarterKit,
      SitelenPona,
      Autocomplete,
      Verbatim,
      SelectionMenuExtension,
    ],
    content,
  });
}

/**
 * Build a single-paragraph HTML fixture from
 * pieces (plain strings, or "BR" for a hardBreak),
 * along with the doc position immediately after
 * each piece — so tests can address "the boundary
 * right after piece N" without hand-computing
 * surrogate-pair-aware offsets.
 */
function buildFixture(
  pieces: Array<string | "BR">
): { html: string; posAfter: number[] } {
  let html = "";
  let pos = 1; // start of paragraph content
  const posAfter: number[] = [];
  for (const p of pieces) {
    if (p === "BR") {
      html += "<br>";
      pos += 1;
    } else {
      html += p;
      pos += p.length;
    }
    posAfter.push(pos);
  }
  return { html: `<p>${html}</p>`, posAfter };
}

function docBreakCount(editor: Editor): number {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "hardBreak") count++;
  });
  return count;
}

/**
 * Whole-document text, with hardBreaks projected
 * to `BREAK` so the assertion can check break
 * position without a separate node count.
 */
function docPlainText(editor: Editor): string {
  return editor.state.doc.textBetween(
    0,
    editor.state.doc.content.size,
    "\n",
    BREAK
  );
}

/**
 * Select [from, to), confirm `actionId` is offered
 * by the real analysis for that selection (so the
 * test fails loudly if the fixture stops matching
 * the action's visibility gating), then execute it
 * through the same meta-dispatch path the plugin's
 * keyboard shortcuts use.
 */
function runAction(
  editor: Editor,
  from: number,
  to: number,
  actionId: string
): void {
  act(() => {
    editor.commands.setTextSelection({ from, to });
  });
  const st = selectionMenuPluginKey.getState(
    editor.state
  ) as SelectionMenuPluginState;
  expect(st.actions).toContain(actionId);
  act(() => {
    const tr = editor.state.tr.setMeta(
      selectionMenuPluginKey,
      { executeAction: actionId }
    );
    editor.view.dispatch(tr);
  });
}

/**
 * Drive an action from a hand-built
 * `SelectionAnalysis` (via `mockAnalysis`) instead
 * of a real selection. Some branches of
 * `wrapInLongGlyph` — notably the "adjacent after"
 * one — are only reachable through a raw analysis:
 * `expandSelectionRange` unconditionally swallows a
 * selection ending right at an existing
 * START_OF_LONG_GLYPH/START_OF_CARTOUCHE marker into
 * a "selected" `insideLongGlyph`/`insideCartouche`
 * before `adjacentLongGlyph` "after" detection ever
 * runs (verified empirically), so no real selection
 * can produce that shape. Injecting the analysis
 * directly still exercises the real (unexported)
 * `performAction` / `wrapInLongGlyph`, matching how
 * `handleKeyDown` and the menu's click handler
 * dispatch actions — it only bypasses
 * `analyzeSelection` itself, which is out of scope
 * for this task and already covered elsewhere.
 */
function runActionOnAnalysis(
  editor: Editor,
  overrides: Record<string, unknown>,
  actionId: string
): void {
  act(() => {
    const tr = editor.state.tr.setMeta(
      selectionMenuPluginKey,
      mockAnalysis(overrides)
    );
    editor.view.dispatch(tr);
  });
  const st = selectionMenuPluginKey.getState(
    editor.state
  ) as SelectionMenuPluginState;
  expect(st.actions).toContain(actionId);
  act(() => {
    const tr = editor.state.tr.setMeta(
      selectionMenuPluginKey,
      { executeAction: actionId }
    );
    editor.view.dispatch(tr);
  });
}

describe(
  "SelectionMenu actions preserve soft breaks",
  () => {
    afterEach(cleanup);

    it(
      "CONFIRMED REPRO: convertToVerbatim over " +
        "toki<br>pona keeps the break",
      () => {
        const { html, posAfter } = buildFixture([
          ucsur("toki"),
          "BR",
          ucsur("pona"),
        ]);
        const editor = createFullEditor(html);
        mountMenu(editor);

        runAction(
          editor,
          1,
          posAfter[2],
          "convertToVerbatim"
        );

        expect(docBreakCount(editor)).toBe(1);
        expect(docPlainText(editor)).toBe(
          "toki" + BREAK + "pona"
        );
        const markType =
          editor.schema.marks.verbatim;
        let allMarked = true;
        editor.state.doc.descendants((node) => {
          if (
            node.isText &&
            !markType.isInSet(node.marks)
          ) {
            allMarked = false;
          }
        });
        expect(allMarked).toBe(true);

        // The hardBreak must NOT carry the mark.
        // ProseMirror's addMark checks the PARENT's
        // allowsMarkType, not the child's, so a
        // range-wide addMark happily marks a
        // hardBreak too. lipuToContent never
        // produces a marked hardBreak, so that would
        // desync this doc from its lipu mirror.
        let breakHasMark = false;
        editor.state.doc.descendants((node) => {
          if (
            node.type.name === "hardBreak" &&
            markType.isInSet(node.marks)
          ) {
            breakHasMark = true;
          }
        });
        expect(breakHasMark).toBe(false);

        editor.destroy();
      }
    );

    it(
      "convertToVerbatim over toki<br>pona stays " +
        "byte-equivalent to lipuToContent(docToLipu" +
        "(doc)) — the exact invariant a marked " +
        "hardBreak would violate",
      () => {
        const { html, posAfter } = buildFixture([
          ucsur("toki"),
          "BR",
          ucsur("pona"),
        ]);
        const editor = createFullEditor(html);
        mountMenu(editor);

        runAction(
          editor,
          1,
          posAfter[2],
          "convertToVerbatim"
        );

        const viaLipu = lipuToContent(
          docToLipu(editor.state.doc)
        );
        expect(
          JSON.stringify(editor.getJSON())
        ).toBe(JSON.stringify(viaLipu));

        editor.destroy();
      }
    );

    it(
      "CONFIRMED REPRO: unwrapLongGlyph over " +
        "toki(pona<br>suli) keeps the break",
      () => {
        const { html, posAfter } = buildFixture([
          ucsur("toki"),
          LONG_START,
          ucsur("pona"),
          "BR",
          ucsur("suli"),
          LONG_END,
        ]);
        const editor = createEditor(html);
        mountMenu(editor);

        // Select "pona<br>suli" — inside the parens.
        runAction(
          editor,
          posAfter[1],
          posAfter[4],
          "unwrapLongGlyph"
        );

        expect(docBreakCount(editor)).toBe(1);
        expect(docPlainText(editor)).toBe(
          ucsur("toki") +
            ucsur("pona") +
            BREAK +
            ucsur("suli")
        );

        editor.destroy();
      }
    );

    it(
      "wrapCartouche over toki<br>pona wraps the " +
        "whole range and keeps the break",
      () => {
        const { html, posAfter } = buildFixture([
          ucsur("toki"),
          "BR",
          ucsur("pona"),
        ]);
        const editor = createEditor(html);
        mountMenu(editor);

        runAction(
          editor,
          1,
          posAfter[2],
          "wrapCartouche"
        );

        expect(docBreakCount(editor)).toBe(1);
        expect(docPlainText(editor)).toBe(
          CART_START +
            ucsur("toki") +
            BREAK +
            ucsur("pona") +
            CART_END
        );

        editor.destroy();
      }
    );

    it(
      "unwrapCartouche over [toki<br>pona] keeps " +
        "the break",
      () => {
        const { html, posAfter } = buildFixture([
          CART_START,
          ucsur("toki"),
          "BR",
          ucsur("pona"),
          CART_END,
        ]);
        const editor = createEditor(html);
        mountMenu(editor);

        runAction(
          editor,
          1,
          posAfter[4],
          "unwrapCartouche"
        );

        expect(docBreakCount(editor)).toBe(1);
        expect(docPlainText(editor)).toBe(
          ucsur("toki") + BREAK + ucsur("pona")
        );

        editor.destroy();
      }
    );

    it(
      "wrapLongGlyph over lon<br>pona (first " +
        "glyph as container) keeps the break",
      () => {
        // "lon" is a long-glyph-capable word (see
        // currentFont.longGlyphWords); "toki" is
        // not, so it can't drive wrapLongGlyph's
        // visibility gating here.
        const { html, posAfter } = buildFixture([
          ucsur("lon"),
          "BR",
          ucsur("pona"),
        ]);
        const editor = createEditor(html);
        mountMenu(editor);

        runAction(
          editor,
          1,
          posAfter[2],
          "wrapLongGlyph"
        );

        expect(docBreakCount(editor)).toBe(1);
        expect(docPlainText(editor)).toBe(
          ucsur("lon") +
            LONG_START +
            BREAK +
            ucsur("pona") +
            LONG_END
        );

        editor.destroy();
      }
    );

    it(
      "wrapLongGlyph 'adjacent before' branch: " +
        "lon(pona)mute<br>suli, extending the " +
        "existing wrap over mute<br>suli, keeps " +
        "the break",
      () => {
        const { html, posAfter } = buildFixture([
          ucsur("lon"),
          LONG_START,
          ucsur("pona"),
          LONG_END,
          ucsur("mute"),
          "BR",
          ucsur("suli"),
        ]);
        const editor = createEditor(html);
        mountMenu(editor);

        // Select "mute<br>suli" — immediately after
        // the existing long glyph's END marker.
        runAction(
          editor,
          posAfter[3],
          posAfter[6],
          "wrapLongGlyph"
        );

        expect(docBreakCount(editor)).toBe(1);
        expect(docPlainText(editor)).toBe(
          ucsur("lon") +
            LONG_START +
            ucsur("pona") +
            ucsur("mute") +
            BREAK +
            ucsur("suli") +
            LONG_END
        );

        editor.destroy();
      }
    );

    it(
      "wrapLongGlyph 'adjacent after' branch: " +
        "<br>mute(pona), extending the existing " +
        "wrap backward over <br>mute, keeps the " +
        "break",
      () => {
        // Unreachable via a real selection (see
        // runActionOnAnalysis) — driven from a
        // hand-built analysis instead.
        const { html, posAfter } = buildFixture([
          "BR",
          ucsur("mute"),
          LONG_START,
          ucsur("pona"),
          LONG_END,
        ]);
        const editor = createEditor(html);
        mountMenu(editor);

        runActionOnAnalysis(
          editor,
          {
            from: 1,
            to: posAfter[1],
            text: BREAK + "mute",
            containsUcsur: true,
            isSingleParagraph: true,
            glyphCount: 1,
            firstGlyphWord: "mute",
            hasCartoucheMarkers: false,
            hasLongGlyphMarkers: false,
            insideCartouche: null,
            insideLongGlyph: null,
            precedingLongGlyph: null,
            adjacentLongGlyph: {
              side: "after",
              markerPos: posAfter[1],
            },
            singleGlyphWithVariants: null,
            verbatimPreview: "mute",
          },
          "wrapLongGlyph"
        );

        expect(docBreakCount(editor)).toBe(1);
        expect(docPlainText(editor)).toBe(
          LONG_START +
            BREAK +
            ucsur("mute") +
            ucsur("pona") +
            LONG_END
        );

        editor.destroy();
      }
    );

    it(
      "wrapLongGlyph 'preceding glyph container' " +
        "branch: lon mute<br>pona, wrapping " +
        "mute<br>pona under the preceding lon, " +
        "keeps the break",
      () => {
        const { html, posAfter } = buildFixture([
          ucsur("lon"),
          ucsur("mute"),
          "BR",
          ucsur("pona"),
        ]);
        const editor = createEditor(html);
        mountMenu(editor);

        // Select "mute<br>pona" — "lon" (a
        // long-glyph-capable word) immediately
        // precedes the selection and becomes the
        // container.
        runAction(
          editor,
          posAfter[0],
          posAfter[3],
          "wrapLongGlyph"
        );

        expect(docBreakCount(editor)).toBe(1);
        expect(docPlainText(editor)).toBe(
          ucsur("lon") +
            LONG_START +
            ucsur("mute") +
            BREAK +
            ucsur("pona") +
            LONG_END
        );

        editor.destroy();
      }
    );

    it(
      "shrinkLongGlyphTail preserves a break " +
        "inside the shrinking tail",
      () => {
        // toki(mute<br>pona<br>suli) — tail
        // selection is "pona<br>suli", head "mute"
        // (+ its break) stays inside the wrap.
        const { html, posAfter } = buildFixture([
          ucsur("toki"),
          LONG_START,
          ucsur("mute"),
          "BR",
          ucsur("pona"),
          "BR",
          ucsur("suli"),
          LONG_END,
        ]);
        const editor = createEditor(html);
        mountMenu(editor);

        runAction(
          editor,
          posAfter[3],
          posAfter[6],
          "unwrapLongGlyph"
        );

        expect(docBreakCount(editor)).toBe(2);
        expect(docPlainText(editor)).toBe(
          ucsur("toki") +
            LONG_START +
            ucsur("mute") +
            BREAK +
            LONG_END +
            ucsur("pona") +
            BREAK +
            ucsur("suli")
        );

        editor.destroy();
      }
    );

    it(
      "unstack (removeJoiners) over " +
        "toki-STACK<br>pona strips the joiner and " +
        "keeps the break",
      () => {
        const { html, posAfter } = buildFixture([
          ucsur("toki"),
          STACK,
          "BR",
          ucsur("pona"),
        ]);
        const editor = createEditor(html);
        mountMenu(editor);

        runAction(editor, 1, posAfter[3], "unstack");

        expect(docBreakCount(editor)).toBe(1);
        expect(docPlainText(editor)).toBe(
          ucsur("toki") + BREAK + ucsur("pona")
        );

        editor.destroy();
      }
    );

    it(
      "join across a break: one glyph per line " +
        "segment stays un-joined, break intact " +
        "(joiner-segmentation, no-joiner case)",
      () => {
        const { html, posAfter } = buildFixture([
          ucsur("toki"),
          "BR",
          ucsur("pona"),
        ]);
        const editor = createEditor(html);
        mountMenu(editor);

        runAction(editor, 1, posAfter[2], "stack");

        expect(docBreakCount(editor)).toBe(1);
        // No joiner: each line segment has only 1
        // glyph, so there is nothing to join within
        // either segment, and the break stays
        // un-joined between them.
        expect(docPlainText(editor)).toBe(
          ucsur("toki") + BREAK + ucsur("pona")
        );

        editor.destroy();
      }
    );

    it(
      "join across a break: a two-glyph segment " +
        "still joins within itself, break intact " +
        "(joiner-segmentation, joins-within case)",
      () => {
        const { html, posAfter } = buildFixture([
          "BR",
          ucsur("toki"),
          ucsur("pona"),
        ]);
        const editor = createEditor(html);
        mountMenu(editor);

        runAction(editor, 1, posAfter[2], "join");

        expect(docBreakCount(editor)).toBe(1);
        expect(docPlainText(editor)).toBe(
          BREAK +
            ucsur("toki") +
            JOIN +
            ucsur("pona")
        );

        editor.destroy();
      }
    );

    it(
      "convertToSP (fromVerbatim) over a " +
        "verbatim toki<br>pona keeps the break",
      () => {
        const { html, posAfter } = buildFixture([
          "toki",
          "BR",
          "pona",
        ]);
        const editor = createFullEditor(html);
        const markType =
          editor.schema.marks.verbatim;
        const tr = editor.state.tr.addMark(
          1,
          posAfter[2],
          markType.create()
        );
        editor.view.dispatch(tr);
        mountMenu(editor);

        runAction(
          editor, 1, posAfter[2], "convertToSP"
        );

        expect(docBreakCount(editor)).toBe(1);
        expect(docPlainText(editor)).toBe(
          ucsur("toki") + BREAK + ucsur("pona")
        );
        let anyMarked = false;
        editor.state.doc.descendants((node) => {
          if (
            node.isText &&
            markType.isInSet(node.marks)
          ) {
            anyMarked = true;
          }
        });
        expect(anyMarked).toBe(false);

        editor.destroy();
      }
    );
  }
);

// ── action -> normalizer chain (pinned) ──────────

/**
 * Editor with LineBreaks (the empty-line normalizer) and
 * LipuModel wired in, matching the real app's
 * extension list closely enough to exercise the full
 * chain: a SelectionMenu action's transaction runs,
 * then LineBreaks' appendTransaction fires on the
 * result, then LipuModel's apply runs again for that
 * appended transaction.
 */
function createChainEditor(content = "") {
  return new Editor({
    extensions: [
      // LineBreaks FIRST, mirroring Editor.tsx:
      // TipTap reverses declaration order, so this
      // gives every UI Enter handler (selection
      // menu) precedence over the soft-break
      // fallback. This ordering is the contract
      // under test in the menu-open Enter pin.
      LineBreaks,
      LipuModel.configure({ initialLipu: null }),
      StarterKit,
      SitelenPona,
      Autocomplete,
      SelectionMenuExtension,
    ],
    content,
  });
}

/** Dispatch a keydown through the plugin chain in
 *  state order, first-true wins (mirrors
 *  ProseMirror's someProp dispatch). */
function chainKeyDown(
  editor: Editor,
  key: string
): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
  });
  for (const plugin of
    editor.view.state.plugins) {
    const handler = plugin.props.handleKeyDown;
    if (handler) {
      const result = handler.call(
        plugin,
        editor.view,
        event
      );
      if (result) return true;
    }
  }
  return false;
}

describe(
  "action -> normalizer chain converges (pinned)",
  () => {
    afterEach(cleanup);

    it(
      "unwrapCartouche leaving two adjacent " +
        "breaks is split into two paragraphs by " +
        "the LineBreaks normalizer, and LipuModel " +
        "converges to match",
      () => {
        // BR, then a cartouche whose own first
        // content is a BR: [BR][BR pona]. Unwrapping
        // the cartouche strips only its markers, so
        // the outer BR and the cartouche's inner BR
        // become adjacent -- an "empty line" the
        // normalizer must turn into a paragraph
        // split rather than leave as two breaks in a
        // row.
        const { html, posAfter } = buildFixture([
          "BR",
          CART_START,
          "BR",
          ucsur("pona"),
          CART_END,
        ]);
        const editor = createChainEditor(html);
        mountMenu(editor);

        runAction(
          editor,
          posAfter[0],
          posAfter[4],
          "unwrapCartouche"
        );

        // COMPOSITION DWELL: the action leaves the
        // selection ON the freshly adjacent breaks,
        // so the normalizer waits. Moving the caret
        // clear of the run (to the end of the
        // paragraph's content) is the "leave"
        // transaction the split crystallizes on.
        expect(editor.state.doc.childCount).toBe(1);
        act(() => {
          editor.commands.setTextSelection(
            editor.state.doc.content.size - 1
          );
        });

        // The normalizer consumed the two adjacent
        // breaks as an empty-line signal and split
        // the paragraph there, rather than leaving
        // them adjacent in a single paragraph.
        expect(editor.state.doc.childCount).toBe(2);
        expect(docBreakCount(editor)).toBe(0);
        expect(
          editor.state.doc.child(0).content.size
        ).toBe(0);
        expect(
          editor.state.doc.child(1).textContent
        ).toBe(ucsur("pona"));

        // LipuModel (maintained incrementally via
        // structuralMerge across both the action's
        // transaction and the normalizer's follow-up
        // transaction) converges to the same shape
        // as a fresh derive from the doc -- no
        // leftover adjacent-break representation and
        // no stray companion "\n" latin content.
        const modelState = lipuModelKey.getState(
          editor.state
        );
        expect(modelState).toBeTruthy();
        const lipu = modelState!.lipu;
        expect(lipu.blocks.length).toBe(2);
        // Latin-side content lives in gap.latin,
        // so "no stray companion" is "no gap carries
        // a newline the split should have consumed"
        // (both runs consumed).
        for (const block of lipu.blocks) {
          for (const gap of block.gaps) {
            expect(gap.latin).not.toContain("\n");
          }
        }
        expect(
          JSON.stringify(lipuToContent(lipu))
        ).toBe(JSON.stringify(editor.getJSON()));
        expect(
          JSON.stringify(lipuToContent(lipu))
        ).toBe(
          JSON.stringify(
            lipuToContent(docToLipu(editor.state.doc))
          )
        );

        editor.destroy();
      }
    );

    it(
      "Enter with the selection menu open is " +
        "consumed by the menu, never the " +
        "soft-break keymap (precedence pin)",
      () => {
        // Regression: LineBreaks declared AFTER
        // SelectionMenuExtension gave the
        // soft-break handler precedence, so Enter
        // on an open menu inserted a newline
        // instead of accepting the highlighted
        // item. The fixed declaration order
        // (LineBreaks first, mirroring Editor.tsx)
        // is what this pin protects. Verified to
        // fail with the reversed order.
        const editor = createChainEditor("<p></p>");
        editor.commands.insertSitelenPona("ni");
        mountMenu(editor);

        act(() => {
          const tr = editor.state.tr.setMeta(
            selectionMenuPluginKey,
            mockAnalysis()
          );
          editor.view.dispatch(tr);
        });

        const handled = chainKeyDown(
          editor,
          "Enter"
        );

        // The menu consumed the key: no soft break
        // entered the document and no paragraph
        // split occurred. (Pre-fix: docBreakCount
        // was 1 -- LineBreaks fired first.)
        expect(handled).toBe(true);
        expect(docBreakCount(editor)).toBe(0);
        expect(editor.state.doc.childCount).toBe(1);

        editor.destroy();
      }
    );
  }
);

/**
 * The menu's blur consumer joins
 * the other two SP blur dispatches on the
 * FocusTracker's settle. It no longer guesses with
 * requestAnimationFrame + editor.isFocused — the
 * tracker is the authority on where focus went, and
 * "went nowhere" is only knowable one microtask
 * later.
 */
describe("SelectionMenu focus rules", () => {
  afterEach(() => {
    cleanup();
    focusTracker.reset();
  });

  const settle = (): Promise<void> =>
    new Promise((r) => queueMicrotask(() => r()));
  const frame = (): Promise<void> =>
    new Promise((r) =>
      requestAnimationFrame(() => r())
    );

  /** the editor's own blur EVENT, without the DOM
   *  event's selection side effects (a real blur
   *  drives a ProseMirror selection sync, which
   *  clears the plugin analysis this fixture set by
   *  meta — the consumer under test here is the
   *  editor.on("blur") one). */
  function emitBlur(editor: Editor): void {
    (editor as unknown as {
      emit: (
        name: string,
        props: unknown
      ) => void;
    }).emit("blur", {
      editor,
      event: new FocusEvent("blur"),
      transaction: editor.state.tr,
    });
  }

  /** TipTap dispatches one deferred transaction of
   *  its own from the Editor constructor (a
   *  setTimeout that calls commands.focus); it
   *  recomputes the plugin analysis and would tear
   *  the fixture's meta-injected menu down mid-test.
   *  Let it happen BEFORE the menu is shown. */
  const tick = (): Promise<void> =>
    new Promise((r) => setTimeout(() => r(), 0));

  async function showMenu(editor: Editor) {
    await tick();
    mockCoordsAtPos(editor);
    const rendered = render(
      <SelectionMenu editor={editor as any} />
    );
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setMeta(
          selectionMenuPluginKey,
          mockAnalysis()
        )
      );
    });
    return rendered;
  }

  it(
    "a TRUE blur tears the menu down — at the " +
      "settle, not inside the blur event",
    async () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");
      focusTracker.reset();
      focusTracker.notifyFocus("sp");
      const { container } = await showMenu(editor);
      expect(
        container.querySelector(".selection-menu")
      ).toBeTruthy();

      act(() => {
        emitBlur(editor);
      });
      // DEFERRED: still up in the blur's own turn
      expect(
        container.querySelector(".selection-menu")
      ).toBeTruthy();

      await act(async () => {
        await settle();
      });
      expect(
        container.querySelector(".selection-menu")
      ).toBeNull();
      editor.destroy();
    }
  );

  it(
    "a blur ANSWERED by the SP pane refocusing " +
      "(popup click) KEEPS the menu",
    async () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");
      focusTracker.reset();
      focusTracker.notifyFocus("sp");
      const { container } = await showMenu(editor);
      expect(
        container.querySelector(".selection-menu")
      ).toBeTruthy();

      act(() => {
        emitBlur(editor);
      });
      expect(
        container.querySelector(".selection-menu")
      ).toBeTruthy();
      // the popup's click handler refocuses the SP
      // editor, so the settle reports "sp" — and
      // this editor IS the SP pane here (nothing
      // else has claimed it)
      focusTracker.notifyFocus("sp");
      await act(async () => {
        await settle();
        // and past the frame the retired
        // requestAnimationFrame guess would have
        // used: that one read editor.isFocused,
        // which is false here, and tore the menu
        // down
        await frame();
      });
      expect(
        container.querySelector(".selection-menu")
      ).toBeTruthy();
      editor.destroy();
    }
  );

  it(
    "a SHARED-extension editor that is NOT the SP " +
      "pane (NameInput) tears its menu down " +
      "SYNCHRONOUSLY and leaves the pane's focus " +
      "state alone",
    async () => {
      const editor = createEditor("<p></p>");
      const pane = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");
      focusTracker.reset();
      focusTracker.claimSpView(pane.view);
      const { container } = await showMenu(editor);

      // the SP pane holds focus and keeps it
      focusTracker.notifyFocus("sp");
      act(() => {
        emitBlur(editor);
      });
      // SYNCHRONOUS teardown: nothing deferred
      expect(
        container.querySelector(".selection-menu")
      ).toBeNull();
      await act(async () => {
        await settle();
      });
      // the pane's own focus state was never
      // borrowed by this non-pane editor
      expect(focusTracker.focused()).toBe("sp");
      focusTracker.claimSpView(null);
      pane.destroy();
      editor.destroy();
    }
  );

  it(
    "blur to the PEER pane tears it down (the SP " +
      "selection the menu describes is not being " +
      "acted on any more)",
    async () => {
      const editor = createEditor("<p></p>");
      editor.commands.insertSitelenPona("ni");
      focusTracker.reset();
      focusTracker.notifyFocus("sp");
      const { container } = await showMenu(editor);

      act(() => {
        emitBlur(editor);
      });
      focusTracker.notifyFocus("latin");
      await act(async () => {
        await settle();
      });
      expect(
        container.querySelector(".selection-menu")
      ).toBeNull();
      editor.destroy();
    }
  );
});
