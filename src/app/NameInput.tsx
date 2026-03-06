import React, {
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import {
  useEditor,
  EditorContent,
} from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder
  from "@tiptap/extension-placeholder";
import {
  SitelenPona,
} from "../editor/extensions/sitelen-pona";
import {
  Autocomplete,
} from "../editor/extensions/autocomplete";
import {
  StructuralChars,
} from "../editor/extensions/structural-chars";
import {
  VariantKeymap,
} from "../editor/extensions/variant-keymap";
import {
  PasteHandler,
} from "../editor/extensions/paste-handler";
import {
  Verbatim,
} from "../editor/extensions/verbatim";
import {
  VerbatimToggle,
} from "../editor/extensions/verbatim-toggle";
import {
  createSelectionMenuPlugin,
  SelectionMenu,
} from "../editor/components/SelectionMenu";
import {
  AutocompletePopup,
} from "../editor/components/AutocompletePopup";

const SelectionMenuExtension = Extension.create(
  {
    name: "nameInputSelectionMenuPlugin",
    addProseMirrorPlugins() {
      return [createSelectionMenuPlugin()];
    },
  }
);

const TextNodeNormalizer = Extension.create({
  name: "nameInputTextNodeNormalizer",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view() {
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

const SingleLine = Extension.create({
  name: "singleLine",
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        this.editor.commands.blur();
        return true;
      },
      "Shift-Enter": () => true,
    };
  },
});

interface NameInputProps {
  value: string;
  onChange: (name: string) => void;
  autoFocus?: boolean;
}

function textFromDoc(
  editor: ReturnType<typeof useEditor>
): string {
  if (!editor) return "";
  const json = editor.getJSON();
  if (!json.content) return "";
  return json.content
    .flatMap(
      (block) =>
        block.content
          ?.filter(
            (n) => n.type === "text" && n.text
          )
          .map((n) => n.text!) ?? []
    )
    .join("");
}

export function NameInput({
  value,
  onChange,
  autoFocus,
}: NameInputProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    content: value
      ? {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: value },
              ],
            },
          ],
        }
      : undefined,
    onUpdate({ editor: e }) {
      const text = textFromDoc(e);
      onChangeRef.current(text);
    },
    onBlur({ editor: e }) {
      const text = textFromDoc(e);
      onChangeRef.current(text);
    },
    editorProps: {
      attributes: {
        class: "name-input__editor",
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
        placeholder: "nimi",
      }),
      SelectionMenuExtension,
      VerbatimToggle,
      Autocomplete,
      StructuralChars,
      VariantKeymap,
      PasteHandler,
      Verbatim,
      TextNodeNormalizer,
      SingleLine,
    ],
  });

  useEffect(() => {
    if (autoFocus && editor) {
      editor.commands.focus("end");
    }
  }, [autoFocus, editor]);

  return (
    <div className="name-input">
      <EditorContent editor={editor} />
      {editor && createPortal(
        <>
          <SelectionMenu editor={editor} />
          <AutocompletePopup editor={editor} />
        </>,
        document.body
      )}
    </div>
  );
}
