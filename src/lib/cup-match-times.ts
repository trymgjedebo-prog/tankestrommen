/**
 * Kamp-/aktivitetstider for cup-dager (brukes av /api/analyze og tester).
 * Eksplisitte oppmøtetider skal aldri behandles som kampstart for offset-beregning.
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

function hhmmToMinutesLocal(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59)
    return null;
  return h * 60 + mm;
}

function lineLooksLikeAdministrativeDeadline(line: string): boolean {
  const n = normalizeNorwegianLetters(line).toLowerCase();
  const adminSignal =
    /\b(spond|svar|frist|senest|pamelding|påmelding|meld\s+fra|gi\s+beskjed|kommentarfelt)\b/.test(n);
  if (!adminSignal) return false;
  const activitySignal =
    /\b(kamp|kampstart|forste\s+kamp|første\s+kamp|andre\s+kamp|oppmote|oppmøte|avreise|oppvarming)\b/.test(
      n,
    );
  return !activitySignal;
}

/**
 * Alle HH:MM på linjer med kamp-/aktivitetsspråk (uten oppmøte-filtrering — brukes til å
 * unngå at «18:40 … oppmøte» tolkes som oppmøtetid når kampstart 18:40 finnes i teksten).
 */
export function kampAnchoredHhmmInText(text: string): Set<string> {
  const seen = new Set<string>();
  for (const lineRaw of text.split(/\n+/)) {
    const line = normalizeSpace(lineRaw);
    if (!line) continue;
    const n = normalizeNorwegianLetters(line);
    if (
      !/\b(kamp(?:start)?|forste\s+kamp|første\s+kamp|andre\s+kamp|spill(?:er|ere)?|avkast|starter)\b/.test(
        n,
      )
    )
      continue;
    const re = /(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (contextSuggestsAttendanceForTime(line, m.index, m[0].length)) continue;
      const lineN = normalizeNorwegianLetters(line);
      if (
        /\b\d{1,3}\s*min(?:utter)?\s*f[oø]r\b/.test(lineN) ||
        /\bf[oø]r\s+(?:f[oø]rste|andre|tredje|hver)\s+kamp\b/.test(lineN) ||
        /\boppm[oø]te\s+f[oø]r\b/.test(lineN)
      )
        continue;
      const hhmm = `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
      if (hhmmToMinutesLocal(hhmm) != null) seen.add(hhmm);
    }
  }
  return seen;
}

/**
 * Oppmøte uttrykt med tydelig frase i kilden (oppmøte/møt opp/vi møter … kl. HH:MM),
 * ikke bare «HH:MM Oppmøte» fra feilmerket highlight.
 */
export function extractSourceSupportedAttendanceHhmmTimes(text: string): Set<string> {
  const kampTimes = kampAnchoredHhmmInText(text);
  const s = new Set<string>();
  const add = (h: string, mm: string) => {
    const hh = String(Number(h)).padStart(2, "0");
    const hhmm = `${hh}:${mm}`;
    if (hhmmToMinutesLocal(hhmm) == null || kampTimes.has(hhmm)) return;
    s.add(hhmm);
  };
  let m: RegExpExecArray | null;
  const re1 =
    /\b(?:oppm[oø]te|m[oø]t\s+opp|vi\s+m[oø]te(?:r|s(?:\s+opp)?)?|m[oø]te(?:r)?(?:\s+opp)?)\b[^.!?\n]{0,90}?\bkl\.?\s*(\d{1,2})[.:](\d{2})\b/gi;
  while ((m = re1.exec(text)) !== null) {
    const span = text.slice(m.index, m.index + m[0].length + 40);
    if (/\bm[oø]t\s+ferdig\b/i.test(span)) continue;
    add(m[1]!, m[2]!);
  }
  const re3 = /\boppm[oø]te(?:\s*kl\.?)?\s*(\d{1,2})[.:](\d{2})\b/gi;
  while ((m = re3.exec(text)) !== null) add(m[1]!, m[2]!);
  return s;
}

/**
 * Alle klokkeslett som tydelig er oppmøte (ikke kampstart), for filtrering fra kamptidslisten.
 */
export function extractExplicitAttendanceHhmmTimes(text: string): Set<string> {
  const kampTimes = kampAnchoredHhmmInText(text);
  const s = new Set(extractSourceSupportedAttendanceHhmmTimes(text));
  const add = (h: string, mm: string) => {
    const hh = String(Number(h)).padStart(2, "0");
    if (hhmmToMinutesLocal(`${hh}:${mm}`) == null) return;
    s.add(`${hh}:${mm}`);
  };
  let m: RegExpExecArray | null;
  const re2 = /\b(\d{1,2})[.:](\d{2})\b[^.!?\n]{0,40}?\boppm[oø]te\b/gi;
  while ((m = re2.exec(text)) !== null) {
    const hh = String(Number(m[1])).padStart(2, "0");
    const mm = m[2]!;
    if (kampTimes.has(`${hh}:${mm}`)) continue;
    add(m[1]!, m[2]!);
  }
  return s;
}

function contextSuggestsAttendanceForTime(line: string, indexInLine: number, fullMatchLen: number): boolean {
  const start = Math.max(0, indexInLine - 52);
  const before = normalizeNorwegianLetters(line.slice(start, indexInLine));
  const after = normalizeNorwegianLetters(line.slice(indexInLine + fullMatchLen, indexInLine + fullMatchLen + 40));
  return (
    /\b(oppmote|oppmøte|m[oø]t(?:er)?)\b/.test(before) ||
    /^\s*oppm[oø]te\b/.test(after)
  );
}

export function extractCupMatchTimes(text: string): string[] {
  const explicitSkip = extractExplicitAttendanceHhmmTimes(text);
  const out: string[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\n+/);
  const re =
    /(?:\b(?:kamp(?:start)?|forste\s+kamp|første\s+kamp|andre\s+kamp|spill(?:er|ere)?|avkast|starter)\b[^.!?\n]{0,24}?)?(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})\b/gi;
  for (const lineRaw of lines) {
    const line = normalizeSpace(lineRaw);
    if (!line || lineLooksLikeAdministrativeDeadline(line)) continue;
    if (/^(?:kl\.?\s*)?\d{1,2}[.:]\d{2}$/i.test(line)) continue;
    const nLine = normalizeNorwegianLetters(line);
    if (
      /\bdugnad\b/.test(nLine) &&
      !/\b(kamp(?:start)?|forste\s+kamp|første\s+kamp|andre\s+kamp)\b/.test(nLine)
    )
      continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (contextSuggestsAttendanceForTime(line, m.index, m[0].length)) continue;
      const hhmm = `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
      if (hhmmToMinutesLocal(hhmm) == null || seen.has(hhmm)) continue;
      if (explicitSkip.has(hhmm)) continue;
      seen.add(hhmm);
      out.push(hhmm);
    }
  }
  return out;
}

/**
 * Klokkeslett på linjer med tydelig kamp-/aktivitetsspråk (når hoved-regex ikke traff,
 * f.eks. «Kampstart kl. 18:40» i et notat som senere ble flyttet ut av dag-blobben).
 */
export function extractKampAnchoredClockTimes(text: string): string[] {
  const explicitSkip = extractExplicitAttendanceHhmmTimes(text);
  const out: string[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\n+/);
  for (const lineRaw of lines) {
    const line = normalizeSpace(lineRaw);
    if (!line || lineLooksLikeAdministrativeDeadline(line)) continue;
    const n = normalizeNorwegianLetters(line);
    if (
      !/\b(kamp(?:start)?|forste\s+kamp|første\s+kamp|andre\s+kamp|spill(?:er|ere)?|avkast|starter)\b/.test(
        n,
      )
    )
      continue;
    const re = /(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (contextSuggestsAttendanceForTime(line, m.index, m[0].length)) continue;
      const hhmm = `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
      if (hhmmToMinutesLocal(hhmm) == null || seen.has(hhmm) || explicitSkip.has(hhmm)) continue;
      seen.add(hhmm);
      out.push(hhmm);
    }
  }
  out.sort((a, b) => (hhmmToMinutesLocal(a)! - hhmmToMinutesLocal(b)!));
  return out;
}
