/**
 * Tester for CI-kontrollen av TypeScript-baseline (scripts/ci/check-tsc-baseline.mjs).
 * All output er syntetisk/injisert — ekte tsc kjøres aldri her, og ingen fixtures endres.
 */
import { describe, expect, it } from "vitest";
import {
  TSC_ERROR_BASELINE,
  collectTscDiagnosticCodes,
  evaluateTscBaseline,
  isTscConfigErrorCode,
} from "../../../scripts/ci/check-tsc-baseline.mjs";

function makeDiagnostics(count: number): string {
  return Array.from({ length: count }, (_, i) => `src/lib/a.ts(${i + 1},5): error TS2345: syntetisk feil ${i + 1}.`).join(
    "\n",
  );
}

describe("collectTscDiagnosticCodes", () => {
  it("teller faktiske diagnostikklinjer med og uten fil-prefiks", () => {
    const output = [
      "src/lib/a.ts(10,5): error TS2345: melding.",
      "error TS2307: global melding.",
      "src\\lib\\b.ts(2,1): error TS2551: windows-sti.",
    ].join("\r\n");
    expect(collectTscDiagnosticCodes(output)).toEqual([2345, 2307, 2551]);
  });

  it("teller IKKE tilfeldige forekomster av teksten «error TS» midt i en linje", () => {
    const output = [
      "kommentar som nevner error TS9999: i løpende tekst",
      "  innrykket error TS1234: skal heller ikke telles",
      "src/lib/a.ts(1,1): error TS2345: men denne telles.",
    ].join("\n");
    expect(collectTscDiagnosticCodes(output)).toEqual([2345]);
  });
});

describe("evaluateTscBaseline", () => {
  it("nøyaktig 35 feil består", () => {
    const verdict = evaluateTscBaseline({ exitCode: 2, output: makeDiagnostics(35) });
    expect(verdict.status).toBe("pass");
    expect(verdict.errorCount).toBe(35);
  });

  it("færre enn 35 feil består som forbedring", () => {
    const verdict = evaluateTscBaseline({ exitCode: 2, output: makeDiagnostics(34) });
    expect(verdict.status).toBe("pass");
    expect(verdict.errorCount).toBe(34);
  });

  it("36 feil feiler som baseline-brudd", () => {
    const verdict = evaluateTscBaseline({ exitCode: 2, output: makeDiagnostics(36) });
    expect(verdict.status).toBe("baseline_exceeded");
    expect(verdict.errorCount).toBe(36);
    expect(verdict.problems.join("\n")).toContain("36");
    expect(verdict.problems.join("\n")).toContain(String(TSC_ERROR_BASELINE));
  });

  it("null feil med gyldig vellykket tsc-kjøring består", () => {
    const verdict = evaluateTscBaseline({ exitCode: 0, output: "" });
    expect(verdict.status).toBe("pass");
    expect(verdict.errorCount).toBe(0);
  });

  it("null diagnostikk kombinert med feilende tsc-kjøring er operasjonell feil", () => {
    const verdict = evaluateTscBaseline({ exitCode: 1, output: "noe gikk galt uten diagnostikk" });
    expect(verdict.status).toBe("operational_fail");
  });

  it("ikke-TypeScript-kommandofeil (f.eks. command not found) feiler operasjonelt", () => {
    const verdict = evaluateTscBaseline({ exitCode: 127, output: "bash: npx: command not found" });
    expect(verdict.status).toBe("operational_fail");
  });

  it("kommando som ikke kunne kjøres (exitCode null) feiler operasjonelt", () => {
    const verdict = evaluateTscBaseline({ exitCode: null, output: "" });
    expect(verdict.status).toBe("operational_fail");
  });

  it("konfigurasjonsfeil (TS18003 — null analyserte filer) består ALDRI som forbedring", () => {
    const verdict = evaluateTscBaseline({
      exitCode: 2,
      output: "error TS18003: No inputs were found in config file 'tsconfig.json'.",
    });
    expect(verdict.status).toBe("operational_fail");
    expect(verdict.problems.join("\n")).toContain("TS18003");
  });

  it("compiler-option-feil (TS5xxx) er operasjonell feil, ikke baseline-forbedring", () => {
    const verdict = evaluateTscBaseline({
      exitCode: 2,
      output: "error TS5023: Unknown compiler option 'ugyldig'.",
    });
    expect(verdict.status).toBe("operational_fail");
  });

  it("inkonsistent kjøring (exit 0 med diagnostikk) er operasjonell feil", () => {
    const verdict = evaluateTscBaseline({ exitCode: 0, output: makeDiagnostics(3) });
    expect(verdict.status).toBe("operational_fail");
  });

  it("isTscConfigErrorCode skiller config-koder fra vanlige typefeil", () => {
    expect(isTscConfigErrorCode(18003)).toBe(true);
    expect(isTscConfigErrorCode(5023)).toBe(true);
    expect(isTscConfigErrorCode(2345)).toBe(false);
  });
});
