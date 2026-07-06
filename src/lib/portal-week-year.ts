/**
 * Ukedag→år-utledning for portal-datoer (skole-/ukeplaner gitt uten fullt år).
 * Ren, delt logikk slik at den kan enhetstestes isolert uten å laste hele /api/analyze-ruten.
 *
 * Bug-bakgrunn: «mandag 15. juni» fikk feil år (2025) fordi år-utledningen tok FØRSTE år-kandidat
 * (f.eks. «2025» fra skoleår-spennet «2025/2026»). Her velges i stedet året der dag/måned faktisk
 * faller på den oppgitte ukedagen — 15. juni 2026 er mandag, 15. juni 2025 er søndag.
 */

/** ISO-ukedag (1=man … 7=søn) for en konkret Y-M-D, eller null hvis datoen er ugyldig (f.eks. 29. feb i ikke-skuddår). */
export function isoWeekdayOfYmd(year: number, month: number, day: number): number | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  const js = d.getUTCDay();
  return js === 0 ? 7 : js;
}

/**
 * ISO-8601-uke (og ISO-år) for en ISO-dato «YYYY-MM-DD». Ren matte for dato-basert
 * weekNumber-redundans i overlay-rutingen: dokumenter med ekte flerdagers datoer i samme
 * uke skal ikke avhenge av at ORDET «Uke NN» ble transkribert. Merk: ISO-året kan avvike
 * fra kalenderåret rundt årsskiftet (2025-12-29 → uke 1/2026). null ved ugyldig dato.
 */
export function isoWeekAndYearOfIsoDate(
  isoDate: string,
): { isoYear: number; isoWeek: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (isoWeekdayOfYmd(year, month, day) === null) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // ISO-uke: flytt til torsdagen i samme uke — dens kalenderår er ISO-året.
  const isoWeekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - isoWeekday);
  const isoYear = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7);
  return { isoYear, isoWeek };
}

/** Rangering: foretrekk inneværende/fremtidige år (avstand fremover), fortid sist. */
function weekdayYearRank(y: number, currentYear: number): number {
  return y >= currentYear ? y - currentYear : 1000 + (currentYear - y);
}

/**
 * Velg året der (måned, dag) faktisk faller på oppgitt ISO-ukedag. Hybrid:
 * (a) hvis dokumentet har realistiske år-kandidater (f.eks. skoleår-spenn «2025/2026») → velg den
 *     kandidaten som matcher ukedagen (nærmeste ≥ currentYear først);
 * (b) ellers → nærmeste inneværende/fremtidige år (currentYear-1 … currentYear+6) som matcher.
 * Returnerer null hvis ingen match (da brukes eksisterende fallback-år uendret).
 */
export function pickYearForWeekdayDate(
  month: number,
  day: number,
  isoWeekday: number,
  candidates: number[],
  currentYear: number,
): number | null {
  const matches = (year: number) => isoWeekdayOfYmd(year, month, day) === isoWeekday;
  const fromCandidates = Array.from(new Set(candidates))
    .filter((y) => y >= currentYear - 1 && y <= currentYear + 2)
    .filter(matches)
    .sort((a, b) => weekdayYearRank(a, currentYear) - weekdayYearRank(b, currentYear));
  if (fromCandidates.length > 0) return fromCandidates[0]!;
  for (let y = currentYear; y <= currentYear + 6; y++) if (matches(y)) return y;
  if (matches(currentYear - 1)) return currentYear - 1;
  return null;
}
