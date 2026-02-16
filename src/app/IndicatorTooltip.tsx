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
  StructuralIndicators,
} from "../editor/extensions/structural-indicators";
import {
  fromVerbatim,
} from "../convert/verbatim";

const CONTENT = fromVerbatim(
  "pi(nasin sitelen+pona)"
);

/**
 * ProseMirror doc positions for cursor stops.
 * Each UCSUR char is 2 code units (surrogate
 * pair); paragraph open tag sits at pos 0.
 *
 *   pi(2) ((2) nasin(2) sitelen(2)
 *     +(2) pona(2) )(2)
 *
 *   3 = after pi / before (       (indicators)
 *   5 = after ( / before nasin    (indicators)
 *   7 = after nasin / before sitelen
 *   9 = after sitelen / before +  (indicators)
 *  11 = after + / before pona     (indicators)
 *  13 = after pona / before )     (indicators)
 *  15 = after )                   (indicators)
 *
 * Cursor bounces: 3→15 then 15→3, repeating.
 */
const POSITIONS = [3, 5, 7, 9, 11, 13, 15];
const STEP_MS = 500;

export function IndicatorTooltip() {
  const sceneRef =
    useRef<HTMLDivElement>(null);
  const cursorRef =
    useRef<HTMLDivElement>(null);
  const highlightRef =
    useRef<HTMLDivElement>(null);

  const editor = useEditor({
    content: CONTENT,
    editable: false,
    editorProps: {
      attributes: {
        class:
          "editor-content"
          + " indicator-tooltip__editor",
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
      StructuralIndicators.configure({
        alwaysShow: true,
      }),
    ],
  });

  useEffect(() => {
    if (!editor) return;
    let idx = 0;
    let dir = 1;
    let txOffset = 0;

    const moveTo = (pos: number) => {
      const { tr } = editor.state;
      editor.view.dispatch(
        tr.setSelection(
          TextSelection.create(tr.doc, pos)
        )
      );

      const scene = sceneRef.current;
      const cursor = cursorRef.current;
      const highlight = highlightRef.current;
      const tiptap =
        editor.view.dom.parentElement;
      if (
        !scene || !cursor ||
        !highlight || !tiptap
      ) {
        return;
      }

      const coords =
        editor.view.coordsAtPos(pos);
      const rect =
        scene.getBoundingClientRect();
      const center = rect.width / 2;

      // Undo current transform to get the
      // natural x, then compute new offset
      const naturalX =
        coords.left - rect.left - txOffset;
      txOffset = center - naturalX;
      tiptap.style.transform =
        `translateX(${txOffset}px)`;

      cursor.style.left = `${center}px`;
      cursor.style.top =
        `${coords.top - rect.top}px`;
      cursor.style.height =
        `${coords.bottom - coords.top}px`;

      // Indicator row starts DROP_PX (4) below
      // the cursor bottom
      highlight.style.top =
        `${coords.bottom - rect.top + 4}px`;
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
    <div className="indicator-tooltip">
      <div className="indicator-tooltip__card">
        <div
          className="indicator-tooltip__scene"
          ref={sceneRef}
        >
          <EditorContent editor={editor} />
          <div
            ref={highlightRef}
            className={
              "indicator-tooltip__highlight"
            }
          />
          <div
            ref={cursorRef}
            className={
              "indicator-tooltip__cursor"
            }
          />
        </div>
      </div>
    </div>
  );
}
