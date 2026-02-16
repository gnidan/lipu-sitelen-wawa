import { Extension } from "@tiptap/core";
import {
  Plugin,
  PluginKey,
} from "@tiptap/pm/state";
import {
  EditorView,
} from "@tiptap/pm/view";
import {
  isControlChar,
  ucsurControlToAscii,
  isNiArrowCp,
  niDirectionByArrowCp,
  niDirectionByVerbatim,
  charToCodepoint,
  codepointToChar,
} from "../../data";
import {
  verbatimTogglePluginKey,
  findVerbatimSpan,
} from "./verbatim-toggle";
import { fromVerbatim } from "../../convert/verbatim";

/** Horizontal gap between stem and badge in px */
const GAP_PX = 3;
/** Vertical offset below cursor in px */
const DROP_PX = 4;
/**
 * Minimum pixel width between span.start and
 * span.end before showing the exit hint beside
 * the "sitelen pona ala" label.
 */
const MIN_HINT_PX = 120;

/**
 * Read the codepoint immediately before the given
 * text offset, handling surrogate pairs.
 */
function cpBefore(
  text: string,
  off: number
): number | undefined {
  if (off < 1) return undefined;
  if (off >= 2) {
    const hi = text.charCodeAt(off - 2);
    const lo = text.charCodeAt(off - 1);
    if (
      hi >= 0xd800 && hi <= 0xdbff &&
      lo >= 0xdc00 && lo <= 0xdfff
    ) {
      return (
        (hi - 0xd800) * 0x400 +
        (lo - 0xdc00) + 0x10000
      );
    }
  }
  return text.charCodeAt(off - 1);
}

/**
 * Map a codepoint to its indicator label:
 * UCSUR control chars get their ASCII keystroke,
 * literal spaces get the ⎵ glyph.
 */
function indicatorLabel(
  cp: number
): string | undefined {
  const label = ucsurControlToAscii(cp);
  if (label !== undefined) return label;
  if (cp === 0x20) return "\u23B5";
  const niDir = niDirectionByArrowCp(cp);
  if (niDir) return niDir.verbatim;
  return undefined;
}

interface Keycap {
  label: string;
  /** true when this keycap shows a sitelen pona
   *  glyph rather than an ASCII keystroke */
  glyph: boolean;
}

/**
 * If the codepoint is a UCSUR glyph, return
 * the rendered character; otherwise undefined.
 */
function glyphChar(
  cp: number
): string | undefined {
  const ch = codepointToChar(cp);
  if (charToCodepoint(ch) !== undefined) {
    return ch;
  }
  return undefined;
}

/**
 * Scan left from offset, collecting a run of
 * consecutive control/space keycaps (in
 * document order). Includes the first adjacent
 * glyph as the outermost keycap.
 */
function scanLeft(
  text: string,
  off: number
): Keycap[] {
  const caps: Keycap[] = [];
  let pos = off;
  while (pos > 0) {
    const cp = cpBefore(text, pos);
    if (cp === undefined) break;
    const label = indicatorLabel(cp);
    if (label === undefined) break;
    caps.unshift({ label, glyph: false });
    pos -= cp > 0xffff ? 2 : 1;
  }
  // Include the adjacent glyph
  if (pos > 0) {
    const cp = cpBefore(text, pos);
    if (cp !== undefined) {
      const ch = glyphChar(cp);
      if (ch) {
        caps.unshift({ label: ch, glyph: true });
      }
    }
  }
  return caps;
}

/**
 * Scan right from offset, collecting a run of
 * consecutive control/space keycaps. Includes
 * the first adjacent glyph as the outermost
 * keycap.
 */
function scanRight(
  text: string,
  off: number
): Keycap[] {
  const caps: Keycap[] = [];
  let pos = off;
  while (pos < text.length) {
    const cp = text.codePointAt(pos);
    if (cp === undefined) break;
    const label = indicatorLabel(cp);
    if (label === undefined) break;
    caps.push({ label, glyph: false });
    pos += cp > 0xffff ? 2 : 1;
  }
  // Include the adjacent glyph
  if (pos < text.length) {
    const cp = text.codePointAt(pos);
    if (cp !== undefined) {
      const ch = glyphChar(cp);
      if (ch) {
        caps.push({ label: ch, glyph: true });
      }
    }
  }
  return caps;
}

function renderVerbatimOverlay(
  view: EditorView,
  overlay: HTMLElement,
  from: number,
  span: { start: number; end: number } | null
) {
  // Square bracket under span
  if (span) {
    const startDOM =
      view.domAtPos(span.start);
    const endDOM =
      view.domAtPos(span.end);
    const range = document.createRange();
    range.setStart(
      startDOM.node, startDOM.offset
    );
    range.setEnd(
      endDOM.node, endDOM.offset
    );
    const origin =
      overlay.getBoundingClientRect();
    const rects = Array.from(
      range.getClientRects()
    );
    const pad = 4;
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      const el =
        document.createElement("div");
      const isStart = i === 0;
      const isEnd = i === rects.length - 1;
      let cls = "verbatim-bracket";
      if (isStart) {
        cls += " verbatim-bracket--start";
      }
      if (isEnd) {
        cls += " verbatim-bracket--end";
      }
      el.className = cls;
      const lx = rect.left - origin.left
        - (isStart ? pad : 0);
      const w = rect.width
        + (isStart ? pad : 0)
        + (isEnd ? pad : 0);
      el.style.left = lx + "px";
      el.style.top =
        (rect.top + rect.height
          - origin.top) + "px";
      el.style.width = w + "px";
      overlay.appendChild(el);
    }
  }

  // Label + hint on same line below underline.
  // Label left-aligned at span.start,
  // hint right-aligned at span.end.
  const startPos = span ? span.start : from;
  const endPos = span ? span.end : from;

  let startCoords;
  try {
    startCoords = view.coordsAtPos(startPos);
  } catch { return; }

  const origin =
    overlay.getBoundingClientRect();
  const sx = startCoords.left - origin.left;
  const sy = startCoords.bottom - origin.top;
  const badgeTop = (sy + DROP_PX) + "px";

  // "sitelen pona ala" at span start
  const badge =
    document.createElement("span");
  badge.className = "structural-indicator";
  const sp = document.createElement("span");
  sp.className = "sp-text verbatim-badge";
  sp.textContent =
    fromVerbatim("sitelen+pona ala");
  badge.appendChild(sp);
  badge.style.left = sx + "px";
  badge.style.top = badgeTop;
  overlay.appendChild(badge);

  // Exit hint at span end (same line)
  const atEnd = !span || from === span.end;
  if (atEnd && span) {
    let endCoords;
    try {
      endCoords = view.coordsAtPos(endPos);
    } catch { return; }

    const ex = endCoords.left - origin.left;
    if (ex - sx >= MIN_HINT_PX) {
      const hint =
        document.createElement("div");
      hint.className =
        "verbatim-hint-line";
      const kbd =
        document.createElement("kbd");
      kbd.textContent = "``";
      const kbd2 =
        document.createElement("kbd");
      kbd2.textContent = "\u2192";
      const arrow =
        document.createElement("span");
      arrow.className =
        "verbatim-hint-arrow";
      arrow.textContent = "\u2192";
      const hintSP =
        document.createElement("span");
      hintSP.className = "sp-text";
      hintSP.textContent =
        fromVerbatim("sitelen+pona");
      hint.appendChild(kbd);
      hint.appendChild(kbd2);
      hint.appendChild(arrow);
      hint.appendChild(hintSP);
      hint.style.position = "absolute";
      hint.style.left = ex + "px";
      hint.style.top = badgeTop;
      hint.style.transform =
        "translateX(-100%)";
      overlay.appendChild(hint);
    }
  }
}

function renderOverlay(
  view: EditorView,
  overlay: HTMLElement,
  alwaysShow?: boolean,
) {
  overlay.innerHTML = "";

  if (!alwaysShow && !view.hasFocus()) return;

  const { from, to } = view.state.selection;
  if (from !== to) return;

  const vtState =
    verbatimTogglePluginKey.getState(
      view.state
    );

  if (vtState?.active) {
    const span = findVerbatimSpan(
      view.state, from
    );
    renderVerbatimOverlay(
      view, overlay, from, span
    );
    return;
  }

  const $from = view.state.doc.resolve(from);
  if (!$from.parent.isTextblock) return;

  const blockStart = $from.start();
  const text = $from.parent.textContent;
  const off = from - blockStart;

  const left = scanLeft(text, off);
  const right = scanRight(text, off);

  // Detect verbatim boundaries
  const vt = view.state.schema.marks.verbatim;
  let verbatimLeft = false;
  let verbatimRight = false;
  if (vt) {
    if (off > 0) {
      const { node } =
        $from.parent.childBefore(off);
      if (node && vt.isInSet(node.marks)) {
        verbatimLeft = true;
      }
    }
    const after = $from.parent.childAfter(off);
    if (
      after.node &&
      vt.isInSet(after.node.marks)
    ) {
      verbatimRight = true;
    }
  }

  // Only show indicators when the cursor is
  // adjacent to at least one structural char
  // or a verbatim boundary
  const hasStructural =
    left.some((c) => !c.glyph) ||
    right.some((c) => !c.glyph) ||
    verbatimLeft ||
    verbatimRight;
  if (!hasStructural) return;

  let coords;
  try {
    coords = view.coordsAtPos(from);
  } catch {
    return;
  }

  const origin =
    overlay.getBoundingClientRect();
  const x = coords.left - origin.left;
  const y = coords.bottom - origin.top;

  const badgeTop = (y + DROP_PX) + "px";

  if (left.length > 0 || verbatimLeft) {
    const el = document.createElement("span");
    el.className = "structural-indicator";
    if (verbatimLeft) {
      const sp =
        document.createElement("span");
      sp.className =
        "sp-text verbatim-badge";
      sp.textContent =
        fromVerbatim("sitelen+pona ala");
      el.appendChild(sp);
    }
    for (const cap of left) {
      const el2 = cap.glyph
        ? document.createElement("span")
        : document.createElement("kbd");
      if (cap.glyph) {
        el2.className = "sp-text";
      }
      el2.textContent = cap.label;
      el.appendChild(el2);
    }
    el.style.left = (x - GAP_PX) + "px";
    el.style.top = badgeTop;
    el.style.transform =
      "translateX(-100%)";
    overlay.appendChild(el);
  }

  // Dashed stem
  const stem = document.createElement("span");
  stem.className =
    "structural-indicator-stem";
  stem.style.left = x + "px";
  stem.style.top = badgeTop;
  overlay.appendChild(stem);

  if (right.length > 0 || verbatimRight) {
    const el = document.createElement("span");
    el.className = "structural-indicator";
    for (const cap of right) {
      const el2 = cap.glyph
        ? document.createElement("span")
        : document.createElement("kbd");
      if (cap.glyph) {
        el2.className = "sp-text";
      }
      el2.textContent = cap.label;
      el.appendChild(el2);
    }
    if (verbatimRight) {
      const sp =
        document.createElement("span");
      sp.className =
        "sp-text verbatim-badge";
      sp.textContent =
        fromVerbatim("sitelen+pona ala");
      el.appendChild(sp);
    }
    el.style.left = (x + GAP_PX) + "px";
    el.style.top = badgeTop;
    overlay.appendChild(el);
  }
}

export const structuralIndicatorsPluginKey =
  new PluginKey("structuralIndicators");

export const StructuralIndicators =
  Extension.create({
    name: "structuralIndicators",

    addOptions() {
      return { alwaysShow: false };
    },

    addProseMirrorPlugins() {
      const { alwaysShow } = this.options;

      return [
        new Plugin({
          key: structuralIndicatorsPluginKey,

          view(editorView) {
            const overlay =
              document.createElement("div");
            overlay.className =
              "structural-indicator-overlay";
            editorView.dom.parentElement
              ?.appendChild(overlay);

            const onBlur = () => {
              if (!alwaysShow) {
                overlay.innerHTML = "";
              }
            };
            const onFocus = () => {
              renderOverlay(
                editorView, overlay,
                alwaysShow,
              );
            };
            editorView.dom.addEventListener(
              "blur", onBlur
            );
            editorView.dom.addEventListener(
              "focus", onFocus
            );

            renderOverlay(
              editorView, overlay, alwaysShow,
            );

            return {
              update(view) {
                renderOverlay(
                  view, overlay, alwaysShow,
                );
              },
              destroy() {
                editorView.dom
                  .removeEventListener(
                    "blur", onBlur
                  );
                editorView.dom
                  .removeEventListener(
                    "focus", onFocus
                  );
                overlay.remove();
              },
            };
          },

          props: {
            handleKeyDown(
              view: EditorView,
              event: KeyboardEvent
            ) {
              if (
                event.key !== "Backspace" &&
                event.key !== "Delete"
              ) {
                return false;
              }

              const { from, to } =
                view.state.selection;
              if (from !== to) return false;

              const $pos =
                view.state.doc.resolve(from);
              if (!$pos.parent.isTextblock) {
                return false;
              }

              const blockStart = $pos.start();
              const blockEnd = $pos.end();
              const text =
                $pos.parent.textContent;

              if (event.key === "Backspace") {
                const off = from - blockStart;
                if (off < 1) return false;

                // Surrogate pair (supplementary)
                if (off >= 2) {
                  const hi =
                    text.charCodeAt(off - 2);
                  const lo =
                    text.charCodeAt(off - 1);
                  if (
                    hi >= 0xd800 &&
                    hi <= 0xdbff &&
                    lo >= 0xdc00 &&
                    lo <= 0xdfff
                  ) {
                    const cp =
                      (hi - 0xd800) * 0x400 +
                      (lo - 0xdc00) + 0x10000;
                    if (isControlChar(cp)) {
                      view.dispatch(
                        view.state.tr.delete(
                          from - 2, from
                        )
                      );
                      return true;
                    }
                  }
                }

                // BMP control char (e.g. ZWJ)
                const bmpCp =
                  text.charCodeAt(off - 1);
                if (isControlChar(bmpCp)) {
                  view.dispatch(
                    view.state.tr.delete(
                      from - 1, from
                    )
                  );
                  return true;
                }

                // Arrow: cycle down or delete.
                // Multi-char directions (e.g.
                // ↖ = "^<") cycle to the first
                // direction char (↑ = "^").
                // Single-char directions are
                // deleted entirely.
                if (isNiArrowCp(bmpCp)) {
                  const dir =
                    niDirectionByArrowCp(bmpCp);
                  if (
                    dir &&
                    dir.verbatim.length > 1
                  ) {
                    const shorter =
                      niDirectionByVerbatim(
                        dir.verbatim[0]
                      );
                    if (shorter) {
                      view.dispatch(
                        view.state.tr.insertText(
                          shorter.arrow,
                          from - 1,
                          from
                        )
                      );
                      return true;
                    }
                  }
                  view.dispatch(
                    view.state.tr.delete(
                      from - 1, from
                    )
                  );
                  return true;
                }
                return false;
              }

              // Delete
              const off = from - blockStart;
              const maxOff =
                blockEnd - blockStart;
              if (off >= maxOff) return false;

              // Surrogate pair (supplementary)
              if (off + 2 <= maxOff) {
                const hi = text.charCodeAt(off);
                const lo =
                  text.charCodeAt(off + 1);
                if (
                  hi >= 0xd800 &&
                  hi <= 0xdbff &&
                  lo >= 0xdc00 &&
                  lo <= 0xdfff
                ) {
                  const cp =
                    (hi - 0xd800) * 0x400 +
                    (lo - 0xdc00) + 0x10000;
                  if (isControlChar(cp)) {
                    view.dispatch(
                      view.state.tr.delete(
                        from, from + 2
                      )
                    );
                    return true;
                  }
                }
              }

              // BMP control char (e.g. ZWJ)
              const bmpCp =
                text.charCodeAt(off);
              if (isControlChar(bmpCp)) {
                view.dispatch(
                  view.state.tr.delete(
                    from, from + 1
                  )
                );
                return true;
              }

              // Arrow: cycle down or delete.
              // Multi-char directions (e.g.
              // ↙ = "<v") cycle to the last
              // direction char (↓ = "v").
              // Single-char directions are
              // deleted entirely.
              if (isNiArrowCp(bmpCp)) {
                const dir =
                  niDirectionByArrowCp(bmpCp);
                if (
                  dir &&
                  dir.verbatim.length > 1
                ) {
                  const shorter =
                    niDirectionByVerbatim(
                      dir.verbatim[
                        dir.verbatim.length - 1
                      ]
                    );
                  if (shorter) {
                    view.dispatch(
                      view.state.tr.insertText(
                        shorter.arrow,
                        from,
                        from + 1
                      )
                    );
                    return true;
                  }
                }
                view.dispatch(
                  view.state.tr.delete(
                    from, from + 1
                  )
                );
                return true;
              }
              return false;
            },

          },
        }),
      ];
    },
  });
