/**
 * Event-tid fra barnets klasse-linje (bro til #1+#3), produksjonsnært lag: toPortalBundle →
 * event.start/end. Beviser (1) overstyring: per-klasse-tider + kjent barn → BARNETS tid, ikke
 * første klasses; (2) degradering: uten barn / uten per-klasse-differensiering er event-tiden
 * BYTE-IDENTISK dagens oppførsel. Notatet røres ikke av tids-steget.
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

const PER_CLASS_DETAILS = [
  "Opplegg med rådgjevarane om vidare utdanningsval.",
  "Bokinnlevering 2STA 13.10-13.40",
  "Bokinnlevering 2STB 10.00-10.30",
  "Bokinnlevering 2STC 10.30-11.00",
  "Bokinnlevering 2STD 11.00-11.30",
  "Bokinnlevering 2STE 13.40-14.10",
  "Bokinnlevering 2STF 09.30-10.00",
].join("\n");

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

function raadgiverResult(): AIAnalysisResult {
  return {
    title: "Rådgiveropplegg 2ST",
    schedule: [],
    scheduleByDay: [
      day({
        dayLabel: "torsdag",
        date: "18. juni 2026",
        // Modellen plukket FØRSTE klasses tid (2STA) — nøyaktig skjermbilde-caset.
        time: "13.10-13.40",
        details: PER_CLASS_DETAILS,
      }),
    ],
    location: null,
    description: "Opplegg med rådgjevarane; bokinnlevering med egen tid per klasse.",
    category: "arrangement",
    targetGroup: "2ST",
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    extractedText: {
      raw: "Bokinnlevering: 2STA 13.10-13.40, 2STB 10.00-10.30, 2STC 10.30-11.00, 2STD 11.00-11.30, 2STE 13.40-14.10, 2STF 09.30-10.00.",
      language: "no",
      confidence: 1,
    },
  };
}

type EventItem = {
  kind: string;
  event?: { start?: string | null; end?: string | null; notes?: string };
};

async function bundleEvents(
  result: AIAnalysisResult,
  relevanceContext?: { classCode: string },
): Promise<EventItem[]> {
  const bundle = (await toPortalBundle(result, "text", undefined, false, {
    knownPersons: [],
    ...(relevanceContext ? { relevanceContext } : {}),
  })) as { items: EventItem[] };
  return bundle.items.filter((i) => i.kind === "event");
}

describe("event-tid fra barnets klasse-linje i portal-bundle", () => {
  it("per-klasse-tider + barn=2STC → event.start/end blir BARNETS tid (10:30-11:00, ikke 13:10)", async () => {
    const events = await bundleEvents(raadgiverResult(), { classCode: "2STC" });
    expect(events.length).toBeGreaterThan(0);
    const ev = events[0]!.event!;
    // event.start/end er ISO-datetime i bundle-output → assert på klokkeslett-delen.
    expect(ev.start ?? "").toContain("10:30");
    expect(ev.start ?? "").not.toContain("13:10");
    expect(ev.end ?? "").toContain("11:00");
    // Notatet røres IKKE av tids-steget: barnets frist-linje står fortsatt i notatet.
    expect(ev.notes ?? "").toContain("Bokinnlevering 2STC 10.30-11.00");
    // Dokumenterende (empirisk verifisert): oppgave-7-filteret kjører OGSÅ på event-veien
    // (portal-bundle filtrerer FØR buildProposalItems) → med classCode satt viser notatet
    // KUN barnets frist (filosofi (a)). Uten classCode: alle klassers (se kontrolltesten).
    // Overstyringen SELV-matcher barnets kode og er derfor uavhengig av denne filtreringen.
    expect(ev.notes ?? "").not.toContain("2STA");
  });

  it("KONTROLL (degradering): samme dokument UTEN barnekontekst → dagens tid (13:10-13:40) og alle klassers linjer i notatet", async () => {
    const events = await bundleEvents(raadgiverResult());
    expect(events.length).toBeGreaterThan(0);
    const ev = events[0]!.event!;
    expect(ev.start ?? "").toContain("13:10");
    expect(ev.end ?? "").toContain("13:40");
    expect(ev.notes ?? "").toContain("Bokinnlevering 2STA 13.10-13.40");
    expect(ev.notes ?? "").toContain("Bokinnlevering 2STC 10.30-11.00");
  });

  it("DEGRADERING (garde): vanlig event med ÉN barnetagget del-tid + barn=2STC → event-tid UENDRET (18:00-19:30)", async () => {
    const result: AIAnalysisResult = {
      ...raadgiverResult(),
      title: "Foreldremøte",
      scheduleByDay: [
        day({
          dayLabel: "tysdag",
          date: "16. juni 2026",
          time: "18:00-19:30",
          details: "Foreldremøte for alle føresette i gymsalen.\n2STC framfører 18.45-19.00",
        }),
      ],
      description: "Foreldremøte i gymsalen.",
      extractedText: {
        raw: "Foreldremøte 18:00-19:30 i gymsalen. 2STC framfører 18.45-19.00.",
        language: "no",
        confidence: 1,
      },
    };
    const events = await bundleEvents(result, { classCode: "2STC" });
    expect(events.length).toBeGreaterThan(0);
    const ev = events[0]!.event!;
    expect(ev.start ?? "").toContain("18:00");
    expect(ev.end ?? "").toContain("19:30");
  });
});
