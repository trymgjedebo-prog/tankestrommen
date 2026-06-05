import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { buildAnalysisCorpus, buildAnalysisEvidenceReport } from "@/lib/analysis-evidence";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

const FIXTURE = "cup_mixed_days_deadlines_relative_attendance.txt";

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

/** Typisk LLM-shape: narrative i råtekst, strukturerte highlights/notater per dag. */
function cupMixedDaysLiveLikeInput(): AIAnalysisResult {
  const raw = readFileSync(resolve("fixtures/tankestrom", FIXTURE), "utf8");
  return {
    title: "Cup helg 2026",
    schedule: [],
    scheduleByDay: [
      day({
        dayLabel: "fredag",
        date: "2026-06-12",
        time: "17:45",
        highlights: ["17:45 Oppmøte ved baneområdet", "18:40 Første kamp"],
        notes: ["Oppmøte 55 minutter før kampstart.", "Det er meldt ustabilt vær."],
      }),
      day({
        dayLabel: "lørdag",
        date: "2026-06-13",
        highlights: ["09:20 Første kamp", "15:10 Andre kamp"],
        notes: ["På lørdag ønsker vi oppmøte 45 minutter før hver kamp."],
      }),
      day({
        dayLabel: "søndag",
        date: "2026-06-14",
        highlights: [],
        notes: [
          "Eventuell kamp hvis laget går videre til A-sluttspill.",
          "Egen melding kommer når det er avklart.",
        ],
      }),
    ],
    location: null,
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

type EmbSeg = {
  date?: string | null;
  title?: string | null;
  start?: string | null;
  end?: string | null;
  timePrecision?: string;
  isConditional?: boolean;
  dayContent?: { highlights?: string[] };
};

type PortalEvent = {
  kind: string;
  event?: {
    title?: string;
    date?: string;
    start?: string | null;
    end?: string | null;
    metadata?: {
      embeddedSchedule?: EmbSeg[];
      isArrangementChild?: boolean;
      timePrecision?: string;
      isConditional?: boolean;
    };
  };
};

type PortalTask = {
  kind: string;
  task?: { title?: string; date?: string; dueTime?: string | null };
};

function embeddedSegments(bundle: Record<string, unknown>): EmbSeg[] {
  const items = bundle.items as PortalEvent[];
  const parent = items.find((i) => i.event?.metadata?.embeddedSchedule?.length);
  return parent?.event?.metadata?.embeddedSchedule ?? [];
}

function segmentForDay(emb: EmbSeg[], day: "fredag" | "lørdag" | "søndag"): EmbSeg | undefined {
  return emb.find((s) => new RegExp(day, "i").test(String(s.title ?? s.date ?? "")));
}

function highlightsOnSegment(seg: EmbSeg | undefined): string[] {
  return seg?.dayContent?.highlights ?? [];
}

function hhmmFromStart(start: string | null | undefined): string | null {
  if (!start?.trim()) return null;
  const m = /T(\d{2}):(\d{2})/.exec(start);
  if (m) return `${m[1]}:${m[2]}`;
  return /^\d{2}:\d{2}$/.test(start) ? start : null;
}

function highlightAt(hls: string[], hhmm: string): string | undefined {
  return hls.find((h) => h.startsWith(`${hhmm} `) || h.startsWith(`${hhmm}–`));
}

function corpusMentionsDay(text: string | null | undefined, day: string): boolean {
  if (!text) return false;
  return new RegExp(`\\b${day}\\b`, "i").test(text);
}

function corpusMentionsSpondDeadline(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\b(spond|senest|20:00)\b/i.test(text);
}

describe("cup day scoping regression (cup_mixed_days_deadlines_relative_attendance)", () => {
  it("portal: tider og frister holdes innen riktig dag", async () => {
    const input = cupMixedDaysLiveLikeInput();
    const bundle = (await toPortalBundle(input, "text", "text", true, {
      knownPersons: [],
    })) as Record<string, unknown>;
    const emb = embeddedSegments(bundle);
    expect(emb).toHaveLength(3);

    const fri = segmentForDay(emb, "fredag")!;
    const lor = segmentForDay(emb, "lørdag")!;
    const sun = segmentForDay(emb, "søndag")!;

    expect(fri.date).toBe("2026-06-12");
    expect(lor.date).toBe("2026-06-13");
    expect(sun.date).toBe("2026-06-14");

    const friHl = highlightsOnSegment(fri);
    expect(highlightAt(friHl, "17:45")).toMatch(/oppm[oø]te/i);
    expect(highlightAt(friHl, "18:40")).toMatch(/(første\s+kamp|kamp)/i);
    expect(friHl.join(" ")).not.toMatch(/\b20:00\b/);
    expect(highlightAt(friHl, "17:45")).not.toMatch(/kamp/i);

    const lorHl = highlightsOnSegment(lor);
    expect(highlightAt(lorHl, "08:35")).toMatch(/oppm[oø]te/i);
    expect(highlightAt(lorHl, "09:20")).toMatch(/(første\s+kamp|kamp)/i);
    expect(highlightAt(lorHl, "14:25")).toMatch(/oppm[oø]te/i);
    expect(highlightAt(lorHl, "15:10")).toMatch(/(andre\s+kamp|kamp)/i);
    expect(lorHl.join(" ")).not.toMatch(/\b17:45\b/);
    expect(lorHl.join(" ")).not.toMatch(/\b20:00\b/);

    const sunHl = highlightsOnSegment(sun);
    expect(sunHl.join(" ")).not.toMatch(/\b17:45\b/);
    expect(sunHl.join(" ")).not.toMatch(/\b09:20\b/);
    expect(sunHl.join(" ")).not.toMatch(/\b15:10\b/);
    expect(sunHl.join(" ")).not.toMatch(/\b20:00\b/);
    expect(sun?.isConditional ?? sun?.timePrecision === "date_only").toBeTruthy();
    expect(hhmmFromStart(sun.start)).toBeNull();

    const items = bundle.items as Array<PortalEvent | PortalTask>;
    const tasks = items.filter((i) => i.kind === "task") as PortalTask[];
    const spondTask = tasks.find((t) => /spond/i.test(t.task?.title ?? ""));
    expect(spondTask?.task?.date).toBe("2026-06-08");
    expect(spondTask?.task?.dueTime).toBe("20:00");
    for (const seg of [fri, lor, sun]) {
      for (const h of highlightsOnSegment(seg)) {
        expect(h).not.toMatch(/\b(spond|senest mandag)\b/i);
      }
    }
  });

  it("evidence: sourceQuote og durationEndFacts respekterer dag-eierskap", () => {
    const input = cupMixedDaysLiveLikeInput();
    const report = buildAnalysisEvidenceReport(buildAnalysisCorpus(input), input);

    const fri = report.perDay.find((d) => /fredag/i.test(String(d.dayLabel)))!;
    const lor = report.perDay.find((d) => /lørdag/i.test(String(d.dayLabel)))!;
    const sun = report.perDay.find((d) => /søndag/i.test(String(d.dayLabel)))!;

    for (const h of fri.highlights) {
      expect(h.sourceQuote).toBeTruthy();
      expect(corpusMentionsSpondDeadline(h.sourceQuote)).toBe(false);
      if (h.highlightText.includes("17:45")) {
        expect(corpusMentionsDay(h.sourceQuote, "fredag")).toBe(true);
      }
    }

    for (const h of lor.highlights) {
      expect(corpusMentionsDay(h.sourceQuote, "lørdag")).toBe(true);
      expect(h.sourceQuote).not.toMatch(/\bfredag\b.*17:45/i);
    }

    for (const h of sun.highlights) {
      if (h.highlightText.match(/\d{1,2}:\d{2}/)) {
        expect(["tentative", "unsupported", "needs_review"]).toContain(h.validation);
      }
    }

    const friFact = report.durationEndFacts?.find((f) => f.dayLabel === "fredag");
    const sunFact = report.durationEndFacts?.find((f) => f.dayLabel === "søndag");
    expect(friFact?.inferredEndTime).toBeNull();
    expect(sunFact?.validation).toBe("tentative");

    expect(
      report.confirmedFacts.some((f) => f.dayLabel === "søndag" && /17:45|09:20|15:10|20:00/.test(f.highlightText)),
    ).toBe(false);
  });
});
