/**
 * Passive decoration layer for Latin->SP selection
 * mirroring. Receives ranges via META-ONLY
 * transactions (spec-blessed: not docChanged, so
 * lipu-model's plugin state no-ops). Never
 * dispatches on its own, never handles input.
 * Doc changes clear the highlight (pane selection
 * is transient across edits).
 */

import { Extension } from "@tiptap/core";
import type { Editor as TiptapEditor }
  from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import {
  Decoration,
  DecorationSet,
} from "@tiptap/pm/view";

export interface MirrorRangePm {
  from: number;
  to: number;
}

export const mirrorHighlightKey =
  new PluginKey<DecorationSet>("mirrorHighlight");

export const MirrorHighlight = Extension.create({
  name: "mirrorHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: mirrorHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, prev) {
            const meta = tr.getMeta(
              mirrorHighlightKey
            );
            if (meta !== undefined) {
              const ranges =
                meta as MirrorRangePm[];
              return DecorationSet.create(
                tr.doc,
                ranges
                  .filter((r) => r.to > r.from)
                  .map((r) =>
                    Decoration.inline(r.from, r.to, {
                      class: "mirror-highlight",
                    })
                  )
              );
            }
            if (tr.docChanged) {
              return DecorationSet.empty;
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return mirrorHighlightKey.getState(
              state
            );
          },
        },
      }),
    ];
  },
});

export function setMirrorHighlights(
  editor: TiptapEditor,
  ranges: MirrorRangePm[]
): void {
  const tr = editor.state.tr.setMeta(
    mirrorHighlightKey,
    ranges
  );
  editor.view.dispatch(tr);
}
