import { BubbleMenu } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import {
  wordToCodepoint,
  codepointToChar,
  hasVariations,
  getVariations,
  applyVariation,
} from "../../data";

interface VariantPopupProps {
  editor: Editor;
}

function shouldShow({
  state,
}: {
  state: { selection: unknown };
}): boolean {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) {
    return false;
  }
  const node = selection.node;
  if (node.type.name !== "sitelenPona") {
    return false;
  }
  return hasVariations(node.attrs.word);
}

function getSelectedWord(editor: Editor): string | null {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection)) {
    return null;
  }
  const node = selection.node;
  if (node.type.name !== "sitelenPona") {
    return null;
  }
  return node.attrs.word;
}

function glyphChar(word: string, variation?: number): string {
  const cp = wordToCodepoint[word];
  if (cp === undefined) return "";
  const base = codepointToChar(cp);
  if (variation && variation > 0) {
    return applyVariation(base, variation);
  }
  return base;
}

export function VariantPopup({ editor }: VariantPopupProps) {
  const handleSelect = (variation: number) => {
    const { state, dispatch } = editor.view;
    const { selection } = state;
    if (!(selection instanceof NodeSelection)) return;

    const tr = state.tr.setNodeMarkup(
      selection.from,
      undefined,
      {
        ...selection.node.attrs,
        variation,
      }
    );
    dispatch(tr);
  };

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={shouldShow}
    >
      <VariantPopupContent
        editor={editor}
        onSelect={handleSelect}
      />
    </BubbleMenu>
  );
}

interface VariantPopupContentProps {
  editor: Editor;
  onSelect: (variation: number) => void;
}

function VariantPopupContent({
  editor,
  onSelect,
}: VariantPopupContentProps) {
  const word = getSelectedWord(editor);
  if (!word) return null;

  const variations = getVariations(word);

  return (
    <div className="variant-popup">
      <div className="variant-grid">
        <button
          className="variant-option"
          onClick={() => onSelect(0)}
          title="Default"
          type="button"
        >
          <span className="variant-popup__glyph">
            {glyphChar(word)}
          </span>
          <span className="variant-label">0</span>
        </button>
        {variations.map((v) => (
          <button
            key={v.index}
            className="variant-option"
            onClick={() => onSelect(v.index)}
            title={v.description}
            type="button"
          >
            <span className="variant-popup__glyph">
              {glyphChar(word, v.index)}
            </span>
            <span className="variant-label">
              {v.index}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
