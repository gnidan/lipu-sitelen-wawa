import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SitelenPona } from "./sitelen-pona";
import { blockText, cpBefore } from "./structural-indicators";
import {
  codepointToChar,
  wordToCodepoint,
  START_OF_LONG_GLYPH,
  END_OF_LONG_GLYPH,
  IDEOGRAPHIC_SPACE,
} from "../../data";
import { glyph as ucsur } from "../../../test/helpers";

const IDEO = codepointToChar(IDEOGRAPHIC_SPACE);
const LONG_START = codepointToChar(START_OF_LONG_GLYPH);
const LONG_END = codepointToChar(END_OF_LONG_GLYPH);

function createEditor(content: string): Editor {
  return new Editor({
    extensions: [StarterKit, SitelenPona],
    content,
  });
}

/**
 * One "line" in the user's repro shape: an
 * ideographic space at the start, a UCSUR word,
 * "lon", then a long-glyph span wrapping one
 * glyph (long-start + glyph + long-end).
 */
function line(word: string, longWord: string): string {
  return (
    IDEO +
    ucsur(word) +
    ucsur("lon") +
    LONG_START +
    ucsur(longWord) +
    LONG_END
  );
}

describe("blockText", () => {
  it(
    "projects a block with hardBreaks so string " +
      "index === doc offset (placeholder per leaf)",
    () => {
      const a = ucsur("toki");
      const b = ucsur("pona");
      const editor = createEditor(
        `<p>${a}<br>${b}</p>`
      );

      const $from = editor.state.doc.resolve(
        1 + a.length
      );
      const text = blockText($from.parent);

      // Length matches the doc-position span of
      // the block's content, not textContent
      // (which would omit the hardBreak).
      expect(text.length).toBe(
        $from.parent.content.size
      );
      expect($from.parent.textContent.length).toBe(
        a.length + b.length
      );

      // The hardBreak contributes exactly one
      // placeholder character at its doc offset.
      expect(text[a.length]).toBe("￼");
      expect(text.slice(0, a.length)).toBe(a);
      expect(
        text.slice(a.length + 1, a.length + 1 + b.length)
      ).toBe(b);

      editor.destroy();
    }
  );
});

describe(
  "structural indicators survive soft breaks " +
    "(offset-safe block text)",
  () => {
    it(
      "resolves the long-end as the char before " +
        "the cursor on line 2 (the +1 " +
        "mid-surrogate case)",
      () => {
        const line1 = line("toki", "pona");
        const line2 = line("mute", "suli");
        const line3 = line("moku", "telo");
        const editor = createEditor(
          `<p>${line1}<br>${line2}<br>${line3}</p>`
        );

        const afterLine2 =
          1 + line1.length + 1 + line2.length;
        const $from =
          editor.state.doc.resolve(afterLine2);
        const text = blockText($from.parent);
        const off = afterLine2 - $from.start();

        expect(cpBefore(text, off)).toBe(
          END_OF_LONG_GLYPH
        );

        editor.destroy();
      }
    );

    it(
      "resolves the long-end as the char before " +
        "the cursor on line 3 (the +2 " +
        "whole-glyph-shift case), not a shifted " +
        "neighbor",
      () => {
        const line1 = line("toki", "pona");
        const line2 = line("mute", "suli");
        const line3 = line("moku", "telo");
        const editor = createEditor(
          `<p>${line1}<br>${line2}<br>${line3}</p>`
        );

        const afterLine3 =
          1 +
          line1.length +
          1 +
          line2.length +
          1 +
          line3.length;
        const $from =
          editor.state.doc.resolve(afterLine3);
        const text = blockText($from.parent);
        const off = afterLine3 - $from.start();

        expect(cpBefore(text, off)).toBe(
          END_OF_LONG_GLYPH
        );
        // Guard against the documented failure
        // mode: a +2 shift landing one whole
        // glyph off would resolve to the
        // long-glyph word instead.
        expect(cpBefore(text, off)).not.toBe(
          wordToCodepoint["telo"]
        );

        editor.destroy();
      }
    );

    it(
      "no-break control: line 1 semantics are " +
        "unchanged",
      () => {
        const line1 = line("toki", "pona");
        const editor = createEditor(`<p>${line1}</p>`);

        const afterLine1 = 1 + line1.length;
        const $from =
          editor.state.doc.resolve(afterLine1);
        const text = blockText($from.parent);
        const off = afterLine1 - $from.start();

        expect(cpBefore(text, off)).toBe(
          END_OF_LONG_GLYPH
        );
        // Without any hardBreak in the block,
        // blockText and textContent agree.
        expect(text).toBe($from.parent.textContent);

        editor.destroy();
      }
    );
  }
);
