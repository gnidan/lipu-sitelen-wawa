import type { JSONContent } from "@tiptap/core";

const INDEX_KEY = "lipu-sitelen-wawa:doc-index";
const ACTIVE_KEY = "lipu-sitelen-wawa:active-doc";
const DOC_PREFIX = "lipu-sitelen-wawa:doc:";
const LEGACY_KEY = "lipu-sitelen-wawa:doc";

export interface DocEntry {
  id: string;
  name: string;
  updatedAt: number;
}

export function loadIndex(): DocEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as DocEntry[];
      }
    }
  } catch {
    // corrupt data
  }
  return [];
}

export function saveIndex(
  entries: DocEntry[]
): void {
  localStorage.setItem(
    INDEX_KEY,
    JSON.stringify(entries)
  );
}

export function loadDocContent(
  id: string
): JSONContent | undefined {
  try {
    const raw = localStorage.getItem(
      DOC_PREFIX + id
    );
    if (raw) {
      return JSON.parse(raw) as JSONContent;
    }
  } catch {
    // corrupt data
  }
}

export function saveDocContent(
  id: string,
  content: JSONContent
): void {
  localStorage.setItem(
    DOC_PREFIX + id,
    JSON.stringify(content)
  );
}

export function removeDoc(id: string): void {
  const index = loadIndex().filter(
    (e) => e.id !== id
  );
  saveIndex(index);
  localStorage.removeItem(DOC_PREFIX + id);
}

export function getActiveDocId():
  string | null
{
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveDocId(
  id: string
): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function createDoc(): DocEntry {
  const entry: DocEntry = {
    id: crypto.randomUUID(),
    name: "",
    updatedAt: Date.now(),
  };
  const index = loadIndex();
  index.unshift(entry);
  saveIndex(index);
  return entry;
}

export function getFirstLineText(
  content: JSONContent
): string {
  if (!content.content) return "";

  const firstBlock = content.content[0];
  if (!firstBlock || !firstBlock.content) {
    return "";
  }

  return firstBlock.content
    .filter(
      (node) =>
        node.type === "text" && node.text
    )
    .map((node) => node.text!)
    .join("");
}

export function migrate(): void {
  // No-op if index already exists
  if (loadIndex().length > 0) return;

  // No-op if no legacy key
  let legacyContent: JSONContent | undefined;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    legacyContent =
      JSON.parse(raw) as JSONContent;
  } catch {
    // corrupt legacy data; remove and start fresh
    localStorage.removeItem(LEGACY_KEY);
    return;
  }

  const entry: DocEntry = {
    id: crypto.randomUUID(),
    name: getFirstLineText(legacyContent),
    updatedAt: Date.now(),
  };

  saveIndex([entry]);
  saveDocContent(entry.id, legacyContent);
  setActiveDocId(entry.id);
  localStorage.removeItem(LEGACY_KEY);
}
