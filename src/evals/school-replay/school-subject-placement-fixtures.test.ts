/**
 * SUBJECT_PLACEMENT-regresjonsfixtures gjennom den produksjonsnære replay-flyten. Låser at
 * canonical pipeline: plasserer flere fag på samme dag under riktig subjectKey, holder innhold
 * strengt dagavgrenset, aldri plasserer under feil fag, og representerer flere tekster under samme
 * fag som SEPARATE logiske items (produksjonens faktiske kontrakt — ingen sammenslåing).
 *
 * §9-observasjon (låst her): med full container-dekning er `generalDayMessages` TOM — fagtekstene
 * dupliseres ikke som dagsmeldinger. Skulle dette endre seg er det en DUPLICATION-kandidat, ikke
 * en SUBJECT_PLACEMENT-sak.
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
  ["subject-placement-multi-subject", 8],
  ["subject-placement-day-scope", 4],
] as const)("fixture %s", (name, checkCount) => {
  it("passed=true; alle checks er SUBJECT_PLACEMENT i filrekkefølge; øvrige kategorier total 0", () => {
    const { report } = runFixture(name);
    expect(report.fixtureId).toBe(name);
    expect(report.passed).toBe(true);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.total).toBe(checkCount);
    expect(report.checks.every((c) => c.category === "SUBJECT_PLACEMENT")).toBe(true);
    for (const [cat, s] of Object.entries(report.summary.byCategory)) {
      expect(s.total).toBe(cat === "SUBJECT_PLACEMENT" ? checkCount : 0);
    }
  });
  it("rapporten er dypt identisk ved to kjøringer", () => {
    expect(runFixture(name).report).toEqual(runFixture(name).report);
  });
});

describe("multi-subject-semantikk", () => {
  it("alle tre fag i subjectItems; to SEPARATE norsk-items; ingen tekst under feil fag; tomme dagsmeldinger", () => {
    const { replay, report } = runFixture("subject-placement-multi-subject");
    const day = replay.outputs.canonicalSchoolContentDraft!.days.find((d) => d.date === "2026-05-04")!;
    // Alle tre fag finnes; norsk har NØYAKTIG to separate logiske items (ingen feil sammenslåing).
    expect([...new Set(day.subjectItems.map((i) => i.subjectKey))].sort()).toEqual(["matematikk", "norsk", "tysk"]);
    const norskItems = day.subjectItems.filter((i) => i.subjectKey === "norsk");
    expect(norskItems).toHaveLength(2);
    expect(norskItems.map((i) => i.sourceText).sort()).toEqual([
      "Les kapittel 4 og skriv tre setninger.",
      "Lever refleksjonsnotatet fredag.",
    ]);
    expect(new Set(norskItems.map((i) => i.itemId)).size).toBe(2); // to logiske items
    // Kryssjekkene (0 treff under feil fag) besto — verifisert via rapporten:
    for (const id of ["norsk-text-not-under-matematikk", "matte-text-not-under-norsk", "tysk-text-not-under-norsk", "tysk-text-not-under-matematikk"]) {
      expect(report.checks.find((c) => c.id === id)!.status).toBe("pass");
    }
    // §9-observasjon: fagtekstene dupliseres IKKE som dagsmeldinger (full container-dekning).
    expect(day.generalDayMessages).toEqual([]);
  });
});

describe("day-scope-semantikk", () => {
  it("mandagstekst kun på mandag, tirsdagstekst kun på tirsdag; korrekt subjectKey begge dager", () => {
    const { replay } = runFixture("subject-placement-day-scope");
    const days = replay.outputs.canonicalSchoolContentDraft!.days;
    const mon = days.find((d) => d.date === "2026-05-04")!;
    const tue = days.find((d) => d.date === "2026-05-05")!;
    expect(mon.subjectItems).toHaveLength(1);
    expect(tue.subjectItems).toHaveLength(1);
    expect(mon.subjectItems[0]!).toMatchObject({ subjectKey: "norsk", sourceText: "Les kapittel 6." });
    expect(tue.subjectItems[0]!).toMatchObject({ subjectKey: "norsk", sourceText: "Skriv sammendrag av kapittel 7." });
    // Ingen lekkasje på tvers av dager.
    expect(mon.subjectItems[0]!.sourceText).not.toContain("sammendrag");
    expect(tue.subjectItems[0]!.sourceText).not.toContain("kapittel 6");
  });
});
