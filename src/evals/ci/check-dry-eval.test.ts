/**
 * Tester for CI-validatoren av dry-eval-output (scripts/ci/check-dry-eval.mjs).
 * Kun syntetisk output — validatoren stoler ikke på exit code alene.
 */
import { describe, expect, it } from "vitest";
import { extractStructureAverages, validateDryEvalOutput } from "../../../scripts/ci/check-dry-eval.mjs";

describe("extractStructureAverages", () => {
  it("finner både tekstformen og JSON-formen", () => {
    const text = 'structureAverage: 1.0000\n...\n  "structureAverage": 1,\n';
    expect(extractStructureAverages(text)).toEqual([1, 1]);
  });

  it("returnerer tom liste når ingenting matcher", () => {
    expect(extractStructureAverages("helt annen output")).toEqual([]);
  });
});

describe("validateDryEvalOutput", () => {
  it("tekstformen structureAverage: 1.0000 består", () => {
    expect(validateDryEvalOutput("structureAverage: 1.0000").ok).toBe(true);
  });

  it("JSON-formen \"structureAverage\": 1 består", () => {
    expect(validateDryEvalOutput('{"structureAverage": 1}').ok).toBe(true);
  });

  it("kombinert output med begge former består når alle er 1", () => {
    const result = validateDryEvalOutput('structureAverage: 1.0000\n"structureAverage": 1');
    expect(result.ok).toBe(true);
    expect(result.values).toEqual([1, 1]);
  });

  it("verdi under 1 feiler", () => {
    const result = validateDryEvalOutput("structureAverage: 0.9995");
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("0.9995");
  });

  it("én korrekt og én for lav verdi feiler (alle må være 1)", () => {
    const result = validateDryEvalOutput('structureAverage: 1.0000\n"structureAverage": 0.9');
    expect(result.ok).toBe(false);
  });

  it("manglende verdi feiler", () => {
    const result = validateDryEvalOutput("evalen kjørte, men uten summering");
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("ingen structureAverage");
  });

  it("ugyldig/tom output feiler kontrollert", () => {
    expect(validateDryEvalOutput("").ok).toBe(false);
  });
});
