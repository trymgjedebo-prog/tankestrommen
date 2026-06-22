/**
 * Produksjonsnær test (toPortalBundle → route.ts): en skole-/klasseplan med klassekoder skal
 * ikke klassifiseres som cup, og tidspunktene skal ikke få «Første kamp»/«kamp»-labels — selv
 * når teksten inneholder et tvetydig signal som «oppmøte».
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

function emptyDay(p: Partial<DayScheduleEntry> & Pick<DayScheduleEntry, "dayLabel">): DayScheduleEntry {
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

async function eventNotes(result: AIAnalysisResult): Promise<string> {
  const bundle = (await toPortalBundle(result, "text", undefined, false, { knownPersons: [] })) as {
    items: Array<{ kind: string; event?: { notes?: string } }>;
  };
  return bundle.items
    .filter((i) => i.kind === "event")
    .map((i) => i.event?.notes ?? "")
    .join("\n");
}

describe("produksjon: skole-/klasseplan får ikke kamp-labels", () => {
  it("klasseplan (2STA–2STD) med «oppmøte» → ingen Første/Andre kamp i highlights", async () => {
    const raw =
      "Skoleplan uke 25\nTid | 2STA | 2STB | 2STC | 2STD\n08:30 | Bokinnlevering | Rådgiveropplegg | Tur til Sognsvann | Forberedelse\n10:00 | Avslutning | Bokinnlevering | Klasseopplegg | Rådgiver";
    const result: AIAnalysisResult = {
      title: "Skoleplan uke 25 – 2STA 2STB 2STC 2STD",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "mandag",
          date: "16. juni 2026",
          highlights: ["08:30 Bokinnlevering", "10:00 Avslutning"],
          notes: ["Oppmøte i auditoriet for alle klasser."],
        }),
      ],
      location: null,
      description: "2STA 2STB 2STC 2STD. Oppmøte i auditoriet.",
      category: "school_week" as AIAnalysisResult["category"],
      targetGroup: null,
      organizer: null,
      contactPerson: null,
      sourceUrl: null,
      confidence: 0.9,
      extractedText: { raw, language: "no", confidence: 1 },
    };
    const notes = await eventNotes(result);
    expect(notes).not.toContain("Første kamp");
    expect(notes).not.toContain("Andre kamp");
    expect(notes).not.toMatch(/\bkamp\b/i);
    // Reelle tider og skolefaglig innhold bevart.
    expect(notes).toContain("08:30");
    expect(notes.toLowerCase()).toContain("bokinnlevering");
  });
});
