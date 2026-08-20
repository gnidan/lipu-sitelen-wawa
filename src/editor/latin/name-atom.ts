/**
 * The Latin pane's cartouche chip: an opaque
 * inline atom (nodeSize 1 — load-bearing for the
 * coordinate invariant: PM content offsets must
 * equal the projection's BlockPos offsets).
 * Selectable and deletable (deletion = span
 * death), NOT movable (equal-count structural
 * moves destroy the span). Attrs carry the opaque
 * LatinInline payload for in-place round-trips.
 * Copies as its plain spelling text (renderText);
 * pasting that text yields words/verbatims — no
 * span creation (a paste never creates spans);
 * cut-then-paste loses the cartouche (accepted
 * limitation; spelling overrides would fix it in a
 * future release).
 *
 * NOTE (note, not a pin): only a cartouche that
 * projects a NON-EMPTY name becomes
 * one of these (the ATOMIZATION RULE). A
 * NAMELESS cartouche's covered content projects as
 * ordinary text — with the pane editable it is
 * ordinary EDITABLE Latin, so span death by text
 * edit is reachable there without ever touching
 * this node; latin-editor.test.ts pins that path.
 *
 * PARSE-HTML GUARD. The node's
 * attrs carry an opaque payload — anchors,
 * interiorLatin, the spelling — that NO html
 * attribute encodes, so parsing a
 * span[data-latin-name] back would mint an atom
 * with the DEFAULT attrs: a zero-width chip with no
 * anchors, occupying one map position while showing
 * the reader nothing (the exact shape the
 * ATOMIZATION RULE exists to forbid). With the pane
 * editable, any HTML paste can reach
 * that rule, so the rule REJECTS instead: the span
 * degrades to its text content, which parses as
 * ordinary words/verbatims with no span created —
 * the documented accepted behaviour, consistent
 * with span-death rules. latin-paste.ts owns paste;
 * a real chip round-trip (with a serialized
 * payload) would belong there, not here.
 */

import { Node } from "@tiptap/core";
import type { Anchor } from "../../lipu";

export const NameAtom = Node.create({
  name: "latinName",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      anchors: { default: [] as Anchor[] },
      interiorLatin: { default: [] as string[] },
      text: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-latin-name]",
        // see PARSE-HTML GUARD above
        getAttrs: () => false as const,
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "span",
      {
        "data-latin-name": "",
        class: "latin-name",
      },
      node.attrs.text as string,
    ];
  },

  renderText({ node }) {
    return node.attrs.text as string;
  },
});
