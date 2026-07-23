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
 * CLI-en er ARGUMENTLØS: ethvert argument gir `usage_error` (exit 2) uten at batchen startes.
 * Ved operasjonell feil eksponeres aldri stack trace, absolutt sti eller miljøvariabler;
 * ukjente exceptions rapporteres med stabil generisk melding — aldri rå exception-tekst.
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
  /** CLI-argumenter ETTER filnavnet. CLI-en er argumentløs: alt her gir usage_error (exit 2). */
  args: readonly string[];
  runBatch: () => SchoolReplaySemanticBatchReport;
  writeStdout: (text: string) => void;
};

function defaultDeps(): SchoolSemanticBatchCliDeps {
  return {
    args: process.argv.slice(2),
    runBatch: () => runSchoolReplaySemanticBatch({ fixturesRoot: SCHOOL_SEMANTIC_BATCH_FIXTURES_ROOT }),
    writeStdout: (text) => {
      process.stdout.write(text);
    },
  };
}

function writeErrorReport(deps: SchoolSemanticBatchCliDeps, code: string, message: string): 2 {
  const errorReport: SchoolReplaySemanticBatchErrorReport = {
    schemaVersion: "1.0.0",
    mode: "canonical_school_semantic_batch",
    passed: false,
    error: { code, message },
  };
  deps.writeStdout(`${JSON.stringify(errorReport, null, 2)}\n`);
  return resolveSchoolSemanticBatchExitCode({ kind: "operational_error" }) as 2;
}

/** Kjører CLI-logikken én gang og returnerer exit-koden (uten å avslutte prosessen). */
export function runSchoolSemanticBatchCliOnce(
  overrides?: Partial<SchoolSemanticBatchCliDeps>,
): 0 | 1 | 2 {
  const deps: SchoolSemanticBatchCliDeps = { ...defaultDeps(), ...overrides };
  if (deps.args.length > 0) {
    // Usage-feil: batchen startes ikke.
    return writeErrorReport(deps, "usage_error", "CLI-en godtar ingen argumenter.");
  }
  try {
    const report = deps.runBatch();
    deps.writeStdout(`${JSON.stringify(report, null, 2)}\n`);
    return resolveSchoolSemanticBatchExitCode({ kind: "completed", passed: report.passed });
  } catch (err) {
    if (err instanceof SchoolSemanticBatchOperationalError) {
      // Kontrollerte feil har stabil kode og trygg melding (kun fixtureId/relativ dir).
      return writeErrorReport(deps, err.code, err.message);
    }
    // Ukjente exceptions: rå melding kan inneholde lokal/absolutt sti — bruk stabil generisk
    // melding i den offentlige rapporten i stedet for exception-teksten.
    return writeErrorReport(deps, "batch_run_failed", "Batchkjøringen feilet på grunn av en operasjonell feil.");
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
