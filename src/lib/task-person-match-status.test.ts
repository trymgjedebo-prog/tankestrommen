/**
 * Kontrakt: overlay→task-items BÆRER personMatchStatus i bundle-output (paritet med events).
 * Default "not_specified" når ingen children sendes; applyChildSelectionToItems stempler "matched"
 * på ekte overlay-task-items. Beviser at feltet faktisk når Foreldre-Appen.
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { applyChildSelectionToItems } from "@/lib/child-selection";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

function day(dayLabel: string, details: string): DayScheduleEntry {
  return { dayLabel, date: null, time: null, details, highlights: [], rememberItems: [], deadlines: [], notes: [] };
}

function overlayAplan(): AIAnalysisResult {
  return {
    title: "Ukeplan 2STA uke 24", // «ukeplan» + ukenummer + klassekode → aktivitetsplan-overlay
    schedule: [],
    scheduleByDay: [
      day("mandag", "Tysk: skriftlig tyskprøve. Lekse: les side 40-42."),
      day("tirsdag", "Matematikk: innlevering av oppgaver på Its. Lekse: oppgave 3-5."),
    ],
    location: null,
    description: "2STA 2STB. Ukeplan med lekser og prøver.",
    category: "school_week" as AIAnalysisResult["category"],
    targetGroup: "2STA",
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    extractedText: {
      raw: "Ukeplan 2STA uke 24. Mandag: skriftlig tyskprøve. Lekse: les side 40-42. Tirsdag: innlevering matematikk.",
      language: "no",
      confidence: 1,
    },
  };
}

type Item = { kind?: string; task?: { personId?: unknown; personMatchStatus?: unknown } };

describe("kontrakt: overlay-task-items bærer personMatchStatus", () => {
  it("toPortalBundle → bygger overlay, task-items har personMatchStatus default 'not_specified'", async () => {
    const bundle = (await toPortalBundle(overlayAplan(), "text", undefined, false, {
      knownPersons: [],
    })) as { schoolWeekOverlayProposal?: unknown; items: unknown[] };

    expect(Boolean(bundle.schoolWeekOverlayProposal)).toBe(true); // overlay-stien tatt
    const tasks = (bundle.items as Item[]).filter((i) => i.kind === "task");
    expect(tasks.length).toBeGreaterThan(0); // overlay flatet til task-forslag
    for (const t of tasks) {
      expect(t.task!.personMatchStatus).toBe("not_specified"); // feltet ER i bundle-output (default)
    }
  });

  it("applyChildSelectionToItems stempler 'matched' på ekte overlay-task-items", async () => {
    const bundle = (await toPortalBundle(overlayAplan(), "text", undefined, false, {
      knownPersons: [],
    })) as { items: unknown[] };
    const items = bundle.items;

    applyChildSelectionToItems(items, { personId: "p-ida", status: "matched" });

    const tasks = (items as Item[]).filter((i) => i.kind === "task");
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) {
      expect(t.task!.personId).toBe("p-ida");
      expect(t.task!.personMatchStatus).toBe("matched");
    }
  });
});
