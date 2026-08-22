/**
 * Block gutter indicators. Adds a thin vertical
 * bar in the left margin of every paragraph; the
 * bar on the block containing the cursor is
 * emphasized. Cross-pane sync via META-ONLY
 * transactions (same channel mirror-highlight
 * uses): the focused pane dispatches its active
 * block index to the other pane, which renders
 * the matching bar as active.
 */

import { Extension } from "@tiptap/core";
import type { Editor as TiptapEditor }
  from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PmNode }
  from "@tiptap/pm/model";
import {
  Decoration,
  DecorationSet,
} from "@tiptap/pm/view";

interface BlockIndicatorState {
  activeBlock: number;
  decos: DecorationSet;
}

export const blockIndicatorKey =
  new PluginKey<BlockIndicatorState>(
    "blockIndicators"
  );

/**
 * Which block (paragraph index) the cursor sits
 * in, or -1 at doc level.
 */
export function activeBlockIndex(
  state: EditorState
): number {
  const { $head } = state.selection;
  if ($head.depth === 0) return -1;
  return $head.index(0);
}

function buildDecos(
  doc: PmNode,
  active: number
): DecorationSet {
  const decos: Decoration[] = [];
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const cls =
      i === active
        ? "block-indicator block-indicator--active"
        : "block-indicator";
    decos.push(
      Decoration.node(
        pos,
        pos + child.nodeSize,
        { class: cls }
      )
    );
    pos += child.nodeSize;
  }
  return DecorationSet.create(doc, decos);
}

export const BlockIndicators = Extension.create({
  name: "blockIndicators",

  addProseMirrorPlugins() {
    return [
      new Plugin<BlockIndicatorState>({
        key: blockIndicatorKey,
        state: {
          init(_, state) {
            const active =
              activeBlockIndex(state);
            return {
              activeBlock: active,
              decos: buildDecos(
                state.doc, active
              ),
            };
          },
          apply(tr, prev, oldState, newState) {
            const meta =
              tr.getMeta(blockIndicatorKey);
            let active: number;
            if (meta !== undefined) {
              active = meta as number;
            } else if (
              tr.docChanged ||
              !oldState.selection.eq(
                newState.selection
              )
            ) {
              active =
                activeBlockIndex(newState);
            } else {
              return prev;
            }
            if (
              active === prev.activeBlock &&
              !tr.docChanged
            ) {
              return prev;
            }
            return {
              activeBlock: active,
              decos: buildDecos(
                newState.doc, active
              ),
            };
          },
        },
        props: {
          decorations(state) {
            return blockIndicatorKey.getState(
              state
            )?.decos;
          },
        },
      }),
    ];
  },
});

/**
 * Set the active block in another editor —
 * meta-only, like setMirrorHighlights.
 */
export function setActiveBlock(
  editor: TiptapEditor,
  blockIndex: number
): void {
  const tr = editor.state.tr.setMeta(
    blockIndicatorKey,
    blockIndex
  );
  editor.view.dispatch(tr);
}
