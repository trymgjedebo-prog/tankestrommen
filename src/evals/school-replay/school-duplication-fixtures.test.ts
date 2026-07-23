/**
 * DUPLICATION-regresjonsfixtures gjennom den produksjonsnære replay-flyten.
 *
 * single-logical-item: produksjonens NATURLIGE to-felts-form (samme tekst i sourceText OG
 * descriptionLines av samme block-common-item) telles som ETT logisk item.
 * no-residual-leak: fagplassert tekst har ingen residual-kopi (block-common superseded);
 * dagsmelding finnes nøyaktig én gang.
 * day-scope: samme påminnelse legitimt på to dager — globalt 2, datoscopet 1 per dag.
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
  ["duplication-single-logical-item", 1],
  ["duplication-no-residual-leak", 3],
  ["duplication-day-scope", 3],
] as const)("fixture %s", (name, checkCount) => {
  it("passed=true; riktig fixtureId; total som forventet", () => {
    const { report } = runFixture(name);
    expect(report.fixtureId).toBe(name);
    expect(report.passed).toBe(true);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.total).toBe(checkCount);
  });
  it("rapporten er dypt identisk ved to kjøringer", () => {
    expect(runFixture(name).report).toEqual(runFixture(name).report);
  });
});

describe("single-logical-item: to felt på samme item telles som ETT", () => {
  it("teksten ligger i BÅDE sourceText og descriptionLines av samme item — matchCount 1", () => {
    const { replay, report } = runFixture("duplication-single-logical-item");
    const day = replay.outputs.canonicalSchoolContentDraft!.days[0]!;
    expect(day.generalDayMessages).toHaveLength(1);
    const item = day.generalDayMessages[0]!;
    expect(item.sourceText ?? "").toContain("Husk gymtøy og innesko");
    expect(item.sections.descriptionLines).toEqual(["Husk gymtøy og innesko til aktivitetstimen."]);
    const check = report.checks.find((c) => c.id === "reminder-counts-as-one-logical-item")!;
    expect(check).toMatchObject({ status: "pass", category: "DUPLICATION" });
    expect(check.actual).toEqual({ matchCount: 1 });
  });
});

describe("no-residual-leak: fagplassering og duplication er ulike kategorier", () => {
  it("subject item finnes; ingen residual i generalDayMessages; dagsmelding nøyaktig én gang", () => {
    const { replay, report } = runFixture("duplication-no-residual-leak");
    const day = replay.outputs.canonicalSchoolContentDraft!.days[0]!;
    expect(day.subjectItems.map((i) => i.subjectKey)).toEqual(["norsk"]);
    // Fagteksten finnes IKKE som dagsmelding (superseded); kun påminnelsen ligger der.
    expect(day.generalDayMessages).toHaveLength(1);
    expect(day.generalDayMessages[0]!.sourceText ?? "").toContain("Ta med matpakke");
    // Kategoriene er atskilte: placement-checken er SUBJECT_PLACEMENT, dup-checkene DUPLICATION.
    expect(report.checks.find((c) => c.id === "norsk-text-placed-under-norsk")!.category).toBe("SUBJECT_PLACEMENT");
    expect(report.checks.find((c) => c.id === "norsk-text-no-residual-copy")!.category).toBe("DUPLICATION");
  });
});

describe("day-scope: legitim gjentakelse på tvers av dager", () => {
  it("to logiske items globalt (én per dag); datoscopet teller 1 per dag", () => {
    const { replay, report } = runFixture("duplication-day-scope");
    const days = replay.outputs.canonicalSchoolContentDraft!.days;
    expect(days.map((d) => d.generalDayMessages.length)).toEqual([1, 1]);
    expect(report.checks.find((c) => c.id === "reminder-global-twice-is-legitimate")!.actual).toEqual({ matchCount: 2 });
    expect(report.checks.find((c) => c.id === "reminder-monday-once")!.actual).toEqual({ matchCount: 1 });
    expect(report.checks.find((c) => c.id === "reminder-wednesday-once")!.actual).toEqual({ matchCount: 1 });
  });
});
