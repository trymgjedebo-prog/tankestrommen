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

type EmbeddedSeg = {
  dayLabel?: string;
  start?: string | null;
  timePrecision?: string;
  isConditional?: boolean;
  notes?: string;
  dayContent?: {
    highlights?: string[];
    generalNotes?: string[];
    uncertaintyNotes?: string[];
  };
};

type PortalItem = {
  kind: string;
  event?: {
    title?: string;
    date?: string;
    start?: string | null;
    metadata?: {
      embeddedSchedule?: EmbeddedSeg[];
      isArrangementParent?: boolean;
    };
  };
  task?: { date?: string; dueTime?: string; title?: string };
};

function embeddedSeg(items: PortalItem[], dayLabel: string): EmbeddedSeg | undefined {
  return parentEmbedded(items).find((s) => s.dayLabel === dayLabel);
}

function assertLorSaturdayContract(lor: EmbeddedSeg | undefined) {
  expect(lor).toBeDefined();
  expect(lor?.start).toMatch(/^08:35|^09:20/);
  expect(lor?.timePrecision).not.toBe("date_only");
  expect(lor?.isConditional).not.toBe(true);
  expect(lor?.dayContent?.highlights).toEqual(
    expect.arrayContaining([
      "08:35 Oppmøte før første kamp",
      "09:20 Første kamp",
      "14:25 Oppmøte før andre kamp",
      "15:10 Andre kamp",
    ]),
  );
  const notesBlob = [
    lor?.notes ?? "",
    ...(lor?.dayContent?.generalNotes ?? []),
    ...(lor?.dayContent?.uncertaintyNotes ?? []),
  ].join("\n");
  expect(notesBlob).not.toMatch(/sluttspill|søndag|sondag|frukt|medisin/i);
  expect(notesBlob).not.toMatch(/^nb:/im);
}

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

    assertLorSaturdayContract(embeddedSeg(items, "lørdag"));
    const fri = embeddedSeg(items, "fredag");
    const son = embeddedSeg(items, "søndag");
    expect(fri?.dayContent?.highlights).toEqual(expect.arrayContaining(["17:45 Oppmøte", "18:40 Første kamp"]));
    expect(son?.dayContent?.highlights ?? []).toHaveLength(0);
    expect(son?.timePrecision).toBe("date_only");
    expect(son?.isConditional).toBe(true);
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

  it("LLM partial 2-dagers scheduleByDay med 17:45 skal ikke blokkere full embeddedSchedule (live Frist 17:45)", async () => {
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
                time: "17:45",
                details: spondOnly,
                highlights: ["17:45 Oppmøte"],
                rememberItems: [],
                deadlines: [],
                notes: [],
              },
              {
                dayLabel: "lørdag",
                date: "2026-06-13",
                time: "09:20",
                details: null,
                highlights: ["09:20 Første kamp"],
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
    const parent = items.find(
      (i) => i.kind === "event" && i.event?.metadata?.isArrangementParent,
    );
    expect(parent).toBeDefined();
    expect(String(parent?.event?.start ?? "")).toBe("");
    expect(
      items.some(
        (i) =>
          i.kind === "task" &&
          i.task?.date === "2026-06-12" &&
          i.task?.dueTime === "17:45",
      ),
    ).toBe(false);

    assertLorSaturdayContract(embeddedSeg(items, "lørdag"));
    expect(embeddedSeg(items, "fredag")?.dayContent?.highlights).toEqual(
      expect.arrayContaining(["17:45 Oppmøte", "18:40 Første kamp"]),
    );
    expect(
      items.filter((i) => i.kind === "task").some((t) => t.task?.dueTime === "20:00"),
    ).toBe(true);
  });

  it("LLM 3-dagers junk-notater på lørdag skal ikke gjøre lørdag date_only/tentative når corpus har kamptider", async () => {
    const junkNotes = [
      "Betinget opplegg — avhengig av resultat eller tid som ikke er endelig.",
      "Møt 45 minutter før hver kamp",
      "Dersom laget går videre til A-sluttspill, blir det kamp søndag formiddag eller tidlig ettermiddag",
      "Endelig sluttspilltid kommer i appen når arrangøren publiserer oppsettet",
      "Det trengs to voksne som kan ta ansvar for frukt lørdag",
      "Gi beskjed hvis barnet bruker medisiner",
      "NB: Usikkert eller betinget opplegg",
    ];
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
                time: "17:45",
                details: null,
                highlights: ["17:45 Oppmøte"],
                rememberItems: [],
                deadlines: [],
                notes: [],
              },
              {
                dayLabel: "lørdag",
                date: "2026-06-13",
                time: "09:20",
                details: null,
                highlights: ["09:20 Første kamp"],
                rememberItems: [],
                deadlines: [],
                notes: junkNotes,
              },
              {
                dayLabel: "søndag",
                date: "2026-06-14",
                time: null,
                details: null,
                highlights: [],
                rememberItems: [],
                deadlines: [],
                notes: [],
              },
            ],
            location: null,
            description: fullSource,
            category: "cup",
            targetGroup: null,
            organizer: null,
            contactPerson: null,
            sourceUrl: null,
            confidence: 0.9,
            extractedText: { raw: fullSource, language: "no", confidence: 1 },
          },
          fullSource,
        ),
      )
    ).items as PortalItem[];

    assertLorSaturdayContract(embeddedSeg(items, "lørdag"));
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
