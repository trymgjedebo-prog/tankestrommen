/**
 * Batch-runner-tester: happy path over alle elleve ekte regression-fixtures (aggregatene
 * utledes av de individuelle rapportene — aldri hardkodet check-antall), determinisme,
 * fixtureId-mismatch som operasjonell feil, og firstFailure-/aggregerings-semantikk med
 * SYNTETISKE rapporter (ekte fixtures endres aldri for å lage røde tilfeller).
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  aggregateSchoolReplaySemanticBatch,
  runSchoolReplaySemanticBatch,
  selectFirstSchoolSemanticBatchFailure,
  SchoolSemanticBatchOperationalError,
} from "./school-semantic-batch-runner";
import { SCHOOL_SEMANTIC_FIXTURE_MANIFEST } from "./school-semantic-fixture-manifest";
import type {
  SchoolReplaySemanticCheckResult,
  SchoolReplaySemanticReport,
} from "@/lib/school-replay-semantic-evaluator";
import type { SchoolReplayCheckKind, SchoolReplayFailureCategory } from "@/lib/school-replay-expectations";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const CATEGORY_ORDER: SchoolReplayFailureCategory[] = [
  "DAY_OPERATION",
  "SUBJECT_PLACEMENT",
  "LANGUAGE_TRACK",
  "DUPLICATION",
  "SOURCE_COVERAGE",
];

/* ── Syntetiske rapporter (kun for failure-/aggregerings-tester) ──────────── */

const CATEGORY_TO_KIND: Record<SchoolReplayFailureCategory, SchoolReplayCheckKind> = {
  DAY_OPERATION: "day_operation",
  SUBJECT_PLACEMENT: "subject_placement",
  LANGUAGE_TRACK: "language_exclusion",
  DUPLICATION: "max_occurrences",
  SOURCE_COVERAGE: "source_coverage",
};

type SyntheticCheckSpec = { id: string; category: SchoolReplayFailureCategory; status: "pass" | "fail" };

function makeSyntheticReport(fixtureId: string, specs: SyntheticCheckSpec[]): SchoolReplaySemanticReport {
  const checks: SchoolReplaySemanticCheckResult[] = specs.map((s) => ({
    id: s.id,
    description: `syntetisk check ${s.id}`,
    kind: CATEGORY_TO_KIND[s.category],
    category: s.category,
    status: s.status,
    expected: null,
    actual: null,
    evidence: {},
  }));
  const byCategory = {} as SchoolReplaySemanticReport["summary"]["byCategory"];
  for (const category of CATEGORY_ORDER) {
    const inCat = checks.filter((c) => c.category === category);
    byCategory[category] = {
      total: inCat.length,
      passed: inCat.filter((c) => c.status === "pass").length,
      failed: inCat.filter((c) => c.status === "fail").length,
    };
  }
  const failed = checks.filter((c) => c.status === "fail").length;
  return {
    schemaVersion: "1.0.0",
    mode: "canonical_school_semantic_evaluation",
    fixtureId,
    replayMode: "canonical_school_replay",
    replayCoverage: {
      canonicalSchoolOutputs: true,
      schoolWeekOverlaySections: false,
      genericItems: false,
      secondaryTasks: false,
    },
    passed: failed === 0,
    summary: { total: checks.length, passed: checks.length - failed, failed, byCategory },
    checks,
  };
}

/* ── Happy path over de ekte fixturene ────────────────────────────────────── */

describe("batch happy path (alle elleve ekte fixtures)", () => {
  it("passed=true; aggregatene tilsvarer summen av de individuelle rapportene", () => {
    const batch = runSchoolReplaySemanticBatch({ fixturesRoot: FIXTURES_ROOT });
    expect(batch.schemaVersion).toBe("1.0.0");
    expect(batch.mode).toBe("canonical_school_semantic_batch");
    expect(batch.passed).toBe(true);
    expect(batch.firstFailure).toBeNull();
    expect(batch.summary.fixturesTotal).toBe(11);
    expect(batch.summary.fixturesPassed).toBe(11);
    expect(batch.summary.fixturesFailed).toBe(0);
    // checksTotal utledes av de individuelle rapportene — ikke hardkodet.
    const expectedChecksTotal = batch.fixtureReports.reduce((sum, r) => sum + r.summary.total, 0);
    expect(batch.summary.checksTotal).toBe(expectedChecksTotal);
    expect(batch.summary.checksPassed).toBe(expectedChecksTotal);
    expect(batch.summary.checksFailed).toBe(0);
  });

  it("fixtureReports følger manifestrekkefølgen", () => {
    const batch = runSchoolReplaySemanticBatch({ fixturesRoot: FIXTURES_ROOT });
    expect(batch.fixtureReports.map((r) => r.fixtureId)).toEqual(
      SCHOOL_SEMANTIC_FIXTURE_MANIFEST.map((e) => e.fixtureId),
    );
  });

  it("byCategory har alle fem kategorier i fast rekkefølge, med summer fra de individuelle rapportene", () => {
    const batch = runSchoolReplaySemanticBatch({ fixturesRoot: FIXTURES_ROOT });
    expect(Object.keys(batch.summary.byCategory)).toEqual(CATEGORY_ORDER);
    for (const category of CATEGORY_ORDER) {
      const expected = batch.fixtureReports.reduce(
        (acc, r) => ({
          total: acc.total + r.summary.byCategory[category].total,
          passed: acc.passed + r.summary.byCategory[category].passed,
          failed: acc.failed + r.summary.byCategory[category].failed,
        }),
        { total: 0, passed: 0, failed: 0 },
      );
      expect(batch.summary.byCategory[category], category).toEqual(expected);
      // Alle fem familier utøver faktisk sin kategori i batchen.
      expect(expected.total, `${category} skal ha minst én check i batchen`).toBeGreaterThan(0);
    }
  });

  it("er deterministisk: to kjøringer gir dyp identitet og identisk JSON-string", () => {
    const a = runSchoolReplaySemanticBatch({ fixturesRoot: FIXTURES_ROOT });
    const b = runSchoolReplaySemanticBatch({ fixturesRoot: FIXTURES_ROOT });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.fixtureReports.map((r) => r.fixtureId)).toEqual(b.fixtureReports.map((r) => r.fixtureId));
    expect(Object.keys(a.summary.byCategory)).toEqual(Object.keys(b.summary.byCategory));
  });
});

/* ── Operasjonelle feil ───────────────────────────────────────────────────── */

describe("operasjonelle feil", () => {
  it("fixtureId-mismatch mellom manifest og expectations er operasjonell feil, ikke semantic failure", () => {
    // «smoke» finnes på disk (read-only her) men har fixtureId "smoke" ≠ "feil-id".
    const run = () =>
      runSchoolReplaySemanticBatch({
        fixturesRoot: FIXTURES_ROOT,
        manifest: [{ fixtureId: "feil-id", dir: "smoke", family: "DAY_OPERATION" }],
      });
    expect(run).toThrow(SchoolSemanticBatchOperationalError);
    try {
      run();
      expect.unreachable("skulle kastet");
    } catch (err) {
      const e = err as SchoolSemanticBatchOperationalError;
      expect(e.code).toBe("manifest_fixture_id_mismatch");
      expect(e.message).toContain("feil-id");
      expect(e.message).toContain("smoke");
    }
  });

  it("manglende fixture-mappe kaster (load-feil), ikke rapporteres som semantic failure", () => {
    expect(() =>
      runSchoolReplaySemanticBatch({
        fixturesRoot: FIXTURES_ROOT,
        manifest: [{ fixtureId: "finnes-ikke", dir: "finnes-ikke", family: "DAY_OPERATION" }],
      }),
    ).toThrow();
  });
});

/* ── firstFailure- og aggregerings-semantikk (syntetisk) ──────────────────── */

describe("firstFailure med syntetiske rapporter", () => {
  it("velger første feil etter fixture-rekkefølge, deretter check-rekkefølge; senere feil velges ikke", () => {
    const reports = [
      makeSyntheticReport("fixture-a", [{ id: "a1", category: "DAY_OPERATION", status: "pass" }]),
      makeSyntheticReport("fixture-b", [
        { id: "b1", category: "SUBJECT_PLACEMENT", status: "pass" },
        { id: "b2", category: "DUPLICATION", status: "fail" },
        { id: "b3", category: "LANGUAGE_TRACK", status: "fail" },
      ]),
      makeSyntheticReport("fixture-c", [{ id: "c1", category: "SOURCE_COVERAGE", status: "fail" }]),
    ];
    expect(selectFirstSchoolSemanticBatchFailure(reports)).toEqual({
      fixtureId: "fixture-b",
      checkId: "b2",
      category: "DUPLICATION",
      description: "syntetisk check b2",
    });
  });

  it("er null når alle checks består", () => {
    const reports = [makeSyntheticReport("fixture-a", [{ id: "a1", category: "DAY_OPERATION", status: "pass" }])];
    expect(selectFirstSchoolSemanticBatchFailure(reports)).toBeNull();
  });

  it("aggregatet teller ALLE feil (ikke bare den første) og bevarer kategori/checkId i firstFailure", () => {
    const batch = aggregateSchoolReplaySemanticBatch([
      makeSyntheticReport("fixture-a", [{ id: "a1", category: "DAY_OPERATION", status: "pass" }]),
      makeSyntheticReport("fixture-b", [
        { id: "b1", category: "DUPLICATION", status: "fail" },
        { id: "b2", category: "DUPLICATION", status: "fail" },
      ]),
      makeSyntheticReport("fixture-c", [{ id: "c1", category: "SOURCE_COVERAGE", status: "fail" }]),
    ]);
    expect(batch.passed).toBe(false);
    expect(batch.summary.fixturesTotal).toBe(3);
    expect(batch.summary.fixturesPassed).toBe(1);
    expect(batch.summary.fixturesFailed).toBe(2);
    expect(batch.summary.checksTotal).toBe(4);
    expect(batch.summary.checksPassed).toBe(1);
    expect(batch.summary.checksFailed).toBe(3);
    expect(batch.summary.byCategory.DUPLICATION).toEqual({ total: 2, passed: 0, failed: 2 });
    expect(batch.summary.byCategory.SOURCE_COVERAGE).toEqual({ total: 1, passed: 0, failed: 1 });
    // Kategorier uten checks er fortsatt representert.
    expect(batch.summary.byCategory.LANGUAGE_TRACK).toEqual({ total: 0, passed: 0, failed: 0 });
    expect(batch.firstFailure).toEqual({
      fixtureId: "fixture-b",
      checkId: "b1",
      category: "DUPLICATION",
      description: "syntetisk check b1",
    });
  });

  it("bevarer check-rekkefølgen i fixtureReports uendret (ingen resortering)", () => {
    const report = makeSyntheticReport("fixture-a", [
      { id: "z-siste", category: "SOURCE_COVERAGE", status: "pass" },
      { id: "a-første", category: "DAY_OPERATION", status: "pass" },
    ]);
    const batch = aggregateSchoolReplaySemanticBatch([report]);
    expect(batch.fixtureReports[0]!.checks.map((c) => c.id)).toEqual(["z-siste", "a-første"]);
  });
});
