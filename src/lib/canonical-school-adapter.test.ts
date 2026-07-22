/**
 * Generelle tester for produksjonsadapteren `buildCanonicalSchoolContentDraft` (syntetiske fixtures).
 * Fag hentes fra de delte `NormalizedSchoolContentFact`-radene og plasseres på den autoritative
 * schoolBlock-dagen. Container-identitet er atskilt fra faktum-identitet: flere fag i samme
 * kildecontainer gir flere items med hver sin SYNLIGE tekst; supersede av schoolBlock-common skjer
 * KUN når hele kildecontaineren er dekket (`full`). Dekker også kategori-prioritet, child-audience,
 * språkspor, dagsoperasjon, determinisme og immutability.
 */
import { describe, expect, it } from "vitest";
import { buildCanonicalSchoolContentDraft } from "@/lib/canonical-school-adapter";
import type { NormalizedSchoolContentFact, SchoolContentSectionKey, SchoolContentSourceCoverage, SchoolContentSourceField } from "@/lib/school-content-fact";
import type { PortalImportContext } from "@/lib/portal-import-person";
import type {
  SchoolBlockAudienceEntry,
  SchoolBlockContentItem,
  SchoolBlockDay,
  SchoolBlockDayOperation,
  SchoolBlockProposal,
  SchoolProfileWeekdayIndex,
  SchoolWeeklyProfile,
  SchoolWeekOverlayProposal,
} from "@/lib/types";

const MON = "0" as const;
const TUE = "1" as const;
const FRI = "4" as const;

function commonItem(sourceText: string, contentType: SchoolBlockContentItem["contentType"] = "message"): SchoolBlockContentItem {
  return {
    itemId: `c-${sourceText}`, title: sourceText, contentType, action: "enrich", subject: null, subjectKey: null,
    customLabel: null, audienceScope: "common", commonSchedule: null, audienceEntries: [], resolvedChildAudience: null,
    sections: { descriptionLines: [sourceText] }, activityKind: null, evidence: null, sourceText, confidence: 0.9, reviewFlags: [],
  };
}
function entry(classCodes: string[], isChildAudience: boolean | null, id = classCodes.join(""), start = "10:00", end = "11:00", room: string | null = "A1"): SchoolBlockAudienceEntry {
  return { audienceEntryId: `ae-${id}`, classCodes, pulje: null, start, end, room, teacher: null, isChildAudience };
}
function audienceItem(sourceText: string, entries: SchoolBlockAudienceEntry[], resolved: SchoolBlockContentItem["resolvedChildAudience"] = null): SchoolBlockContentItem {
  return {
    itemId: `a-${sourceText}`, title: sourceText, contentType: "message", action: "enrich", subject: null, subjectKey: null,
    customLabel: null, audienceScope: "per_audience", commonSchedule: null, audienceEntries: entries, resolvedChildAudience: resolved,
    sections: {}, activityKind: null, evidence: null, sourceText, confidence: 0.9, reviewFlags: [],
  };
}
function blockDay(partial: Partial<SchoolBlockDay> & { weekdayIndex: SchoolProfileWeekdayIndex | null }): SchoolBlockDay {
  return { dayId: `d-${partial.weekdayIndex}-${partial.date ?? ""}`, date: null, dayLabel: null, blockTitle: null, dayOperation: { op: "none" }, dayResolution: "enrich_only", contentItems: [], confidence: 0.9, evidence: null, reviewFlags: [], ...partial };
}
function block(days: SchoolBlockDay[], over: Partial<SchoolBlockProposal> = {}): SchoolBlockProposal {
  return { proposalId: "p1", kind: "school_block", schemaVersion: "1.0.0", sourceTitle: "Uke", originalSourceType: "text", confidence: 0.9, personId: "child-1", personMatchStatus: "matched", classCode: "2STC", days, structureStatus: "complete", reviewFlags: [], ...over };
}
/** Delt normalisert fag/kategori-rad med atskilt container-/faktum-identitet. */
function fact(o: {
  subjectKey: string; sectionKey: SchoolContentSectionKey; text: string; originalSourceText: string;
  containerId?: string; sourceFactId?: string; sourceField?: SchoolContentSourceField; coverage?: SchoolContentSourceCoverage;
  date?: string | null; weekdayIndex?: SchoolProfileWeekdayIndex | null; subject?: string | null; customLabel?: string | null;
}): NormalizedSchoolContentFact {
  return {
    sourceContainerId: o.containerId ?? `cid-${o.originalSourceText}`,
    sourceFactId: o.sourceFactId ?? `fid-${o.subjectKey}-${o.text}`,
    sourceField: o.sourceField ?? "details",
    sourceCoverage: o.coverage ?? "full",
    date: o.date ?? null, weekdayIndex: o.weekdayIndex ?? null, dayLabel: null,
    subjectKey: o.subjectKey, subject: o.subject ?? null, customLabel: o.customLabel ?? null,
    sectionKey: o.sectionKey, text: o.text, originalSourceText: o.originalSourceText,
    start: null, end: null, confidence: 0.8,
  };
}
function overlayTrack(resolvedTrack: string | null): SchoolWeekOverlayProposal {
  return { proposalId: "o1", kind: "school_week_overlay", schemaVersion: "1.0.0", confidence: 0.7, sourceTitle: "Uke", originalSourceType: "text", weekNumber: 25, classLabel: null, weeklySummary: [], languageTrack: { resolvedTrack, confidence: resolvedTrack ? 0.8 : 0.35, reason: "" }, profileMatch: { confidence: 0, reason: "" }, dailyActions: {} };
}
function profile(lessonsByDay: Partial<Record<SchoolProfileWeekdayIndex, Array<{ subjectKey: string; start: string; end: string }>>>): SchoolWeeklyProfile {
  const weekdays: SchoolWeeklyProfile["weekdays"] = {};
  for (const [k, ls] of Object.entries(lessonsByDay)) weekdays[k as SchoolProfileWeekdayIndex] = { useSimpleDay: false, lessons: ls!.map((l) => ({ subjectKey: l.subjectKey, customLabel: null, start: l.start, end: l.end })) };
  return { gradeBand: null, weekdays };
}
function ctx(wp: SchoolWeeklyProfile | null): PortalImportContext {
  return { knownPersons: [], ...(wp ? { relevanceContext: { schoolProfile: wp } } : {}) };
}
function build(b: SchoolBlockProposal | undefined, facts: NormalizedSchoolContentFact[], wp: SchoolWeeklyProfile | null, o: SchoolWeekOverlayProposal | undefined = undefined) {
  return buildCanonicalSchoolContentDraft({ schoolBlockProposal: b, languageTrack: o?.languageTrack, normalizedSchoolContentFacts: facts, resolvedPersonContext: ctx(wp), originalSourceType: "text", sourceTitle: "Uke" });
}
const subjKeys = (items: { subjectKey: string | null }[]) => items.map((i) => i.subjectKey).sort();
const allItems = (day: { subjectItems: unknown[]; audienceItems: unknown[]; generalDayMessages: unknown[] }) => [...(day.subjectItems as { sourceText: string | null }[]), ...(day.audienceItems as { sourceText: string | null }[]), ...(day.generalDayMessages as { sourceText: string | null }[])];

describe("gating", () => {
  it("uten schoolBlockProposal → null", () => expect(build(undefined, [], null)).toBeNull());
  it("tomt days → null", () => expect(build(block([]), [], null)).toBeNull());
});

describe("flere fag i én kildecontainer → flere items med hver sin synlige tekst", () => {
  const BLOB = "Norsk i timen: Les kapittel 2. Tysk i timen: Beskriv bildet.";
  it("to subjectItems; per-rad sourceText; hele bloben vises IKKE; ingen dagsnivå-kopi", () => {
    const wp = profile({ [MON]: [{ subjectKey: "norsk", start: "08:00", end: "09:00" }, { subjectKey: "tysk", start: "09:00", end: "10:00" }] });
    const day = build(
      block([blockDay({ weekdayIndex: MON, date: "2026-03-16", contentItems: [commonItem(BLOB)] })]),
      [
        fact({ subjectKey: "norsk", sectionKey: "iTimen", text: "Les kapittel 2.", originalSourceText: BLOB, containerId: "c1", sourceFactId: "f-norsk", date: "2026-03-16", weekdayIndex: MON }),
        fact({ subjectKey: "tysk", sectionKey: "iTimen", text: "Beskriv bildet.", originalSourceText: BLOB, containerId: "c1", sourceFactId: "f-tysk", date: "2026-03-16", weekdayIndex: MON }),
      ],
      wp,
    )!.days[0]!;
    expect(subjKeys(day.subjectItems)).toEqual(["norsk", "tysk"]);
    expect(day.subjectItems.find((i) => i.subjectKey === "norsk")!.sourceText).toBe("Les kapittel 2.");
    expect(day.subjectItems.find((i) => i.subjectKey === "tysk")!.sourceText).toBe("Beskriv bildet.");
    expect(allItems(day).some((i) => i.sourceText === BLOB)).toBe(false); // ikke hele bloben under hvert fag
    expect(day.generalDayMessages).toHaveLength(0); // full container → block-common superseded
  });
});

describe("flere rader for samme fag → flere items (ingen kollaps)", () => {
  const BLOB = "Norsk i timen: Les kapittel 2. Norsk i timen: Skriv sammendrag.";
  it("to forskjellige norsk-items", () => {
    const wp = profile({ [MON]: [{ subjectKey: "norsk", start: "08:00", end: "09:00" }] });
    const day = build(
      block([blockDay({ weekdayIndex: MON, date: "2026-03-16", contentItems: [commonItem(BLOB)] })]),
      [
        fact({ subjectKey: "norsk", sectionKey: "iTimen", text: "Les kapittel 2.", originalSourceText: BLOB, containerId: "c1", sourceFactId: "f-1", date: "2026-03-16", weekdayIndex: MON }),
        fact({ subjectKey: "norsk", sectionKey: "iTimen", text: "Skriv sammendrag.", originalSourceText: BLOB, containerId: "c1", sourceFactId: "f-2", date: "2026-03-16", weekdayIndex: MON }),
      ],
      wp,
    )!.days[0]!;
    expect(day.subjectItems).toHaveLength(2);
    expect(day.subjectItems.map((i) => i.sourceText).sort()).toEqual(["Les kapittel 2.", "Skriv sammendrag."]);
  });
});

describe("delvis container → ingen bred supersede, generell info bevart", () => {
  const BLOB = "Husk oppladet PC. Norsk i timen: Les kapittel 2.";
  it("partial → ingen subjectItems; hele containeren beholdes på dagsnivå", () => {
    const wp = profile({ [MON]: [{ subjectKey: "norsk", start: "08:00", end: "09:00" }] });
    const day = build(
      block([blockDay({ weekdayIndex: MON, date: "2026-03-16", contentItems: [commonItem(BLOB)] })]),
      [fact({ subjectKey: "norsk", sectionKey: "iTimen", text: "Les kapittel 2.", originalSourceText: BLOB, coverage: "partial", date: "2026-03-16", weekdayIndex: MON })],
      wp,
    )!.days[0]!;
    expect(day.subjectItems).toEqual([]); // partial → ikke fagplassert
    expect(day.generalDayMessages.some((i) => i.sourceText === BLOB)).toBe(true); // preamble/general info ikke tapt
  });
});

describe("§8 kategori-prioritet: samme faktum i flere seksjoner → mest spesifikke", () => {
  it("message + lesson → lesson (ett item)", () => {
    const src = "Norsk: Les kapittel 2.";
    const day = build(
      block([blockDay({ weekdayIndex: MON, date: "2026-03-02", contentItems: [commonItem(src)] })]),
      [
        fact({ subjectKey: "norsk", sectionKey: "ekstraBeskjed", text: "Les kapittel 2.", originalSourceText: src, sourceFactId: "f", date: "2026-03-02", weekdayIndex: MON }),
        fact({ subjectKey: "norsk", sectionKey: "iTimen", text: "Les kapittel 2.", originalSourceText: src, sourceFactId: "f", date: "2026-03-02", weekdayIndex: MON }),
      ],
      profile({ [MON]: [{ subjectKey: "norsk", start: "08:00", end: "09:00" }] }),
    )!.days[0]!;
    expect(day.subjectItems).toHaveLength(1);
    expect(day.subjectItems[0]!.contentType).toBe("lesson");
  });

  it("message + assessment → assessment (ett item)", () => {
    const src = "Engelsk: Heldagsprøve.";
    const day = build(
      block([blockDay({ weekdayIndex: FRI, date: "2026-03-06", contentItems: [commonItem(src)] })]),
      [
        fact({ subjectKey: "engelsk", sectionKey: "ekstraBeskjed", text: "Heldagsprøve.", originalSourceText: src, sourceFactId: "e", date: "2026-03-06", weekdayIndex: FRI }),
        fact({ subjectKey: "engelsk", sectionKey: "proveVurdering", text: "Heldagsprøve.", originalSourceText: src, sourceFactId: "e", date: "2026-03-06", weekdayIndex: FRI }),
      ],
      null,
    )!.days[0]!;
    expect(day.subjectItems).toHaveLength(1);
    expect(day.subjectItems[0]!.contentType).toBe("assessment");
  });

  it("bare «Fag: body» (ekstraBeskjed) → message", () => {
    const src = "Matematikk: Ta med kalkulator.";
    const day = build(
      block([blockDay({ weekdayIndex: MON, date: "2026-03-02", contentItems: [commonItem(src)] })]),
      [fact({ subjectKey: "matematikk", sectionKey: "ekstraBeskjed", text: "Ta med kalkulator.", originalSourceText: src, date: "2026-03-02", weekdayIndex: MON })],
      null,
    )!.days[0]!;
    expect(day.subjectItems[0]!).toMatchObject({ subjectKey: "matematikk", contentType: "message" });
  });
});

describe("dag-identitet (aldri overlay dailyActions)", () => {
  it("fact med dato → riktig schoolBlock-dag; ingen lekkasje til feil dag", () => {
    const bp = block([
      blockDay({ weekdayIndex: MON, date: "2026-03-02", contentItems: [commonItem("Matte: A")] }),
      blockDay({ weekdayIndex: TUE, date: "2026-03-03", contentItems: [commonItem("Matte: B")] }),
    ]);
    const d = build(bp, [fact({ subjectKey: "matematikk", sectionKey: "iTimen", text: "B", originalSourceText: "Matte: B", date: "2026-03-03", weekdayIndex: TUE })], null)!;
    expect(d.days.find((x) => x.date === "2026-03-02")!.subjectItems).toEqual([]);
    expect(d.days.find((x) => x.date === "2026-03-03")!.subjectItems[0]!).toMatchObject({ subjectKey: "matematikk" });
  });

  it("fact uten matchende dag → forblir dagsnivå (block-common beholdes)", () => {
    const day = build(
      block([blockDay({ weekdayIndex: MON, date: "2026-03-02", contentItems: [commonItem("Matte: Y")] })]),
      [fact({ subjectKey: "matematikk", sectionKey: "iTimen", text: "Y", originalSourceText: "Matte: Y", date: "2026-04-01", weekdayIndex: FRI })],
      null,
    )!.days[0]!;
    expect(day.subjectItems).toEqual([]);
    expect(day.generalDayMessages.map((i) => i.sourceText)).toEqual(["Matte: Y"]);
  });
});

describe("dagsoperasjon bevart under fagplassering", () => {
  it("replace_day + assessment på riktig fag", () => {
    const replaceDay: SchoolBlockDayOperation = { op: "replace_day", activityKind: "exam_day", effectiveStart: "09:00", effectiveEnd: "12:00", reason: null, confidence: 0.9 };
    const src = "Engelsk prøve: Kapittel 4.";
    const day = build(
      block([blockDay({ weekdayIndex: FRI, date: "2026-03-06", dayOperation: replaceDay, dayResolution: "full_replace", contentItems: [commonItem(src)] })]),
      [fact({ subjectKey: "engelsk", sectionKey: "proveVurdering", text: "Kapittel 4.", originalSourceText: src, date: "2026-03-06", weekdayIndex: FRI })],
      null,
    )!.days[0]!;
    expect(day.dayOperation).toMatchObject({ op: "replace_day", activityKind: "exam_day", effectiveStart: "09:00", effectiveEnd: "12:00" });
    expect(day.subjectItems[0]!).toMatchObject({ subjectKey: "engelsk", contentType: "assessment" });
  });
});

describe("child-audience-filtrering (§10 — bevart)", () => {
  it("resolvedChildAudience → bare barnets entry; false-entries og common-duplikat fjernes", () => {
    const resolved = { audienceEntryId: "ae-2STC", start: "10:30", end: "11:00", room: "332", teacher: "Lærer C" };
    const item = audienceItem("Pulje", [entry(["2STC"], true, "2STC"), entry(["2STA"], false, "2STA")], resolved);
    const day = build(block([blockDay({ weekdayIndex: MON, date: "2026-03-02", contentItems: [item] })]), [], null)!.days[0]!;
    expect(day.audienceItems).toHaveLength(1);
    expect(day.audienceItems[0]!.audienceEntries).toHaveLength(1);
    expect(day.audienceItems[0]!.audienceEntries[0]!).toMatchObject({ classCodes: ["2STC"], isChildAudience: true, start: "10:30", room: "332" });
  });

  it("kun false-audience → item utelates", () => {
    const day = build(block([blockDay({ weekdayIndex: MON, date: "2026-03-02", contentItems: [audienceItem("Andres opplegg", [entry(["10B"], false)])] })]), [], null)!.days[0]!;
    expect(day.audienceItems).toEqual([]);
    expect(day.generalDayMessages).toEqual([]);
  });

  it("kun null-audience → uoppløst + child_class_unresolved", () => {
    const day = build(block([blockDay({ weekdayIndex: MON, date: "2026-03-02", contentItems: [audienceItem("Ukjent", [entry(["2STC"], null)])] })]), [], null)!.days[0]!;
    expect(day.audienceItems).toHaveLength(1);
    expect(day.audienceItems[0]!.reviewFlags.some((f) => f.code === "child_class_unresolved")).toBe(true);
  });

  it("eksplisitt true beholdes, false fjernes", () => {
    const day = build(block([blockDay({ weekdayIndex: MON, date: "2026-03-02", contentItems: [audienceItem("Delt", [entry(["2STC"], true, "c"), entry(["10B"], false, "o")])] })]), [], null)!.days[0]!;
    expect(day.audienceItems[0]!.audienceEntries.map((a) => a.classCodes.join())).toEqual(["2STC"]);
  });
});

describe("eksplisitt languageTrack-kontrakt (uten overlay-proposal)", () => {
  const day = (items: ReturnType<typeof commonItem>[]) =>
    block([blockDay({ weekdayIndex: FRI, date: "2026-03-06", contentItems: items })]);
  const spanskFact = () => [fact({ subjectKey: "spansk", sectionKey: "iTimen", text: "Gloser", originalSourceText: "Spansk: Gloser", date: "2026-03-06", weekdayIndex: FRI })];
  const draftWith = (lt: SchoolWeekOverlayProposal["languageTrack"] | undefined) =>
    buildCanonicalSchoolContentDraft({ schoolBlockProposal: day([commonItem("Spansk: Gloser")]), languageTrack: lt, normalizedSchoolContentFacts: spanskFact(), resolvedPersonContext: ctx(null), originalSourceType: "text", sourceTitle: "Uke" });

  it("single track (eksplisitt objekt): spansk berikes, fransk-fakta ville droppes — som overlay-input ga", () => {
    const d = buildCanonicalSchoolContentDraft({
      schoolBlockProposal: day([commonItem("Spansk: Gloser"), commonItem("Fransk: Gloser")]),
      languageTrack: { resolvedTrack: "spansk", confidence: 0.8, reason: "single_track_detected" },
      normalizedSchoolContentFacts: [
        ...spanskFact(),
        fact({ subjectKey: "fransk", sectionKey: "iTimen", text: "Gloser", originalSourceText: "Fransk: Gloser", date: "2026-03-06", weekdayIndex: FRI }),
      ],
      resolvedPersonContext: ctx(null), originalSourceType: "text", sourceTitle: "Uke",
    })!.days[0]!;
    expect(subjKeys(d.subjectItems)).toEqual(["spansk"]);
    expect(allItems(d).some((i) => i.sourceText === "Fransk: Gloser")).toBe(false);
  });

  it("multiple tracks (resolvedTrack null, 0.45): identisk med null-track — uklart spor → review-dagsnivå", () => {
    const multi = draftWith({ resolvedTrack: null, confidence: 0.45, reason: "multiple_tracks_detected" })!.days[0]!;
    expect(multi.subjectItems).toEqual([]);
    expect(multi.generalDayMessages.some((i) => i.sourceText === "Spansk: Gloser")).toBe(true);
  });

  it("no track: languageTrack undefined og {resolvedTrack: null} gir IDENTISK draft (låst ekvivalens)", () => {
    const withUndefined = draftWith(undefined);
    const withNullObj = draftWith({ resolvedTrack: null, confidence: 0.35, reason: "no_track_detected" });
    expect(withUndefined).toEqual(withNullObj); // adapteren leser kun resolvedTrack
    expect(withUndefined!.days[0]!.subjectItems).toEqual([]);
  });
});

describe("språkspor-policy (§9/§10)", () => {
  it("profil har tysk → tysk berikes, spansk utelates helt (ikke dagsmelding)", () => {
    const wp = profile({ [FRI]: [{ subjectKey: "tysk", start: "09:00", end: "10:00" }] });
    const day = build(
      block([blockDay({ weekdayIndex: FRI, date: "2026-03-06", contentItems: [commonItem("Tysk: Gloser"), commonItem("Spansk: Gloser")] })]),
      [
        fact({ subjectKey: "tysk", sectionKey: "iTimen", text: "Gloser", originalSourceText: "Tysk: Gloser", date: "2026-03-06", weekdayIndex: FRI }),
        fact({ subjectKey: "spansk", sectionKey: "iTimen", text: "Gloser", originalSourceText: "Spansk: Gloser", date: "2026-03-06", weekdayIndex: FRI }),
      ],
      wp,
    )!.days[0]!;
    expect(subjKeys(day.subjectItems)).toEqual(["tysk"]);
    expect(allItems(day).some((i) => i.sourceText === "Spansk: Gloser")).toBe(false);
  });

  it("ingen profil, overlay resolvedTrack=spansk → spansk berikes, fransk utelates", () => {
    const day = build(
      block([blockDay({ weekdayIndex: FRI, date: "2026-03-06", contentItems: [commonItem("Spansk: Gloser"), commonItem("Fransk: Gloser")] })]),
      [
        fact({ subjectKey: "spansk", sectionKey: "iTimen", text: "Gloser", originalSourceText: "Spansk: Gloser", date: "2026-03-06", weekdayIndex: FRI }),
        fact({ subjectKey: "fransk", sectionKey: "iTimen", text: "Gloser", originalSourceText: "Fransk: Gloser", date: "2026-03-06", weekdayIndex: FRI }),
      ],
      null,
      overlayTrack("spansk"),
    )!.days[0]!;
    expect(subjKeys(day.subjectItems)).toEqual(["spansk"]);
    expect(allItems(day).some((i) => i.sourceText === "Fransk: Gloser")).toBe(false);
  });

  it("uklart språkspor (ingen profil, resolvedTrack=null) → ikke gjett; behold dagsnivå MED review-flagg", () => {
    const src = "Spansk: Gloser";
    const day = build(
      block([blockDay({ weekdayIndex: FRI, date: "2026-03-06", contentItems: [commonItem(src)] })]),
      [fact({ subjectKey: "spansk", sectionKey: "iTimen", text: "Gloser", originalSourceText: src, date: "2026-03-06", weekdayIndex: FRI })],
      null,
      overlayTrack(null),
    )!.days[0]!;
    expect(day.subjectItems).toEqual([]);
    const dayMsg = day.generalDayMessages.find((i) => i.sourceText === src)!;
    expect(dayMsg).toBeTruthy();
    expect(dayMsg.reviewFlags.length).toBeGreaterThan(0);
  });
});

describe("synlig tekst + evidens + determinisme + immutability", () => {
  it("canonical item bruker fact.text som sourceText og bevarer original som evidence", () => {
    const src = "Norsk i timen: Les kapittel 2.";
    const item = build(
      block([blockDay({ weekdayIndex: MON, date: "2026-03-02", contentItems: [commonItem(src)] })]),
      [fact({ subjectKey: "norsk", sectionKey: "iTimen", text: "Les kapittel 2.", originalSourceText: src, date: "2026-03-02", weekdayIndex: MON })],
      profile({ [MON]: [{ subjectKey: "norsk", start: "08:00", end: "09:00" }] }),
    )!.days[0]!.subjectItems[0]!;
    expect(item.sourceText).toBe("Les kapittel 2."); // synlig fact-tekst
    expect(item.evidence).toBe(src); // original kilde-evidens bevart
  });

  it("common uten matchende fact → dagsmelding, ingen falsk fagplassering", () => {
    const day = build(block([blockDay({ weekdayIndex: MON, date: "2026-03-02", contentItems: [commonItem("Husk gymtøy")] })]), [], null)!.days[0]!;
    expect(day.subjectItems).toEqual([]);
    expect(day.generalDayMessages[0]!).toMatchObject({ subjectKey: null, contentType: "message" });
  });

  it("fact-rekkefølge påvirker ikke output; stabile ID-er", () => {
    const wp = profile({ [FRI]: [{ subjectKey: "norsk", start: "08:00", end: "09:00" }, { subjectKey: "tysk", start: "09:00", end: "10:00" }] });
    const BLOB = "Norsk i timen: N. Tysk i timen: T.";
    const bp = () => block([blockDay({ weekdayIndex: FRI, date: "2026-03-06", contentItems: [commonItem(BLOB)] })]);
    const facts = () => [
      fact({ subjectKey: "norsk", sectionKey: "iTimen", text: "N.", originalSourceText: BLOB, containerId: "c", sourceFactId: "fn", date: "2026-03-06", weekdayIndex: FRI }),
      fact({ subjectKey: "tysk", sectionKey: "iTimen", text: "T.", originalSourceText: BLOB, containerId: "c", sourceFactId: "ft", date: "2026-03-06", weekdayIndex: FRI }),
    ];
    expect(build(bp(), facts(), wp)).toEqual(build(bp(), [...facts()].reverse(), wp));
  });

  it("muterer ikke schoolBlockProposal, overlay eller facts", () => {
    const wp = profile({ [MON]: [{ subjectKey: "matematikk", start: "08:00", end: "09:00" }] });
    const bp = block([blockDay({ weekdayIndex: MON, date: "2026-03-02", contentItems: [commonItem("Matte: X"), audienceItem("P", [entry(["2STC"], true)], { audienceEntryId: "ae-2STC", start: "10:00", end: "11:00", room: "A1", teacher: null })] })]);
    const o = overlayTrack(null);
    const facts = [fact({ subjectKey: "matematikk", sectionKey: "iTimen", text: "X", originalSourceText: "Matte: X", date: "2026-03-02", weekdayIndex: MON })];
    const bpSnap = JSON.stringify(bp), oSnap = JSON.stringify(o), fSnap = JSON.stringify(facts);
    buildCanonicalSchoolContentDraft({ schoolBlockProposal: bp, languageTrack: o.languageTrack, normalizedSchoolContentFacts: facts, resolvedPersonContext: ctx(wp), originalSourceType: "text", sourceTitle: "Uke" });
    expect(JSON.stringify(bp)).toBe(bpSnap);
    expect(JSON.stringify(o)).toBe(oSnap);
    expect(JSON.stringify(facts)).toBe(fSnap);
  });
});
