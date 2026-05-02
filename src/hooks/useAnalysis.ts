"use client";

import { useState, useRef, useCallback } from "react";
import type { AnalysisInput, AIAnalysisResult } from "@/lib/types";
import { fileToBase64 } from "@/lib/helpers";

export interface AnalysisProgress {
  current: number;
  total: number;
}

function attachLocalSourceHint(
  result: AIAnalysisResult,
  input: AnalysisInput,
  fileUrl: string | null
): AIAnalysisResult {
  if (!fileUrl || input.type === "text") return result;

  if (input.type === "image") {
    return {
      ...result,
      sourceHint: {
        type: "image",
        fileName: input.file.name,
        fileUrl,
      },
    };
  }

  if (result.sourceHint?.type === "pdf" || result.sourceHint?.type === "docx") {
    return {
      ...result,
      sourceHint: {
        ...result.sourceHint,
        fileUrl,
      },
    };
  }

  return result;
}

interface UseAnalysisReturn {
  results: AIAnalysisResult[];
  loading: boolean;
  error: string | null;
  progress: AnalysisProgress | null;
  analyzeAll: (inputs: AnalysisInput[]) => Promise<void>;
  reset: () => void;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_DOCX_BYTES = 12 * 1024 * 1024;

function inputLabel(input: AnalysisInput, index: number): string {
  if (input.type === "image") return `Bilde ${index + 1}`;
  if (input.type === "pdf") return `PDF ${index + 1}`;
  if (input.type === "docx") return `Word ${index + 1}`;
  return "Tekst";
}

async function analyzeOne(input: AnalysisInput): Promise<AIAnalysisResult> {
  let body: Record<string, string>;

  if (input.type === "image") {
    if (!input.file.type.startsWith("image/")) {
      throw new Error("Ugyldig filtype. Forventet bilde.");
    }
    if (input.file.size > MAX_IMAGE_BYTES) {
      throw new Error("Bildet er for stort. Maks 8 MB.");
    }
    const base64 = await fileToBase64(input.file);
    body = { image: base64 };
  } else if (input.type === "pdf") {
    const isPdf =
      input.file.type === "application/pdf" ||
      input.file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      throw new Error("Ugyldig fil. Forventet PDF.");
    }
    if (input.file.size > MAX_PDF_BYTES) {
      throw new Error("PDF-filen er for stor. Maks 12 MB.");
    }
    const base64 = await fileToBase64(input.file);
    body = { pdf: base64, fileName: input.file.name };
  } else if (input.type === "docx") {
    const name = input.file.name.toLowerCase();
    if (input.file.type === "application/msword") {
      throw new Error("Gammelt .doc støttes ikke. Lagre som .docx.");
    }
    const isDocx =
      name.endsWith(".docx") ||
      input.file.type.includes("wordprocessingml.document");
    if (!isDocx) {
      throw new Error("Ugyldig fil. Forventet Word (.docx).");
    }
    if (input.file.size > MAX_DOCX_BYTES) {
      throw new Error("Word-filen er for stor. Maks 12 MB.");
    }
    const base64 = await fileToBase64(input.file);
    body = { docx: base64, fileName: input.file.name };
  } else {
    body = { text: input.text };
  }

  /** `format=raw` beholder rå `AIAnalysisResult`; uten det får JSON-tekst portal-bundle som Foreldre-App. */
  const response = await fetch("/api/analyze?format=raw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? `Feil fra server (${response.status})`);
  }

  return (await response.json()) as AIAnalysisResult;
}

export function useAnalysis(): UseAnalysisReturn {
  const [results, setResults] = useState<AIAnalysisResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const abortRef = useRef(false);
  const objectUrlsRef = useRef<string[]>([]);

  const analyzeAll = useCallback(async (inputs: AnalysisInput[]) => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];

    setLoading(true);
    setError(null);
    setResults([]);
    setProgress({ current: 0, total: inputs.length });
    abortRef.current = false;

    const collected: AIAnalysisResult[] = [];
    const errors: string[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (abortRef.current) break;
      setProgress({ current: i + 1, total: inputs.length });

      try {
        const input = inputs[i];
        const fileUrl =
          input.type === "text" ? null : URL.createObjectURL(input.file);
        if (fileUrl) objectUrlsRef.current.push(fileUrl);

        const result = await analyzeOne(input);
        collected.push(attachLocalSourceHint(result, input, fileUrl));
      } catch (err) {
        const label = inputLabel(inputs[i], i);
        const msg =
          err instanceof TypeError
            ? "Kunne ikke kontakte serveren."
            : err instanceof Error
              ? err.message
              : "Ukjent feil";
        errors.push(`${label}: ${msg}`);
      }
    }

    setResults(collected);
    if (errors.length > 0 && collected.length === 0) {
      setError(errors.join("\n"));
    } else if (errors.length > 0) {
      setError(`${errors.length} av ${inputs.length} feilet. ${errors[0]}`);
    }
    setProgress(null);
    setLoading(false);
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
    setResults([]);
    setError(null);
    setLoading(false);
    setProgress(null);
  }, []);

  return { results, loading, error, progress, analyzeAll, reset };
}
