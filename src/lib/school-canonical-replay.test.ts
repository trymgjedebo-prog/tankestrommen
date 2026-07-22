/**
 * Tester for den rene canonical replay-runneren. Viktigst: PRODUKSJONSPARITET — replayen skal gi
 * dypt identiske stages/outputs som (a) produksjonskomponentene kjørt manuelt og (b) canonical-
 * feltene fra faktisk `toPortalBundle` (route importeres KUN i integrasjonstesten for runtime-
 * registrering — aldri av replay-runneren selv). Pluss: parserfeil-paritet, egen inputvalidering,
 * determinisme og immutabilitet.
 */
import { describe, expect, it } from "vitest";
import {
  runSchoolCanonicalReplayFromModelResponse,
  type RunSchoolCanonicalReplayInput,
} from "@/lib/school-canonical-replay";
import { parseAndNormalizeModelResponse } from "@/lib/ai/analyze-image";
import { coerceAIAnalysisResultForPortal } from "@/lib/analysis-null-safety";
import { filterAnalysisContentByClass } from "@/lib/class-content-filter";
import { buildSchoolCanonicalOutputs } from "@/lib/school-canonical-outputs";
import type { PortalImportContext } from "@/lib/portal-import-person";

const NOW = new Date("2026-04-01T10:00:00.000Z");
const CTX = (): PortalImportContext => ({
  knownPersons: [],
  relevanceContext: {
    classCode: "2STC",
    schoolProfile: {
      gradeBand: "vg2",
      weekdays: { "0": { useSimpleDay: false, lessons: [
        { subjectKey: "norsk", customLabel: null, start: "08:00", end: "09:00" },
        { subjectKey: "tysk", customLabel: null, start: "09:00", end: "10:00" },
      ] } },
    },
  },
});

/** Realistisk rå modellrespons (samme form som choices[0].message.content). */
function rawModelContent(): string {
  return JSON.stringify({
    title: "Ukeplan uke 14 – 2STC",
    category: "beskjed",
    description: "Ukeplan for klasse 2STC.",
    targetGroup: "2STC",
    schedule: [],
    scheduleByDay: [
      { dayLabel: "Mandag", date: "2026-03-30", time: null, details: "Norsk i timen: Les kapittel 2.\nTysk i timen: Beskriv bildet på side 41.", highlights: [], rememberItems: [], deadlines: [], notes: [] },
      { dayLabel: "Tirsdag", date: "2026-03-31", time: null, details: "Spansk: Gloser kapittel 3.", highlights: [], rememberItems: ["Husk oppladet PC."], deadlines: [], notes: [] },
    ],
    schoolDayOperationSignals: [
      { operation: "adjust_start", date: "2026-03-31", weekdayIndex: "1", dayLabel: "tirsdag", effectiveStart: "10:30", reason: "Elevsamtaler før oppstart", sourceText: "Tirsdag starter undervisningen kl. 10.30.", confidence: 0.9 },
    ],
    extractedText: { raw: "Ukeplan uke 14 for 2STC.", language: "no", confidence: 0.92 },
    confidence: 0.95,
  });
}
const SOURCE = "Ukeplan uke 14 for 2STC. Mandag: Norsk i timen: Les kapittel 2.";
function input(overrides: Partial<RunSchoolCanonicalReplayInput> = {}): RunSchoolCanonicalReplayInput {
  return {
    rawModelContent: rawModelContent(),
    sourceText: SOURCE,
    now: NOW,
    sourceType: "text",
    personContext: CTX(),
    languageTrack: { resolvedTrack: "tysk", confidence: 0.8, reason: "single_track_detected" },
    proposalId: "replay-p-1",
    ...overrides,
  };
}

describe("parserfeil-paritet (§7): samme feil som produksjonssømmen, aldri pakket inn", () => {
  it("tom modellrespons", () => {
    expect(() => runSchoolCanonicalReplayFromModelResponse(input({ rawModelContent: "" }))).toThrow("Tom respons fra OpenAI");
  });
  it("ugyldig JSON", () => {
    expect(() => runSchoolCanonicalReplayFromModelResponse(input({ rawModelContent: "{ikke json" }))).toThrow("Kunne ikke tolke JSON fra modellen");
  });
  it("JSON null", () => {
    expect(() => runSchoolCanonicalReplayFromModelResponse(input({ rawModelContent: "null" }))).toThrow("Ugyldig JSON fra modellen");
  });
  it("gyldig JSON med manglende/nullable skolefelt → fullfører (ingen kast), evidence finnes", () => {
    const r = runSchoolCanonicalReplayFromModelResponse(input({ rawModelContent: JSON.stringify({ title: "Beskjed", schedule: [], scheduleByDay: [] }) }));
    expect(r.outputs.evidenceReport).toBeTruthy();
    expect(r.outputs.canonicalSchoolContentDraft).toBeNull(); // ingen skoledager → null draft (som produksjonen)
  });
});

describe("egen inputvalidering (§7): presise TypeError FØR parsing", () => {
  it("ugyldig now", () => {
    expect(() => runSchoolCanonicalReplayFromModelResponse(input({ now: new Date("ugyldig") }))).toThrow(TypeError);
    expect(() => runSchoolCanonicalReplayFromModelResponse(input({ now: new Date("ugyldig") }))).toThrow("'now' må være en gyldig Date");
  });
  it("tom proposalId", () => {
    expect(() => runSchoolCanonicalReplayFromModelResponse(input({ proposalId: " " }))).toThrow("'proposalId' må være en ikke-tom streng");
  });
  it("tom sourceType", () => {
    expect(() => runSchoolCanonicalReplayFromModelResponse(input({ sourceType: "" }))).toThrow("'sourceType' må være en ikke-tom streng");
  });
});

describe("determinisme (§8)", () => {
  it("to kjøringer med identisk input → dyp identisk output (ingen skjulte UUID/timestamps)", () => {
    expect(runSchoolCanonicalReplayFromModelResponse(input())).toEqual(runSchoolCanonicalReplayFromModelResponse(input()));
  });
  it("ulik proposalId → kun proposal-ID-relaterte felt endres (draft/evidence/facts uendret)", () => {
    const a = runSchoolCanonicalReplayFromModelResponse(input({ proposalId: "p-A" }));
    const b = runSchoolCanonicalReplayFromModelResponse(input({ proposalId: "p-B" }));
    expect(a.outputs.schoolBlockProposal!.proposalId).toBe("p-A");
    expect(b.outputs.schoolBlockProposal!.proposalId).toBe("p-B");
    expect({ ...a.outputs.schoolBlockProposal!, proposalId: "X" }).toEqual({ ...b.outputs.schoolBlockProposal!, proposalId: "X" });
    expect(a.outputs.canonicalSchoolContentDraft).toEqual(b.outputs.canonicalSchoolContentDraft);
    expect(a.outputs.evidenceReport).toEqual(b.outputs.evidenceReport);
    expect(a.outputs.normalizedSchoolContentFacts).toEqual(b.outputs.normalizedSchoolContentFacts);
  });
  it("ulik now → identisk output når dokumentet ikke trigger uke-/årsinferens (ingen ukenummer i noen kilde)", () => {
    // Uten ukenummer (i tittel, extractedText OG sourceText) er normaliseringen klokkeuavhengig.
    const noWeekRaw = rawModelContent().replaceAll("Ukeplan uke 14", "Skoleplan").replaceAll("uke 14", "denne perioden");
    const noWeekSource = "Skoleplan for 2STC.";
    const a = runSchoolCanonicalReplayFromModelResponse(input({ rawModelContent: noWeekRaw, sourceText: noWeekSource, now: new Date("2026-04-01T10:00:00.000Z") }));
    const b = runSchoolCanonicalReplayFromModelResponse(input({ rawModelContent: noWeekRaw, sourceText: noWeekSource, now: new Date("2031-04-01T10:00:00.000Z") }));
    expect(a).toEqual(b);
  });

  it("ulik now MED ukenummer → kun legitime årsinferens-avhengige felter endres (Fiks B); fag bevart", () => {
    // Dokumentert produksjonssemantikk: «uke 14» + now-året korrigerer dag-datoene mot inferert år.
    // Datoflyttingen kaskaderer legitimt (dato-avledede IDs; day-op-signalets 2026-dato matcher ikke
    // lenger 2031-dagene) — nettopp derfor MÅ replay bruke fast injisert `now` for paritet.
    const a = runSchoolCanonicalReplayFromModelResponse(input({ now: new Date("2026-04-01T10:00:00.000Z") }));
    const b = runSchoolCanonicalReplayFromModelResponse(input({ now: new Date("2031-04-01T10:00:00.000Z") }));
    const aDays = a.outputs.canonicalSchoolContentDraft!.days;
    const bDays = b.outputs.canonicalSchoolContentDraft!.days;
    expect(aDays.map((d) => d.date)).toEqual(["2026-03-30", "2026-03-31"]);
    expect(bDays.map((d) => d.date)).toEqual(["2031-03-30", "2031-03-31"]); // kun år-komponenten flyttet
    expect(bDays[0]!.subjectItems.map((i) => i.subjectKey).sort()).toEqual(aDays[0]!.subjectItems.map((i) => i.subjectKey).sort());
    expect(aDays[1]!.dayOperation).toMatchObject({ op: "adjust_start", effectiveStart: "10:30" }); // fast now → bevart
  });
});

describe("immutabilitet", () => {
  it("muterer ikke input", () => {
    const inp = input();
    const snap = JSON.stringify(inp);
    runSchoolCanonicalReplayFromModelResponse(inp);
    expect(JSON.stringify(inp)).toBe(snap);
  });
});

describe("PRODUKSJONSPARITET mot produksjonskomponentene (§9)", () => {
  it("stages + outputs er dypt identiske med manuell kjøring av samme produksjonsfunksjoner", () => {
    const inp = input();
    const replay = runSchoolCanonicalReplayFromModelResponse(inp);

    const modelNormalized = parseAndNormalizeModelResponse(inp.rawModelContent, { sourceText: inp.sourceText, now: inp.now, enableDiagnostics: false });
    const portalNormalized = coerceAIAnalysisResultForPortal(modelNormalized);
    const classFiltered = filterAnalysisContentByClass(portalNormalized, inp.personContext.relevanceContext?.classCode);
    const outputs = buildSchoolCanonicalOutputs({
      normalizedResult: portalNormalized,
      filteredResult: classFiltered,
      documentKind: "school",
      sourceType: inp.sourceType,
      personContext: inp.personContext,
      languageTrack: inp.languageTrack,
      proposalId: inp.proposalId,
      fallbackSourceTitle: modelNormalized.title,
    });

    expect(replay.stages.modelNormalizedResult).toEqual(modelNormalized);
    expect(replay.stages.portalNormalizedResult).toEqual(portalNormalized);
    expect(replay.stages.classFilteredResult).toEqual(classFiltered);
    expect(replay.stages.languageTrack).toEqual(inp.languageTrack);
    expect(replay.outputs.normalizedSchoolContentFacts).toEqual(outputs.normalizedSchoolContentFacts);
    expect(replay.outputs.schoolBlockProposal).toEqual(outputs.schoolBlockProposal);
    expect(replay.outputs.canonicalSchoolContentDraft).toEqual(outputs.canonicalSchoolContentDraft);
    expect(replay.outputs.evidenceReport).toEqual(outputs.evidenceReport);
  });

  it("semantikk-vakter: subject placement, språkfiltrering og day operation i replay-outputen", () => {
    const r = runSchoolCanonicalReplayFromModelResponse(input());
    const days = r.outputs.canonicalSchoolContentDraft!.days;
    const mon = days.find((d) => d.date === "2026-03-30")!;
    const tue = days.find((d) => d.date === "2026-03-31")!;
    expect(mon.subjectItems.map((i) => i.subjectKey).sort()).toEqual(["norsk", "tysk"]);
    expect(tue.dayOperation).toMatchObject({ op: "adjust_start", effectiveStart: "10:30" });
    const all = [...tue.subjectItems, ...tue.audienceItems, ...tue.generalDayMessages];
    expect(all.some((i) => (i.sourceText ?? "").includes("Spansk"))).toBe(false); // ikke i profil → droppet
    expect(all.some((i) => (i.sourceText ?? "").includes("oppladet PC"))).toBe(true); // dagsinnhold bevart
    expect(r.coverage).toEqual({ canonicalSchoolOutputs: true, schoolWeekOverlaySections: false, genericItems: false, secondaryTasks: false });
  });
});
