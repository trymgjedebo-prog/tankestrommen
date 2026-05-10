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

  it("Svar i Spond innen mandag kl. 20:00 → dueTime 20:00 (ikke fra annen programtekst)", async () => {
    const line = "Svar i Spond innen mandag kl. 20:00 om du kan bidra.";
    const result: AIAnalysisResult = {
      title: "Foreldredugnad",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "torsdag",
          date: "5. juni 2026",
          highlights: ["18:30 Trening"],
          notes: [line],
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
    })) as { items: Array<{ kind: string; task?: { dueTime?: string } }> };
    const spondTasks = bundle.items.filter(
      (i) => i.kind === "task" && /spond/i.test(String(i.task?.title ?? "")),
    );
    expect(spondTasks.length).toBeGreaterThanOrEqual(1);
    expect(spondTasks.some((t) => t.task?.dueTime === "20:00")).toBe(true);
  });

  it("Gi beskjed i Spond innen onsdag uten kl. + foreldremøte kl. 19:00 → dueTime null", async () => {
    const line = "Gi beskjed i Spond innen onsdag 11. juni om oppmøte.";
    const result: AIAnalysisResult = {
      title: "Foreldregruppa",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "fredag",
          date: "13. juni 2026",
          highlights: ["19:00 Foreldremøte"],
          notes: [line],
        }),
      ],
      location: null,
      description: "",
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
    })) as { items: Array<{ kind: string; task?: { dueTime?: string } }> };
    const spondTasks = bundle.items.filter(
      (i) => i.kind === "task" && /spond/i.test(String(i.task?.title ?? "")),
    );
    expect(spondTasks.length).toBeGreaterThanOrEqual(1);
    expect(spondTasks.every((t) => !t.task?.dueTime)).toBe(true);
  });

  it("Meld deg på i Spond innen fredag uten kl. + oppmøte 17:45 → dueTime null", async () => {
    const line = "Meld deg på i Spond innen fredag om du kan stille.";
    const result: AIAnalysisResult = {
      title: "Guttelaget",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "fredag",
          date: "7. november 2026",
          highlights: ["17:45 Oppmøte", "18:30 Trening"],
          notes: [line],
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
    })) as { items: Array<{ kind: string; task?: { dueTime?: string } }> };
    const spondTasks = bundle.items.filter(
      (i) => i.kind === "task" && /spond/i.test(String(i.task?.title ?? "")),
    );
    expect(spondTasks.length).toBeGreaterThanOrEqual(1);
    expect(spondTasks.every((t) => !t.task?.dueTime)).toBe(true);
  });

  it("kort Spond-oppgave uten kl., full frist med kl. i description → dueTime 20:00 (ikke kamptid)", async () => {
    const fullFrist =
      "Svar i Spond senest mandag 8. juni kl. 20:00 om barnet kan delta hele helgen eller ikke.";
    const result: AIAnalysisResult = {
      title: "Vårcupen",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "fredag",
          date: "5. juni 2026",
          highlights: ["18:40 Første kamp", "17:45 Oppmøte"],
          notes: ["Svar i Spond om deltakelse i cup"],
        }),
      ],
      location: null,
      description: fullFrist,
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
    })) as { items: Array<{ kind: string; task?: { dueTime?: string } }> };
    const spondTasks = bundle.items.filter(
      (i) => i.kind === "task" && /spond/i.test(String(i.task?.title ?? "")),
    );
    expect(spondTasks.length).toBeGreaterThanOrEqual(1);
    expect(spondTasks.some((t) => t.task?.dueTime === "20:00")).toBe(true);
    expect(spondTasks.every((t) => t.task?.dueTime !== "18:40" && t.task?.dueTime !== "17:45")).toBe(
      true,
    );
  });

  it("cup-lignende dag: kamp kl. 18:40 i program, Spond senest kl. 20:00 → dueTime 20:00", async () => {
    const spond = "Svar i Spond om du kan hjelpe, senest fredag kl. 20:00.";
    const result: AIAnalysisResult = {
      title: "Guttelaget – cup",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "fredag",
          date: "13. juni 2026",
          highlights: ["17:45 Oppmøte", "18:40 Første kamp", spond],
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
    })) as { items: Array<{ kind: string; task?: { dueTime?: string; date?: string } }> };
    const spondTasks = bundle.items.filter(
      (i) => i.kind === "task" && /spond/i.test(String(i.task?.title ?? "")),
    );
    expect(spondTasks.length).toBeGreaterThanOrEqual(1);
    const t = spondTasks.find((x) => x.task?.dueTime === "20:00");
    expect(t).toBeTruthy();
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
