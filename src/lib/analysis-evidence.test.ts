import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAnalysisCorpus, buildAnalysisEvidenceReport } from "./analysis-evidence";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "fixtures", "tankestrom", name), "utf8");

function day(
  partial: Partial<DayScheduleEntry> & Pick<DayScheduleEntry, "dayLabel">,
): DayScheduleEntry {
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

describe("buildAnalysisEvidenceReport (Vårcup / Høstcup)", () => {
  it("Vårcup: fredag og lørdag får bekreftede highlights med sourceQuote", () => {
    const corpus = fixture("vaacup_original.txt");
    const result: AIAnalysisResult = {
      title: "Vårcupen 2026",
      schedule: [],
      scheduleByDay: [
        day({
          dayLabel: "fredag",
          date: "12. juni 2026",
          highlights: ["17:45 Oppmøte", "18:40 Første kamp"],
        }),
        day({
          dayLabel: "lørdag",
          date: "13. juni 2026",
          highlights: ["09:20 Første kamp", "15:10 Andre kamp"],
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
      extractedText: { raw: corpus, language: "no", confidence: 1 },
    };
    const report = buildAnalysisEvidenceReport(buildAnalysisCorpus(result), result);
    const fri = report.perDay.find((d) => /fredag/i.test(String(d.dayLabel)));
    expect(fri?.highlights.every((h) => h.sourceQuote && h.sourceSnippet && h.validation === "confirmed")).toBe(true);
    expect(fri?.highlights.some((h) => h.sourceQuote?.includes("17:45"))).toBe(true);
    const lor = report.perDay.find((d) => /lørdag/i.test(String(d.dayLabel)));
    expect(lor?.highlights.every((h) => h.sourceQuote && h.sourceSnippet && h.validation === "confirmed")).toBe(true);
  });

  it("Vårcup: søndag skal ikke kunne «låne» fredagens kampstart (18:40) som bevis", () => {
    const corpus = fixture("vaacup_original.txt");
    const result: AIAnalysisResult = {
      title: "Vårcupen 2026",
      schedule: [],
      scheduleByDay: [
        day({
          dayLabel: "søndag",
          date: "14. juni 2026",
          highlights: ["18:40 Første kamp"],
          notes: [
            "Foreløpig kampoppsett er at vi spiller fredag kl. 18:40. Dersom vi går videre til A-sluttspill, blir det kamp enten søndag formiddag eller tidlig ettermiddag.",
          ],
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
      extractedText: { raw: corpus, language: "no", confidence: 1 },
    };
    const report = buildAnalysisEvidenceReport(buildAnalysisCorpus(result), result);
    const sun = report.perDay.find((d) => /søndag/i.test(String(d.dayLabel)));
    expect(sun?.highlights[0]?.validation).toBe("unsupported");
    expect(report.unsupportedCandidates.some((u) => u.highlightText.includes("18:40"))).toBe(true);
  });

  it("Høstcup: lørdagstider matcher kilde; søndag uten feilaktig lånt tid fra fredag", () => {
    const corpus = fixture("hostcup_handball.txt");
    const result: AIAnalysisResult = {
      title: "Høstcupen håndball 2026",
      schedule: [],
      scheduleByDay: [
        day({
          dayLabel: "fredag",
          date: "18. september 2026",
          highlights: ["16:40 Oppmøte", "17:30 Første kamp"],
        }),
        day({
          dayLabel: "lørdag",
          date: "19. september 2026",
          highlights: ["09:15 Første kamp", "14:40 Andre kamp"],
        }),
        day({
          dayLabel: "søndag",
          date: "20. september 2026",
          highlights: ["17:30 Kamp"],
          notes: [],
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
      extractedText: { raw: corpus, language: "no", confidence: 1 },
    };
    const report = buildAnalysisEvidenceReport(buildAnalysisCorpus(result), result);
    const lor = report.perDay.find((d) => /lørdag/i.test(String(d.dayLabel)));
    expect(lor?.highlights.every((h) => h.validation === "confirmed" && Boolean(h.sourceQuote) && Boolean(h.sourceSnippet))).toBe(
      true,
    );
    const sun = report.perDay.find((d) => /søndag/i.test(String(d.dayLabel)));
    expect(sun?.highlights[0]?.validation).toBe("unsupported");
  });

  it("Høstcup: søndagsvindu med søndagskamp i teksten kan bekreftes når label matcher", () => {
    const corpus = fixture("hostcup_handball.txt");
    const result: AIAnalysisResult = {
      title: "Høstcupen håndball 2026",
      schedule: [],
      scheduleByDay: [
        day({
          dayLabel: "søndag",
          date: "20. september 2026",
          highlights: ["10:00 Søndagskamp"],
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
      extractedText: { raw: corpus, language: "no", confidence: 1 },
    };
    const report = buildAnalysisEvidenceReport(buildAnalysisCorpus(result), result);
    const h = report.perDay[0]?.highlights[0];
    expect(h?.sourceQuote?.toLowerCase()).toContain("10:00");
    expect(["confirmed", "needs_review", "tentative"]).toContain(h?.validation ?? "");
  });
});
