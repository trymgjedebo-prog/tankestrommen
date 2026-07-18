/**
 * Ren normalisering av rå `schoolDayOperationSignals` (strukturerte dagsoperasjoner) fra modellen.
 * Deterministisk og bivirkningsfri. Additivt felt: begge prompt-flytene ber om det, og
 * `buildSchoolBlockProposal` konsumerer det til `dayOperation`/`dayResolution`. Kontrakt:
 *  - VALIDER og KANONISER kun modellens strukturerte output — aldri tolke fritekst
 *  - aldri inferere operation, dato, tid eller activityKind
 *  - dropp en oppføring som mangler gyldig operation, gyldig dagsscope eller påkrevd tid
 *  - motstridende gyldige signaler for samme dag beholdes BEGGE (builderen markerer konflikt)
 *  - identiske normaliserte oppføringer dedupliseres; input muteres aldri
 *
 * Gjenbruker de delte, rene helperne (school-date, school-time, school-weekday) — ingen parallell
 * dato-/ukedags-/tidskonvertering. Speiler arkitekturen i `class-schedule-normalize.ts`.
 */
import type {
  SchoolBlockActivityKind,
  SchoolDayOperationSignal,
  SchoolProfileWeekdayIndex,
} from "@/lib/types";
import { normalizeSchoolDateToIso } from "@/lib/school-date";
import { normalizeSchoolTime } from "@/lib/school-time";
import {
  normalizeSchoolWeekdayIndex,
  schoolWeekdayIndexFromIsoDate,
} from "@/lib/school-weekday";

/** Trim til ikke-tom streng, ellers null. */
function trimToNull(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** Clamp til 0–1. Manglende/NaN/ugyldig → 0 (samme confidence-strategi som class-schedule). */
function clamp01(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

const OPERATIONS = new Set(["adjust_start", "adjust_end", "replace_day"]);
const ACTIVITY_KINDS = new Set<SchoolBlockActivityKind>([
  "exam_day",
  "trip_day",
  "activity_day",
  "free_day",
  "other",
]);

/**
 * Normaliser dagsscope. Godtar en oppføring bare når minst én av: gyldig ISO-dato, gyldig
 * mandag–fredag-ukedag, eller ikke-tom dayLabel kan normaliseres. Når BÅDE dato og weekdayIndex
 * finnes, må de peke på samme ukedag — ellers droppes oppføringen (ingen automatisk korreksjon).
 */
function normalizeDayScope(o: Record<string, unknown>):
  | { date: string | null; weekdayIndex: SchoolProfileWeekdayIndex | null; dayLabel: string | null }
  | null {
  const date = normalizeSchoolDateToIso(typeof o.date === "string" ? o.date : null);
  const weekdayIndex = normalizeSchoolWeekdayIndex(
    typeof o.weekdayIndex === "string" ? o.weekdayIndex : null,
  );
  const dayLabel = trimToNull(o.dayLabel);

  // Dato + weekdayIndex må være konsistente (uten auto-korreksjon). Helgedato → ingen mandag–
  // fredag-indeks, så en samtidig weekdayIndex er per definisjon inkonsistent → dropp.
  if (date !== null && weekdayIndex !== null) {
    const isoWeekday = schoolWeekdayIndexFromIsoDate(date);
    if (isoWeekday === null || isoWeekday !== weekdayIndex) return null;
  }

  const hasScope = date !== null || weekdayIndex !== null || dayLabel !== null;
  if (!hasScope) return null;
  return { date, weekdayIndex, dayLabel };
}

/** Normaliser én rå oppføring til et gyldig signal, eller `null` når den må droppes. */
function normalizeSignal(row: unknown): SchoolDayOperationSignal | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;

  const operation = o.operation;
  if (typeof operation !== "string" || !OPERATIONS.has(operation)) return null;

  const scope = normalizeDayScope(o);
  if (!scope) return null;

  const sourceText = trimToNull(o.sourceText);
  if (sourceText === null) return null; // sourceText er påkrevd evidens

  const reason = trimToNull(o.reason);
  const confidence = clamp01(o.confidence);
  const base = {
    date: scope.date,
    weekdayIndex: scope.weekdayIndex,
    dayLabel: scope.dayLabel,
    reason,
    sourceText,
    confidence,
  } as const;

  if (operation === "adjust_start") {
    const effectiveStart = normalizeSchoolTime(
      typeof o.effectiveStart === "string" ? o.effectiveStart : null,
    );
    if (effectiveStart === null) return null; // uten gyldig start → dropp (konstruer aldri)
    return { ...base, operation: "adjust_start", effectiveStart };
  }

  if (operation === "adjust_end") {
    const effectiveEnd = normalizeSchoolTime(
      typeof o.effectiveEnd === "string" ? o.effectiveEnd : null,
    );
    if (effectiveEnd === null) return null; // uten gyldig slutt → dropp (konstruer aldri)
    return { ...base, operation: "adjust_end", effectiveEnd };
  }

  // replace_day
  const activityKind = o.activityKind;
  if (
    typeof activityKind !== "string" ||
    !ACTIVITY_KINDS.has(activityKind as SchoolBlockActivityKind)
  ) {
    return null; // ugyldig/manglende activityKind → dropp (inferer aldri)
  }
  // Nullable tider beholdes; ugyldig eksplisitt tid repareres ikke — den blir null.
  const effectiveStart = normalizeSchoolTime(
    typeof o.effectiveStart === "string" ? o.effectiveStart : null,
  );
  const effectiveEnd = normalizeSchoolTime(
    typeof o.effectiveEnd === "string" ? o.effectiveEnd : null,
  );
  return {
    ...base,
    operation: "replace_day",
    activityKind: activityKind as SchoolBlockActivityKind,
    effectiveStart,
    effectiveEnd,
  };
}

/**
 * Kanonisk, deterministisk serialisering brukt både til dedup OG sortering. Feltrekkefølgen er
 * eksplisitt og stabil, så sammenligningen er rekkefølge-/locale-uavhengig og identisk på tvers
 * av kjøringer. Motstridende signaler for samme dag gir ulik nøkkel → begge beholdes.
 */
function canonicalKey(s: SchoolDayOperationSignal): string {
  return JSON.stringify([
    s.operation,
    s.date,
    s.weekdayIndex,
    s.dayLabel,
    s.operation === "adjust_start" ? s.effectiveStart : null,
    s.operation === "adjust_end" ? s.effectiveEnd : null,
    s.operation === "replace_day" ? s.activityKind : null,
    s.operation === "replace_day" ? s.effectiveStart : null,
    s.operation === "replace_day" ? s.effectiveEnd : null,
    s.reason,
    s.sourceText,
    s.confidence,
  ]);
}

/**
 * Normaliser rå `schoolDayOperationSignals`. Returnerer en ikke-tom liste eller `undefined`.
 * Dedupliserer KUN helt identiske normaliserte oppføringer og sorterer den ferdige lista på den
 * kanoniske nøkkelen → semantisk identiske råsett gir samme output uansett inputrekkefølge.
 * Motstridende signaler gir ulik nøkkel → begge beholdes (builderen avgjør konflikt).
 */
export function normalizeSchoolDayOperationSignalsRaw(
  raw: unknown,
): SchoolDayOperationSignal[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const keyed: Array<{ key: string; signal: SchoolDayOperationSignal }> = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const signal = normalizeSignal(row);
    if (!signal) continue;
    const key = canonicalKey(signal);
    if (seen.has(key)) continue; // helt identiske → dedup; ulik payload → ulik nøkkel → beholdes
    seen.add(key);
    keyed.push({ key, signal });
  }
  if (keyed.length === 0) return undefined;
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return keyed.map((x) => x.signal);
}
