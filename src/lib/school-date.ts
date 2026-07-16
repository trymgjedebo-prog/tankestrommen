/**
 * Delt, deterministisk datonormalisering for det senere SchoolBlockProposal-dagsskallet.
 *
 * `normalizeSchoolDateToIso` gjør om en sikker dato til `YYYY-MM-DD` eller `null`. Den
 * gjenbruker den delte kalendervalideringen `isoWeekdayOfYmd` (UTC round-trip) — samme
 * primitiv som `class-schedule-normalize.ts` og `school-weekday.ts` allerede bruker.
 *
 * Bevisst AVGRENSNING mot route.ts-parseren: `tryParseNorwegianDate` (route.ts) er en egen,
 * bredere parser som IKKE round-trip-validerer ISO (returnerer `2026-02-30` som-er) og som
 * har en `uke NN`-gren med `new Date()`-årgjetting. Denne helperen er strengere og renere:
 * ingen årgjetting, ingen ukedagsinferens, ingen automatisk årkorreksjon, ingen lokal
 * tidssone, ingen `Date.now()`. Den erstatter derfor ikke route-parseren.
 *
 * Månedsstøtte speiler eksisterende norsk produksjonskode (NB_MONTHS + aliaser); engelske
 * månedsnavn støttes IKKE (som i dag). Ukedagsordet ignoreres (som `tryParseNorwegianDate`).
 */
import { isoWeekdayOfYmd } from "@/lib/portal-week-year";

const NB_MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  mars: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  desember: 12,
};

const NB_MONTH_ALIASES: Record<string, keyof typeof NB_MONTHS> = {
  jan: "januar",
  feb: "februar",
  mar: "mars",
  apr: "april",
  mai: "mai",
  jun: "juni",
  jul: "juli",
  aug: "august",
  sep: "september",
  sept: "september",
  okt: "oktober",
  nov: "november",
  des: "desember",
};

/** Privat kopi (som ellers duplisert i repoet) for eksakt bevaring av månedsnavn-semantikken. */
function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

function normalizeMonthName(rawMonth: string): string {
  const cleaned = normalizeNorwegianLetters(rawMonth.replace(/\./g, "").trim());
  return NB_MONTH_ALIASES[cleaned] ?? cleaned;
}

/** Bygg `YYYY-MM-DD` KUN når (y, m, d) er en faktisk kalenderdato i UTC (round-trip). */
function buildValidatedIso(year: number, month: number, day: number): string | null {
  if (isoWeekdayOfYmd(year, month, day) === null) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Normaliser en sikker dato til `YYYY-MM-DD`, ellers `null`. Trimmer ytre whitespace og
 * validerer faktisk kalenderdato i UTC. Støtter: eksakt ISO `YYYY-MM-DD`, norsk skrevet form
 * «[ukedag] D. månedsnavn ÅÅÅÅ» (ukedagsord ignoreres), og punktum-/skråstrekform «D.M.ÅÅÅÅ».
 * Gjetter ALDRI år, inferer ALDRI dato fra bare ukedag, korrigerer ALDRI år, og bruker ALDRI
 * lokal tidssone eller `Date.now()`. Manglende år / ugyldig dato / ukjent form → `null`.
 */
export function normalizeSchoolDateToIso(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;

  // 1) Eksakt ISO YYYY-MM-DD (validert — strengere enn tryParseNorwegianDates passthrough).
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) {
    return buildValidatedIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // 2) «[ukedag] D. månedsnavn ÅÅÅÅ» — ukedagsord ignoreres, som eksisterende semantikk.
  const nb = /(\d{1,2})\.\s*([a-zæøå.]+)\s+(\d{4})/i.exec(t);
  if (nb) {
    const day = Number(nb[1]);
    const month = NB_MONTHS[normalizeMonthName(nb[2]!)];
    const year = Number(nb[3]);
    if (month) return buildValidatedIso(year, month, day);
  }

  // 3) «D.M.ÅÅÅÅ» / «D/M/ÅÅÅÅ» (forankret) — punktumform som eksisterende parser støtter.
  const slash = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t);
  if (slash) {
    return buildValidatedIso(Number(slash[3]), Number(slash[2]), Number(slash[1]));
  }

  return null;
}
