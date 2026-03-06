import {
  useState,
  useCallback,
  useRef,
} from "react";
import type { JSONContent } from "@tiptap/core";
import {
  type DocEntry,
  loadIndex,
  saveIndex,
  loadDocContent,
  saveDocContent,
  removeDoc,
  getActiveDocId,
  setActiveDocId,
  createDoc,
  migrate,
} from "./documents";

export interface UseDocumentsResult {
  index: DocEntry[];
  activeId: string;
  activeContent: JSONContent | undefined;
  createDocument(): string;
  switchDocument(id: string): void;
  deleteDocument(id: string): void;
  renameDocument(id: string, name: string): void;
  saveContent(content: JSONContent): void;
}

function initState(): {
  index: DocEntry[];
  activeId: string;
  activeContent: JSONContent | undefined;
} {
  migrate();

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

  const activeContent =
    loadDocContent(activeId!);

  return {
    index,
    activeId: activeId!,
    activeContent,
  };
}

export function useDocuments():
  UseDocumentsResult
{
  const [state, setState] = useState(initState);
  const pendingSave =
    useRef<JSONContent | null>(null);

  const flushPendingSave = useCallback(() => {
    if (pendingSave.current) {
      saveDocContent(
        state.activeId,
        pendingSave.current
      );
      pendingSave.current = null;
    }
  }, [state.activeId]);

  const createDocument = useCallback(() => {
    flushPendingSave();
    const entry = createDoc();
    setActiveDocId(entry.id);
    setState({
      index: loadIndex(),
      activeId: entry.id,
      activeContent: undefined,
    });
    return entry.id;
  }, [flushPendingSave]);

  const switchDocument = useCallback(
    (id: string) => {
      flushPendingSave();
      setActiveDocId(id);
      setState({
        index: loadIndex(),
        activeId: id,
        activeContent: loadDocContent(id),
      });
    },
    [flushPendingSave]
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
      setState({
        index,
        activeId: newActiveId,
        activeContent:
          loadDocContent(newActiveId),
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

  const saveContent = useCallback(
    (content: JSONContent) => {
      pendingSave.current = content;
      saveDocContent(state.activeId, content);

      const index = loadIndex();
      const entry = index.find(
        (e) => e.id === state.activeId
      );
      if (entry) {
        entry.updatedAt = Date.now();
        saveIndex(index);
      }

      setState((prev) => ({
        ...prev,
        index: loadIndex(),
      }));
      pendingSave.current = null;
    },
    [state.activeId]
  );

  return {
    index: state.index,
    activeId: state.activeId,
    activeContent: state.activeContent,
    createDocument,
    switchDocument,
    deleteDocument,
    renameDocument,
    saveContent,
  };
}
