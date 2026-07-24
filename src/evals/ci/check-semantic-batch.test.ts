/**
 * Tester for CI-validatoren av semantic batch-rapporten (scripts/ci/check-semantic-batch.mjs).
 * Bruker KUN syntetiske rapportobjekter — ingen ekte fixtures kjøres eller endres, og
 * validatoren utfører ingen egen semantisk matching (den leser bare summary/firstFailure).
 */
import { describe, expect, it } from "vitest";
import {
  BATCH_CATEGORY_ORDER,
  EXPECTED_BATCH_TOTALS,
  buildStepSummary,
  formatFirstFailure,
  validateSemanticBatchReport,
  validateSemanticBatchReportText,
} from "../../../scripts/ci/check-semantic-batch.mjs";

type SyntheticReport = {
  schemaVersion: string;
  mode: string;
  passed: boolean;
  summary: {
    fixturesTotal: number;
    fixturesPassed: number;
    fixturesFailed: number;
    checksTotal: number;
    checksPassed: number;
    checksFailed: number;
    byCategory: Record<string, { total: number; passed: number; failed: number }>;
  };
  firstFailure: { fixtureId: string; checkId: string; category: string; description: string } | null;
  fixtureReports: unknown[];
};

/** Syntetisk rapport som matcher dagens kontrakt (11/36 + kategorisummene). */
function makeValidReport(): SyntheticReport {
  const byCategory: SyntheticReport["summary"]["byCategory"] = {};
  for (const category of BATCH_CATEGORY_ORDER) {
    const total = EXPECTED_BATCH_TOTALS.byCategory[category as keyof typeof EXPECTED_BATCH_TOTALS.byCategory];
    byCategory[category] = { total, passed: total, failed: 0 };
  }
  return {
    schemaVersion: "1.0.0",
    mode: "canonical_school_semantic_batch",
    passed: true,
    summary: {
      fixturesTotal: 11,
      fixturesPassed: 11,
      fixturesFailed: 0,
      checksTotal: 36,
      checksPassed: 36,
      checksFailed: 0,
      byCategory,
    },
    firstFailure: null,
    // Tom med vilje: validatoren skal IKKE re-evaluere fixtureReports (ingen ny matching).
    fixtureReports: [],
  };
}

describe("validateSemanticBatchReport", () => {
  it("korrekt rapport består — også uten fixtureReports (ingen ny semantic matching)", () => {
    const result = validateSemanticBatchReport(makeValidReport());
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("passed: false feiler og presenterer firstFailure tydelig", () => {
    const report = makeValidReport();
    report.passed = false;
    report.firstFailure = {
      fixtureId: "duplication-day-scope",
      checkId: "husk-once-per-day",
      category: "DUPLICATION",
      description: "maks én forekomst per dato",
    };
    const result = validateSemanticBatchReport(report);
    expect(result.ok).toBe(false);
    const joined = result.problems.join("\n");
    expect(joined).toContain("duplication-day-scope");
    expect(joined).toContain("husk-once-per-day");
    expect(joined).toContain("DUPLICATION");
    expect(joined).toContain("maks én forekomst per dato");
  });

  it("feil fixture-antall feiler", () => {
    const report = makeValidReport();
    report.summary.fixturesTotal = 10;
    report.summary.fixturesPassed = 10;
    const result = validateSemanticBatchReport(report);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("fixturesTotal");
  });

  it("feil check-antall feiler", () => {
    const report = makeValidReport();
    report.summary.checksTotal = 35;
    report.summary.checksPassed = 35;
    const result = validateSemanticBatchReport(report);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("checksTotal");
  });

  it("manglende kategori feiler", () => {
    const report = makeValidReport();
    delete report.summary.byCategory.LANGUAGE_TRACK;
    const result = validateSemanticBatchReport(report);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("LANGUAGE_TRACK");
  });

  it("feil kategorirekkefølge feiler", () => {
    const report = makeValidReport();
    const reordered: SyntheticReport["summary"]["byCategory"] = {};
    for (const category of [...BATCH_CATEGORY_ORDER].reverse()) {
      reordered[category] = report.summary.byCategory[category]!;
    }
    report.summary.byCategory = reordered;
    const result = validateSemanticBatchReport(report);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("rekkefølgen");
  });

  it("feil kategoritotal feiler", () => {
    const report = makeValidReport();
    report.summary.byCategory.DUPLICATION = { total: 8, passed: 8, failed: 0 };
    const result = validateSemanticBatchReport(report);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("DUPLICATION");
  });

  it("firstFailure ≠ null feiler selv om alt annet ser riktig ut", () => {
    const report = makeValidReport();
    report.firstFailure = {
      fixtureId: "x",
      checkId: "y",
      category: "DAY_OPERATION",
      description: "z",
    };
    const result = validateSemanticBatchReport(report);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("firstFailure");
  });

  it("operasjonell feilrapport fra CLI-en feiler med kode og melding", () => {
    const result = validateSemanticBatchReport({
      schemaVersion: "1.0.0",
      mode: "canonical_school_semantic_batch",
      passed: false,
      error: { code: "usage_error", message: "CLI-en godtar ingen argumenter." },
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("usage_error");
  });
});

describe("validateSemanticBatchReportText", () => {
  it("ugyldig JSON gir kontrollert feil, ikke exception", () => {
    const result = validateSemanticBatchReportText("{ikke gyldig json");
    expect(result.ok).toBe(false);
    expect(result.report).toBeNull();
    expect(result.problems.join("\n")).toContain("ikke gyldig JSON");
  });

  it("gyldig JSON-tekst med korrekt rapport består", () => {
    const result = validateSemanticBatchReportText(JSON.stringify(makeValidReport()));
    expect(result.ok).toBe(true);
  });
});

describe("presentasjon", () => {
  it("formatFirstFailure bygger linjen av de kontrollerte feltene", () => {
    expect(
      formatFirstFailure({ fixtureId: "f", checkId: "c", category: "SOURCE_COVERAGE", description: "d" }),
    ).toBe("fixture «f», check «c» [SOURCE_COVERAGE]: d");
    expect(formatFirstFailure(null)).toBeNull();
  });

  it("buildStepSummary viser fixtures, checks, kategoritotaler og firstFailure/none", () => {
    const summary = buildStepSummary(makeValidReport());
    expect(summary).toContain("PASS");
    expect(summary).toContain("11/11");
    expect(summary).toContain("36/36");
    expect(summary).toContain("firstFailure: none");
    for (const category of BATCH_CATEGORY_ORDER) expect(summary).toContain(category);
  });
});
