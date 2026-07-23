/**
 * CLI: deterministisk semantisk batch over ALLE regression-fixtures i det eksplisitte manifestet.
 *
 *   tsx --tsconfig tsconfig.json src/evals/school-replay/run-school-semantic-batch.ts
 *
 * Skriver NØYAKTIG ett gyldig JSON-dokument til stdout (avsluttet med newline) — aldri
 * informasjonslogger. Kjøres fra repo-roten (som npm-scriptet gjør).
 *
 * Exit codes:
 *   0 — alle fixtures og alle semantic checks består
 *   1 — batchen kjørte korrekt, men ≥1 semantic check feilet (full rapport skrives likevel)
 *   2 — usage-/manifest-/load-/parse-/runtime-feil (maskinlesbar feilrapport på stdout)
 *
 * Ved operasjonell feil eksponeres aldri stack trace, absolutt sti eller miljøvariabler.
 * Trygg å importere: kjører KUN når filen er prosessens entrypoint.
 * Offline: ingen nettverk, ingen `.env`, ingen modellkall.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  runSchoolReplaySemanticBatch,
  resolveSchoolSemanticBatchExitCode,
  SchoolSemanticBatchOperationalError,
  type SchoolReplaySemanticBatchErrorReport,
  type SchoolReplaySemanticBatchReport,
} from "./school-semantic-batch-runner";

/** Repo-relativ fixtures-rot — CLI-en kjøres fra repo-roten, som de øvrige eval-scriptene. */
export const SCHOOL_SEMANTIC_BATCH_FIXTURES_ROOT = "src/evals/school-replay/fixtures";

export type SchoolSemanticBatchCliDeps = {
  runBatch: () => SchoolReplaySemanticBatchReport;
  writeStdout: (text: string) => void;
};

const DEFAULT_DEPS: SchoolSemanticBatchCliDeps = {
  runBatch: () => runSchoolReplaySemanticBatch({ fixturesRoot: SCHOOL_SEMANTIC_BATCH_FIXTURES_ROOT }),
  writeStdout: (text) => {
    process.stdout.write(text);
  },
};

/** Kjører CLI-logikken én gang og returnerer exit-koden (uten å avslutte prosessen). */
export function runSchoolSemanticBatchCliOnce(
  overrides?: Partial<SchoolSemanticBatchCliDeps>,
): 0 | 1 | 2 {
  const deps: SchoolSemanticBatchCliDeps = { ...DEFAULT_DEPS, ...overrides };
  try {
    const report = deps.runBatch();
    deps.writeStdout(`${JSON.stringify(report, null, 2)}\n`);
    return resolveSchoolSemanticBatchExitCode({ kind: "completed", passed: report.passed });
  } catch (err) {
    const errorReport: SchoolReplaySemanticBatchErrorReport = {
      schemaVersion: "1.0.0",
      mode: "canonical_school_semantic_batch",
      passed: false,
      error: {
        code: err instanceof SchoolSemanticBatchOperationalError ? err.code : "batch_run_failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
    deps.writeStdout(`${JSON.stringify(errorReport, null, 2)}\n`);
    return resolveSchoolSemanticBatchExitCode({ kind: "operational_error" });
  }
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  process.exit(runSchoolSemanticBatchCliOnce());
}
