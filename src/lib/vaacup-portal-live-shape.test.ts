import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { ensureTextAnalysisSourceExcerpt } from "@/lib/ai/analyze-image";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult } from "@/lib/types";

/** Live preview path: kun råtekst, tom scheduleByDay (degradert LLM / API uten struktur). */
function vaacupRawTextOnlyInput(): AIAnalysisResult {
  const raw = readFileSync(resolve("fixtures/tankestrom/vaacup_original.txt"), "utf8");
  return {
    title: "Vårcupen 2026",
    schedule: [],
    scheduleByDay: [],
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

type PortalItem = {
  kind: string;
  event?: {
    title?: string;
    date?: string;
    start?: string | null;
    metadata?: { embeddedSchedule?: Array<{ dayLabel?: string; dayContent?: { highlights?: string[] } }>; isArrangementParent?: boolean };
  };
  task?: { date?: string; dueTime?: string; title?: string };
};

async function portalBundle(input: AIAnalysisResult) {
  return (await toPortalBundle(input, "text", "text", true, { knownPersons: [] })) as Record<string, unknown>;
}

function parentEmbedded(items: PortalItem[]) {
  const parent = items.find((i) => i.kind === "event" && (i.event?.metadata?.embeddedSchedule?.length ?? 0) >= 3);
  return parent?.event?.metadata?.embeddedSchedule ?? [];
}

describe("Vårcup live portal shape (raw text only)", () => {
  it("skal gi arrangement med embeddedSchedule + separat Spond-task, ikke task-only", async () => {
    const input = vaacupRawTextOnlyInput();
    expect(input.scheduleByDay).toHaveLength(0);

    const items = (await portalBundle(input)).items as PortalItem[];

    expect(items.length).toBeGreaterThan(1);
    expect(items.some((i) => i.kind === "event" && (i.event?.metadata?.embeddedSchedule?.length ?? 0) >= 3)).toBe(
      true,
    );
    const tasks = items.filter((i) => i.kind === "task");
    expect(tasks.some((t) => t.task?.date === "2026-06-08" && t.task?.dueTime === "20:00")).toBe(true);
    expect(items.filter((i) => i.kind === "task").length).toBeLessThan(items.length);

    const emb = parentEmbedded(items);
    const fri = emb.find((s) => s.dayLabel === "fredag");
    const lor = emb.find((s) => s.dayLabel === "lørdag");
    const son = emb.find((s) => s.dayLabel === "søndag");
    expect(fri?.dayContent?.highlights).toEqual(expect.arrayContaining(["17:45 Oppmøte", "18:40 Første kamp"]));
    expect(lor?.dayContent?.highlights).toEqual(
      expect.arrayContaining([
        "08:35 Oppmøte før første kamp",
        "09:20 Første kamp",
        "14:25 Oppmøte før andre kamp",
        "15:10 Andre kamp",
      ]),
    );
    expect(son?.dayContent?.highlights ?? []).toHaveLength(0);
    expect(items.some((i) => i.kind === "event" && i.event?.metadata?.isArrangementParent)).toBe(true);
    expect(
      items.some(
        (i) =>
          i.kind === "event" &&
          i.event?.date === "2026-06-12" &&
          String(i.event?.start ?? "").endsWith("T20:00:00"),
      ),
    ).toBe(false);
  });
});

/** Live-lignende feil når LLM kollapser til Spond-linje uten kamptider i corpus. */
describe("Vårcup live-degraded portal shape", () => {
  const fullSource = readFileSync(resolve("fixtures/tankestrom/vaacup_original.txt"), "utf8");
  const spondOnly =
    "Vårcupen 2026\nSvar i Spond senest mandag 8. juni kl. 20:00 om barnet kan delta hele helgen eller ikke.";

  it("corpus uten kamptider skal ikke bli task-only", async () => {
    const items = (
      await portalBundle(
        ensureTextAnalysisSourceExcerpt(
          {
            title: "Vårcupen 2026",
            schedule: [],
            scheduleByDay: [],
            location: null,
            description: spondOnly,
            category: "task",
            targetGroup: null,
            organizer: null,
            contactPerson: null,
            sourceUrl: null,
            confidence: 0.9,
            extractedText: { raw: spondOnly, language: "no", confidence: 1 },
          },
          fullSource,
        ),
      )
    ).items as PortalItem[];

    expect(items.filter((i) => i.kind === "task").length).toBeLessThan(items.length);
    expect(parentEmbedded(items).length).toBeGreaterThanOrEqual(3);
  });

  it("LLM scheduleByDay med 20:00 på cup-fredag skal ikke gi enkelt-event start 20:00 uten embeddedSchedule", async () => {
    const items = (
      await portalBundle(
        ensureTextAnalysisSourceExcerpt(
          {
            title: "Vårcupen 2026",
            schedule: [],
            scheduleByDay: [
              {
                dayLabel: "fredag",
                date: "2026-06-12",
                time: "20:00",
                details: spondOnly,
                highlights: ["20:00 Svar i Spond"],
                rememberItems: [],
                deadlines: [],
                notes: [],
              },
            ],
            location: null,
            description: spondOnly,
            category: "cup",
            targetGroup: null,
            organizer: null,
            contactPerson: null,
            sourceUrl: null,
            confidence: 0.9,
            extractedText: { raw: spondOnly, language: "no", confidence: 1 },
          },
          fullSource,
        ),
      )
    ).items as PortalItem[];

    expect(parentEmbedded(items).length).toBeGreaterThanOrEqual(3);
    expect(items.some((i) => i.kind === "event" && /T20:00:00/.test(String(i.event?.start ?? "")))).toBe(
      false,
    );
    expect(items.filter((i) => i.kind === "task").length).toBeLessThanOrEqual(1);
  });
});
