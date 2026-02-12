import React, {
  useRef,
  useMemo,
  useState,
  useCallback,
  useEffect,
} from "react";
import {
  useEditor,
  EditorContent,
} from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
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
  PasteHandler,
} from "../extensions/paste-handler";
import {
  Verbatim,
} from "../extensions/verbatim";
import {
  createSelectionMenuPlugin,
  SelectionMenu,
} from "./SelectionMenu";
import {
  AutocompletePopup,
} from "./AutocompletePopup";
import { CopyBar } from "./CopyBar";
import { HelpButton } from "./HelpButton";
import { HelpPanel } from "./HelpPanel";


const SelectionMenuExtension = Extension.create({
  name: "selectionMenuPlugin",
  addProseMirrorPlugins() {
    return [createSelectionMenuPlugin()];
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

const STORAGE_KEY = "lipu-sitelen-wawa:doc";

function loadSavedContent():
  JSONContent | undefined
{
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as JSONContent;
    }
  } catch {
    // corrupt data; start fresh
  }
}

export function Editor() {
  const savedContent =
    useMemo(loadSavedContent, []);
  const saveTimer =
    useRef<ReturnType<typeof setTimeout>>();
  const [helpOpen, setHelpOpen] = useState(false);
  const toggleHelp = useCallback(() => {
    setHelpOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "?") {
        return;
      }

      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active.closest(".ProseMirror")
      ) {
        return;
      }

      toggleHelp();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener(
        "keydown", onKeyDown
      );
    };
  }, [toggleHelp]);

  const editor = useEditor({
    content: savedContent,
    onUpdate({ editor: e }) {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(e.getJSON())
        );
      }, 500);
    },
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
        placeholder: "\u{F1944}\u{F1960}"
      }),
      SelectionMenuExtension,
      Autocomplete,
      StructuralChars,
      VariantKeymap,
      PasteHandler,
      Verbatim,
      TextNodeNormalizer,
    ],
  });

  return (
    <div className="editor-outer">
      <div className="editor-toolbar">
        <HelpButton
          active={helpOpen}
          onToggle={toggleHelp}
        />
        {helpOpen && <HelpPanel />}
      </div>
      <div className="editor-wrapper">
        <div className="editor-content-wrapper">
          <EditorContent editor={editor} />
          {editor && (
            <>
              <SelectionMenu
                editor={editor}
              />
              <AutocompletePopup
                editor={editor}
              />
            </>
          )}
        </div>
        <CopyBar editor={editor} />
      </div>
    </div>
  );
}
