/**
 * ISOLERT integrasjonsparitet: replay-runneren mot faktisk `toPortalBundle`. KUN denne testfilen
 * importerer route (side-effekt: registerPortalBundleRuntime) — replay-runneren selv kjenner verken
 * route, PortalBundleRuntime eller overlay. Replayen mates med bundleens FAKTISKE
 * `schoolWeekOverlayProposal?.languageTrack` som eksplisitt input, og canonical-feltene skal være
 * dypt identiske.
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route"; // KUN for runtime-registrering i denne integrasjonstesten
import { toPortalBundle } from "@/lib/portal-bundle";
import { parseAndNormalizeModelResponse } from "@/lib/ai/analyze-image";
import { runSchoolCanonicalReplayFromModelResponse } from "@/lib/school-canonical-replay";
import type { PortalImportContext } from "@/lib/portal-import-person";
import type { SchoolWeekOverlayProposal } from "@/lib/types";

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
function makeIdGenerator() {
  const ids = ["id-1", "id-2", "id-3", "id-4"];
  return () => {
    const id = ids.shift();
    if (!id) throw new Error("ID generator exhausted");
    return id;
  };
}

describe("integrasjonsparitet: replay === toPortalBundle canonical-felter", () => {
  it("med bundleens faktiske languageTrack og samme proposalId → dyp likhet", async () => {
    const raw = rawModelContent();
    const sourceText = "Ukeplan uke 14 for 2STC.";
    // Produksjonsveien: parse (samme søm) → toPortalBundle med fast run context (proposalId = id-1).
    const productionResult = parseAndNormalizeModelResponse(raw, { sourceText, now: NOW, enableDiagnostics: false });
    const bundle = (await toPortalBundle(productionResult, "text", "school" as never, false, CTX(), {
      now: NOW,
      newId: makeIdGenerator(),
    })) as {
      schoolBlockProposal?: unknown;
      canonicalSchoolContentDraft?: unknown;
      evidenceReport?: unknown;
      schoolWeekOverlayProposal?: SchoolWeekOverlayProposal;
    };
    // Replay: samme rå tekst; bundleens FAKTISKE languageTrack som eksplisitt input; proposalId id-1.
    const replay = runSchoolCanonicalReplayFromModelResponse({
      rawModelContent: raw,
      sourceText,
      now: NOW,
      sourceType: "text",
      personContext: CTX(),
      languageTrack: bundle.schoolWeekOverlayProposal?.languageTrack,
      proposalId: "id-1",
    });
    expect(replay.outputs.schoolBlockProposal).toEqual(bundle.schoolBlockProposal);
    expect(replay.outputs.canonicalSchoolContentDraft ?? undefined).toEqual(bundle.canonicalSchoolContentDraft);
    expect(replay.outputs.evidenceReport).toEqual(bundle.evidenceReport);
  });
});
