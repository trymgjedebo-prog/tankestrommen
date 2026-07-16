/**
 * documentKind-veto mot overlay (Vei 1). Brukeren erklærer doktype ved import: «Arrangement/
 * opplegg» (event_doc) → event-vei med bevarte tider; «Ukeplan» (activity_plan) → overlay.
 * Erklæringen overstyrer skolebevis-heuristikken, som ikke kan skille de to (eksamensuker er
 * fag-løse i BEGGE tilfeller). Vetoen er rent additiv: event_doc er ruting-inert i dag, og
 * bare eksplisitt event_doc vetoer — alt annet er byte-identisk dagens oppførsel.
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
    category: "school_week" as AIAnalysisResult["category"],
    targetGroup: null,
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    extractedText: { raw: "", language: "no", confidence: 1 },
    ...overrides,
  };
}

/** Uke-25-formen: skolebevis (2STA–2STF + eksamen/bokinnlevering) + 5 dager + ordet «Uke 25». */
function uke25Result(): AIAnalysisResult {
  const raw =
    "Avslutning og eksamensforberedelser 2ST Uke 25\n2STA 2STB 2STC 2STD 2STE 2STF\n" +
    "Mandag\nForberedelse muntlig eksamen.\nTirsdag\nBokinnlevering i klasserommet.\n" +
    "Onsdag\nMuntlig eksamen for alle klasser.\nTorsdag\nOpplegg med rådgiverne.\n" +
    "Fredag\nSiste skoledag og avslutning.";
  return baseResult({
    title: "Avslutning og eksamensforberedelser 2ST Uke 25",
    description: "2STA 2STB 2STC 2STD 2STE 2STF. Eksamen, bokinnlevering og rådgiveropplegg.",
    extractedText: { raw, language: "no", confidence: 1 },
    targetGroup: "2STA 2STB 2STC 2STD 2STE 2STF",
    scheduleByDay: [
      day({ dayLabel: "mandag", details: "Forberedelse muntlig eksamen." }),
      day({ dayLabel: "tirsdag", details: "Bokinnlevering i klasserommet." }),
      day({ dayLabel: "onsdag", details: "Muntlig eksamen for alle klasser." }),
      day({ dayLabel: "torsdag", details: "Opplegg med rådgiverne 10:00-11:00." }),
      day({ dayLabel: "fredag", details: "Siste skoledag 09:00-12:00." }),
    ],
  });
}

/** Ekte lekseplan: fag-strukturerte dager («Norsk: …»), datoer i samme uke. */
function lekseplanResult(): AIAnalysisResult {
  return baseResult({
    title: "Aktivitetsplan for 10B",
    description: "Lekser per fag.",
    extractedText: { raw: "Aktivitetsplan for 10B. Lekser per dag.", language: "no", confidence: 1 },
    targetGroup: "10B",
    scheduleByDay: [
      day({ dayLabel: "mandag", date: "mandag 15. juni 2026", details: "Norsk: les side 12-14." }),
      day({ dayLabel: "tirsdag", date: "tirsdag 16. juni 2026", details: "Matte: oppgave 3.1 og 3.2." }),
      day({ dayLabel: "onsdag", date: "onsdag 17. juni 2026", details: "Engelsk: øv på gloser kap. 4." }),
    ],
  });
}

type Bundle = {
  items: Array<{ kind: string; event?: { metadata?: { schoolContext?: unknown } } }>;
  schoolWeekOverlayProposal?: unknown;
  schoolBlockProposal?: unknown;
  debug?: { schoolWeekOverlayRouting?: { reason?: string } };
};

async function bundleOf(
  result: AIAnalysisResult,
  documentKind?: "event_doc" | "activity_plan" | "text" | "auto" | "school",
  includeDebug = false,
): Promise<Bundle> {
  return (await toPortalBundle(result, "text", documentKind, includeDebug, {
    knownPersons: [],
  })) as Bundle;
}

describe("documentKind-veto mot overlay-ruting", () => {
  it("PRESEDENS: uke-25-form UTEN documentKind → overlay (dagens oppførsel)", async () => {
    const bundle = await bundleOf(uke25Result());
    expect(bundle.schoolWeekOverlayProposal).toBeTruthy();
  });

  it("VETO: samme dokument MED event_doc → INGEN overlay; events m/ schoolContext; reason satt", async () => {
    const bundle = await bundleOf(uke25Result(), "event_doc", true);
    expect(bundle.schoolWeekOverlayProposal).toBeFalsy();
    const events = bundle.items.filter((i) => i.kind === "event");
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) expect(ev.event?.metadata?.schoolContext).toBeTruthy();
    expect(bundle.debug?.schoolWeekOverlayRouting?.reason).toBe("overlay_vetoed_by_document_kind");
  });

  it("FORSTERKNING uendret: ekte lekseplan MED activity_plan → overlay", async () => {
    const bundle = await bundleOf(lekseplanResult(), "activity_plan");
    expect(bundle.schoolWeekOverlayProposal).toBeTruthy();
  });

  it("DEGRADERING: uke-25-form med text/auto/school → overlay uendret (kun event_doc vetoer)", async () => {
    // `school` er ny og foreløpig ruting-inert: den følger den generiske, innholdsbaserte
    // rutingen (som text/auto) og vetoer ikke. Fixturen får overlay fra innholdet («Uke 25»
    // + skolebevis + 5 dager), så dette isolerer at ny type ikke endrer eksisterende ruting.
    for (const kind of ["text", "auto", "school"] as const) {
      const bundle = await bundleOf(uke25Result(), kind);
      expect(bundle.schoolWeekOverlayProposal, `kind=${kind}`).toBeTruthy();
    }
  });

  it("school: toPortalBundle aksepterer typen og emitterer nå schoolBlockProposal additivt", async () => {
    const bundle = await bundleOf(uke25Result(), "school");
    expect("schoolBlockProposal" in bundle).toBe(true);
    // Additivt: den generiske overlay-oppførselen for `school` er uendret (fixturen får overlay
    // fra innholdet), og proposaltypene er ikke gjensidig utelukkende.
    expect(bundle.schoolWeekOverlayProposal).toBeTruthy();
  });

  it("ikke-school beholder eksisterende oppførsel uten schoolBlockProposal-nøkkel", async () => {
    for (const kind of ["event_doc", "activity_plan", "text", "auto"] as const) {
      const bundle = await bundleOf(uke25Result(), kind);
      expect("schoolBlockProposal" in bundle, `kind=${kind}`).toBe(false);
    }
    const noKind = await bundleOf(uke25Result());
    expect("schoolBlockProposal" in noKind).toBe(false);
  });

  it("daySignal-GULVET: éndags-dokument MED activity_plan → fortsatt INGEN overlay", async () => {
    const single = baseResult({
      title: "Aktivitetsplan for 10B",
      description: "Lekser.",
      extractedText: { raw: "Aktivitetsplan for 10B. Norsk: les side 12.", language: "no", confidence: 1 },
      targetGroup: "10B",
      scheduleByDay: [
        day({ dayLabel: "torsdag", date: "torsdag 18. juni 2026", details: "Norsk: les side 12-14." }),
      ],
    });
    const bundle = await bundleOf(single, "activity_plan");
    expect(bundle.schoolWeekOverlayProposal).toBeFalsy();
  });
});
