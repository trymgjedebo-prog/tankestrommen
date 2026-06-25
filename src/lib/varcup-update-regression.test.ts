/**
 * Regresjon: live-test av en OPPDATERT Vårcupen-melding mot eksisterende kalenderhendelse.
 * Tester faktisk portal-bundle-output (toPortalBundle) som Foreldre-Appen konsumerer.
 *
 * Dekker (PR fix/varcup-update-parser-regression):
 *  - arrangement/event-tittel renses for meldingsoverskrift («Oppdatert info om …»)
 *  - flyttede kamper: gammel tid (15:10, 18:40) blir ikke program; ny tid får riktig kamp-indeks
 *  - ingen endringsspråk / dangling «kl.» som kalenderlabel
 *  - Spond-frist blir task/dueTime, ikke søndagsprogram/oppmøte
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

const RAW = readFileSync(join(process.cwd(), "fixtures", "tankestrom", "varcup_update_2026.txt"), "utf8");

function day(p: Partial<DayScheduleEntry> & Pick<DayScheduleEntry, "dayLabel">): DayScheduleEntry {
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

type Seg = {
  date?: string;
  title?: string;
  isConditional?: boolean;
  start?: string | null;
  dayContent?: { highlights?: string[] };
};
type Item = {
  kind: string;
  event?: { title?: string; metadata?: { arrangementCoreTitle?: string; embeddedSchedule?: Seg[] } };
  task?: { title?: string; date?: string; dueTime?: string; taskIntent?: string };
};

async function buildBundle(): Promise<Item[]> {
  const result: AIAnalysisResult = {
    title: "Oppdatert info om Vårcupen 2026",
    schedule: [],
    scheduleByDay: [
      day({
        dayLabel: "fredag",
        date: "12. juni 2026",
        highlights: ["17:15 Oppmøte", "18:10 Kamp"],
        notes: ["Fredagskampen er flyttet fra kl. 18:40 til kl. 18:10.", "Oppmøte fredag blir kl. 17:15 ved baneområdet."],
      }),
      day({
        dayLabel: "lørdag",
        date: "13. juni 2026",
        highlights: ["08:35 Oppmøte", "09:20 Kamp", "14:55 Oppmøte", "15:40 Kamp"],
        notes: ["Kampen som tidligere var satt opp kl. 15:10 er flyttet til kl. 15:40.", "Oppmøte 45 minutter før hver kamp."],
      }),
      day({
        dayLabel: "søndag",
        date: "14. juni 2026",
        highlights: ["09:45 Oppmøte", "10:30 Kvartfinale"],
        notes: [
          "Vi spiller kvartfinale søndag kl. 10:30 på bane 7. Dersom vi vinner blir det semifinale søndag kl. 13:20. En eventuell finale spilles søndag kl. 15:00.",
          "Spond-fristen gjelder fortsatt, men de som ennå ikke har svart må svare senest onsdag 10. juni kl. 18:00.",
        ],
      }),
    ],
    location: "Ekeberg idrettsanlegg",
    description: RAW,
    category: "team_message" as AIAnalysisResult["category"],
    targetGroup: "G12",
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    extractedText: { raw: RAW, language: "no", confidence: 1 },
  };
  const bundle = (await toPortalBundle(result, "text", undefined, false, { knownPersons: [] })) as {
    items: Item[];
  };
  return bundle.items;
}

function parentEvent(items: Item[]): Item | undefined {
  return items.find((i) => i.kind === "event" && (i.event?.metadata?.embeddedSchedule?.length ?? 0) > 0);
}
function seg(items: Item[], day: "fredag" | "lørdag" | "søndag"): Seg | undefined {
  const emb = parentEvent(items)?.event?.metadata?.embeddedSchedule ?? [];
  return emb.find((s) => new RegExp(day, "i").test(String(s.title ?? "")));
}
function hl(items: Item[], day: "fredag" | "lørdag" | "søndag"): string {
  return (seg(items, day)?.dayContent?.highlights ?? []).join(" | ");
}

describe("Vårcupen-oppdatering: portal-bundle regresjon", () => {
  it("arrangement/event-tittel er ren kjernetittel, ikke meldingsoverskrift", async () => {
    const items = await buildBundle();
    const parent = parentEvent(items);
    expect(parent?.event?.metadata?.arrangementCoreTitle).toBe("Vårcupen 2026");
    expect(parent?.event?.title).toBe("Vårcupen 2026");
    for (const i of items) {
      const t = i.event?.title ?? "";
      expect(t.toLowerCase()).not.toContain("oppdatert info");
    }
  });

  it("fredag: oppmøte 17:15 + kamp 18:10, ingen gammel tid 18:40", async () => {
    const items = await buildBundle();
    const h = hl(items, "fredag");
    expect(h).toContain("17:15 Oppmøte");
    expect(h).toContain("18:10");
    expect(h).not.toContain("18:40");
  });

  it("lørdag: 15:40 er «Andre kamp», ingen phantom 15:10, ingen endringsspråk/dangling kl.", async () => {
    const items = await buildBundle();
    const h = hl(items, "lørdag");
    expect(h).toContain("09:20");
    expect(h).toMatch(/15:40\s+(Andre kamp|Kamp 2)/);
    expect(h).not.toContain("15:10");
    expect(h).not.toContain("flyttet til");
    expect(h).not.toContain("satt opp");
    // Ingen hengende «kl.» i labels.
    expect(h).not.toMatch(/\bkl\.\s/);
  });

  it("søndag: kvartfinale 10:30, ingen 18:00-oppmøte, ingen Spond-frist som program-highlight", async () => {
    const items = await buildBundle();
    const h = hl(items, "søndag");
    expect(h).toContain("10:30 Kvartfinale");
    expect(h).not.toContain("18:00");
    expect(h.toLowerCase()).not.toContain("spond");
    expect(h.toLowerCase()).not.toContain("frist");
  });

  it("søndag: betinget semifinale/finale får «Mulig …»-label, ikke generisk kampindeks", async () => {
    const items = await buildBundle();
    const h = hl(items, "søndag");
    // Positivt: innholdslabels for sluttspill.
    expect(h).toContain("10:30 Kvartfinale");
    expect(h).toContain("13:20 Mulig semifinale");
    expect(h).toContain("15:00 Mulig finale");
    // Negativt: ikke generisk kampindeks på semifinale/finale.
    expect(h).not.toContain("13:20 Andre kamp");
    expect(h).not.toContain("15:00 Tredje kamp");
    // Fortsatt ingen frist-lekkasje.
    expect(h).not.toContain("18:00");
    expect(h.toLowerCase()).not.toContain("frist");
  });

  it("Spond-frist blir task med dueTime 18:00 / date 2026-06-10 / intent must_do — ikke program", async () => {
    const items = await buildBundle();
    const spond = items.find((i) => i.kind === "task" && /spond/i.test(i.task?.title ?? ""));
    expect(spond).toBeTruthy();
    expect(spond?.task?.dueTime).toBe("18:00");
    expect(spond?.task?.date).toBe("2026-06-10");
    expect(spond?.task?.taskIntent).toBe("must_do");
    // 18:00 skal ikke ligge som program-tid på noen dag.
    for (const d of ["fredag", "lørdag", "søndag"] as const) {
      expect(hl(items, d)).not.toContain("18:00");
    }
  });
});
