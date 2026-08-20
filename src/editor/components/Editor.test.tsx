import React from "react";
import {
  describe,
  it,
  expect,
  afterEach,
  vi,
} from "vitest";
import {
  render,
  cleanup,
  act,
} from "@testing-library/react";
import type { Editor as TiptapEditor } from
  "@tiptap/core";
import { Editor } from "./Editor";
import { emptyLipu, lipuToContent } from "../lipu-doc";
import type { SavePayload } from "../lipu-doc";
import {
  codepointToChar,
  wordToCodepoint,
} from "../../data";
import { lipuModelKey } from "../extensions/lipu-model";
import { focusTracker } from "../focus-tracker";
import { LIPU_SYNC_META } from "../lipu-sync";
import {
  mergeLatinBlock,
  parseLatin,
  renderLatin,
  renderSp,
} from "../../lipu";
import type { Block, Lipu } from "../../lipu";
import { editLatinInlines } from
  "../../../test/edit-corpus";
import {
  DOC_PREFIX,
  LIPU_PREFIX,
  loadDocLipu,
  saveDocDual,
} from "../../app/documents";
import { cart } from "../../../test/helpers";

describe("Editor", () => {
  afterEach(cleanup);

  it("renders without crashing", () => {
    const { container } = render(
      <Editor lipu={emptyLipu()} />
    );
    expect(
      container.querySelector(".editor-wrapper")
    ).toBeTruthy();
  });

  it("contains editor content area", () => {
    const { container } = render(
      <Editor lipu={emptyLipu()} />
    );
    expect(
      container.querySelector(
        ".editor-content-wrapper"
      )
    ).toBeTruthy();
  });

  it(
    "onSave payload has coherent lipu/content " +
      "(same snapshot)",
    () => {
      let tiptap: TiptapEditor | null = null;
      const onSave = vi.fn<
        (payload: SavePayload) => void
      >();

      const { unmount } = render(
        <Editor
          lipu={emptyLipu()}
          onSave={onSave}
          onEditorReady={(e) => {
            tiptap = e;
          }}
        />
      );

      act(() => {
        tiptap!.commands.insertContent("mu");
      });
      // Unmount flushes the pending debounced save
      // synchronously instead of waiting 500ms.
      unmount();

      expect(onSave).toHaveBeenCalledTimes(1);
      const payload = onSave.mock.calls[0][0];
      expect(
        JSON.stringify(lipuToContent(payload.lipu))
      ).toBe(JSON.stringify(payload.content));
    }
  );
});

/**
 * BOUNDARY WIRING: the doc-merge.test.ts /
 * lipu-model.test.ts unit coverage only calls the
 * normalization functions directly -- it never
 * touches Editor.tsx's own initialLipu wiring, so
 * reverting a call site there left the whole suite
 * green. These render the ACTUAL Editor component and
 * read the plugin's adopted lipu back out of
 * ProseMirror state, so they fail if the wiring in
 * Editor.tsx regresses. There is one per pass in the
 * chain: dropping EITHER call must break a test.
 */
describe("boundary wiring (component-level)", () => {
  afterEach(cleanup);

  it(
    "the mounted Editor's plugin state holds the " +
      "NORMALIZED lipu, not the raw seeded one",
    () => {
      const seeded: Lipu = {
        version: 2,
        blocks: [
          {
            anchors: [
              { kind: "word", word: "toki" },
            ],
            gaps: [
              { sp: "", latin: "" },
              { sp: "", latin: "\u0301x" },
            ],
            spans: [],
          },
        ],
      };
      // sanity: the fixture is genuinely
      // un-normalized going in
      expect(seeded.blocks[0].gaps[1].latin).toBe(
        "\u0301x"
      );

      let tiptap: TiptapEditor | null = null;
      const { unmount } = render(
        <Editor
          lipu={seeded}
          onEditorReady={(e) => {
            tiptap = e;
          }}
        />
      );

      const state = lipuModelKey.getState(
        tiptap!.state
      );
      expect(
        state!.lipu.blocks[0].gaps[1].latin
      ).toBe(" \u0301x");

      unmount();
    }
  );

  it(
    "the separation default runs at the boundary " +
      "too: a stored " +
      "doc below the separation fixpoint is lifted " +
      "on mount",
    () => {
      // saved before the ATOMIZATION RULE, when a
      // NAMELESS cartouche exempted the shared gap
      const seeded: Lipu = {
        version: 2,
        blocks: [
          {
            anchors: [
              { kind: "word", word: "toki" },
              {
                kind: "verbatim",
                text: "xq",
                marked: true,
              },
            ],
            gaps: [
              { sp: "", latin: "" },
              { sp: "", latin: "" },
              { sp: "", latin: "" },
            ],
            spans: [
              cart(1, 1),
            ],
          },
        ],
      };
      expect(seeded.blocks[0].gaps[1].latin).toBe("");

      let tiptap: TiptapEditor | null = null;
      const { unmount } = render(
        <Editor
          lipu={seeded}
          onEditorReady={(e) => {
            tiptap = e;
          }}
        />
      );

      const state = lipuModelKey.getState(
        tiptap!.state
      );
      expect(
        state!.lipu.blocks[0].gaps[1].latin
      ).toBe(" ");

      unmount();
    }
  );
});

/**
 * SAVES MUST SEE APPENDED TRANSACTIONS.
 * A COMPOSITION DWELL crystallization rides as an
 * APPENDED transaction: the doc splits while the
 * DISPATCHED transaction (a caret move, or the blur
 * handler's bare transaction) changed nothing. TipTap
 * gates onUpdate on the ROOT transaction's
 * docChanged, so scheduling saves from onUpdate lost
 * the split entirely and let the 500ms debounce write
 * the PRE-split payload captured at the Enter.
 */
describe("crystallized splits reach the save", () => {
  afterEach(cleanup);

  function mount(onSave: (p: SavePayload) => void) {
    let tiptap: TiptapEditor | null = null;
    const r = render(
      <Editor
        lipu={emptyLipu()}
        onSave={onSave}
        onEditorReady={(e) => {
          tiptap = e;
        }}
      />
    );
    return {
      ...r,
      editor: () => tiptap as unknown as TiptapEditor,
    };
  }

  /** Type a glyph, then two hardBreaks: an empty
   *  line with the caret parked ON it (dwelled). */
  function typeDwelledRun(editor: TiptapEditor) {
    act(() => {
      editor.commands.focus("end");
      editor.commands.insertContent(
        codepointToChar(wordToCodepoint["toki"])
      );
    });
    act(() => {
      editor.commands.setHardBreak();
    });
    act(() => {
      editor.commands.setHardBreak();
    });
    expect(editor.state.doc.childCount).toBe(1);
  }

  it(
    "a LEAVE-crystallized split is what the " +
      "debounce writes -- not the pre-split payload",
    () => {
      const onSave = vi.fn<
        (payload: SavePayload) => void
      >();
      const { editor, unmount } = mount(onSave);
      typeDwelledRun(editor());

      // caret leaves the run: the split lands on an
      // APPENDED transaction (the dispatched one is
      // selection-only)
      act(() => {
        editor().commands.setTextSelection(1);
      });
      expect(editor().state.doc.childCount).toBe(2);

      unmount();

      expect(onSave).toHaveBeenCalledTimes(1);
      const payload = onSave.mock.calls[0][0];
      expect(payload.lipu.blocks).toHaveLength(2);
      expect(
        JSON.stringify(lipuToContent(payload.lipu))
      ).toBe(JSON.stringify(payload.content));
    }
  );

  it(
    "a BLUR-crystallized split is what the debounce " +
      "writes (the once-lost sequence, re-measured)",
    async () => {
      const onSave = vi.fn<
        (payload: SavePayload) => void
      >();
      const { editor, unmount } = mount(onSave);
      typeDwelledRun(editor());

      act(() => {
        editor().view.dom.dispatchEvent(
          new FocusEvent("blur")
        );
      });
      // The forced pass rides the
      // FocusTracker's settle — an unanswered
      // blur is a TRUE blur, which is what this
      // sequence has always been.
      expect(editor().state.doc.childCount).toBe(1);
      await act(async () => {
        await new Promise((r) =>
          queueMicrotask(() => r(null))
        );
      });
      expect(editor().state.doc.childCount).toBe(2);

      unmount();

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(
        onSave.mock.calls[0][0].lipu.blocks
      ).toHaveLength(2);
    }
  );

  it(
    "the debounce fires ONCE with the newest " +
      "snapshot after a crystallization",
    () => {
      vi.useFakeTimers();
      try {
        const onSave = vi.fn<
          (payload: SavePayload) => void
        >();
        const { editor } = mount(onSave);
        typeDwelledRun(editor());
        // the pre-split payload is pending here
        act(() => {
          editor().commands.setTextSelection(1);
        });

        act(() => {
          vi.advanceTimersByTime(500);
        });

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(
          onSave.mock.calls[0][0].lipu.blocks
        ).toHaveLength(2);

        // nothing pending afterwards
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(onSave).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it(
    "selection-only transactions schedule no save " +
      "(doc identity unchanged -- no save storm)",
    () => {
      vi.useFakeTimers();
      try {
        const onSave = vi.fn<
          (payload: SavePayload) => void
        >();
        const { editor } = mount(onSave);
        act(() => {
          editor().commands.insertContent(
            codepointToChar(wordToCodepoint["toki"])
          );
        });
        const docAfterTyping = editor().state.doc;

        // The discriminator is the DEBOUNCE CLOCK: a
        // scheduled save is cleared and re-scheduled
        // on every capture, so caret moves that
        // captured a payload would push the write
        // past the 500ms mark measured from the
        // typing. Moving at t=400 and checking at
        // t=550 catches exactly that.
        act(() => {
          vi.advanceTimersByTime(400);
        });
        act(() => {
          editor().commands.setTextSelection(1);
          editor().commands.setTextSelection(3);
          editor().commands.setTextSelection(1);
        });
        // no doc change means no new snapshot: the
        // caret moves rode on the SAME doc object
        expect(editor().state.doc).toBe(
          docAfterTyping
        );

        act(() => {
          vi.advanceTimersByTime(150);
        });

        // fired on the ORIGINAL schedule, once
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(
          onSave.mock.calls[0][0].lipu.blocks
        ).toHaveLength(1);

        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(onSave).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    }
  );
});

/**
 * VERSION-KEYED SAVES. A
 * Latin-LOCAL edit changes bytes the SP doc cannot
 * express (gap.latin, the `case` facet), so the
 * adoption transaction carries ZERO steps and the doc
 * object never changes. The old doc-identity trigger
 * saw nothing and the edit died at the next reload;
 * the trigger is the MODEL VERSION now.
 *
 * This is a CLASS test on purpose: one
 * insert-a-word case would pass with a trigger that
 * only handles gap.latin. Every Latin-local edit
 * TYPE runs the full route — real Latin edit through
 * mergeLatinBlock, adoption, debounced save, dual
 * write, reload.
 */
describe("version-keyed saves", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  const base: Lipu = {
    version: 2,
    blocks: [
      {
        anchors: [
          { kind: "word", word: "toki" },
          { kind: "word", word: "pona" },
        ],
        gaps: [
          { sp: "", latin: "" },
          { sp: " ", latin: " " },
          { sp: "", latin: "" },
        ],
        spans: [],
      },
    ],
  };

  /** A real Latin edit: render the Latin side, splice
   *  the keystroke in, re-parse, merge — the same
   *  entrypoints the Latin editor uses. */
  function latinEdit(
    block: Block,
    from: number,
    to: number,
    text: string
  ): Block {
    return mergeLatinBlock(
      block,
      parseLatin(
        editLatinInlines(
          renderLatin(block).inlines,
          from,
          to,
          text
        )
      )
    );
  }

  const cases: Array<{
    name: string;
    from: number;
    to: number;
    text: string;
    check: (lipu: Lipu) => void;
  }> = [
    {
      name: "comma",
      from: 4,
      to: 4,
      text: ",",
      check: (l) =>
        expect(l.blocks[0].gaps[1].latin).toBe(", "),
    },
    {
      name: "digit",
      from: 9,
      to: 9,
      text: "7",
      check: (l) =>
        expect(l.blocks[0].gaps[2].latin).toBe("7"),
    },
    {
      name: "space",
      from: 4,
      to: 4,
      text: " ",
      check: (l) =>
        expect(l.blocks[0].gaps[1].latin).toBe("  "),
    },
    {
      name: "latin newline",
      from: 4,
      to: 4,
      text: "\n",
      check: (l) =>
        expect(l.blocks[0].gaps[1].latin).toBe("\n "),
    },
    {
      name: "case-only",
      from: 0,
      to: 1,
      text: "T",
      check: (l) =>
        expect(l.blocks[0].anchors[0].case).toBe(
          "capital"
        ),
    },
  ];

  for (const c of cases) {
    it(
      `a Latin-LOCAL ${c.name} edit schedules a ` +
        "save whose lipu carries it, and the " +
        "stored pair reloads to the same lipu",
      () => {
        vi.useFakeTimers();
        try {
          let tiptap: TiptapEditor | null = null;
          const onSave = vi.fn<
            (payload: SavePayload) => void
          >();
          render(
            <Editor
              lipu={base}
              onSave={(p) => {
                onSave(p);
                saveDocDual(
                  "c1",
                  p.lipu,
                  p.content,
                  false
                );
              }}
              onEditorReady={(e) => {
                tiptap = e;
              }}
            />
          );
          const editor =
            tiptap as unknown as TiptapEditor;
          // TipTap emits `create` from a setTimeout:
          // settle it (and prove the baseline is
          // quiet) before the adoption, so the save
          // below can only come from the adoption
          // itself.
          act(() => {
            vi.advanceTimersByTime(600);
          });
          expect(onSave).not.toHaveBeenCalled();

          const prev = lipuModelKey.getState(
            editor.state
          )!.lipu;
          const merged = latinEdit(
            prev.blocks[0],
            c.from,
            c.to,
            c.text
          );
          const next: Lipu = {
            version: 2,
            blocks: [merged],
          };
          // genuinely Latin-LOCAL: the SP projection
          // is byte-identical, marks included
          expect(
            JSON.stringify(renderSp(merged).inlines)
          ).toBe(
            JSON.stringify(
              renderSp(prev.blocks[0]).inlines
            )
          );

          const docBefore = editor.state.doc;
          act(() => {
            editor.view.dispatch(
              editor.state.tr.setMeta(
                LIPU_SYNC_META,
                {
                  lipu: next,
                  originSide: "latin",
                  origin: "edit",
                  latinSelBefore: null,
                  latinSelAfter: null,
                }
              )
            );
          });
          // zero SP steps: the doc object itself is
          // untouched, which is what the old
          // doc-identity save trigger keyed on
          expect(editor.state.doc).toBe(docBefore);

          act(() => {
            vi.advanceTimersByTime(500);
          });

          expect(onSave).toHaveBeenCalledTimes(1);
          const payload =
            onSave.mock.calls[0][0];
          c.check(payload.lipu);
          expect(payload.lipu).toEqual(next);
          expect(
            JSON.stringify(payload.content)
          ).toBe(
            JSON.stringify(
              lipuToContent(payload.lipu)
            )
          );

          // both stored halves landed...
          expect(
            localStorage.getItem(DOC_PREFIX + "c1")
          ).toBe(JSON.stringify(payload.content));
          const stored = JSON.parse(
            localStorage.getItem(
              LIPU_PREFIX + "c1"
            )!
          );
          expect({
            version: 2,
            blocks: stored.blocks,
          }).toEqual(next);

          // ...and a reload round-trips (the mirror
          // cannot express the edit, so a mirror-wins
          // reload would silently drop it)
          expect(loadDocLipu("c1")).toEqual(next);
        } finally {
          vi.useRealTimers();
        }
      }
    );
  }

  it(
    "the version trigger keeps the no-storm rule: " +
      "caret moves either side of an adoption " +
      "schedule nothing, and the adoption saves once",
    () => {
      vi.useFakeTimers();
      try {
        let tiptap: TiptapEditor | null = null;
        const onSave = vi.fn<
          (payload: SavePayload) => void
        >();
        render(
          <Editor
            lipu={base}
            onSave={onSave}
            onEditorReady={(e) => {
              tiptap = e;
            }}
          />
        );
        const editor =
          tiptap as unknown as TiptapEditor;
        act(() => {
          vi.advanceTimersByTime(600);
        });
        act(() => {
          editor.commands.setTextSelection(2);
          editor.commands.setTextSelection(4);
        });
        act(() => {
          vi.advanceTimersByTime(600);
        });
        // no model change yet: bare caret moves must
        // not schedule anything
        expect(onSave).not.toHaveBeenCalled();

        const next: Lipu = JSON.parse(
          JSON.stringify(
            lipuModelKey.getState(editor.state)!.lipu
          )
        );
        next.blocks[0].gaps[1].latin = ", ";
        act(() => {
          editor.view.dispatch(
            editor.state.tr.setMeta(LIPU_SYNC_META, {
              lipu: next,
              originSide: "latin",
              origin: "edit",
              latinSelBefore: null,
              latinSelAfter: null,
            })
          );
        });
        act(() => {
          editor.commands.setTextSelection(2);
        });
        act(() => {
          vi.advanceTimersByTime(600);
        });
        expect(onSave).toHaveBeenCalledTimes(1);

        act(() => {
          editor.commands.setTextSelection(4);
        });
        act(() => {
          vi.advanceTimersByTime(600);
        });
        expect(onSave).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    }
  );
});

/**
 * The SP pane's half of the
 * FocusTracker. Focus is NOT plugin state — the
 * tracker is a plugin-external singleton — so the
 * component owns exactly two things: telling it when
 * this pane takes focus, and RESETTING it on the
 * activeId-keyed remount, where a stale "the other
 * document's pane had focus" would otherwise
 * survive.
 */
describe("SP focus wiring", () => {
  afterEach(() => {
    cleanup();
    focusTracker.reset();
  });

  it("mount resets the tracker; a focus event " +
     "claims 'sp'", () => {
    focusTracker.reset();
    focusTracker.notifyFocus("latin");

    let tiptap: TiptapEditor | null = null;
    const { unmount } = render(
      <Editor
        lipu={emptyLipu()}
        onEditorReady={(e) => {
          tiptap = e;
        }}
      />
    );
    // the remount reset ran
    expect(focusTracker.focused()).toBeNull();

    act(() => {
      (
        tiptap as unknown as TiptapEditor
      ).view.dom.dispatchEvent(
        new FocusEvent("focus")
      );
    });
    expect(focusTracker.focused()).toBe("sp");

    // ...and it CLAIMS the pane, so the shared
    // extensions (Autocomplete, SelectionMenu) can
    // tell this editor from NameInput's
    const pane = (
      tiptap as unknown as TiptapEditor
    ).view;
    expect(focusTracker.isSpView(pane)).toBe(true);
    expect(
      focusTracker.isSpView(
        {} as unknown as typeof pane
      )
    ).toBe(false);

    unmount();
    // the claim is released with the editor
    expect(
      focusTracker.isSpView(
        {} as unknown as typeof pane
      )
    ).toBe(true);
  });
});

// NOTE: the shared-undo wiring pins (rendering the
// real <Editor> and asserting undo goes through the
// shared document-level history stack) land with
// that extension in the Latin-pane PR.
