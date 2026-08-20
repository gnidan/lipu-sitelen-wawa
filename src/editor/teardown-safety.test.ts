import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { EditorView } from "@tiptap/pm/view";
import {
  destroyLiveViews,
  liveViewCount,
} from "../../test/teardown-safety";

/**
 * THE TEARDOWN FLAKE. The net lives in
 * test/setup.ts; these pin the two library facts it
 * rests on, so a ProseMirror/TipTap upgrade that
 * invalidates either one fails here instead of
 * resurrecting a ~20% exit-code flip.
 */

type Observed = {
  domObserver: {
    flush: () => void;
    flushSoon: () => void;
    flushingSoon: unknown;
  };
};

const mk = (): Editor =>
  new Editor({
    extensions: [StarterKit.configure({})],
    content: "<p>toki</p>",
  });

describe("teardown safety net", () => {
  it("tracks live views and lets go of destroyed " +
     "ones", () => {
    const before = liveViewCount();
    const ed = mk();
    expect(liveViewCount()).toBe(before + 1);
    ed.destroy();
    expect(liveViewCount()).toBe(before);
  });

  it("a DESTROYED view's deferred DOMObserver flush " +
     "is inert — it returns before any DOM access " +
     "(this is why destroying at file end is enough)",
     () => {
    const ed = mk();
    const view = ed.view as unknown as EditorView &
      Observed;
    // queue the work the way a real edit does, then
    // destroy: stop() re-schedules a flush for 20ms
    // later, which in CI can land after the
    // environment is gone
    view.domObserver.flushSoon();
    ed.destroy();
    expect(view.isDestroyed).toBe(true);
    // the late timer, run by hand: no throw, no DOM
    expect(() => view.domObserver.flush()).not
      .toThrow();
  });

  it("the sweep destroys what a test leaves behind " +
     "and reports the count", () => {
    const leaked = mk();
    const before = liveViewCount();
    expect(before).toBeGreaterThan(0);
    expect(destroyLiveViews()).toBe(before);
    expect(leaked.isDestroyed).toBe(true);
    expect(liveViewCount()).toBe(0);
  });
});
