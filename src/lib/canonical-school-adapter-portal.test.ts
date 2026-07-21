/**
 * Produksjons-/portalintegrasjon: kjører den FAKTISKE `toPortalBundle`-veien (uten å kalle adapteren
 * direkte, uten å mocke adapterresultatet, uten å sette draften direkte) og beviser at det additive
 * `canonicalSchoolContentDraft`:
 *  - fagplasserer HVER fag-rad i en multi-subject `details`-container separat, med per-rad SYNLIG
 *    tekst (ikke hele bloben gjentatt), og uten dagsnivå-duplikat når containeren er fullstendig dekket,
 *  - gir flere items for flere rader av SAMME fag (ingen kollaps),
 *  - IKKE mister generell informasjon / preamble når containeren bare er delvis dekket,
 * mens schoolBlock beholder hele kildelinjen og øvrige outputs er uendret (additivt felt).
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route"; // side-effect: registerPortalBundleRuntime
import { toPortalBundle } from "@/lib/portal-bundle";
import { makeChildren, makeSchoolBlockWeekResultWithDayOperations } from "@/lib/fixtures/school-block-week.fixture";
import type { PortalImportContext } from "@/lib/portal-import-person";
import type { CanonicalSchoolContentDraft } from "@/lib/school-content-canonical";
import type { AIAnalysisResult, SchoolBlockProposal, SchoolWeeklyProfile } from "@/lib/types";

type Bundle = {
  items: Array<{ kind: string }>;
  schoolBlockProposal?: SchoolBlockProposal;
  schoolWeekOverlayProposal?: unknown;
  canonicalSchoolContentDraft?: CanonicalSchoolContentDraft;
  evidenceReport?: unknown;
};
async function bundleOf(result: AIAnalysisResult, documentKind: string | undefined, ctx: PortalImportContext): Promise<Bundle> {
  return (await toPortalBundle(result, "text", documentKind as never, false, ctx)) as Bundle;
}

const MULTI = "Norsk i timen: Les kapittel 2.\nTysk i timen: Beskriv bildet.";
const SAME = "Norsk i timen: Les kapittel 2.\nNorsk i timen: Skriv sammendrag.";
const PARTIAL = "Husk oppladet PC.\nNaturfag: Forsøk med magnetisme.";

/** Generell produksjonsfixture (ikke en bestemt skole/elev): fag-prefiks-linjer i `details`. */
function makeWeekResult(): AIAnalysisResult {
  return {
    title: "Ukeplan uke 12 – 2STC",
    schedule: [],
    scheduleByDay: [
      { dayLabel: "Mandag", date: "2026-03-16", time: null, details: MULTI, highlights: [], rememberItems: [], deadlines: [], notes: [] },
      { dayLabel: "Tirsdag", date: "2026-03-17", time: null, details: SAME, highlights: [], rememberItems: [], deadlines: [], notes: [] },
      { dayLabel: "Onsdag", date: "2026-03-18", time: null, details: PARTIAL, highlights: [], rememberItems: [], deadlines: [], notes: [] },
    ],
    location: null, description: "Ukeplan for 2STC.", category: "beskjed", targetGroup: "2STC",
    organizer: null, contactPerson: null, sourceUrl: null, confidence: 0.95,
    extractedText: { raw: "Ukeplan uke 12.", language: "no", confidence: 0.9 },
    schoolDayOperationSignals: [
      { operation: "adjust_start", date: "2026-03-17", weekdayIndex: "1", dayLabel: "tirsdag", effectiveStart: "10:30", reason: "Oppmøte 10.30", sourceText: "Oppmøte 10.30", confidence: 0.9 },
    ],
  };
}
const CHILD_PROFILE: SchoolWeeklyProfile = {
  gradeBand: "vg2",
  weekdays: { "0": { useSimpleDay: false, lessons: [{ subjectKey: "norsk", customLabel: null, start: "08:00", end: "09:00" }, { subjectKey: "tysk", customLabel: null, start: "09:00", end: "10:00" }] } },
};
const CTX = (): PortalImportContext => ({ knownPersons: [], children: makeChildren(), relevanceContext: { classCode: "2STC", schoolProfile: CHILD_PROFILE } });
const norm = (s: string) => s.trim().replace(/\s+/g, " ");

describe("canonicalSchoolContentDraft — portalintegrasjon (container/faktum gjennom produksjonsveien)", () => {
  it("multi-subject details: to separate items, per-rad synlig sourceText, ingen blob-gjentakelse, ingen dagsnivå-kopi", async () => {
    const bundle = await bundleOf(makeWeekResult(), "school", CTX());
    expect("canonicalSchoolContentDraft" in bundle).toBe(true);

    // schoolBlock beholder HELE kildelinjen (én common med hele bloben).
    const blockMon = bundle.schoolBlockProposal!.days.find((d) => d.date === "2026-03-16")!;
    expect(blockMon.contentItems.some((c) => norm(c.sourceText ?? "") === norm(MULTI))).toBe(true);

    const mon = bundle.canonicalSchoolContentDraft!.days.find((d) => d.date === "2026-03-16")!;
    expect(mon.subjectItems.map((i) => i.subjectKey).sort()).toEqual(["norsk", "tysk"]);
    expect(mon.subjectItems.find((i) => i.subjectKey === "norsk")!.sourceText).toBe("Les kapittel 2.");
    expect(mon.subjectItems.find((i) => i.subjectKey === "tysk")!.sourceText).toBe("Beskriv bildet.");
    expect(mon.subjectItems.every((i) => i.contentType === "lesson")).toBe(true);
    // hele bloben vises IKKE under noe item, og finnes ikke som dagsnivå-kopi.
    const all = [...mon.subjectItems, ...mon.audienceItems, ...mon.generalDayMessages];
    expect(all.some((i) => norm(i.sourceText ?? "") === norm(MULTI))).toBe(false);
    expect(mon.generalDayMessages).toHaveLength(0);
  });

  it("flere rader av samme fag i én container → to canonical items (ingen kollaps)", async () => {
    const tue = (await bundleOf(makeWeekResult(), "school", CTX())).canonicalSchoolContentDraft!.days.find((d) => d.date === "2026-03-17")!;
    const norsk = tue.subjectItems.filter((i) => i.subjectKey === "norsk");
    expect(norsk).toHaveLength(2);
    expect(norsk.map((i) => i.sourceText).sort()).toEqual(["Les kapittel 2.", "Skriv sammendrag."]);
    // dagsoperasjon bevart på samme dag.
    expect(tue.dayOperation).toMatchObject({ op: "adjust_start", effectiveStart: "10:30" });
  });

  it("delvis container (preamble + faglinje) → generell informasjon går IKKE tapt, ingen bred supersede", async () => {
    const wed = (await bundleOf(makeWeekResult(), "school", CTX())).canonicalSchoolContentDraft!.days.find((d) => d.date === "2026-03-18")!;
    expect(wed.subjectItems).toEqual([]); // partial → ingen fagplassering
    const all = [...wed.subjectItems, ...wed.audienceItems, ...wed.generalDayMessages];
    // preamblen «Husk oppladet PC.» er bevart (som del av den beholdte containeren).
    expect(all.some((i) => (i.sourceText ?? "").includes("Husk oppladet PC."))).toBe(true);
  });

  it("PARITET: eksisterende outputs uendret; schoolBlockProposal deterministisk (kun proposalId varierer)", async () => {
    const result = makeWeekResult();
    const bundle = await bundleOf(result, "school", CTX());
    expect(bundle.schoolBlockProposal!.kind).toBe("school_block");
    expect(bundle.evidenceReport).toBeTruthy();
    expect(Array.isArray(bundle.items)).toBe(true);
    const b2 = await bundleOf(result, "school", CTX());
    const strip = (p: SchoolBlockProposal) => ({ ...p, proposalId: "X" });
    expect(strip(b2.schoolBlockProposal!)).toEqual(strip(bundle.schoolBlockProposal!));
  });

  it("torsdags strukturerte audience overlever i draften (fixture med classScheduleEntries)", async () => {
    const bundle = await bundleOf(makeSchoolBlockWeekResultWithDayOperations(), "school", { knownPersons: [], children: makeChildren() });
    const draft = bundle.canonicalSchoolContentDraft!;
    const thu = draft.days.find((d) => d.date === "2026-06-18")!;
    expect(thu.audienceItems.some((i) => i.audienceEntries.some((a) => a.classCodes.includes("2STC")))).toBe(true);
    const wed = draft.days.find((d) => d.date === "2026-06-17")!;
    const fri = draft.days.find((d) => d.date === "2026-06-19")!;
    expect(wed.dayOperation).toMatchObject({ op: "adjust_start", effectiveStart: "10:30" });
    expect(fri.dayOperation).toMatchObject({ op: "replace_day", effectiveStart: "09:00", effectiveEnd: "12:00" });
  });

  it("hver canonical item ligger i nøyaktig én samling per dag (ingen duplikat itemId)", async () => {
    const draft = (await bundleOf(makeWeekResult(), "school", CTX())).canonicalSchoolContentDraft!;
    for (const day of draft.days) {
      const ids = [...day.subjectItems, ...day.audienceItems, ...day.generalDayMessages].map((i) => i.itemId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("gating: andre documentKinds emitterer ikke canonicalSchoolContentDraft", async () => {
    for (const kind of ["auto", "activity_plan", "event_doc", "timetable", "text"] as const) {
      const bundle = await bundleOf(makeWeekResult(), kind, CTX());
      expect("canonicalSchoolContentDraft" in bundle, `kind=${kind}`).toBe(false);
    }
  });
});
