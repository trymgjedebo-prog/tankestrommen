/**
 * REN semantisk evaluator: kjører deterministiske checks fra `expectations.json` mot et eksisterende
 * `SchoolCanonicalReplayResult` og produserer en klassifisert pass/fail-rapport. Bygger ALDRI replay
 * eller canonical output på nytt — den leser kun replay-resultatet.
 *
 * Kategori avledes ENTYDIG av check-typen (se `CHECK_KIND_CATEGORY`) — aldri av JSON.
 * Tekstmatching er KONSERVATIV substring-matching etter enkel normalisering (NFC + trim + kollaps
 * whitespace + case-insensitiv) — ingen fuzzy, ingen stemming, ingen modell.
 *
 * `canonical_draft`-scope søker KUN i de faktiske canonical item-samlingene (subjectItems,
 * audienceItems, generalDayMessages) — aldri i rå modellrespons, stage captures, normalized facts
 * eller evidence report. Et LOGISK item telles én gang selv om teksten finnes i flere felt.
 *
 * Ren: ingen filsystem/nettverk/env/logging/klokke/tilfeldighet; muterer aldri input.
 * Ingen totalscore — kun pass/fail per check + summering per kategori.
 */
import {
  CHECK_KIND_CATEGORY,
  type SchoolReplayExpectations,
  type SchoolReplayFailureCategory,
  type SchoolReplaySemanticCheck,
} from "@/lib/school-replay-expectations";
import type { SchoolCanonicalReplayResult } from "@/lib/school-canonical-replay";
import type { CanonicalSchoolContentItem, CanonicalSchoolDay } from "@/lib/school-content-canonical";

export type SchoolReplaySemanticCheckResult = {
  id: string;
  description: string;
  kind: SchoolReplaySemanticCheck["kind"];
  category: SchoolReplayFailureCategory;
  status: "pass" | "fail";
  expected: unknown;
  actual: unknown;
  /** Liten, målrettet kontekst — ALDRI hele replay-resultatet. */
  evidence: Record<string, unknown>;
};

export type SchoolReplaySemanticReport = {
  schemaVersion: "1.0.0";
  mode: "canonical_school_semantic_evaluation";
  fixtureId: string;
  replayMode: "canonical_school_replay";
  replayCoverage: SchoolCanonicalReplayResult["coverage"];
  passed: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
    byCategory: Record<SchoolReplayFailureCategory, { total: number; passed: number; failed: number }>;
  };
  /** Samme rekkefølge som i expectations.json. */
  checks: SchoolReplaySemanticCheckResult[];
};

/* ── Konservativ tekstnormalisering (NFC + trim + kollaps + lowercase) ─────── */

function normalizeMatchText(raw: string): string {
  return raw.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}
function textIncludes(haystack: string | null | undefined, needle: string): boolean {
  if (typeof haystack !== "string" || haystack === "") return false;
  return normalizeMatchText(haystack).includes(normalizeMatchText(needle));
}

/**
 * SYNLIGE tekstbærende felt på ett canonical item: sourceText + subject/customLabel + seksjonslinjer.
 * `item.evidence` (original kildecontainer, delt av alle items fra samme blob) er BEVISST utelatt —
 * den er kildeevidens, ikke synlig dagsinnhold, og ville gitt falske treff (f.eks. at et tysk-item
 * «inneholder» norsk-teksten fordi begge kommer fra samme details-blob).
 */
function itemTexts(item: CanonicalSchoolContentItem): string[] {
  const out: string[] = [];
  for (const v of [item.sourceText, item.subject, item.customLabel]) {
    if (typeof v === "string") out.push(v);
  }
  for (const lines of Object.values(item.sections)) {
    if (Array.isArray(lines)) for (const line of lines) if (typeof line === "string") out.push(line);
  }
  return out;
}
/** Ett LOGISK item matcher én gang uansett hvor mange felt teksten finnes i. */
function itemMatches(item: CanonicalSchoolContentItem, needle: string): boolean {
  return itemTexts(item).some((t) => textIncludes(t, needle));
}
function allDayItems(day: CanonicalSchoolDay): CanonicalSchoolContentItem[] {
  return [...day.subjectItems, ...day.audienceItems, ...day.generalDayMessages];
}

/* ── Evaluator ────────────────────────────────────────────────────────────── */

const CATEGORIES: SchoolReplayFailureCategory[] = [
  "DAY_OPERATION",
  "SUBJECT_PLACEMENT",
  "LANGUAGE_TRACK",
  "DUPLICATION",
  "SOURCE_COVERAGE",
];

export function evaluateSchoolReplaySemantics(
  replay: SchoolCanonicalReplayResult,
  expectations: SchoolReplayExpectations,
): SchoolReplaySemanticReport {
  const draft = replay.outputs.canonicalSchoolContentDraft;
  const days = draft?.days ?? [];
  const dayByDate = new Map<string, CanonicalSchoolDay>();
  for (const day of days) if (day.date !== null) dayByDate.set(day.date, day);

  const checks: SchoolReplaySemanticCheckResult[] = expectations.checks.map((check) => {
    const category = CHECK_KIND_CATEGORY[check.kind];
    const base = { id: check.id, description: check.description, kind: check.kind, category } as const;

    if (check.kind === "day_operation") {
      const day = dayByDate.get(check.date);
      const actualOp = day?.dayOperation ?? null;
      let status: "pass" | "fail" = "fail";
      if (day && actualOp && actualOp.op === check.expected.op) {
        const rec = actualOp as unknown as Record<string, unknown>;
        // activityKind sammenlignes KUN når forventningen oppgir feltet; manglende/feil kind → fail.
        const kindOk = check.expected.activityKind === undefined || rec.activityKind === check.expected.activityKind;
        const startOk = check.expected.effectiveStart === undefined || rec.effectiveStart === check.expected.effectiveStart;
        const endOk = check.expected.effectiveEnd === undefined || rec.effectiveEnd === check.expected.effectiveEnd;
        if (kindOk && startOk && endOk) status = "pass";
      }
      return {
        ...base,
        status,
        expected: check.expected,
        actual: actualOp,
        evidence: { date: check.date, dayFound: Boolean(day), draftPresent: draft !== null },
      };
    }

    if (check.kind === "subject_placement") {
      const day = dayByDate.get(check.date);
      // Søk KUN i dagens subjectItems med riktig subjectKey (feil fag ⇒ 0 treff ⇒ SUBJECT_PLACEMENT-fail).
      const matches = (day?.subjectItems ?? []).filter(
        (i) => i.subjectKey === check.subjectKey && itemMatches(i, check.textContains),
      );
      const min = check.minMatches ?? 1;
      const count = matches.length;
      const status = day && count >= min && (check.maxMatches === undefined || count <= check.maxMatches) ? "pass" : "fail";
      return {
        ...base,
        status,
        expected: { subjectKey: check.subjectKey, textContains: check.textContains, minMatches: min, maxMatches: check.maxMatches ?? null },
        actual: { matchCount: count },
        evidence: {
          date: check.date,
          dayFound: Boolean(day),
          subjectKey: check.subjectKey,
          matchCount: count,
          matchedItemIds: matches.map((i) => i.itemId),
          subjectKeysOnDay: [...new Set((day?.subjectItems ?? []).map((i) => i.subjectKey))],
        },
      };
    }

    if (check.kind === "language_exclusion" || check.kind === "max_occurrences") {
      // canonical_draft: kun de faktiske item-samlingene (aldri rådata/stages/facts/evidence-report).
      const scopeDays = check.date === undefined ? days : days.filter((d) => d.date === check.date);
      const matches = scopeDays.flatMap((d) => allDayItems(d).filter((i) => itemMatches(i, check.textContains)));
      const count = matches.length;
      const status = count <= check.maxMatches ? "pass" : "fail";
      return {
        ...base,
        status,
        expected: { textContains: check.textContains, scope: check.scope, maxMatches: check.maxMatches, date: check.date ?? null },
        actual: { matchCount: count },
        evidence: { matchCount: count, matchedItemIds: matches.map((i) => i.itemId), draftPresent: draft !== null },
      };
    }

    // source_coverage: søk i replayens normaliserte facts (subjectKey + faktiske tekstfelt + coverage).
    const facts = replay.outputs.normalizedSchoolContentFacts;
    const candidates = facts.filter(
      (f) =>
        (check.subjectKey === undefined || f.subjectKey === check.subjectKey) &&
        (textIncludes(f.text, check.textContains) || textIncludes(f.originalSourceText, check.textContains)),
    );
    const matches = candidates.filter((f) => f.sourceCoverage === check.expectedCoverage);
    const min = check.minMatches ?? 1;
    const status = matches.length >= min ? "pass" : "fail";
    return {
      ...base,
      status,
      expected: { subjectKey: check.subjectKey ?? null, textContains: check.textContains, expectedCoverage: check.expectedCoverage, minMatches: min },
      actual: { matchCount: matches.length, candidateCoverages: candidates.map((f) => f.sourceCoverage) },
      evidence: {
        subjectKey: check.subjectKey ?? null,
        candidateCount: candidates.length,
        matchCount: matches.length,
        candidateFactIds: candidates.map((f) => f.sourceFactId),
      },
    };
  });

  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, { total: 0, passed: 0, failed: 0 }]),
  ) as Record<SchoolReplayFailureCategory, { total: number; passed: number; failed: number }>;
  let passed = 0;
  for (const r of checks) {
    byCategory[r.category].total += 1;
    if (r.status === "pass") {
      passed += 1;
      byCategory[r.category].passed += 1;
    } else {
      byCategory[r.category].failed += 1;
    }
  }

  return {
    schemaVersion: "1.0.0",
    mode: "canonical_school_semantic_evaluation",
    fixtureId: expectations.fixtureId,
    replayMode: replay.mode,
    replayCoverage: replay.coverage,
    passed: passed === checks.length,
    summary: { total: checks.length, passed, failed: checks.length - passed, byCategory },
    checks,
  };
}
