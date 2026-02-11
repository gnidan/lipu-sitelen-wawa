import { Extension } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { hasVariations } from "../../data";

function isSitelenPonaSelected(
  editor: { state: { selection: unknown } }
): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection)) {
    return false;
  }
  return selection.node.type.name === "sitelenPona";
}

function makeVariantHandler(variation: number | null) {
  return ({
    editor,
  }: {
    editor: { state: { selection: unknown }; chain: () => {
      updateAttributes: (
        name: string,
        attrs: Record<string, unknown>
      ) => { run: () => boolean };
    } };
  }) => {
    const { selection } = editor.state;
    if (!(selection instanceof NodeSelection)) {
      return false;
    }
    if (selection.node.type.name !== "sitelenPona") {
      return false;
    }
    const word = selection.node.attrs.word as string;
    if (
      variation !== null &&
      !hasVariations(word)
    ) {
      return false;
    }
    editor
      .chain()
      .updateAttributes("sitelenPona", {
        variation,
      })
      .run();
    return true;
  };
}

export const VariantKeymap = Extension.create({
  name: "variantKeymap",

  addKeyboardShortcuts() {
    return {
      "1": makeVariantHandler(1),
      "2": makeVariantHandler(2),
      "3": makeVariantHandler(3),
      "4": makeVariantHandler(4),
      "5": makeVariantHandler(5),
      "6": makeVariantHandler(6),
      "7": makeVariantHandler(7),
      "8": makeVariantHandler(8),
      "0": makeVariantHandler(null),
    };
  },
});
