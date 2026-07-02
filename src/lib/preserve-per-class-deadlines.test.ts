/**
 * #4+#5-bevaring (per-klasse-frister), deterministisk lag: beviser at den prompt-bevarte
 * formen — én klasse per linje/bullet, i FILTRERT slot — faktisk er oppgave-7-filtrerbar,
 * uavhengig av modellen. Filosofi (a): prompten bevarer ALLE klassers frister (den kjenner
 * ikke barnet); filterAnalysisContentByClass beholder barnets og dropper de andre.
 * Speiler class-locations-portal.test.ts i oppsett.
 */
import { describe, expect, it } from "vitest";
import { filterAnalysisContentByClass } from "@/lib/class-content-filter";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

function day(p: Partial<DayScheduleEntry> & Pick<DayScheduleEntry, "dayLabel">): DayScheduleEntry {
  return {
    dayLabel: p.dayLabel,
    date: p.date ?? null,
    time: p.time ?? null,
    details: p.details ?? null,
    highlights: p.highlights ?? [],
    rememberItems: p.rememberItems ?? [],
    deadlines: p.deadlines ?? [],
    notes: p.notes ?? [],
  };
}

function baseResult(overrides: Partial<AIAnalysisResult>): AIAnalysisResult {
  return {
    title: "Rådgiveropplegg 2ST",
    schedule: [],
    scheduleByDay: [],
    location: null,
    description: "Opplegg med rådgiverne for 2ST-klassene.",
    category: "arrangement",
    targetGroup: "2ST",
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    extractedText: { raw: "Rådgiveropplegg med bokinnlevering", language: "no", confidence: 1 },
    ...overrides,
  };
}

describe("preserve-per-class-deadlines: bevart form er oppgave-7-filtrerbar", () => {
  it("bilde-stiens form (én klasse per LINJE i details) → barn 2STC beholder KUN sin linje", () => {
    const result = baseResult({
      scheduleByDay: [
        day({
          dayLabel: "torsdag",
          date: "18. juni 2026",
          details:
            "Bokinnlevering 2STA 13.10-13.40\nBokinnlevering 2STC 10.30-11.00\nBokinnlevering 2STE 09.15-09.45",
        }),
      ],
    });
    const filtered = filterAnalysisContentByClass(result, "2STC");
    expect(filtered.scheduleByDay[0].details).toBe("Bokinnlevering 2STC 10.30-11.00");
  });

  it("tekst-stiens form (én klasse per BULLET i deadlines[]) → barn 2STC beholder KUN sin bullet", () => {
    const result = baseResult({
      scheduleByDay: [
        day({
          dayLabel: "torsdag",
          deadlines: [
            "Bokinnlevering 2STA 13.10-13.40",
            "Bokinnlevering 2STC 10.30-11.00",
            "Bokinnlevering 2STE 09.15-09.45",
          ],
        }),
      ],
    });
    const filtered = filterAnalysisContentByClass(result, "2STC");
    expect(filtered.scheduleByDay[0].deadlines).toEqual(["Bokinnlevering 2STC 10.30-11.00"]);
  });

  it("inertness: vanlig fellesfrist uten klassekoder røres IKKE når barnet er kjent", () => {
    const result = baseResult({
      scheduleByDay: [
        day({
          dayLabel: "fredag",
          details: "Innlevering av naturfagsrapport",
          deadlines: ["Innlevering fredag"],
        }),
      ],
    });
    const filtered = filterAnalysisContentByClass(result, "2STC");
    expect(filtered.scheduleByDay[0].details).toBe("Innlevering av naturfagsrapport");
    expect(filtered.scheduleByDay[0].deadlines).toEqual(["Innlevering fredag"]);
  });
});
