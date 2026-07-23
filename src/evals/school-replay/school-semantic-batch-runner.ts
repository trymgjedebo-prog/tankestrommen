/**
 * Deterministisk batch-runner for de semantiske skole-replay-fixturene.
 *
 * Kjører SEKVENSIELT i manifestrekkefølge: fixture-loader → fixtureId-verifikasjon mot
 * expectations → eksisterende canonical replay-runner → eksisterende semantic evaluator.
 * Gjenbruker de individuelle rapportene uendret — ingen egen matching, ingen resortering,
 * ingen tolkning av sourceText her.
 *
 * Determinisme: ingen klokke/tilfeldighet/miljø i rapporten; kategoriobjektet bygges i
 * eksplisitt fast rekkefølge; `JSON.stringify` av samme kjøring gir identisk tekst.
 *
 * Semantisk failure er IKKE en exception (rapporten bærer `passed: false`); operasjonelle
 * feil (load/parse/mismatch) kastes som `SchoolSemanticBatchOperationalError` og skal aldri
 * representeres som semantic checks. Offline: ingen nettverk, ingen `.env`, ingen modellkall.
 */
import { join } from "node:path";
import { loadSchoolReplayFixture } from "./load-school-replay-fixture";
import { loadSchoolReplayExpectations } from "./load-school-replay-expectations";
import {
  SCHOOL_SEMANTIC_FIXTURE_MANIFEST,
  type SchoolSemanticFixtureManifestEntry,
} from "./school-semantic-fixture-manifest";
import { runSchoolCanonicalReplayFromModelResponse } from "@/lib/school-canonical-replay";
import {
  evaluateSchoolReplaySemantics,
  type SchoolReplaySemanticReport,
} from "@/lib/school-replay-semantic-evaluator";
import type { SchoolReplayFailureCategory } from "@/lib/school-replay-expectations";

/** Fast kategorirekkefølge i batchrapporten — alle fem er alltid representert. */
const BATCH_CATEGORY_ORDER: readonly SchoolReplayFailureCategory[] = [
  "DAY_OPERATION",
  "SUBJECT_PLACEMENT",
  "LANGUAGE_TRACK",
  "DUPLICATION",
  "SOURCE_COVERAGE",
];

export type SchoolReplaySemanticBatchCategorySummary = {
  total: number;
  passed: number;
  failed: number;
};

/** Peker på FØRSTE feilende check etter manifestrekkefølge, deretter check-rekkefølge. */
export type SchoolReplaySemanticBatchFirstFailure = {
  fixtureId: string;
  checkId: string;
  category: SchoolReplayFailureCategory;
  description: string;
};

export type SchoolReplaySemanticBatchReport = {
  schemaVersion: "1.0.0";
  mode: "canonical_school_semantic_batch";
  passed: boolean;
  summary: {
    fixturesTotal: number;
    fixturesPassed: number;
    fixturesFailed: number;
    checksTotal: number;
    checksPassed: number;
    checksFailed: number;
    byCategory: Record<SchoolReplayFailureCategory, SchoolReplaySemanticBatchCategorySummary>;
  };
  firstFailure: SchoolReplaySemanticBatchFirstFailure | null;
  /** De uendrede individuelle rapportene, i manifestrekkefølge. */
  fixtureReports: SchoolReplaySemanticReport[];
};

/** Maskinlesbar rapport ved operasjonell feil (exit 2) — aldri stack trace eller absolutt sti. */
export type SchoolReplaySemanticBatchErrorReport = {
  schemaVersion: "1.0.0";
  mode: "canonical_school_semantic_batch";
  passed: false;
  error: { code: string; message: string };
};

/** Operasjonell feil (manifest/load/parse) — skal gi exit 2, aldri semantic failure. */
export class SchoolSemanticBatchOperationalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SchoolSemanticBatchOperationalError";
    this.code = code;
  }
}

export type SchoolSemanticBatchOutcome =
  | { kind: "completed"; passed: boolean }
  | { kind: "operational_error" };

/** 0 = alt består; 1 = batchen kjørte, men ≥1 semantic check feilet; 2 = operasjonell feil. */
export function resolveSchoolSemanticBatchExitCode(outcome: SchoolSemanticBatchOutcome): 0 | 1 | 2 {
  if (outcome.kind === "operational_error") return 2;
  return outcome.passed ? 0 : 1;
}

/** Første feilende check etter manifestrekkefølge → check-rekkefølge; null når alt består. */
export function selectFirstSchoolSemanticBatchFailure(
  fixtureReports: readonly SchoolReplaySemanticReport[],
): SchoolReplaySemanticBatchFirstFailure | null {
  for (const report of fixtureReports) {
    for (const check of report.checks) {
      if (check.status === "fail") {
        return {
          fixtureId: report.fixtureId,
          checkId: check.id,
          category: check.category,
          description: check.description,
        };
      }
    }
  }
  return null;
}

/** REN aggregering av individuelle rapporter — muterer aldri input, resorterer aldri. */
export function aggregateSchoolReplaySemanticBatch(
  fixtureReports: readonly SchoolReplaySemanticReport[],
): SchoolReplaySemanticBatchReport {
  const byCategory = {} as Record<SchoolReplayFailureCategory, SchoolReplaySemanticBatchCategorySummary>;
  for (const category of BATCH_CATEGORY_ORDER) {
    byCategory[category] = { total: 0, passed: 0, failed: 0 };
  }

  let fixturesPassed = 0;
  let checksTotal = 0;
  let checksPassed = 0;
  let checksFailed = 0;
  for (const report of fixtureReports) {
    if (report.passed) fixturesPassed += 1;
    checksTotal += report.summary.total;
    checksPassed += report.summary.passed;
    checksFailed += report.summary.failed;
    for (const category of BATCH_CATEGORY_ORDER) {
      const c = report.summary.byCategory[category];
      byCategory[category].total += c.total;
      byCategory[category].passed += c.passed;
      byCategory[category].failed += c.failed;
    }
  }

  const fixturesTotal = fixtureReports.length;
  return {
    schemaVersion: "1.0.0",
    mode: "canonical_school_semantic_batch",
    passed: fixturesPassed === fixturesTotal,
    summary: {
      fixturesTotal,
      fixturesPassed,
      fixturesFailed: fixturesTotal - fixturesPassed,
      checksTotal,
      checksPassed,
      checksFailed,
      byCategory,
    },
    firstFailure: selectFirstSchoolSemanticBatchFailure(fixtureReports),
    fixtureReports: [...fixtureReports],
  };
}

export type RunSchoolReplaySemanticBatchOptions = {
  /** Rot for fixture-mappene (relativ eller absolutt); manifestets `dir` joines mot denne. */
  fixturesRoot: string;
  /** Default: det eksplisitte regression-manifestet. Injiserbar KUN for tester. */
  manifest?: readonly SchoolSemanticFixtureManifestEntry[];
};

/** Kjører hele batchen sekvensielt i manifestrekkefølge og aggregerer rapporten. */
export function runSchoolReplaySemanticBatch(
  options: RunSchoolReplaySemanticBatchOptions,
): SchoolReplaySemanticBatchReport {
  const manifest = options.manifest ?? SCHOOL_SEMANTIC_FIXTURE_MANIFEST;
  const fixtureReports: SchoolReplaySemanticReport[] = [];
  for (const entry of manifest) {
    const fixtureDir = join(options.fixturesRoot, entry.dir);
    const input = loadSchoolReplayFixture(fixtureDir);
    const expectations = loadSchoolReplayExpectations(fixtureDir);
    if (expectations.fixtureId !== entry.fixtureId) {
      throw new SchoolSemanticBatchOperationalError(
        "manifest_fixture_id_mismatch",
        `Manifestets fixtureId «${entry.fixtureId}» matcher ikke expectations.fixtureId «${expectations.fixtureId}» i mappen «${entry.dir}».`,
      );
    }
    const replay = runSchoolCanonicalReplayFromModelResponse(input);
    fixtureReports.push(evaluateSchoolReplaySemantics(replay, expectations));
  }
  return aggregateSchoolReplaySemanticBatch(fixtureReports);
}
