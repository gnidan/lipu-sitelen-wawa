import {
  useState,
  useCallback,
  useRef,
} from "react";
import {
  type DocEntry,
  loadIndex,
  saveIndex,
  loadDocLipuClassified,
  saveDocDual,
  removeDoc,
  getActiveDocId,
  setActiveDocId,
  createDoc,
  migrate,
} from "./documents";
import { migrateToLipu } from "./lipu-migration";
import { trimLatinNewlines } from "./latin-newline-trim";
import { emptyLipu } from "../editor/lipu-doc";
import type { SavePayload } from "../editor/lipu-doc";
import type { Lipu } from "../lipu";

export type { SavePayload };

export interface UseDocumentsResult {
  index: DocEntry[];
  activeId: string;
  activeLipu: Lipu;
  // True when activeLipu's marks are already
  // fully resolved (documents.ts's `classified` cue) —
  // threaded to Editor's lipuClassified prop so the
  // load-boundary classifier is not re-run over them.
  activeLipuClassified: boolean;
  createDocument(): string;
  switchDocument(id: string): void;
  deleteDocument(id: string): void;
  renameDocument(id: string, name: string): void;
  savePayload(payload: SavePayload): void;
}

/** loadDocLipuClassified with the emptyLipu() fallback
 *  (a fresh empty block has nothing to classify, so
 *  `classified: true` is trivially correct for it). */
function loadActive(id: string): {
  lipu: Lipu;
  classified: boolean;
} {
  return (
    loadDocLipuClassified(id) ?? {
      lipu: emptyLipu(),
      classified: true,
    }
  );
}

function initState(): {
  index: DocEntry[];
  activeId: string;
  activeLipu: Lipu;
  activeLipuClassified: boolean;
} {
  // ORDER: the storage passes run BEFORE the first
  // loadDocLipu and, because initState is the
  // useDocuments state initializer, strictly before
  // the Editor mounts — and therefore before any save.
  // Historically (pre-flip) this ordering was safety-
  // critical: a save racing ahead of the migration
  // could mint a lipu: value that made migrateToLipu
  // skip the doc as already-converted and delete a
  // branch-local lipudoc whose latin content the save
  // couldn't reproduce. That lipudoc branch is retired
  // (the storage flip); a save now mints lipu: from
  // the live model directly, which migrateToLipu's
  // idempotent per-doc check correctly leaves alone
  // either way. The ordering is kept as the simple,
  // well-tested default. Pinned by test in
  // useDocuments.test.ts.
  migrate();
  migrateToLipu();
  // One-time orphaned-latin-newline cleanup (latin
  // newlines are kept in step with sp newlines at
  // every break; old builds left orphans behind),
  // run AFTER migrateToLipu() so
  // every doc already has (or has been skipped for) a
  // lipu: value to trim through the normal load/save
  // path. Self-retiring (latin-newline-trim.ts).
  trimLatinNewlines();

  let index = loadIndex();
  let activeId = getActiveDocId();

  // If no documents exist, create one
  if (index.length === 0) {
    const entry = createDoc();
    index = loadIndex();
    activeId = entry.id;
    setActiveDocId(activeId);
  }

  // If active doc not in index, use first
  if (!index.some((e) => e.id === activeId)) {
    activeId = index[0].id;
    setActiveDocId(activeId);
  }

  const { lipu: activeLipu, classified } =
    loadActive(activeId!);

  return {
    index,
    activeId: activeId!,
    activeLipu,
    activeLipuClassified: classified,
  };
}

export function useDocuments():
  UseDocumentsResult
{
  const [state, setState] = useState(initState);
  // Tracks which doc ids have already had their
  // prev: rolled during this doc-open, so the roll
  // happens once per open, not once per debounced
  // save (spec: prev-per-doc-open).
  const rolledRef = useRef(new Set<string>());

  const createDocument = useCallback(() => {
    const entry = createDoc();
    setActiveDocId(entry.id);
    rolledRef.current.delete(entry.id);
    const { lipu, classified } = loadActive(entry.id);
    setState({
      index: loadIndex(),
      activeId: entry.id,
      activeLipu: lipu,
      activeLipuClassified: classified,
    });
    return entry.id;
  }, []);

  const switchDocument = useCallback(
    (id: string) => {
      // Guards against a future call site re-rolling
      // prev: via a same-id "switch" -- switching to
      // the doc that's already open is not a doc-open
      // transition.
      if (id === state.activeId) return;
      setActiveDocId(id);
      rolledRef.current.delete(id);
      const { lipu, classified } = loadActive(id);
      setState({
        index: loadIndex(),
        activeId: id,
        activeLipu: lipu,
        activeLipuClassified: classified,
      });
    },
    [state.activeId]
  );

  const deleteDocument = useCallback(
    (id: string) => {
      removeDoc(id);

      let index = loadIndex();
      let newActiveId = state.activeId;

      if (index.length === 0) {
        const entry = createDoc();
        index = loadIndex();
        newActiveId = entry.id;
      } else if (id === state.activeId) {
        // Sort by updatedAt descending,
        // pick most recent
        const sorted = [...index].sort(
          (a, b) => b.updatedAt - a.updatedAt
        );
        newActiveId = sorted[0].id;
      }

      setActiveDocId(newActiveId);
      // Only clear the roll flag when the active
      // doc is actually changing -- deleting some
      // OTHER doc while the current one stays open
      // is not a doc-open transition, and clearing
      // it here would re-roll prev: on the next
      // save, clobbering the pre-open baseline with
      // intermediate content.
      if (newActiveId !== state.activeId) {
        rolledRef.current.delete(newActiveId);
      }
      const { lipu, classified } =
        loadActive(newActiveId);
      setState({
        index,
        activeId: newActiveId,
        activeLipu: lipu,
        activeLipuClassified: classified,
      });
    },
    [state.activeId]
  );

  const renameDocument = useCallback(
    (id: string, name: string) => {
      const index = loadIndex();
      const entry = index.find(
        (e) => e.id === id
      );
      if (entry) {
        entry.name = name;
        saveIndex(index);
        setState((prev) => ({
          ...prev,
          index: [...index],
        }));
      }
    },
    []
  );

  const savePayload = useCallback(
    (payload: SavePayload) => {
      const activeId = state.activeId;
      const rollPrev =
        !rolledRef.current.has(activeId);
      const saved = saveDocDual(
        activeId,
        payload.lipu,
        payload.content,
        rollPrev
      );
      // ONLY a completed save retires the roll. If
      // saveDocDual could not secure the pre-open
      // baseline (prev: AND quarantine: both refused
      // the write), it left that baseline in
      // lipu:<id> and wrote nothing over it —
      // marking the doc rolled here would send the
      // next autosave through with rollPrev false,
      // and THAT write would overwrite the
      // never-copied baseline. Retrying the whole
      // roll-or-preserve sequence each save is what
      // makes this converge once quota heals.
      if (saved) rolledRef.current.add(activeId);

      const index = loadIndex();
      const entry = index.find(
        (e) => e.id === activeId
      );
      if (entry) {
        entry.updatedAt = Date.now();
        saveIndex(index);
      }

      setState((prev) => ({
        ...prev,
        index: loadIndex(),
      }));
    },
    [state.activeId]
  );

  return {
    index: state.index,
    activeId: state.activeId,
    activeLipu: state.activeLipu,
    activeLipuClassified: state.activeLipuClassified,
    createDocument,
    switchDocument,
    deleteDocument,
    renameDocument,
    savePayload,
  };
}
