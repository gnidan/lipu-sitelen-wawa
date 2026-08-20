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
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import { App } from "./App";
import type { Editor as TiptapEditor } from
  "@tiptap/core";
import {
  lipuModelKey,
} from "../editor/extensions/lipu-model";
import { focusTracker } from
  "../editor/focus-tracker";
import { fromVerbatim } from "../convert";
import {
  DOC_PREFIX,
  getActiveDocId,
  LIPU_PREFIX,
  loadDocLipu,
} from "./documents";

/**
 * The satellite instances App builds, captured
 * through the factory. App holds the Latin editor in
 * state purely so its close-click can reach it
 * for the true-blur forced pass, and nothing else
 * exposes it — so
 * the WIRING (onLatinEditorReady + the close
 * branch's forced pass) is only pinnable from here.
 */
const captured = vi.hoisted(() => ({
  pairs: [] as Array<{
    sp: TiptapEditor;
    latin: TiptapEditor;
  }>,
}));

vi.mock("../editor/latin/latin-editor", async (
  importOriginal
) => {
  const mod = await importOriginal<
    typeof import("../editor/latin/latin-editor")
  >();
  return {
    ...mod,
    createLatinEditor: (sp: TiptapEditor) => {
      const latin = mod.createLatinEditor(sp);
      captured.pairs.push({ sp, latin });
      return latin;
    },
  };
});

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.clear();
    captured.pairs.length = 0;
    focusTracker.reset();
  });

  it("renders without crashing", () => {
    const { container } = render(<App />);
    expect(
      container.querySelector(".app")
    ).toBeTruthy();
  });

  it("the Latin pane starts closed by default", () => {
    const { container } = render(<App />);
    expect(
      container.querySelector(".latin-pane")
    ).toBeNull();
  });

  it("shows title", () => {
    const { container } = render(<App />);
    const h1 = container.querySelector("h1");
    expect(h1).toBeTruthy();
    expect(
      h1!.querySelector(".sp-text")
    ).toBeTruthy();
  });

  it("contains Editor component", () => {
    const { container } = render(<App />);
    expect(
      container.querySelector(".editor-wrapper")
    ).toBeTruthy();
  });

  it("shows footer attribution", () => {
    const { container } = render(<App />);
    const footer = container.querySelector(
      ".app__footer"
    );
    expect(footer).toBeTruthy();
    const link = footer!.querySelector("a");
    expect(link).toBeTruthy();
    expect(link!.href).toContain("nasin-nanpa");
  });

  it(
    "initial render has no opening/closing class",
    () => {
      const { container } = render(<App />);
      const workspace = container.querySelector(
        ".app__workspace"
      );
      expect(workspace).toBeTruthy();
      expect(workspace!.className).not.toContain(
        "app__workspace--opening"
      );
      expect(workspace!.className).not.toContain(
        "app__workspace--closing"
      );
    }
  );

  it(
    "toggling adds --opening then drops it",
    () => {
      localStorage.setItem(
        "lipu-sitelen-wawa:latin-pane", "off"
      );
      vi.useFakeTimers();
      const { container } = render(<App />);
      const toggle = container.querySelector(
        ".tab-toggle--side"
      ) as HTMLElement;
      expect(toggle).toBeTruthy();

      act(() => fireEvent.click(toggle));

      const workspace = container.querySelector(
        ".app__workspace"
      )!;
      expect(workspace.className).toContain(
        "app__workspace--opening"
      );

      act(() => vi.advanceTimersByTime(300));

      expect(workspace.className).not.toContain(
        "app__workspace--opening"
      );
      expect(workspace.className).not.toContain(
        "app__workspace--closing"
      );
    }
  );

  it(
    "rapid open then close leaves no stale " +
      "opening class",
    () => {
      // pins the documented defect: a rapid
      // open->close (close before the open timer
      // fires) must not leave --opening stuck
      // forever once timers settle
      localStorage.setItem(
        "lipu-sitelen-wawa:latin-pane", "off"
      );
      vi.useFakeTimers();
      const { container } = render(<App />);
      const toggle = container.querySelector(
        ".tab-toggle--side"
      ) as HTMLElement;
      expect(toggle).toBeTruthy();

      act(() => fireEvent.click(toggle)); // open
      act(() => vi.advanceTimersByTime(100));
      act(() => fireEvent.click(toggle)); // close

      act(() => vi.advanceTimersByTime(300));

      const workspace = container.querySelector(
        ".app__workspace"
      )!;
      expect(workspace.className).not.toContain(
        "app__workspace--opening"
      );
      expect(workspace.className).not.toContain(
        "app__workspace--closing"
      );
      expect(workspace.className).not.toContain(
        "app__workspace--split"
      );
      expect(
        container.querySelector(".latin-pane")
      ).toBeFalsy();
    }
  );

  it(
    "closing the pane crystallizes a pending " +
      "latin run BEFORE the pane unmounts " +
      "(close = TRUE BLUR)",
    () => {
      localStorage.setItem(
        "lipu-sitelen-wawa:latin-pane", "on"
      );
      vi.useFakeTimers();
      const { container } = render(<App />);
      // the pane defaults open
      expect(
        container.querySelector(".latin-pane")
      ).toBeTruthy();
      const pair = captured.pairs[0];
      expect(pair).toBeTruthy();
      const { sp, latin } = pair;
      const blocks = (): number =>
        lipuModelKey.getState(sp.state)!.lipu
          .blocks.length;

      // a dwelled "\n\n" run in the latin pane:
      // the caret parks on it, so nothing
      // crystallizes yet
      act(() => {
        latin.commands.setTextSelection(
          latin.state.doc.content.size
        );
      });
      const br = (): void => {
        act(() => {
          latin.view.dispatch(
            latin.state.tr.replaceSelectionWith(
              latin.state.schema.nodes.hardBreak
                .create()
            )
          );
        });
      };
      br();
      br();
      expect(blocks()).toBe(1);

      const toggle = container.querySelector(
        ".tab-toggle--side"
      ) as HTMLElement;
      act(() => fireEvent.click(toggle)); // close

      // BEFORE the 300ms unmount timer: the run is
      // already in the model. (The pane is still
      // mounted here — the point of dispatching at
      // the click rather than deferring to a settle
      // that the unmount would outrun.)
      expect(blocks()).toBe(2);
      expect(
        container.querySelector(".latin-pane")
      ).toBeTruthy();

      act(() => vi.advanceTimersByTime(300));
      expect(
        container.querySelector(".latin-pane")
      ).toBeFalsy();
      expect(blocks()).toBe(2);
    }
  );

  /** The toolbar/panel buttons carry sitelen pona
   *  labels rendered by <SP>, so this is the same
   *  string the component builds. */
  function byLabel(
    container: HTMLElement,
    label: string
  ): HTMLElement {
    const want = fromVerbatim(label);
    const hit = Array.from(
      container.querySelectorAll("button")
    ).find((b) => b.textContent === want);
    expect(hit).toBeTruthy();
    return hit as HTMLElement;
  }

  /** Type into the live Latin pane the way the user
   *  does: real transaction, real edit loop. */
  function typeLatin(
    latin: TiptapEditor,
    text: string
  ): void {
    act(() => {
      latin.commands.setTextSelection(
        latin.state.doc.content.size
      );
      latin.view.dispatch(
        latin.state.tr.insertText(text)
      );
    });
  }

  /**
   * VERSION-KEYED SAVES, FULL-APP VARIANT. The
   * class
   * test in Editor.test.tsx drives the adoption
   * directly; this one runs the whole app — a
   * keystroke in the mounted Latin pane, through the
   * edit loop, the version-keyed debounce, App's
   * save wiring and the dual write — and reads the
   * bytes back out of storage. Nothing else pins
   * that a Latin keystroke reaches localStorage.
   */
  it(
    "a Latin-LOCAL keystroke in the mounted pane " +
      "reaches STORAGE and reloads (end-to-end)",
    () => {
      localStorage.setItem(
        "lipu-sitelen-wawa:latin-pane", "on"
      );
      vi.useFakeTimers();
      const { container } = render(<App />);
      const { sp, latin } = captured.pairs[0];
      const id = getActiveDocId()!;
      expect(id).toBeTruthy();

      typeLatin(latin, "toki");
      act(() => vi.advanceTimersByTime(600));
      // the comma is LATIN-LOCAL: it lives in a gap,
      // and the SP projection cannot express it
      typeLatin(latin, ",");
      act(() => vi.advanceTimersByTime(600));

      const model = lipuModelKey.getState(sp.state)!
        .lipu;
      expect(
        model.blocks[0].gaps.at(-1)!.latin
      ).toBe(",");
      const stored = JSON.parse(
        localStorage.getItem(LIPU_PREFIX + id)!
      );
      expect({
        version: 2,
        blocks: stored.blocks,
      }).toEqual(model);
      // ...and the reload path (mirror + lipu, hash
      // checked) hands back the same model
      expect(loadDocLipu(id)).toEqual(model);
      expect(
        container.querySelector(".latin-pane__body")!
          .textContent
      ).toContain("toki,");
    }
  );

  /**
   * Pane lifecycle: switching documents is a
   * REMOUNT, not a reconcile. Both editors are keyed
   * by activeId, so doc B gets a fresh pair; the
   * satellite must never write doc A's model or
   * bytes.
   */
  it(
    "switching documents remounts the Latin pane " +
      "(no cross-doc reconciles)",
    () => {
      localStorage.setItem(
        "lipu-sitelen-wawa:latin-pane", "on"
      );
      vi.useFakeTimers();
      const { container } = render(<App />);
      const first = captured.pairs[0];
      const idA = getActiveDocId()!;

      typeLatin(first.latin, "toki,");
      act(() => vi.advanceTimersByTime(600));
      const storedA = localStorage.getItem(
        LIPU_PREFIX + idA
      )!;
      const mirrorBytesA = localStorage.getItem(
        DOC_PREFIX + idA
      )!;
      const mirrorA = loadDocLipu(idA);
      expect(mirrorA!.blocks[0].anchors).toHaveLength(
        1
      );

      // create + switch through the document panel
      act(() =>
        fireEvent.click(
          byLabel(container, "ante+lipu")
        )
      );
      act(() =>
        fireEvent.click(byLabel(container, "sin"))
      );
      act(() => vi.advanceTimersByTime(600));

      const idB = getActiveDocId()!;
      expect(idB).not.toBe(idA);
      // REMOUNT, observed shape: the switch tears
      // the whole pair down and builds a new one.
      // React hands the freshly-keyed LatinPane the
      // OUTGOING SP editor for one commit before the
      // new one exists, so a short-lived satellite
      // can be built against doc A — it is destroyed
      // in the same flush, and mount is inert,
      // so it writes nothing. What must hold is that
      // NOTHING live is left pointing at doc A.
      expect(
        captured.pairs.length
      ).toBeGreaterThanOrEqual(2);
      const second = captured.pairs.at(-1)!;
      for (const p of captured.pairs.slice(0, -1)) {
        expect(p.latin.isDestroyed).toBe(true);
      }
      expect(second.sp).not.toBe(first.sp);
      expect(second.latin).not.toBe(first.latin);
      expect(first.latin.isDestroyed).toBe(true);

      // doc B's pane shows doc B's projection...
      expect(
        lipuModelKey.getState(second.sp.state)!.lipu
          .blocks[0].anchors
      ).toHaveLength(0);
      const body = container.querySelector(
        ".latin-pane__body"
      )!;
      expect(body.textContent).not.toContain("toki");

      // ...and typing in it never touches doc A
      typeLatin(second.latin, "pona");
      act(() => vi.advanceTimersByTime(600));
      expect(
        localStorage.getItem(LIPU_PREFIX + idA)
      ).toBe(storedA);
      // BOTH stored halves, not the lipu half twice:
      // the old second assertion re-read the same
      // bytes through loadDocLipu and could not fail
      // once the line above held. (Doc A's MODEL is
      // no witness either — its editor is destroyed,
      // so its plugin state is frozen by
      // construction. Storage is the only surface a
      // post-switch write could still reach; the
      // stale-closure save is the live hazard, and
      // it writes the dual pair.)
      expect(
        localStorage.getItem(DOC_PREFIX + idA)
      ).toBe(mirrorBytesA);
      expect(
        loadDocLipu(idB)!.blocks[0].anchors.map(
          (a) => a.word
        )
      ).toEqual(["pona"]);
    }
  );

  /**
   * TASK-10 LEDGER, accepted and now pinned: a doc
   * switch DROPS the queued FORCE, so a run the user
   * was still dwelling on does not crystallize into a
   * split. That is a real persisted-state difference
   * on that gesture, inherent to the mandated
   * deferral — what must never happen is byte loss:
   * the run stays in gap.latin and crystallizes at
   * the next caret-leave after the switch back.
   */
  it(
    "a doc switch with a dwelled run drops the " +
      "queued FORCE: no split, no lost bytes " +
      "(accepted transient: the split waits for " +
      "the next caret-leave)",
    () => {
      localStorage.setItem(
        "lipu-sitelen-wawa:latin-pane", "on"
      );
      vi.useFakeTimers();
      const { container } = render(<App />);
      const { sp, latin } = captured.pairs[0];
      const idA = getActiveDocId()!;

      typeLatin(latin, "toki");
      act(() => {
        latin.commands.setTextSelection(
          latin.state.doc.content.size
        );
      });
      for (let i = 0; i < 2; i += 1) {
        act(() => {
          latin.view.dispatch(
            latin.state.tr.replaceSelectionWith(
              latin.state.schema.nodes.hardBreak
                .create()
            )
          );
        });
      }
      act(() => vi.advanceTimersByTime(600));
      // still ONE block: the caret is parked on the
      // run, so it has not crystallized
      expect(
        lipuModelKey.getState(sp.state)!.lipu.blocks
      ).toHaveLength(1);

      act(() =>
        fireEvent.click(
          byLabel(container, "ante+lipu")
        )
      );
      act(() =>
        fireEvent.click(byLabel(container, "sin"))
      );
      act(() => vi.advanceTimersByTime(600));

      const storedA = loadDocLipu(idA)!;
      expect(storedA.blocks).toHaveLength(1);
      expect(
        storedA.blocks[0].gaps.some((g) =>
          g.latin.includes("\n\n")
        )
      ).toBe(true);
    }
  );

  it(
    "open-close-open settles cleanly open",
    () => {
      localStorage.setItem(
        "lipu-sitelen-wawa:latin-pane", "off"
      );
      vi.useFakeTimers();
      const { container } = render(<App />);
      const toggle = container.querySelector(
        ".tab-toggle--side"
      ) as HTMLElement;
      expect(toggle).toBeTruthy();

      act(() => fireEvent.click(toggle)); // open
      act(() => vi.advanceTimersByTime(100));
      act(() => fireEvent.click(toggle)); // close
      act(() => vi.advanceTimersByTime(100));
      act(() => fireEvent.click(toggle)); // open

      const workspace = container.querySelector(
        ".app__workspace"
      )!;
      expect(workspace.className).toContain(
        "app__workspace--opening"
      );
      expect(workspace.className).not.toContain(
        "app__workspace--closing"
      );

      act(() => vi.advanceTimersByTime(300));

      expect(workspace.className).not.toContain(
        "app__workspace--opening"
      );
      expect(workspace.className).not.toContain(
        "app__workspace--closing"
      );
      expect(workspace.className).toContain(
        "app__workspace--split"
      );
      expect(
        container.querySelector(".latin-pane")
      ).toBeTruthy();
    }
  );
});
