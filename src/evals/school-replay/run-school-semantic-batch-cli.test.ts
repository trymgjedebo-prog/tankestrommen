/**
 * CLI- og exit-code-tester for batch-CLI-en.
 *
 * Ekte CLI kjøres som child process (tsx) to ganger: exit 0, stdout er NØYAKTIG ett gyldig
 * JSON-dokument avsluttet med newline, byte-identisk mellom kjøringene. Operasjonelle feil
 * testes gjennom den importerte CLI-funksjonen med injisert dependency — aldri ved å endre
 * ekte fixtures eller opprette midlertidige filer i fixture-katalogen.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runSchoolSemanticBatchCliOnce } from "./run-school-semantic-batch";
import {
  resolveSchoolSemanticBatchExitCode,
  SchoolSemanticBatchOperationalError,
  aggregateSchoolReplaySemanticBatch,
  type SchoolReplaySemanticBatchReport,
} from "./school-semantic-batch-runner";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CLI_RELATIVE_PATH = "src/evals/school-replay/run-school-semantic-batch.ts";

function runCliChildProcess(): string {
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");
  // execFileSync kaster ved exit ≠ 0 — vellykket retur beviser exit 0.
  return execFileSync(process.execPath, [tsxCli, "--tsconfig", "tsconfig.json", CLI_RELATIVE_PATH], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

describe("exit-code-kontrakten (ren funksjon)", () => {
  it("pass → 0, semantic failure → 1, operasjonell feil → 2", () => {
    expect(resolveSchoolSemanticBatchExitCode({ kind: "completed", passed: true })).toBe(0);
    expect(resolveSchoolSemanticBatchExitCode({ kind: "completed", passed: false })).toBe(1);
    expect(resolveSchoolSemanticBatchExitCode({ kind: "operational_error" })).toBe(2);
  });
});

describe("CLI-funksjonen (importert, med injiserte dependencies)", () => {
  it("er trygg å importere: eksporterer funksjonen uten å auto-kjøre", () => {
    // Selve toppnivå-importen over har allerede kjørt uten å skrive batch-JSON til stdout.
    expect(typeof runSchoolSemanticBatchCliOnce).toBe("function");
  });

  it("happy path in-process: exit 0, gyldig JSON med passed=true og elleve fixtures", () => {
    const writes: string[] = [];
    const code = runSchoolSemanticBatchCliOnce({ writeStdout: (t) => writes.push(t) });
    expect(code).toBe(0);
    const stdout = writes.join("");
    expect(stdout.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(stdout) as SchoolReplaySemanticBatchReport;
    expect(parsed.passed).toBe(true);
    expect(parsed.summary.fixturesTotal).toBe(11);
    expect(parsed.firstFailure).toBeNull();
    expect("error" in parsed).toBe(false);
  });

  it("semantic failure → exit 1 med full rapport (syntetisk, ingen fixtures endres)", () => {
    const failingReport = aggregateSchoolReplaySemanticBatch([
      {
        schemaVersion: "1.0.0",
        mode: "canonical_school_semantic_evaluation",
        fixtureId: "syntetisk",
        replayMode: "canonical_school_replay",
        replayCoverage: {
          canonicalSchoolOutputs: true,
          schoolWeekOverlaySections: false,
          genericItems: false,
          secondaryTasks: false,
        },
        passed: false,
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          byCategory: {
            DAY_OPERATION: { total: 1, passed: 0, failed: 1 },
            SUBJECT_PLACEMENT: { total: 0, passed: 0, failed: 0 },
            LANGUAGE_TRACK: { total: 0, passed: 0, failed: 0 },
            DUPLICATION: { total: 0, passed: 0, failed: 0 },
            SOURCE_COVERAGE: { total: 0, passed: 0, failed: 0 },
          },
        },
        checks: [
          {
            id: "syntetisk-fail",
            description: "syntetisk feilende check",
            kind: "day_operation",
            category: "DAY_OPERATION",
            status: "fail",
            expected: null,
            actual: null,
            evidence: {},
          },
        ],
      },
    ]);
    const writes: string[] = [];
    const code = runSchoolSemanticBatchCliOnce({
      runBatch: () => failingReport,
      writeStdout: (t) => writes.push(t),
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(writes.join("")) as SchoolReplaySemanticBatchReport;
    expect(parsed.passed).toBe(false);
    expect(parsed.firstFailure).toEqual({
      fixtureId: "syntetisk",
      checkId: "syntetisk-fail",
      category: "DAY_OPERATION",
      description: "syntetisk feilende check",
    });
    expect("error" in parsed).toBe(false);
  });

  it("operasjonell feil → exit 2 med stabil maskinlesbar feilrapport", () => {
    const writes: string[] = [];
    const code = runSchoolSemanticBatchCliOnce({
      runBatch: () => {
        throw new SchoolSemanticBatchOperationalError("manifest_fixture_id_mismatch", "syntetisk operasjonell feil");
      },
      writeStdout: (t) => writes.push(t),
    });
    expect(code).toBe(2);
    const parsed = JSON.parse(writes.join(""));
    expect(parsed).toEqual({
      schemaVersion: "1.0.0",
      mode: "canonical_school_semantic_batch",
      passed: false,
      error: { code: "manifest_fixture_id_mismatch", message: "syntetisk operasjonell feil" },
    });
  });

  it("ukjent exception → exit 2 med fallback-feilkoden batch_run_failed", () => {
    const writes: string[] = [];
    const code = runSchoolSemanticBatchCliOnce({
      runBatch: () => {
        throw new Error("uventet");
      },
      writeStdout: (t) => writes.push(t),
    });
    expect(code).toBe(2);
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.passed).toBe(false);
    expect(parsed.error).toEqual({ code: "batch_run_failed", message: "uventet" });
  });
});

describe("ekte CLI som child process", () => {
  it("exit 0; stdout er nøyaktig ett gyldig JSON-dokument, byte-identisk ved to kjøringer", () => {
    const first = runCliChildProcess();
    const second = runCliChildProcess();
    expect(first).toBe(second); // byte-identisk

    // Nøyaktig ett JSON-dokument: starter med '{', slutter med '}\n', og HELE stdout parser.
    expect(first.startsWith("{")).toBe(true);
    expect(first.endsWith("}\n")).toBe(true);
    const parsed = JSON.parse(first) as SchoolReplaySemanticBatchReport;
    expect(parsed.schemaVersion).toBe("1.0.0");
    expect(parsed.mode).toBe("canonical_school_semantic_batch");
    expect(parsed.passed).toBe(true);
    expect(parsed.summary.fixturesTotal).toBe(11);
    expect(parsed.summary.fixturesFailed).toBe(0);
    expect(parsed.summary.checksFailed).toBe(0);
    expect(parsed.firstFailure).toBeNull();
    expect("error" in parsed).toBe(false);
    expect(Object.keys(parsed.summary.byCategory)).toEqual([
      "DAY_OPERATION",
      "SUBJECT_PLACEMENT",
      "LANGUAGE_TRACK",
      "DUPLICATION",
      "SOURCE_COVERAGE",
    ]);
  }, 120_000);
});
