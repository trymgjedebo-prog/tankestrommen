/**
 * Ren normalisering av rå `classScheduleEntries` (strukturert klasse-/puljeplan) fra modellen.
 * Deterministisk og bivirkningsfri. Additivt/inert felt: ingen prompt emitterer det ennå, og
 * ingen runtime konsumerer det (buildSchoolBlockProposal kommer senere). Kontrakt:
 *  - dropp oppføringer uten minst én gyldig klassekode, eller uten meningsfull payload
 *  - aldri gjett/konstruer tid, dato eller vinner ved konflikt
 *  - motstridende tider for samme klasse/aktivitet beholdes BEGGE (review skjer i produsenten)
 *  - bevar originaltekst; ugyldige verdier → null (confidence → 0)
 *
 * Gjenbruker delte helpere (school-class-schedule, portal-week-year). Klokke-/rom-/tekst-/
 * confidence-normalisering er små lokale rene helpere for å holde regresjonsflaten minimal
 * (unngår å eksportere lokale analyze-image.ts-helpere).
 */
import type { ClassScheduleEntry } from "@/lib/types";
import { extractClassCodes, normalizeClassCode } from "@/lib/school-class-schedule";
import { isoWeekdayOfYmd } from "@/lib/portal-week-year";

/** Trim til ikke-tom streng, ellers null. */
function trimToNull(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** Normaliser gyldig HH:MM / HH.MM (og bar time) til «HH:MM». Ugyldig → null. Konstruerer aldri. */
function normalizeClock(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\./g, ":");
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${m[2]}`;
  }
  const bare = /^(\d{1,2})$/.exec(t);
  if (bare) {
    const h = Number(bare[1]);
    if (h > 23) return null;
    return `${String(h).padStart(2, "0")}:00`;
  }
  return null;
}

/** Godta kun gyldig ISO-kalenderdato YYYY-MM-DD. Ugyldig (feil format ELLER f.eks. 30. feb) → null. */
function normalizeIsoDate(raw: unknown): string | null {
  const s = trimToNull(raw);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  if (isoWeekdayOfYmd(Number(m[1]), Number(m[2]), Number(m[3])) === null) return null;
  return s;
}

/** Samme trygge rom-prefiks-strip som ClassLocation («rom »/«klasserom »). Tom → null. */
function normalizeRoom(raw: unknown): string | null {
  const s = trimToNull(raw);
  if (!s) return null;
  const stripped = s.replace(/^(?:klasserom|rom)\b\s*/i, "").trim();
  return stripped || null;
}

/** Clamp til 0–1. Manglende/NaN/ugyldig → 0 (ingen optimistisk standardverdi). */
function clamp01(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Normaliser `classCodes`: kun strenger, hver nøyaktig ÉN ekte klassekode (puljenavn/søppel
 * droppes), dedupliser på normalisert nøkkel, sorter deterministisk. Rekkefølge-uavhengig.
 */
function normalizeClassCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of raw) {
    if (typeof c !== "string") continue;
    const trimmed = c.trim();
    if (!trimmed) continue;
    if (extractClassCodes(trimmed).length !== 1) continue; // ikke puljenavn / flere koder / søppel
    const key = normalizeClassCode(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  out.sort((a, b) => {
    const ka = normalizeClassCode(a);
    const kb = normalizeClassCode(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out;
}

function normalizeEntry(row: unknown): ClassScheduleEntry | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;

  const classCodes = normalizeClassCodes(o.classCodes);
  if (classCodes.length === 0) return null; // krav: minst én gyldig klassekode

  const entry: ClassScheduleEntry = {
    date: normalizeIsoDate(o.date),
    dayLabel: trimToNull(o.dayLabel),
    activityTitle: trimToNull(o.activityTitle),
    classCodes,
    groupLabel: trimToNull(o.groupLabel),
    start: normalizeClock(o.start),
    end: normalizeClock(o.end),
    room: normalizeRoom(o.room),
    teacher: trimToNull(o.teacher),
    sourceText: trimToNull(o.sourceText),
    confidence: clamp01(o.confidence),
  };

  // Krav: minst ett meningsfullt innholdsfelt utover klassekodene (confidence teller ikke).
  const hasPayload =
    entry.date !== null ||
    entry.dayLabel !== null ||
    entry.activityTitle !== null ||
    entry.groupLabel !== null ||
    entry.start !== null ||
    entry.end !== null ||
    entry.room !== null ||
    entry.teacher !== null ||
    entry.sourceText !== null;
  if (!hasPayload) return null;

  return entry;
}

/**
 * Kanonisk, deterministisk serialisering brukt både til dedup OG sortering. Feltrekkefølgen er
 * eksplisitt og stabil (samme som ClassScheduleEntry-literalet: date, dayLabel, activityTitle,
 * classCodes[sortert], groupLabel, start, end, room, teacher, sourceText, confidence), så
 * sammenligningen er rekkefølge-/locale-uavhengig og identisk på tvers av kjøringer.
 */
function canonicalKey(entry: ClassScheduleEntry): string {
  return JSON.stringify([
    entry.date,
    entry.dayLabel,
    entry.activityTitle,
    entry.classCodes,
    entry.groupLabel,
    entry.start,
    entry.end,
    entry.room,
    entry.teacher,
    entry.sourceText,
    entry.confidence,
  ]);
}

/**
 * Normaliser rå `classScheduleEntries`. Returnerer en ikke-tom liste eller `undefined`.
 * Dedupliserer KUN helt identiske normaliserte oppføringer og sorterer den ferdige lista på
 * den kanoniske nøkkelen → semantisk identiske råsett gir samme output uansett inputrekkefølge.
 * Motstridende tider gir ulik nøkkel → begge beholdes (ingen vinner velges).
 */
export function normalizeClassScheduleEntriesRaw(
  raw: unknown,
): ClassScheduleEntry[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const keyed: Array<{ key: string; entry: ClassScheduleEntry }> = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const entry = normalizeEntry(row);
    if (!entry) continue;
    const key = canonicalKey(entry);
    if (seen.has(key)) continue; // helt identiske → dedup; ulik tid → ulik nøkkel → beholdes
    seen.add(key);
    keyed.push({ key, entry });
  }
  if (keyed.length === 0) return undefined;
  // Deterministisk, ikke-locale-avhengig sortering på kanonisk nøkkel (etter full normalisering).
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return keyed.map((x) => x.entry);
}
