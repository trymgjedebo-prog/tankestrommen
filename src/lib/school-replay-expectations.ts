/**
 * Expectations-format for semantisk evaluering av canonical skole-replay: en LITEN, eksplisitt,
 * diskriminert union med fem check-typer som mapper ENTYDIG til én feilkategori hver:
 *
 *   day_operation      → DAY_OPERATION
 *   subject_placement  → SUBJECT_PLACEMENT
 *   language_exclusion → LANGUAGE_TRACK
 *   max_occurrences    → DUPLICATION
 *   source_coverage    → SOURCE_COVERAGE
 *
 * Kategorien AVLEDES av check-typen — expectations-JSON kan aldri sette/overstyre kategori.
 * Runtime-valideringen her er lett og dependency-fri (ingen Zod), med presise feil per check.
 * Ren modul: ingen filsystem/nettverk/env/klokke/tilfeldighet.
 */
import type { SchoolBlockActivityKind } from "@/lib/types";

export type SchoolReplayFailureCategory =
  | "DAY_OPERATION"
  | "SUBJECT_PLACEMENT"
  | "LANGUAGE_TRACK"
  | "DUPLICATION"
  | "SOURCE_COVERAGE";

export type SchoolReplayCheckKind =
  | "day_operation"
  | "subject_placement"
  | "language_exclusion"
  | "max_occurrences"
  | "source_coverage";

/** Én kilde til kategorimappingen — brukes av evaluatoren, aldri av JSON. */
export const CHECK_KIND_CATEGORY: Record<SchoolReplayCheckKind, SchoolReplayFailureCategory> = {
  day_operation: "DAY_OPERATION",
  subject_placement: "SUBJECT_PLACEMENT",
  language_exclusion: "LANGUAGE_TRACK",
  max_occurrences: "DUPLICATION",
  source_coverage: "SOURCE_COVERAGE",
};

type CheckBase = { id: string; description: string };

export type SchoolReplayDayOperationCheck = CheckBase & {
  kind: "day_operation";
  /** Eksakt ISO-dato for canonical-dagen. */
  date: string;
  expected: {
    op: "none" | "replace_day" | "adjust_start" | "adjust_end";
    /** Valgfri: sammenlignes KUN når oppgitt (relevant for replace_day). */
    activityKind?: SchoolBlockActivityKind;
    effectiveStart?: string;
    effectiveEnd?: string;
  };
};

export type SchoolReplaySubjectPlacementCheck = CheckBase & {
  kind: "subject_placement";
  date: string;
  subjectKey: string;
  textContains: string;
  /** Default 1. */
  minMatches?: number;
  maxMatches?: number;
};

export type SchoolReplayLanguageExclusionCheck = CheckBase & {
  kind: "language_exclusion";
  textContains: string;
  scope: "canonical_draft";
  date?: string;
  /** Typisk 0. */
  maxMatches: number;
};

export type SchoolReplayMaxOccurrencesCheck = CheckBase & {
  kind: "max_occurrences";
  textContains: string;
  scope: "canonical_draft";
  date?: string;
  maxMatches: number;
};

export type SchoolReplaySourceCoverageCheck = CheckBase & {
  kind: "source_coverage";
  subjectKey?: string;
  textContains: string;
  expectedCoverage: "full" | "partial";
  /** Default 1. */
  minMatches?: number;
};

export type SchoolReplaySemanticCheck =
  | SchoolReplayDayOperationCheck
  | SchoolReplaySubjectPlacementCheck
  | SchoolReplayLanguageExclusionCheck
  | SchoolReplayMaxOccurrencesCheck
  | SchoolReplaySourceCoverageCheck;

export type SchoolReplayExpectations = {
  schemaVersion: "1.0.0";
  fixtureId: string;
  /** Rapportens check-rekkefølge følger denne listen. */
  checks: SchoolReplaySemanticCheck[];
};

/* ── Lett runtime-validering (dependency-fri) ─────────────────────────────── */

const KINDS = new Set<SchoolReplayCheckKind>([
  "day_operation",
  "subject_placement",
  "language_exclusion",
  "max_occurrences",
  "source_coverage",
]);
const OPS = new Set(["none", "replace_day", "adjust_start", "adjust_end"]);
/**
 * UTTØMMENDE compile-time-kontrakt mot produksjonstypen: `satisfies Record<SchoolBlockActivityKind,
 * true>` gir TypeScript-feil både når et union-medlem MANGLER her og når et ekstra ugyldig medlem
 * legges til — listen kan ikke drive fra `SchoolBlockActivityKind`.
 */
const ACTIVITY_KIND_RECORD = {
  exam_day: true,
  trip_day: true,
  activity_day: true,
  free_day: true,
  other: true,
} satisfies Record<SchoolBlockActivityKind, true>;
const ACTIVITY_KIND_LIST = Object.keys(ACTIVITY_KIND_RECORD) as SchoolBlockActivityKind[];
const ACTIVITY_KINDS = new Set<string>(ACTIVITY_KIND_LIST);
const COVERAGES = new Set(["full", "partial"]);
const SCOPES = new Set(["canonical_draft"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkFail(index: number, id: string | null, message: string): never {
  const label = id ? `checks[${index}] (id "${id}")` : `checks[${index}]`;
  throw new Error(`Ugyldig school-replay-expectations: ${label}: ${message}`);
}

function requireNonEmptyString(v: unknown, index: number, id: string | null, field: string): string {
  if (typeof v !== "string" || v.trim() === "") checkFail(index, id, `'${field}' må være en ikke-tom streng.`);
  return v;
}
function requireIsoDate(v: unknown, index: number, id: string | null, field: string): string {
  const s = requireNonEmptyString(v, index, id, field);
  if (!ISO_DATE.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    checkFail(index, id, `'${field}' må være en gyldig ISO-dato (YYYY-MM-DD).`);
  }
  return s;
}
function requireCount(v: unknown, index: number, id: string | null, field: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    checkFail(index, id, `'${field}' må være et ikke-negativt heltall.`);
  }
  return v;
}

/** Valider ukjent JSON til `SchoolReplayExpectations`. Kaster presise feil med check-id/indeks. */
export function validateSchoolReplayExpectations(raw: unknown): SchoolReplayExpectations {
  if (!raw || typeof raw !== "object") throw new Error("Ugyldig school-replay-expectations: rot må være et objekt.");
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== "1.0.0") throw new Error('Ugyldig school-replay-expectations: schemaVersion må være "1.0.0".');
  if (typeof o.fixtureId !== "string" || o.fixtureId.trim() === "") {
    throw new Error("Ugyldig school-replay-expectations: 'fixtureId' må være en ikke-tom streng.");
  }
  if (!Array.isArray(o.checks)) throw new Error("Ugyldig school-replay-expectations: 'checks' må være en liste.");

  const seenIds = new Set<string>();
  const checks: SchoolReplaySemanticCheck[] = o.checks.map((rawCheck, index) => {
    if (!rawCheck || typeof rawCheck !== "object") checkFail(index, null, "check må være et objekt.");
    const c = rawCheck as Record<string, unknown>;
    const id = requireNonEmptyString(c.id, index, null, "id");
    if (seenIds.has(id)) checkFail(index, id, "duplisert check-id.");
    seenIds.add(id);
    requireNonEmptyString(c.description, index, id, "description");
    if (typeof c.kind !== "string" || !KINDS.has(c.kind as SchoolReplayCheckKind)) {
      checkFail(index, id, `'kind' må være en av: ${[...KINDS].join(", ")}.`);
    }
    // Kategori kan ALDRI settes i JSON (den avledes av kind).
    if ("category" in c) checkFail(index, id, "'category' er ikke tillatt i expectations — kategorien avledes av 'kind'.");

    const kind = c.kind as SchoolReplayCheckKind;
    if (kind === "day_operation") {
      requireIsoDate(c.date, index, id, "date");
      if (!c.expected || typeof c.expected !== "object") checkFail(index, id, "'expected' må være et objekt.");
      const e = c.expected as Record<string, unknown>;
      if (typeof e.op !== "string" || !OPS.has(e.op)) checkFail(index, id, `'expected.op' må være en av: ${[...OPS].join(", ")}.`);
      if (e.activityKind !== undefined && (typeof e.activityKind !== "string" || !ACTIVITY_KINDS.has(e.activityKind))) {
        checkFail(index, id, `'expected.activityKind' må være en av: ${ACTIVITY_KIND_LIST.join(", ")}.`);
      }
      // activityKind finnes kun på replace_day i produksjonstypen — andre kombinasjoner er ugyldige.
      if (e.activityKind !== undefined && e.op !== "replace_day") {
        checkFail(index, id, `'expected.activityKind' er bare tillatt når 'expected.op' er "replace_day".`);
      }
      if (e.effectiveStart !== undefined) requireNonEmptyString(e.effectiveStart, index, id, "expected.effectiveStart");
      if (e.effectiveEnd !== undefined) requireNonEmptyString(e.effectiveEnd, index, id, "expected.effectiveEnd");
    } else if (kind === "subject_placement") {
      requireIsoDate(c.date, index, id, "date");
      requireNonEmptyString(c.subjectKey, index, id, "subjectKey");
      requireNonEmptyString(c.textContains, index, id, "textContains");
      const min = c.minMatches === undefined ? 1 : requireCount(c.minMatches, index, id, "minMatches");
      const max = c.maxMatches === undefined ? undefined : requireCount(c.maxMatches, index, id, "maxMatches");
      if (max !== undefined && min > max) checkFail(index, id, "minMatches kan ikke være større enn maxMatches.");
    } else if (kind === "language_exclusion" || kind === "max_occurrences") {
      requireNonEmptyString(c.textContains, index, id, "textContains");
      if (typeof c.scope !== "string" || !SCOPES.has(c.scope)) checkFail(index, id, `'scope' må være en av: ${[...SCOPES].join(", ")}.`);
      if (c.date !== undefined) requireIsoDate(c.date, index, id, "date");
      requireCount(c.maxMatches, index, id, "maxMatches");
    } else {
      // source_coverage
      requireNonEmptyString(c.textContains, index, id, "textContains");
      if (c.subjectKey !== undefined) requireNonEmptyString(c.subjectKey, index, id, "subjectKey");
      if (typeof c.expectedCoverage !== "string" || !COVERAGES.has(c.expectedCoverage)) {
        checkFail(index, id, `'expectedCoverage' må være en av: ${[...COVERAGES].join(", ")}.`);
      }
      if (c.minMatches !== undefined) requireCount(c.minMatches, index, id, "minMatches");
    }
    return c as unknown as SchoolReplaySemanticCheck;
  });

  return { schemaVersion: "1.0.0", fixtureId: o.fixtureId, checks };
}
