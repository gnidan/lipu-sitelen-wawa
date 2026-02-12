import React from "react";
import {
  useEditor,
  EditorContent,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import {
  SitelenPona,
} from "../extensions/sitelen-pona";
import {
  Autocomplete,
} from "../extensions/autocomplete";
import {
  StructuralChars,
} from "../extensions/structural-chars";
import {
  VariantKeymap,
} from "../extensions/variant-keymap";
import {
  createVariantPopupPlugin,
  VariantPopup,
} from "./VariantPopup";
import {
  AutocompletePopup,
} from "./AutocompletePopup";
import { CopyBar } from "./CopyBar";
import { HelpPanel } from "./HelpPanel";

const VariantPopupExtension = Extension.create({
  name: "variantPopupPlugin",
  addProseMirrorPlugins() {
    return [createVariantPopupPlugin()];
  },
});

/**
 * Merges adjacent DOM text nodes so the browser's
 * text shaper sees a continuous run and applies
 * OpenType GSUB features (ligatures, etc.) across
 * the full sequence.
 */
const TextNodeNormalizer = Extension.create({
  name: "textNodeNormalizer",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view(editorView) {
          return {
            update(view) {
              view.dom.normalize();
            },
          };
        },
      }),
    ];
  },
});

export function Editor() {
  const editor = useEditor({
    editorProps: {
      attributes: {
        class: "editor-content",
      },
    },
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
      SitelenPona,
      Placeholder.configure({
        placeholder:
          "o sitelen... type words, "
          + "Space to commit",
      }),
      Autocomplete,
      StructuralChars,
      VariantKeymap,
      VariantPopupExtension,
      TextNodeNormalizer,
    ],
  });

  return (
    <div className="editor-wrapper">
      <div className="editor-content-wrapper">
        <EditorContent editor={editor} />
        {editor && (
          <>
            <VariantPopup editor={editor} />
            <AutocompletePopup editor={editor} />
          </>
        )}
      </div>
      <CopyBar editor={editor} />
      <HelpPanel />
    </div>
  );
}
