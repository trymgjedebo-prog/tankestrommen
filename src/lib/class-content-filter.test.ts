import { describe, expect, it } from "vitest";
import { lineIsRelevantForClass } from "./school-class-schedule";
import { filterAnalysisContentByClass } from "./class-content-filter";
import type { AIAnalysisResult, DayScheduleEntry } from "./types";

describe("lineIsRelevantForClass", () => {
  it("beholder linjer uten klassemarkør (gjelder alle)", () => {
    expect(lineIsRelevantForClass("08:30 Bokinnlevering", "2STC")).toBe(true);
  });

  it("beholder linjer som nevner elevens klasse", () => {
    expect(lineIsRelevantForClass("2STC: Gym fredag", "2STC")).toBe(true);
  });

  it("dropper linjer kun for andre klasser", () => {
    expect(lineIsRelevantForClass("2STA: Matteprøve", "2STC")).toBe(false);
    expect(lineIsRelevantForClass("2STB Tysk innlevering", "2STC")).toBe(false);
  });

  it("matcher klassevarianter (whitespace/case/æøå-fold)", () => {
    expect(lineIsRelevantForClass("2 STC: møte", "2STC")).toBe(true);
    expect(lineIsRelevantForClass("2stc: møte", "2STC")).toBe(true);
    expect(lineIsRelevantForClass("møte for 2STC", "2 stc")).toBe(true);
  });

  it("beholder linjer der elevens klasse er blant flere", () => {
    expect(lineIsRelevantForClass("2STA, 2STC: fellesmøte", "2STC")).toBe(true);
  });

  it("uten elev-klasse beholdes alt", () => {
    expect(lineIsRelevantForClass("2STA: Matteprøve", undefined)).toBe(true);
  });
});

function day(partial: Partial<DayScheduleEntry>): DayScheduleEntry {
  return {
    dayLabel: "Mandag",
    date: null,
    time: null,
    details: null,
    highlights: [],
    rememberItems: [],
    deadlines: [],
    notes: [],
    ...partial,
  };
}

function result(partial: Partial<AIAnalysisResult>): AIAnalysisResult {
  return {
    title: "Ukeplan",
    schedule: [],
    scheduleByDay: [],
    location: null,
    description: "",
    category: "beskjed",
    targetGroup: null,
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.8,
    extractedText: { raw: "", language: "no", confidence: 0.8 },
    ...partial,
  };
}

describe("filterAnalysisContentByClass", () => {
  it("dropper andre-klasse-innhold men beholder felles + elevens klasse", () => {
    const r = result({
      scheduleByDay: [
        day({
          highlights: ["Fellesmøte i auditoriet", "2STA: Matteprøve", "2STC: Gym"],
          notes: ["2STB: Tysk innlevering", "Husk gymtøy"],
          details: "08:30 Bokinnlevering\n2STA: Spansk prøve\n2STC: Norsk fordypning",
        }),
      ],
    });
    const out = filterAnalysisContentByClass(r, "2STC");
    const d = out.scheduleByDay[0]!;
    expect(d.highlights).toEqual(["Fellesmøte i auditoriet", "2STC: Gym"]);
    expect(d.notes).toEqual(["Husk gymtøy"]);
    expect(d.details).toBe("08:30 Bokinnlevering\n2STC: Norsk fordypning");
  });

  it("uten classCode returnerer resultatet uendret (samme referanse)", () => {
    const r = result({ scheduleByDay: [day({ highlights: ["2STA: Matteprøve"] })] });
    expect(filterAnalysisContentByClass(r, undefined)).toBe(r);
    expect(filterAnalysisContentByClass(r, "   ")).toBe(r);
  });

  it("rører ikke schoolWeeklyProfile, tittel eller beskrivelse", () => {
    const swp = { gradeBand: "vg2" as const, weekdays: {} };
    const r = result({
      title: "Ukeplan for 2STA–2STF",
      description: "Gjelder 2STA, 2STB, 2STC",
      schoolWeeklyProfile: swp,
      scheduleByDay: [day({ highlights: ["2STA: Matteprøve"] })],
    });
    const out = filterAnalysisContentByClass(r, "2STC");
    expect(out.title).toBe("Ukeplan for 2STA–2STF");
    expect(out.description).toBe("Gjelder 2STA, 2STB, 2STC");
    expect(out.schoolWeeklyProfile).toBe(swp);
    expect(out.scheduleByDay[0]!.highlights).toEqual([]);
  });

  it("filtrerer løse schedule-linjer på label", () => {
    const r = result({
      schedule: [
        { date: null, time: "08:30", label: "Fellesmøte" },
        { date: null, time: "10:00", label: "2STA: Matteprøve" },
      ],
    });
    const out = filterAnalysisContentByClass(r, "2STC");
    expect(out.schedule.map((s) => s.label)).toEqual(["Fellesmøte"]);
  });
});
