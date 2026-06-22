/**
 * Produksjonsnær test: faktisk `/api/analyze`-portal-bundle-output (via toPortalBundle).
 * Beviser at Spond-/svarfrist blir task med riktig dueTime + taskIntent, at fristtiden ikke
 * lekker som program-highlight, og at frivillige oppgaver klassifiseres som can_help.
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { parseStructuredPortalEventNotes } from "@/evals/portal-bundle-to-regression";
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

type Item = {
  kind: string;
  event?: { notes?: string };
  task?: { title?: string; dueTime?: string; taskIntent?: string };
};

async function portalItems(result: AIAnalysisResult): Promise<Item[]> {
  const b = (await toPortalBundle(result, "text", undefined, false, { knownPersons: [] })) as {
    items: Item[];
  };
  return b.items;
}

function baseResult(partial: Partial<AIAnalysisResult> & Pick<AIAnalysisResult, "title" | "scheduleByDay">): AIAnalysisResult {
  return {
    schedule: [],
    location: null,
    description: partial.description ?? "",
    category: "team_message" as AIAnalysisResult["category"],
    targetGroup: null,
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    extractedText: partial.extractedText ?? { raw: "", language: "no", confidence: 1 },
    ...partial,
  };
}

describe("produksjon (portal-bundle): Spond-frist + task-intent", () => {
  it("«Svar i Spond innen tirsdag kl. 20:00» → task dueTime 20:00 + taskIntent must_do, og 20:00 er IKKE program-highlight", async () => {
    const line = "Svar i Spond innen tirsdag kl. 20:00.";
    const items = await portalItems(
      baseResult({
        title: "Lørdagscup",
        description: line,
        extractedText: { raw: line, language: "no", confidence: 1 },
        scheduleByDay: [
          emptyDay({
            dayLabel: "lørdag",
            date: "13. juni 2026",
            highlights: ["09:20 Første kamp", "10:50 Andre kamp"],
            notes: [line],
          }),
        ],
      }),
    );

    const spond = items.find((i) => i.kind === "task" && /spond/i.test(i.task?.title ?? ""));
    expect(spond).toBeTruthy();
    expect(spond?.task?.dueTime).toBe("20:00");
    expect(spond?.task?.taskIntent).toBe("must_do");

    // Fristtiden 20:00 skal ikke ligge i program-highlights («Dagens innhold»); kamptider bevart.
    const ev = items.find((i) => i.kind === "event");
    const { highlights } = parseStructuredPortalEventNotes(ev?.event?.notes);
    const hl = highlights.join(" ");
    expect(hl).toContain("09:20");
    expect(hl).toContain("10:50");
    expect(hl).not.toContain("20:00");
  });

  it("«Kan noen kutte frukt? / Vi trenger noen som kan ta med frukt» → task med taskIntent can_help", async () => {
    const raw = "Kan noen kutte frukt? Vi trenger noen som kan ta med frukt.";
    const items = await portalItems(
      baseResult({
        title: "Lørdagscup",
        description: raw,
        extractedText: { raw, language: "no", confidence: 1 },
        scheduleByDay: [
          emptyDay({
            dayLabel: "lørdag",
            date: "13. juni 2026",
            highlights: ["09:20 Første kamp"],
            notes: ["Kan noen kutte frukt?", "Vi trenger noen som kan ta med frukt."],
          }),
        ],
      }),
    );

    const helpTask = items.find((i) => i.kind === "task" && i.task?.taskIntent === "can_help");
    expect(helpTask).toBeTruthy();
  });
});
