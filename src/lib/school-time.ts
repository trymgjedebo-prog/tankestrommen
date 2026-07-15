/**
 * Delte, rene tidshjelpere for skoledata (HH:MM). Ingen klokke, ingen randomness, ingen
 * fritekst-/datotolkning — hjelperne bearbeider KUN klokkeslettstrengen de mottar.
 *
 * `normalizeSchoolTime` og `schoolMinutesToTime` er semantisk uendrede flyttinger av
 * `normalizeHHMM` / `minutesToHHMM` fra `analyze-image.ts`. `schoolTimeToMinutes` og
 * `schoolTimeRangesOverlap` er nye, rene helpere til den senere `buildSchoolBlockProposal`
 * (bl.a. `subjectCandidates`-overlapp) — de avgjør ALDRI om en aktivitet er sann, kun
 * geometrisk overlapp mellom to tidsintervaller.
 *
 * NB: `analyze-image.ts` sin private `hhmmToMinutes` og `activity-duration.ts` sine
 * `hhmmToMinutes`/`minutesToHhmm` har ANNEN semantikk (henholdsvis ingen range-validering
 * og modulo-wrap) og flyttes bevisst IKKE i dette steget.
 */

/**
 * Normaliser et klokkeslett til `HH:MM`. Semantisk identisk med `normalizeHHMM`:
 * trimmer, godtar punktumformat (`10.30` → `10:30`), 1–2-sifret time (`9` → `09:00`),
 * avviser time > 23 / minutt > 59, og returnerer `null` for ugyldig/manglende verdi.
 * Konstruerer ALDRI tid fra fritekst og tolker ALDRI datoer.
 */
export function normalizeSchoolTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/\./g, ":");
  const m = /^(\d{1,2}):(\d{2})\s*$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  const bare = /^(\d{1,2})\s*$/.exec(t);
  if (bare) {
    const h = Number(bare[1]);
    if (h < 0 || h > 23) return null;
    return `${String(h).padStart(2, "0")}:00`;
  }
  return null;
}

/**
 * Klokkeslett → minutter siden midnatt. Normaliserer først (samme regler som
 * `normalizeSchoolTime`), så et gyldig, i-døgn klokkeslett gir 0–1439, mens ugyldig eller
 * utenfor-døgn-verdi gir `null`. Ingen modulo-wrap.
 */
export function schoolTimeToMinutes(
  value: string | null | undefined,
): number | null {
  const normalized = normalizeSchoolTime(value);
  if (normalized === null) return null;
  return Number(normalized.slice(0, 2)) * 60 + Number(normalized.slice(3, 5));
}

/**
 * Minutter siden midnatt → `HH:MM`. Semantisk identisk med `minutesToHHMM`: krever
 * endelig tall i `[0, 1440)`, ellers `null`. Ingen modulo-wrap.
 */
export function schoolMinutesToTime(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 24 * 60) return null;
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Overlapper to tidsintervaller som HALVÅPNE intervaller `[start, end)`?
 * `10:00–11:00` og `11:00–12:00` overlapper IKKE; `10:00–11:00` og `10:30–11:30` gjør det.
 * Manglende/ugyldig start eller slutt → `false`. `end <= start` (reversert/null-lengde) →
 * `false`. Gjetter ALDRI en manglende sluttid.
 */
export function schoolTimeRangesOverlap(
  firstStart: string | null | undefined,
  firstEnd: string | null | undefined,
  secondStart: string | null | undefined,
  secondEnd: string | null | undefined,
): boolean {
  const aStart = schoolTimeToMinutes(firstStart);
  const aEnd = schoolTimeToMinutes(firstEnd);
  const bStart = schoolTimeToMinutes(secondStart);
  const bEnd = schoolTimeToMinutes(secondEnd);
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) {
    return false;
  }
  if (aEnd <= aStart || bEnd <= bStart) return false;
  return aStart < bEnd && bStart < aEnd;
}
