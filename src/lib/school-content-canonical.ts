/**
 * Kanonisk, modalitetsuavhengig skoleinnholdsmodell — ÉN intern representasjon av skoleinnhold
 * FØR det projiseres til `schoolWeekOverlayProposal`, `schoolBlockProposal` eller en fremtidig
 * frontend-draft. Denne modulen definerer KUN kontrakten + en ren normaliserer; den er IKKE
 * koblet til noen produksjonsflyt (verken `normalizeAIAnalysisResult`, `route.ts`, `toPortalBundle`
 * eller de to builderne konsumerer/produserer den ennå).
 *
 * Modellen skiller EKSPLISITT tre nivåer per dag:
 *   A. Dagsnivå        → `generalDayMessages` (+ `dayOperation`/`dayResolution`)
 *   B. Fag-/øktnivå    → `subjectItems`
 *   C. Audience-/gruppe → `audienceItems`
 * Informasjon med uklar fagtilknytning bevares som dagsinformasjon — den gjettes ALDRI inn under
 * et fag, og bare PLASSERINGEN degraderes (contentType/sections/evidence/tid/flagg beholdes).
 * Hvert element ligger i NØYAKTIG én samling (via `placement`).
 *
 * `sourceId` identifiserer KILDEFAKTUMET (dagsscope + kildegrunnlag) og er stabil på tvers av
 * senere klassifisering; `itemId` er den fulle semantiske identiteten (inkl. placement/type/tid/
 * audience). Slik kan dedup på tvers av overlay/block/task skje senere på `sourceId`.
 *
 * Ren: ingen Next.js/OpenAI/env/nettverk/sideeffekter/prompttekst; ingen timetable- eller
 * personmatching; ingen LLM-kall. Gjenbruker kun rene domenehelpers og eksisterende wire-typer.
 */
import { djb2Hex } from "@/lib/stable-id";
import { normalizeSchoolDateToIso } from "@/lib/school-date";
import { normalizeSchoolTime } from "@/lib/school-time";
import {
  detectIsoWeekdayFromLabel,
  normalizeSchoolWeekdayIndex,
  schoolWeekdayIndexFromIsoDate,
} from "@/lib/school-weekday";
import { canonicalizeSubjectFromStrings, slugifySubjectKey } from "@/lib/school-subject";
import type {
  PortalEventPersonMatchStatus,
  SchoolBlockActivityKind,
  SchoolBlockAudienceEntry,
  SchoolBlockDayOperation,
  SchoolBlockDayResolution,
  SchoolBlockElementAction,
  SchoolBlockContentType,
  SchoolBlockReviewCode,
  SchoolBlockReviewFlag,
  SchoolBlockSections,
  SchoolBlockStructureStatus,
  SchoolProfileLessonCandidate,
  SchoolProfileWeekdayIndex,
} from "@/lib/types";

/* ── Kanonisk kontrakt ────────────────────────────────────────────────────── */

/** Nøyaktig ett plasseringsnivå per element (A=day, B=subject, C=audience). */
export type CanonicalPlacement = "day" | "subject" | "audience";

/**
 * Ett kanonisk innholdsfakta. `placement` diskriminerer hvilken dagssamling det tilhører.
 * Gjenbruker wire-kontraktens `contentType`/`action`/`sections`/`audienceEntries`/
 * `subjectCandidates`/`reviewFlags` — ingen duplisering av de typene.
 */
export interface CanonicalSchoolContentItem {
  /** Stabil KILDE-fakta-ID (dagsscope + kildegrunnlag). Uavhengig av senere klassifisering. */
  sourceId: string;
  /** Stabil ELEMENT-ID (full semantisk identitet, inkl. placement/contentType/tid/audience). */
  itemId: string;
  /** Eksplisitt kildepeker fra kilden (vinner som kildegrunnlag), ellers null. */
  sourceRef: string | null;
  placement: CanonicalPlacement;
  contentType: SchoolBlockContentType;
  action: SchoolBlockElementAction;

  subject: string | null;
  subjectKey: string | null;
  customLabel: string | null;
  subjectCandidates?: SchoolProfileLessonCandidate[];

  /** Normalisert HH:MM eller null. Konstrueres ALDRI. */
  start: string | null;
  end: string | null;

  /** Kun ved `placement: "audience"` (≥1 gyldig entry); ellers tom. */
  audienceEntries: SchoolBlockAudienceEntry[];
  sections: SchoolBlockSections;

  sourceText: string | null;
  evidence: string | null;
  confidence: number;
  reviewFlags: SchoolBlockReviewFlag[];
}

export interface CanonicalSchoolDay {
  dayId: string;
  date: string | null;
  weekdayIndex: SchoolProfileWeekdayIndex | null;
  dayLabel: string | null;

  dayOperation: SchoolBlockDayOperation;
  dayResolution: SchoolBlockDayResolution;

  /** B: fag-/øktnivå. */
  subjectItems: CanonicalSchoolContentItem[];
  /** C: audience-/gruppenivå. */
  audienceItems: CanonicalSchoolContentItem[];
  /** A: generelle dagsmeldinger + degradert (ikke-plasserbart) innhold. */
  generalDayMessages: CanonicalSchoolContentItem[];

  confidence: number;
  evidence: string | null;
  reviewFlags: SchoolBlockReviewFlag[];
}

export type CanonicalSchoolContentSchemaVersion = "1.0.0";

export interface CanonicalSchoolContentDraft {
  schemaVersion: CanonicalSchoolContentSchemaVersion;
  sourceTitle: string;
  originalSourceType: string;
  personId: string | null;
  personMatchStatus: PortalEventPersonMatchStatus;
  classCode: string | null;
  days: CanonicalSchoolDay[];
  structureStatus: SchoolBlockStructureStatus;
  reviewFlags: SchoolBlockReviewFlag[];
}

/* ── Rå input (eksplisitt, generell — IKKE AIAnalysisResult) ───────────────── */

export interface RawCanonicalAudienceEntry {
  classCodes?: readonly (string | null | undefined)[];
  pulje?: string | null;
  start?: string | null;
  end?: string | null;
  room?: string | null;
  teacher?: string | null;
  isChildAudience?: boolean | null;
}

export interface RawCanonicalSchoolItem {
  placement: CanonicalPlacement;
  contentType?: SchoolBlockContentType;
  action?: SchoolBlockElementAction;
  subject?: string | null;
  subjectKey?: string | null;
  customLabel?: string | null;
  subjectCandidates?: SchoolProfileLessonCandidate[];
  start?: string | null;
  end?: string | null;
  audienceEntries?: readonly RawCanonicalAudienceEntry[];
  sections?: SchoolBlockSections;
  sourceText?: string | null;
  /** Eksplisitt kildepeker — prioriteres som kildegrunnlag for `sourceId`. */
  sourceRef?: string | null;
  evidence?: string | null;
  reviewFlags?: readonly SchoolBlockReviewFlag[];
  confidence?: number;
}

export interface RawCanonicalSchoolDay {
  date?: string | null;
  weekdayIndex?: string | null;
  dayLabel?: string | null;
  dayOperation?: SchoolBlockDayOperation;
  evidence?: string | null;
  reviewFlags?: readonly SchoolBlockReviewFlag[];
  confidence?: number;
  items?: readonly RawCanonicalSchoolItem[];
}

export interface RawCanonicalSchoolContentInput {
  sourceTitle?: string | null;
  originalSourceType: string;
  personId?: string | null;
  personMatchStatus?: PortalEventPersonMatchStatus;
  classCode?: string | null;
  reviewFlags?: readonly SchoolBlockReviewFlag[];
  days?: readonly RawCanonicalSchoolDay[];
}

/* ── Runtime-enum-vakter (tåler fremtidig ukjent input) ───────────────────── */

const PLACEMENTS = new Set<CanonicalPlacement>(["day", "subject", "audience"]);
const CONTENT_TYPES = new Set<SchoolBlockContentType>([
  "lesson",
  "homework",
  "assessment",
  "reminder",
  "resource",
  "message",
  "alternative_program",
]);
const ACTIONS = new Set<SchoolBlockElementAction>(["enrich", "replace_range"]);
const PERSON_MATCH = new Set<PortalEventPersonMatchStatus>([
  "not_specified",
  "unmatched_document_name",
  "matched",
  "child_unresolved",
]);
const ACTIVITY_KINDS = new Set<SchoolBlockActivityKind>([
  "exam_day",
  "trip_day",
  "activity_day",
  "free_day",
  "other",
]);
const REVIEW_CODES = new Set<SchoolBlockReviewCode>([
  "missing_time",
  "ambiguous_subject",
  "child_class_unresolved",
  "unrecognized_activity",
  "conflicting_actions",
  "low_confidence",
]);

function validEnum<T extends string>(value: unknown, set: Set<string>, fallback: T): T {
  return typeof value === "string" && set.has(value) ? (value as T) : fallback;
}

/* ── Rene helpers ─────────────────────────────────────────────────────────── */

function trimToNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

/** Trim + kollaps intern whitespace; bevar casing; tom → null. */
function normalizeText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
}

function clamp01(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Mandag–fredag-ukedag fra en dayLabel (samme sikre logikk som builderne). */
function weekdayFromLabel(label: string | null): SchoolProfileWeekdayIndex | null {
  const wk = normalizeSchoolWeekdayIndex(label);
  if (wk) return wk;
  const isoW = detectIsoWeekdayFromLabel(label);
  if (isoW !== null && isoW >= 1 && isoW <= 5) {
    return String(isoW - 1) as SchoolProfileWeekdayIndex;
  }
  return null;
}

/** Lengdeprefikset feltkoding (entydig; skiller null fra tom/bokstavelig tekst). */
function encodeField(value: string | null | undefined): string {
  if (value == null) return "N;";
  return `S${value.length}:${value};`;
}

function serialize(fields: (string | null | undefined)[]): string {
  return fields.map(encodeField).join("");
}

function serializeArray(items: string[]): string {
  return encodeField(items.map(encodeField).join(""));
}

const CANONICAL_WEEKDAY_LABELS: Record<SchoolProfileWeekdayIndex, string> = {
  "0": "Mandag",
  "1": "Tirsdag",
  "2": "Onsdag",
  "3": "Torsdag",
  "4": "Fredag",
};

/* ── Review-flagg ─────────────────────────────────────────────────────────── */

function flagKey(f: SchoolBlockReviewFlag): string {
  return serialize([f.code, f.scope.dayId, f.scope.itemId, f.scope.audienceEntryId, f.message]);
}

function dedupeAndSortFlags(flags: SchoolBlockReviewFlag[]): SchoolBlockReviewFlag[] {
  const seen = new Map<string, SchoolBlockReviewFlag>();
  for (const f of flags) {
    const k = flagKey(f);
    if (!seen.has(k)) seen.set(k, f);
  }
  return [...seen.values()].sort((a, b) => (flagKey(a) < flagKey(b) ? -1 : flagKey(a) > flagKey(b) ? 1 : 0));
}

/** Normaliser og klon rå review-flagg (dropp ukjent kode). Ingen mutable inputreferanser. */
function normalizeRawFlags(
  raw: readonly SchoolBlockReviewFlag[] | undefined,
): SchoolBlockReviewFlag[] {
  if (!Array.isArray(raw)) return [];
  const out: SchoolBlockReviewFlag[] = [];
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const code = f.code;
    if (typeof code !== "string" || !REVIEW_CODES.has(code as SchoolBlockReviewCode)) continue;
    const message = typeof f.message === "string" ? f.message : "";
    const scopeIn = f.scope && typeof f.scope === "object" ? f.scope : {};
    const scope: SchoolBlockReviewFlag["scope"] = {};
    if (typeof scopeIn.dayId === "string") scope.dayId = scopeIn.dayId;
    if (typeof scopeIn.itemId === "string") scope.itemId = scopeIn.itemId;
    if (typeof scopeIn.audienceEntryId === "string") scope.audienceEntryId = scopeIn.audienceEntryId;
    out.push({ code: code as SchoolBlockReviewCode, message, scope });
  }
  return out;
}

/** Fyll inn dayId (og evt. itemId) på flagg som mangler dem; bevar eksisterende scope. */
function withScope(
  flags: SchoolBlockReviewFlag[],
  dayId: string,
  itemId?: string,
): SchoolBlockReviewFlag[] {
  return flags.map((f) => ({
    code: f.code,
    message: f.message,
    scope: {
      dayId: f.scope.dayId ?? dayId,
      ...(f.scope.itemId ?? itemId ? { itemId: f.scope.itemId ?? itemId } : {}),
      ...(f.scope.audienceEntryId ? { audienceEntryId: f.scope.audienceEntryId } : {}),
    },
  }));
}

/* ── Dagsscope ────────────────────────────────────────────────────────────── */

type DayScope = {
  key: string;
  date: string | null;
  weekdayIndex: SchoolProfileWeekdayIndex | null;
  dayLabel: string | null;
  scopeReviewCodes: SchoolBlockReviewCode[];
};

/**
 * Løs dagsscope. Dato er autoritativ når den finnes (ukedag avledes av datoen). En eksplisitt,
 * motstridende weekdayIndex forkastes ALDRI stille — datoen vinner, men dagen flagges `low_confidence`.
 * Ingen dato → weekdayIndex → dayLabel-avledet ukedag → ren dayLabel. `null` når ingen scope finnes.
 */
function resolveDayScope(raw: RawCanonicalSchoolDay): DayScope | null {
  const isoDate = normalizeSchoolDateToIso(raw.date ?? null);
  const rawWeekday = normalizeSchoolWeekdayIndex(raw.weekdayIndex ?? null);
  const dayLabel = trimToNull(raw.dayLabel);
  const scopeReviewCodes: SchoolBlockReviewCode[] = [];

  if (isoDate) {
    const fromDate = schoolWeekdayIndexFromIsoDate(isoDate);
    if (rawWeekday !== null && (fromDate === null || fromDate !== rawWeekday)) {
      scopeReviewCodes.push("low_confidence");
    }
    return { key: `date:${isoDate}`, date: isoDate, weekdayIndex: fromDate, dayLabel, scopeReviewCodes };
  }
  const wk = rawWeekday ?? weekdayFromLabel(dayLabel);
  if (wk !== null) {
    return { key: `weekday:${wk}`, date: null, weekdayIndex: wk, dayLabel, scopeReviewCodes };
  }
  if (dayLabel !== null) {
    return { key: `label:${dayLabel}`, date: null, weekdayIndex: null, dayLabel, scopeReviewCodes };
  }
  return null;
}

function dayLabelForScope(weekdayIndex: SchoolProfileWeekdayIndex | null, fallback: string | null): string | null {
  if (weekdayIndex !== null) return CANONICAL_WEEKDAY_LABELS[weekdayIndex];
  return fallback;
}

/** dayResolution er ALLTID avledet av dayOperation (invariant, kan aldri drifte). */
function resolutionForOperation(op: SchoolBlockDayOperation): SchoolBlockDayResolution {
  switch (op.op) {
    case "replace_day":
      return "full_replace";
    case "adjust_start":
    case "adjust_end":
      return "hours_adjusted";
    case "none":
      return "enrich_only";
  }
}

/* ── dayOperation-normalisering ───────────────────────────────────────────── */

/**
 * Runtime-normaliser en rå dagsoperasjon (tar `unknown`). Ugyldig påkrevd tid → degrader til
 * `none` + `missing_time`. Ukjent `activityKind` → konservativ `"other"` + `unrecognized_activity`.
 * Tid konstrueres aldri; confidence clampes; reason normaliseres.
 */
function normalizeDayOperation(raw: unknown): {
  op: SchoolBlockDayOperation;
  reviewCodes: SchoolBlockReviewCode[];
} {
  const codes: SchoolBlockReviewCode[] = [];
  if (!raw || typeof raw !== "object") return { op: { op: "none" }, reviewCodes: codes };
  const o = raw as Record<string, unknown>;
  const opName = typeof o.op === "string" ? o.op : "none";
  const reason = trimToNull(o.reason);
  const confidence = clamp01(o.confidence);

  if (opName === "adjust_start") {
    const effectiveStart = normalizeSchoolTime(typeof o.effectiveStart === "string" ? o.effectiveStart : null);
    if (effectiveStart === null) {
      codes.push("missing_time");
      return { op: { op: "none" }, reviewCodes: codes };
    }
    return { op: { op: "adjust_start", effectiveStart, reason, confidence }, reviewCodes: codes };
  }
  if (opName === "adjust_end") {
    const effectiveEnd = normalizeSchoolTime(typeof o.effectiveEnd === "string" ? o.effectiveEnd : null);
    if (effectiveEnd === null) {
      codes.push("missing_time");
      return { op: { op: "none" }, reviewCodes: codes };
    }
    return { op: { op: "adjust_end", effectiveEnd, reason, confidence }, reviewCodes: codes };
  }
  if (opName === "replace_day") {
    let activityKind = validEnum<SchoolBlockActivityKind>(o.activityKind, ACTIVITY_KINDS, "other");
    if (!(typeof o.activityKind === "string" && ACTIVITY_KINDS.has(o.activityKind as SchoolBlockActivityKind))) {
      codes.push("unrecognized_activity");
      activityKind = "other";
    }
    const effectiveStart = normalizeSchoolTime(typeof o.effectiveStart === "string" ? o.effectiveStart : null);
    const effectiveEnd = normalizeSchoolTime(typeof o.effectiveEnd === "string" ? o.effectiveEnd : null);
    return { op: { op: "replace_day", activityKind, effectiveStart, effectiveEnd, reason, confidence }, reviewCodes: codes };
  }
  return { op: { op: "none" }, reviewCodes: codes };
}

/** Signatur som skiller ULIKE operasjoner (ignorerer reason/confidence). */
function operationSignature(op: SchoolBlockDayOperation): string {
  switch (op.op) {
    case "adjust_start":
      return `adjust_start|${op.effectiveStart}`;
    case "adjust_end":
      return `adjust_end|${op.effectiveEnd}`;
    case "replace_day":
      return `replace_day|${op.activityKind}|${op.effectiveStart ?? ""}|${op.effectiveEnd ?? ""}`;
    case "none":
      return "none";
  }
}

function operationConfidence(op: SchoolBlockDayOperation): number {
  return op.op === "none" ? 0 : op.confidence;
}

/**
 * Konfliktregel for flere rå-operasjoner i samme dagsscope (rekkefølge-uavhengig):
 * ignorer `none`; identiske ikke-none kollapses (høyest confidence, så minste reason); to ULIKE
 * ikke-none-signaturer → `none` + `conflicting_actions`.
 */
function resolveDayOperationConflict(ops: SchoolBlockDayOperation[]): {
  op: SchoolBlockDayOperation;
  reviewCodes: SchoolBlockReviewCode[];
} {
  const nonNone = ops.filter((o) => o.op !== "none");
  if (nonNone.length === 0) return { op: { op: "none" }, reviewCodes: [] };
  const bySig = new Map<string, SchoolBlockDayOperation>();
  for (const op of nonNone) {
    const sig = operationSignature(op);
    const existing = bySig.get(sig);
    if (!existing || isPreferredOp(op, existing)) bySig.set(sig, op);
  }
  if (bySig.size >= 2) return { op: { op: "none" }, reviewCodes: ["conflicting_actions"] };
  return { op: [...bySig.values()][0]!, reviewCodes: [] };
}

function isPreferredOp(candidate: SchoolBlockDayOperation, existing: SchoolBlockDayOperation): boolean {
  const cc = operationConfidence(candidate);
  const ec = operationConfidence(existing);
  if (cc !== ec) return cc > ec;
  const cr = candidate.op === "none" ? "" : candidate.reason ?? "";
  const er = existing.op === "none" ? "" : existing.reason ?? "";
  return cr < er;
}

/* ── Audience-normalisering (kun validering av EKSPLISITTE entries) ─────────── */

/**
 * Case-insensitiv dedup med DETERMINISTISK representant per nøkkel (leksikografisk minste variant
 * — f.eks. «2STC» før «2stc»), uavhengig av inputrekkefølge. Gruppene sorteres på nøkkel.
 */
function normalizeClassCodes(raw: readonly (string | null | undefined)[] | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, string[]>();
  for (const c of raw) {
    const t = typeof c === "string" ? c.trim() : "";
    if (!t) continue;
    const key = t.toLowerCase();
    const list = byKey.get(key);
    if (list) list.push(t);
    else byKey.set(key, [t]);
  }
  return [...byKey.keys()].sort().map((k) => [...byKey.get(k)!].sort()[0]!);
}

function audienceEntryMaterial(e: {
  classCodes: string[];
  pulje: string | null;
  start: string | null;
  end: string | null;
  room: string | null;
  teacher: string | null;
}): string {
  return serializeArray(e.classCodes) + serialize([e.pulje, e.start, e.end, e.room, e.teacher]);
}

/** Normaliser én rå audience-entry, eller `null` når den mangler gyldig klassekode. */
function normalizeAudienceEntry(raw: RawCanonicalAudienceEntry): SchoolBlockAudienceEntry | null {
  const classCodes = normalizeClassCodes(raw.classCodes);
  if (classCodes.length === 0) return null;
  const pulje = normalizeText(raw.pulje);
  const start = normalizeSchoolTime(raw.start ?? null);
  const end = normalizeSchoolTime(raw.end ?? null);
  const room = normalizeText(raw.room);
  const teacher = normalizeText(raw.teacher);
  const isChildAudience = typeof raw.isChildAudience === "boolean" ? raw.isChildAudience : null;
  const audienceEntryId = `school-audience-h${djb2Hex(
    audienceEntryMaterial({ classCodes, pulje, start, end, room, teacher }),
  )}`;
  return { audienceEntryId, classCodes, pulje, start, end, room, teacher, isChildAudience };
}

/* ── Subject-normalisering (eksplisitt / kanonisk — ALDRI tematisk gjetting) ── */

type SubjectResolution = {
  secure: boolean;
  subject: string | null;
  subjectKey: string | null;
  customLabel: string | null;
};

function resolveSubject(raw: RawCanonicalSchoolItem): SubjectResolution {
  const explicitKey = trimToNull(raw.subjectKey);
  const canonical = canonicalizeSubjectFromStrings([
    typeof raw.subjectKey === "string" ? raw.subjectKey : null,
    typeof raw.subject === "string" ? raw.subject : null,
    typeof raw.customLabel === "string" ? raw.customLabel : null,
  ]);
  const customLabel = normalizeText(raw.customLabel);
  if (explicitKey && slugifySubjectKey(explicitKey)) {
    return { secure: true, subjectKey: explicitKey, subject: canonical?.displayName ?? normalizeText(raw.subject), customLabel };
  }
  if (canonical) {
    return { secure: true, subjectKey: canonical.subjectKey, subject: canonical.displayName, customLabel };
  }
  return { secure: false, subjectKey: null, subject: normalizeText(raw.subject), customLabel };
}

/* ── Element-ID ───────────────────────────────────────────────────────────── */

/** Kilde-fakta: dagsscope + kildegrunnlag (sourceRef → evidence → sourceText → stabil null). */
function sourceIdFor(dayKey: string, sourceBasis: string | null): string {
  return `school-source-h${djb2Hex(serialize([dayKey, sourceBasis]))}`;
}

/** Full semantisk identitet: kilde-fakta + plassering + type/handling/tid/audience/fag. */
function itemIdFor(item: {
  sourceId: string;
  placement: CanonicalPlacement;
  contentType: SchoolBlockContentType;
  action: SchoolBlockElementAction;
  subjectKey: string | null;
  start: string | null;
  end: string | null;
  audienceEntries: SchoolBlockAudienceEntry[];
}): string {
  const audienceMaterial = serializeArray(
    [...item.audienceEntries]
      .map((a) =>
        audienceEntryMaterial({
          classCodes: a.classCodes,
          pulje: a.pulje,
          start: a.start,
          end: a.end,
          room: a.room,
          teacher: a.teacher,
        }),
      )
      .sort(),
  );
  return `school-item-h${djb2Hex(
    serialize([
      item.sourceId,
      item.placement,
      item.contentType,
      item.action,
      item.subjectKey,
      item.start,
      item.end,
    ]) + audienceMaterial,
  )}`;
}

/* ── Deep-clone + deterministisk dedup av understrukturer ──────────────────── */

/** Alle array-feltene i SchoolBlockSections (arver SchoolWeekOverlaySections + descriptionLines). */
const SECTION_KEYS = [
  "iTimen",
  "lekse",
  "husk",
  "proveVurdering",
  "ressurser",
  "ekstraBeskjed",
  "descriptionLines",
] as const;

/** Dyp-klon + konservativ normalisering av sections. Nye arrays; ingen mutable inputreferanse. */
function cloneSections(raw: SchoolBlockSections | undefined): SchoolBlockSections {
  const out: SchoolBlockSections = {};
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const k of SECTION_KEYS) {
    const arr = src[k];
    if (!Array.isArray(arr)) continue;
    const cleaned = arr.map((v) => normalizeText(v)).filter((v): v is string => v !== null);
    if (cleaned.length > 0) (out as Record<string, string[]>)[k] = cleaned;
  }
  return out;
}

/**
 * Slå sammen to sections: unike verdier per felt, deterministisk (leksikografisk) sortert og nye
 * arrays. Sorteringen gjør fletting KOMMUTATIV (uavhengig av argumentrekkefølge) — nødvendig for
 * at duplikat-merge skal gi identisk output i begge inputrekkefølger.
 */
function mergeSections(a: SchoolBlockSections, b: SchoolBlockSections): SchoolBlockSections {
  const out: SchoolBlockSections = {};
  const aRec = a as Record<string, string[] | undefined>;
  const bRec = b as Record<string, string[] | undefined>;
  for (const k of SECTION_KEYS) {
    const merged = [...new Set([...(aRec[k] ?? []), ...(bRec[k] ?? [])])].sort();
    if (merged.length > 0) (out as Record<string, string[]>)[k] = merged;
  }
  return out;
}

/** Dyp-klon + dedup (per subjectKey, høyest weight) + stabil sortering (weight desc, key asc). */
function normalizeCandidates(
  raw: readonly SchoolProfileLessonCandidate[] | undefined,
): SchoolProfileLessonCandidate[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const byKey = new Map<string, SchoolProfileLessonCandidate>();
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const subjectKey = typeof c.subjectKey === "string" ? c.subjectKey : null;
    if (!subjectKey) continue;
    const subject = typeof c.subject === "string" ? c.subject : "";
    const weight = Number.isFinite(c.weight) ? Number(c.weight) : 0;
    const existing = byKey.get(subjectKey);
    // Høyest weight vinner; ved lik weight velges minste subject (deterministisk, kommutativt).
    if (!existing || weight > existing.weight || (weight === existing.weight && subject < existing.subject)) {
      byKey.set(subjectKey, { subjectKey, subject, weight });
    }
  }
  if (byKey.size === 0) return undefined;
  return [...byKey.values()].sort((x, y) =>
    x.weight !== y.weight ? y.weight - x.weight : x.subjectKey < y.subjectKey ? -1 : x.subjectKey > y.subjectKey ? 1 : 0,
  );
}

function mergeCandidates(
  a: readonly SchoolProfileLessonCandidate[] | undefined,
  b: readonly SchoolProfileLessonCandidate[] | undefined,
): SchoolProfileLessonCandidate[] | undefined {
  return normalizeCandidates([...(a ?? []), ...(b ?? [])]);
}

/** Full, deterministisk audience-nøkkel (rekkefølge-uavhengig sortering av entries). */
function compareAudienceEntries(a: SchoolBlockAudienceEntry, b: SchoolBlockAudienceEntry): number {
  const ak = a.classCodes.join(" ");
  const bk = b.classCodes.join(" ");
  if (ak !== bk) return ak < bk ? -1 : 1;
  const fields: [string | null, string | null][] = [
    [a.pulje, b.pulje],
    [a.start, b.start],
    [a.end, b.end],
    [a.room, b.room],
    [a.teacher, b.teacher],
  ];
  for (const [x, y] of fields) {
    const c = compareKnownFirst(x, y);
    if (c !== 0) return c;
  }
  return a.audienceEntryId < b.audienceEntryId ? -1 : a.audienceEntryId > b.audienceEntryId ? 1 : 0;
}

/** Slå sammen audience-entries på audienceEntryId; isChildAudience deterministisk (true+false→null). */
function mergeAudienceEntries(
  a: SchoolBlockAudienceEntry[],
  b: SchoolBlockAudienceEntry[],
): SchoolBlockAudienceEntry[] {
  const byId = new Map<string, SchoolBlockAudienceEntry>();
  for (const e of [...a, ...b]) {
    const existing = byId.get(e.audienceEntryId);
    if (!existing) {
      byId.set(e.audienceEntryId, { ...e, classCodes: [...e.classCodes] });
      continue;
    }
    let isChild = existing.isChildAudience;
    if (existing.isChildAudience !== e.isChildAudience) {
      if (existing.isChildAudience === null) isChild = e.isChildAudience;
      else if (e.isChildAudience === null) isChild = existing.isChildAudience;
      else isChild = null; // true vs false → uavklart
    }
    byId.set(e.audienceEntryId, { ...existing, isChildAudience: isChild });
  }
  return [...byId.values()].sort(compareAudienceEntries);
}

/** Leksikografisk minste ikke-null verdi (deterministisk, rekkefølge-uavhengig). */
function pickMinNonNull(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a <= b ? a : b;
}

/**
 * Slå sammen to kanoniske elementer med SAMME itemId (deterministisk, rekkefølge-uavhengig).
 * ID-ene (sourceId/itemId/audienceEntryId) er per definisjon like og endres ikke. Kun metadata
 * kombineres: høyeste confidence, unik evidence, merge av sections/subjectCandidates/audience/flagg,
 * og leksikografisk-minste blant kompatible tekstverdier.
 */
function mergeCanonicalItems(
  existing: CanonicalSchoolContentItem,
  incoming: CanonicalSchoolContentItem,
): CanonicalSchoolContentItem {
  const extraFlags: SchoolBlockReviewFlag[] = [];
  // sourceRef: foretrekk ikke-null; ulike ikke-null (svært usannsynlig gitt ID-design) → min + flagg.
  let sourceRef: string | null;
  if (existing.sourceRef !== null && incoming.sourceRef !== null && existing.sourceRef !== incoming.sourceRef) {
    sourceRef = pickMinNonNull(existing.sourceRef, incoming.sourceRef);
    extraFlags.push({
      code: "low_confidence",
      message: "Flere ulike kildepekere for samme element – valgt deterministisk.",
      scope: { dayId: existing.reviewFlags[0]?.scope.dayId, itemId: existing.itemId },
    });
  } else {
    sourceRef = existing.sourceRef ?? incoming.sourceRef;
  }

  const subjectCandidates = mergeCandidates(existing.subjectCandidates, incoming.subjectCandidates);

  return {
    ...existing,
    sourceRef,
    subject: pickMinNonNull(existing.subject, incoming.subject),
    subjectKey: existing.subjectKey ?? incoming.subjectKey,
    customLabel: pickMinNonNull(existing.customLabel, incoming.customLabel),
    ...(subjectCandidates ? { subjectCandidates } : {}),
    audienceEntries: mergeAudienceEntries(existing.audienceEntries, incoming.audienceEntries),
    sections: mergeSections(existing.sections, incoming.sections),
    sourceText: pickMinNonNull(existing.sourceText, incoming.sourceText),
    evidence: combineEvidence([existing.evidence, incoming.evidence]),
    confidence: Math.max(existing.confidence, incoming.confidence),
    reviewFlags: dedupeAndSortFlags([...existing.reviewFlags, ...incoming.reviewFlags, ...extraFlags]),
  };
}

/* ── Item-normalisering ───────────────────────────────────────────────────── */

const AMBIGUOUS_SUBJECT_MESSAGE =
  "Fagtilknytning kunne ikke bevises – bevart som generell dagsinformasjon.";
const UNRESOLVED_AUDIENCE_MESSAGE =
  "Ingen gyldig klasse-/puljeoppføring – bevart som generell dagsinformasjon.";

type BuiltItem = { item: CanonicalSchoolContentItem; bucket: CanonicalPlacement };

/**
 * Normaliser ett rå element til et kanonisk element + samling. Konservativ degradering: usikkert
 * fag / manglende audience → `generalDayMessages` (placement "day"). Ved degradering endres BARE
 * plasseringen — contentType/action/sections/sourceText/evidence/confidence/tid/subjectCandidates
 * og eksisterende review-flagg beholdes. sourceText/evidence kastes ALDRI.
 */
function buildItem(raw: RawCanonicalSchoolItem, dayScope: DayScope, dayId: string): BuiltItem {
  const sections: SchoolBlockSections = cloneSections(raw.sections);
  const sourceText = normalizeText(raw.sourceText);
  const sourceRef = normalizeText(raw.sourceRef);
  const evidence = normalizeText(raw.evidence);
  const confidence = clamp01(raw.confidence);
  const start = normalizeSchoolTime(raw.start ?? null);
  const end = normalizeSchoolTime(raw.end ?? null);
  const contentType = validEnum<SchoolBlockContentType>(raw.contentType, CONTENT_TYPES, "message");
  const action = validEnum<SchoolBlockElementAction>(raw.action, ACTIONS, "enrich");
  const placement = validEnum<CanonicalPlacement>(raw.placement, PLACEMENTS, "day");
  const rawFlags = normalizeRawFlags(raw.reviewFlags);
  const subjectCandidates = normalizeCandidates(raw.subjectCandidates);

  // Kildegrunnlag for sourceId: eksplisitt sourceRef → evidence → sourceText → stabil null.
  const sourceBasis = sourceRef ?? evidence ?? sourceText;
  const sourceId = sourceIdFor(dayScope.key, sourceBasis);

  const finish = (params: {
    bucket: CanonicalPlacement;
    subject: string | null;
    subjectKey: string | null;
    customLabel: string | null;
    audienceEntries: SchoolBlockAudienceEntry[];
    generatedCode: SchoolBlockReviewCode | null;
    generatedMessage: string | null;
  }): BuiltItem => {
    const itemId = itemIdFor({
      sourceId,
      placement: params.bucket,
      contentType,
      action,
      subjectKey: params.subjectKey,
      start,
      end,
      audienceEntries: params.audienceEntries,
    });
    const generated: SchoolBlockReviewFlag[] = params.generatedCode
      ? [{ code: params.generatedCode, message: params.generatedMessage ?? "", scope: { dayId, itemId } }]
      : [];
    const reviewFlags = dedupeAndSortFlags([...withScope(rawFlags, dayId, itemId), ...generated]);
    const item: CanonicalSchoolContentItem = {
      sourceId,
      itemId,
      sourceRef,
      placement: params.bucket,
      contentType,
      action,
      subject: params.subject,
      subjectKey: params.subjectKey,
      customLabel: params.customLabel,
      ...(subjectCandidates ? { subjectCandidates } : {}),
      start,
      end,
      audienceEntries: params.audienceEntries,
      sections,
      sourceText,
      evidence,
      confidence,
      reviewFlags,
    };
    return { item, bucket: params.bucket };
  };

  if (placement === "subject") {
    const s = resolveSubject(raw);
    if (s.secure) {
      return finish({
        bucket: "subject",
        subject: s.subject,
        subjectKey: s.subjectKey,
        customLabel: s.customLabel,
        audienceEntries: [],
        generatedCode: null,
        generatedMessage: null,
      });
    }
    // Usikkert fag → degrader KUN plassering; behold contentType/sections/tid. Uløst fagtekst
    // bevares som customLabel (ikke fremstilt som sikkert fag).
    return finish({
      bucket: "day",
      subject: null,
      subjectKey: null,
      customLabel: s.customLabel ?? s.subject,
      audienceEntries: [],
      generatedCode: "ambiguous_subject",
      generatedMessage: AMBIGUOUS_SUBJECT_MESSAGE,
    });
  }

  if (placement === "audience") {
    const entries = (Array.isArray(raw.audienceEntries) ? raw.audienceEntries : [])
      .map(normalizeAudienceEntry)
      .filter((e): e is SchoolBlockAudienceEntry => e !== null)
      .sort(compareAudienceEntries); // deterministisk rekkefølge (uavhengig av inputrekkefølge)
    if (entries.length > 0) {
      return finish({
        bucket: "audience",
        subject: null,
        subjectKey: null,
        customLabel: normalizeText(raw.customLabel),
        audienceEntries: entries,
        generatedCode: null,
        generatedMessage: null,
      });
    }
    // Ingen gyldig audience → degrader KUN plassering (behold contentType/sections/tid).
    return finish({
      bucket: "day",
      subject: null,
      subjectKey: null,
      customLabel: normalizeText(raw.customLabel),
      audienceEntries: [],
      generatedCode: "low_confidence",
      generatedMessage: UNRESOLVED_AUDIENCE_MESSAGE,
    });
  }

  return finish({
    bucket: "day",
    subject: null,
    subjectKey: null,
    customLabel: normalizeText(raw.customLabel),
    audienceEntries: [],
    generatedCode: null,
    generatedMessage: null,
  });
}

/* ── Sortering ────────────────────────────────────────────────────────────── */

function compareKnownFirst(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function compareItems(a: CanonicalSchoolContentItem, b: CanonicalSchoolContentItem): number {
  const s = compareKnownFirst(a.start, b.start);
  if (s !== 0) return s;
  const e = compareKnownFirst(a.end, b.end);
  if (e !== 0) return e;
  if (a.contentType !== b.contentType) return a.contentType < b.contentType ? -1 : 1;
  const sk = compareKnownFirst(a.subjectKey, b.subjectKey);
  if (sk !== 0) return sk;
  const st = compareKnownFirst(a.sourceText, b.sourceText);
  if (st !== 0) return st;
  if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
  return 0;
}

function compareDays(a: CanonicalSchoolDay, b: CanonicalSchoolDay): number {
  const aDated = a.date !== null;
  const bDated = b.date !== null;
  if (aDated !== bDated) return aDated ? -1 : 1;
  if (aDated && a.date !== b.date) return a.date! < b.date! ? -1 : 1;
  const aw = a.weekdayIndex ?? "~";
  const bw = b.weekdayIndex ?? "~";
  if (aw !== bw) return aw < bw ? -1 : 1;
  const al = a.dayLabel ?? "";
  const bl = b.dayLabel ?? "";
  if (al !== bl) return al < bl ? -1 : 1;
  if (a.dayId !== b.dayId) return a.dayId < b.dayId ? -1 : 1;
  return 0;
}

/** Kombiner ikke-null evidence-strenger deterministisk (unikt, sortert, linjeskilt). */
function combineEvidence(values: (string | null)[]): string | null {
  const uniq = [...new Set(values.filter((v): v is string => v !== null))].sort();
  return uniq.length > 0 ? uniq.join("\n") : null;
}

/* ── Normaliserer ─────────────────────────────────────────────────────────── */

type DayGroup = {
  scope: DayScope;
  rawDays: RawCanonicalSchoolDay[];
};

/**
 * Deterministisk normaliserer for den kanoniske skoleinnholdsmodellen. Muterer ALDRI input.
 * Grupperer rå-dager på løst dagsscope (maks én kanonisk dag per scope), plasserer hvert element
 * i nøyaktig én samling, degraderer usikkert fag/audience konservativt (kun plassering), validerer
 * enumfelt i runtime, normaliserer dagsoperasjoner, dedupliserer på `itemId` og sorterer stabilt.
 */
export function normalizeCanonicalSchoolContentDraft(
  raw: RawCanonicalSchoolContentInput,
): CanonicalSchoolContentDraft {
  // 1) Grupper rå-dager på løst scope (rekkefølge-uavhengig ved bygging; sorteres til slutt).
  const groups = new Map<string, DayGroup>();
  for (const rawDay of raw.days ?? []) {
    const scope = resolveDayScope(rawDay);
    if (!scope) continue;
    const existing = groups.get(scope.key);
    if (existing) {
      existing.rawDays.push(rawDay);
      for (const c of scope.scopeReviewCodes) existing.scope.scopeReviewCodes.push(c);
    } else {
      groups.set(scope.key, { scope: { ...scope, scopeReviewCodes: [...scope.scopeReviewCodes] }, rawDays: [rawDay] });
    }
  }

  const days: CanonicalSchoolDay[] = [];
  for (const { scope, rawDays } of groups.values()) {
    const dayId = `school-day-h${djb2Hex(serialize(["school-day", scope.key]))}`;

    // 2) Løs dagsoperasjon på tvers av gruppens rå-dager.
    const opResults = rawDays.map((d) => normalizeDayOperation(d.dayOperation));
    const conflict = resolveDayOperationConflict(opResults.map((r) => r.op));
    const opReviewCodes = [...opResults.flatMap((r) => r.reviewCodes), ...conflict.reviewCodes];

    // 3) Bygg alle items; ved samme itemId (full identitet) slås metadata deterministisk sammen
    //    (høyeste confidence, unik evidence/sections/candidates/flagg) — ikke «første vinner».
    const byItemId = new Map<string, BuiltItem>();
    for (const d of rawDays) {
      for (const rawItem of d.items ?? []) {
        const built = buildItem(rawItem, scope, dayId);
        const existing = byItemId.get(built.item.itemId);
        if (!existing) {
          byItemId.set(built.item.itemId, built);
        } else {
          byItemId.set(built.item.itemId, {
            item: mergeCanonicalItems(existing.item, built.item),
            bucket: existing.bucket,
          });
        }
      }
    }
    const subjectItems: CanonicalSchoolContentItem[] = [];
    const audienceItems: CanonicalSchoolContentItem[] = [];
    const generalDayMessages: CanonicalSchoolContentItem[] = [];
    for (const { item, bucket } of byItemId.values()) {
      if (bucket === "subject") subjectItems.push(item);
      else if (bucket === "audience") audienceItems.push(item);
      else generalDayMessages.push(item);
    }
    subjectItems.sort(compareItems);
    audienceItems.sort(compareItems);
    generalDayMessages.sort(compareItems);

    // 4) Samle review-flagg (scope + op + rå-dag + item), alle scoped med dayId, dedup+sort.
    const dayLevelCodes = [...new Set([...scope.scopeReviewCodes, ...opReviewCodes])];
    const generatedDayFlags: SchoolBlockReviewFlag[] = dayLevelCodes.map((code) => ({
      code,
      message: dayLevelFlagMessage(code),
      scope: { dayId },
    }));
    const rawDayFlags = withScope(normalizeRawFlags(rawDays.flatMap((d) => d.reviewFlags ?? [])), dayId);
    const itemFlags = [...subjectItems, ...audienceItems, ...generalDayMessages].flatMap((i) => i.reviewFlags);
    const dayReviewFlags = dedupeAndSortFlags([...generatedDayFlags, ...rawDayFlags, ...itemFlags]);

    days.push({
      dayId,
      date: scope.date,
      weekdayIndex: scope.weekdayIndex,
      dayLabel: dayLabelForScope(scope.weekdayIndex, scope.dayLabel),
      dayOperation: conflict.op,
      dayResolution: resolutionForOperation(conflict.op),
      subjectItems,
      audienceItems,
      generalDayMessages,
      confidence: Math.max(0, ...rawDays.map((d) => clamp01(d.confidence))),
      evidence: combineEvidence(rawDays.map((d) => normalizeText(d.evidence))),
      reviewFlags: dayReviewFlags,
    });
  }

  days.sort(compareDays);

  const topFlags = withScopeTopLevel(normalizeRawFlags(raw.reviewFlags));
  const reviewFlags = dedupeAndSortFlags([...topFlags, ...days.flatMap((d) => d.reviewFlags)]);
  const structureStatus: SchoolBlockStructureStatus = reviewFlags.length > 0 ? "review_required" : "complete";

  return {
    schemaVersion: "1.0.0",
    sourceTitle: trimToNull(raw.sourceTitle) ?? "Skoleinformasjon",
    originalSourceType: trimToNull(raw.originalSourceType) ?? "unknown",
    personId: trimToNull(raw.personId),
    personMatchStatus: validEnum<PortalEventPersonMatchStatus>(raw.personMatchStatus, PERSON_MATCH, "not_specified"),
    classCode: trimToNull(raw.classCode),
    days,
    structureStatus,
    reviewFlags,
  };
}

/** Toppnivå-flagg beholder eget scope (ingen dayId påtvinges). */
function withScopeTopLevel(flags: SchoolBlockReviewFlag[]): SchoolBlockReviewFlag[] {
  return flags.map((f) => ({ code: f.code, message: f.message, scope: { ...f.scope } }));
}

function dayLevelFlagMessage(code: SchoolBlockReviewCode): string {
  switch (code) {
    case "low_confidence":
      return "Strukturell usikkerhet på dagsnivå (f.eks. dato/ukedag-avvik).";
    case "missing_time":
      return "Dagsoperasjonen manglet et gyldig klokkeslett og ble nedgradert.";
    case "unrecognized_activity":
      return "Ukjent aktivitetstype for erstatningsdag – behandlet konservativt som «other».";
    case "conflicting_actions":
      return "Flere motstridende dagsoperasjoner for samme dag – ingen ble valgt automatisk.";
    default:
      return "Strukturell usikkerhet på dagsnivå.";
  }
}
