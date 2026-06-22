/**
 * Deterministisk klassifisering av task-/gjøremål-intent. Delt mellom produksjonsstien
 * (`/api/analyze` → portal-bundle) og eval-runneren, slik at test og produksjon ikke divergerer.
 *
 * - `must_do`: svar-/bekreftelsesfrist, påmelding, Spond-svar, betalingsfrist.
 * - `can_help`: frivillig hjelp («kan noen …», «vi trenger noen …», «det trengs», «vi søker», «hvem kan …»).
 *
 * Returnerer `undefined` for nøytrale oppgaver (f.eks. lekser/innlevering) — da settes ingen intent.
 */
export type TaskIntent = "must_do" | "can_help";

function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

/** Svarhandling som — sammen med et fristord — gir en må-gjøres-frist. */
const MUST_DO_RESPONSE_VERB =
  /\b(svar|svare|svarer|besvar|besvare|bekreft|meld\s+fra|meld\s+deg|meld\s+dere|gi\s+beskjed|registrer)\b/;
const DEADLINE_PREP = /\b(innen|senest|frist)\b/;
const CAN_HELP_SIGNAL =
  /\b(kan\s+noen|vi\s+trenger\s+noen|det\s+trengs|vi\s+s[oø]ker|hvem\s+kan|frivillig|noen\s+som\s+kan)\b/;

/** Klassifiser en oppgavelinje/-tittel til task-intent (eller undefined når nøytral). */
export function classifyTaskIntent(text: string): TaskIntent | undefined {
  const n = normalizeNorwegianLetters(text);
  const mustDo =
    /\bspond\b/.test(n) ||
    (MUST_DO_RESPONSE_VERB.test(n) && DEADLINE_PREP.test(n)) ||
    /\bfrist\s+for\s+pamelding\b/.test(n) ||
    /\bpameldingsfrist\b/.test(n) ||
    /\bsvarfrist\b/.test(n) ||
    (/\bbetal\b/.test(n) && /\bfrist\b/.test(n));
  if (mustDo) return "must_do";
  if (CAN_HELP_SIGNAL.test(n)) return "can_help";
  return undefined;
}
