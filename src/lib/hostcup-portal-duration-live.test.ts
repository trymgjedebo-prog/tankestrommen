import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { buildAnalysisCorpus, buildAnalysisEvidenceReport } from "@/lib/analysis-evidence";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

/** Typisk live LLM-schedule: tider i highlights, varighet/ettertid kun i råtekst. */
function hostcupLiveLikeResult(): AIAnalysisResult {
  const raw = readFileSync(
    resolve("fixtures/tankestrom/hostcup_duration_endtime_rich.txt"),
    "utf8",
  );
  const day = (
    partial: Partial<DayScheduleEntry> & Pick<DayScheduleEntry, "dayLabel">,
  ): DayScheduleEntry => ({
    dayLabel: partial.dayLabel,
    date: partial.date ?? null,
    time: partial.time ?? null,
    details: partial.details ?? null,
    highlights: partial.highlights ?? [],
    rememberItems: partial.rememberItems ?? [],
    deadlines: partial.deadlines ?? [],
    notes: partial.notes ?? [],
  });

  return {
    title: "Høstcupen håndball 2026",
    schedule: [],
    scheduleByDay: [
      day({
        dayLabel: "fredag",
        date: "2026-09-18",
        time: "16:40",
        highlights: ["16:40 Oppmøte", "17:30 Første kamp"],
        notes: [
          "Møt ferdig skiftet 50 minutter før kampstart.",
          "Mobiltelefoner skal ligge i bagen under kampen.",
        ],
      }),
      day({
        dayLabel: "lørdag",
        date: "2026-09-19",
        time: "08:30",
        highlights: [
          "08:30 Oppmøte før første kamp",
          "09:15 Første kamp",
          "13:55 Oppmøte før andre kamp",
          "14:40 Andre kamp",
        ],
        notes: ["Oppmøte 45 minutter før hver kamp.", "Kampene har samme spilletid som fredag."],
      }),
      day({
        dayLabel: "søndag",
        date: "2026-09-20",
        highlights: ["A-sluttspill: første kamp mellom kl. 10:00 og 12:00 (foreløpig)"],
        notes: [
          "Foreløpig sluttspillopplegg.",
          "B-sluttspill etter lunsj dersom vi havner der.",
          "Detaljert søndagsprogram kommer senere.",
        ],
      }),
    ],
    location: "Nadderud Arena",
    description: raw,
    category: "cup",
    targetGroup: null,
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    extractedText: { raw, language: "no", confidence: 1 },
  };
}

type EmbSeg = {
  date?: string;
  dayLabel?: string | null;
  title?: string | null;
  start?: string | null;
  end?: string | null;
  endTimeSource?: string;
  inferredEndTime?: boolean;
  durationMinutes?: number | null;
  breakMinutes?: number | null;
  afterBufferMinutes?: number | null;
  postEventBufferMinutes?: number | null;
  activityDurationMinutes?: number | null;
  timePrecision?: string;
  isConditional?: boolean;
  timeWindow?: unknown;
  dayContent?: { highlights?: string[] };
  notes?: string;
};

function embeddedSegments(bundle: Record<string, unknown>): EmbSeg[] {
  const items = bundle.items as Array<{
    kind: string;
    event?: { metadata?: { embeddedSchedule?: EmbSeg[]; cupProposalDebug?: { childEndTimeSources?: string[] } } };
  }>;
  const parent = items.find((i) => i.kind === "event" && i.event?.metadata?.embeddedSchedule?.length);
  return parent?.event?.metadata?.embeddedSchedule ?? [];
}

function embByDayLabel(emb: EmbSeg[], label: string): EmbSeg | undefined {
  return emb.find((s) => new RegExp(label, "i").test(String(s.dayLabel ?? s.title ?? "")));
}

function highlightTexts(seg: EmbSeg | undefined): string[] {
  return seg?.dayContent?.highlights ?? [];
}

describe("Høstcup live portal shape (toPortalBundle)", () => {
  it("fredag/lørdag: duration 45, buffer 30, inferred end på embeddedSchedule", async () => {
    const bundle = await toPortalBundle(hostcupLiveLikeResult(), "text", "text", true, {
      knownPersons: [],
    });
    const emb = embeddedSegments(bundle);
    expect(emb).toHaveLength(3);

    const fri = emb.find((s) => /fredag/i.test(String(s.dayLabel ?? s.title ?? "")));
    const lor = emb.find((s) => /lørdag/i.test(String(s.dayLabel ?? s.title ?? "")));
    const sun = emb.find((s) => /søndag/i.test(String(s.dayLabel ?? s.title ?? "")));

    expect(fri?.start).toBe("16:40");
    expect(fri?.end).toBe("18:45");
    expect(fri?.endTimeSource).toBe("computed_from_duration_and_aftertime");
    expect(fri?.inferredEndTime).toBe(true);
    expect(fri?.activityDurationMinutes ?? fri?.durationMinutes).toBe(45);
    expect(fri?.breakMinutes).toBe(5);
    expect(fri?.afterBufferMinutes ?? fri?.postEventBufferMinutes).toBe(30);
    expect(fri?.timePrecision).toBe("exact");
    expect(fri?.timeWindow).toBeUndefined();
    const friContent = (
      bundle.items as Array<{
        event?: { metadata?: { embeddedSchedule?: Array<{ dayContent?: { highlights?: string[] } }> } };
      }>
    )
      .flatMap((i) => i.event?.metadata?.embeddedSchedule ?? [])
      .find((s) => /fredag/i.test(JSON.stringify(s)));
    const friHl = (friContent?.dayContent?.highlights ?? []).join(" ");
    expect(friHl).not.toMatch(/10:00[–-]12:00/);
    expect(JSON.stringify(friContent?.dayContent ?? {})).not.toMatch(/10:00[–-]12:00/);

    expect(lor?.start).toBe("08:30");
    expect(lor?.end).toBe("15:55");
    expect(lor?.endTimeSource).toBe("computed_from_duration_and_aftertime");
    expect(lor?.inferredEndTime).toBe(true);
    expect(lor?.activityDurationMinutes ?? lor?.durationMinutes).toBe(45);
    expect(lor?.afterBufferMinutes ?? lor?.postEventBufferMinutes).toBe(30);
    expect(lor?.timeWindow).toBeUndefined();
    expect(lor?.endTimeSource).toBe("computed_from_duration_and_aftertime");

    expect(sun?.end).toBeNull();
    expect(sun?.isConditional).toBe(true);
    expect(sun?.timePrecision).toBe("date_only");

    const debug = (
      bundle.items as Array<{ event?: { metadata?: { cupProposalDebug?: { childEndTimeSources?: string[] } } } }>
    )
      .map((i) => i.event?.metadata?.cupProposalDebug?.childEndTimeSources)
      .find(Boolean);
    expect(debug?.[0]).toBe("computed_from_duration_and_aftertime");
    expect(debug?.[1]).toBe("computed_from_duration_and_aftertime");
    expect(debug?.[2]).toBe("missing_or_unreadable");

    const childEvents = (
      bundle.items as Array<{
        kind: string;
        event?: { end?: string | null; metadata?: { endTimeSource?: string; isArrangementChild?: boolean } };
      }>
    ).filter((i) => i.kind === "event" && i.event?.metadata?.isArrangementChild);
    const friChild = childEvents.find(
      (c) => c.event?.metadata?.endTimeSource === "computed_from_duration_and_aftertime",
    );
    expect(friChild?.event?.end).toMatch(/18:45/);
    expect(friChild?.event?.metadata?.endTimeSource).toBe("computed_from_duration_and_aftertime");
  });

  it("Høstcup day-scoping: embeddedSchedule, Spond task-only, fredag oppmøte, søndag tentative", async () => {
    const bundle = await toPortalBundle(hostcupLiveLikeResult(), "text", "text", true, {
      knownPersons: [],
    });
    const emb = embeddedSegments(bundle);
    const embDates = emb.map((s) => s.date).filter(Boolean);
    expect(embDates).toEqual(["2026-09-18", "2026-09-19", "2026-09-20"]);
    expect(embDates).not.toContain("2026-09-08");
    expect(JSON.stringify(emb)).not.toMatch(/2026-09-08/);

    const tasks = (bundle.items as Array<{ kind: string; task?: { date?: string; dueTime?: string } }>).filter(
      (i) => i.kind === "task",
    );
    const spondTask = tasks.find(
      (t) => t.task?.date === "2026-09-08" && t.task?.dueTime === "21:00",
    );
    expect(spondTask).toBeDefined();
    expect(tasks.filter((t) => t.task?.date === "2026-09-08")).toHaveLength(1);

    const fri = embByDayLabel(emb, "fredag");
    const friHl = highlightTexts(fri);
    expect(friHl.some((h) => /^16:40\s+Oppmøte/i.test(h))).toBe(true);
    expect(friHl.some((h) => /^17:30\s+Første kamp/i.test(h))).toBe(true);
    expect(friHl.some((h) => /16:45/.test(h))).toBe(false);
    const friPreMatchOppmote = friHl.filter(
      (h) => /^(\d{2}:\d{2})\s+Oppmøte/i.test(h) && /^16:/.test(h),
    );
    expect(friPreMatchOppmote.length).toBeLessThanOrEqual(1);

    const lor = embByDayLabel(emb, "lørdag");
    const lorHl = highlightTexts(lor);
    expect(lorHl.some((h) => /^13:55\s+Oppmøte/i.test(h) || /^13:55\s+Oppmøte\s+før/i.test(h))).toBe(true);

    const sun = embByDayLabel(emb, "søndag");
    expect(sun?.timePrecision).toBe("date_only");
    expect(sun?.isConditional).toBe(true);
    expect(sun?.start).toBeNull();
    expect(highlightTexts(sun).some((h) => /^\d{2}:\d{2}\s+(?!.*foreløpig)/i.test(h))).toBe(false);

    const sunNotes = sun?.notes ?? "";
    expect(sunNotes.length).toBeLessThan(220);
    const conditionalPhrases = sunNotes.match(/\b(avhenger|betinget|ikke\s+endelig|foreløpig)\b/gi) ?? [];
    expect(conditionalPhrases.length).toBeLessThanOrEqual(3);

    const sunChild = (
      bundle.items as Array<{
        kind: string;
        event?: { date?: string; start?: string | null; notes?: string; metadata?: { isArrangementChild?: boolean } };
      }>
    ).find(
      (i) =>
        i.kind === "event" &&
        i.event?.metadata?.isArrangementChild &&
        i.event?.date === "2026-09-20",
    );
    expect(sunChild?.event?.start).toBeNull();
    expect(sunChild?.event?.notes ?? "").not.toMatch(/^NB:\s*Usikkert eller betinget opplegg/i);
  });

  it("evidence: søndag 10:00–12:00 ikke i confirmedFacts; durationEndFacts riktig", () => {
    const result = hostcupLiveLikeResult();
    const corpus = buildAnalysisCorpus(result);
    const report = buildAnalysisEvidenceReport(corpus, result);

    const friFact = report.durationEndFacts?.find((f) => f.dayLabel === "fredag");
    const lorFact = report.durationEndFacts?.find((f) => f.dayLabel === "lørdag");
    const sunFact = report.durationEndFacts?.find((f) => f.dayLabel === "søndag");

    expect(friFact?.activityDurationMinutes).toBe(45);
    expect(friFact?.breakMinutes).toBe(5);
    expect(friFact?.afterBufferMinutes).toBe(30);
    expect(friFact?.inferredEndTime).toBe("18:45");
    expect(friFact?.endTimeSource).toBe("computed_from_duration_and_aftertime");

    expect(lorFact?.activityDurationMinutes).toBe(45);
    expect(lorFact?.afterBufferMinutes).toBe(30);
    expect(lorFact?.inferredEndTime).toBe("15:55");
    expect(lorFact?.endTimeSource).toBe("computed_from_duration_and_aftertime");

    expect(sunFact?.inferredEndTime).toBeNull();
    expect(sunFact?.validation).toBe("tentative");

    const confirmedTimes = (report.confirmedFacts ?? []).map((f) => f.highlightText).join(" ");
    expect(confirmedTimes).not.toMatch(/10:00.*12:00|mellom kl\.?\s*10:00/i);
    expect(
      (report.tentativeFacts ?? []).some((f) =>
        /10:00|mellom/i.test(f.highlightText),
      ),
    ).toBe(true);
  });
});
