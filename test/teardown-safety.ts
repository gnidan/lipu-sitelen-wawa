import { EditorView } from "@tiptap/pm/view";

/**
 * THE TEARDOWN FLAKE: pre-existing, reported as
 * roughly 20% of full-suite runs flipping the
 * process exit code while every test passed.
 *
 * STATUS OF THIS EXPLANATION: a HYPOTHESIS
 * consistent with the reported signature (a
 * post-teardown DOMObserver flush hitting
 * `document`), NOT a reproduction — the flip never
 * occurred in extensive testing here, so nothing
 * below was observed failing; it was derived from
 * the library source and from the live views the
 * net actually finds at runtime. The leading
 * ALTERNATIVE hypothesis is a timer that happy-dom
 * does not own: its teardown calls
 * `abort()`, which cancels the timers tracked by the
 * window, so a DOMObserver timer scheduled through
 * `window.setTimeout` is arguably already cancelled by
 * the time the globals go — which would point at a
 * bare-`setTimeout` path (React's `scheduleDestroy`,
 * ours, or a library's) instead. The net is worth
 * keeping either way: it removes the whole class of
 * live-view-after-teardown work, and it costs one
 * `afterAll`.
 *
 * Mechanism (hypothesised), traced through the source:
 *
 * 1. A test creates an editor and does not destroy it
 *    — either literally (no `destroy()` call) or
 *    effectively: @tiptap/react's `useEditor` defers
 *    destruction by a 1ms timer (`scheduleDestroy`),
 *    so a React-rendered editor is still LIVE when the
 *    file's `cleanup()` returns.
 * 2. ProseMirror's DOMObserver schedules its work on
 *    timers: `flushSoon()` is a 20ms `window.setTimeout`
 *    (prosemirror-view dist ~4619), and `stop()` — which
 *    `view.destroy()` calls — schedules one more 20ms
 *    flush when mutation records are still queued
 *    (~4643).
 * 3. Vitest tears the happy-dom environment down at the
 *    end of the FILE, deleting the `document` global. A
 *    flush timer that survives into that window runs
 *    against a LIVE view (`view.docView` non-null), so
 *    it can reach `selectionToDOM` →
 *    `editorOwnsSelection` → the bare
 *    `document.activeElement` at dist ~2238 →
 *    `ReferenceError: document is not defined`. (The
 *    bare global is in `editorOwnsSelection`, not in
 *    `hasFocusAndSelection`.) Vitest reports the
 *    throw as an unhandled error and exits 1 with
 *    every test green.
 *
 * A DESTROYED view is harmless: `flush()` returns at its
 * first line when `view.docView` is null, before any DOM
 * access (dist ~4707). So the whole class is closed by
 * one rule — no view may be alive when the environment
 * goes away — which is what the net below enforces. It
 * runs in `afterAll`, i.e. after every test and every
 * `cleanup()` in the file, and it destroys only what the
 * file left behind; it neither swallows errors nor
 * touches assertions, so a genuine failure still fails.
 *
 * The registry is kept by wrapping two EditorView
 * prototype methods. `updateStateInner` is the hook for
 * CREATION (the constructor calls it, dist ~5428) and
 * `destroy` is the hook for retirement, so the set holds
 * exactly the live views. Both are asserted present at
 * install time: a library upgrade that renames either
 * one fails loudly here instead of silently disarming
 * the net.
 */

type ViewInternals = {
  updateStateInner: (...args: unknown[]) => void;
  destroy: () => void;
};

const liveViews = new Set<EditorView>();
let installed = false;

export function installViewTeardownNet(): void {
  if (installed) return;
  installed = true;
  const proto =
    EditorView.prototype as unknown as ViewInternals;
  for (const name of [
    "updateStateInner",
    "destroy",
  ] as const) {
    if (typeof proto[name] !== "function") {
      throw new Error(
        "test/teardown-safety.ts: EditorView." +
          `prototype.${name} is missing — the ` +
          "teardown net needs a new hook point"
      );
    }
  }
  const origUpdate = proto.updateStateInner;
  proto.updateStateInner = function (
    this: EditorView,
    ...args: unknown[]
  ): void {
    liveViews.add(this);
    return origUpdate.apply(this, args);
  };
  const origDestroy = proto.destroy;
  proto.destroy = function (this: EditorView): void {
    liveViews.delete(this);
    return origDestroy.call(this);
  };
}

/** Live (undestroyed) views seen by the net. */
export function liveViewCount(): number {
  return liveViews.size;
}

/** Destroy whatever the file left alive, while the DOM
 *  still exists. Returns how many it had to take. */
export function destroyLiveViews(): number {
  let n = 0;
  for (const view of liveViews) {
    if (!view.isDestroyed) {
      n += 1;
      view.destroy();
    }
  }
  liveViews.clear();
  return n;
}
