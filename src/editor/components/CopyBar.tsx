import React, {
  useCallback,
  useState,
  useRef,
} from "react";
import { Editor } from "@tiptap/core";
import { useDocumentExport } from "../hooks";

interface CopyBarProps {
  editor: Editor | null;
}

function useCopyWithFlash() {
  const [copied, setCopied] = useState<
    string | null
  >(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const copy = useCallback(
    (text: string, label: string) => {
      navigator.clipboard.writeText(text);
      setCopied(label);
      clearTimeout(timer.current);
      timer.current = setTimeout(
        () => setCopied(null),
        1500
      );
    },
    []
  );

  return { copied, copy };
}

export function CopyBar({ editor }: CopyBarProps) {
  const { latin, ucsur } = useDocumentExport(editor);
  const { copied, copy } = useCopyWithFlash();

  const copyLatin = useCallback(
    () => copy(latin, "latin"),
    [latin, copy]
  );
  const copyUcsur = useCallback(
    () => copy(ucsur, "ucsur"),
    [ucsur, copy]
  );

  return (
    <div className="copy-bar">
      <button
        type="button"
        className={
          "copy-bar__button" +
          (copied === "latin"
            ? " copy-bar__button--copied"
            : "")
        }
        onClick={copyLatin}
      >
        {copied === "latin"
          ? "Copied!"
          : "Copy as Latin"}
      </button>
      <button
        type="button"
        className={
          "copy-bar__button" +
          (copied === "ucsur"
            ? " copy-bar__button--copied"
            : "")
        }
        onClick={copyUcsur}
      >
        {copied === "ucsur"
          ? "Copied!"
          : "Copy as UCSUR"}
      </button>
    </div>
  );
}
