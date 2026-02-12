import { Mark } from "@tiptap/core";

export const Verbatim = Mark.create({
  name: "verbatim",

  inclusive: false,

  parseHTML() {
    return [{ tag: "span.verbatim-text" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      {
        ...HTMLAttributes,
        class: "verbatim-text",
      },
      0,
    ];
  },
});
