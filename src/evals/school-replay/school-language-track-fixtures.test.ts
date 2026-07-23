/**
 * LANGUAGE_TRACK-regresjonsfixtures: et KONTROLLERT A/B-PAR uten schoolProfile som isolerer
 * `languageTrack`-variabelen (kontrakten: profilen er autoritativ når den finnes; languageTrack
 * brukes når profilen ikke gir fagdekning — derfor testes sporet uten profil).
 *
 * A/B-kontrakten (låst her): model-response.txt og source.txt er BYTE-identiske; personContext er
 * identisk og uten schoolProfile; eneste relevante inputforskjell er `languageTrack`
 * (tysk vs. null), pluss volatil proposalId.
 *
 * selected (track=tysk): tysk fagplasseres; spansk ekskluderes HELT fra canonical draft;
 * facts inneholder fortsatt begge språkfag (facts påvirkes ikke av filtreringen).
 * unresolved (track=null): ingen fagplassering; HELE containeren bevares som ÉN dagsmelding med
 * `ambiguous_subject` — begge fragmentene i samme logiske item, ingenting tapt, ingenting duplisert.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadSchoolReplayFixture } from "./load-school-replay-fixture";
import { loadSchoolReplayExpectations } from "./load-school-replay-expectations";
import { runSchoolCanonicalReplayFromModelResponse } from "@/lib/school-canonical-replay";
import { evaluateSchoolReplaySemantics } from "@/lib/school-replay-semantic-evaluator";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const SELECTED = join(FIXTURES_ROOT, "language-track-selected");
const UNRESOLVED = join(FIXTURES_ROOT, "language-track-unresolved");

function runFixture(dir: string) {
  const input = loadSchoolReplayFixture(dir);
  const replay = runSchoolCanonicalReplayFromModelResponse(input);
  const report = evaluateSchoolReplaySemantics(replay, loadSchoolReplayExpectations(dir));
  return { input, replay, report };
}

describe("A/B-kontrakten: kun languageTrack varierer", () => {
  it("model-response og source er byte-identiske; personContext identisk og UTEN schoolProfile", () => {
    expect(readFileSync(join(SELECTED, "model-response.txt"), "utf8")).toBe(readFileSync(join(UNRESOLVED, "model-response.txt"), "utf8"));
    expect(readFileSync(join(SELECTED, "source.txt"), "utf8")).toBe(readFileSync(join(UNRESOLVED, "source.txt"), "utf8"));
    const a = loadSchoolReplayFixture(SELECTED);
    const b = loadSchoolReplayFixture(UNRESOLVED);
    expect(a.personContext).toEqual(b.personContext);
    expect(a.personContext.relevanceContext?.schoolProfile).toBeUndefined();
    expect(b.personContext.relevanceContext?.schoolProfile).toBeUndefined();
    expect(a.now).toEqual(b.now);
    expect(a.sourceType).toBe(b.sourceType);
    // Eneste relevante forskjell (utenom proposalId):
    expect(a.languageTrack).toEqual({ resolvedTrack: "tysk", confidence: 0.8, reason: "single_track_detected" });
    expect(b.languageTrack).toBeUndefined(); // JSON null → undefined via loaderen
  });
});

describe.each([
  ["language-track-selected", SELECTED, 4],
  ["language-track-unresolved", UNRESOLVED, 4],
] as const)("fixture %s", (id, dir, checkCount) => {
  it("passed=true; riktig fixtureId; check-rekkefølge følger expectations", () => {
    const { report } = runFixture(dir);
    expect(report.fixtureId).toBe(id);
    expect(report.passed).toBe(true);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.total).toBe(checkCount);
  });
  it("rapport og replay er dypt identiske ved to kjøringer", () => {
    const a = runFixture(dir);
    const b = runFixture(dir);
    expect(a.report).toEqual(b.report);
    expect(a.replay).toEqual(b.replay);
  });
});

describe("selected-semantikk (track=tysk)", () => {
  it("tysk fagplassert én gang; spansk HELT ekskludert; spansk-fact finnes fortsatt", () => {
    const { replay, report } = runFixture(SELECTED);
    const day = replay.outputs.canonicalSchoolContentDraft!.days.find((d) => d.date === "2026-05-11")!;
    expect(day.subjectItems.map((i) => i.subjectKey)).toEqual(["tysk"]);
    const all = [...day.subjectItems, ...day.audienceItems, ...day.generalDayMessages];
    expect(all.some((i) => (i.sourceText ?? "").includes("Repeter gloselisten"))).toBe(false);
    expect(day.generalDayMessages).toEqual([]); // ingen spansk-lekkasje som dagsmelding
    // Facts-observasjon: begge språkfagene finnes som facts (filtreringen gjelder canonical items).
    expect(replay.outputs.normalizedSchoolContentFacts.map((f) => f.subjectKey).sort()).toEqual(["spansk", "tysk"]);
    // Kategorifordeling: 2× SUBJECT_PLACEMENT + 2× LANGUAGE_TRACK.
    expect(report.summary.byCategory.SUBJECT_PLACEMENT.total).toBe(2);
    expect(report.summary.byCategory.LANGUAGE_TRACK.total).toBe(2);
  });
});

describe("unresolved-semantikk (track=null) — låst konservativ kontrakt", () => {
  it("ingen fagplassering; ÉN dagsmelding med BEGGE fragmentene + ambiguous_subject; facts intakte", () => {
    const { replay, report } = runFixture(UNRESOLVED);
    const day = replay.outputs.canonicalSchoolContentDraft!.days.find((d) => d.date === "2026-05-11")!;
    expect(day.subjectItems).toEqual([]); // ingen gjetting mellom tysk og spansk
    expect(day.generalDayMessages).toHaveLength(1);
    const msg = day.generalDayMessages[0]!;
    expect(msg.reviewFlags.some((f) => f.code === "ambiguous_subject")).toBe(true);
    // Begge fragmentene bevart i SAMME logiske item — ingen tap, ingen duplisering.
    expect(msg.sourceText ?? "").toContain("Skriv fem setninger");
    expect(msg.sourceText ?? "").toContain("Repeter gloselisten");
    expect(replay.outputs.normalizedSchoolContentFacts.map((f) => f.subjectKey).sort()).toEqual(["spansk", "tysk"]);
    // Kategorifordeling: 2× SUBJECT_PLACEMENT (fravær) + 2× DUPLICATION (bevaring uten duplikat).
    expect(report.summary.byCategory.SUBJECT_PLACEMENT.total).toBe(2);
    expect(report.summary.byCategory.DUPLICATION.total).toBe(2);
    expect(report.summary.byCategory.LANGUAGE_TRACK.total).toBe(0);
  });
});
