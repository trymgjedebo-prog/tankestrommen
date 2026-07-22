/**
 * Tester for den delte canonical-sammenstillingen `buildSchoolCanonicalOutputs` (mekanisk trukket ut
 * av `toPortalBundle`). Viktigst: PRODUKSJONSPARITET — canonical-feltene fra faktisk `toPortalBundle`
 * skal være DYPT identiske med et direkte assembly-kall gitt samme input og samme proposalId.
 * Ingen builder-logikk er endret; dette låser at ekstraksjonen er ren orkestrering.
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route"; // side-effekt: registerPortalBundleRuntime (kun paritetstestene)
import { toPortalBundle } from "@/lib/portal-bundle";
import { coerceAIAnalysisResultForPortal } from "@/lib/analysis-null-safety";
import { filterAnalysisContentByClass } from "@/lib/class-content-filter";
import { buildNormalizedSchoolContentFacts } from "@/lib/school-content-fact";
import { buildSchoolCanonicalOutputs } from "@/lib/school-canonical-outputs";
import { makeChildren, makeSchoolBlockWeekResultWithDayOperations } from "@/lib/fixtures/school-block-week.fixture";
import type { PortalImportContext } from "@/lib/portal-import-person";
import type { AIAnalysisResult, SchoolWeeklyProfile, SchoolWeekOverlayProposal } from "@/lib/types";

const CHILD_PROFILE: SchoolWeeklyProfile = {
  gradeBand: "vg2",
  weekdays: {
    "0": { useSimpleDay: false, lessons: [
      { subjectKey: "norsk", customLabel: null, start: "08:00", end: "09:00" },
      { subjectKey: "tysk", customLabel: null, start: "09:00", end: "10:00" },
    ] },
  },
};
const CTX = (): PortalImportContext => ({ knownPersons: [], children: makeChildren(), relevanceContext: { classCode: "2STC", schoolProfile: CHILD_PROFILE } });

/** Generell ukeplan-fixture med fag-prefiks (norsk + tysk i profil; spansk IKKE i profil). */
function makeSubjectWeekResult(): AIAnalysisResult {
  return {
    title: "Ukeplan uke 12 – 2STC",
    schedule: [],
    scheduleByDay: [
      { dayLabel: "Mandag", date: "2026-03-16", time: null, details: "Norsk i timen: Les kapittel 2.\nTysk i timen: Beskriv bildet.", highlights: [], rememberItems: [], deadlines: [], notes: [] },
      { dayLabel: "Tirsdag", date: "2026-03-17", time: null, details: "Spansk: Gloser kapittel 3.", highlights: [], rememberItems: [], deadlines: [], notes: [] },
    ],
    location: null, description: "Ukeplan for 2STC.", category: "beskjed", targetGroup: "2STC",
    organizer: null, contactPerson: null, sourceUrl: null, confidence: 0.95,
    extractedText: { raw: "Ukeplan uke 12.", language: "no", confidence: 0.9 },
    schoolDayOperationSignals: [
      { operation: "adjust_start", date: "2026-03-17", weekdayIndex: "1", dayLabel: "tirsdag", effectiveStart: "10:30", reason: "Oppmøte 10.30", sourceText: "Oppmøte 10.30", confidence: 0.9 },
    ],
  };
}

/** Bygg assembly-input nøyaktig slik toPortalBundle gjør (coerce → klassefilter). */
function assemblyInputFor(resultIn: AIAnalysisResult, ctx: PortalImportContext, overlay: SchoolWeekOverlayProposal | undefined, documentKind: string | undefined, proposalId: string | undefined) {
  const normalizedResult = coerceAIAnalysisResultForPortal(resultIn);
  const filteredResult = filterAnalysisContentByClass(normalizedResult, ctx.relevanceContext?.classCode);
  return {
    normalizedResult, filteredResult,
    documentKind: documentKind as never, sourceType: "text",
    personContext: ctx, languageTrack: overlay?.languageTrack,
    proposalId, fallbackSourceTitle: resultIn.title,
  };
}
function makeIdGenerator() {
  const ids = ["id-1", "id-2", "id-3", "id-4"];
  return () => {
    const id = ids.shift();
    if (!id) throw new Error("ID generator exhausted");
    return id;
  };
}
type Bundle = {
  schoolBlockProposal?: unknown;
  canonicalSchoolContentDraft?: unknown;
  evidenceReport?: unknown;
  schoolWeekOverlayProposal?: SchoolWeekOverlayProposal;
};

describe("A/C/D. realistisk skoleuke: block + facts + draft + evidence, dayOps og subject placement", () => {
  it("gir alle fire outputs med bevarte day operations og audience", () => {
    const out = buildSchoolCanonicalOutputs(
      assemblyInputFor(makeSchoolBlockWeekResultWithDayOperations(), { knownPersons: [], children: makeChildren() }, undefined, "school", "p-1"),
    );
    expect(out.schoolBlockProposal).toBeTruthy();
    // Fixturen er strukturert (classScheduleEntries) uten fag-prefiks-details → 0 facts er korrekt.
    expect(out.normalizedSchoolContentFacts).toEqual([]);
    expect(out.canonicalSchoolContentDraft).toBeTruthy();
    expect(out.evidenceReport).toBeTruthy();
    const draft = out.canonicalSchoolContentDraft!;
    const wed = draft.days.find((d) => d.date === "2026-06-17")!;
    const fri = draft.days.find((d) => d.date === "2026-06-19")!;
    expect(wed.dayOperation).toMatchObject({ op: "adjust_start", effectiveStart: "10:30" });
    expect(fri.dayOperation).toMatchObject({ op: "replace_day", effectiveStart: "09:00", effectiveEnd: "12:00" });
    const thu = draft.days.find((d) => d.date === "2026-06-18")!;
    expect(thu.audienceItems.some((i) => i.audienceEntries.some((a) => a.classCodes.includes("2STC")))).toBe(true);
  });

  it("subject placement: norsk/tysk (i profil) blir subject-items med riktig dag", () => {
    const out = buildSchoolCanonicalOutputs(assemblyInputFor(makeSubjectWeekResult(), CTX(), undefined, "school", "p-1"));
    const mon = out.canonicalSchoolContentDraft!.days.find((d) => d.date === "2026-03-16")!;
    expect(mon.subjectItems.map((i) => i.subjectKey).sort()).toEqual(["norsk", "tysk"]);
    expect(mon.subjectItems.find((i) => i.subjectKey === "norsk")!).toMatchObject({ contentType: "lesson", placement: "subject", sourceText: "Les kapittel 2." });
    // dagsoperasjon på tirsdag bevart
    const tue = out.canonicalSchoolContentDraft!.days.find((d) => d.date === "2026-03-17")!;
    expect(tue.dayOperation).toMatchObject({ op: "adjust_start", effectiveStart: "10:30" });
  });
});

describe("B. språkspor: eksisterende canonical-semantikk (profil-gren)", () => {
  it("tysk (i profil) beholdes; spansk (ikke i profil) blir ikke subject-item og lekker ikke", () => {
    const out = buildSchoolCanonicalOutputs(assemblyInputFor(makeSubjectWeekResult(), CTX(), undefined, "school", "p-1"));
    const tue = out.canonicalSchoolContentDraft!.days.find((d) => d.date === "2026-03-17")!;
    expect(tue.subjectItems.some((i) => i.subjectKey === "spansk")).toBe(false);
    const all = [...tue.subjectItems, ...tue.audienceItems, ...tue.generalDayMessages];
    expect(all.some((i) => (i.sourceText ?? "").includes("Spansk"))).toBe(false); // utelatt, ikke dagsmelding
  });
});

describe("E. facts er samme mellomstadium som direkte builder-kall", () => {
  it("assembly-facts === buildNormalizedSchoolContentFacts på samme coercede input", () => {
    const resultIn = makeSubjectWeekResult();
    const out = buildSchoolCanonicalOutputs(assemblyInputFor(resultIn, CTX(), undefined, "school", "p-1"));
    const direct = buildNormalizedSchoolContentFacts(coerceAIAnalysisResultForPortal(resultIn).scheduleByDay);
    expect(out.normalizedSchoolContentFacts).toEqual(direct); // samme rekkefølge, IDs, coverage, felt
  });
});

describe("F. immutabilitet", () => {
  it("muterer ikke result, person context eller overlay-input", async () => {
    const resultIn = makeSubjectWeekResult();
    const ctx = CTX();
    const bundle = (await toPortalBundle(resultIn, "text", "school" as never, false, ctx)) as Bundle;
    const overlay = bundle.schoolWeekOverlayProposal;
    const input = assemblyInputFor(resultIn, ctx, overlay, "school", "p-1");
    const snaps = [JSON.stringify(input.normalizedResult), JSON.stringify(input.filteredResult), JSON.stringify(ctx), JSON.stringify(overlay)];
    buildSchoolCanonicalOutputs(input);
    expect([JSON.stringify(input.normalizedResult), JSON.stringify(input.filteredResult), JSON.stringify(ctx), JSON.stringify(overlay)]).toEqual(snaps);
  });
});

describe("G. ikke-skole-gating (identisk med produksjonen)", () => {
  it("documentKind 'text' → ingen block/facts/draft, men evidence finnes", () => {
    const out = buildSchoolCanonicalOutputs(assemblyInputFor(makeSubjectWeekResult(), CTX(), undefined, "text", undefined));
    expect(out.schoolBlockProposal).toBeUndefined();
    expect(out.normalizedSchoolContentFacts).toEqual([]);
    expect(out.canonicalSchoolContentDraft).toBeNull();
    expect(out.evidenceReport).toBeTruthy();
  });

  it("school uten proposalId → eksplisitt kontraktsfeil", () => {
    expect(() => buildSchoolCanonicalOutputs(assemblyInputFor(makeSubjectWeekResult(), CTX(), undefined, "school", undefined)))
      .toThrow("proposalId kreves");
  });
});

describe("PRODUKSJONSPARITET: toPortalBundle canonical-felter === buildSchoolCanonicalOutputs", () => {
  async function assertParity(resultIn: AIAnalysisResult, ctx: PortalImportContext) {
    // Produksjonsveien med deterministisk ID: proposalId blir "id-1".
    const bundle = (await toPortalBundle(resultIn, "text", "school" as never, false, ctx, {
      now: new Date("2026-06-01T00:00:00.000Z"),
      newId: makeIdGenerator(),
    })) as Bundle;
    // Direkte assembly-kall med SAMME input (samme coerce/filter, samme overlay, samme proposalId).
    const direct = buildSchoolCanonicalOutputs(
      assemblyInputFor(resultIn, ctx, bundle.schoolWeekOverlayProposal, "school", "id-1"),
    );
    expect(direct.schoolBlockProposal).toEqual(bundle.schoolBlockProposal);
    expect(direct.canonicalSchoolContentDraft ?? undefined).toEqual(bundle.canonicalSchoolContentDraft);
    expect(direct.evidenceReport).toEqual(bundle.evidenceReport);
  }

  it("day-operations-fixturen (classScheduleEntries, uten overlay)", async () => {
    await assertParity(makeSchoolBlockWeekResultWithDayOperations(), { knownPersons: [], children: makeChildren() });
  });

  it("ukeplan med fag-prefiks + profil (overlay bygges; tysk+spansk → multiple_tracks_detected)", async () => {
    await assertParity(makeSubjectWeekResult(), CTX());
  });

  it("ukeplan med KUN tysk (overlay bygges; single_track_detected)", async () => {
    const single = makeSubjectWeekResult();
    single.scheduleByDay = [
      { dayLabel: "Mandag", date: "2026-03-16", time: null, details: "Norsk i timen: Les kapittel 2.\nTysk i timen: Beskriv bildet.", highlights: [], rememberItems: [], deadlines: [], notes: [] },
      { dayLabel: "Tirsdag", date: "2026-03-17", time: null, details: "Matematikk: Oppgaver kapittel 5.", highlights: [], rememberItems: [], deadlines: [], notes: [] },
    ];
    await assertParity(single, CTX());
  });
});
