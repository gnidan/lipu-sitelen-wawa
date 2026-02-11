import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { isWord } from "../../data";

export const autoConvertPluginKey = new PluginKey(
  "autoConvert"
);

/**
 * Extract the word immediately before a trailing space
 * in a text string. Returns the word and its start
 * offset within the string, or null if no word found.
 */
export function extractWordBeforeSpace(
  text: string
): { word: string; start: number } | null {
  if (!text.endsWith(" ")) return null;

  const withoutSpace = text.slice(0, -1);
  const match = withoutSpace.match(/([a-zA-Z]+)$/);
  if (!match) return null;

  const word = match[1].toLowerCase();
  const start = withoutSpace.length - match[1].length;
  return { word, start };
}

export const AutoConvert = Extension.create({
  name: "autoConvert",

  addProseMirrorPlugins() {
    const nodeType =
      this.editor.schema.nodes.sitelenPona;

    return [
      new Plugin({
        key: autoConvertPluginKey,

        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) {
            return null;
          }

          const { selection } = newState;
          const { $from } = selection;

          if (!$from.parent.isTextblock) return null;

          const textNode = $from.nodeBefore;
          if (!textNode?.isText || !textNode.text) {
            return null;
          }

          const result = extractWordBeforeSpace(
            textNode.text
          );
          if (!result) return null;

          const { word, start } = result;
          if (!isWord(word)) return null;

          const textStart =
            $from.pos - textNode.text.length;
          const wordFrom = textStart + start;
          const wordTo = textStart + start + word.length;

          const tr = newState.tr;
          tr.delete(wordFrom, wordTo);
          tr.insert(
            wordFrom,
            nodeType.create({ word, variation: null })
          );

          return tr;
        },
      }),
    ];
  },
});
