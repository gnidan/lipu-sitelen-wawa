/**
 * Block -> Latin projection. Pure concatenation
 * of gap.latin and per-anchor Latin text — no
 * synthesized spacing here; creation-time defaults
 * own that job instead.
 * A cartouche span WITH A NAME renders as one
 * opaque name atom (latinSpelling override first,
 * else derived from each word anchor's nameScheme);
 * a NAMELESS one does not atomize at all and its
 * covered content projects the ordinary way (the
 * ATOMIZATION RULE — see nameAtoms). Formatting
 * spans surface as anchor-granular marks;
 * long/rev-long spans have no Latin form.
 */

import { splitMorae } from "../convert/to-latin";
import { isStructural } from "./types";
import type {
  Anchor,
  Block,
  FormattingKind,
  LatinInline,
  SourceEntry,
  Span,
  SpanAttrs,
} from "./types";

export function wordLatin(a: Anchor): string {
  const w = a.word ?? "";
  if (a.case === "capital" && w.length > 0) {
    return w[0].toUpperCase() + w.slice(1);
  }
  return w;
}

function nameFragment(a: Anchor): string {
  const s = a.nameScheme;
  const w = a.word ?? "";
  if (!s) return w[0] ?? "";
  if (s.style === "word") return w;
  if (s.style === "morae") {
    return splitMorae(w)
      .slice(0, s.count)
      .join("");
  }
  return w.slice(0, s.count);
}

export function nameText(
  anchors: Anchor[],
  attrs?: SpanAttrs
): string {
  if (attrs?.latinSpelling !== undefined) {
    return attrs.latinSpelling;
  }
  const frags: string[] = [];
  for (const a of anchors) {
    if (a.kind === "word") {
      frags.push(nameFragment(a));
    }
  }
  const joined = frags.join("");
  if (joined.length === 0) return "";
  return joined[0].toUpperCase() + joined.slice(1);
}

export interface NameAtom {
  span: Span;
  text: string;
}

/** The cartouche spans the Latin projection turns
 *  into opaque name atoms, left to right, each with
 *  the name it renders. Exported because the
 *  ATOMIZATION RULE is not "every cartouche": the
 *  editor's separation defaults and the generator's
 *  normal form both key off which anchors the
 *  projection actually swallows.
 *
 *  A cartouche atomizes only when it projects a
 *  NON-EMPTY name. A zero-width
 *  atom is not a projection of anything: it shows
 *  the reader nothing, and — the lethal half — it
 *  puts an ANCHOR in the parse at a position where
 *  the projection emitted no CHARACTERS. The merge
 *  aligns anchors by the text they render on the
 *  edited side, so an anchor whose text is nowhere
 *  in the projection lands wherever its key first
 *  collides; with a same-rendering anchor earlier in
 *  the block, the LCS pairs the WRONG one, the real
 *  one is stranded in a region its own text never
 *  reaches, and the first Latin no-op deletes it —
 *  taking the cartouche span and its SP marker
 *  chars with it. Projecting the covered content the
 *  ordinary way keeps characters and anchors in
 *  correspondence, so the ordinary protections (LCS
 *  on rendered text, then re-absorption) apply.
 *
 *  Nesting: candidates starting at an anchor are
 *  tried outermost first, so a named cartouche
 *  nested inside a nameless one still atomizes.
 *  Equal ranges keep array order (the outer entry
 *  first — merge.ts's structuralTriples TIE RULE).
 */
export function nameAtoms(
  block: Block
): NameAtom[] {
  const carts = block.spans.filter(
    (s) => s.kind === "cartouche"
  );
  const out: NameAtom[] = [];
  let i = 0;
  while (i < block.anchors.length) {
    const starting = carts
      .filter((s) => s.from === i)
      .sort((a, b) => b.to - a.to);
    let hit: NameAtom | undefined;
    for (const s of starting) {
      const text = nameText(
        block.anchors.slice(s.from, s.to + 1),
        s.attrs
      );
      if (text !== "") {
        hit = { span: s, text };
        break;
      }
    }
    if (hit) {
      out.push(hit);
      i = hit.span.to + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/** The anchors the Latin projection SWALLOWS into a
 *  name atom — i.e. the ones with no Latin letter run
 *  of their own. The editor's separation default and
 *  the generator's normal form are both stated over this
 *  set (a nameless cartouche's anchors are NOT in
 *  it, and their letter runs fuse with a neighbour's
 *  exactly like any other anchor's). */
export function atomizedAnchors(
  block: Block
): Set<number> {
  const out = new Set<number>();
  for (const { span } of nameAtoms(block)) {
    for (let k = span.from; k <= span.to; k++) {
      out.add(k);
    }
  }
  return out;
}

export function renderLatin(block: Block): {
  inlines: LatinInline[];
  text: string;
  map: SourceEntry[];
  marks: Array<{
    kind: FormattingKind;
    from: number;
    to: number;
  }>;
} {
  const inlines: LatinInline[] = [];
  const map: SourceEntry[] = [];
  let pos = 0;
  const anchorRange: Array<{
    from: number;
    to: number;
  }> = [];

  function pushText(text: string): void {
    if (text.length === 0) return;
    const last = inlines[inlines.length - 1];
    if (last && last.type === "text") {
      last.text += text;
    } else {
      inlines.push({ type: "text", text });
    }
    pos += text.length;
  }

  function emitGap(index: number): void {
    const gap = block.gaps[index];
    const from = pos;
    pushText(gap.latin);
    if (gap.latin !== "" || gap.sp !== "") {
      map.push({
        ref: { seg: "gap", index },
        from,
        to: pos,
      });
    }
  }

  const atoms = new Map<number, NameAtom>();
  for (const a of nameAtoms(block)) {
    atoms.set(a.span.from, a);
  }

  let i = 0;
  while (i < block.anchors.length) {
    emitGap(i);
    const hit = atoms.get(i);
    if (hit) {
      const atom = hit.span;
      const covered = block.anchors.slice(
        atom.from,
        atom.to + 1
      );
      const interiorLatin = block.gaps
        .slice(atom.from + 1, atom.to + 1)
        .map((g) => g.latin);
      const from = pos;
      inlines.push({
        type: "name",
        anchors: covered.map((a) => ({ ...a })),
        interiorLatin,
        text: hit.text,
      });
      pos += 1; // atoms count as one position
      for (
        let k = atom.from; k <= atom.to; k++
      ) {
        if (k > atom.from) {
          map.push({
            ref: { seg: "gap", index: k },
            from,
            to: pos,
          });
        }
        map.push({
          ref: { seg: "anchor", index: k },
          from,
          to: pos,
        });
        anchorRange[k] = { from, to: pos };
      }
      i = atom.to + 1;
      continue;
    }
    const a = block.anchors[i];
    const from = pos;
    pushText(
      a.kind === "word"
        ? wordLatin(a)
        : a.text ?? ""
    );
    map.push({
      ref: { seg: "anchor", index: i },
      from,
      to: pos,
    });
    anchorRange[i] = { from, to: pos };
    i += 1;
  }
  emitGap(block.anchors.length);

  const marks = block.spans
    .filter(
      (s) =>
        !isStructural(s.kind) && s.side !== "sp"
    )
    .map((s) => ({
      kind: s.kind as FormattingKind,
      from: anchorRange[s.from]?.from ?? 0,
      to: anchorRange[s.to]?.to ?? 0,
    }));

  const text = inlines
    .map((n) => n.text)
    .join("");
  return { inlines, text, map, marks };
}
