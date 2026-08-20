import { describe, it, expect, vi } from "vitest";
import { focusTracker } from "./focus-tracker";
import type { EditorView } from "@tiptap/pm/view";

const settle = (): Promise<void> =>
  new Promise((r) => queueMicrotask(() => r()));

describe("focusTracker", () => {
  it("blur-to-peer settles on the peer (no true " +
     "blur)", async () => {
    focusTracker.reset();
    focusTracker.notifyFocus("sp");
    const seen: Array<string | null> = [];
    focusTracker.notifyBlur("sp", (now) =>
      seen.push(now)
    );
    focusTracker.notifyFocus("latin");
    await settle();
    expect(seen).toEqual(["latin"]);
    expect(focusTracker.focused()).toBe("latin");
  });

  it("unanswered blur settles as TRUE blur " +
     "(null)", async () => {
    focusTracker.reset();
    focusTracker.notifyFocus("sp");
    const seen: Array<string | null> = [];
    focusTracker.notifyBlur("sp", (now) =>
      seen.push(now)
    );
    await settle();
    expect(seen).toEqual([null]);
    expect(focusTracker.focused()).toBeNull();
  });

  it("suppressNext classifies the settle " +
     "as-if-to-peer, once", async () => {
    focusTracker.reset();
    focusTracker.notifyFocus("sp");
    focusTracker.suppressNext();
    const seen: Array<string | null> = [];
    focusTracker.notifyBlur("sp", (now) =>
      seen.push(now)
    );
    await settle();
    expect(seen).toEqual(["latin"]);
    // next blur is normal again
    focusTracker.notifyFocus("sp");
    focusTracker.notifyBlur("sp", (now) =>
      seen.push(now)
    );
    await settle();
    expect(seen).toEqual(["latin", null]);
  });

  it("suppressNext ARMS FOR ITS OWN TURN ONLY: an armed " +
     "suppression with no ensuing blur does not " +
     "eat the NEXT real blur",
     async () => {
    focusTracker.reset();
    focusTracker.notifyFocus("sp");
    // armed, but nothing blurs this turn — e.g. undo
    // ran while the editor already held focus, so
    // the programmatic focus() induced no blur at all
    focusTracker.suppressNext();
    await settle();
    await settle();
    // ...and now a GENUINE blur, two microtasks
    // later: it must crystallize as a true blur
    const seen: Array<string | null> = [];
    focusTracker.notifyBlur("sp", (now) =>
      seen.push(now)
    );
    await settle();
    expect(seen).toEqual([null]);
    expect(focusTracker.focused()).toBeNull();
  });

  it("the disarm does not race the settle it was " +
     "armed for: blur queued in the SAME turn is " +
     "still suppressed", async () => {
    focusTracker.reset();
    focusTracker.notifyFocus("sp");
    const seen: Array<string | null> = [];
    focusTracker.suppressNext();
    focusTracker.notifyBlur("sp", (now) =>
      seen.push(now)
    );
    await settle();
    await settle();
    expect(seen).toEqual(["latin"]);
  });

  it("callbacks settle FIFO (Autocomplete-" +
     "before-LineBreaks ordering preserved)",
     async () => {
    focusTracker.reset();
    focusTracker.notifyFocus("sp");
    const order: string[] = [];
    focusTracker.notifyBlur("sp", () =>
      order.push("autocomplete")
    );
    focusTracker.notifyBlur("sp", () =>
      order.push("lineBreaks")
    );
    await settle();
    expect(order).toEqual([
      "autocomplete",
      "lineBreaks",
    ]);
  });

  it("subscribe notifies on every change and " +
     "reset clears", async () => {
    focusTracker.reset();
    const spy = vi.fn();
    const off = focusTracker.subscribe(spy);
    focusTracker.notifyFocus("latin");
    expect(spy).toHaveBeenCalled();
    off();
    focusTracker.reset();
    expect(focusTracker.focused()).toBeNull();
  });

  it("a blur ANSWERED by the same pane refocusing " +
     "settles on that pane (popup click, undo's " +
     "programmatic refocus)", async () => {
    focusTracker.reset();
    focusTracker.notifyFocus("sp");
    const seen: Array<string | null> = [];
    focusTracker.notifyBlur("sp", (now) =>
      seen.push(now)
    );
    focusTracker.notifyFocus("sp");
    await settle();
    expect(seen).toEqual(["sp"]);
    expect(focusTracker.focused()).toBe("sp");
  });

  it("the settle is DEFERRED: no callback runs in " +
     "the notifyBlur turn", async () => {
    focusTracker.reset();
    focusTracker.notifyFocus("sp");
    const seen: Array<string | null> = [];
    focusTracker.notifyBlur("sp", (now) =>
      seen.push(now)
    );
    // the discriminator against a synchronous
    // dispatch: nothing has run yet
    expect(seen).toEqual([]);
    await settle();
    expect(seen).toEqual([null]);
  });
});

/** The extensions that consult the tracker are
 *  SHARED with editors that are not panes
 *  (NameInput). The claim is how they tell. */
describe("focusTracker: the SP-pane claim", () => {
  const view = (name: string): EditorView =>
    ({ name }) as unknown as EditorView;

  it("UNCLAIMED means every view is the pane", () => {
    focusTracker.reset();
    focusTracker.claimSpView(null);
    expect(
      focusTracker.isSpView(view("any"))
    ).toBe(true);
  });

  it("a claim excludes every other view (the " +
     "NameInput case) and survives reset", () => {
    const pane = view("pane");
    const other = view("other");
    focusTracker.claimSpView(pane);
    expect(focusTracker.isSpView(pane)).toBe(true);
    expect(focusTracker.isSpView(other)).toBe(
      false
    );
    focusTracker.reset();
    expect(focusTracker.isSpView(other)).toBe(
      false
    );
    focusTracker.claimSpView(null);
  });
});
