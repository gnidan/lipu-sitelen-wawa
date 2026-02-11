import React from "react";
import {
  useEditor,
  EditorContent,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  SitelenPonaNode,
} from "../extensions/sitelen-pona-node";
import { AutoConvert } from "../extensions/auto-convert";
import { VariantKeymap } from "../extensions/variant-keymap";
import { SitelenPonaGlyph } from "./SitelenPonaGlyph";
import { VariantPopup } from "./VariantPopup";
import { Toolbar } from "./Toolbar";
import { OutputPanel } from "./OutputPanel";

export function Editor() {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        heading: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      SitelenPonaNode.extend({
        addNodeView() {
          return ReactNodeViewRenderer(
            SitelenPonaGlyph
          );
        },
      }),
      AutoConvert,
      VariantKeymap,
    ],
    content: "<p></p>",
  });

  return (
    <div className="editor-wrapper">
      <Toolbar editor={editor} />
      <div className="editor-content-wrapper">
        <EditorContent editor={editor} />
        {editor && (
          <VariantPopup editor={editor} />
        )}
      </div>
      <OutputPanel editor={editor} />
    </div>
  );
}
