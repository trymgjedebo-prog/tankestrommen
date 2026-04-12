"use client";

import { useState } from "react";
import InputSelector from "@/components/tankestrommen/InputSelector";
import AnalysisResult from "@/components/tankestrommen/AnalysisResult";
import EditableResult from "@/components/tankestrommen/EditableResult";
import ConfirmedHistory from "@/components/tankestrommen/ConfirmedHistory";
import { useAnalysis } from "@/hooks/useAnalysis";
import { useHistory } from "@/hooks/useHistory";
import { toProposedEvent } from "@/lib/helpers";
import type { AnalysisInput, ProposedEvent } from "@/lib/types";

export default function Home() {
  const { results, loading, error, progress, analyzeAll, reset } =
    useAnalysis();
  const { history, add: addToHistory, clear: clearHistory } = useHistory();
  const [reviewIndex, setReviewIndex] = useState(0);

  async function handleSubmit(inputs: AnalysisInput[]) {
    setReviewIndex(0);
    await analyzeAll(inputs);
  }

  const currentResult = results[reviewIndex] ?? null;
  const hasMoreResults = reviewIndex < results.length - 1;
  const isReviewing = results.length > 0 && !loading;

  function advance() {
    if (hasMoreResults) {
      setReviewIndex((i) => i + 1);
    } else {
      reset();
      setReviewIndex(0);
    }
  }

  function handleConfirm(event: ProposedEvent) {
    addToHistory({ ...event, confirmedAt: new Date().toISOString() });
    advance();
  }

  function handleDiscard() {
    advance();
  }

  function handleCancelReview() {
    reset();
    setReviewIndex(0);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center gap-8 px-6 py-16">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Tankestrømmen
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Last opp bilder, PDF, Word (.docx) eller lim inn tekst — Tankestrømmen
          finner arrangementer, frister, beskjeder og annen viktig informasjon,
          strukturert og klart for deg.
        </p>
      </div>

      {!isReviewing && (
        <InputSelector onSubmit={handleSubmit} disabled={loading} />
      )}

      {loading && progress && (
        <div className="w-full rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-center gap-3">
            <svg
              className="h-5 w-5 animate-spin text-gray-500"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <p className="text-sm text-gray-600">
              {progress.total === 1
                ? "Analyserer ..."
                : `Analyserer ${progress.current} av ${progress.total} ...`}
            </p>
          </div>
          {progress.total > 1 && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-gray-400 transition-all duration-300"
                style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="w-full rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="whitespace-pre-line text-sm text-red-700">{error}</p>
        </div>
      )}

      {isReviewing && currentResult && (
        <>
          {results.length > 1 && (
            <div className="flex w-full items-center justify-between">
              <p className="text-sm font-medium text-gray-500">
                Resultat {reviewIndex + 1} av {results.length}
              </p>
              <button
                type="button"
                onClick={handleCancelReview}
                className="rounded-md px-2 py-1 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                Avbryt gjennomgang
              </button>
            </div>
          )}

          <AnalysisResult result={currentResult} />
          <EditableResult
            key={currentResult.title + reviewIndex}
            initial={toProposedEvent(currentResult)}
            onConfirm={handleConfirm}
            onDiscard={handleDiscard}
          />
        </>
      )}

      <ConfirmedHistory history={history} onClear={clearHistory} />
    </main>
  );
}
