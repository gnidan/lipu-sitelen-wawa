/**
 * Foreign-transaction pin table. One pin per hook
 * row. The blanket rule stays authoritative for
 * anything not listed: a hook that dispatches
 * must check lipuSync.
 * StarterKit History row: covered when the shared
 * undo stack replaces it.
 */

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { render, waitFor } from
  "@testing-library/react";
import React from "react";
import { Editor as EditorComponent } from
  "../components/Editor";
import { SitelenPona } from "./sitelen-pona";
import { Autocomplete } from "./autocomplete";
import {
  autocompletePluginKey,
} from "./autocomplete";
import { StructuralChars } from
  "./structural-chars";
import { VariantKeymap } from "./variant-keymap";
import { PasteHandler } from "./paste-handler";
import { Verbatim } from "./verbatim";
import {
  VerbatimToggle,
  verbatimTogglePluginKey,
} from "./verbatim-toggle";
import { StructuralIndicators } from
  "./structural-indicators";
import { LineBreaks } from "./line-breaks";
import {
  LipuModel,
  lipuModelKey,
} from "./lipu-model";
import {
  MirrorHighlight,
  mirrorHighlightKey,
  setMirrorHighlights,
} from "./mirror-highlight";
import {
  LIPU_SYNC_META,
  minimalReplaceTr,
} from "../lipu-sync";
import { lipuToContent } from "../lipu-doc";
import type { Lipu } from "../../lipu";

function mkLipu(latin0: string): Lipu {
  return {
    version: 2,
    blocks: [
      {
        anchors: [
          { kind: "word", word: "toki" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: "", latin: latin0 },
        ],
        spans: [],
      },
    ],
  };
}

function mkEditor(lipu: Lipu): Editor {
  return new Editor({
    extensions: [
      LineBreaks,
      LipuModel.configure({
        initialLipu: lipu,
      }),
      MirrorHighlight,
      StarterKit,
      SitelenPona,
      VerbatimToggle,
      Autocomplete,
      StructuralChars,
      VariantKeymap,
      PasteHandler,
      Verbatim,
      StructuralIndicators,
    ],
    content: lipuToContent(lipu),
  });
}

/** Dispatch a lipuSync adoption (with derived
 *  steps when the SP projection changed) and
 *  return every transaction the dispatch chain
 *  produced. */
function dispatchSync(
  ed: Editor,
  lipu: Lipu
): import("@tiptap/pm/state").Transaction[] {
  const seen: import(
    "@tiptap/pm/state"
  ).Transaction[] = [];
  const onTr = ({
    transaction,
  }: {
    transaction: import(
      "@tiptap/pm/state"
    ).Transaction;
  }): void => {
    seen.push(transaction);
  };
  ed.on("transaction", onTr);
  const tr =
    minimalReplaceTr(
      ed.state,
      lipuToContent(lipu)
    ) ?? ed.state.tr;
  tr.setMeta(LIPU_SYNC_META, {
    lipu,
    originSide: "latin",
    origin: "edit",
    latinSelBefore: null,
    latinSelAfter: null,
  });
  ed.view.dispatch(tr);
  ed.off("transaction", onTr);
  return seen;
}

/** Same as dispatchSync, but also maps the
 *  selection to the doc's new end before dispatch
 *  -- models the realistic case where the synced
 *  transaction lands the caret right after the
 *  newly-adopted text (the exact hazard shape).
 *  Without this, the harness's untouched
 *  caret (left at doc start by mkEditor) never sits
 *  near the synced text, and an appendTransaction
 *  pin that reads $from.nodeBefore would pass
 *  whether or not the guard exists -- vacuously. */
function dispatchSyncAtEnd(
  ed: Editor,
  lipu: Lipu
): import("@tiptap/pm/state").Transaction[] {
  const seen: import(
    "@tiptap/pm/state"
  ).Transaction[] = [];
  const onTr = ({
    transaction,
  }: {
    transaction: import(
      "@tiptap/pm/state"
    ).Transaction;
  }): void => {
    seen.push(transaction);
  };
  ed.on("transaction", onTr);
  const tr =
    minimalReplaceTr(
      ed.state,
      lipuToContent(lipu)
    ) ?? ed.state.tr;
  tr.setSelection(
    TextSelection.near(
      tr.doc.resolve(tr.doc.content.size),
      -1
    )
  );
  tr.setMeta(LIPU_SYNC_META, {
    lipu,
    originSide: "latin",
    origin: "edit",
    latinSelBefore: null,
    latinSelAfter: null,
  });
  ed.view.dispatch(tr);
  ed.off("transaction", onTr);
  return seen;
}

describe("foreign-transaction pin table", () => {
  it("a lipuSync dispatch produces exactly ONE " +
     "transaction: no plugin appends or " +
     "re-dispatches (LineBreaks, Autocomplete " +
     "appendTransaction, Gapcursor, Verbatim, " +
     "TextNodeNormalizer, SelectionMenu plugin, " +
     "StructuralIndicators, Placeholder, " +
     "VariantKeymap, StructuralChars rows)", () => {
    const ed = mkEditor(mkLipu(""));
    const next = mkLipu("!");
    const seen = dispatchSync(ed, next);
    expect(seen).toHaveLength(1);
    expect(
      lipuModelKey.getState(ed.state)!.lipu
    ).toEqual(next);
  });

  it("LineBreaks: inert on a lipuSync that " +
     "carries a crystallizable run; the NEXT " +
     "genuine transaction still normalizes", () => {
    const ed = mkEditor(mkLipu(""));
    // adoption whose SP doc gains a "\n\n" run
    const next = mkLipu("");
    next.blocks[0].gaps[1] = {
      sp: "\n\n",
      latin: "\n\n",
    };
    const seen = dispatchSync(ed, next);
    expect(seen).toHaveLength(1);
    expect(ed.state.doc.childCount).toBe(1);
    // Move the caret first: the default selection
    // may already sit at doc start (a no-op move
    // there wouldn't count as "leaving the run" --
    // the dwell guard only fires on an actual
    // selection DELTA). Land inside/near the run
    // first (still dwelling, still 1 paragraph)...
    ed.commands.setTextSelection(
      ed.state.doc.content.size
    );
    expect(ed.state.doc.childCount).toBe(1);
    // ...then a genuine move OFF the run lets the
    // dwell pass run (doc start -> not touching the
    // run) and crystallize.
    ed.commands.setTextSelection(1);
    expect(ed.state.doc.childCount).toBe(2);
  });

  it("Autocomplete apply RECOMPUTES its range on " +
     "lipuSync", () => {
    const ed = mkEditor(mkLipu(""));
    // put a composing word at the end and the
    // caret after it
    ed.commands.setTextSelection(
      ed.state.doc.content.size
    );
    ed.view.dispatch(
      ed.state.tr.insertText("tok")
    );
    const before = autocompletePluginKey.getState(
      ed.state
    )!.range!;
    expect(before).not.toBeNull();
    // Adopt a lipu equal to the current model but
    // with one extra SP char inserted in gap0,
    // BEFORE the anchor -- a genuine docChanged
    // sync (real steps) that shifts the composing
    // word's position by exactly 1. This is a REAL
    // pin on recompute: if apply were ever gated to
    // `return prev` on a lipuSync meta (the
    // regression this row guards against), `after`
    // would stay frozen at the OLD, now-wrong
    // offsets instead of tracking the shift.
    const st0 = lipuModelKey.getState(ed.state)!;
    const next = JSON.parse(
      JSON.stringify(st0.lipu)
    );
    next.blocks[0].gaps[0].sp = "!";
    const seen = dispatchSync(ed, next);
    expect(seen).toHaveLength(1);
    const after = autocompletePluginKey.getState(
      ed.state
    )!.range!;
    expect(after).toEqual({
      from: before.from + 1,
      to: before.to + 1,
    });
  });

  it("Autocomplete appendTransaction: INERT on a " +
     "lipuSync whose doc ends in the word+space " +
     "auto-commit shape", () => {
    const ed = mkEditor(mkLipu(""));
    const st0 = lipuModelKey.getState(ed.state)!;
    // adoption that appends unmarked SP text
    // "toki " (word + trailing space) — the
    // auto-commit trigger shape. Using
    // dispatchSyncAtEnd (not dispatchSync) is
    // load-bearing: appendTransaction's auto-commit
    // reads $from.nodeBefore off the CURRENT
    // selection, and mkEditor's untouched caret
    // sits at doc start, nowhere near the synced
    // text -- a plain dispatchSync would pass this
    // pin vacuously regardless of the guard.
    const next = JSON.parse(
      JSON.stringify(st0.lipu)
    );
    next.blocks[0].gaps[1] = {
      sp: " toki ",
      latin: "",
    };
    const textBefore =
      ed.state.doc.textContent;
    const seen = dispatchSyncAtEnd(ed, next);
    expect(seen).toHaveLength(1);
    // no auto-commit rewrote "toki " to a glyph
    expect(
      ed.state.doc.textContent.endsWith("toki ")
    ).toBe(true);
    expect(textBefore).not.toBe(
      ed.state.doc.textContent
    );
  });

  it("VerbatimToggle: manualOverride SURVIVES a " +
     "lipuSync selection remap; genuine movement " +
     "still consumes it", () => {
    const ed = mkEditor(mkLipu(""));
    ed.view.dispatch(
      ed.state.tr.setMeta(
        verbatimTogglePluginKey,
        {
          active: true,
          lastBacktickTime: 0,
          manualOverride: true,
        }
      )
    );
    // An SP-side change BEFORE the anchor (gap0,
    // not gap.latin): real docChanged steps that
    // insert a char ahead of the anchor shift the
    // PM-MAPPED caret from 1 to 2 with no explicit
    // setSelection -- this is what makes the pin
    // real. A Latin-local sync (gap.latin only, e.g.
    // mkLipu("~")) is zero steps: no selection
    // change, so the auto-sync branch never runs and
    // the assertion below would hold whether or not
    // the Step-1c guard exists (caught in review).
    const st0 = lipuModelKey.getState(ed.state)!;
    const next = JSON.parse(
      JSON.stringify(st0.lipu)
    );
    next.blocks[0].gaps[0].sp = "!";
    dispatchSync(ed, next);
    expect(
      verbatimTogglePluginKey.getState(ed.state)!
        .manualOverride
    ).toBe(true);
    // Move first: the default selection may already
    // sit at position 1, and a no-op move there
    // wouldn't be a genuine DELTA for the auto-sync
    // branch to react to.
    ed.commands.setTextSelection(
      ed.state.doc.content.size
    );
    ed.commands.setTextSelection(1);
    expect(
      verbatimTogglePluginKey.getState(ed.state)!
        .manualOverride
    ).toBe(false);
  });

  it("MirrorHighlight row (accepted, stated so " +
     "the flicker isn't re-discovered): a " +
     "docChanged lipuSync CLEARS the decorations; " +
     "meta-only setMirrorHighlights is benign", () => {
    const ed = mkEditor(mkLipu(""));
    setMirrorHighlights(ed, [
      { from: 1, to: 2 },
    ]);
    expect(
      mirrorHighlightKey
        .getState(ed.state)!
        .find().length
    ).toBeGreaterThan(0);
    // mkLipu("!") alone only touches gap.latin --
    // Latin-LOCAL, zero SP steps, NOT
    // docChanged -- so this row needs an SP-side
    // change to actually exercise "docChanged".
    const next = mkLipu("");
    next.blocks[0].gaps[1] = {
      sp: "!",
      latin: "",
    };
    dispatchSync(ed, next);
    expect(
      mirrorHighlightKey
        .getState(ed.state)!
        .find()
    ).toHaveLength(0);
  });
});

it("React surfaces: a lipuSync dispatch through " +
   "the MOUNTED editor (popups included) still " +
   "produces exactly ONE transaction", async () => {
  let ed: Editor | null = null;
  render(
    <EditorComponent
      lipu={mkLipu("")}
      onEditorReady={(e) => {
        ed = e ?? ed;
      }}
    />
  );
  await waitFor(() =>
    expect(ed).not.toBeNull()
  );
  const seen = dispatchSync(
    ed!,
    mkLipu("!")
  );
  expect(seen).toHaveLength(1);
});
