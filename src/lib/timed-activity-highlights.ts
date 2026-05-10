/**
 * Generell utledning av tidsfestede aktiviteter for portal/dagsprogram — ikke cup-spesifikk.
 */

function normalizeSpace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

export function normKeyTimed(s: string): string {
  return normalizeNorwegianLetters(normalizeSpace(s)).toLowerCase();
}

const HHMM_RE_GLOBAL = /(?:^|\s|kl\.?\s*)((?:[01]?\d|2[0-3])[:.]([0-5]\d))\b/gi;

/** Alle HH:MM i tekst, første forekomst per klokkeslett, bevart rekkefølge. */
export function extractOrderedHhmmTimesFromText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(HHMM_RE_GLOBAL.source, HHMM_RE_GLOBAL.flags);
  while ((m = re.exec(text)) !== null) {
    const parts = m[1]!.split(/[.:]/);
    const hh = String(Number(parts[0])).padStart(2, "0");
    const mm = parts[1]!;
    const hhmm = `${hh}:${mm}`;
    if (seen.has(hhmm)) continue;
    seen.add(hhmm);
    out.push(hhmm);
  }
  return out;
}

/** True når linjen tydelig beskriver en tidsfestet hovedaktivitet (ikke bare sted/logistikk). */
export function lineSuggestsTimedMainActivity(text: string): boolean {
  const n = normalizeNorwegianLetters(text);
  return (
    /\b(kamp|kampstart|forste\s+kamp|andre\s+kamp|tredje\s+kamp|oppm[oø]te|samling)\b/.test(n) ||
    /\b(avreise|ankomst|levering|henting|avgang|ankommer)\b/.test(n) ||
    /\b(forestilling|konsert|generalpr[oø]ve|gpro|premiere|opptreden)\b/.test(n) ||
    /\b(sluttspill|finale|semifinale)\b/.test(n) ||
    /\b(trening|trenings[oø]kt|[oø]kt)\b/.test(n) ||
    /\b(dugnad|foreldrem[oø]te|pr[oø]ve|eksamen)\b/.test(n) ||
    /\b(m[oø]te|fellessamling)\b/.test(n)
  );
}

/** Tekst som bare er «i Stednavn» uten aktivitet — typisk støy, ikke hovedaktivitet. */
export function isVenueOnlyLine(text: string): boolean {
  const t = normalizeSpace(text);
  return /^i\s+[A-ZÆØÅa-zæøå][\w\s.-]{1,40}$/i.test(t) && !lineSuggestsTimedMainActivity(t);
}

/**
 * Utled kort semantisk label for visning (ikke event-tittel).
 * Returnerer null hvis ingen tydelig aktivitet.
 */
export function inferTimedActivityLabelFromText(text: string): string | null {
  const n = normalizeNorwegianLetters(text);
  if (/\bforste\s+kamp\b/.test(n)) return "Første kamp";
  if (/\bandre\s+kamp\b/.test(n)) return "Andre kamp";
  if (/\btredje\s+kamp\b/.test(n)) return "Tredje kamp";
  if (/\bkampstart\b/.test(n)) return "Kampstart";
  if (/\bkamp\b/.test(n)) return "Kamp";
  if (/\b(spill(?:er|ere)?|avkast)\b/.test(n)) return "Kamp";
  if (/\bstarter\b/.test(n) && !/\boppm[oø]te\b/.test(n)) return "Kamp";
  if (/\boppm[oø]te\b/.test(n)) return "Oppmøte";
  if (/\bforeldrem[oø]te\b/.test(n)) return "Foreldremøte";
  if (/\bdugnad\b/.test(n)) return "Dugnad";
  if (/\b(pr[oø]ve|matematikkpr[oø]ve|norskstil|eksamen|kartlegging)\b/.test(n)) return "Prøve";
  if (/\bsamling\b/.test(n)) return "Samling";
  if (/\bavreise\b/.test(n)) return "Avreise";
  if (/\bankom(st|mer)\b/.test(n)) return "Ankomst";
  if (/\blevering\b/.test(n)) return "Levering";
  if (/\bhenting\b/.test(n)) return "Henting";
  if (/\bavgang\b/.test(n)) return "Avgang";
  if (/\bgeneralpr[oø]ve\b/.test(n) || /\bgpro\b/.test(n)) return "Generalprøve";
  if (/\bforestilling\b/.test(n)) return "Forestilling";
  if (/\bkonsert\b/.test(n)) return "Konsert";
  if (/\bpremiere\b/.test(n)) return "Premiere";
  if (/\bsluttspill\b/.test(n) && /\ba[\s-]?sluttspill\b/i.test(text)) return "Første sluttspillkamp";
  if (/\bsluttspill\b/.test(n)) return "Sluttspillkamp";
  if (/\bfinale\b/.test(n)) return "Finale";
  if (/\bsemifinale\b/.test(n)) return "Semifinale";
  if (/\btrenings[oø]kt\b/.test(n) || (/\btrening\b/.test(n) && !/\b(barn|foreldre)\b/.test(n)))
    return "Trening";
  if (/\b[oø]kt\b/.test(n)) return "Økt";
  if (/\bm[oø]te\b/.test(n)) return "Møte";
  return null;
}

export function inferTimeWindowActivityLabel(blob: string): string {
  const n = normalizeNorwegianLetters(blob);
  if (/\bforste\s+sluttspillkamp\b/.test(n)) return "Første sluttspillkamp";
  if (/\ba[\s-]?sluttspill\b/i.test(blob)) return "Første sluttspillkamp";
  if (/\bførste\s+kamp\b/i.test(blob)) return "Første kamp";
  if (/\bdugnad\b/.test(n)) return "Dugnad";
  if (/\bforeldrem[oø]te\b/.test(n)) return "Foreldremøte";
  if (/\b(trening|trenings[oø]kt)\b/.test(n)) return "Trening";
  const fromInfer = inferTimedActivityLabelFromText(blob);
  if (fromInfer && !/^Kamp$/.test(fromInfer)) return fromInfer;
  if (/\bsluttspill\b/.test(n)) return "Sluttspillkamp";
  return "Aktivitet";
}

export function buildTimeWindowHighlightLine(args: {
  earliest: string;
  latest: string;
  label: string;
  tentative: boolean;
}): string {
  const suffix = args.tentative ? " (foreløpig)" : "";
  return `${args.earliest}–${args.latest} ${args.label}${suffix}`;
}

/** Label for kamp nr i (1-basert) når flere klokkeslett. */
export function defaultMatchLabelByIndex(indexZeroBased: number): string {
  if (indexZeroBased === 0) return "Første kamp";
  if (indexZeroBased === 1) return "Andre kamp";
  if (indexZeroBased === 2) return "Tredje kamp";
  return `Kamp ${indexZeroBased + 1}`;
}
