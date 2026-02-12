import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Slice, Fragment } from "@tiptap/pm/model";
import { isUcsurChar } from "../../data";
import { toSitelenPona } from "../../convert/to-sitelen-pona";

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
 * ProseMirror plugin that intercepts paste events
 * and converts Latin toki pona text to UCSUR.
 *
 * If the pasted text already contains UCSUR chars,
 * it's left for ProseMirror's default handling.
 * If conversion produces no changes, also defers.
 */
export const PasteHandler = Extension.create({
  name: "pasteHandler",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const text =
              event.clipboardData?.getData(
                "text/plain"
              );
            if (!text) return false;

            // Already UCSUR — let PM handle it
            if (containsUcsur(text)) return false;

            const converted = toSitelenPona(text);

            // No conversion happened — let PM
            // handle it
            if (converted === text) return false;

            // Build paragraph nodes from lines
            const schema = view.state.schema;
            const lines = converted.split("\n");
            const nodes = lines.map((line) => {
              if (line.length === 0) {
                return schema.nodes.paragraph
                  .create();
              }
              return schema.nodes.paragraph.create(
                null,
                schema.text(line)
              );
            });

            const fragment =
              Fragment.from(nodes);
            const slice = new Slice(
              fragment,
              0,
              0
            );

            const tr =
              view.state.tr.replaceSelection(
                slice
              );
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
