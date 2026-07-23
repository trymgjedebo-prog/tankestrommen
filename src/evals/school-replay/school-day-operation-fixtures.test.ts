/**
 * DAY_OPERATION-regresjonsfixtures gjennom den produksjonsnære replay-flyten (fixture-loader →
 * replay-runner → expectations-loader → evaluator). Låser at canonical pipeline håndterer:
 * eksplisitt fridag og eksamens-/tentamensdag som replace_day med korrekt activityKind og
 * eksplisitte tider KUN når dokumentet oppgir dem — og normale dager som op "none".
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadSchoolReplayFixture } from "./load-school-replay-fixture";
import { loadSchoolReplayExpectations } from "./load-school-replay-expectations";
import { runSchoolCanonicalReplayFromModelResponse } from "@/lib/school-canonical-replay";
import { evaluateSchoolReplaySemantics } from "@/lib/school-replay-semantic-evaluator";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function runFixture(name: string) {
  const dir = join(FIXTURES_ROOT, name);
  const replay = runSchoolCanonicalReplayFromModelResponse(loadSchoolReplayFixture(dir));
  const report = evaluateSchoolReplaySemantics(replay, loadSchoolReplayExpectations(dir));
  return { replay, report };
}

describe.each([
  ["day-operation-free-day", ["monday-normal-day", "wednesday-free-day"]],
  ["day-operation-exam-day", ["monday-normal-day", "thursday-exam-day"]],
] as const)("fixture %s", (name, expectedIds) => {
  it("replay fullfører; passed=true; alle checks er DAY_OPERATION i filrekkefølge", () => {
    const { report } = runFixture(name);
    expect(report.fixtureId).toBe(name);
    expect(report.passed).toBe(true);
    expect(report.summary.failed).toBe(0);
    expect(report.checks.map((c) => c.id)).toEqual([...expectedIds]);
    expect(report.checks.every((c) => c.category === "DAY_OPERATION")).toBe(true);
    // Kun DAY_OPERATION har checks; øvrige kategorier finnes i summary med total 0.
    for (const [cat, s] of Object.entries(report.summary.byCategory)) {
      expect(s.total).toBe(cat === "DAY_OPERATION" ? expectedIds.length : 0);
    }
  });

  it("rapporten er dypt identisk ved to kjøringer", () => {
    expect(runFixture(name).report).toEqual(runFixture(name).report);
  });
});

describe("free-day-semantikk", () => {
  it("normaldag none; fridag replace_day/free_day; INGEN start/slutt konstrueres uten kilde-tid", () => {
    const { replay } = runFixture("day-operation-free-day");
    const days = replay.outputs.canonicalSchoolContentDraft!.days;
    const mon = days.find((d) => d.date === "2026-04-20")!;
    const wed = days.find((d) => d.date === "2026-04-22")!;
    expect(mon.dayOperation).toEqual({ op: "none" });
    expect(wed.dayOperation).toMatchObject({ op: "replace_day", activityKind: "free_day" });
    // Dokumentet oppgir ingen tider → tider skal ALDRI konstrueres.
    expect((wed.dayOperation as { effectiveStart: string | null }).effectiveStart).toBeNull();
    expect((wed.dayOperation as { effectiveEnd: string | null }).effectiveEnd).toBeNull();
  });
});

describe("exam-day-semantikk", () => {
  it("normaldag none; eksamensdag replace_day/exam_day med eksplisitt 09:00–13:00", () => {
    const { replay } = runFixture("day-operation-exam-day");
    const days = replay.outputs.canonicalSchoolContentDraft!.days;
    const mon = days.find((d) => d.date === "2026-04-20")!;
    const thu = days.find((d) => d.date === "2026-04-23")!;
    expect(mon.dayOperation).toEqual({ op: "none" });
    expect(thu.dayOperation).toMatchObject({
      op: "replace_day",
      activityKind: "exam_day",
      effectiveStart: "09:00",
      effectiveEnd: "13:00",
    });
  });
});
