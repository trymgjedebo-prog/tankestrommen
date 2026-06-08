import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

/** Live LLM kan sende både 16:40 og 16:45 oppmøte (45-min lekkasje fra lørdag). */
function hostcupDegradedFredagHighlightsInput(): AIAnalysisResult {
  const raw = readFileSync(
    resolve("fixtures/tankestrom/hostcup_duration_endtime_rich.txt"),
    "utf8",
  );
  const day = (
    partial: Partial<DayScheduleEntry> & Pick<DayScheduleEntry, "dayLabel">,
  ): DayScheduleEntry => ({
    dayLabel: partial.dayLabel,
    date: partial.date ?? null,
    time: partial.time ?? null,
    details: partial.details ?? null,
    highlights: partial.highlights ?? [],
    rememberItems: partial.rememberItems ?? [],
    deadlines: partial.deadlines ?? [],
    notes: partial.notes ?? [],
  });

  return {
    title: "Høstcupen håndball 2026",
    schedule: [],
    scheduleByDay: [
      day({
        dayLabel: "fredag",
        date: "2026-09-18",
        time: "16:40",
        highlights: ["16:40 Oppmøte", "16:45 Oppmøte", "17:30 Første kamp"],
        notes: ["Møt ferdig skiftet 50 minutter før kampstart."],
      }),
      day({
        dayLabel: "lørdag",
        date: "2026-09-19",
        time: "08:30",
        highlights: [
          "08:30 Oppmøte før første kamp",
          "09:15 Første kamp",
          "13:55 Oppmøte før andre kamp",
          "14:40 Andre kamp",
        ],
        notes: ["Oppmøte 45 minutter før hver kamp."],
      }),
      day({
        dayLabel: "søndag",
        date: "2026-09-20",
        highlights: ["A-sluttspill: første kamp mellom kl. 10:00 og 12:00 (foreløpig)"],
        notes: [
          "Foreløpig sluttspillopplegg.",
          "B-sluttspill etter lunsj dersom vi havner der.",
          "Detaljert søndagsprogram kommer senere.",
        ],
      }),
    ],
    location: "Nadderud Arena",
    description: raw,
    category: "cup",
    targetGroup: null,
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    extractedText: { raw, language: "no", confidence: 1 },
  };
}

function friHighlights(bundle: Record<string, unknown>): string[] {
  const items = bundle.items as Array<{
    kind: string;
    event?: { metadata?: { embeddedSchedule?: Array<{ dayContent?: { highlights?: string[] } }> } };
  }>;
  const parent = items.find((i) => i.kind === "event" && i.event?.metadata?.embeddedSchedule?.length);
  const fri = parent?.event?.metadata?.embeddedSchedule?.[0];
  return fri?.dayContent?.highlights ?? [];
}

describe("Høstcup live-degraded portal shape", () => {
  it("fredag embeddedSchedule skal ikke ha 16:45 når 16:40 er source-supported oppmøte", async () => {
    const bundle = (await toPortalBundle(hostcupDegradedFredagHighlightsInput(), "text", "text", true, {
      knownPersons: [],
    })) as Record<string, unknown>;
    const hl = friHighlights(bundle);
    expect(hl.some((h) => /^16:40\s+Oppmøte/i.test(h))).toBe(true);
    expect(hl.some((h) => /^17:30\s+Første kamp/i.test(h))).toBe(true);
    expect(hl.some((h) => /16:45/.test(h))).toBe(false);
    expect(hl.filter((h) => /^16:\d{2}\s+Oppmøte/i.test(h)).length).toBeLessThanOrEqual(1);
  });
});
