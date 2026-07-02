/**
 * classLocations (per-klasse-lokasjon), produksjonsnært lag: toPortalBundle → event.metadata.
 * Låst kontrakt: event.metadata.classLocations: [{ classCode, room?, teacher? }] — additiv
 * passthrough; flat location beholdes som fallback; feltet UTEBLIR når kilden ikke har det.
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, ClassLocation, DayScheduleEntry } from "@/lib/types";

const RAADGIVER_ROWS: ClassLocation[] = [
  { classCode: "2STA", room: "332-40", teacher: "Andreas Vågen" },
  { classCode: "2STC", room: "332-50", teacher: "Marte Hermanrud" },
  { classCode: "2STE", room: "332-60", teacher: "Gjermund Kvåle Jordheim" },
];

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

function raadgiverResult(withClassLocations: boolean): AIAnalysisResult {
  return {
    title: "Rådgiveropplegg 2ST",
    schedule: [],
    scheduleByDay: [
      day({
        dayLabel: "torsdag",
        date: "18. juni 2026",
        time: "10:00",
        highlights: ["10:00 Auditoriet med rådgiverne", "11:15 Klasserommet med faglærere"],
      }),
    ],
    location: "Auditoriet og klasserommene 332-40, 332-50 og 332-60",
    ...(withClassLocations ? { classLocations: RAADGIVER_ROWS } : {}),
    description: "Opplegg med rådgiverne for 2ST-klassene.",
    category: "arrangement" as AIAnalysisResult["category"],
    targetGroup: "2ST",
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    extractedText: { raw: "Rådgiveropplegg 18.06", language: "no", confidence: 1 },
  };
}

type EventItem = {
  kind: string;
  event?: { location?: string; metadata?: { classLocations?: ClassLocation[] } };
};

async function bundleEvents(result: AIAnalysisResult): Promise<EventItem[]> {
  const bundle = (await toPortalBundle(result, "text", undefined, false, {
    knownPersons: [],
  })) as { items: EventItem[] };
  return bundle.items.filter((i) => i.kind === "event");
}

describe("classLocations i portal-bundle (toPortalBundle)", () => {
  it("result MED classLocations → event.metadata.classLocations (casing bevart) + flat location-fallback", async () => {
    const events = await bundleEvents(raadgiverResult(true));
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.event?.metadata?.classLocations).toEqual(RAADGIVER_ROWS);
      expect(e.event?.location).toBe("Auditoriet og klasserommene 332-40, 332-50 og 332-60");
    }
  });

  it("kontroll: samme result UTEN classLocations → nøkkelen finnes IKKE i metadata", async () => {
    const events = await bundleEvents(raadgiverResult(false));
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.event?.metadata ?? {}).not.toHaveProperty("classLocations");
      expect(e.event?.location).toBe("Auditoriet og klasserommene 332-40, 332-50 og 332-60");
    }
  });

  it("cup-aktig result (ingen klasse→rom-rader) → classLocations uteblir", async () => {
    const cup: AIAnalysisResult = {
      title: "Vårcupen 2026",
      schedule: [],
      scheduleByDay: [
        day({
          dayLabel: "lørdag",
          date: "13. juni 2026",
          highlights: ["08:35 Oppmøte", "09:20 Kamp"],
        }),
      ],
      location: "Ekeberg idrettsanlegg",
      description: "Cuphelg.",
      category: "arrangement" as AIAnalysisResult["category"],
      targetGroup: "G12",
      organizer: null,
      contactPerson: null,
      sourceUrl: null,
      confidence: 0.9,
      extractedText: { raw: "Vårcupen 2026 lørdag kamp 09:20", language: "no", confidence: 1 },
    };
    const events = await bundleEvents(cup);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.event?.metadata ?? {}).not.toHaveProperty("classLocations");
    }
  });
});
