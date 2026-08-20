/**
 * Latin-pane paste. Plain-text
 * pastes route through here: UCSUR is stripped
 * (it is not Latin content; smart transliteration
 * is future backlog), blank lines split
 * paragraphs, single newlines become hardBreaks;
 * the transaction carries the paste meta so
 * the shared history closes its group. The
 * resulting genuine transaction flows through the
 * normal edit loop (multi-paragraph pastes take
 * the structural path; count-changing joins get
 * the JOIN SEAM RULE; equal-count
 * paste-over-selection is the canonical
 * edge-split reshape — and the fusion guard still
 * covers its dead seams via the boundary-death
 * trigger).
 *
 * WHY STRIP RATHER THAN CONVERT: the SP-side
 * PasteHandler runs pasted Latin text through
 * toSitelenPona per line. Doing the mirror
 * conversion here — Latin pane, UCSUR->Latin — is
 * explicitly deferred (DO-NOT-BUILD: smart
 * cross-pane paste transliteration). Left
 * unstripped, a pasted UCSUR codepoint would parse
 * as an unrecognized Latin character and land as
 * inert gap.latin bytes: invisible in the pane,
 * never round-tripping to a glyph. Stripping is
 * the conservative input rule until smart paste
 * transliteration exists.
 *
 * THE STRIP SET (widened beyond the PUA): every
 * codepoint that is SP-content-not-Latin-content,
 * not merely "in the UCSUR PUA block". That is
 * `isUcsurChar` (word/control glyphs in the
 * 0xF1900-0xF19FF PUA range) UNION `isControlChar`
 * (the SP marker-char domain — chars.ts's `ch()`
 * table: cartouche/long/rev-long delimiters, the
 * stack/scale/ZWJ joiners, middle-dot/colon/tally
 * naming marks). Every one of those is in the PUA
 * EXCEPT two: ZWJ (U+200D) and IDEOGRAPHIC_SPACE
 * (U+3000) — real Unicode codepoints control-chars.ts
 * borrows for the ni-directional and
 * separation-default encodings (see data/ni-directions.ts). Directional
 * ARROW characters (←, ↗, ...) are deliberately NOT
 * in this set: they are ordinary Unicode symbols
 * that only mean "ni direction" NEXT TO a ni glyph
 * — standing alone they are plausible Latin content,
 * not exclusively SP's. A legacy `ni` + ZWJ + arrow
 * paste therefore strips the ni glyph and the ZWJ,
 * leaving the bare arrow character as ordinary
 * (visible) Latin text — never a silently-dropped or
 * inert byte, which is the failure the strip rule
 * exists to prevent.
 */

import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import {
  DOMParser as PmDOMParser,
  Slice,
  Fragment,
} from "@tiptap/pm/model";
import type {
  Node as PmNode,
  Schema,
} from "@tiptap/pm/model";
import { isControlChar, isUcsurChar } from "../../data";
import { pasteHandlerKey } from
  "../extensions/paste-handler";

/** SP-content-not-Latin-content (see the module
 *  header's THE STRIP SET note). */
function isSpOnlyChar(ch: string): boolean {
  if (isUcsurChar(ch)) return true;
  const cp = ch.codePointAt(0);
  return cp !== undefined && isControlChar(cp);
}

/** Strips every SP-only codepoint out of a raw
 *  string, character by character (iterating by
 *  codepoint, not UTF-16 unit — every UCSUR glyph is
 *  a surrogate pair). Shared by both the plain-text
 *  path and the HTML-string path below. */
function stripSpOnlyChars(raw: string): string {
  return [...raw]
    .filter((ch) => !isSpOnlyChar(ch))
    .join("");
}

/** POST-parse strip: walks a parsed
 *  Fragment and strips SP-only codepoints out of
 *  every TEXT node, recursively, dropping a text
 *  node entirely if stripping empties it. This is
 *  what catches an HTML ENTITY reference (e.g.
 *  `&#xf196c;`) — the pre-parse string strip (above)
 *  cannot see it, because it is plain ASCII in the
 *  raw string and only becomes a real UCSUR codepoint
 *  once the DOM parser decodes it. Marks and non-text
 *  node structure are preserved untouched. */
function sanitizeFragment(
  schema: Schema,
  frag: Fragment
): Fragment {
  const out: PmNode[] = [];
  frag.forEach((node) => {
    if (node.isText) {
      const text = node.text ?? "";
      const stripped = [...text]
        .filter((ch) => !isSpOnlyChar(ch))
        .join("");
      if (stripped.length > 0) {
        out.push(
          stripped === text
            ? node
            : schema.text(stripped, node.marks)
        );
      }
      return;
    }
    out.push(
      node.copy(sanitizeFragment(schema, node.content))
    );
  });
  return Fragment.from(out);
}

/**
 * Builds the paste fragment for the Latin pane, or
 * null when the pasted text carries nothing to
 * insert (UCSUR-only input, or newline-only
 * input). SP-only codepoints are stripped before
 * anything else — they are not Latin content.
 * Blank lines separate paragraphs; single newlines
 * become hardBreaks. Leading/trailing newline runs
 * are trimmed; interior spaces are never touched
 * (SP spacing convention: they are deliberate
 * content on the Latin side too).
 */
export function buildLatinPasteFragment(
  schema: Schema,
  raw: string
): Fragment | null {
  const stripped = stripSpOnlyChars(raw);
  const text = stripped
    .replace(/\r\n?/g, "\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
  if (text.length === 0) return null;
  const chunks = text.split(/\n{2,}/);
  const paragraphs = chunks.map((chunk) => {
    const inlines: PmNode[] = [];
    chunk.split("\n").forEach((line, i) => {
      if (i > 0) {
        inlines.push(
          schema.nodes.hardBreak.create()
        );
      }
      if (line.length > 0) {
        inlines.push(schema.text(line));
      }
    });
    return schema.nodes.paragraph.create(
      null,
      Fragment.from(inlines)
    );
  });
  return Fragment.from(paragraphs);
}

/**
 * Builds the paste slice for an HTML-only clipboard
 * (no text/plain offered). TWO strip passes, each
 * covering what the other cannot:
 *
 * PRE-parse: strips SP-only codepoints out of the RAW
 * HTML STRING before any DOM/schema parsing runs.
 * UCSUR/control codepoints never occur in valid tag
 * or attribute syntax (Basic Latin only), so this can
 * only ever remove characters from text content or
 * attribute values — it cannot corrupt markup. This
 * is what protects ATTRIBUTE VALUES cheaply, and it
 * means the schema's own parse rules (including the
 * NAME-ATOM parseHTML guard's chip degrade,
 * name-atom.ts) run on already-clean TEXT input in
 * the common case.
 *
 * POST-parse (sanitizeFragment): strips the parsed
 * slice's text nodes. This is what catches an HTML
 * ENTITY REFERENCE (`&#xf196c;`, `&amp;#x200d;`,
 * ...): such a reference is plain ASCII in the raw
 * string — invisible to the pre-parse pass — and only
 * becomes a real SP-only codepoint once the DOM
 * parser decodes it, which happens between the two
 * passes. Belt and braces: the pre-parse pass alone
 * missed this; the post-parse pass alone would still
 * let a UCSUR byte sit in an attribute VALUE that
 * happens to feed a rendered node (none currently do,
 * but nothing guarantees that stays true). Together
 * they cover the raw string and the decoded tree.
 *
 * Returns null when the cleaned HTML parses to
 * nothing (mirrors buildLatinPasteFragment's no-op
 * convention).
 */
export function buildLatinPasteSliceFromHtml(
  schema: Schema,
  html: string
): Slice | null {
  const cleaned = stripSpOnlyChars(html);
  const container = new window.DOMParser()
    .parseFromString(
      `<body>${cleaned}</body>`,
      "text/html"
    ).body;
  const parsed = PmDOMParser.fromSchema(
    schema
  ).parseSlice(container, {
    preserveWhitespace: true,
  });
  const content = sanitizeFragment(
    schema,
    parsed.content
  );
  return content.size === 0
    ? null
    : new Slice(content, parsed.openStart, parsed.openEnd);
}

/**
 * ProseMirror plugin owning every Latin-pane paste.
 * text/plain (when offered) takes the
 * buildLatinPasteFragment path below; an HTML-only
 * clipboard (no text/plain — some non-browser
 * sources, and synthetic test clipboards) takes
 * buildLatinPasteSliceFromHtml instead of deferring,
 * so the strip rule still applies to it. The
 * fragment
 * is inserted as an OPEN slice, matching the SP-side
 * PasteHandler's convention, so a paste with no
 * blank line never introduces a paragraph boundary
 * and single-line pastes merge inline. The
 * resulting transaction is a GENUINE Latin
 * transaction (the edit loop classifies,
 * parses, and merges it exactly like typing) — this
 * plugin's only job is producing the fragment and
 * tagging the transaction with the paste meta so
 * the shared history (lipu-history.ts) closes its
 * group.
 */
export function latinPaste(): ReturnType<
  typeof Extension.create
> {
  return Extension.create({
    name: "latinPaste",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handlePaste(view, event) {
              const text =
                event.clipboardData?.getData(
                  "text/plain"
                );
              if (text) {
                const fragment =
                  buildLatinPasteFragment(
                    view.state.schema,
                    text
                  );
                // Non-empty clipboard text that
                // strips to nothing (SP-only input,
                // or newline-only) is still ours to
                // own: consume it as a no-op so
                // ProseMirror's default plain-text
                // paste never runs and splits the
                // host paragraph.
                if (fragment === null) return true;
                const tr =
                  view.state.tr.replaceSelection(
                    Slice.maxOpen(fragment)
                  );
                tr.setMeta(pasteHandlerKey, {
                  paste: true,
                });
                view.dispatch(tr);
                return true;
              }
              // HTML-only clipboard: still ours to
              // own, so the strip still applies — a
              // return false here would defer to PM's
              // default clipboard path, which parses
              // (and, via the NAME-ATOM guard,
              // degrades chips) but never strips.
              const html =
                event.clipboardData?.getData(
                  "text/html"
                );
              if (!html) return false;
              const slice =
                buildLatinPasteSliceFromHtml(
                  view.state.schema,
                  html
                );
              if (slice === null) return true;
              const tr =
                view.state.tr.replaceSelection(
                  slice
                );
              tr.setMeta(pasteHandlerKey, {
                paste: true,
              });
              view.dispatch(tr);
              return true;
            },
          },
        }),
      ];
    },
  });
}
