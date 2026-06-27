/**
 * Del A: en eksamens-/skoleuke UTEN tittel-ord («ukeplan»/«aktivitetsplan») og UTEN ukenummer skal
 * nå rutes til skole-stien via sterk skolebevis (≥2 VGS-klassekoder + skoleord) — ikke arrangement-
 * stien. Verifiserer at events får `schoolContext`, og at arrangement-lenking + `competitionClass`
 * (skoleklasser som «konkurranseklasse») IKKE påføres skole-events.
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

function day(
  dayLabel: string,
  date: string | null,
  details: string,
  time: string | null = null,
  highlights: string[] = [],
): DayScheduleEntry {
  return {
    dayLabel,
    date,
    time,
    details,
    highlights,
    rememberItems: [],
    deadlines: [],
    notes: [],
  };
}

function makeResult(
  fields: Pick<
    AIAnalysisResult,
    "title" | "description" | "extractedText" | "scheduleByDay" | "targetGroup"
  >,
): AIAnalysisResult {
  return {
    schedule: [],
    location: null,
    category: "school_week" as AIAnalysisResult["category"],
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    ...fields,
  };
}

async function eventItems(r: AIAnalysisResult) {
  const bundle = (await toPortalBundle(r, "text", undefined, false, { knownPersons: [] })) as {
    items: Array<{ kind: string; event?: { metadata?: Record<string, unknown> } }>;
  };
  return bundle.items.filter((i) => i.kind === "event");
}

describe("Del A: eksamens-/skoleuke uten tittel-ord rutes til skole-stien", () => {
  it("sterk skolebevis (2STA/2STC/2STE + eksamen/bokinnlevering) → schoolContext, ingen arrangement/competitionClass", async () => {
    const raw =
      "Eksamen og avslutninger 2ST\nKlasser: 2STA, 2STC, 2STE.\n" +
      "Mandag: Muntlig eksamen for 2STA i auditoriet.\n" +
      "Tirsdag: Bokinnlevering 2STC.\n" +
      "Fredag: Klasseavslutning for alle.";
    const r = makeResult({
      title: "Eksamen og avslutninger", // ingen ukeplan/aktivitetsplan-ord, ingen ukenummer
      description: "2STA, 2STC og 2STE. Bokinnlevering og muntlig eksamen.",
      extractedText: { raw, language: "no", confidence: 1 },
      targetGroup: "2STA, 2STC og 2STE",
      scheduleByDay: [
        day("mandag", "2026-06-15", "Muntlig eksamen for 2STA i auditoriet.", "09:00", ["Muntlig eksamen 2STA"]),
        day("tirsdag", "2026-06-16", "Bokinnlevering 2STC.", "10:30", ["Bokinnlevering 2STC"]),
        day("onsdag", "2026-06-17", "Skriftlig eksamen 2STE.", "09:00", ["Skriftlig eksamen 2STE"]),
        day("fredag", "2026-06-19", "Klasseavslutning for alle.", "12:00", ["Klasseavslutning"]),
      ],
    });

    const events = await eventItems(r);
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) {
      const md = ev.event?.metadata ?? {};
      expect(md.schoolContext).toBeTruthy(); // rutet til skole-stien
      expect(md.arrangementBlockGroupId).toBeUndefined(); // ingen arrangement-lenking for skole
      expect(md.competitionClass).toBeUndefined(); // skoleklasser ikke som konkurranseklasse
    }
  });

  it("kontroll: samme struktur UTEN klassekoder/skoleord → ikke skole (ingen schoolContext)", async () => {
    const raw =
      "Programoppsett\nMandag: Økt i salen.\nTirsdag: Økt i salen.\nFredag: Fellesøkt for alle.";
    const r = makeResult({
      title: "Programoppsett",
      description: "Felles program for alle.",
      extractedText: { raw, language: "no", confidence: 1 },
      targetGroup: null,
      scheduleByDay: [
        day("mandag", "2026-06-15", "Økt i salen.", "09:00"),
        day("tirsdag", "2026-06-16", "Økt i salen.", "09:00"),
        day("fredag", "2026-06-19", "Fellesøkt for alle.", "12:00"),
      ],
    });

    const events = await eventItems(r);
    for (const ev of events) {
      expect(ev.event?.metadata?.schoolContext).toBeFalsy();
    }
  });
});
