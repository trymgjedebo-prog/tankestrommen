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
