import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { ensureTextAnalysisSourceExcerpt } from "@/lib/ai/analyze-image";
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

describe("Ikke-cup: aktivitetsvindu (time_window) i portal-metadata og highlights", () => {
  it("dugnad med «mellom kl. … og …» i detaljer utvider highlight til 10:00–12:00 og setter time_window", async () => {
    const result: AIAnalysisResult = {
      title: "Foreldregruppa – juni",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "lørdag",
          date: "14. juni 2026",
          details: "Vi trenger hjelp til dugnad mellom kl. 10:00 og 12:00. Ta med hansker.",
          highlights: ["10:00 Dugnad"],
          notes: [],
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
    })) as {
      items: Array<{ kind: string; event?: { start?: string | null; end?: string | null; metadata?: { timePrecision?: string } } }>;
    };
    const ev = bundle.items.find((i) => i.kind === "event");
    expect(ev?.event?.metadata?.timePrecision).toBe("time_window");
    expect(ev?.event?.start).toMatch(/T10:00:00/);
    expect(ev?.event?.end).toMatch(/T12:00:00/);
    const { highlights } = parseStructuredPortalEventNotes(ev?.event?.notes);
    expect(highlights.some((h) => /^10:00[–-]12:00\s+Dugnad/i.test(h))).toBe(true);
  });

  it("én starttid uten vindu-formulering → start_only (ikke time_window)", async () => {
    const result: AIAnalysisResult = {
      title: "Guttelaget – trening uke 24",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "tirsdag",
          date: "10. juni 2026",
          details: null,
          highlights: ["18:30 Trening på kunstgress"],
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
      items: Array<{ kind: string; event?: { metadata?: { timePrecision?: string } } }>;
    };
    const ev = bundle.items.find((i) => i.kind === "event");
    expect(ev?.event?.metadata?.timePrecision).toBe("start_only");
  });

  it("kilde med mellom-vindu slås inn når modell-raw bare har urelatert «mellom» (ikke tidsvindu)", async () => {
    const source = [
      "Foreldregruppa – våravslutning",
      "Lørdag 14. juni 2026: Dugnad på klubbhuset mellom kl. 10:00 og 12:00.",
      "Gi beskjed i Spond.",
    ].join("\n");
    let result: AIAnalysisResult = {
      title: "Foreldregruppa – våravslutning",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "lørdag",
          date: "14. juni 2026",
          details: null,
          highlights: ["10:00 Dugnad"],
          notes: [],
        }),
      ],
      location: null,
      description: "Kort oppsummering uten klokkeslett-vindu.",
      category: "parent_meeting_workday",
      targetGroup: null,
      organizer: null,
      contactPerson: null,
      sourceUrl: null,
      confidence: 0.9,
      extractedText: {
        raw: "Gi beskjed mellom venner i gruppa.",
        language: "no",
        confidence: 1,
      },
    };
    result = ensureTextAnalysisSourceExcerpt(result, source);
    const bundle = (await toPortalBundle(result, "text", undefined, false, {
      knownPersons: [],
    })) as {
      items: Array<{ kind: string; event?: { start?: string | null; end?: string | null; metadata?: { timePrecision?: string } } }>;
    };
    const ev = bundle.items.find((i) => i.kind === "event");
    expect(ev?.event?.metadata?.timePrecision).toBe("time_window");
    expect(ev?.event?.start).toMatch(/T10:00:00/);
    expect(ev?.event?.end).toMatch(/T12:00:00/);
    const { highlights } = parseStructuredPortalEventNotes(ev?.event?.notes);
    expect(highlights.some((h) => /^10:00[–-]12:00\s+Dugnad/i.test(h))).toBe(true);
  });

  it("Spond svar-frist er ikke program-highlight (trening forblir start_only)", async () => {
    const result: AIAnalysisResult = {
      title: "Guttelaget – beskjed uke 42",
      schedule: [],
      scheduleByDay: [
        emptyDay({
          dayLabel: "fredag",
          date: "7. november 2026",
          details: "Oppmøte kl. 17:45. Felles trening kl. 18:30.",
          highlights: [
            "18:30 Trening på banen",
            "Svar i Spond om barnet kan være med, senest torsdag 6. november (sett frist i Spond).",
          ],
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
      items: Array<{ kind: string; event?: { metadata?: { timePrecision?: string } } }>;
    };
    const ev = bundle.items.find((i) => i.kind === "event");
    expect(ev?.event?.metadata?.timePrecision).toBe("start_only");
    const { highlights } = parseStructuredPortalEventNotes(ev?.event?.notes);
    const joined = highlights.join("\n").toLowerCase();
    expect(joined.includes("spond")).toBe(false);
    expect(joined.includes("senest")).toBe(false);
  });
});
