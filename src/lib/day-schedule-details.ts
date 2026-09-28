/**
 * ÉN delt, ren definisjon av hvordan en dags atomiske tekstfelt serialiseres til `details`
 * (tekstprompt-formen `days[]` → `scheduleByDay`), pluss en PRESIS redundans-test.
 *
 * Tekstprompten returnerer atomiske felt (highlights/rememberItems/deadlines/notes); normaliseringen
 * syntetiserer i tillegg en `details`-blob av NØYAKTIG de samme feltene og beholder begge. Nedstrøms
 * kode som leser både `details` og de atomiske feltene, ville ellers se hvert faktum to ganger.
 *
 * Redundans-testen gjenskaper serialiseringen fra dagens egne felt og krever eksakt likhet. Den
 * gjetter aldri: en `details` som inneholder noe som helst utover de atomiske feltene (f.eks.
 * bildepromptens modell-skrevne `details`, eller en blob som senere er endret), er IKKE redundant
 * og bevares. Ingen fuzzy matching, ingen normalisering, ingen tolkning av innhold.
 *
 * Ren: ingen Next.js/OpenAI/env/nettverk/sideeffekter; muterer aldri input.
 */

export type DayAtomicTextFields = {
  highlights: readonly string[];
  rememberItems: readonly string[];
  deadlines: readonly string[];
  notes: readonly string[];
};

/** Serialiser atomiske felt til `details` (samme format som tekstnormaliseringen alltid har brukt). */
export function renderDayDetailsFromAtomicFields(day: DayAtomicTextFields): string | null {
  const sections: string[] = [];
  if (day.highlights.length > 0) {
    sections.push(`Høydepunkter: ${day.highlights.join("; ")}`);
  }
  if (day.rememberItems.length > 0) {
    sections.push(`Husk: ${day.rememberItems.join("; ")}`);
  }
  if (day.deadlines.length > 0) {
    sections.push(`Frister: ${day.deadlines.join("; ")}`);
  }
  if (day.notes.length > 0) {
    sections.push(`Notater: ${day.notes.join("; ")}`);
  }
  return sections.length > 0 ? sections.join("\n") : null;
}

/**
 * `true` KUN når `details` er nøyaktig serialiseringen av dagens egne atomiske felt — dvs. den
 * inneholder ingen informasjon som ikke allerede finnes i highlights/rememberItems/deadlines/notes.
 */
export function isDayDetailsDerivedFromAtomicFields(
  day: DayAtomicTextFields & { details: string | null },
): boolean {
  if (typeof day.details !== "string") return false;
  const rendered = renderDayDetailsFromAtomicFields(day);
  return rendered !== null && rendered === day.details;
}
