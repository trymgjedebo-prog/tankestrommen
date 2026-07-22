/**
 * Smoke-fixture-test: laster fixturen via SAMME loader som CLI-en og kjører den rene replay-
 * runneren. Låser schema/mode/coverage, canonical-innholdet (fag i profil, irrelevant språkspor,
 * day-operation, facts, evidence) og determinisme. Ingen semantisk totalscore ennå.
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadSchoolReplayFixture } from "./load-school-replay-fixture";
import { runSchoolCanonicalReplayFromModelResponse } from "@/lib/school-canonical-replay";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "smoke");

describe("school-replay smoke-fixture", () => {
  it("fixturen kan leses og replay fullfører med riktig schema/mode/coverage", () => {
    const input = loadSchoolReplayFixture(FIXTURE_DIR);
    expect(input.sourceType).toBe("text");
    expect(input.proposalId).toBe("replay-smoke-proposal-1");
    expect(input.languageTrack).toEqual({ resolvedTrack: "tysk", confidence: 0.8, reason: "single_track_detected" });

    const r = runSchoolCanonicalReplayFromModelResponse(input);
    expect(r.schemaVersion).toBe("1.0.0");
    expect(r.mode).toBe("canonical_school_replay");
    expect(r.coverage).toEqual({
      canonicalSchoolOutputs: true,
      schoolWeekOverlaySections: false,
      genericItems: false,
      secondaryTasks: false,
    });
  });

  it("canonical draft, facts og evidence finnes; språkspor/day-op etter dagens regler", () => {
    const r = runSchoolCanonicalReplayFromModelResponse(loadSchoolReplayFixture(FIXTURE_DIR));
    expect(r.outputs.canonicalSchoolContentDraft).toBeTruthy();
    expect(r.outputs.normalizedSchoolContentFacts.length).toBeGreaterThan(0);
    expect(r.outputs.evidenceReport).toBeTruthy();
    expect(r.outputs.schoolBlockProposal).toBeTruthy();

    const days = r.outputs.canonicalSchoolContentDraft!.days;
    const mon = days.find((d) => d.date === "2026-03-30")!;
    const tue = days.find((d) => d.date === "2026-03-31")!;
    // Fag i barnets profil plassert; irrelevant språkspor (spansk, ikke i profil) lekker ikke.
    expect(mon.subjectItems.map((i) => i.subjectKey).sort()).toEqual(["norsk", "tysk"]);
    const tueAll = [...tue.subjectItems, ...tue.audienceItems, ...tue.generalDayMessages];
    expect(tueAll.some((i) => (i.sourceText ?? "").includes("Spansk"))).toBe(false);
    // Day-operation bevart.
    expect(tue.dayOperation).toMatchObject({ op: "adjust_start", effectiveStart: "10:30" });
    // Fact med source coverage finnes (fra fag-prefiks-details).
    expect(r.outputs.normalizedSchoolContentFacts.some((f) => f.subjectKey === "norsk" && f.sourceCoverage === "full")).toBe(true);
  });

  it("to kjøringer fra samme fixture er dypt identiske", () => {
    const a = runSchoolCanonicalReplayFromModelResponse(loadSchoolReplayFixture(FIXTURE_DIR));
    const b = runSchoolCanonicalReplayFromModelResponse(loadSchoolReplayFixture(FIXTURE_DIR));
    expect(a).toEqual(b);
  });
});
