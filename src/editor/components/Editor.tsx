import React, {
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  useEditor,
  EditorContent,
} from "@tiptap/react";
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
  VerbatimToggle,
} from "../extensions/verbatim-toggle";
import {
  StructuralIndicators,
} from "../extensions/structural-indicators";
import {
  LineBreaks,
} from "../extensions/line-breaks";
import {
  LipuModel,
  lipuModelKey,
} from "../extensions/lipu-model";
import {
  LipuHistory,
} from "../extensions/lipu-history";
import {
  MirrorHighlight,
} from "../extensions/mirror-highlight";
import {
  BlockIndicators,
} from "../extensions/block-indicators";
import {
  docToLipu,
  lipuToContent,
  loadNormalizeLipu,
} from "../lipu-doc";
import { verifySpProjection } from "../sync-guard";
import { focusTracker } from "../focus-tracker";
import type { SavePayload } from "../lipu-doc";
import type { Lipu } from "../../lipu";
import {
  createSelectionMenuPlugin,
  SelectionMenu,
} from "./SelectionMenu";
import {
  AutocompletePopup,
} from "./AutocompletePopup";
import type { Editor as TiptapEditor } from
  "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";

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

interface EditorProps {
  lipu: Lipu;
  // True when `lipu` already carries fully
  // resolved provenance marks (the storage layer's
  // `classified` cue, documents.ts) — the load-boundary
  // classifier is then skipped. Defaults false, the
  // original unconditional-classify behavior.
  lipuClassified?: boolean;
  onSave?: (payload: SavePayload) => void;
  onEditorReady?: (
    editor: TiptapEditor | null
  ) => void;
}

export function Editor({
  lipu,
  lipuClassified = false,
  onSave,
  onEditorReady,
}: EditorProps) {
  const saveTimer =
    useRef<ReturnType<typeof setTimeout>>();
  const latestPayload =
    useRef<SavePayload | null>(null);
  const lastSeenDoc = useRef<PmNode | null>(null);
  // 0, not -1: version 0 IS "unmodified since load",
  // and TipTap emits `create` from a setTimeout, so a
  // transaction can beat onCreate to the ref (any
  // fake-timer test does exactly that). Seeding the
  // sentinel with the value the model starts at means
  // a pre-create caret move cannot fake a save.
  const lastVersion = useRef(0);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const initialContent = useMemo(
    () => lipuToContent(lipu),
    [lipu]
  );

  const editor = useEditor({
    content: initialContent,
    onCreate({ editor: e }) {
      lastSeenDoc.current = e.state.doc;
      const st = lipuModelKey.getState(e.state);
      if (st) lastVersion.current = st.version;
    },
    // SAVES TRACK THE MODEL VERSION, with doc
    // identity kept as the fallback for
    // the no-plugin-state case. The version is the
    // trigger because a Latin-side adoption that
    // stays local to the model
    // carries ZERO SP steps: the doc object is
    // literally unchanged while the lipu gained bytes
    // the SP side cannot express (gap.latin, the
    // `case` facet), so a doc-identity trigger saw
    // nothing and the edit died at the next reload.
    // The version advances on every model change and
    // on nothing else, so it covers SP edits, Latin
    // adoptions (local ones included), the
    // crystallization append below, and undo/redo
    // adoptions (origin "history" suppresses
    // history RECORDING, never saves) — while a
    // selection-only transaction still schedules
    // nothing (no save storm on caret moves).
    //
    // What it replaced, and why that mattered (the
    // property is
    // PRESERVED, not dropped): the empty-line
    // normalizer's dwell
    // crystallization rides as an APPENDED
    // transaction: the doc splits while the
    // DISPATCHED transaction changed nothing (a
    // caret move, or the blur handler's bare tr),
    // and TipTap gates onUpdate on the ROOT
    // transaction's docChanged -- so onUpdate never
    // fired for it and the debounced save could
    // still be holding the PRE-split payload
    // captured at the Enter. onTransaction fires
    // once per dispatch and `editor.state` is
    // already the post-append state there, so the
    // model version it reads is already the
    // post-append one too — the crystallization is
    // caught exactly once, as before.
    onTransaction({ editor: e }) {
      // Post-chain production guard; the model
      // wins on mismatch (it dispatches its own
      // sync-flagged correction, which re-enters
      // here and then verifies clean).
      verifySpProjection(e);
      const st = lipuModelKey.getState(e.state);
      const docChanged =
        e.state.doc !== lastSeenDoc.current;
      lastSeenDoc.current = e.state.doc;
      if (st) {
        if (st.version === lastVersion.current) {
          return;
        }
        lastVersion.current = st.version;
      } else if (!docChanged) {
        return;
      }
      // {lipu, content} are snapshotted together
      // here so they always describe the same
      // state -- lipu drives content in the
      // normal case, and the fallback derives
      // both from the same doc when plugin state
      // is unavailable, so a save never mixes
      // content from two different revisions.
      const payload: SavePayload = st
        ? { lipu: st.lipu, content: lipuToContent(st.lipu) }
        : {
            lipu: docToLipu(e.state.doc),
            content: e.getJSON(),
          };
      latestPayload.current = payload;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        // Fire from the REF, not a closed-over
        // payload variable. Today these are the SAME
        // object at fire time -- every capture above
        // clears the old timer and reschedules a new
        // one, and flush() clears the timer before
        // clearing the ref -- so this read is
        // UNPINNABLE belt-and-braces, not live work:
        // it exists to keep "newest snapshot wins"
        // true if a future writer ever updates
        // latestPayload.current without also
        // rescheduling.
        const pending = latestPayload.current;
        latestPayload.current = null;
        if (pending) onSaveRef.current?.(pending);
      }, 500);
    },
    editorProps: {
      attributes: {
        class: "editor-content",
        // UCSUR glyphs aren't spellcheckable, but
        // provisional Latin runs mid-typing are —
        // suppress the squiggles here too.
        spellcheck: "false",
      },
    },
    extensions: [
      // LineBreaks is declared FIRST so its Enter
      // handler runs LAST among same-priority user
      // extensions (TipTap reverses declaration
      // order): every UI Enter handler (selection
      // menu, autocomplete via its priority 110)
      // must win over the soft-break fallback,
      // which itself still beats the core
      // splitBlock keymap.
      LineBreaks,
      // DECLARED BEFORE LipuModel, which is
      // what puts its plugin state AFTER lipu-model's
      // in the apply chain (TipTap reverses the
      // extension array). Ordered the other way it
      // reads an un-advanced model version and
      // records nothing; lipu-history.ts tripwires on
      // that shape and lipu-history.test.ts pins it.
      LipuHistory,
      LipuModel.configure({
        // LOAD-BOUNDARY NORMALIZATION:
        // classify FIRST (skipped when lipuClassified
        // says the marks are already resolved), then
        // the same chain order as
        // mergeSpBlock's tail: the separation
        // default, then the boundary letterish-gap
        // normalization.
        // Both later passes write latin bytes only, so
        // the seed gate never sees them; all three are
        // idempotent.
        initialLipu: lipu
          ? loadNormalizeLipu(lipu, lipuClassified)
          : null,
      }),
      MirrorHighlight,
      BlockIndicators,
      StarterKit.configure({
        // PM-native history is OFF on BOTH editors.
        // Undo is a lipu-layer operation now — one
        // shared stack hosted by the SP editor:
        // a doc-step history cannot see Latin-local
        // edits at all (they carry zero SP steps) and
        // would fight the shared stack for Cmd+Z.
        history: false,
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
      VerbatimToggle,
      Autocomplete,
      StructuralChars,
      VariantKeymap,
      PasteHandler,
      Verbatim,
      StructuralIndicators,
      TextNodeNormalizer,
    ],
  });

  const flush = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (latestPayload.current) {
      onSaveRef.current?.(latestPayload.current);
      latestPayload.current = null;
    }
  }, []);

  useEffect(() => () => flush(), [flush]);

  // Focus protocol. The tracker is a plugin-EXTERNAL
  // singleton, so it outlives any one editor: reset
  // it per mount. This component is keyed by
  // activeId in App.tsx, so a document switch
  // remounts it and the stale focus state of the
  // retired pair dies with it.
  useEffect(() => {
    focusTracker.reset();
  }, []);

  // The SP half of the tracker. Only FOCUS is wired
  // here: the blur side belongs to the three
  // consumers that actually defer work (LineBreaks,
  // Autocomplete, SelectionMenu), each registering
  // its own settle callback.
  useEffect(() => {
    if (!editor) return;
    // ...and the CLAIM: this view, and only this
    // view, is the SP pane. Autocomplete and
    // SelectionMenu are shared with NameInput's
    // editor, which is not a pane and must keep
    // today's blur semantics.
    focusTracker.claimSpView(editor.view);
    const onFocus = () =>
      focusTracker.notifyFocus("sp");
    editor.on("focus", onFocus);
    return () => {
      editor.off("focus", onFocus);
      focusTracker.claimSpView(null);
    };
  }, [editor]);

  const onReadyRef = useRef(onEditorReady);
  onReadyRef.current = onEditorReady;
  useEffect(() => {
    onReadyRef.current?.(editor);
    return () => {
      onReadyRef.current?.(null);
    };
  }, [editor]);

  return (
    <div className="editor-outer">
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
      </div>
    </div>
  );
}
