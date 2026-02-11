import React, { useCallback } from "react";
import { Editor } from "@tiptap/core";
import {
  STACKING_JOINER,
  SCALING_JOINER,
  START_OF_LONG_GLYPH,
  END_OF_LONG_GLYPH,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
} from "../../data";

interface ToolbarProps {
  editor: Editor | null;
}

function charFromCodepoint(cp: number): string {
  return String.fromCodePoint(cp);
}

export function Toolbar({ editor }: ToolbarProps) {
  const insertCartouche = useCallback(() => {
    if (!editor) return;
    const start = charFromCodepoint(
      START_OF_CARTOUCHE
    );
    const ext = charFromCodepoint(
      CARTOUCHE_EXTENSION
    );
    const end = charFromCodepoint(
      END_OF_CARTOUCHE
    );

    const { from, to } = editor.state.selection;
    const selectedContent: string[] = [];
    editor.state.doc.nodesBetween(
      from,
      to,
      (node) => {
        if (
          node.type.name === "sitelenPona"
        ) {
          selectedContent.push(
            node.attrs.word as string
          );
        } else if (node.isText && node.text) {
          selectedContent.push(node.text);
        }
      }
    );

    // Build cartouche: start + content with
    // extensions between glyphs + end
    const parts = selectedContent;
    let result = start;
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) result += ext;
      result += parts[i];
    }
    result += end;

    editor.chain().focus().insertContent(result).run();
  }, [editor]);

  const insertLongGlyph = useCallback(() => {
    if (!editor) return;
    const start = charFromCodepoint(
      START_OF_LONG_GLYPH
    );
    const end = charFromCodepoint(
      END_OF_LONG_GLYPH
    );
    editor
      .chain()
      .focus()
      .insertContent(start + end)
      .run();
  }, [editor]);

  const insertStackingJoiner = useCallback(() => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent(
        charFromCodepoint(STACKING_JOINER)
      )
      .run();
  }, [editor]);

  const insertScalingJoiner = useCallback(() => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent(
        charFromCodepoint(SCALING_JOINER)
      )
      .run();
  }, [editor]);

  const disabled = !editor || !editor.isFocused;

  return (
    <div className="toolbar">
      <button
        className="toolbar__button"
        onClick={insertCartouche}
        disabled={disabled}
        title="Wrap in cartouche (proper names)"
      >
        Cartouche
      </button>
      <button
        className="toolbar__button"
        onClick={insertLongGlyph}
        disabled={disabled}
        title="Insert long glyph markers"
      >
        Long Glyph
      </button>
      <button
        className="toolbar__button"
        onClick={insertStackingJoiner}
        disabled={disabled}
        title="Insert stacking joiner"
      >
        Stack
      </button>
      <button
        className="toolbar__button"
        onClick={insertScalingJoiner}
        disabled={disabled}
        title="Insert scaling joiner"
      >
        Scale
      </button>
    </div>
  );
}
