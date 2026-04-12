"use client";

import { useRef, useState } from "react";
import type { AnalysisInput } from "@/lib/types";

type Tab = "files" | "text";

interface FileEntry {
  id: string;
  file: File;
  kind: "image" | "pdf" | "docx";
  previewUrl?: string;
}

interface InputSelectorProps {
  onSubmit: (inputs: AnalysisInput[]) => void;
  disabled?: boolean;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_DOCX_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 10;
const MAX_TEXT_LENGTH = 15_000;

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function InputSelector({
  onSubmit,
  disabled,
}: InputSelectorProps) {
  const [tab, setTab] = useState<Tab>("files");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(files: FileList | File[]) {
    setError(null);
    const incoming = Array.from(files);
    const valid: FileEntry[] = [];

    for (const file of incoming) {
      const lower = file.name.toLowerCase();
      const isLegacyDoc =
        file.type === "application/msword" ||
        (lower.endsWith(".doc") && !lower.endsWith(".docx"));
      if (isLegacyDoc) {
        setError("Gammelt Word (.doc) støttes ikke — lagre som .docx.");
        continue;
      }

      const isImage = file.type.startsWith("image/");
      const isPdf =
        file.type === "application/pdf" || lower.endsWith(".pdf");
      const isDocx =
        lower.endsWith(".docx") ||
        file.type.includes("wordprocessingml.document");

      if (isImage) {
        if (file.size > MAX_IMAGE_BYTES) {
          setError("Noen filer ble hoppet over — maks 8 MB per bilde.");
          continue;
        }
        valid.push({
          id: newId(),
          file,
          kind: "image",
          previewUrl: URL.createObjectURL(file),
        });
      } else if (isPdf) {
        if (file.size > MAX_PDF_BYTES) {
          setError("Noen filer ble hoppet over — maks 12 MB per PDF.");
          continue;
        }
        valid.push({ id: newId(), file, kind: "pdf" });
      } else if (isDocx) {
        if (file.size > MAX_DOCX_BYTES) {
          setError("Noen filer ble hoppet over — maks 12 MB per Word-fil.");
          continue;
        }
        valid.push({ id: newId(), file, kind: "docx" });
      } else {
        setError("Noen filer ble hoppet over — kun bilder, PDF og .docx.");
      }
    }

    setEntries((prev) => {
      const combined = [...prev, ...valid];
      if (combined.length > MAX_FILES) {
        setError(`Maks ${MAX_FILES} filer om gangen.`);
        return combined.slice(0, MAX_FILES);
      }
      return combined;
    });
  }

  function removeEntry(index: number) {
    setEntries((prev) => {
      const e = prev[index];
      if (e?.previewUrl) URL.revokeObjectURL(e.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function handleSubmit() {
    setError(null);

    if (tab === "files") {
      if (entries.length === 0) {
        setError("Velg minst én fil (bilde, PDF eller Word).");
        return;
      }
      const inputs: AnalysisInput[] = entries.map((e) => {
        if (e.kind === "pdf") return { type: "pdf", file: e.file };
        if (e.kind === "docx") return { type: "docx", file: e.file };
        return { type: "image", file: e.file };
      });
      onSubmit(inputs);
      entries.forEach((e) => {
        if (e.previewUrl) URL.revokeObjectURL(e.previewUrl);
      });
      setEntries([]);
    } else {
      const trimmed = text.trim();
      if (!trimmed) {
        setError("Skriv eller lim inn tekst for å analysere.");
        return;
      }
      if (trimmed.length > MAX_TEXT_LENGTH) {
        setError(
          `Teksten er for lang. Maks ${MAX_TEXT_LENGTH.toLocaleString("nb-NO")} tegn.`
        );
        return;
      }
      onSubmit([{ type: "text", text: trimmed }]);
      setText("");
    }

    if (inputRef.current) inputRef.current.value = "";
  }

  const canSubmit =
    !disabled &&
    (tab === "files" ? entries.length > 0 : text.trim().length > 0);

  const pdfCount = entries.filter((e) => e.kind === "pdf").length;
  const docxCount = entries.filter((e) => e.kind === "docx").length;
  const imgCount = entries.filter((e) => e.kind === "image").length;

  return (
    <div className="w-full">
      <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1">
        <TabButton
          active={tab === "files"}
          onClick={() => setTab("files")}
          disabled={disabled}
        >
          Filer
        </TabButton>
        <TabButton
          active={tab === "text"}
          onClick={() => setTab("text")}
          disabled={disabled}
        >
          Tekst
        </TabButton>
      </div>

      {tab === "files" ? (
        <div className="space-y-3">
          <div
            onClick={() => !disabled && inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!disabled) addFiles(e.dataTransfer.files);
            }}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-colors ${
              disabled
                ? "cursor-not-allowed border-gray-200 bg-gray-50 opacity-60"
                : "cursor-pointer border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="mb-2 h-8 w-8 text-gray-400"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
              />
            </svg>
            <p className="text-sm font-medium text-gray-700">
              Klikk for å velge filer, eller dra og slipp
            </p>
            <p className="mt-1 text-center text-xs text-gray-500">
              Bilder, PDF eller Word (.docx) — opptil {MAX_FILES} filer · maks 8
              MB bilde / 12 MB dokument
            </p>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            disabled={disabled}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
            }}
          />

          {entries.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {entries.map((e, i) => (
                <div key={e.id} className="group relative w-[88px]">
                  {e.kind === "image" && e.previewUrl ? (
                    <img
                      src={e.previewUrl}
                      alt={e.file.name}
                      className="h-20 w-20 rounded-lg border border-gray-200 object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-gray-500">
                      {e.kind === "docx" ? (
                        <>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            className="h-8 w-8 text-blue-600"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                            />
                          </svg>
                          <span className="mt-0.5 text-[9px] font-medium uppercase text-blue-700">
                            DOCX
                          </span>
                        </>
                      ) : (
                        <>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="h-8 w-8"
                          >
                            <path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-.59-1.41l-4-4A2 2 0 0 0 14 2H6Zm8 2.41L17.59 8H14a2 2 0 0 1-2-2V4.41ZM8 12h8a1 1 0 0 1 0 2H8a1 1 0 0 1 0-2Zm0 4h6a1 1 0 0 1 0 2H8a1 1 0 0 1 0-2Z" />
                          </svg>
                          <span className="mt-0.5 text-[9px] font-medium uppercase">
                            PDF
                          </span>
                        </>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeEntry(i)}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    &times;
                  </button>
                  <p className="mt-0.5 max-w-[88px] truncate text-[10px] text-gray-400">
                    {e.file.name}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          disabled={disabled}
          placeholder="Lim inn eller skriv teksten du vil analysere..."
          rows={6}
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 transition-colors placeholder:text-gray-400 focus:border-gray-500 focus:outline-none disabled:opacity-60"
        />
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="mt-4 w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {tab === "files" && entries.length > 1
          ? `Analyser ${entries.length} filer`
          : tab === "files" && entries.length === 1
            ? entries[0]?.kind === "pdf"
              ? "Analyser PDF"
              : entries[0]?.kind === "docx"
                ? "Analyser Word"
                : "Analyser bilde"
            : "Analyser"}
      </button>

      {tab === "files" && entries.length > 0 && (
        <p className="mt-2 text-center text-[11px] text-gray-400">
          {imgCount > 0 && `${imgCount} bilde${imgCount !== 1 ? "r" : ""}`}
          {imgCount > 0 && (pdfCount > 0 || docxCount > 0) && " · "}
          {pdfCount > 0 && `${pdfCount} PDF`}
          {pdfCount > 0 && docxCount > 0 && " · "}
          {docxCount > 0 && `${docxCount} Word`}
        </p>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-white text-gray-900 shadow-sm"
          : "text-gray-500 hover:text-gray-700"
      } disabled:opacity-60`}
    >
      {children}
    </button>
  );
}
