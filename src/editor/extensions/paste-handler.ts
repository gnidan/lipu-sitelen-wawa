import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Slice, Fragment } from "@tiptap/pm/model";
import type {
  Node as PmNode,
  Schema,
} from "@tiptap/pm/model";
import { isUcsurChar } from "../../data";
import {
  toSitelenPona,
} from "../../convert/to-sitelen-pona";

/**
 * Check if a string contains any UCSUR characters.
 */
function containsUcsur(text: string): boolean {
  for (const ch of text) {
    if (isUcsurChar(ch)) return true;
  }
  return false;
}

/**
 * Markdown-style plain-text paste: blank lines
 * separate paragraphs, single newlines become soft
 * breaks. Latin->UCSUR conversion runs per LINE —
 * never on text containing a newline, because the
 * converter deletes whitespace runs (newlines
 * included) between two tokens that both convert.
 * Only newline runs at the very start/end are
 * stripped; spaces are deliberate content and are
 * never trimmed. Returns null when there is
 * nothing to paste.
 */
export function buildPasteFragment(
  schema: Schema,
  raw: string
): Fragment | null {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
  if (text.length === 0) return null;
  const chunks = text.split(/\n{2,}/);
  const paragraphs = chunks.map((chunk) => {
    const lines = chunk
      .split("\n")
      .map((line) =>
        containsUcsur(line)
          ? line
          : toSitelenPona(line)
      );
    const inlines: PmNode[] = [];
    lines.forEach((line, i) => {
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
 * ProseMirror plugin owning every paste that
 * offers only text/plain. Pastes carrying text/html
 * (notably copy/paste within the editor, where
 * ProseMirror writes structured HTML) keep the
 * default rich-slice path, which preserves
 * paragraph/break structure explicitly. The
 * fragment is inserted as an OPEN slice so a paste
 * with no blank line never introduces a paragraph
 * boundary and single-line pastes merge inline.
 */

// Identifies every transaction this plugin
// dispatches (via the `pasteHandlerKey` meta below)
// so a later consumer -- the shared-undo history's
// group closing -- can recognize a
// paste without re-deriving it from doc shape.
export const pasteHandlerKey = new PluginKey(
  "pasteHandler"
);

export const PasteHandler = Extension.create({
  name: "pasteHandler",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pasteHandlerKey,
        props: {
          handlePaste(view, event) {
            const html =
              event.clipboardData?.getData(
                "text/html"
              );
            if (html) return false;
            const text =
              event.clipboardData?.getData(
                "text/plain"
              );
            if (!text) return false;
            const fragment = buildPasteFragment(
              view.state.schema,
              text
            );
            // Non-empty clipboard text that strips
            // to nothing (newlines only) is still
            // ours to own: consume it as a no-op so
            // ProseMirror's default plain-text paste
            // never runs and splits the host
            // paragraph.
            if (fragment === null) return true;
            const slice = Slice.maxOpen(fragment);
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
