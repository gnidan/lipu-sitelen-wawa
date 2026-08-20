/**
 * Explicit dual-pane focus state.
 * A plugin-EXTERNAL singleton both editors'
 * plugins and the React layer consult — focus is
 * not plugin state (no transaction plumbing).
 * Maintained by focus/blur listeners with a
 * microtask settle; relatedTarget is never
 * inspected (null on window blur, unreliable
 * under programmatic focus). RESET on the
 * activeId-keyed Editor remount.
 *
 * WHY A SETTLE. A blur handler cannot tell
 * "blur to the peer pane" from "blur out of the
 * app" at the moment it fires: the peer's focus
 * event has not happened yet. So every blur
 * consumer registers a CALLBACK and the tracker
 * runs it one microtask later, by which time the
 * peer's focus (if any) has been recorded. That
 * is the whole reason the three SP blur
 * dispatches — LineBreaks' forced crystallization
 * pass, Autocomplete's verbatim mark, the
 * SelectionMenu teardown — are deferred rather
 * than synchronous: blur-to-peer must NOT force
 * (the dwell CARRIES across the pane hop),
 * while a TRUE blur keeps today's semantics.
 *
 * Deferring all three preserves their existing
 * relative ORDER: ProseMirror calls the plugins'
 * blur handlers in plugin-priority order
 * (Autocomplete at 110 before LineBreaks), they
 * queue in that order, and the queue settles FIFO.
 */

import type { EditorView } from "@tiptap/pm/view";

export type PaneId = "sp" | "latin";

export interface FocusTracker {
  focused(): PaneId | null;
  /** WHICH editor is the SP pane. The blur
   *  consumers below live in extensions that are
   *  SHARED: NameInput builds its own little editor
   *  out of Autocomplete + SelectionMenu +
   *  AutocompletePopup, and that editor is not a
   *  pane — clicking from it into the SP editor is
   *  not a pane hop, so it must keep today's
   *  semantics (mark, dismiss, tear the menu down)
   *  rather than defer to a settle that reports the
   *  SP pane taking focus. Editor.tsx claims; the
   *  claim is released on unmount.
   *
   *  UNCLAIMED means EVERY view is the pane, so
   *  headless tests and any future single-editor
   *  host behave exactly as the pane does. */
  claimSpView(view: EditorView | null): void;
  isSpView(view: EditorView): boolean;
  notifyFocus(pane: PaneId): void;
  /** onSettle fires after the microtask settle
   *  with whichever pane is focused THEN (null =
   *  true blur). A suppressNext() call classifies
   *  the settle as-if-to-peer. */
  notifyBlur(
    pane: PaneId,
    onSettle: (now: PaneId | null) => void
  ): void;
  // undo's induced blur uses this: see settle()
  suppressNext(): void;
  subscribe(cb: () => void): () => void;
  reset(): void;
}

function createTracker(): FocusTracker {
  let focused: PaneId | null = null;
  let spView: EditorView | null = null;
  let suppressed = false;
  let suppressGen = 0;
  let pendingBlur: PaneId | null = null;
  let queue: Array<
    (now: PaneId | null) => void
  > = [];
  const subs = new Set<() => void>();
  const notify = (): void => {
    for (const cb of subs) cb();
  };
  const settle = (): void => {
    queueMicrotask(() => {
      if (queue.length === 0) return;
      if (
        pendingBlur !== null &&
        focused === pendingBlur
      ) {
        focused = null;
      }
      pendingBlur = null;
      let now = focused;
      if (suppressed) {
        // classify as-if-to-peer so undo's
        // induced blur never crystallizes the
        // state it just restored
        suppressed = false;
        if (now === null) {
          now = "latin";
        }
      }
      const cbs = queue;
      queue = [];
      for (const cb of cbs) cb(now);
      notify();
    });
  };
  return {
    focused: () => focused,
    claimSpView(view) {
      spView = view;
    },
    isSpView(view) {
      return spView === null || spView === view;
    },
    notifyFocus(pane) {
      focused = pane;
      pendingBlur = null;
      notify();
    },
    notifyBlur(pane, onSettle) {
      pendingBlur = pane;
      const empty = queue.length === 0;
      queue.push(onSettle);
      if (empty) settle();
    },
    suppressNext() {
      // ARM FOR THIS TURN ONLY. The flag is consumed
      // at a settle, and settles happen only when a
      // blur queues — so an arming with no ensuing
      // blur (undo while the editor ALREADY held
      // focus induces none) would otherwise survive
      // and eat the next REAL blur's
      // crystallization. The disarm is TWO
      // microtasks out, never one: a blur queued in
      // the same turn schedules its settle AFTER
      // this outer microtask, so a one-deep disarm
      // would win the race against the very settle
      // it was armed for. The generation stamp keeps
      // an older disarm from clearing a newer
      // arming.
      suppressed = true;
      const gen = ++suppressGen;
      queueMicrotask(() => {
        queueMicrotask(() => {
          if (suppressGen === gen) {
            suppressed = false;
          }
        });
      });
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    reset() {
      // the CLAIM is not focus state: it survives a
      // reset (Editor.tsx resets on mount, and the
      // mount is exactly where the claim is made)
      focused = null;
      suppressed = false;
      suppressGen += 1;
      pendingBlur = null;
      queue = [];
      notify();
    },
  };
}

export const focusTracker: FocusTracker =
  createTracker();
