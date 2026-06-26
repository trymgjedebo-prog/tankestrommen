/**
 * Produksjonsnær test (toPortalBundle → route.ts), Oppgave A / fiks B: en skole-aktivitetsplan
 * med klassekoder + skoleord — men UTEN det litterale «aktivitetsplan»/«ukeplan»-tittelordet og
 * uten documentKind-hint — skal nå tas som skole-ukeplan-overlay (i stedet for event_items_fallback),
 * slik at klasse-filtreringen (#7) kan kjøre. Verifiserer at skolebevis (≥2 klassekoder OG skoleord)
 * er det som vipper avgjørelsen.
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

function day(dayLabel: string, details: string): DayScheduleEntry {
  return {
    dayLabel,
    date: null,
    time: null,
    details,
    highlights: [],
    rememberItems: [],
    deadlines: [],
    notes: [],
  };
}

function makeResult(
  fields: Pick<AIAnalysisResult, "title" | "description" | "extractedText" | "scheduleByDay">,
): AIAnalysisResult {
  return {
    schedule: [],
    location: null,
    category: "school_week" as AIAnalysisResult["category"],
    targetGroup: null,
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    ...fields,
  };
}

async function overlayBuilt(r: AIAnalysisResult): Promise<boolean> {
  const bundle = (await toPortalBundle(r, "text", undefined, false, { knownPersons: [] })) as {
    schoolWeekOverlayProposal?: unknown;
  };
  return Boolean(bundle.schoolWeekOverlayProposal);
}

describe("produksjon: skole-aktivitetsplan uten tittel-nøkkelord → overlay via skolebevis", () => {
  it("2STA–2STF + eksamen + ukenummer → skole-ukeplan-overlay bygges", async () => {
    const raw =
      "Eksamensoppsett 2ST uke 24\n2STA 2STB 2STC 2STD 2STE 2STF\n" +
      "Mandag\nSkriftlig eksamen i auditoriet for alle klasser.\n" +
      "Tirsdag\nBokinnlevering i klasserommet før kl. 10.\n" +
      "Onsdag\nMuntlig eksamen og rådgiveropplegg.";
    const r = makeResult({
      title: "Eksamensoppsett 2ST uke 24", // ingen «aktivitetsplan»/«ukeplan»-ord
      description: "2STA 2STB 2STC 2STD 2STE 2STF. Eksamen og bokinnlevering.",
      extractedText: { raw, language: "no", confidence: 1 },
      scheduleByDay: [
        day("mandag", "Skriftlig eksamen i auditoriet for alle klasser."),
        day("tirsdag", "Bokinnlevering i klasserommet før kl. 10."),
        day("onsdag", "Muntlig eksamen og rådgiveropplegg."),
      ],
    });
    expect(await overlayBuilt(r)).toBe(true);
  });

  it("kontroll: samme struktur UTEN klassekoder/skoleord → ingen overlay (skolebevis er det avgjørende)", async () => {
    const raw =
      "Programoppsett uke 24\nMandag\nØkt i salen.\nTirsdag\nØkt i salen.\nOnsdag\nFellesøkt for alle.";
    const r = makeResult({
      title: "Programoppsett uke 24",
      description: "Felles program for alle.",
      extractedText: { raw, language: "no", confidence: 1 },
      scheduleByDay: [
        day("mandag", "Økt i salen."),
        day("tirsdag", "Økt i salen."),
        day("onsdag", "Fellesøkt for alle."),
      ],
    });
    expect(await overlayBuilt(r)).toBe(false);
  });
});
