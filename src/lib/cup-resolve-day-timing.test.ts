import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCupTimeWindow } from "./cup-day-content";
import { resolveCupDayTiming } from "./cup-resolve-day-timing";
import type { DayScheduleEntry } from "@/lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

function emptyDay(): DayScheduleEntry {
  return {
    dayLabel: "søndag",
    date: "2026-09-20",
    time: null,
    details: null,
    highlights: [],
    rememberItems: [],
    deadlines: [],
    notes: [],
  };
}

describe("resolveCupDayTiming", () => {
  it("parseCupTimeWindow finner vindu i Høstcup-fixture", () => {
    const p = resolve(__dirname, "../../fixtures/tankestrom/hostcup_handball.txt");
    const host = readFileSync(p, "utf8");
    expect(parseCupTimeWindow(host)).toEqual(
      expect.objectContaining({ earliestStart: "10:00", latestStart: "12:00" }),
    );
  });

  it("betinget dag: «mellom 10 og 12» gir date_only uten timeWindow (ikke fast programvindu)", () => {
    const blob = "Ved A-sluttspill kan det bli søndagskamp mellom kl. 10:00 og 12:00.";
    const r = resolveCupDayTiming({
      day: emptyDay(),
      detailsForEvent: null,
      highlightsForEventFinal: [],
      notesOnlyForEvent: [blob],
      rememberForEvent: [],
      deadlinesForEvent: [],
      conditionalDay: true,
    });
    expect(r.timePrecision).toBe("date_only");
    expect(r.timeWindow).toBeUndefined();
    expect(r.start).toBeNull();
    expect(r.end).toBeNull();
  });

  it("lørdag: søndagskamp-vindu i delt blob skal ikke overstyrde som time_window", () => {
    const day: DayScheduleEntry = {
      dayLabel: "lørdag",
      date: "2026-09-19",
      time: null,
      details: null,
      highlights: ["09:15 Første kamp", "14:40 Andre kamp"],
      rememberItems: [],
      deadlines: [],
      notes: [
        "Kampoppsett: fredag kl. 17:30, lørdag kl. 09:15 og kl. 14:40.",
        "Ved A-sluttspill kan det bli søndagskamp mellom kl. 10:00 og 12:00.",
      ],
    };
    const r = resolveCupDayTiming({
      day,
      detailsForEvent: null,
      highlightsForEventFinal: day.highlights,
      notesOnlyForEvent: day.notes,
      rememberForEvent: [],
      deadlinesForEvent: [],
      conditionalDay: false,
    });
    expect(r.timePrecision).toBe("start_only");
    expect(r.timeWindow).toBeUndefined();
  });

  it("samme vindu uten betingelse: beholder time_window", () => {
    const blob = "Kamp mellom kl. 10:00 og 12:00.";
    const r = resolveCupDayTiming({
      day: emptyDay(),
      detailsForEvent: null,
      highlightsForEventFinal: [],
      notesOnlyForEvent: [blob],
      rememberForEvent: [],
      deadlinesForEvent: [],
      conditionalDay: false,
    });
    expect(r.timePrecision).toBe("time_window");
    expect(r.timeWindow).toEqual({ earliestStart: "10:00", latestStart: "12:00" });
  });

  it("bevarer time_window når kamptidslista bare gjenspeiler vindu-start (syntetisk «10:00 Kamp»)", () => {
    const day: DayScheduleEntry = {
      dayLabel: "lørdag",
      date: "2026-06-14",
      time: "10:00",
      details: "Dugnad på klubbhuset mellom kl. 10:00 og 12:00.",
      highlights: ["10:00 Kamp"],
      rememberItems: [],
      deadlines: [],
      notes: [],
    };
    const r = resolveCupDayTiming({
      day,
      detailsForEvent: day.details,
      highlightsForEventFinal: day.highlights,
      notesOnlyForEvent: [],
      rememberForEvent: [],
      deadlinesForEvent: [],
      conditionalDay: false,
    });
    expect(r.timePrecision).toBe("time_window");
    expect(r.start).toBe("10:00");
    expect(r.end).toBe("12:00");
  });

  it("supplemental kilde: struktur uten mellom, men rå linje med dugnad-vindu → time_window", () => {
    const day: DayScheduleEntry = {
      dayLabel: "lørdag",
      date: "2026-06-14",
      time: "10:00",
      details: null,
      highlights: ["10:00 Dugnad"],
      rememberItems: [],
      deadlines: [],
      notes: [],
    };
    const r = resolveCupDayTiming({
      day,
      detailsForEvent: day.details,
      highlightsForEventFinal: day.highlights,
      notesOnlyForEvent: [],
      rememberForEvent: [],
      deadlinesForEvent: [],
      conditionalDay: false,
      supplementalTimeContextBlob:
        "Lørdag 14. juni 2026: Dugnad på klubbhuset mellom kl. 10:00 og 12:00. Oppfordring til alle.",
    });
    expect(r.timePrecision).toBe("time_window");
    expect(r.start).toBe("10:00");
    expect(r.end).toBe("12:00");
    expect(r.timeWindow).toEqual({ earliestStart: "10:00", latestStart: "12:00" });
  });

  it("uten kamp-tider: dugnad «mellom … og …» gir time_window (ikke eksakt cup-intervall)", () => {
    const day: DayScheduleEntry = {
      dayLabel: "lørdag",
      date: "2026-06-14",
      time: "10:00",
      details: "Dugnad på klubbhuset mellom kl. 10:00 og 12:00.",
      highlights: ["10:00 Dugnad"],
      rememberItems: [],
      deadlines: [],
      notes: [],
    };
    const r = resolveCupDayTiming({
      day,
      detailsForEvent: day.details,
      highlightsForEventFinal: day.highlights,
      notesOnlyForEvent: [],
      rememberForEvent: [],
      deadlinesForEvent: [],
      conditionalDay: false,
    });
    expect(r.timePrecision).toBe("time_window");
    expect(r.start).toBe("10:00");
    expect(r.end).toBe("12:00");
  });

  it("Høstcup live-lignende: fredag 16:40 oppmøte, 18:45 inferred end", () => {
    const corpus = readFileSync(
      resolve(__dirname, "../../fixtures/tankestrom/hostcup_duration_endtime_rich.txt"),
      "utf8",
    );
    const day: DayScheduleEntry = {
      dayLabel: "fredag",
      date: "2026-09-18",
      time: "16:40",
      details: null,
      highlights: ["16:40 Oppmøte", "17:30 Første kamp"],
      rememberItems: [],
      deadlines: [],
      notes: ["Møt ferdig skiftet 50 minutter før kampstart."],
    };
    const r = resolveCupDayTiming({
      day,
      detailsForEvent: null,
      highlightsForEventFinal: day.highlights,
      notesOnlyForEvent: day.notes,
      rememberForEvent: [],
      deadlinesForEvent: [],
      conditionalDay: false,
      fullCorpus: corpus,
    });
    expect(r.attendanceTime).toBe("16:40");
    expect(r.durationMinutes).toBe(45);
    expect(r.breakMinutes).toBe(5);
    expect(r.afterBufferMinutes).toBe(30);
    expect(r.end).toBe("18:45");
    expect(r.endTimeSource).toBe("computed_from_duration_and_aftertime");
    expect(r.inferredEndTime).toBe(true);
  });
});
