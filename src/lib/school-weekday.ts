/**
 * Delte, deterministiske ukedagshjelpere for skoledata. Ingen klokke, ingen randomness.
 *
 * `normalizeSchoolWeekdayIndex` og `detectIsoWeekdayFromLabel` er semantisk uendrede
 * flyttinger av `canonicalSchoolProfileWeekdayIndex` / `detectIsoWeekday` fra
 * `analyze-image.ts`. `schoolWeekdayIndexFromIsoDate` er en ny, ren helper for det senere
 * SchoolBlockProposal-dagsskallet — den gjenbruker `isoWeekdayOfYmd` (UTC + round-trip)
 * og tolker ALDRI norsk fritekst eller gjetter datoformat.
 */
import { isoWeekdayOfYmd } from "@/lib/portal-week-year";
import type { SchoolProfileWeekdayIndex } from "@/lib/types";

/** Privat kopi (som ellers duplisert i repoet) — kun for eksakt bevaring av mappingen under. */
function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

/**
 * Kanoniser en eksakt ukedags-token til `SchoolProfileWeekdayIndex` ("0"=man … "4"=fre).
 * Semantisk identisk med `canonicalSchoolProfileWeekdayIndex`: lowercaser, trimmer, fjerner
 * trailing punktum, kollapser ALL whitespace, godtar numerisk "0"–"4", norske/engelske fulle
 * navn og forkortelser, og returnerer `null` for lørdag/søndag og ukjent tekst. Tolker IKKE
 * fritekst («Mandag 15. juni» → null). `null`/`undefined` → `null` (utvidelse for builderen;
 * eksisterende kallesteder sender alltid streng).
 */
export function normalizeSchoolWeekdayIndex(
  raw: string | null | undefined,
): SchoolProfileWeekdayIndex | null {
  if (raw == null) return null;
  const k = raw.toLowerCase().trim().replace(/\.$/, "");
  const collapsed = k.replace(/\s+/g, "");

  if (/^[0-4]$/.test(collapsed)) {
    return collapsed as SchoolProfileWeekdayIndex;
  }

  const nbAbbr: Record<string, SchoolProfileWeekdayIndex> = {
    man: "0",
    tir: "1",
    ons: "2",
    tor: "3",
    fre: "4",
  };
  if (nbAbbr[collapsed]) return nbAbbr[collapsed];

  const nb = normalizeNorwegianLetters(collapsed);
  if (nb === "lordag" || nb === "sondag" || nb === "laurdag") return null;

  const nbFull: Record<string, SchoolProfileWeekdayIndex> = {
    mandag: "0",
    tirsdag: "1",
    onsdag: "2",
    torsdag: "3",
    fredag: "4",
  };
  if (nbFull[nb]) return nbFull[nb];

  if (
    collapsed === "saturday" ||
    collapsed === "sunday" ||
    collapsed === "sat" ||
    collapsed === "sun"
  ) {
    return null;
  }

  const enFull: Record<string, SchoolProfileWeekdayIndex> = {
    monday: "0",
    tuesday: "1",
    wednesday: "2",
    thursday: "3",
    friday: "4",
  };
  if (enFull[collapsed]) return enFull[collapsed];

  const enShort: Record<string, SchoolProfileWeekdayIndex> = {
    mon: "0",
    ma: "0",
    tue: "1",
    ti: "1",
    wed: "2",
    on: "2",
    thu: "3",
    to: "3",
    fri: "4",
    fr: "4",
  };
  if (enShort[collapsed]) return enShort[collapsed];

  return null;
}

/**
 * Fritekst-DETEKTOR: finn ISO-ukedag (1=man … 7=søn, inkl. helg) i en dag-etikett via
 * ord-grense-regex. Semantisk identisk med `detectIsoWeekday`. `null`/tom → `null`.
 * (Merk: returnerer 1–7, IKKE `SchoolProfileWeekdayIndex`, og støtter helg — annet ansvar
 * enn `normalizeSchoolWeekdayIndex`.)
 */
export function detectIsoWeekdayFromLabel(
  dayLabel: string | null | undefined,
): number | null {
  if (!dayLabel) return null;
  const s = dayLabel.toLowerCase();
  const has = (re: RegExp) => re.test(s);

  if (has(/\b(man(day)?|ma\.?|mandag)\b/i)) return 1;
  if (has(/\b(tue(s(day)?)?|ti\.?|tirsdag)\b/i)) return 2;
  if (has(/\b(wed(nesday)?|on\.?|onsdag)\b/i)) return 3;
  if (has(/\b(thu(rs(day)?)?|to\.?|torsdag)\b/i)) return 4;
  if (has(/\b(fri(day)?|fr\.?|fredag)\b/i)) return 5;
  if (has(/\b(sat(urday)?|l[øo]r\.?|l[øo]rdag)\b/i)) return 6;
  if (has(/\b(sun(day)?|s[øo]n\.?|s[øo]ndag)\b/i)) return 7;

  return null;
}

/**
 * Ny builder-helper: `SchoolProfileWeekdayIndex` fra en eksakt ISO-dato `YYYY-MM-DD`.
 * Trimmer ytre whitespace, krever eksakt ISO-format, validerer faktisk kalenderdato via
 * round-trip i UTC (`isoWeekdayOfYmd`), og mapper mandag→"0" … fredag→"4". Lørdag/søndag,
 * ugyldig dato og ikke-ISO-format → `null`. Gjetter ALDRI datoformat og tolker ALDRI fritekst.
 */
export function schoolWeekdayIndexFromIsoDate(
  date: string | null | undefined,
): SchoolProfileWeekdayIndex | null {
  if (date == null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const iso = isoWeekdayOfYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  if (iso === null || iso >= 6) return null; // 6=lørdag, 7=søndag → null
  return String(iso - 1) as SchoolProfileWeekdayIndex; // 1=man→"0" … 5=fre→"4"
}
