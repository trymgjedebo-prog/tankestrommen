import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { parseStructuredPortalEventNotes } from "@/evals/portal-bundle-to-regression";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

function emptyDay(partial: Partial<DayScheduleEntry> & Pick<DayScheduleEntry, "dayLabel">): DayScheduleEntry {
  return {
    dayLabel: partial.dayLabel,
    date: partial.date ?? null,
    time: partial.time ?? null,
    details: partial.details ?? null,
    highlights: partial.highlights ?? [],
    rememberItems: partial.rememberItems ?? [],
    deadlines: partial.deadlines ?? [],
    notes: partial.notes ?? [],
  };
}

describe("Ikke-cup: Spond-frist som portal-task (description + gi beskjed / meld deg på)", () => {
  it("plukker Spond-frist fra description når dag-feltene ikke har linjen; én task for flere dager", async () => {
    const description =
      "Gi beskjed i Spond om du kan stille, frist onsdag 11. juni (angitt i Spond).\nTa med hansker.";
    const result: AIAnalysisResult = {
      title: "Foreldregruppa – våravslutning",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "fredag",
          date: "13. juni 2026",
          highlights: ["19:00 Foreldremøte"],
          notes: [],
        }),
        emptyDay({
          dayLabel: "lørdag",
          date: "14. juni 2026",
          highlights: ["10:00–12:00 Dugnad"],
          notes: [],
        }),
      ],
      location: null,
      description,
      category: "parent_meeting_workday",
      targetGroup: null,
      organizer: null,
      contactPerson: null,
      sourceUrl: null,
      confidence: 0.9,
      extractedText: { raw: "", language: "no", confidence: 1 },
    };
    const bundle = (await toPortalBundle(result, "text", undefined, false, {
      knownPersons: [],
    })) as { items: Array<{ kind: string; task?: { title?: string; date?: string; dueTime?: string } }> };
    const spondTasks = bundle.items.filter(
      (i) => i.kind === "task" && /spond/i.test(String(i.task?.title ?? "")),
    );
    expect(spondTasks.length).toBe(1);
    expect(spondTasks[0]!.task!.date).toBe("2026-06-11");
    expect(spondTasks[0]!.task!.dueTime == null || spondTasks[0]!.task!.dueTime === "").toBe(true);
  });

  it("meld deg på i Spond innen … med klokkeslett → dueTime satt", async () => {
    const line = "Meld deg på i Spond innen søndag 22. juni kl. 18:00.";
    const result: AIAnalysisResult = {
      title: "Sommeravslutning",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "lørdag",
          date: "28. juni 2026",
          notes: [line],
          highlights: ["10:00 Avslutning"],
        }),
      ],
      location: null,
      description: "",
      category: "arrangement",
      targetGroup: null,
      organizer: null,
      contactPerson: null,
      sourceUrl: null,
      confidence: 0.9,
      extractedText: { raw: line, language: "no", confidence: 1 },
    };
    const bundle = (await toPortalBundle(result, "text", undefined, false, {
      knownPersons: [],
    })) as { items: Array<{ kind: string; task?: { title?: string; date?: string; dueTime?: string } }> };
    const spondTasks = bundle.items.filter(
      (i) => i.kind === "task" && /spond/i.test(String(i.task?.title ?? "")),
    );
    expect(spondTasks.length).toBeGreaterThanOrEqual(1);
    const t = spondTasks.find((x) => x.task?.date === "2026-06-22");
    expect(t).toBeTruthy();
    expect(t!.task!.dueTime).toMatch(/^18:00$/);
  });

  it("én-dagers cup/Spond: Spond-frist kun i description gir fortsatt task", async () => {
    const raw =
      "Svar i Spond om barnet kan være med, senest torsdag 6. november (sett frist i Spond).";
    const result: AIAnalysisResult = {
      title: "Guttelaget – beskjed uke 42",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "fredag",
          date: "7. november 2026",
          highlights: ["17:45 Oppmøte", "18:30 Trening"],
          notes: [],
        }),
      ],
      location: null,
      description: raw,
      category: "team_message",
      targetGroup: null,
      organizer: null,
      contactPerson: null,
      sourceUrl: null,
      confidence: 0.9,
      extractedText: { raw: "", language: "no", confidence: 1 },
    };
    const bundle = (await toPortalBundle(result, "text", undefined, false, {
      knownPersons: [],
    })) as { items: Array<{ kind: string; task?: { title?: string; date?: string } }> };
    const spondTasks = bundle.items.filter(
      (i) => i.kind === "task" && /spond/i.test(String(i.task?.title ?? "")),
    );
    expect(spondTasks.length).toBe(1);
    expect(spondTasks[0]!.task!.date).toBe("2026-11-06");
  });

  it("ren Spond-frist som eneste highlight blir ikke program-highlight", async () => {
    const line = "Svar i Spond om barnet kan være med, senest torsdag 6. november.";
    const result: AIAnalysisResult = {
      title: "Guttelaget – beskjed uke 42",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "fredag",
          date: "7. november 2026",
          highlights: [line],
          notes: [],
        }),
      ],
      location: null,
      description: "",
      category: "team_message",
      targetGroup: null,
      organizer: null,
      contactPerson: null,
      sourceUrl: null,
      confidence: 0.9,
      extractedText: { raw: "", language: "no", confidence: 1 },
    };
    const bundle = (await toPortalBundle(result, "text", undefined, false, {
      knownPersons: [],
    })) as {
      items: Array<{ kind: string; event?: { notes?: string } }>;
    };
    const ev = bundle.items.find((i) => i.kind === "event");
    const { highlights } = parseStructuredPortalEventNotes(ev?.event?.notes);
    expect(highlights.join(" ").toLowerCase()).not.toContain("spond");
  });
});
