/**
 * ÉN definisjon av de alternative fremmedspråk-sporene (tysk/spansk/fransk) og reglene rundt dem.
 * Deles av overlay-projeksjonen (`resolveLanguageTrack` i route) og den kanoniske adapteren, slik
 * at "hvilke fag er et valgbart språkspor" og "matcher dette barnets spor" har én kilde.
 *
 * Ren: ingen Next.js/OpenAI/env/nettverk/sideeffekter. Kun rene domeneprimitiver.
 */

/** Fremmedspråk-sporene en elev velger MELLOM (nøyaktig ett per elev). Rekkefølge er stabil. */
export const LANGUAGE_TRACK_SUBJECT_KEYS = ["tysk", "spansk", "fransk"] as const;

export type LanguageTrackSubjectKey = (typeof LANGUAGE_TRACK_SUBJECT_KEYS)[number];

const LANGUAGE_TRACK_SET: ReadonlySet<string> = new Set(LANGUAGE_TRACK_SUBJECT_KEYS);

/** Er `subjectKey` ett av de alternative språksporene (og dermed elev-spesifikt, ikke felles)? */
export function isLanguageTrackSubjectKey(subjectKey: string | null | undefined): boolean {
  return typeof subjectKey === "string" && LANGUAGE_TRACK_SET.has(subjectKey);
}
