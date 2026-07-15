import { describe, expect, it } from "vitest";
import {
  buildSchoolBlockProposal,
  type BuildSchoolBlockProposalMeta,
} from "@/lib/school-block-proposal";
import {
  makeChildren,
  makeMinimalAnalysisResult,
  makeSchoolBlockWeekResult,
} from "@/lib/fixtures/school-block-week.fixture";
import type { PortalImportContext } from "@/lib/portal-import-person";
import type {
  AIAnalysisResult,
  ClassScheduleEntry,
  DayScheduleEntry,
} from "@/lib/types";

const META: BuildSchoolBlockProposalMeta = {
  proposalId: "prop-123",
  originalSourceType: "image",
};

const EMPTY_CTX: PortalImportContext = { knownPersons: [] };

function build(
  result: AIAnalysisResult,
  ctx: PortalImportContext = EMPTY_CTX,
  meta: BuildSchoolBlockProposalMeta = META,
) {
  return buildSchoolBlockProposal(result, ctx, meta);
}

/** Én fullt typet DayScheduleEntry-rad. */
function dayRow(date: string | null, dayLabel: string | null, details: string | null = "x"): DayScheduleEntry {
  return { dayLabel, date, time: null, details, highlights: [], rememberItems: [], deadlines: [], notes: [] };
}

/** Ett fullt typet AIAnalysisResult med én scheduleByDay-rad. */
function oneDayResult(date: string | null, dayLabel: string | null): AIAnalysisResult {
  return makeMinimalAnalysisResult({ scheduleByDay: [dayRow(date, dayLabel)] });
}

/** Én fullt typet ClassScheduleEntry med sensible defaults. */
function classEntry(partial: Partial<ClassScheduleEntry>): ClassScheduleEntry {
  return {
    date: null, dayLabel: null, activityTitle: null, classCodes: [], groupLabel: null,
    start: null, end: null, room: null, teacher: null, sourceText: null, confidence: 0.9,
    ...partial,
  };
}

/** AIAnalysisResult med gitte classScheduleEntries (+ valgfrie overrides). */
function entriesResult(
  entries: ClassScheduleEntry[],
  overrides: Partial<AIAnalysisResult> = {},
): AIAnalysisResult {
  return makeMinimalAnalysisResult({ classScheduleEntries: entries, ...overrides });
}

describe("buildSchoolBlockProposal — metadata", () => {
  it("beholder proposalId eksakt (validering trimmer kun for blank-sjekk)", () => {
    const proposalId = "  prop-EXACT  ";
    const p = build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, proposalId });
    // Ytre whitespace bevares: caller-strengen returneres uendret.
    expect(p.proposalId).toBe("  prop-EXACT  ");
  });

  it("blank / whitespace proposalId kaster TypeError", () => {
    expect(() => build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, proposalId: "" })).toThrow(TypeError);
    expect(() => build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, proposalId: "   " })).toThrow(TypeError);
  });

  it("blank / whitespace originalSourceType kaster TypeError", () => {
    expect(() => build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, originalSourceType: "" })).toThrow(TypeError);
    expect(() => build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, originalSourceType: "  " })).toThrow(TypeError);
  });

  it("originalSourceType trimmes i output", () => {
    const p = build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, originalSourceType: "  pdf  " });
    expect(p.originalSourceType).toBe("pdf");
  });

  it("sourceTitle følger prioritetsregelen", () => {
    expect(build(makeMinimalAnalysisResult({ title: "Res tittel" }), EMPTY_CTX, { ...META, sourceTitle: "  Meta tittel " }).sourceTitle).toBe("Meta tittel");
    expect(build(makeMinimalAnalysisResult({ title: "Res tittel" }), EMPTY_CTX, { ...META, sourceTitle: "   " }).sourceTitle).toBe("Res tittel");
    expect(build(makeMinimalAnalysisResult({ title: "   " }), EMPTY_CTX, { ...META, sourceTitle: undefined }).sourceTitle).toBe("Skoleinformasjon");
  });

  it("eksplisitt weekNumber: null bevares", () => {
    const p = build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, weekNumber: null });
    expect("weekNumber" in p).toBe(true);
    expect(p.weekNumber).toBeNull();
  });

  it("utelatt weekNumber gir ikke feltet i output", () => {
    const p = build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META });
    expect("weekNumber" in p).toBe(false);
  });

  it("konstante toppnivåfelt", () => {
    const p = build(makeMinimalAnalysisResult({ confidence: 0.42 }));
    expect(p.kind).toBe("school_block");
    expect(p.schemaVersion).toBe("1.0.0");
    expect(p.confidence).toBe(0.42);
    expect(p.structureStatus).toBe("complete");
    expect(p.reviewFlags).toEqual([]);
    expect("languageTrack" in p).toBe(false);
  });
});

describe("buildSchoolBlockProposal — person-/klasseoppløsning", () => {
  it("matched child → personId, classCode, 'matched'", () => {
    const ctx: PortalImportContext = { knownPersons: [], children: makeChildren() };
    const p = build(makeSchoolBlockWeekResult(), ctx);
    expect(p.personMatchStatus).toBe("matched");
    expect(p.personId).toBe("child-2stc");
    expect(p.classCode).toBe("2STC");
  });

  it("ambiguous → null, null, 'child_unresolved'", () => {
    const result = makeMinimalAnalysisResult({ targetGroup: "2STC og 10B" });
    const ctx: PortalImportContext = { knownPersons: [], children: makeChildren() };
    const p = build(result, ctx);
    expect(p.personMatchStatus).toBe("child_unresolved");
    expect(p.personId).toBeNull();
    expect(p.classCode).toBeNull();
    expect(p.structureStatus).toBe("complete"); // ambiguous alene → fortsatt complete
  });

  it("no_signal → null, null, 'child_unresolved'", () => {
    const result = makeMinimalAnalysisResult({ targetGroup: null, title: "", description: "" });
    const ctx: PortalImportContext = { knownPersons: [], children: makeChildren() };
    const p = build(result, ctx);
    expect(p.personMatchStatus).toBe("child_unresolved");
    expect(p.personId).toBeNull();
    expect(p.classCode).toBeNull();
    expect(p.structureStatus).toBe("complete"); // no_signal alene → fortsatt complete
  });

  it("legacy relevanceContext → null, classCode, 'not_specified'", () => {
    const ctx: PortalImportContext = { knownPersons: [], relevanceContext: { classCode: "  2STC " } };
    const p = build(makeMinimalAnalysisResult(), ctx);
    expect(p.personMatchStatus).toBe("not_specified");
    expect(p.personId).toBeNull();
    expect(p.classCode).toBe("2STC");
  });

  it("ingen kontekst → null, null, 'not_specified'", () => {
    const p = build(makeMinimalAnalysisResult(), EMPTY_CTX);
    expect(p.personMatchStatus).toBe("not_specified");
    expect(p.personId).toBeNull();
    expect(p.classCode).toBeNull();
  });
});

describe("buildSchoolBlockProposal — dagfrø, sammenslåing og dato", () => {
  it("norsk skrevet dato og ISO-dato slås sammen til én dag", () => {
    const p = build(makeSchoolBlockWeekResult());
    const monday = p.days.filter((d) => d.date === "2026-06-15");
    expect(monday).toHaveLength(1);
    expect(monday[0]!.weekdayIndex).toBe("0");
    expect(monday[0]!.dayLabel).toBe("Mandag");
  });

  it("dato normaliseres til ISO og bestemmer weekdayIndex + kanonisk label", () => {
    const p = build(makeSchoolBlockWeekResult());
    const wed = p.days.find((d) => d.date === "2026-06-17");
    expect(wed?.weekdayIndex).toBe("2");
    expect(wed?.dayLabel).toBe("Onsdag");
  });

  it("samme dato gir samme dayId uansett label/casing/feil ukedagsord", () => {
    const a = build(makeMinimalAnalysisResult({ scheduleByDay: [{ dayLabel: "Mandag", date: "2026-06-15", time: null, details: null, highlights: [], rememberItems: [], deadlines: [], notes: [] }] }));
    const b = build(makeMinimalAnalysisResult({ scheduleByDay: [{ dayLabel: "FREDAG", date: "mandag 15. juni 2026", time: null, details: null, highlights: [], rememberItems: [], deadlines: [], notes: [] }] }));
    expect(a.days[0]!.dayId).toBe(b.days[0]!.dayId);
    expect(a.days[0]!.dayLabel).toBe("Mandag");
    expect(b.days[0]!.dayLabel).toBe("Mandag"); // dato er kilde til ukedag, ikke det feil «FREDAG»-ordet
  });

  it("samme dato med og uten label → samme dayId, weekdayIndex '0', kanonisk 'Mandag'", () => {
    const a = build(oneDayResult("2026-06-15", "Mandag"));
    const b = build(oneDayResult("2026-06-15", null));
    expect(a.days[0]!.dayId).toBe(b.days[0]!.dayId);
    expect(a.days[0]!.weekdayIndex).toBe("0");
    expect(b.days[0]!.weekdayIndex).toBe("0");
    expect(a.days[0]!.dayLabel).toBe("Mandag");
    expect(b.days[0]!.dayLabel).toBe("Mandag"); // dato bestemmer kanonisk label
  });

  it("dato-identitet ≠ weekday-only-identitet (samme weekdayIndex, ulik dayId)", () => {
    const dated = build(oneDayResult("2026-06-15", "Mandag"));
    const weekdayOnly = build(oneDayResult(null, "Mandag"));
    expect(dated.days[0]!.weekdayIndex).toBe("0");
    expect(weekdayOnly.days[0]!.weekdayIndex).toBe("0");
    // Ulike ID-er: weekday-only slås ikke sammen med en bestemt uke.
    expect(dated.days[0]!.dayId).not.toBe(weekdayOnly.days[0]!.dayId);
    expect(dated.days[0]!.date).toBe("2026-06-15"); // date:2026-06-15
    expect(weekdayOnly.days[0]!.date).toBeNull(); // weekday:0
  });

  it("weekday-only norske og engelske varianter gir samme dayId", () => {
    const nb = build(makeMinimalAnalysisResult({ scheduleByDay: [{ dayLabel: "tirsdag", date: null, time: null, details: "x", highlights: [], rememberItems: [], deadlines: [], notes: [] }] }));
    const en = build(makeMinimalAnalysisResult({ scheduleByDay: [{ dayLabel: "tuesday", date: null, time: null, details: "x", highlights: [], rememberItems: [], deadlines: [], notes: [] }] }));
    expect(nb.days).toHaveLength(1);
    expect(nb.days[0]!.dayId).toBe(en.days[0]!.dayId);
    expect(nb.days[0]!.weekdayIndex).toBe("1");
  });

  it("weekday-only og datofestet dag slås ikke sammen", () => {
    const p = build(makeMinimalAnalysisResult({ scheduleByDay: [
      { dayLabel: "mandag", date: "2026-06-15", time: null, details: null, highlights: [], rememberItems: [], deadlines: [], notes: [] },
      { dayLabel: "mandag", date: null, time: null, details: "x", highlights: [], rememberItems: [], deadlines: [], notes: [] },
    ] }));
    expect(p.days).toHaveLength(2);
    expect(p.days.some((d) => d.date === "2026-06-15")).toBe(true);
    expect(p.days.some((d) => d.date === null && d.weekdayIndex === "0")).toBe(true);
  });

  it("usikker rad uten dato eller gjenkjennelig ukedag droppes", () => {
    const p = build(makeMinimalAnalysisResult({ scheduleByDay: [
      { dayLabel: "Generell info", date: null, time: null, details: "tekst", highlights: [], rememberItems: [], deadlines: [], notes: [] },
    ] }));
    expect(p.days).toEqual([]);
  });

  it("full uke: fem dager, riktig antall (drop-rad utelatt)", () => {
    const p = build(makeSchoolBlockWeekResult());
    // man(15) + ons(17) + tor(18, fra classScheduleEntries) + fre(19) + tir(weekday-only)
    expect(p.days).toHaveLength(5);
  });
});

describe("buildSchoolBlockProposal — sortering og determinisme", () => {
  it("dagene sorteres deterministisk (datofestede stigende, så udaterte)", () => {
    const p = build(makeSchoolBlockWeekResult());
    const dated = p.days.filter((d) => d.date !== null).map((d) => d.date);
    expect(dated).toEqual(["2026-06-15", "2026-06-17", "2026-06-18", "2026-06-19"]);
    expect(p.days[p.days.length - 1]!.date).toBeNull(); // udatert tirsdag sist
  });

  it("ulik inputrekkefølge gir identisk days", () => {
    const base = makeSchoolBlockWeekResult();
    const reordered = makeSchoolBlockWeekResult();
    reordered.scheduleByDay.reverse();
    reordered.classScheduleEntries!.reverse();
    expect(build(reordered).days).toEqual(build(base).days);
  });

  it("gjentatte kall gir identisk output", () => {
    const ctx: PortalImportContext = { knownPersons: [], children: makeChildren() };
    expect(build(makeSchoolBlockWeekResult(), ctx)).toEqual(build(makeSchoolBlockWeekResult(), ctx));
  });

  it("ingen dayId inneholder tilfeldige/array-baserte komponenter (kun djb2-hex-hale)", () => {
    const p = build(makeSchoolBlockWeekResult());
    for (const d of p.days) {
      expect(d.dayId).toMatch(/^school-day-h[0-9a-f]{8}$/);
    }
  });
});

describe("buildSchoolBlockProposal — per_audience content items", () => {
  const MON = { date: "2026-06-15", dayLabel: "mandag" };

  function firstItem(r: AIAnalysisResult, ctx: PortalImportContext = EMPTY_CTX) {
    const p = build(r, ctx);
    const day = p.days.find((d) => d.contentItems.length > 0)!;
    return { p, day, item: day.contentItems[0]! };
  }

  it("classScheduleEntry gir ett message/enrich per_audience-item med commonSchedule null", () => {
    const { item } = firstItem(entriesResult([classEntry({ ...MON, activityTitle: "Bokinnlevering", classCodes: ["2STC"], start: "10:30", end: "11:00", sourceText: "2STC: 10.30-11.00" })]));
    expect(item.contentType).toBe("message");
    expect(item.action).toBe("enrich");
    expect(item.audienceScope).toBe("per_audience");
    expect(item.commonSchedule).toBeNull();
    expect(item.activityKind).toBeNull();
    expect(item.title).toBe("Bokinnlevering");
    expect(item.audienceEntries).toHaveLength(1);
    expect(item.sections).toEqual({ descriptionLines: ["2STC: 10.30-11.00"] });
    expect(item.sourceText).toBe("2STC: 10.30-11.00");
  });

  it("flere classCodes i ÉN audience entry; visningscasing bevart, deduplisert, sortert", () => {
    // casing-/whitespace-varianter for 2STA og 2STC + duplikat; uppercase-visning vinner (lex-min).
    const { item } = firstItem(entriesResult([classEntry({ ...MON, classCodes: ["2STE", " 2STA ", "2stc", "2STC", "2STA"], groupLabel: "Pulje 1", start: "10:00", end: "11:00" })]));
    expect(item.audienceEntries).toHaveLength(1);
    expect(item.audienceEntries[0]!.classCodes).toEqual(["2STA", "2STC", "2STE"]);
    expect(item.audienceEntries[0]!.pulje).toBe("Pulje 1");
  });

  it("tid normaliseres med skole-time-helper; punktumformat → HH:MM", () => {
    const { item } = firstItem(entriesResult([classEntry({ ...MON, classCodes: ["2STC"], start: "9.5", end: "10.30" })]));
    // "9.5" er ugyldig (ikke HH:MM/bare time) → null; "10.30" → "10:30"
    expect(item.audienceEntries[0]!.start).toBeNull();
    expect(item.audienceEntries[0]!.end).toBe("10:30");
  });

  it("whitespace i title/group/room/teacher/sourceText normaliseres (collapse, casing bevart)", () => {
    const { item } = firstItem(entriesResult([classEntry({ ...MON, activityTitle: "  Bok   innlevering ", classCodes: ["2STC"], groupLabel: " Pulje   1 ", room: "  332-50 ", teacher: "  Lærer   C ", sourceText: "  2STC:   10.30-11.00 " })]));
    expect(item.title).toBe("Bok innlevering");
    const a = item.audienceEntries[0]!;
    expect(a.pulje).toBe("Pulje 1");
    expect(a.room).toBe("332-50");
    expect(a.teacher).toBe("Lærer C");
    expect(item.sourceText).toBe("2STC: 10.30-11.00");
  });

  it("title-prioritet: activityTitle → groupLabel → 'Klasseinformasjon'", () => {
    expect(firstItem(entriesResult([classEntry({ ...MON, activityTitle: "Bok", classCodes: ["2STC"], groupLabel: "Pulje 1" })])).item.title).toBe("Bok");
    expect(firstItem(entriesResult([classEntry({ ...MON, classCodes: ["2STC"], groupLabel: "Pulje 1" })])).item.title).toBe("Pulje 1");
    expect(firstItem(entriesResult([classEntry({ ...MON, classCodes: ["2STC"], start: "10:00" })])).item.title).toBe("Klasseinformasjon");
  });

  it("rad uten gyldig klassekode eller uten innholdsfelt droppes", () => {
    expect(build(entriesResult([classEntry({ ...MON, classCodes: [] , start: "10:00" })])).days.flatMap((d) => d.contentItems)).toEqual([]);
    expect(build(entriesResult([classEntry({ ...MON, classCodes: ["2STC"] })])).days.flatMap((d) => d.contentItems)).toEqual([]);
  });

  it("item festes til korrekt datodag; weekday-only festes til weekday-dag, ikke datodag", () => {
    const p = build(entriesResult([
      classEntry({ date: "2026-06-15", dayLabel: "mandag", classCodes: ["2STC"], start: "10:00" }),
      classEntry({ date: null, dayLabel: "tirsdag", classCodes: ["2STC"], start: "12:00" }),
    ]));
    const dated = p.days.find((d) => d.date === "2026-06-15")!;
    const weekdayOnly = p.days.find((d) => d.date === null && d.weekdayIndex === "1")!;
    expect(dated.contentItems).toHaveLength(1);
    expect(weekdayOnly.contentItems).toHaveLength(1);
    expect(dated.contentItems[0]!.itemId).not.toBe(weekdayOnly.contentItems[0]!.itemId);
  });
});

describe("buildSchoolBlockProposal — deterministiske item-/audience-ID", () => {
  const A = classEntry({ date: "2026-06-15", dayLabel: "mandag", classCodes: ["2STA", "2STC"], groupLabel: "Pulje 1", start: "10:00", end: "11:00", room: "Auditoriet", confidence: 0.9 });

  it("itemId/audienceEntryId deterministisk ved ulik classCode-rekkefølge", () => {
    const p1 = build(entriesResult([A]));
    const p2 = build(entriesResult([classEntry({ ...A, classCodes: ["2STC", "2STA"] })]));
    const i1 = p1.days[0]!.contentItems[0]!;
    const i2 = p2.days[0]!.contentItems[0]!;
    expect(i1.itemId).toBe(i2.itemId);
    expect(i1.audienceEntries[0]!.audienceEntryId).toBe(i2.audienceEntries[0]!.audienceEntryId);
  });

  it("confidence påvirker ikke itemId eller audienceEntryId", () => {
    const i1 = build(entriesResult([A])).days[0]!.contentItems[0]!;
    const i2 = build(entriesResult([classEntry({ ...A, confidence: 0.1 })])).days[0]!.contentItems[0]!;
    expect(i1.itemId).toBe(i2.itemId);
    expect(i1.audienceEntries[0]!.audienceEntryId).toBe(i2.audienceEntries[0]!.audienceEntryId);
  });

  it("semantisk duplikatrad dedupliseres til ett item (høyest confidence vinner)", () => {
    const p = build(entriesResult([
      classEntry({ ...A, confidence: 0.94 }),
      classEntry({ ...A, classCodes: ["2STC", "2STA"], groupLabel: " Pulje  1 ", confidence: 0.4 }),
    ]));
    const items = p.days[0]!.contentItems;
    expect(items).toHaveLength(1);
    expect(items[0]!.confidence).toBe(0.94);
  });

  it("ulike tider gir ulike itemId; ulike classCodes gir ulike itemId", () => {
    const base = build(entriesResult([A])).days[0]!.contentItems[0]!.itemId;
    const otherTime = build(entriesResult([classEntry({ ...A, start: "12:00" })])).days[0]!.contentItems[0]!.itemId;
    const otherCodes = build(entriesResult([classEntry({ ...A, classCodes: ["2STB"] })])).days[0]!.contentItems[0]!.itemId;
    expect(otherTime).not.toBe(base);
    expect(otherCodes).not.toBe(base);
  });

  it("id-format er school-item-h / school-audience-h + 8 hex", () => {
    const item = build(entriesResult([A])).days[0]!.contentItems[0]!;
    expect(item.itemId).toMatch(/^school-item-h[0-9a-f]{8}$/);
    expect(item.audienceEntries[0]!.audienceEntryId).toMatch(/^school-audience-h[0-9a-f]{8}$/);
  });

  it("item-sortering: kjent tid før null, deterministisk", () => {
    const p = build(entriesResult([
      classEntry({ date: "2026-06-15", dayLabel: "mandag", classCodes: ["2STC"], start: null, activityTitle: "Uten tid" }),
      classEntry({ date: "2026-06-15", dayLabel: "mandag", classCodes: ["2STC"], start: "12:00", activityTitle: "Sen" }),
      classEntry({ date: "2026-06-15", dayLabel: "mandag", classCodes: ["2STC"], start: "08:00", activityTitle: "Tidlig" }),
    ]));
    expect(p.days[0]!.contentItems.map((i) => i.title)).toEqual(["Tidlig", "Sen", "Uten tid"]);
  });
});

describe("buildSchoolBlockProposal — klassekode wire-visning vs. intern nøkkel", () => {
  const monRow = (codes: string[]) =>
    classEntry({ date: "2026-06-15", dayLabel: "mandag", classCodes: codes, start: "10:00" });
  const monItem = (codes: string[]) =>
    build(entriesResult([monRow(codes)])).days[0]!.contentItems[0]!;

  it("fixture: mandag viser ['2STC']; torsdag pulje viser ['2STA','2STC','2STE']", () => {
    const p = build(makeSchoolBlockWeekResult());
    const mon = p.days.find((d) => d.date === "2026-06-15")!;
    expect(mon.contentItems[0]!.audienceEntries[0]!.classCodes).toEqual(["2STC"]);
    const thu = p.days.find((d) => d.date === "2026-06-18")!;
    const pulje = thu.contentItems.find(
      (i) => i.audienceEntries[0]!.classCodes.length === 3,
    )!;
    expect(pulje.audienceEntries[0]!.classCodes).toEqual(["2STA", "2STC", "2STE"]);
  });

  it("casing/whitespace-varianter → identisk itemId og audienceEntryId (nøkkel er casing-uavhengig)", () => {
    const a = monItem(["2STC"]);
    const b = monItem(["2stc"]);
    const c = monItem([" 2STC "]);
    expect(b.itemId).toBe(a.itemId);
    expect(c.itemId).toBe(a.itemId);
    expect(b.audienceEntries[0]!.audienceEntryId).toBe(a.audienceEntries[0]!.audienceEntryId);
    expect(c.audienceEntries[0]!.audienceEntryId).toBe(a.audienceEntries[0]!.audienceEntryId);
  });

  it("casing-/whitespace-varianter dedupliseres til én visningsklassekode", () => {
    const item = monItem(["2stc", " 2STC ", "2STC"]);
    expect(item.audienceEntries[0]!.classCodes).toEqual(["2STC"]); // uppercase-variant vinner
  });

  it("isChildAudience korrekt uavhengig av casing (child class '2stc' matcher '2STC'-visning)", () => {
    const ctxLower: PortalImportContext = { knownPersons: [], relevanceContext: { classCode: "2stc" } };
    const item = build(entriesResult([monRow(["2STC"])]), ctxLower).days[0]!.contentItems[0]!;
    expect(item.audienceEntries[0]!.isChildAudience).toBe(true);
  });

  it("classCode-arrayrekkefølge påvirker ikke IDs; wire-rekkefølge deterministisk", () => {
    const i1 = monItem(["2STE", "2STA", "2STC"]);
    const i2 = monItem(["2STA", "2STC", "2STE"]);
    expect(i1.itemId).toBe(i2.itemId);
    expect(i1.audienceEntries[0]!.audienceEntryId).toBe(i2.audienceEntries[0]!.audienceEntryId);
    expect(i1.audienceEntries[0]!.classCodes).toEqual(["2STA", "2STC", "2STE"]);
    expect(i2.audienceEntries[0]!.classCodes).toEqual(["2STA", "2STC", "2STE"]);
  });
});

describe("buildSchoolBlockProposal — max-confidence dedup (eksplisitt)", () => {
  const dup = (conf: number) =>
    classEntry({ date: "2026-06-15", dayLabel: "mandag", classCodes: ["2STC"], start: "10:00", end: "11:00", sourceText: "2STC", confidence: conf });

  it("0.41 vs 0.93 → ett item med confidence 0.93, identisk ved reversert rekkefølge", () => {
    const fwd = build(entriesResult([dup(0.41), dup(0.93)]));
    const rev = build(entriesResult([dup(0.93), dup(0.41)]));
    const items = fwd.days[0]!.contentItems;
    expect(items).toHaveLength(1);
    expect(items[0]!.confidence).toBe(0.93);
    expect(rev.days).toEqual(fwd.days); // uavhengig av inputrekkefølge
    expect(rev.days[0]!.contentItems[0]!.itemId).toBe(items[0]!.itemId);
    expect(rev.days[0]!.contentItems[0]!.audienceEntries[0]!.audienceEntryId).toBe(
      items[0]!.audienceEntries[0]!.audienceEntryId,
    );
  });
});

describe("buildSchoolBlockProposal — child audience + resolvedChildAudience", () => {
  const CTX_MATCH: PortalImportContext = { knownPersons: [], children: makeChildren() };
  const CTX_LEGACY: PortalImportContext = { knownPersons: [], relevanceContext: { classCode: "2STC" } };

  const monEntry = classEntry({ date: "2026-06-15", dayLabel: "mandag", classCodes: ["2STC"], start: "10:30", end: "11:00", room: "332-50" });
  const otherEntry = classEntry({ date: "2026-06-15", dayLabel: "mandag", classCodes: ["2STA"], start: "13:00", activityTitle: "Andre klasse" });

  it("gyldig child class → isChildAudience true ved match (legacy classCode)", () => {
    const item = build(entriesResult([monEntry]), CTX_LEGACY).days[0]!.contentItems[0]!;
    expect(item.audienceEntries[0]!.isChildAudience).toBe(true);
  });

  it("matched children-path gir også child class → isChildAudience true", () => {
    // Uke-fixturen har klassesignal (targetGroup 2STC) → matchDocumentToChild → matched.
    const p = build(makeSchoolBlockWeekResult(), CTX_MATCH);
    expect(p.personMatchStatus).toBe("matched");
    const monday = p.days.find((d) => d.date === "2026-06-15")!;
    const item = monday.contentItems[0]!;
    expect(item.audienceEntries[0]!.isChildAudience).toBe(true);
    expect(item.resolvedChildAudience).not.toBeNull();
  });

  it("gyldig child class → isChildAudience false ved sikker ikke-match", () => {
    const p = build(entriesResult([otherEntry]), CTX_LEGACY);
    const item = p.days[0]!.contentItems[0]!;
    expect(item.audienceEntries[0]!.isChildAudience).toBe(false);
    expect(p.structureStatus).toBe("complete"); // sikker ikke-match er ikke review
  });

  it("manglende child class → isChildAudience null", () => {
    const item = build(entriesResult([monEntry]), EMPTY_CTX).days[0]!.contentItems[0]!;
    expect(item.audienceEntries[0]!.isChildAudience).toBeNull();
  });

  it("legacy relevanceContext.classCode resolver audience uten personId", () => {
    const p = build(entriesResult([monEntry]), CTX_LEGACY);
    const item = p.days[0]!.contentItems[0]!;
    expect(p.personId).toBeNull();
    expect(p.personMatchStatus).toBe("not_specified");
    expect(item.audienceEntries[0]!.isChildAudience).toBe(true);
    expect(item.resolvedChildAudience?.audienceEntryId).toBe(item.audienceEntries[0]!.audienceEntryId);
  });

  it("resolvedChildAudience settes ved nøyaktig én sann match; audienceEntryId ikke-null", () => {
    const item = build(entriesResult([monEntry]), CTX_LEGACY).days[0]!.contentItems[0]!;
    expect(item.resolvedChildAudience).not.toBeNull();
    expect(item.resolvedChildAudience!.audienceEntryId).toBe(item.audienceEntries[0]!.audienceEntryId);
    expect(item.resolvedChildAudience!.audienceEntryId).not.toBeNull();
    expect(item.resolvedChildAudience!.room).toBe("332-50");
  });

  it("ingen match / manglende child class → resolvedChildAudience null", () => {
    expect(build(entriesResult([otherEntry]), CTX_LEGACY).days[0]!.contentItems[0]!.resolvedChildAudience).toBeNull();
    expect(build(entriesResult([monEntry]), EMPTY_CTX).days[0]!.contentItems[0]!.resolvedChildAudience).toBeNull();
  });
});

describe("buildSchoolBlockProposal — review ved uoppløst child class", () => {
  const monEntry = classEntry({ date: "2026-06-15", dayLabel: "mandag", classCodes: ["2STC"], start: "10:30", end: "11:00" });
  const CTX_MATCH: PortalImportContext = { knownPersons: [], children: makeChildren() };
  const CTX_LEGACY: PortalImportContext = { knownPersons: [], relevanceContext: { classCode: "2STC" } };

  it("manglende child class → child_class_unresolved på item/day/proposal + review_required", () => {
    const p = build(entriesResult([monEntry]), EMPTY_CTX);
    const item = p.days[0]!.contentItems[0]!;
    expect(item.reviewFlags).toHaveLength(1);
    expect(item.reviewFlags[0]!.code).toBe("child_class_unresolved");
    expect(item.reviewFlags[0]!.scope.dayId).toBe(p.days[0]!.dayId);
    expect(item.reviewFlags[0]!.scope.itemId).toBe(item.itemId);
    expect(item.reviewFlags[0]!.scope.audienceEntryId).toBeUndefined();
    expect(p.days[0]!.reviewFlags[0]!.code).toBe("child_class_unresolved");
    expect(p.reviewFlags[0]!.code).toBe("child_class_unresolved");
    expect(p.structureStatus).toBe("review_required");
  });

  it("review-flagg dedupliseres og sorteres deterministisk (dayId → itemId → code)", () => {
    const p = build(entriesResult([
      classEntry({ date: "2026-06-15", dayLabel: "mandag", classCodes: ["2STC"], start: "08:00" }),
      classEntry({ date: "2026-06-16", dayLabel: "tirsdag", classCodes: ["2STC"], start: "09:00" }),
    ]), EMPTY_CTX);
    // Ett flagg per item; sortert på dayId (datofestet mandag før tirsdag via ID? nei — via scope.dayId-streng)
    expect(p.reviewFlags).toHaveLength(2);
    const ids = p.reviewFlags.map((f) => f.scope.dayId);
    expect([...ids].sort()).toEqual(ids); // allerede sortert på dayId
  });

  it("sikker child class → ingen review selv med bare ikke-matchende items", () => {
    const other = classEntry({ date: "2026-06-15", dayLabel: "mandag", classCodes: ["2STA"], start: "13:00", activityTitle: "Andre" });
    const p = build(entriesResult([other]), CTX_LEGACY);
    expect(p.reviewFlags).toEqual([]);
    expect(p.structureStatus).toBe("complete");
  });

  it("ambiguous/no_signal MED per_audience-items → review_required", () => {
    // no_signal: doc uten klassesignal, men classScheduleEntries finnes.
    const r = entriesResult([monEntry], { targetGroup: null, title: "", description: "" });
    const p = build(r, CTX_MATCH);
    expect(p.personMatchStatus).toBe("child_unresolved");
    expect(p.structureStatus).toBe("review_required");
  });

  it("ambiguous/no_signal UTEN per_audience-items → fortsatt complete", () => {
    const r = makeMinimalAnalysisResult({ targetGroup: null, title: "", description: "" });
    const p = build(r, CTX_MATCH);
    expect(p.personMatchStatus).toBe("child_unresolved");
    expect(p.structureStatus).toBe("complete");
  });
});

describe("buildSchoolBlockProposal — determinisme med items", () => {
  it("ulik inputrekkefølge gir identiske contentItems og reviewFlags", () => {
    const base = makeSchoolBlockWeekResult();
    const rev = makeSchoolBlockWeekResult();
    rev.scheduleByDay.reverse();
    rev.classScheduleEntries!.reverse();
    const a = build(base, EMPTY_CTX);
    const b = build(rev, EMPTY_CTX);
    expect(b.days).toEqual(a.days);
    expect(b.reviewFlags).toEqual(a.reviewFlags);
  });
});

describe("buildSchoolBlockProposal — renhet og dagsskall", () => {
  it("muterer ikke result", () => {
    const result = makeSchoolBlockWeekResult();
    const snapshot = JSON.stringify(result);
    build(result, { knownPersons: [], children: makeChildren() });
    expect(JSON.stringify(result)).toBe(snapshot);
  });

  it("muterer ikke context", () => {
    const ctx: PortalImportContext = { knownPersons: [], children: makeChildren() };
    const snapshot = JSON.stringify(ctx);
    build(makeSchoolBlockWeekResult(), ctx);
    expect(JSON.stringify(ctx)).toBe(snapshot);
  });

  it("dagsskall-invarianter uendret: none, enrich_only, blockTitle/evidence null", () => {
    const p = build(makeSchoolBlockWeekResult());
    for (const d of p.days) {
      expect(d.dayOperation).toEqual({ op: "none" });
      expect(d.dayResolution).toBe("enrich_only");
      expect(d.blockTitle).toBeNull();
      expect(d.evidence).toBeNull();
    }
  });

  it("ingen common items bygges fra scheduleByDay ennå (kun classScheduleEntries)", () => {
    // Resultat UTEN classScheduleEntries → dager finnes, men ingen content items.
    const p = build(makeMinimalAnalysisResult({
      scheduleByDay: [dayRow("2026-06-15", "Mandag", "masse detaljer, husk gymtøy")],
    }));
    expect(p.days).toHaveLength(1);
    expect(p.days[0]!.contentItems).toEqual([]);
    expect(p.days[0]!.reviewFlags).toEqual([]);
    expect(p.structureStatus).toBe("complete");
  });

  it("begge dagkilder tomme gir days: [] og complete uten oppdiktet dag", () => {
    const p = build(makeMinimalAnalysisResult());
    expect(p.days).toEqual([]);
    expect(p.structureStatus).toBe("complete");
    expect(p.reviewFlags).toEqual([]);
  });
});
