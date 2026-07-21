/**
 * ÉN normalisert, subject/kategori-bærende innholdsrad FØR skoleinnhold reduseres til ulik prosa i
 * `schoolWeekOverlayProposal` (som stripper fag-prefiks) og `schoolBlockProposal` (som beholder hele
 * kildelinjen).
 *
 * Modellen skiller EKSPLISITT tre nivåer som tidligere ble blandet:
 *   1. KILDECONTAINEREN  → `sourceContainerId` + `sourceField` + `sourceCoverage` (hele det rå feltet,
 *      f.eks. en hel `details`-blob, og om det er FULLSTENDIG dekket av gyldige fag-fakta).
 *   2. DET ENKELTE FAKTUMET → `sourceFactId` (én fag-rad inni containeren; stabil på tvers av seksjon).
 *   3. SYNLIG TEKST vs. ORIGINAL EVIDENS → `text` (renskåren kropp) vs. `originalSourceText` (rå felt).
 *
 * Poenget: den kanoniske adapteren rekonstruerer IKKE fag↔innhold via tilfeldig lik prosa. Fakta
 * bygges én gang fra de rå analysefeltene (`scheduleByDay`) og konsumeres direkte. `sourceContainerId`
 * kobler et fag-fakta til det schoolBlock-common-item som stammer fra SAMME kildefelt, men et
 * common-item fjernes bare når containeren er `full` (se adapter) — aldri fordi én rad ble plassert.
 *
 * Gjenbruker den eksisterende rene fag-prefiks-splitteren (`a-plan-overlay-table-split`) og
 * fag-primitivene (`school-subject`) — ingen ny fagmatcher, ingen fuzzy matching, ingen dokument-
 * spesifikke fraser/regex. Ren: ingen Next.js/OpenAI/env/nettverk/sideeffekter; muterer aldri input.
 */
import { expandEmbeddedSubjectHeadersInDetails, splitDetailsIntoTableSubjectRowsWithMeta, tryParseTableSubjectHeaderLine } from "@/lib/a-plan-overlay-table-split";
import { canonicalizeSubjectFromText, slugifySubjectKey } from "@/lib/school-subject";
import { normalizeSchoolDateToIso } from "@/lib/school-date";
import { normalizeSchoolWeekdayIndex, schoolWeekdayIndexFromIsoDate } from "@/lib/school-weekday";
import { djb2Hex } from "@/lib/stable-id";
import type { DayScheduleEntry, SchoolBlockContentType, SchoolProfileWeekdayIndex } from "@/lib/types";

/* ── Seksjon → kategori (kontrakt fra oppgaven) ────────────────────────────── */

export type SchoolContentSectionKey =
  | "iTimen"
  | "lekse"
  | "husk"
  | "proveVurdering"
  | "ressurser"
  | "ekstraBeskjed"
  | "descriptionLines";

const SECTION_CONTENT_TYPE: Record<SchoolContentSectionKey, SchoolBlockContentType> = {
  iTimen: "lesson",
  lekse: "homework",
  husk: "reminder",
  proveVurdering: "assessment",
  ressurser: "resource",
  ekstraBeskjed: "message",
  descriptionLines: "message",
};

export function sectionKeyToContentType(section: SchoolContentSectionKey): SchoolBlockContentType {
  return SECTION_CONTENT_TYPE[section];
}

/**
 * Kategori-spesifisitet for dedup av SAMME faktum som havner i flere seksjoner (mer spesifikk
 * vinner over generell `message`). Lavere indeks = mer spesifikk. Deterministisk, ikke dokument-
 * spesifikk.
 */
const CONTENT_TYPE_SPECIFICITY: SchoolBlockContentType[] = [
  "assessment",
  "homework",
  "lesson",
  "reminder",
  "resource",
  "alternative_program",
  "message",
];
function specificityRank(t: SchoolBlockContentType): number {
  const i = CONTENT_TYPE_SPECIFICITY.indexOf(t);
  return i === -1 ? CONTENT_TYPE_SPECIFICITY.length : i;
}
/** Mer spesifikk kategori vinner (assessment > homework > lesson > reminder > resource > message). */
export function moreSpecificContentType(a: SchoolBlockContentType, b: SchoolBlockContentType): SchoolBlockContentType {
  return specificityRank(a) <= specificityRank(b) ? a : b;
}

/* ── Fact-kontrakt ─────────────────────────────────────────────────────────── */

/** Hvilket rå `scheduleByDay`-felt kildecontaineren kommer fra. */
export type SchoolContentSourceField = "details" | "highlights" | "rememberItems" | "deadlines" | "notes";

/** Om hele kildecontaineren sikkert er strukturert til gyldige fag-fakta uten resttekst. */
export type SchoolContentSourceCoverage = "full" | "partial";

export interface NormalizedSchoolContentFact {
  /** Stabil KILDECONTAINER-ID: dag-scope + kildefelt + normalisert original feltverdi. */
  sourceContainerId: string;
  /** Stabil ENKELT-FAKTUM-ID: container + fag + normalisert synlig tekst (IKKE seksjon). */
  sourceFactId: string;
  sourceField: SchoolContentSourceField;
  /** `full` = hele containeren er dekket av gyldige fag-fakta (trygt å supersede block-common). */
  sourceCoverage: SchoolContentSourceCoverage;

  date: string | null;
  weekdayIndex: SchoolProfileWeekdayIndex | null;
  dayLabel: string | null;

  subjectKey: string;
  subject: string | null;
  customLabel: string | null;
  sectionKey: SchoolContentSectionKey;

  /** Synlig innhold (kroppen ETTER fag-/seksjons-prefiks) — brukes som canonical `sourceText`. */
  text: string;
  /** Rå feltverdi verbatim (== schoolBlock `sourceText`) — bevares som canonical `evidence`. */
  originalSourceText: string;

  start: string | null;
  end: string | null;
  confidence: number;
}

/* ── Rene helpers ──────────────────────────────────────────────────────────── */

function normalizeSpace(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
}
function serialize(v: unknown): string {
  return JSON.stringify(v);
}

/** Seksjonsord som suffiks på en fag-etikett («Norsk i timen» → fag «Norsk», seksjon iTimen). */
const SECTION_WORD_SUFFIXES: Array<{ re: RegExp; section: SchoolContentSectionKey }> = [
  { re: /\s+i\s+timen$/i, section: "iTimen" },
  { re: /\s+lekser?$/i, section: "lekse" },
  { re: /\s+(?:husk|ta\s+med|ha\s+med)$/i, section: "husk" },
  { re: /\s+(?:pr[øo]ver?|vurdering|frister?)$/i, section: "proveVurdering" },
  { re: /\s+ressurser$/i, section: "ressurser" },
  { re: /\s+(?:ekstra\s+beskjed|notater?)$/i, section: "ekstraBeskjed" },
];

function splitSubjectLabelSectionWord(label: string): { subject: string; section: SchoolContentSectionKey | null } {
  const t = normalizeSpace(label) ?? "";
  for (const { re, section } of SECTION_WORD_SUFFIXES) {
    if (re.test(t)) {
      const subject = normalizeSpace(t.replace(re, ""));
      if (subject) return { subject, section };
    }
  }
  return { subject: t, section: null };
}

/** Deterministisk fag-key fra en fag-etikett. `canonical` styrer om `customLabel` skal være null. */
function subjectKeyFromLabel(subjectLabel: string): { subjectKey: string; subject: string | null; canonical: boolean } | null {
  const canon = canonicalizeSubjectFromText(subjectLabel);
  if (canon) return { subjectKey: canon.subjectKey, subject: canon.displayName, canonical: true };
  const slug = slugifySubjectKey(subjectLabel);
  return slug ? { subjectKey: slug, subject: normalizeSpace(subjectLabel), canonical: false } : null;
}

type DayIdentity = { date: string | null; weekdayIndex: SchoolProfileWeekdayIndex | null; dayLabel: string | null; dayKey: string };

function dayIdentityOf(day: DayScheduleEntry): DayIdentity {
  const date = normalizeSchoolDateToIso(day.date);
  const weekdayIndex = normalizeSchoolWeekdayIndex(day.dayLabel) ?? (date ? schoolWeekdayIndexFromIsoDate(date) : null);
  const dayLabel = normalizeSpace(day.dayLabel);
  const dayKey = date ?? (weekdayIndex !== null ? `wk:${weekdayIndex}` : dayLabel ? `label:${dayLabel.toLowerCase()}` : "day:unknown");
  return { date, weekdayIndex, dayLabel, dayKey };
}

function containerIdFor(dayKey: string, sourceField: SchoolContentSourceField, normalizedOriginal: string): string {
  return `school-container-h${djb2Hex(serialize([dayKey, sourceField, normalizedOriginal.toLowerCase()]))}`;
}
function factIdFor(sourceContainerId: string, subjectKey: string, normalizedText: string): string {
  // Bevisst UTEN sectionKey: samme faktum under iTimen/ekstraBeskjed → samme fact-ID (mest spesifikke
  // kategori vinner senere); ulik tekst eller ulikt fag → ulik fact-ID.
  return `school-fact-h${djb2Hex(serialize([sourceContainerId, subjectKey, normalizedText.toLowerCase()]))}`;
}

/* ── Fact-bygging per felt ─────────────────────────────────────────────────── */

/**
 * Bygg ett fag-faktum fra én kildelinje som har et EKSPLISITT fag-prefiks. `fieldDefault` er
 * KONSERVATIV (message) med mindre et seksjonsord i etiketten eksplisitt hever den. `original` er den
 * rå CONTAINER-verdien (hele feltet / hele details-bloben) og styrer container-identiteten.
 */
function factFromSubjectLine(
  identity: DayIdentity,
  parsed: { label: string; inlineBody: string | null },
  sourceField: SchoolContentSourceField,
  fieldDefault: SchoolContentSectionKey,
  original: string,
  coverage: SchoolContentSourceCoverage,
): NormalizedSchoolContentFact | null {
  const { subject: subjectLabel, section: wordSection } = splitSubjectLabelSectionWord(parsed.label);
  const resolved = subjectKeyFromLabel(subjectLabel);
  if (!resolved) return null;
  const sectionKey = wordSection ?? fieldDefault;
  const body = normalizeSpace(parsed.inlineBody) ?? normalizeSpace(subjectLabel) ?? subjectLabel;
  const sourceContainerId = containerIdFor(identity.dayKey, sourceField, original);
  const sourceFactId = factIdFor(sourceContainerId, resolved.subjectKey, body);
  // §6: kanonisk fag → customLabel null; ukjent/custom → renskåren fag-etikett (uten seksjonsord).
  const customLabel = resolved.canonical ? null : normalizeSpace(subjectLabel);
  return {
    sourceContainerId,
    sourceFactId,
    sourceField,
    sourceCoverage: coverage,
    date: identity.date,
    weekdayIndex: identity.weekdayIndex,
    dayLabel: identity.dayLabel,
    subjectKey: resolved.subjectKey,
    subject: resolved.subject,
    customLabel,
    sectionKey,
    text: body,
    originalSourceText: original,
    start: null,
    end: null,
    confidence: 0.8,
  };
}

/**
 * Atomisk felt (highlights/rememberItems/deadlines/notes): hver verdi er sin egen container. Verdien
 * markeres `full` kun når HELE verdien sikkert er tolket som ett eksplisitt fagfaktum; ellers ingen
 * fact (forblir dagsnivå via schoolBlock-common). Konservativ default-kategori (message).
 */
function factsFromSimpleField(
  identity: DayIdentity,
  values: readonly string[] | undefined,
  sourceField: SchoolContentSourceField,
): NormalizedSchoolContentFact[] {
  if (!Array.isArray(values)) return [];
  const out: NormalizedSchoolContentFact[] = [];
  for (const raw of values) {
    const line = normalizeSpace(raw);
    if (!line) continue;
    const parsed = tryParseTableSubjectHeaderLine(line);
    if (!parsed) continue; // ingen eksplisitt fag-prefiks → forblir dagsnivå via schoolBlock-common
    const fact = factFromSubjectLine(identity, parsed, sourceField, "ekstraBeskjed", line, "full");
    if (fact) out.push(fact);
  }
  return out;
}

/**
 * Har `details` en LEDENDE ikke-fag-linje (preamble) før første fagoverskrift? `split`-en over
 * merger slik preamble stille inn i første rad, så vi må sjekke rå-linjene selv for å ikke feilaktig
 * hevde full dekning (ellers kan generell dagsinformasjon skjules under et fag).
 */
function detailsHasLeadingPreamble(details: string): boolean {
  const expanded = expandEmbeddedSubjectHeadersInDetails(details);
  if (!expanded) return false;
  for (const raw of expanded.split(/\n/)) {
    const t = normalizeSpace(raw);
    if (!t) continue;
    return tryParseTableSubjectHeaderLine(t) === null; // første ikke-tomme linje: preamble hvis ikke fagoverskrift
  }
  return false;
}

/**
 * `details`-container: kan inneholde flere fag-rader. Coverage er `full` KUN når det finnes ≥1 rad,
 * ingen ledende preamble og ingen admin-resttekst gjenstår, og HVER rad ble en gyldig fact. Ellers
 * `partial` (adapteren skal da IKKE supersede hele containeren). Konservativ default-kategori
 * (message; seksjonsord i etiketten hever).
 */
function factsFromDetails(identity: DayIdentity, details: string | null): NormalizedSchoolContentFact[] {
  const blob = normalizeSpace(details);
  if (!blob) return [];
  const split = splitDetailsIntoTableSubjectRowsWithMeta(details);
  if (!split || split.rows.length === 0) return [];
  const built = split.rows.map((row) =>
    factFromSubjectLine(identity, { label: row.label, inlineBody: normalizeSpace(row.body) }, "details", "ekstraBeskjed", blob, "full"),
  );
  const valid = built.filter((f): f is NormalizedSchoolContentFact => f !== null);
  const coverage: SchoolContentSourceCoverage =
    split.preamble.length === 0 && valid.length === split.rows.length && !detailsHasLeadingPreamble(details ?? "")
      ? "full"
      : "partial";
  return valid.map((f) => (coverage === f.sourceCoverage ? f : { ...f, sourceCoverage: coverage }));
}

/* ── Offentlig API ─────────────────────────────────────────────────────────── */

/**
 * Bygg alle normaliserte fag-fakta fra rå `scheduleByDay`. Deterministisk, rekkefølge-stabil
 * (dag-rekkefølge → felt-rekkefølge → verdi-rekkefølge). Bare linjer med et EKSPLISITT fag-prefiks
 * blir fakta; alt annet forblir dagsnivå (håndteres av schoolBlock-projeksjonen).
 */
export function buildNormalizedSchoolContentFacts(
  days: readonly DayScheduleEntry[] | undefined,
): NormalizedSchoolContentFact[] {
  if (!Array.isArray(days)) return [];
  const out: NormalizedSchoolContentFact[] = [];
  for (const day of days) {
    if (!day || typeof day !== "object") continue;
    const identity = dayIdentityOf(day);
    out.push(...factsFromDetails(identity, day.details));
    out.push(...factsFromSimpleField(identity, day.highlights, "highlights"));
    out.push(...factsFromSimpleField(identity, day.rememberItems, "rememberItems"));
    out.push(...factsFromSimpleField(identity, day.deadlines, "deadlines"));
    out.push(...factsFromSimpleField(identity, day.notes, "notes"));
  }
  return out;
}
