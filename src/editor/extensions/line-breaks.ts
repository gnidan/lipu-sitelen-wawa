import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { lipuModelKey } from "./lipu-model";
import { focusTracker } from "../focus-tracker";
import { LIPU_SYNC_META } from "../lipu-sync";
import { isStructural, renderSp } from "../../lipu";
import type { Block } from "../../lipu";

/**
 * Paragraphs are content-driven: a paragraph never
 * contains two consecutive hardBreaks. Plain Enter
 * always inserts a soft break (hardBreak); it never
 * decides to split. An appendTransaction normalizer
 * scans the whole doc after every doc-changing
 * transaction and converts any maximal run of two or
 * more consecutive hardBreaks -- an empty line -- into
 * a paragraph split, regardless of how that run came to
 * exist (typed Enters, Shift+Enter, undo, paste,
 * programmatic edits, ...) -- EXCEPT in two cases.
 *
 * 1. Inside a promoted structural span: a run
 *    between a cartouche/long/rev-long
 *    span's markers is literal gap.sp content and
 *    never splits. Span ranges come from the lipu
 *    plugin state, which ProseMirror guarantees is
 *    fresh here (every plugin's state.apply runs
 *    before any appendTransaction).
 *    Transitional (unmatched) markers suppress
 *    nothing, and demotion re-exposes a previously
 *    suppressed run to the NEXT edit's pass -- both
 *    by design. The suppressed region is read
 *    from the rendered MARKER positions, so a span's
 *    marker offsets are honoured on BOTH sides: a run in
 *    gaps[from] AFTER the start marker, or in
 *    gaps[to + 1] BEFORE the end marker, is interior
 *    and never splits, while a run on the outer side
 *    of either marker -- same gap -- splits normally.
 * 2. COMPOSITION DWELL: a run the selection is
 *    inside or immediately adjacent to is SKIPPED,
 *    so an empty line the writer is still composing
 *    on stays an empty line. The split crystallizes
 *    on the first transaction that leaves the run
 *    unattended (a plain caret move is enough -- the
 *    pass runs on selection-only transactions too),
 *    or on editor blur, which dispatches a forced
 *    pass. A dwelled run is legal TRANSIENT model
 *    content: it survives in gap.sp, and in storage
 *    if an autosave fires mid-dwell; "no 2+ run
 *    outside a structural span" is a
 *    post-crystallization invariant, not a
 *    per-transaction one.
 *
 * Named layering change: this plugin now depends on
 * lipu-model plugin state; the key exists for plugin
 * identity (and for the blur handler's meta), there is
 * still no OWN state.
 */
export const lineBreaksKey = new PluginKey("lineBreaks");

/** Meta value asking for a pass that ignores
 *  COMPOSITION DWELL: the editor lost focus, so
 *  nothing is being composed and every pending run
 *  crystallizes. */
const FORCE = "forceNormalize";

/** Block-relative [from, to) offset ranges lying
 *  strictly between a promoted structural span's
 *  marker chars. Offsets count exactly like PM
 *  content offsets (UTF-16 units; hardBreak = 1),
 *  which is what makes the comparison below exact
 *  -- see pm-coords.ts. Taking the range from the
 *  rendered marker entries (rather than from the
 *  covered anchors' gaps) is what makes the
 *  MARKER-OFFSET cases exact: renderSp emits each
 *  marker at its recorded offset inside the exterior
 *  gap, so the interior is literally "after the start
 *  marker, before the end marker" in doc
 *  coordinates. */
function suppressedRanges(
  block: Block | undefined
): Array<{ from: number; to: number }> {
  if (!block) return [];
  const out: Array<{ from: number; to: number }> = [];
  const { map } = renderSp(block);
  block.spans.forEach((s, si) => {
    if (!isStructural(s.kind)) return;
    const start = map.find(
      (e) =>
        e.ref.seg === "marker" &&
        e.ref.span === si &&
        e.ref.end === "start"
    );
    const end = map.find(
      (e) =>
        e.ref.seg === "marker" &&
        e.ref.span === si &&
        e.ref.end === "end"
    );
    if (start && end) {
      out.push({ from: start.to, to: end.from });
    }
  });
  return out;
}

/** COMPOSITION DWELL: is the selection ON the run?
 *  The run occupies [from, to), so the caret
 *  positions TOUCHING it are from..to inclusive -- a
 *  caret at `from` sits before the first break, one
 *  at `to` after the last, and every position between
 *  them is inside the empty line. Either endpoint of
 *  the selection counts: a selection that ends on the
 *  empty line is still attending it.
 *
 *  The window is exactly [from, to] -- deliberately
 *  NOT widened by one on each side. A
 *  ±1 window measures in UTF-16 units, so it would
 *  make the same gesture behave differently depending
 *  on the width of the character typed next: one
 *  single-unit char ("!", a space) would still dwell
 *  while a 2-unit UCSUR glyph would not, and an arrow
 *  key stepping off the run over a 1-unit char would
 *  fail to crystallize. Touching is exact and
 *  width-independent. */
function dwelled(
  state: EditorState,
  from: number,
  to: number
): boolean {
  const { anchor, head } = state.selection;
  const touching = (p: number): boolean =>
    p >= from && p <= to;
  return touching(anchor) || touching(head);
}

export const LineBreaks = Extension.create({
  name: "lineBreaks",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: lineBreaksKey,
        props: {
          handleKeyDown(view, event) {
            if (
              event.key !== "Enter" ||
              event.shiftKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey
            ) {
              return false;
            }
            const { state } = view;
            const br =
              state.schema.nodes.hardBreak.create();
            const tr =
              state.tr.replaceSelectionWith(br);
            tr.scrollIntoView();
            view.dispatch(tr);
            return true;
          },
          handleDOMEvents: {
            // Blur crystallizes every dwelled run:
            // the writer left, so nothing is being
            // composed. The dispatched transaction
            // carries no steps -- it exists only to
            // give appendTransaction a pass to run,
            // marked FORCE so dwell is ignored.
            //
            // DEFERRED to the FocusTracker's settle:
            // at blur time the
            // peer pane's focus event has not happened
            // yet, so "the writer left" cannot be told
            // from "the writer hopped to the Latin
            // pane". Blur-to-PEER carries the dwelled
            // run untouched; only a TRUE blur (null at
            // settle, popup clicks included) forces.
            // view.isDestroyed and view.composing are
            // re-checked THERE, where they are true of
            // the moment we actually dispatch.
            //
            // ORDERING vs Autocomplete's own blur
            // handler (which marks a pending Latin
            // run verbatim) is PRIORITY LUCK, not
            // design: Autocomplete is priority 110,
            // so its plugin sorts ahead of this one
            // and ProseMirror runs its handler first
            // -- which is the order we want (the
            // pending run lands in the doc before we
            // normalize). Both return false, so both
            // always run, and both now queue on the
            // tracker, which settles FIFO -- so the
            // deferral PRESERVES that order. If either
            // priority ever changes, re-check this
            // pairing. Even
            // so, a preceding split cannot leave
            // Autocomplete's popup stale: its plugin
            // state recomputes `range` from
            // `newState` on every apply (autocomplete
            // .ts), the post-transaction doc, never
            // from a value captured before this
            // handler ran.
            //
            // An ACTIVE COMPOSITION (IME) is exempt:
            // blurring mid-composition must not
            // rewrite the doc under the input method.
            // The dwelled run simply waits for the
            // next qualifying transaction, which the
            // composition's own commit provides.
            blur(view) {
              focusTracker.notifyBlur(
                "sp",
                (now) => {
                  // blur-to-peer: dwell CARRIES
                  // — no forced pass. True
                  // blur (incl. popup clicks):
                  // today's semantics.
                  if (now !== null) return;
                  if (view.isDestroyed) return;
                  if (view.composing) return;
                  view.dispatch(
                    view.state.tr.setMeta(
                      lineBreaksKey,
                      FORCE
                    )
                  );
                }
              );
              return false;
            },
          },
        },
        appendTransaction(trs, oldState, newState) {
          // FOREIGN-TRANSACTION RULE: a
          // lipuSync adoption already
          // carries the model's final shape; the
          // normalizer must not append its own
          // rewrite of it. Genuine transactions
          // (including the very next one) still
          // normalize.
          if (
            trs.some(
              (t) =>
                t.getMeta(LIPU_SYNC_META) !== undefined
            )
          ) {
            return null;
          }
          const force = trs.some(
            (t) => t.getMeta(lineBreaksKey) === FORCE
          );
          // Dwell makes the pass selection-sensitive:
          // a caret move with no doc change is exactly
          // the "leaves the run unattended" event.
          if (
            !force &&
            !trs.some((t) => t.docChanged) &&
            oldState.selection.eq(newState.selection)
          ) {
            return null;
          }
          const model =
            lipuModelKey.getState(newState);
          interface Run {
            from: number;
            to: number;
          }
          const runs: Run[] = [];
          // paraIndex is the doc CHILD index; the
          // lipu's blocks are indexed by PARAGRAPH
          // (lipu-model's parsedParagraphs filters on
          // type "paragraph"). The two agree because
          // this schema's top level holds nothing but
          // paragraphs -- the same assumption
          // pm-coords and test-invariants make. If a
          // non-paragraph block node is ever added,
          // this lookup (and they) must switch to a
          // running paragraph counter.
          newState.doc.forEach(
            (para, paraPos, paraIndex) => {
              const contentStart = paraPos + 1;
              // Only paragraphs that actually hold a
              // run pay for a render (this pass now
              // runs on caret moves too).
              let ranges:
                | Array<{ from: number; to: number }>
                | undefined;
              const consider = (
                runStart: number,
                runLen: number
              ): void => {
                if (runLen < 2) return;
                if (
                  !force &&
                  focusTracker.focused() ===
                    "latin"
                ) {
                  // Dwell evaluation
                  // SUSPENDED (carried, not
                  // crystallized) while the SP
                  // editor lacks focus because the
                  // peer holds it. A null tracker
                  // (headless/tests, true-blur
                  // paths) evaluates as today.
                  return;
                }
                const from = runStart;
                const to = runStart + runLen;
                if (
                  !force &&
                  dwelled(newState, from, to)
                ) {
                  return;
                }
                if (ranges === undefined) {
                  ranges = suppressedRanges(
                    model?.lipu.blocks[paraIndex]
                  );
                }
                const relFrom = from - contentStart;
                const relTo = to - contentStart;
                // A run can never straddle a marker
                // char -- a text char terminates a
                // hardBreak run -- so containment is
                // total or absent; a partial overlap
                // is impossible and, if the
                // impossible happened, the fail-open
                // branch splits, which the render
                // invariant would catch.
                if (
                  ranges.some(
                    (r) =>
                      r.from <= relFrom &&
                      relTo <= r.to
                  )
                ) {
                  return;
                }
                runs.push({ from, to });
              };
              let runStart = -1;
              let runLen = 0;
              let pos = contentStart;
              para.forEach((child) => {
                if (child.type.name === "hardBreak") {
                  if (runStart === -1) {
                    runStart = pos;
                  }
                  runLen += 1;
                } else {
                  consider(runStart, runLen);
                  runStart = -1;
                  runLen = 0;
                }
                pos += child.nodeSize;
              });
              consider(runStart, runLen);
            }
          );
          if (runs.length === 0) return null;
          const tr = newState.tr;
          if (force) {
            // Keep a forced pass forced across the
            // appendTransaction rounds: every plugin
            // (this one included) sees the
            // transactions appended after it. No
            // current test reaches a second forced
            // round -- one pass consumes every run
            // and a split creates none -- so this is
            // a guard for a later plugin appending a
            // doc change while the editor is
            // blurred, not a pinned behaviour.
            tr.setMeta(lineBreaksKey, FORCE);
          }
          for (let i = runs.length - 1; i >= 0; i--) {
            const { from, to } = runs[i];
            tr.delete(from, to);
            tr.split(from);
          }
          return tr;
        },
      }),
    ];
  },
});
