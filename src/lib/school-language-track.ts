/**
 * ÉN definisjon av de alternative fremmedspråk-sporene (tysk/spansk/fransk) og reglene rundt dem:
 * både språksporlisten, subject-key-predikatet OG dokument-resolveren
 * (`resolveSchoolLanguageTrack`). Deles av overlay-projeksjonen (route) og den kanoniske adapteren,
 * slik at "hvilke fag er et valgbart språkspor", "matcher dette barnets spor" og "hvilket spor
 * gjelder dokumentet" har én kilde.
 *
 * Ren: ingen Next.js/OpenAI/env/nettverk/tid/tilfeldighet/sideeffekter. Kun rene domeneprimitiver.
 */
import type { AIAnalysisResult, SchoolWeekOverlayProposal } from "@/lib/types";

/** Fremmedspråk-sporene en elev velger MELLOM (nøyaktig ett per elev). Rekkefølge er stabil. */
export const LANGUAGE_TRACK_SUBJECT_KEYS = ["tysk", "spansk", "fransk"] as const;

export type LanguageTrackSubjectKey = (typeof LANGUAGE_TRACK_SUBJECT_KEYS)[number];

const LANGUAGE_TRACK_SET: ReadonlySet<string> = new Set(LANGUAGE_TRACK_SUBJECT_KEYS);

/** Er `subjectKey` ett av de alternative språksporene (og dermed elev-spesifikt, ikke felles)? */
export function isLanguageTrackSubjectKey(subjectKey: string | null | undefined): boolean {
  return typeof subjectKey === "string" && LANGUAGE_TRACK_SET.has(subjectKey);
}

/**
 * Det besluttede språksporresultatet for et dokument — samme objektform som overlayens
 * `languageTrack` (én semantikk, ikke en ny variant). Canonical-pipelinen mottar dette EKSPLISITT
 * i stedet for hele `SchoolWeekOverlayProposal`, slik at replay kan levere resultatet fra
 * `resolveSchoolLanguageTrack` direkte uten å bygge et kunstig overlay-proposal.
 */
export type SchoolLanguageTrackResolution = SchoolWeekOverlayProposal["languageTrack"];

/** Privat kopi (repo-konvensjon, identisk med de øvrige): små bokstaver + å→a, ø→o, æ→e. */
function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

/**
 * Løs dokumentets språkspor fra title + description + scheduleByDay[].details (mekanisk flyttet fra
 * route.ts' `resolveLanguageTrack`; semantikk, confidence og reason-verdier er uendret):
 * nøyaktig ett spor-token → resolvedTrack; flere → null (multiple_tracks_detected);
 * ingen → null (no_track_detected). Muterer aldri input.
 */
export function resolveSchoolLanguageTrack(
  result: AIAnalysisResult,
): SchoolWeekOverlayProposal["languageTrack"] {
  const text = normalizeNorwegianLetters(
    [result.title, result.description, ...result.scheduleByDay.map((d) => d.details ?? "")]
      .filter(Boolean)
      .join(" "),
  );
  const tracks = LANGUAGE_TRACK_SUBJECT_KEYS.filter((k) => new RegExp(`\\b${k}\\b`).test(text));
  if (tracks.length === 1) {
    return { resolvedTrack: tracks[0], confidence: 0.8, reason: "single_track_detected" };
  }
  if (tracks.length > 1) {
    return { resolvedTrack: null, confidence: 0.45, reason: "multiple_tracks_detected" };
  }
  return { resolvedTrack: null, confidence: 0.35, reason: "no_track_detected" };
}
