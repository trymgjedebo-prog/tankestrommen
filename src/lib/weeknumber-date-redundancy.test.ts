/**
 * Dato-basert weekNumber-redundans i overlay-rutingen (produksjonsnært, toPortalBundle).
 * Kjernen: en A-plan med ekte flerdagers datoer i SAMME ISO-uke skal rute overlay-vei selv
 * når ordet «Uke NN» IKKE ble transkribert — men KUN ved eksplisitt plan-intensjon
 * (plan-tittelord eller documentKind=activity_plan). Funn 2-vernet: skoleevidens alene
 * (eksamensuke-formen) aktiverer ALDRI utledning → forblir event-vei med kalender-events.
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

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

function baseResult(overrides: Partial<AIAnalysisResult>): AIAnalysisResult {
  return {
    title: "",
    schedule: [],
    scheduleByDay: [],
    location: null,
    description: "",
    category: "beskjed",
    targetGroup: null,
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    extractedText: { raw: "", language: "no", confidence: 1 },
    ...overrides,
  };
}

/** Tre plan-dager i ISO-uke 25/2026 (man 15. – ons 17. juni) med fag-innhold — INGEN uke-ord. */
function aPlanDays(): DayScheduleEntry[] {
  return [
    day({
      dayLabel: "mandag",
      date: "mandag 15. juni 2026",
      details: "Norsk: Lekse: les side 12-14.\nMatte: gjør oppgave 3.1 og 3.2.",
    }),
    day({
      dayLabel: "tirsdag",
      date: "tirsdag 16. juni 2026",
      details: "Engelsk: Lekse: glosetest fredag, øv på kapittel 4.",
    }),
    day({
      dayLabel: "onsdag",
      date: "onsdag 17. juni 2026",
      details: "Naturfag: Lekse: fullfør rapporten om fotosyntese.",
    }),
  ];
}

type Bundle = {
  items: Array<{ kind: string; event?: { metadata?: { schoolContext?: unknown } } }>;
  schoolWeekOverlayProposal?: { weekNumber: number | null };
};

async function bundleOf(
  result: AIAnalysisResult,
  documentKind?: "activity_plan",
): Promise<Bundle> {
  return (await toPortalBundle(result, "text", documentKind, false, {
    knownPersons: [],
  })) as Bundle;
}

describe("dato-basert weekNumber-redundans (plan-intensjons-gatet)", () => {
  it("KJERNEN: A-plan m/ plan-tittelord, 3 datoer samme uke, UTEN uke-ord → overlay m/ utledet weekNumber 25", async () => {
    const bundle = await bundleOf(
      baseResult({
        title: "Aktivitetsplan for 10B",
        description: "Plan for dagane med lekser per fag.",
        extractedText: { raw: "Aktivitetsplan for 10B. Lekser per dag.", language: "no", confidence: 1 },
        targetGroup: "10B",
        scheduleByDay: aPlanDays(),
      }),
    );
    expect(bundle.schoolWeekOverlayProposal).toBeTruthy();
    expect(bundle.schoolWeekOverlayProposal!.weekNumber).toBe(25); // Innkobling B: proposalen får utledet uke
  });

  it("KJERNEN via documentKind: uten plan-tittelord men kind=activity_plan → overlay m/ weekNumber 25", async () => {
    const bundle = await bundleOf(
      baseResult({
        title: "Neste dager for 10B",
        description: "Lekser per fag.",
        extractedText: { raw: "Lekser per dag for 10B.", language: "no", confidence: 1 },
        targetGroup: "10B",
        scheduleByDay: aPlanDays(),
      }),
      "activity_plan",
    );
    expect(bundle.schoolWeekOverlayProposal).toBeTruthy();
    expect(bundle.schoolWeekOverlayProposal!.weekNumber).toBe(25);
  });

  it("ORD-PRESEDENS: «Uke 25» i tittelen vinner selv når datoene ligger i uke 26", async () => {
    const days = [
      day({
        dayLabel: "mandag",
        date: "mandag 22. juni 2026", // uke 26
        details: "Norsk: Lekse: les side 12-14.",
      }),
      day({
        dayLabel: "tirsdag",
        date: "tirsdag 23. juni 2026", // uke 26
        details: "Matte: gjør oppgave 3.1.",
      }),
    ];
    const bundle = await bundleOf(
      baseResult({
        title: "Aktivitetsplan Uke 25 for 10B",
        description: "Lekser per fag.",
        extractedText: { raw: "Aktivitetsplan Uke 25.", language: "no", confidence: 1 },
        targetGroup: "10B",
        scheduleByDay: days,
      }),
    );
    expect(bundle.schoolWeekOverlayProposal).toBeTruthy();
    expect(bundle.schoolWeekOverlayProposal!.weekNumber).toBe(25); // ordet, ikke datoene (26)
  });

  it("RÅDGIVER-VERNET: éndags skole-arrangement (én dato) → INGEN overlay; event m/ schoolContext bevart", async () => {
    const bundle = await bundleOf(
      baseResult({
        title: "Rådgiveropplegg 2ST",
        description: "Opplegg med rådgjevarane og bokinnlevering.",
        extractedText: {
          raw: "Torsdag 18. juni: opplegg med rådgjevarane. Bokinnlevering: 2STA 13.10-13.40, 2STC 10.30-11.00. Eksamen nærmar seg.",
          language: "no",
          confidence: 1,
        },
        targetGroup: "2ST",
        scheduleByDay: [
          day({
            dayLabel: "torsdag",
            date: "torsdag 18. juni 2026",
            time: "10:00",
            details: "Opplegg med rådgjevarane.\nBokinnlevering 2STC 10.30-11.00",
          }),
        ],
      }),
    );
    expect(bundle.schoolWeekOverlayProposal).toBeFalsy();
    const events = bundle.items.filter((i) => i.kind === "event");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.event?.metadata?.schoolContext).toBeTruthy();
  });

  it("FUNN 2-BEVISET: eksamensuke (skoleevidens, 4 ISO-datoer samme uke, UTEN plan-tittelord) → fortsatt event-vei", async () => {
    const raw =
      "Eksamen og avslutninger 2ST\nKlasser: 2STA, 2STC, 2STE.\n" +
      "Mandag: Muntlig eksamen for 2STA.\nTirsdag: Bokinnlevering 2STC.\nFredag: Klasseavslutning.";
    const bundle = await bundleOf(
      baseResult({
        title: "Eksamen og avslutninger",
        description: "2STA, 2STC og 2STE. Bokinnlevering og muntlig eksamen.",
        extractedText: { raw, language: "no", confidence: 1 },
        targetGroup: "2STA, 2STC og 2STE",
        scheduleByDay: [
          day({ dayLabel: "mandag", date: "2026-06-15", details: "Muntlig eksamen for 2STA.", time: "09:00" }),
          day({ dayLabel: "tirsdag", date: "2026-06-16", details: "Bokinnlevering 2STC.", time: "10:30" }),
          day({ dayLabel: "onsdag", date: "2026-06-17", details: "Skriftlig eksamen 2STE.", time: "09:00" }),
          day({ dayLabel: "fredag", date: "2026-06-19", details: "Klasseavslutning for alle.", time: "12:00" }),
        ],
      }),
    );
    expect(bundle.schoolWeekOverlayProposal).toBeFalsy(); // dato-utledning aktiveres IKKE av evidens alene
    const events = bundle.items.filter((i) => i.kind === "event");
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) expect(ev.event?.metadata?.schoolContext).toBeTruthy();
  });

  it("ULIKE UKER: plan-tittelord men datoene spenner to uker → ingen utledning → ingen overlay", async () => {
    const bundle = await bundleOf(
      baseResult({
        title: "Aktivitetsplan for 10B",
        description: "Lekser per fag.",
        extractedText: { raw: "Aktivitetsplan for 10B.", language: "no", confidence: 1 },
        targetGroup: "10B",
        scheduleByDay: [
          day({ dayLabel: "mandag", date: "mandag 15. juni 2026", details: "Norsk: Lekse: les side 12." }), // uke 25
          day({ dayLabel: "mandag", date: "mandag 22. juni 2026", details: "Matte: gjør oppgave 3.1." }), // uke 26
        ],
      }),
    );
    expect(bundle.schoolWeekOverlayProposal).toBeFalsy();
  });

  it("UPARSEBARE DATOER: plan-tittelord men ingen parsebare datoer → ingen utledning → ingen overlay", async () => {
    const bundle = await bundleOf(
      baseResult({
        title: "Aktivitetsplan for 10B",
        description: "Lekser per fag.",
        extractedText: { raw: "Aktivitetsplan for 10B.", language: "no", confidence: 1 },
        targetGroup: "10B",
        scheduleByDay: [
          day({ dayLabel: "mandag", details: "Norsk: Lekse: les side 12." }),
          day({ dayLabel: "tirsdag", details: "Matte: gjør oppgave 3.1." }),
        ],
      }),
    );
    expect(bundle.schoolWeekOverlayProposal).toBeFalsy();
  });

  it("CUP-VERNET: lørdag+søndag samme ISO-uke (2 datoer!) men ingen plan-intensjon/skolesignal → ingen overlay", async () => {
    const bundle = await bundleOf(
      baseResult({
        title: "Vårcupen 2026 – G12",
        description: "Cuphelg på Ekeberg.",
        extractedText: {
          raw: "Vårcupen 2026 G12. Lørdag 13. juni: oppmøte 08:35, kamp 09:20. Søndag 14. juni: kamper fra 10:00.",
          language: "no",
          confidence: 1,
        },
        targetGroup: "G12",
        category: "arrangement",
        scheduleByDay: [
          day({ dayLabel: "lørdag", date: "lørdag 13. juni 2026", highlights: ["Oppmøte 08:35", "Kamp 09:20"] }),
          day({ dayLabel: "søndag", date: "søndag 14. juni 2026", highlights: ["Kamper fra 10:00"] }),
        ],
      }),
    );
    expect(bundle.schoolWeekOverlayProposal).toBeFalsy();
    expect(bundle.items.filter((i) => i.kind === "event").length).toBeGreaterThan(0);
  });
});
