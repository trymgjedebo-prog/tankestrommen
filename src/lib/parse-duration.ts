/**
 * Generell varighetsparsing for hendelser (fly, kamp, økt, møte).
 */

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Tekst som tyder på at varighet ikke er pålitelig nok til å beregne slutt/start. */
export function isUncertainDurationContext(text: string): boolean {
  const t = normalizeWs(text).toLowerCase();
  if (!t) return false;
  return (
    /\b(kanskje|usikker|litt tid|det kan ta|store deler av dagen|en stund|lenge|varer kanskje|sett av)\b/i.test(
      t,
    ) || /\b(vet ikke|uvisst|omtrent|cirka|ca\.)\b/i.test(t)
  );
}

const WORD_HOUR: Record<string, number> = {
  en: 1,
  ein: 1,
  et: 1,
  én: 1,
  to: 2,
  tre: 3,
  fire: 4,
  fem: 5,
  seks: 6,
  sju: 7,
  syv: 7,
  åtte: 8,
  atte: 8,
  ni: 9,
  ti: 10,
  elleve: 11,
  tolv: 12,
};

function wordToHour(w: string): number | null {
  const k = w.toLowerCase().normalize("NFKC");
  if (k in WORD_HOUR) return WORD_HOUR[k]!;
  const n = Number(k);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : null;
}

/** Forsøk å finne varighet i minutter fra fritekst. Returnerer null hvis ingenting tydelig. */
export function parseDurationMinutes(raw: string): number | null {
  const text = normalizeWs(raw).toLowerCase();
  if (!text || isUncertainDurationContext(text)) return null;

  const cap = 20 * 60;
  const accept = (n: number) => (n > 0 && n <= cap ? n : null);

  // "tre og en halv time" (før isolert «en halv time» som er delstreng)
  const wordHalf = /\b([a-zæøåé]+|\d{1,2})\s+og\s+en\s+halv\s+time\b/i.exec(text);
  if (wordHalf) {
    const h = /^\d+$/.test(wordHalf[1]!)
      ? Number(wordHalf[1])
      : wordToHour(wordHalf[1]!);
    if (h != null && h >= 0 && h <= 18) return accept(h * 60 + 30);
  }

  if (/\bhalvannen\s+time\b/i.test(text)) return accept(90);

  // "en halv time" / "halv time"
  if (/\b(?:en\s+)?halv\s+time\b/i.test(text)) return accept(30);

  // "3h 30m" / "3 t 30 min"
  const hm = /\b(\d{1,2})\s*h(?:ours?)?\s*(\d{1,2})\s*m(?:in(?:utes?)?)?\b/i.exec(text);
  if (hm) {
    const total = Number(hm[1]) * 60 + Number(hm[2]);
    return accept(total);
  }

  const tmin =
    /\b(\d{1,2})\s*t(?:imer?)?\s+(\d{1,2})\s*(?:min(?:utter?)?|m\b)\b/i.exec(text) ||
    /\b(\d{1,2})\s*(?:timer?|t)\s+(\d{1,2})\s*min(?:utter?)?\b/i.exec(text);
  if (tmin) {
    const total = Number(tmin[1]) * 60 + Number(tmin[2]);
    return accept(total);
  }

  // "3 timer 30 minutter" / "1 time og 30 minutter" (før isolert «… min» som kan feiltolkes)
  const hmin =
    /\b(\d{1,2})\s*(?:timer?|t)\s+(?:og\s+)?(\d{1,2})\s*min(?:utter)?\b/i.exec(text);
  if (hmin) return accept(Number(hmin[1]) * 60 + Number(hmin[2]));

  // "45 minutter" / "45 min" (krever nærhet til varighetsord unngå klokkeslett)
  const minOnly = /\b(?:varer|varighet|duration|flytid|flight\s*time|økt(?:en)?|økt|kampen|sesjon|møtet)\b[^.!?\n]{0,80}?(\d{1,2})\s*min(?:utter)?\b/i.exec(
    text,
  );
  if (minOnly) return accept(Number(minOnly[1]));

  const looseMin = /\b(\d{1,2})\s*min(?:utter)?\b/i.exec(text);
  if (looseMin && /\b(?:varer|varighet|duration|flytid|økt|kampen|sesjon)\b/i.test(text)) {
    return accept(Number(looseMin[1]));
  }

  // "3:30" når det er tydelig varighet (ikke klokkeslett alene)
  const durColon = /\b(?:varighet|duration|flytid|flight\s*time|flyturen|varer)\b[^.!?\n]{0,60}?(\d{1,2}):(\d{2})\b/i.exec(
    text,
  );
  if (durColon) {
    const total = Number(durColon[1]) * 60 + Number(durColon[2]);
    return accept(total);
  }

  // "3,5 timer" / "3.5 hours"
  const dec = /\b(\d{1,2})(?:[.,](\d))?\s*(?:timer?|hours?|t\b)\b/i.exec(text);
  if (dec && /\b(?:varer|varighet|duration|flytid|økt|kampen|fly)\b/i.test(text)) {
    const h = Number(dec[1]);
    const frac = dec[2] != null ? Number(`0.${dec[2]}`) : 0;
    if (Number.isFinite(h) && Number.isFinite(frac)) return accept(Math.round((h + frac) * 60));
  }

  // "1 time" / "2 timer" etter varighets-kontekst
  const hOnly =
    /\b(?:varer|varighet|duration|flytid|økt(?:en)?|kampen|flyturen)\b[^.!?\n]{0,60}?(\d{1,2})\s*(?:timer?|t)\b/i.exec(
      text,
    );
  if (hOnly) return accept(Number(hOnly[1]) * 60);

  return null;
}
