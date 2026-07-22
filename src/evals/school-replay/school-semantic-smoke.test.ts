/**
 * Semantisk smoke-test: samme flyt som CLI-en (fixture-loader → replay → expectations-loader →
 * evaluator). Låser passed/total/kategorisummering/rekkefølge og determinisme.
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadSchoolReplayFixture } from "./load-school-replay-fixture";
import { loadSchoolReplayExpectations } from "./load-school-replay-expectations";
import { runSchoolCanonicalReplayFromModelResponse } from "@/lib/school-canonical-replay";
import { evaluateSchoolReplaySemantics } from "@/lib/school-replay-semantic-evaluator";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "smoke");

function runSemantic() {
  const replay = runSchoolCanonicalReplayFromModelResponse(loadSchoolReplayFixture(FIXTURE_DIR));
  return evaluateSchoolReplaySemantics(replay, loadSchoolReplayExpectations(FIXTURE_DIR));
}

describe("semantic smoke", () => {
  it("alle checks består; summering per kategori er korrekt", () => {
    const r = runSemantic();
    expect(r.schemaVersion).toBe("1.0.0");
    expect(r.mode).toBe("canonical_school_semantic_evaluation");
    expect(r.fixtureId).toBe("smoke");
    expect(r.replayMode).toBe("canonical_school_replay");
    expect(r.passed).toBe(true);
    expect(r.summary).toMatchObject({ total: 6, passed: 6, failed: 0 });
    // Alle fem kategorier finnes; SUBJECT_PLACEMENT har to checks og telles korrekt.
    expect(r.summary.byCategory).toEqual({
      DAY_OPERATION: { total: 1, passed: 1, failed: 0 },
      SUBJECT_PLACEMENT: { total: 2, passed: 2, failed: 0 },
      LANGUAGE_TRACK: { total: 1, passed: 1, failed: 0 },
      DUPLICATION: { total: 1, passed: 1, failed: 0 },
      SOURCE_COVERAGE: { total: 1, passed: 1, failed: 0 },
    });
  });

  it("checks følger filrekkefølgen i expectations.json", () => {
    expect(runSemantic().checks.map((c) => c.id)).toEqual([
      "tuesday-adjust-start",
      "monday-norwegian-placement",
      "monday-german-placement",
      "spanish-must-not-leak",
      "remember-pc-once",
      "norwegian-source-coverage",
    ]);
  });

  it("rapporten er dypt identisk ved to kjøringer", () => {
    expect(runSemantic()).toEqual(runSemantic());
  });
});
