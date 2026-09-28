/**
 * DUPLICATION-regresjon for TEKSTprompt-formen (`days[]`), ikke bildepromptens `scheduleByDay.details`.
 *
 * Tekstformen normaliseres til `scheduleByDay` med en serverside-SYNTETISERT `details`-blob
 * («Høydepunkter: …\nHusk: …») i tillegg til de atomiske feltene. Bloben er ren gjentakelse av
 * de atomiske feltene og skal derfor ikke bli et eget logisk canonical item: hvert faktum skal
 * forekomme nøyaktig én gang (to dagsmeldinger — ikke tre).
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadSchoolReplayFixture } from "./load-school-replay-fixture";
import { loadSchoolReplayExpectations } from "./load-school-replay-expectations";
import { runSchoolCanonicalReplayFromModelResponse } from "@/lib/school-canonical-replay";
import { evaluateSchoolReplaySemantics } from "@/lib/school-replay-semantic-evaluator";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "duplication-text-shape-details");

function runFixture() {
  const replay = runSchoolCanonicalReplayFromModelResponse(loadSchoolReplayFixture(FIXTURE_DIR));
  const report = evaluateSchoolReplaySemantics(replay, loadSchoolReplayExpectations(FIXTURE_DIR));
  return { replay, report };
}

describe("fixture duplication-text-shape-details", () => {
  it("fixturen treffer faktisk den syntetiserte details-stien (tekstformen)", () => {
    const { replay } = runFixture();
    const day = replay.stages.modelNormalizedResult.scheduleByDay[0]!;
    expect(day.details).toBe("Høydepunkter: Gym ute torsdag.\nHusk: Husk regntøy.");
    expect(day.highlights).toEqual(["Gym ute torsdag."]);
    expect(day.rememberItems).toEqual(["Husk regntøy."]);
  });

  it("passed=true; tre DUPLICATION-checks", () => {
    const { report } = runFixture();
    expect(report.fixtureId).toBe("duplication-text-shape-details");
    expect(report.passed).toBe(true);
    expect(report.summary).toMatchObject({ total: 3, passed: 3, failed: 0 });
    expect(report.summary.byCategory.DUPLICATION).toEqual({ total: 3, passed: 3, failed: 0 });
  });

  it("hvert atomiske faktum forekommer nøyaktig én gang — to dagsmeldinger, ikke tre", () => {
    const { replay } = runFixture();
    const day = replay.outputs.canonicalSchoolContentDraft!.days.find((d) => d.date === "2026-10-08")!;
    expect(day.subjectItems).toEqual([]);
    expect(day.audienceItems).toEqual([]);
    expect(day.generalDayMessages.map((i) => i.sourceText)).toEqual(["Gym ute torsdag.", "Husk regntøy."]);
    const all = [...day.subjectItems, ...day.audienceItems, ...day.generalDayMessages];
    expect(all.some((i) => (i.sourceText ?? "").includes("Høydepunkter:"))).toBe(false);
  });

  it("den syntetiserte bloben gir heller ingen interne details-fakta", () => {
    const { replay } = runFixture();
    expect(replay.outputs.normalizedSchoolContentFacts.filter((f) => f.sourceField === "details")).toEqual([]);
  });

  it("rapport og replay er dypt identiske ved to kjøringer", () => {
    const a = runFixture();
    const b = runFixture();
    expect(a.report).toEqual(b.report);
    expect(a.replay).toEqual(b.replay);
  });
});
