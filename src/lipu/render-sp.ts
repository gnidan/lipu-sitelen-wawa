/**
 * Block -> SP projection. Pure concatenation of
 * gap.sp and per-anchor SP text, with structural
 * span marker chars emitted AT THEIR RECORDED
 * OFFSETS inside the exterior gap — absent offsets
 * mean edge-adjacent, i.e. the marker sits between
 * the gap and the first/last covered anchor, which
 * is where every offset-free Block still renders
 * it. gap.sp "\n" is the ENCODING of a hardBreak:
 * render emits break inlines. Byte-identical to the
 * app's existing renderSp for equivalent content;
 * renderSp never synthesizes anything.
 *
 * Emission order within one gap comes from
 * normalize's gapMarkers (the one place marker
 * positions are resolved): ascending offset, ends
 * before starts at a shared offset, ends
 * innermost-first and starts outermost-first —
 * proper nesting in, proper nesting out.
 */

import {
  wordToCodepoint,
  codepointToChar,
  applyVariation,
  niDirectionByIndex,
  niDirStringEffective,
} from "../data";
import {
  schemeChars,
  structuralChar,
} from "./chars";
import { gapMarkers } from "./normalize";
import type {
  Anchor,
  Block,
  SourceEntry,
  SpInline,
} from "./types";

function wordText(a: Anchor): string {
  const word = a.word ?? "";
  if (word === "ni" && a.niDirection) {
    const dir = niDirectionByIndex(a.niDirection);
    if (dir) return niDirStringEffective(dir);
  }
  const cp = wordToCodepoint[word];
  // Unknown word (registry drift): render the
  // Latin spelling so nothing is silently lost,
  // matching the app's existing renderer.
  if (cp === undefined) return word;
  let text = codepointToChar(cp);
  if (a.variation) {
    text = applyVariation(text, a.variation);
  }
  return text;
}

/** The exact SP chars one anchor renders as. The
 *  merge uses this for re-absorption search. */
export function anchorSpText(a: Anchor): string {
  if (a.kind === "verbatim") return a.text ?? "";
  return wordText(a) + schemeChars(a.nameScheme);
}

export function renderSp(block: Block): {
  inlines: SpInline[];
  text: string;
  map: SourceEntry[];
} {
  const inlines: SpInline[] = [];
  const map: SourceEntry[] = [];
  let pos = 0;

  function pushText(
    text: string,
    verbatim: boolean
  ): void {
    if (text.length === 0) return;
    const last = inlines[inlines.length - 1];
    if (
      last &&
      last.type === "text" &&
      last.verbatim === verbatim
    ) {
      last.text += text;
    } else {
      inlines.push({ type: "text", text, verbatim });
    }
    pos += text.length;
  }

  function pushGapChars(sp: string): void {
    let rest = sp;
    for (;;) {
      const nl = rest.indexOf("\n");
      if (nl === -1) {
        pushText(rest, false);
        return;
      }
      pushText(rest.slice(0, nl), false);
      inlines.push({ type: "break" });
      pos += 1;
      rest = rest.slice(nl + 1);
    }
  }

  /** One gap, with its structural markers spliced
   *  in at their offsets. The gap's map entry is
   *  emitted per contiguous PIECE (a gap with an
   *  interior marker contributes several entries
   *  with the same ref — the consumers key on the
   *  ref's ordinal, never on entry uniqueness).
   *  Zero-width entries disappear except for
   *  side-absent content, which only an empty gap.sp
   *  can carry; it is emitted after this gap's end
   *  markers, before its start markers. */
  function emitGap(index: number): void {
    const gap = block.gaps[index];
    const marks = gapMarkers(block, index);
    let cursor = 0;
    let emitted = false;
    const flush = (
      upto: number,
      beforeStart: boolean
    ): void => {
      const piece = gap.sp.slice(cursor, upto);
      const from = pos;
      if (piece !== "") {
        pushGapChars(piece);
      } else if (
        emitted ||
        gap.sp !== "" ||
        gap.latin === "" ||
        !beforeStart
      ) {
        cursor = upto;
        return;
      }
      map.push({
        ref: { seg: "gap", index },
        from,
        to: pos,
      });
      emitted = true;
      cursor = upto;
    };
    for (const m of marks) {
      flush(m.offset, m.role === "start");
      const from = pos;
      pushText(
        structuralChar(m.kind, m.role),
        false
      );
      map.push({
        ref: {
          seg: "marker",
          span: m.span,
          end: m.role,
        },
        from,
        to: pos,
      });
    }
    flush(gap.sp.length, true);
  }

  block.anchors.forEach((anchor, i) => {
    emitGap(i);
    const aFrom = pos;
    pushText(
      anchorSpText(anchor),
      anchor.kind === "verbatim" &&
        anchor.marked === true
    );
    map.push({
      ref: { seg: "anchor", index: i },
      from: aFrom,
      to: pos,
    });
  });
  emitGap(block.anchors.length);

  const text = inlines
    .map((n) =>
      n.type === "text" ? n.text : "\n"
    )
    .join("");
  return { inlines, text, map };
}
