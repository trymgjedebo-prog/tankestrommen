/**
 * A-plan tabell → fag-rader (DOCX/PDF/tekst). Brukes av analyze-route og vitest.
 * Holdes fri for route-spesifikke typer.
 */

function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

function normalizeSpace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

const GENERIC_SUBJECT_BUCKET_RE =
  /^(sprak|språk|fremmedsprak|fremmedspråk|valgfag|sprakvalg|språkvalg|felles|aktivitet|uke|programfag|program|linje|modul|moduler|studieretning)\b/i;

const PROGRAM_SUBJECT_TOKEN_RE =
  /\b(matematikk|naturfag|samfunnsfag|norsk|engelsk|tysk|spansk|fransk|krle|rle|kunst|musikk|kor|korps|kroppsoving|kroppsøving|matte|natur|samf|historie|geografi|biologi|fysikk|kjemi|informasjon|programmering)\b/i;

function cleanSubjectToken(raw: string): string {
  return normalizeSpace(raw.replace(/[.,;:]+$/g, ""));
}

function isLikelyOverlaySectionLeftLabel(raw: string): boolean {
  const n = normalizeNorwegianLetters(normalizeSpace(raw));
  return /^(i\s+timen|husk|lekse\w?|hoydepunkter|notater?|ta\s+med|ha\s+med|frister?|prove\w?|prover|vurdering|ressurser|ekstra\s+beskjed|aktivitet)$/.test(
    n,
  );
}

/** Flere kjernefag i én linje → ikke én fagoverskrift (typisk «Naturfag, norsk og samfunnsfag er også i timen»). */
function distinctCoreSubjectTokenCount(text: string): number {
  const norm = normalizeNorwegianLetters(normalizeSpace(text));
  const keys = [
    "matematikk",
    "matte",
    "naturfag",
    "samfunnsfag",
    "norsk",
    "engelsk",
    "tysk",
    "spansk",
    "fransk",
    "historie",
    "geografi",
    "biologi",
    "rle",
    "krle",
    "fysikk",
    "kjemi",
    "programmering",
    "musikk",
    "kunst",
  ] as const;
  let n = 0;
  for (const k of keys) {
    if (new RegExp(`\\b${k}\\b`).test(norm)) n++;
  }
  return n;
}

function looksLikeMultiSubjectProseLine(cand: string): boolean {
  if (distinctCoreSubjectTokenCount(cand) < 2) return false;
  if (cand.includes(",")) return true;
  if (/\bog\b/i.test(cand) && distinctCoreSubjectTokenCount(cand) >= 3) return true;
  return false;
}

/** Preamble som skal bort fra «første fag»-lim — ikke lim inn i fagrad. */
function isLikelyFravaerOrAdminPreambleLine(line: string): boolean {
  const n = normalizeNorwegianLetters(normalizeSpace(line));
  return (
    /\b(fravaer|fravær|melde\s+fravær|meldes\s+til|kontaktlærer|kontaktlaerer)\b/.test(n) ||
    /\b(foresatte|foreldre)\s+(skal|m[aå])\b/.test(n) ||
    /\b(skolerutin|reglement|itslearning)\b/.test(n)
  );
}

/**
 * Linjer før første fagoverskrift som egentlig hører til en fagkolonne (DOCX-rekkefølge),
 * f.eks. «I timen: mars-bad» før første «- Naturfag:». Legges inn i relevant rad i stedet for preamble.
 */
/** Ren språkfag-rad (typisk kolonne 1 i timeplan) — ikke default for praktisk avvik/preamble. */
function isLanguageOnlyOverlayRowLabel(label: string): boolean {
  const raw = normalizeSpace(label).replace(/^\s*[-*•·]\s*/, "");
  const n = normalizeNorwegianLetters(raw);
  return (
    /^(spansk|tysk|fransk|engelsk)$/i.test(n) ||
    /^norsk\s+fordypning$/i.test(n)
  );
}

/**
 * Velg rad for orphan-preamble (mars-bad, husk, …) uten å bruke blindt `rows[0]`
 * (som ofte er Spansk/Tysk og ga feil subjectKey i overlay).
 */
function findPreambleMergeTargetRowIndex(
  rows: Array<{ label: string; body: string }>,
  usableLines: string[],
): number {
  const nLabel = (s: string) => normalizeNorwegianLetters(normalizeSpace(s));
  const nLine = (s: string) => normalizeNorwegianLetters(s);

  const hasPoolOrBadDay = usableLines.some((l) =>
    /\b(mars-?bad|mars\s+bad|sv[oø]m|bade\b|badet[oø]y|h[aå]ndkle)\b/.test(nLine(l)),
  );

  const samIdx = rows.findIndex((r) => {
    const rl = nLabel(r.label);
    return /\bsamfunnsfag\b/.test(rl) || /^samf\.?$/i.test(rl);
  });
  if (hasPoolOrBadDay && samIdx >= 0) return samIdx;

  const natIdx = rows.findIndex((r) => /\bnaturfag\b/.test(nLabel(r.label)));
  if (hasPoolOrBadDay && natIdx >= 0) return natIdx;

  const nonLangIdx = rows.findIndex((r) => !isLanguageOnlyOverlayRowLabel(r.label));
  if (nonLangIdx >= 0) return nonLangIdx;

  return 0;
}

/** @returns true hvis ikke-admin preamble-linjer ble flyttet inn i rader (da skal de ikke telle som orphan preamble). */
function mergeOrphanPreambleIntoSubjectRows(
  preamble: string[],
  rows: Array<{ label: string; body: string }>,
): boolean {
  if (!preamble.length || !rows.length) return false;
  const usable = preamble
    .map((l) => normalizeSpace(l))
    .filter((l) => l && !isLikelyFravaerOrAdminPreambleLine(l));
  if (!usable.length) return false;

  const targetIdx = findPreambleMergeTargetRowIndex(rows, usable);
  const target = rows[targetIdx] ?? rows[0];
  const prefix = usable.join("\n").trim();
  const rest = target.body.trim();
  target.body = rest ? `${prefix}\n${rest}` : prefix;
  return true;
}

function isWeakSubjectTokenLine(text: string): boolean {
  let t = normalizeSpace(text).replace(/^[-*•·]\s*/, "");
  if (t.length > 64) return false;
  const norm = normalizeNorwegianLetters(t);
  if (/\b(lekse|pr[oø]ve|ta med|m[aå]l|kapittel|les\s|skriv|arbeider|tema)\b/.test(norm))
    return false;
  if (/\b(kap\.|side\s+\d|s\.\s*\d)/i.test(t)) return false;
  if (/^(k\s*[&\/]\s*h|k\s+og\s+h\b|kunst\s+og\s+h)/i.test(t)) return true;
  if (
    /^(krle|rle|spansk|tysk|fransk|norsk|engelsk|matte|musikk|kunst|naturfag|samfunnsfag|historie|geografi)$/i.test(
      norm,
    )
  )
    return true;
  return false;
}

function normalizeMarkdownishTicks(line: string): string {
  return normalizeSpace(line.replace(/^\s*`+|`+\s*$/g, "").trim());
}

/**
 * Word / DOCX: flere fag i én celle — sett inn linjeskift før kjente fagoverskrifter.
 */
export function expandEmbeddedSubjectHeadersInDetails(details: string | null): string | null {
  if (!details?.trim()) return details;
  let t = details.replace(/\r\n/g, "\n");
  t = t.replace(/\t+/g, "\n");
  const subj =
    "Samfunnsfag|Naturfag|Norsk|Engelsk|Tysk|Spansk|Fransk|Matematikk|Matte|KRLE|RLE|Kunst|Musikk|Kor(?:ps)?|Kroppsøving|Kroppsoving|Historie|Geografi|Biologi|Fysikk|Kjemi|Informasjon|Programmering|Natur";
  const re = new RegExp(`(\\s+)(?=(?:[-*•·]\\s*)?(?:${subj})\\s*:)`, "gi");
  t = t.replace(re, "\n");
  return t;
}

export function tryParseTableSubjectHeaderLine(
  line: string,
): { label: string; inlineBody: string | null } | null {
  const t = normalizeMarkdownishTicks(line);
  const trimmed = normalizeSpace(t);
  if (!trimmed) return null;

  const onlyColon = /^\s*[-*•·]?\s*(.+?)\s*:\s*$/.exec(t);
  if (onlyColon) {
    const cand = cleanSubjectToken(normalizeSpace(onlyColon[1]));
    if (cand.length < 2 || cand.length > 48) return null;
    if (isLikelyOverlaySectionLeftLabel(cand)) return null;
    if (GENERIC_SUBJECT_BUCKET_RE.test(cand)) return null;
    const norm = normalizeNorwegianLetters(cand);
    if (!PROGRAM_SUBJECT_TOKEN_RE.test(norm) && !isWeakSubjectTokenLine(cand)) return null;
    return { label: cand, inlineBody: null };
  }

    if (!trimmed.includes(":")) {
      const noBullet = trimmed.replace(/^\s*[-*•·]\s*/, "").trim();
      if (noBullet.length >= 2 && noBullet.length <= 48 && !isLikelyOverlaySectionLeftLabel(noBullet)) {
        const cand = cleanSubjectToken(noBullet);
        if (looksLikeMultiSubjectProseLine(cand)) return null;
        if (!GENERIC_SUBJECT_BUCKET_RE.test(cand)) {
          const norm = normalizeNorwegianLetters(cand);
          if (PROGRAM_SUBJECT_TOKEN_RE.test(norm) || isWeakSubjectTokenLine(cand)) {
            return { label: cand, inlineBody: null };
          }
        }
      }
    }

  const withBody = /^\s*[-*•·]?\s*(.{2,48}?)\s*:\s+(.+)$/.exec(t);
  if (withBody) {
    const left = cleanSubjectToken(normalizeSpace(withBody[1]));
    if (left.length < 2 || left.length > 48) return null;
    if (isLikelyOverlaySectionLeftLabel(left)) return null;
    if (GENERIC_SUBJECT_BUCKET_RE.test(normalizeNorwegianLetters(left))) return null;
    if (looksLikeMultiSubjectProseLine(left)) return null;
    const normL = normalizeNorwegianLetters(left);
    if (!PROGRAM_SUBJECT_TOKEN_RE.test(normL) && !isWeakSubjectTokenLine(left)) return null;
    return { label: left, inlineBody: normalizeSpace(withBody[2]) };
  }

  return null;
}

export type APlanTableSplitResult = {
  /** Fag-rader med kropp (etter første kjente fagoverskrift). */
  rows: Array<{ label: string; body: string }>;
  /** Linjer før første fagoverskrift (f.eks. uke-header, admintekst). */
  preamble: string[];
};

/**
 * Deler dagens `details` i én eller flere radforankrede blokker.
 * `null` = ingen gjenkjent fagoverskrift → bruk monolittisk fallback i route.
 */
export function splitDetailsIntoTableSubjectRowsWithMeta(
  details: string | null,
): APlanTableSplitResult | null {
  const expanded = expandEmbeddedSubjectHeadersInDetails(details);
  if (!expanded?.trim()) return null;

  const preamble: string[] = [];
  const segments: Array<{ label: string; lines: string[] }> = [];
  let current: { label: string; lines: string[] } | null = null;
  let seenHeader = false;

  for (const raw of expanded.split(/\n/)) {
    const t = normalizeSpace(raw);
    if (!t) continue;
    const hdr = tryParseTableSubjectHeaderLine(t);
    if (hdr) {
      seenHeader = true;
      if (current) segments.push(current);
      current = { label: hdr.label, lines: [] };
      if (hdr.inlineBody) current.lines.push(hdr.inlineBody);
      continue;
    }
    if (!seenHeader) {
      preamble.push(t);
      continue;
    }
    if (current) current.lines.push(t);
  }
  if (current) segments.push(current);

  if (!seenHeader || segments.length === 0) return null;

  const rows = segments
    .map((s) => ({ label: s.label, body: s.lines.join("\n").trim() }))
    .filter((s) => Boolean(s.label?.trim()));

  if (rows.length === 0) return null;
  const mergedActivityPreamble = mergeOrphanPreambleIntoSubjectRows(preamble, rows);
  const preambleOut = mergedActivityPreamble
    ? preamble.filter((l) => {
        const t = normalizeSpace(l);
        return Boolean(t) && isLikelyFravaerOrAdminPreambleLine(t);
      })
    : preamble;
  return { rows, preamble: preambleOut };
}

/** Bakoverkompatibel: kun radene (minst én). */
export function splitDetailsIntoTableSubjectRows(
  details: string | null,
): Array<{ label: string; body: string }> | null {
  const m = splitDetailsIntoTableSubjectRowsWithMeta(details);
  return m?.rows ?? null;
}
