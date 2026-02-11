import { Node, mergeAttributes } from "@tiptap/core";

export interface SitelenPonaNodeOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sitelenPona: {
      insertSitelenPona: (
        word: string,
        variation?: number | null
      ) => ReturnType;
    };
  }
}

export const SitelenPonaNode = Node.create<
  SitelenPonaNodeOptions
>({
  name: "sitelenPona",
  group: "inline",
  inline: true,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      word: {
        default: null,
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute(
            "data-word"
          ),
        renderHTML: (attrs) => ({
          "data-word": attrs.word as string,
        }),
      },
      variation: {
        default: null,
        parseHTML: (el) => {
          const val = (el as HTMLElement).getAttribute(
            "data-variation"
          );
          return val ? Number(val) : null;
        },
        renderHTML: (attrs) => {
          if (attrs.variation == null) return {};
          return {
            "data-variation": String(
              attrs.variation
            ),
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-sitelen-pona]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        { "data-sitelen-pona": "" },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
    ];
  },

  addCommands() {
    return {
      insertSitelenPona:
        (word, variation = null) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { word, variation },
          });
        },
    };
  },
});
