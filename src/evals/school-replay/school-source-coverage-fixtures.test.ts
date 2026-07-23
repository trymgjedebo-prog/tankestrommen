/**
 * SOURCE_COVERAGE-regresjonsfixtures gjennom den produksjonsnære replay-flyten.
 *
 * full: komplett strukturert container → fact med coverage "full" + fagplassert canonical item.
 * partial: LEDENDE PREAMBLE i containeren (produksjonens reelle partial-mekanisme) → fact med
 * coverage "partial", INGEN fagplassering (konservativ kontrakt), preamble bevart uten duplisering.
 * sourceFactId-er og facts-rekkefølge er stabile mellom kjøringer.
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
  ["source-coverage-full", 2],
  ["source-coverage-partial", 3],
] as const)("fixture %s", (name, checkCount) => {
  it("passed=true; riktig fixtureId; total som forventet", () => {
    const { report } = runFixture(name);
    expect(report.fixtureId).toBe(name);
    expect(report.passed).toBe(true);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.total).toBe(checkCount);
  });
  it("rapport, facts-rekkefølge og sourceFactId-er er dypt identiske ved to kjøringer", () => {
    const a = runFixture(name);
    const b = runFixture(name);
    expect(a.report).toEqual(b.report);
    expect(a.replay.outputs.normalizedSchoolContentFacts.map((f) => f.sourceFactId))
      .toEqual(b.replay.outputs.normalizedSchoolContentFacts.map((f) => f.sourceFactId));
  });
});

describe("full-semantikk", () => {
  it("fact har coverage full, riktig subjectKey, og canonical item er koblet via tekst/container", () => {
    const { replay } = runFixture("source-coverage-full");
    const facts = replay.outputs.normalizedSchoolContentFacts;
    const fact = facts.find((f) => f.subjectKey === "naturfag")!;
    expect(fact.sourceCoverage).toBe("full");
    expect(fact.text).toContain("fotosyntesen");
    // Canonical item finnes under riktig fag og deler synlig tekst med faktumet.
    const day = replay.outputs.canonicalSchoolContentDraft!.days[0]!;
    const item = day.subjectItems.find((i) => i.subjectKey === "naturfag")!;
    expect(item.sourceText).toBe(fact.text);
    // Original kildecontainer bevart som evidens på itemet (kobling via source-container).
    expect(item.evidence).toBe(fact.originalSourceText);
  });
});

describe("partial-semantikk (reell preamble-mekanisme)", () => {
  it("fact har coverage partial; ingen fagplassering; preamble bevart uten duplisering", () => {
    const { replay } = runFixture("source-coverage-partial");
    const facts = replay.outputs.normalizedSchoolContentFacts;
    const fact = facts.find((f) => f.subjectKey === "norsk")!;
    expect(fact.sourceCoverage).toBe("partial");
    const day = replay.outputs.canonicalSchoolContentDraft!.days[0]!;
    expect(day.subjectItems).toEqual([]); // konservativ kontrakt: partial → ikke fagplassert
    // Hele containeren (inkl. preamble OG fagteksten) bevart som ÉN dagsmelding.
    expect(day.generalDayMessages).toHaveLength(1);
    const msg = day.generalDayMessages[0]!.sourceText ?? "";
    expect(msg).toContain("samtykkeskjemaet");
    expect(msg).toContain("Les kapittel 3");
  });
});
