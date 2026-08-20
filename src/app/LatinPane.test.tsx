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
import type { Editor as TiptapEditor } from
  "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from
  "../editor/extensions/sitelen-pona";
import { Autocomplete } from
  "../editor/extensions/autocomplete";
import { StructuralChars } from
  "../editor/extensions/structural-chars";
import { Verbatim } from
  "../editor/extensions/verbatim";
import { VerbatimToggle } from
  "../editor/extensions/verbatim-toggle";
import { LipuModel } from
  "../editor/extensions/lipu-model";
import {
  LipuHistory,
  lipuHistoryKey,
  sharedUndo,
} from "../editor/extensions/lipu-history";
import {
  MirrorHighlight,
  mirrorHighlightKey,
} from "../editor/extensions/mirror-highlight";
import { lipuToContent } from "../editor/lipu-doc";
import { blockOffsetToPm } from "../editor/pm-coords";
import type { Block, Lipu, MirrorResult } from
  "../lipu";
import { focusTracker } from
  "../editor/focus-tracker";
import {
  LatinPane,
  buildMirrorRanges,
} from "./LatinPane";

function gap(sp = "", latin = "") {
  return { sp, latin };
}
function word(w: string) {
  return { kind: "word" as const, word: w };
}

/** Zero-anchor block: renders no Latin content —
 *  the v2 shape of a v1 block holding only sp
 *  markers/spacing. */
function markerOnlyBlock(sp: string): Block {
  return { anchors: [], gaps: [gap(sp, "")], spans: [] };
}

function lipuOf(block: Block): Lipu {
  return { version: 2, blocks: [block] };
}

// NOTE on these fixtures: createEditor below never
// configures LipuModel's initialLipu option, so the
// plugin state is always RE-DERIVED from the PM doc
// (docToLipu) rather than read off the fixture Block
// directly — matching what a real load does. The PM
// doc only encodes SP-side content (renderSp), so a
// fixture's gap.latin values only matter as a
// prediction of what docToLipu's own separation
// default will
// (re-)produce; they document intent but are not read
// verbatim.

function lipuOfBlocks(blocks: Block[]): Lipu {
  return { version: 2, blocks };
}

/** The suite's workhorse block: two words with the
 *  letter-adjacency separation default " " on both
 *  sides of the shared gap. */
function tokiPona(): Block {
  return {
    anchors: [word("toki"), word("pona")],
    gaps: [gap(), gap(" ", " "), gap()],
    spans: [],
  };
}

function createEditor(lipu: Lipu) {
  return new Editor({
    extensions: [
      // As in production: native history off,
      // the SHARED lipu-layer stack instead.
      // LipuHistory is declared BEFORE LipuModel —
      // TipTap reverses, and the history plugin's
      // state must apply AFTER the model's.
      LipuHistory,
      StarterKit.configure({ history: false }),
      SitelenPona,
      Autocomplete,
      StructuralChars,
      Verbatim,
      VerbatimToggle,
      LipuModel,
      MirrorHighlight,
    ],
    content: lipuToContent(lipu),
  });
}

/** Mounts the pane over an SP editor and hands back
 *  the pane DOM plus the satellite editor. */
function mountPane(editor: Editor): {
  container: HTMLElement;
  latin: TiptapEditor;
  unmount: () => void;
} {
  let latin: TiptapEditor | null = null;
  const view = render(
    <LatinPane
      editor={editor}
      onLatinEditorReady={(e) => {
        latin = e ?? latin;
      }}
    />
  );
  return {
    container: view.container,
    latin: latin!,
    unmount: view.unmount,
  };
}

function paneContent(
  container: HTMLElement
): HTMLElement {
  return container.querySelector(
    ".latin-editor-content"
  ) as HTMLElement;
}

describe("LatinPane (satellite editor)", () => {
  afterEach(cleanup);

  it(
    "renders the model's latin projection inside " +
      "a ProseMirror view",
    () => {
      const editor = createEditor(
        lipuOf(tokiPona())
      );
      const { container } = mountPane(editor);
      expect(
        paneContent(container).textContent
      ).toBe("toki pona");
      editor.destroy();
    }
  );

  it(
    "unmarked verbatim gets latin-provisional; " +
      "marked verbatim does not (anchor-class " +
      "decorations, not hand-rolled spans)",
    () => {
      const editor = createEditor(
        lipuOf({
          anchors: [
            { kind: "verbatim", text: "zzz",
              marked: true },
            { kind: "verbatim", text: "qqq" },
          ],
          // Letter-adjacency separation default:
          // both
          // verbatim anchors render Latin letters at
          // the shared boundary.
          gaps: [gap(), gap(" ", " "), gap()],
          spans: [],
        })
      );
      const { container } = mountPane(editor);
      const body = paneContent(container);
      const marked = Array.from(
        body.querySelectorAll(".latin-verbatim")
      ).find((s) => s.textContent === "zzz")!;
      const unmarked = Array.from(
        body.querySelectorAll(".latin-verbatim")
      ).find((s) => s.textContent === "qqq")!;
      expect(marked.className).not.toContain(
        "latin-provisional"
      );
      expect(unmarked.className).toContain(
        "latin-provisional"
      );
      editor.destroy();
    }
  );

  it(
    "cartouche renders one latinName atom " +
      "(nodeSize 1) carrying the derived name",
    () => {
      const editor = createEditor(
        lipuOf({
          anchors: [
            {
              kind: "word",
              word: "nena",
              nameScheme: {
                style: "morae",
                count: 2,
              },
            },
          ],
          gaps: [gap(), gap()],
          spans: [
            { from: 0, to: 0, kind: "cartouche",
              side: "both" },
          ],
        })
      );
      const { container, latin } =
        mountPane(editor);
      const chips = Array.from(
        paneContent(container).querySelectorAll(
          ".latin-name"
        )
      );
      expect(chips).toHaveLength(1);
      expect(chips[0].textContent).toBe("Nena");
      const para = latin.state.doc.child(0);
      expect(para.childCount).toBe(1);
      expect(para.child(0).type.name).toBe(
        "latinName"
      );
      expect(para.child(0).nodeSize).toBe(1);
      editor.destroy();
    }
  );

  it(
    "a break's companion newline renders as a " +
      "hardBreak, and the space before it SURVIVES " +
      "in the text node",
    () => {
      // DESIGNED DELTA from the hand-rolled pane: a
      // companion "\n" was flowing text under
      // white-space: pre-wrap; it is a real
      // hardBreak node now (nodeSize 1 — the
      // coordinate invariant counts it exactly as
      // renderLatin
      // does). pre-wrap is still what keeps the
      // preceding space visible.
      const editor = createEditor(
        lipuOf(tokiPona())
      );
      // between the two glyphs (UCSUR glyphs are
      // astral: two UTF-16 units each, and PM
      // positions count units)
      editor.commands.setTextSelection(
        blockOffsetToPm(editor.state.doc, 0, 2)
      );
      editor.commands.setHardBreak();

      const { container, latin } =
        mountPane(editor);
      const body = paneContent(container);
      expect(
        body.querySelector("br")
      ).not.toBeNull();
      const para = latin.state.doc.child(0);
      // DESIGNED DELTA: the Enter "\n" is an
      // APPEND to gap.latin, after
      // any previously edited content — and the gap
      // between these two letter-rendering glyphs
      // already held the separation " ", so
      // gap.latin ". "
      // becomes ". \n" exactly.
      expect(para.child(0).text).toBe("toki ");
      expect(para.child(1).type.name).toBe(
        "hardBreak"
      );
      expect(para.child(2).text).toBe("pona");
      editor.destroy();
    }
  );

  it("typing in the editor updates the pane text", () => {
    const editor = createEditor(
      lipuOf({ anchors: [], gaps: [gap()], spans: [] })
    );
    editor.commands.focus("end");

    const { container } = mountPane(editor);

    act(() => {
      editor.commands.insertContent("toki ");
    });

    expect(
      paneContent(container).textContent
    ).toContain("toki");
    editor.destroy();
  });

  it(
    "a doc-structure change (block split) keeps " +
      "the pane paragraph count in step",
    () => {
      const editor = createEditor(
        lipuOf(tokiPona())
      );
      const { latin } = mountPane(editor);
      expect(latin.state.doc.childCount).toBe(1);
      act(() => {
        editor.commands.setTextSelection(
          blockOffsetToPm(editor.state.doc, 0, 2)
        );
        editor.commands.splitBlock();
      });
      expect(editor.state.doc.childCount).toBe(2);
      expect(latin.state.doc.childCount).toBe(2);
      editor.destroy();
    }
  );

  describe("SP -> Latin mirroring", () => {
    it(
      "SP selection over a glyph highlights the " +
        "mirrored Latin range",
      () => {
        const editor = createEditor(
          lipuOf(tokiPona())
        );
        const { container, latin } =
          mountPane(editor);
        act(() => {
          const doc = editor.state.doc;
          editor.commands.setTextSelection({
            from: blockOffsetToPm(doc, 0, 3),
            to: blockOffsetToPm(doc, 0, 5),
          });
        });
        const decos = mirrorHighlightKey
          .getState(latin.state)!
          .find();
        const ldoc = latin.state.doc;
        expect(decos).toHaveLength(1);
        // "pona" occupies latin offsets 5..9
        expect(decos[0].from).toBe(
          blockOffsetToPm(ldoc, 0, 5)
        );
        expect(decos[0].to).toBe(
          blockOffsetToPm(ldoc, 0, 9)
        );
        expect(
          paneContent(container).querySelector(
            ".mirror-highlight"
          )?.textContent
        ).toBe("pona");
        editor.destroy();
      }
    );

    it(
      "collapsed SP selection clears the highlight",
      () => {
        const editor = createEditor(
          lipuOf(tokiPona())
        );
        const { latin } = mountPane(editor);
        act(() => {
          const doc = editor.state.doc;
          editor.commands.setTextSelection({
            from: blockOffsetToPm(doc, 0, 3),
            to: blockOffsetToPm(doc, 0, 5),
          });
        });
        expect(
          mirrorHighlightKey
            .getState(latin.state)!
            .find()
        ).toHaveLength(1);
        act(() => {
          const doc = editor.state.doc;
          const pos = blockOffsetToPm(doc, 0, 3);
          editor.commands.setTextSelection({
            from: pos,
            to: pos,
          });
        });
        expect(
          mirrorHighlightKey
            .getState(latin.state)!
            .find()
        ).toHaveLength(0);
        editor.destroy();
      }
    );

    it(
      "cross-block SP selection covers the whole " +
        "middle block in the pane",
      () => {
        const editor = createEditor(
          lipuOfBlocks([
            tokiPona(),
            {
              anchors: [word("mute")],
              gaps: [gap(), gap()],
              spans: [],
            },
            {
              anchors: [word("suli")],
              gaps: [gap(), gap()],
              spans: [],
            },
          ])
        );
        const { latin } = mountPane(editor);
        act(() => {
          const doc = editor.state.doc;
          editor.commands.setTextSelection({
            from: blockOffsetToPm(doc, 0, 0),
            to: blockOffsetToPm(doc, 2, 4),
          });
        });
        const ldoc = latin.state.doc;
        const start = blockOffsetToPm(ldoc, 1, 0);
        const end =
          start + ldoc.child(1).content.size;
        expect(
          mirrorHighlightKey
            .getState(latin.state)!
            .find()
            .some(
              (d) =>
                d.from === start && d.to === end
            )
        ).toBe(true);
        editor.destroy();
      }
    );

    it(
      "selection over an sp-marker-only region " +
        "yields no highlight",
      () => {
        // A plain space between two WORD anchors no
        // longer works for this: the separation
        // default mints a real
        // latin " " for any letter-adjacent gap (on
        // the editor's own contentToLipu re-derive,
        // regardless of what the fixture sets), so
        // that space now DOES mirror to a real Latin
        // range — by design. A non-letter adjacency
        // (word + punctuation verbatim) is that
        // default's documented exception (the honest
        // consequences): gap.latin stays empty, so
        // the sp space genuinely has no Latin
        // counterpart.
        const editor = createEditor(
          lipuOf({
            anchors: [
              word("toki"),
              { kind: "verbatim", text: "!!!" },
            ],
            gaps: [gap(), gap(" ", ""), gap()],
            spans: [],
          })
        );
        const { latin } = mountPane(editor);
        act(() => {
          const doc = editor.state.doc;
          editor.commands.setTextSelection({
            from: blockOffsetToPm(doc, 0, 2),
            to: blockOffsetToPm(doc, 0, 3),
          });
        });
        expect(
          mirrorHighlightKey
            .getState(latin.state)!
            .find()
        ).toHaveLength(0);
        editor.destroy();
      }
    );

    it(
      "cross-block selection survives a block-" +
        "merging edit and undo without throwing, " +
        "and re-highlights the restored selection",
      () => {
        const editor = createEditor(
          lipuOfBlocks([
            tokiPona(),
            {
              anchors: [word("mute")],
              gaps: [gap(), gap()],
              spans: [],
            },
          ])
        );
        const { latin } = mountPane(editor);
        act(() => {
          const doc = editor.state.doc;
          editor.commands.setTextSelection({
            from: blockOffsetToPm(doc, 0, 2),
            to: blockOffsetToPm(doc, 1, 1),
          });
        });
        // Typed replacement across the block
        // boundary merges the two blocks into one
        // (structural change, block count 2 -> 1).
        expect(() => {
          act(() => {
            editor.commands.insertContent("z");
          });
        }).not.toThrow();
        expect(editor.state.doc.childCount).toBe(1);
        expect(latin.state.doc.childCount).toBe(1);
        // RE-DERIVED for the shared undo: this
        // is the SHARED lipu-layer stack now, not
        // ProseMirror's — which is the point, since
        // what it restores is a CROSS-PANE state.
        // One undo brings back both blocks in BOTH
        // panes (the Latin side through the ordinary
        // structure-keyed reconcile) and the
        // recorded cross-block selection, which
        // rides the adoption transaction.
        expect(
          lipuHistoryKey.getState(editor.state)!.done
        ).toHaveLength(1);
        expect(() => {
          act(() => {
            expect(sharedUndo(editor)).toBe(true);
          });
        }).not.toThrow();
        expect(editor.state.doc.childCount).toBe(2);
        expect(latin.state.doc.childCount).toBe(2);
        expect(editor.state.selection.empty).toBe(
          false
        );
        // the RECORDED range, not merely "something
        // non-empty": block 0 offset 2 -> block 1
        // offset 1 — with the head SNAPPED DOWN to
        // offset 0 (the restore clamp), because
        // offset 1 sits
        // inside the surrogate pair of block 1's
        // single UCSUR glyph. The retired native
        // history restored the split position as-is.
        expect(editor.state.selection.from).toBe(
          blockOffsetToPm(editor.state.doc, 0, 2)
        );
        expect(editor.state.selection.to).toBe(
          blockOffsetToPm(editor.state.doc, 1, 0)
        );
        expect(
          mirrorHighlightKey
            .getState(latin.state)!
            .find().length
        ).toBeGreaterThan(0);
        editor.destroy();
      }
    );
  });

  describe("Latin -> SP mirroring (native " +
           "selections; resolvePoint retired)", () => {
    it(
      "a selection in the latin editor sets the " +
        "mirrored SP decoration range",
      () => {
        const editor = createEditor(
          lipuOf(tokiPona())
        );
        const { latin } = mountPane(editor);
        act(() => {
          const ldoc = latin.state.doc;
          latin.commands.setTextSelection({
            from: blockOffsetToPm(ldoc, 0, 0),
            to: blockOffsetToPm(ldoc, 0, 4),
          });
        });
        const doc = editor.state.doc;
        const found = mirrorHighlightKey
          .getState(editor.state)!
          .find();
        expect(found).toHaveLength(1);
        expect(found[0].from).toBe(
          blockOffsetToPm(doc, 0, 0)
        );
        // "toki" is rendered as a single UCSUR
        // glyph in SP — a surrogate pair, 2 UTF-16
        // units wide — not the 4 Latin characters
        // it mirrors.
        expect(found[0].to).toBe(
          blockOffsetToPm(doc, 0, 2)
        );
        editor.destroy();
      }
    );

    it(
      "a cross-block latin selection sets a whole-" +
        "block decoration for the middle block",
      () => {
        const editor = createEditor(
          lipuOfBlocks([
            {
              anchors: [word("toki")],
              gaps: [gap(), gap()],
              spans: [],
            },
            {
              anchors: [word("mute")],
              gaps: [gap(), gap()],
              spans: [],
            },
            {
              anchors: [word("suli")],
              gaps: [gap(), gap()],
              spans: [],
            },
          ])
        );
        const { latin } = mountPane(editor);
        act(() => {
          const ldoc = latin.state.doc;
          latin.commands.setTextSelection({
            from: blockOffsetToPm(ldoc, 0, 0),
            to: blockOffsetToPm(ldoc, 2, 4),
          });
        });
        const doc = editor.state.doc;
        const middleStart = blockOffsetToPm(
          doc,
          1,
          0
        );
        const middleEnd =
          middleStart + doc.child(1).content.size;
        expect(
          mirrorHighlightKey
            .getState(editor.state)!
            .find()
            .some(
              (d) =>
                d.from === middleStart &&
                d.to === middleEnd
            )
        ).toBe(true);
        editor.destroy();
      }
    );

    it(
      "a collapsed latin selection clears a prior " +
        "mirror decoration",
      () => {
        const editor = createEditor(
          lipuOf(tokiPona())
        );
        const { latin } = mountPane(editor);
        act(() => {
          const ldoc = latin.state.doc;
          latin.commands.setTextSelection({
            from: blockOffsetToPm(ldoc, 0, 0),
            to: blockOffsetToPm(ldoc, 0, 4),
          });
        });
        expect(
          mirrorHighlightKey
            .getState(editor.state)!
            .find()
        ).toHaveLength(1);
        act(() => {
          latin.commands.setTextSelection(
            blockOffsetToPm(latin.state.doc, 0, 1)
          );
        });
        expect(
          mirrorHighlightKey
            .getState(editor.state)!
            .find()
        ).toHaveLength(0);
        editor.destroy();
      }
    );

    it(
      "a RECONCILE does not re-drive the mirror " +
        "(deliberate suppression): a leftover " +
        "latin selection re-mapped by the render-" +
        "back dispatches nothing back into the SP " +
        "editor",
      () => {
        const editor = createEditor(
          lipuOfBlocks([
            {
              anchors: [word("toki")],
              gaps: [gap(), gap()],
              spans: [],
            },
            {
              anchors: [word("mute")],
              gaps: [gap(), gap()],
              spans: [],
            },
          ])
        );
        const { latin } = mountPane(editor);
        act(() => {
          const ldoc = latin.state.doc;
          latin.commands.setTextSelection({
            from: blockOffsetToPm(ldoc, 1, 0),
            to: blockOffsetToPm(ldoc, 1, 4),
          });
        });
        // the premise: a real gesture DOES mirror
        expect(
          mirrorHighlightKey
            .getState(editor.state)!
            .find()
        ).toHaveLength(1);
        const before = latin.state.selection.from;
        let spTrs = 0;
        const count = (): void => {
          spTrs += 1;
        };
        editor.on("transaction", count);
        act(() => {
          editor.commands.setTextSelection(
            blockOffsetToPm(editor.state.doc, 0, 0)
          );
          editor.commands.insertContent("z");
        });
        editor.off("transaction", count);
        // the reconcile really did move the latin
        // selection (otherwise this pins nothing)
        expect(
          latin.state.selection.from
        ).not.toBe(before);
        // ...and it stayed out of the SP editor:
        // the caret move and the edit, nothing
        // re-entrant from the render-back.
        expect(spTrs).toBe(2);
        editor.destroy();
      }
    );

    it(
      "unmounting the pane while a mirror " +
        "decoration is set clears it",
      () => {
        const editor = createEditor(
          lipuOf(tokiPona())
        );
        const { latin, unmount } =
          mountPane(editor);
        act(() => {
          const ldoc = latin.state.doc;
          latin.commands.setTextSelection({
            from: blockOffsetToPm(ldoc, 0, 0),
            to: blockOffsetToPm(ldoc, 0, 4),
          });
        });
        expect(
          mirrorHighlightKey
            .getState(editor.state)!
            .find()
        ).toHaveLength(1);

        act(() => {
          unmount();
        });

        expect(
          mirrorHighlightKey
            .getState(editor.state)!
            .find()
        ).toHaveLength(0);
        expect(latin.isDestroyed).toBe(true);
        editor.destroy();
      }
    );

    it(
      "a zero-anchor block mirrors nothing (no " +
        "Latin content to cover)",
      () => {
        const editor = createEditor(
          lipuOfBlocks([
            {
              anchors: [word("toki")],
              gaps: [gap(), gap()],
              spans: [],
            },
            markerOnlyBlock(" "),
          ])
        );
        const { latin } = mountPane(editor);
        expect(
          latin.state.doc.child(1).content.size
        ).toBe(0);
        editor.destroy();
      }
    );
  });

  // The mirror's lifetime must match the source
  // selection's VISIBLE lifetime. A TRUE blur (the
  // tracker settle reports no pane focused — a click
  // on the page background) is exactly when the
  // browser stops painting the source's native
  // selection, so it must clear the peer's mirror;
  // a pane HOP settles non-null and carries.
  describe("true blur clears the mirror", () => {
    // the tracker is a singleton: don't leak this
    // suite's focus state into later tests
    afterEach(() => focusTracker.reset());
    const settleFlush = (): Promise<void> =>
      new Promise((r) => setTimeout(r, 0));
    const blurDom = (dom: HTMLElement): void => {
      dom.dispatchEvent(new FocusEvent("blur"));
    };
    const fixture = () =>
      lipuOf(tokiPona());

    it(
      "SP-sourced: blur to the page background " +
        "clears the Latin pane's highlight",
      async () => {
        const editor = createEditor(fixture());
        const { latin } = mountPane(editor);
        focusTracker.reset();
        focusTracker.notifyFocus("sp");
        act(() => {
          const doc = editor.state.doc;
          editor.commands.setTextSelection({
            from: blockOffsetToPm(doc, 0, 3),
            to: blockOffsetToPm(doc, 0, 5),
          });
        });
        expect(
          mirrorHighlightKey
            .getState(latin.state)!
            .find()
        ).toHaveLength(1);

        // true blur: SP loses focus, no pane
        // answers before the settle
        await act(async () => {
          blurDom(editor.view.dom);
          await settleFlush();
        });

        expect(
          mirrorHighlightKey
            .getState(latin.state)!
            .find()
        ).toHaveLength(0);
        editor.destroy();
      }
    );

    it(
      "Latin-sourced: blur to the page background " +
        "clears the SP pane's highlight",
      async () => {
        const editor = createEditor(fixture());
        const { latin } = mountPane(editor);
        focusTracker.reset();
        focusTracker.notifyFocus("latin");
        act(() => {
          const ldoc = latin.state.doc;
          latin.commands.setTextSelection({
            from: blockOffsetToPm(ldoc, 0, 0),
            to: blockOffsetToPm(ldoc, 0, 4),
          });
        });
        expect(
          mirrorHighlightKey
            .getState(editor.state)!
            .find()
        ).toHaveLength(1);

        await act(async () => {
          blurDom(latin.view.dom);
          await settleFlush();
        });

        expect(
          mirrorHighlightKey
            .getState(editor.state)!
            .find()
        ).toHaveLength(0);
        editor.destroy();
      }
    );

    it(
      "NON-REGRESSION: blur-to-PEER settles " +
        "non-null and the highlight CARRIES",
      async () => {
        const editor = createEditor(fixture());
        const { latin } = mountPane(editor);
        focusTracker.reset();
        focusTracker.notifyFocus("sp");
        act(() => {
          const doc = editor.state.doc;
          editor.commands.setTextSelection({
            from: blockOffsetToPm(doc, 0, 3),
            to: blockOffsetToPm(doc, 0, 5),
          });
        });
        expect(
          mirrorHighlightKey
            .getState(latin.state)!
            .find()
        ).toHaveLength(1);

        // pane hop: the peer's focus is recorded
        // BEFORE the settle runs — exactly how the
        // tracker sees a real pane-to-pane move
        await act(async () => {
          blurDom(editor.view.dom);
          focusTracker.notifyFocus("latin");
          await settleFlush();
        });

        expect(
          mirrorHighlightKey
            .getState(latin.state)!
            .find()
        ).toHaveLength(1);
        editor.destroy();
      }
    );

    it(
      "carry-then-true-blur: after a pane hop the " +
        "CARRIED highlight lives in the blurred " +
        "pane itself, so a background click must " +
        "clear BOTH panes",
      async () => {
        const editor = createEditor(fixture());
        const { latin } = mountPane(editor);
        focusTracker.reset();
        focusTracker.notifyFocus("sp");
        act(() => {
          const doc = editor.state.doc;
          editor.commands.setTextSelection({
            from: blockOffsetToPm(doc, 0, 3),
            to: blockOffsetToPm(doc, 0, 5),
          });
        });
        // hop to the Latin pane: the highlight
        // carries (pinned above)
        await act(async () => {
          blurDom(editor.view.dom);
          focusTracker.notifyFocus("latin");
          await settleFlush();
        });
        expect(
          mirrorHighlightKey
            .getState(latin.state)!
            .find()
        ).toHaveLength(1);

        // now click the page background: a true
        // blur FROM the Latin pane, whose own doc
        // holds the carried decoration
        await act(async () => {
          blurDom(latin.view.dom);
          await settleFlush();
        });

        expect(
          mirrorHighlightKey
            .getState(latin.state)!
            .find()
        ).toHaveLength(0);
        expect(
          mirrorHighlightKey
            .getState(editor.state)!
            .find()
        ).toHaveLength(0);
        editor.destroy();
      }
    );
  });

  describe("buildMirrorRanges (direct unit tests)", () => {
    it(
      "converts inline highlights to PM ranges via " +
        "blockOffsetToPm",
      () => {
        const editor = createEditor(
          lipuOf(tokiPona())
        );
        const doc = editor.state.doc;
        const result: MirrorResult = {
          inline: [{ block: 0, from: 0, to: 4 }],
          wholeBlocks: [],
        };
        expect(buildMirrorRanges(doc, result)).toEqual([
          {
            from: blockOffsetToPm(doc, 0, 0),
            to: blockOffsetToPm(doc, 0, 4),
          },
        ]);
        editor.destroy();
      }
    );

    it(
      "converts whole-block entries into a range " +
        "spanning the block's full content",
      () => {
        const editor = createEditor(
          lipuOfBlocks([
            {
              anchors: [word("toki")],
              gaps: [gap(), gap()],
              spans: [],
            },
            {
              anchors: [word("mute")],
              gaps: [gap(), gap()],
              spans: [],
            },
          ])
        );
        const doc = editor.state.doc;
        const result: MirrorResult = {
          inline: [],
          wholeBlocks: [1],
        };
        const start = blockOffsetToPm(doc, 1, 0);
        expect(buildMirrorRanges(doc, result)).toEqual([
          {
            from: start,
            to: start + doc.child(1).content.size,
          },
        ]);
        editor.destroy();
      }
    );

    it(
      "SKIPS blocks the doc does not have and " +
        "CLAMPS offsets past a block's end (the " +
        "doc can trail the model by a dispatch — " +
        "the IME deferral makes that reachable " +
        "with the pane editable)",
      () => {
        // A two-block model result against a
        // ONE-block doc: doc.child(1) would throw a
        // RangeError, inside an SP event handler,
        // mid-dispatch.
        const editor = createEditor(
          lipuOf({
            anchors: [word("toki")],
            gaps: [gap(), gap()],
            spans: [],
          })
        );
        const doc = editor.state.doc;
        const result: MirrorResult = {
          inline: [
            { block: 0, from: 0, to: 999 },
            { block: 1, from: 0, to: 4 },
          ],
          wholeBlocks: [1, 2],
        };
        const start = blockOffsetToPm(doc, 0, 0);
        const size = doc.child(0).content.size;
        expect(() =>
          buildMirrorRanges(doc, result)
        ).not.toThrow();
        expect(
          buildMirrorRanges(doc, result)
        ).toEqual([
          { from: start, to: start + size },
        ]);
        editor.destroy();
      }
    );

    it("returns an empty array for an empty result", () => {
      const editor = createEditor(
        lipuOf({ anchors: [], gaps: [gap()], spans: [] })
      );
      const doc = editor.state.doc;
      expect(
        buildMirrorRanges(doc, {
          inline: [],
          wholeBlocks: [],
        })
      ).toEqual([]);
      editor.destroy();
    });
  });
});
