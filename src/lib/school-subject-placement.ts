/**
 * Ren, deterministisk fagplassering for skoleinnhold. To UAVHENGIGE nivåer:
 *   1. FAGBESLUTNING  — er faget sikkert identifisert fra et EKSPLISITT faganker?
 *   2. ØKTBESLUTNING  — når faget er sikkert: kan én bestemt time i elevens faste
 *                       `schoolWeeklyProfile` matches (eller er den ikke nødvendig / uoppløst)?
 *
 * INVARIANT: tid alene skaper ALDRI fagtilknytning. Timeplanen brukes KUN etter at faget allerede
 * er sikkert identifisert fra eksplisitt subjectKey/fagnavn/entydig kandidat/customLabel — for å
 * disambiguere mellom flere økter av det samme faget. Ingen fritekst-/frasegjetting, ingen
 * tematisk likhet, ingen substring-matching. All spor-matching krever EKSAKT strukturert likhet.
 *
 * Modulen returnerer BARE en beslutning. Den bygger ingen `CanonicalSchoolContentItem`, genererer
 * ingen `sourceId`/`itemId`/`dayId`, og muterer aldri input. En senere adapter bruker beslutningen
 * som input til den kanoniske normalisereren (som regenererer `itemId` og bevarer `sourceId`).
 *
 * Ren: ingen Next.js/OpenAI/env/nettverk/sideeffekter. Importerer kun rene domenehelpers + typer.
 */
import {
  buildCustomSubjectKey,
  canonicalizeSubjectFromStrings,
  canonicalizeSubjectFromText,
  CUSTOM_SUBJECT_PREFIX,
  slugifySubjectKey,
} from "@/lib/school-subject";
import { normalizeSchoolTime, schoolTimeRangesOverlap, schoolTimeToMinutes } from "@/lib/school-time";
import type {
  SchoolBlockElementAction,
  SchoolBlockReviewCode,
  SchoolProfileLesson,
  SchoolProfileLessonCandidate,
  SchoolProfileWeekdayIndex,
  SchoolWeeklyProfile,
} from "@/lib/types";

/* ── Offentlige typer ─────────────────────────────────────────────────────── */

export interface SchoolSubjectPlacementInput {
  subjectKey: string | null;
  subject: string | null;
  customLabel: string | null;
  subjectCandidates?: readonly SchoolProfileLessonCandidate[];
  start: string | null;
  end: string | null;
  action: SchoolBlockElementAction;
}

export interface SchoolSubjectPlacementContext {
  weekdayIndex: SchoolProfileWeekdayIndex | null;
  schoolWeeklyProfile: SchoolWeeklyProfile | null;
}

/** Øktbeslutning (kun relevant når faget allerede er sikkert). */
export type SchoolLessonPlacementDecision =
  | {
      status: "matched";
      lesson: SchoolProfileLesson;
      reason: "only_lesson_for_subject" | "unique_time_match" | "unique_track_match";
    }
  | { status: "not_required"; reason: "subject_level_enrichment" }
  | {
      status: "unresolved";
      reason:
        | "profile_missing"
        | "simple_day_without_lessons"
        | "no_lesson_on_day"
        | "missing_time"
        | "no_time_overlap"
        | "ambiguous_lessons";
      reviewCode: SchoolBlockReviewCode | null;
    };

/** Samlet fagplasseringsbeslutning. */
export type SchoolSubjectPlacementDecision =
  | {
      status: "placed";
      subjectKey: string;
      subject: string | null;
      subjectSource:
        | "explicit_subject_key"
        | "explicit_subject"
        | "single_subject_candidate"
        | "explicit_custom_label";
      lessonDecision: SchoolLessonPlacementDecision;
      reviewCode: SchoolBlockReviewCode | null;
    }
  | {
      status: "unresolved";
      reason:
        | "missing_explicit_subject"
        | "unknown_subject"
        | "conflicting_explicit_subjects"
        | "ambiguous_subject_candidates";
      reviewCode: SchoolBlockReviewCode | null;
    };

/* ── Små rene helpers ─────────────────────────────────────────────────────── */

const ELEMENT_ACTIONS = new Set<SchoolBlockElementAction>(["enrich", "replace_range"]);
const WEEKDAY_INDICES = new Set<SchoolProfileWeekdayIndex>(["0", "1", "2", "3", "4"]);

function trimToNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

/** Trim + lowercase + kollaps whitespace til én token for EKSAKT strukturert likhet. */
function normToken(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return t === "" ? null : t;
}

/**
 * Deterministisk normalisering av et eksplisitt subjectKey: kjent kanonisk fag → kanonisk key;
 * allerede gyldig `custom:`-key → bevart (bindestrek-slug-body, prefikset intakt); vilkårlig
 * fritekst → stabil `custom:`-key via eksisterende helper (aldri rå streng med casing/mellomrom);
 * ellers `null`. Gir ALDRI ledende/avsluttende whitespace eller ustabil casing.
 */
function normalizeExplicitSubjectKey(explicitKey: string | null): string | null {
  if (explicitKey === null) return null;
  const canon = canonicalizeSubjectFromText(explicitKey);
  if (canon) return canon.subjectKey;
  if (explicitKey.startsWith(CUSTOM_SUBJECT_PREFIX)) {
    const slug = slugifySubjectKey(explicitKey.slice(CUSTOM_SUBJECT_PREFIX.length));
    return slug ? `${CUSTOM_SUBJECT_PREFIX}${slug}` : null;
  }
  return slugifySubjectKey(explicitKey) ? buildCustomSubjectKey(explicitKey) : null;
}

/* ── Fagbeslutning ────────────────────────────────────────────────────────── */

type SubjectAnchor =
  | {
      status: "resolved";
      subjectKey: string;
      subject: string | null;
      subjectSource:
        | "explicit_subject_key"
        | "explicit_subject"
        | "single_subject_candidate"
        | "explicit_custom_label";
    }
  | {
      status: "unresolved";
      reason:
        | "missing_explicit_subject"
        | "unknown_subject"
        | "conflicting_explicit_subjects"
        | "ambiguous_subject_candidates";
      reviewCode: SchoolBlockReviewCode | null;
    };

function chooseDisplay(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a <= b ? a : b;
}

/**
 * Dedupliser kandidater på NORMALISERT subjectKey (kanonisert eller stabil custom). Case-varianter
 * kollapser; visningsnavn velges deterministisk (kanonisk displayName, ellers minste tekst).
 * Vekt velger ALDRI. Rekkefølge-uavhengig; sortert på subjectKey.
 */
function distinctCandidates(
  raw: readonly SchoolProfileLessonCandidate[] | undefined,
): Array<{ subjectKey: string; subject: string | null }> {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, string | null>();
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const canon = canonicalizeSubjectFromStrings([
      typeof c.subjectKey === "string" ? c.subjectKey : null,
      typeof c.subject === "string" ? c.subject : null,
    ]);
    let normKey: string | null;
    let display: string | null;
    if (canon) {
      normKey = canon.subjectKey;
      display = canon.displayName;
    } else {
      normKey = normalizeExplicitSubjectKey(trimToNull(c.subjectKey));
      display = trimToNull(c.subject);
    }
    if (normKey === null) continue;
    const existing = byKey.get(normKey);
    byKey.set(normKey, existing === undefined ? display : chooseDisplay(existing, display));
  }
  return [...byKey.keys()].sort().map((k) => ({ subjectKey: k, subject: byKey.get(k) ?? null }));
}

/**
 * Løs et EKSPLISITT faganker konservativt. Prioritet: subjectKey → subject → én entydig
 * subjectCandidate → customLabel. To DEFINITIVE (kjente kanoniske) fag som motsier hverandre →
 * conflicting. Ukjent eksplisitt tekst → unknown. Ingen eksplisitt fagtekst → missing.
 */
function resolveSubjectAnchor(input: SchoolSubjectPlacementInput): SubjectAnchor {
  const explicitKey = trimToNull(input.subjectKey);
  const explicitSubject = trimToNull(input.subject);
  const explicitLabel = trimToNull(input.customLabel);

  // Konflikt vurderes KUN mellom to KJENTE kanoniske fag (definitive), ikke custom/ukjent.
  const canonFromKey = explicitKey ? canonicalizeSubjectFromText(explicitKey)?.subjectKey ?? null : null;
  const canonFromSubject = explicitSubject ? canonicalizeSubjectFromText(explicitSubject)?.subjectKey ?? null : null;
  if (canonFromKey !== null && canonFromSubject !== null && canonFromKey !== canonFromSubject) {
    return { status: "unresolved", reason: "conflicting_explicit_subjects", reviewCode: "ambiguous_subject" };
  }

  // 1) Eksplisitt subjectKey (normalisert; visningsnavn oppgraderes via kanonisering når mulig).
  const normalizedKey = normalizeExplicitSubjectKey(explicitKey);
  if (normalizedKey !== null) {
    const subject = canonicalizeSubjectFromStrings([explicitKey, explicitSubject, explicitLabel])?.displayName ?? null;
    return { status: "resolved", subjectKey: normalizedKey, subject, subjectSource: "explicit_subject_key" };
  }

  // 2) Eksplisitt fagnavn som kanoniseres sikkert.
  if (canonFromSubject !== null) {
    const canon = canonicalizeSubjectFromText(explicitSubject)!;
    return { status: "resolved", subjectKey: canon.subjectKey, subject: canon.displayName, subjectSource: "explicit_subject" };
  }

  // 3) Nøyaktig én entydig subjectCandidate (per normalisert subjectKey). Vekt velger ALDRI.
  const cands = distinctCandidates(input.subjectCandidates);
  if (cands.length === 1) {
    return { status: "resolved", subjectKey: cands[0]!.subjectKey, subject: cands[0]!.subject, subjectSource: "single_subject_candidate" };
  }
  if (cands.length >= 2) {
    return { status: "unresolved", reason: "ambiguous_subject_candidates", reviewCode: "ambiguous_subject" };
  }

  // 4) Eksplisitt customLabel som kan kanoniseres sikkert.
  if (explicitLabel !== null) {
    const canon = canonicalizeSubjectFromText(explicitLabel);
    if (canon) {
      return { status: "resolved", subjectKey: canon.subjectKey, subject: canon.displayName, subjectSource: "explicit_custom_label" };
    }
  }

  const hadExplicitText = explicitKey !== null || explicitSubject !== null || explicitLabel !== null;
  if (hadExplicitText) {
    return { status: "unresolved", reason: "unknown_subject", reviewCode: "ambiguous_subject" };
  }
  return { status: "unresolved", reason: "missing_explicit_subject", reviewCode: null };
}

/* ── Lesson-kandidater: normaliser + dedup + sorter (deterministisk clone) ──── */

function normalizeLessonCandidates(
  raw: readonly SchoolProfileLessonCandidate[] | undefined,
): SchoolProfileLessonCandidate[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const byKey = new Map<string, SchoolProfileLessonCandidate>();
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const canon = canonicalizeSubjectFromStrings([
      typeof c.subjectKey === "string" ? c.subjectKey : null,
      typeof c.subject === "string" ? c.subject : null,
    ]);
    const key = canon?.subjectKey ?? normalizeExplicitSubjectKey(trimToNull(c.subjectKey));
    if (key === null) continue;
    const subject = canon?.displayName ?? (typeof c.subject === "string" ? c.subject : "");
    const weight = Number.isFinite(c.weight) ? Number(c.weight) : 0;
    const ex = byKey.get(key);
    if (!ex || weight > ex.weight || (weight === ex.weight && subject < ex.subject)) {
      byKey.set(key, { subjectKey: key, subject, weight });
    }
  }
  if (byKey.size === 0) return undefined;
  return [...byKey.values()].sort((a, b) => (a.subjectKey < b.subjectKey ? -1 : a.subjectKey > b.subjectKey ? 1 : 0));
}

/** Stabil serialisering av normaliserte kandidater (tie-breaker + dedup-nøkkel). */
function serializeCandidates(cs: SchoolProfileLessonCandidate[] | undefined): string {
  return JSON.stringify((cs ?? []).map((c) => [c.subjectKey, c.subject, c.weight]));
}

/* ── Dagens lessons (streng dagsavgrensning) ──────────────────────────────── */

export type SchoolProfileDayLessons =
  | { kind: "lessons"; lessons: SchoolProfileLesson[] }
  | { kind: "profile_missing" }
  | { kind: "simple_day" };

function cloneLesson(l: SchoolProfileLesson): SchoolProfileLesson {
  const out: SchoolProfileLesson = {
    subjectKey: l.subjectKey,
    customLabel: l.customLabel,
    start: l.start,
    end: l.end,
  };
  if (l.room !== undefined) out.room = l.room;
  if (l.teacher !== undefined) out.teacher = l.teacher;
  if (l.lessonSubcategory !== undefined) out.lessonSubcategory = l.lessonSubcategory;
  if (l.subjectCandidates !== undefined) {
    const norm = normalizeLessonCandidates(l.subjectCandidates);
    if (norm) out.subjectCandidates = norm;
  }
  return out;
}

function cmp(a: string | null | undefined, b: string | null | undefined): number {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

function compareLessons(a: SchoolProfileLesson, b: SchoolProfileLesson): number {
  return (
    cmp(a.start, b.start) ||
    cmp(a.end, b.end) ||
    cmp(a.subjectKey, b.subjectKey) ||
    cmp(a.customLabel, b.customLabel) ||
    cmp(a.lessonSubcategory, b.lessonSubcategory) ||
    cmp(a.room, b.room) ||
    cmp(a.teacher, b.teacher) ||
    cmp(serializeCandidates(a.subjectCandidates), serializeCandidates(b.subjectCandidates))
  );
}

/**
 * Hent KUN den aktuelle dagens lessons (aldri en annen ukedag). Klonet (kandidater normalisert/
 * dedupet/sortert) og stabilt sortert. `useSimpleDay: true` → `simple_day`. Manglende profil /
 * ugyldig-manglende weekdayIndex → `profile_missing`. Ingen dagoppføring → tom lessons-liste.
 */
export function getSchoolProfileLessonsForWeekday(
  context: SchoolSubjectPlacementContext,
): SchoolProfileDayLessons {
  const profile = context.schoolWeeklyProfile;
  if (!profile || typeof profile !== "object") return { kind: "profile_missing" };
  const wk = context.weekdayIndex;
  if (wk === null || !WEEKDAY_INDICES.has(wk)) return { kind: "profile_missing" };
  const day = profile.weekdays?.[wk];
  if (!day || typeof day !== "object") return { kind: "lessons", lessons: [] };
  if (day.useSimpleDay === true) return { kind: "simple_day" };
  const lessons = Array.isArray(day.lessons) ? day.lessons : [];
  return { kind: "lessons", lessons: lessons.map(cloneLesson).sort(compareLessons) };
}

/* ── Track-tokens (komplett, strukturert, eksakt) ─────────────────────────── */

type SubjectSource =
  | "explicit_subject_key"
  | "explicit_subject"
  | "single_subject_candidate"
  | "explicit_custom_label";
type ResolvedAnchor = { subjectKey: string; subject: string | null; subjectSource: SubjectSource };

/**
 * Item-track-tokens fra EKSPLISITTE strukturer: customLabel + rå subjekttekst fra en sikker
 * item-kandidat som faktisk ankrer det løste faget. Tokens lik selve fagnavnet utelates (ikke spor).
 */
function itemTrackTokens(input: SchoolSubjectPlacementInput, anchor: ResolvedAnchor): Set<string> {
  const subjectToken = normToken(anchor.subject);
  const out = new Set<string>();
  const add = (s: string | null | undefined): void => {
    const t = normToken(s);
    if (t !== null && t !== subjectToken) out.add(t);
  };
  add(input.customLabel);
  for (const c of input.subjectCandidates ?? []) {
    if (!c || typeof c !== "object") continue;
    const canon = canonicalizeSubjectFromStrings([
      typeof c.subjectKey === "string" ? c.subjectKey : null,
      typeof c.subject === "string" ? c.subject : null,
    ]);
    const key = canon?.subjectKey ?? normalizeExplicitSubjectKey(trimToNull(c.subjectKey));
    if (key === anchor.subjectKey) add(typeof c.subject === "string" ? c.subject : null);
  }
  return out;
}

/**
 * Lesson-track-tokens fra EKSPLISITTE strukturer: lessonSubcategory + customLabel + normaliserte
 * subjectCandidates (både subjectKey og visningsverdi). Tokens lik lessonens eget fag utelates.
 */
function lessonTrackTokens(lesson: SchoolProfileLesson, subjectKey: string, subjectDisplay: string | null): Set<string> {
  const excl = new Set<string>();
  const sk = normToken(subjectKey);
  const sd = normToken(subjectDisplay);
  if (sk) excl.add(sk);
  if (sd) excl.add(sd);
  const out = new Set<string>();
  const add = (s: string | null | undefined): void => {
    const t = normToken(s);
    if (t !== null && !excl.has(t)) out.add(t);
  };
  add(lesson.lessonSubcategory ?? null);
  add(lesson.customLabel);
  for (const c of lesson.subjectCandidates ?? []) {
    add(c.subjectKey);
    add(c.subject);
  }
  return out;
}

function tokenSetsIntersect(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t)) return true;
  return false;
}

/* ── Øktbeslutning ────────────────────────────────────────────────────────── */

function noSessionDecision(
  action: SchoolBlockElementAction,
  reason: "profile_missing" | "simple_day_without_lessons" | "no_lesson_on_day",
): SchoolLessonPlacementDecision {
  if (action === "replace_range") return { status: "unresolved", reason, reviewCode: "low_confidence" };
  return { status: "not_required", reason: "subject_level_enrichment" };
}

/** Tidsmatch over et lesson-sett; presis beslutning (0/1/flere). */
function timeMatch(
  input: SchoolSubjectPlacementInput,
  lessons: SchoolProfileLesson[],
): SchoolLessonPlacementDecision {
  const start = normalizeSchoolTime(input.start);
  const end = normalizeSchoolTime(input.end);

  let matches: SchoolProfileLesson[];
  if (start !== null && end !== null) {
    matches = lessons.filter((l) => schoolTimeRangesOverlap(start, end, l.start, l.end));
  } else if (start !== null) {
    const m = schoolTimeToMinutes(start);
    matches = lessons.filter((l) => {
      const ls = schoolTimeToMinutes(l.start);
      const le = schoolTimeToMinutes(l.end);
      return m !== null && ls !== null && le !== null && ls <= m && m < le; // [start, end)
    });
  } else if (end !== null) {
    const m = schoolTimeToMinutes(end);
    matches = lessons.filter((l) => {
      const ls = schoolTimeToMinutes(l.start);
      const le = schoolTimeToMinutes(l.end);
      return m !== null && ls !== null && le !== null && ls < m && m <= le; // (start, end]
    });
  } else {
    return { status: "unresolved", reason: "missing_time", reviewCode: "missing_time" };
  }

  if (matches.length === 1) return { status: "matched", lesson: matches[0]!, reason: "unique_time_match" };
  if (matches.length === 0) return { status: "unresolved", reason: "no_time_overlap", reviewCode: "low_confidence" };
  return { status: "unresolved", reason: "ambiguous_lessons", reviewCode: "low_confidence" };
}

function resolveLessonDecision(
  anchor: ResolvedAnchor,
  input: SchoolSubjectPlacementInput,
  context: SchoolSubjectPlacementContext,
): SchoolLessonPlacementDecision {
  const action: SchoolBlockElementAction = ELEMENT_ACTIONS.has(input.action) ? input.action : "enrich";
  const day = getSchoolProfileLessonsForWeekday(context);

  if (day.kind === "profile_missing") return noSessionDecision(action, "profile_missing");
  if (day.kind === "simple_day") return noSessionDecision(action, "simple_day_without_lessons");

  const sameSubject = day.lessons.filter((l) => l.subjectKey === anchor.subjectKey);
  if (sameSubject.length === 0) return noSessionDecision(action, "no_lesson_on_day");
  if (sameSubject.length === 1) {
    return { status: "matched", lesson: sameSubject[0]!, reason: "only_lesson_for_subject" };
  }

  // Flere økter med samme fag → (1) eksakt strukturert spor, deretter (2) tid.
  const itemTokens = itemTrackTokens(input, anchor);
  let candidateSet = sameSubject;
  if (itemTokens.size > 0) {
    const trackMatches = sameSubject.filter((l) =>
      tokenSetsIntersect(itemTokens, lessonTrackTokens(l, anchor.subjectKey, anchor.subject)),
    );
    if (trackMatches.length === 1) {
      return { status: "matched", lesson: trackMatches[0]!, reason: "unique_track_match" };
    }
    if (trackMatches.length >= 2) candidateSet = trackMatches; // disambiguer på tid innen sporet
  }
  return timeMatch(input, candidateSet);
}

/* ── Offentlig API ────────────────────────────────────────────────────────── */

function placedReviewCode(lessonDecision: SchoolLessonPlacementDecision): SchoolBlockReviewCode | null {
  return lessonDecision.status === "unresolved" ? lessonDecision.reviewCode : null;
}

/**
 * Deterministisk fagplassering. Muterer aldri input. Faget plasseres KUN fra et eksplisitt anker;
 * tid disambiguerer bare mellom flere økter av det allerede sikre faget — tid alene skaper aldri fag.
 */
export function resolveSchoolSubjectPlacement(
  input: SchoolSubjectPlacementInput,
  context: SchoolSubjectPlacementContext,
): SchoolSubjectPlacementDecision {
  const anchor = resolveSubjectAnchor(input);
  if (anchor.status === "unresolved") {
    return { status: "unresolved", reason: anchor.reason, reviewCode: anchor.reviewCode };
  }
  const resolved: ResolvedAnchor = { subjectKey: anchor.subjectKey, subject: anchor.subject, subjectSource: anchor.subjectSource };
  const lessonDecision = resolveLessonDecision(resolved, input, context);
  return {
    status: "placed",
    subjectKey: anchor.subjectKey,
    subject: anchor.subject,
    subjectSource: anchor.subjectSource,
    lessonDecision,
    reviewCode: placedReviewCode(lessonDecision),
  };
}
