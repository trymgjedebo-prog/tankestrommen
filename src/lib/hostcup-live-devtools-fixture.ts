import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

export const LIVE_FREDAG_BUFFER_NOTE =
  "Regn med at dere ikke er ute av hallen før ca. en halvtime etter kampen";

/**
 * Reproduces Foreldre-App DevTools 2026-05-24 live LLM shape:
 * fredag buffer only in scheduleByDay.notes (not in raw fredag section).
 */
export function hostcupLiveDevToolsInput(): AIAnalysisResult {
  const rawFull = readFileSync(
    resolve("fixtures/tankestrom/hostcup_duration_endtime_rich.txt"),
    "utf8",
  );
  const raw = rawFull.replace(/Regn med[^\n]*kampslutt\.?\s*\n/i, "");

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
        highlights: ["16:40 Oppmøte", "17:30 Første kamp"],
        notes: [
          "Møt ferdig skiftet 50 minutter før kampstart.",
          LIVE_FREDAG_BUFFER_NOTE,
          "Mobiltelefoner skal ligge i bagen under kampen.",
        ],
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
        notes: [
          "Oppmøte 45 minutter før hver kamp.",
          "Kampene har samme spilletid som fredag.",
          "Beregn litt tid etter siste kamp før dere drar hjem.",
        ],
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
    category: "arrangement",
    targetGroup: null,
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    extractedText: { raw, language: "no", confidence: 1 },
  };
}
