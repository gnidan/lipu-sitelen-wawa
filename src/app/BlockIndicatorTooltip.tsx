import React, { useEffect, useRef } from "react";
import {
  useEditor,
  EditorContent,
} from "@tiptap/react";
import {
  TextSelection,
} from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import {
  BlockIndicators,
} from "../editor/extensions/block-indicators";
import {
  fromVerbatim,
} from "../convert/verbatim";

/**
 * Two paragraphs labelled "this is block
 * number one" / "...two". Each word is a
 * UCSUR glyph (surrogate pair, 2 code
 * units); ni< produces glyph + arrow (3).
 * fromVerbatim strips spaces, so each
 * block is 11 code units.
 *
 * Block 0: pos 1..11  (para open=0, close=12)
 * Block 1: pos 13..23 (para open=12, close=24)
 *
 * Cursor in middle of each: 6, 18.
 */
const BLOCKS = [
  fromVerbatim("ni< li leko nanpa wan"),
  fromVerbatim("ni< li leko nanpa tu"),
];

const CONTENT = BLOCKS.map(
  (text) => `<p>${text}</p>`
).join("");

// Cursor positions: one per block, same
// relative offset (after "leko", pos 8
// within each block's 11 code units).
const POSITIONS = [8, 20];
const STEP_MS = 800;

export function BlockIndicatorTooltip() {
  const sceneRef =
    useRef<HTMLDivElement>(null);
  const cursorRef =
    useRef<HTMLDivElement>(null);

  const editor = useEditor({
    content: CONTENT,
    editable: false,
    editorProps: {
      attributes: {
        class:
          "editor-content"
          + " block-indicator-tooltip__editor",
        tabindex: "-1",
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
        history: false,
      }),
      BlockIndicators,
    ],
  });

  useEffect(() => {
    if (!editor) return;
    let idx = 0;
    let dir = 1;

    const moveTo = (pos: number) => {
      const { tr } = editor.state;
      editor.view.dispatch(
        tr.setSelection(
          TextSelection.create(tr.doc, pos)
        )
      );

      const scene = sceneRef.current;
      const cursor = cursorRef.current;
      if (!scene || !cursor) return;

      const coords =
        editor.view.coordsAtPos(pos);
      const rect =
        scene.getBoundingClientRect();

      cursor.style.left =
        `${coords.left - rect.left}px`;
      cursor.style.top =
        `${coords.top - rect.top}px`;
      cursor.style.height =
        `${coords.bottom - coords.top}px`;
    };

    moveTo(POSITIONS[0]);
    const timer = setInterval(() => {
      const atEnd =
        idx === POSITIONS.length - 1;
      const atStart = idx === 0;
      if (atEnd) dir = -1;
      else if (atStart) dir = 1;
      idx += dir;
      moveTo(POSITIONS[idx]);
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [editor]);

  return (
    <div className="block-indicator-tooltip">
      <div
        className={
          "block-indicator-tooltip__card"
        }
      >
        <div
          className={
            "block-indicator-tooltip__scene"
          }
          ref={sceneRef}
        >
          <EditorContent editor={editor} />
          <div
            ref={cursorRef}
            className={
              "block-indicator-tooltip__cursor"
            }
          />
        </div>
      </div>
    </div>
  );
}
