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
  dayLabel?: string | null;
  start?: string | null;
  end?: string | null;
  endTimeSource?: string;
  inferredEndTime?: boolean;
  durationMinutes?: number | null;
  breakMinutes?: number | null;
  afterBufferMinutes?: number | null;
  activityDurationMinutes?: number | null;
  timePrecision?: string;
  isConditional?: boolean;
};

function embeddedSegments(bundle: Record<string, unknown>): EmbSeg[] {
  const items = bundle.items as Array<{
    kind: string;
    event?: { metadata?: { embeddedSchedule?: EmbSeg[]; cupProposalDebug?: { childEndTimeSources?: string[] } } };
  }>;
  const parent = items.find((i) => i.kind === "event" && i.event?.metadata?.embeddedSchedule?.length);
  return parent?.event?.metadata?.embeddedSchedule ?? [];
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

    expect(lor?.start).toBe("08:30");
    expect(lor?.end).toBe("15:55");
    expect(lor?.endTimeSource).toBe("computed_from_duration_and_aftertime");
    expect(lor?.inferredEndTime).toBe(true);
    expect(lor?.activityDurationMinutes ?? lor?.durationMinutes).toBe(45);
    expect(lor?.afterBufferMinutes ?? lor?.postEventBufferMinutes).toBe(30);

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
    expect(lorFact?.inferredEndTime).toBe("15:55");

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
