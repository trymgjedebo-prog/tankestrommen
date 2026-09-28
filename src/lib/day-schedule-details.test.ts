/**
 * Tester for den delte `details`-serialiseringen og redundans-testen, og for at skole-pipelinens
 * to konsumenter (schoolBlock-fellesenheter og normaliserte fakta) bruker den riktig:
 *   - tekstformen (`days[]`): syntetisert details gir IKKE egne items/fakta — hvert faktum én gang
 *   - modell-skrevet/unik details (bildeformen, eller blob med ekstra innhold) bevares uendret
 *   - produsent (normaliseringen) og detektor kan ikke drifte fra hverandre
 */
import { describe, expect, it } from "vitest";
import {
  isDayDetailsDerivedFromAtomicFields,
  renderDayDetailsFromAtomicFields,
} from "@/lib/day-schedule-details";
import { parseAndNormalizeModelResponse } from "@/lib/ai/analyze-image";
import { coerceAIAnalysisResultForPortal } from "@/lib/analysis-null-safety";
import { buildSchoolBlockProposal } from "@/lib/school-block-proposal";
import { buildNormalizedSchoolContentFacts } from "@/lib/school-content-fact";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

const NOW = new Date("2026-10-05T09:00:00.000Z");

function normalize(model: unknown): AIAnalysisResult {
  return coerceAIAnalysisResultForPortal(
    parseAndNormalizeModelResponse(JSON.stringify(model), { now: NOW, enableDiagnostics: false }),
  );
}

/** Tekstprompt-form (days[]), som i produksjonens TEXT_SYSTEM_PROMPT. */
function textShape(day: Record<string, unknown>) {
  return {
    title: "Ukeplan for 2STC",
    targetGroup: "2STC",
    days: [{ dayLabel: "Torsdag", date: "2026-10-08", time: null, deadlines: [], notes: [], ...day }],
    generalImportantInfo: [],
    contacts: [],
    classLocations: [],
    schoolWeeklyProfile: null,
  };
}

/** Bildeprompt-form (scheduleByDay med modell-skrevet details). */
function imageShape(details: string) {
  return {
    title: "Ukeplan for 2STC",
    category: "beskjed",
    description: "Plan.",
    targetGroup: "2STC",
    confidence: 0.9,
    schedule: [],
    scheduleByDay: [{ dayLabel: "Torsdag", date: "2026-10-08", time: null, details }],
    extractedText: { raw: details, language: "no", confidence: 0.9 },
  };
}

function blockTexts(result: AIAnalysisResult): Array<{ title: string; sourceText: string | null }> {
  const block = buildSchoolBlockProposal(result, { knownPersons: [] }, { proposalId: "p-1", originalSourceType: "text" });
  return block.days.flatMap((d) => d.contentItems.map((i) => ({ title: i.title, sourceText: i.sourceText })));
}

function entry(partial: Partial<DayScheduleEntry>): DayScheduleEntry {
  return {
    dayLabel: "Torsdag",
    date: "2026-10-08",
    time: null,
    details: null,
    highlights: [],
    rememberItems: [],
    deadlines: [],
    notes: [],
    ...partial,
  };
}

describe("renderDayDetailsFromAtomicFields", () => {
  it("serialiserer i fast rekkefølge med faste etiketter; tomme felt utelates; ingenting → null", () => {
    expect(
      renderDayDetailsFromAtomicFields({ highlights: ["A", "B"], rememberItems: ["C"], deadlines: ["D"], notes: ["E"] }),
    ).toBe("Høydepunkter: A; B\nHusk: C\nFrister: D\nNotater: E");
    expect(renderDayDetailsFromAtomicFields({ highlights: [], rememberItems: ["C"], deadlines: [], notes: [] })).toBe("Husk: C");
    expect(renderDayDetailsFromAtomicFields({ highlights: [], rememberItems: [], deadlines: [], notes: [] })).toBeNull();
  });
});

describe("isDayDetailsDerivedFromAtomicFields", () => {
  it("true kun når details er nøyaktig serialiseringen av dagens egne atomiske felt", () => {
    const fields = { highlights: ["Gym ute torsdag."], rememberItems: ["Husk regntøy."] };
    expect(
      isDayDetailsDerivedFromAtomicFields(entry({ ...fields, details: "Høydepunkter: Gym ute torsdag.\nHusk: Husk regntøy." })),
    ).toBe(true);
  });

  it("false for null details og for bildeformens modell-skrevne details (tomme atomiske felt)", () => {
    expect(isDayDetailsDerivedFromAtomicFields(entry({ details: null, highlights: ["X"] }))).toBe(false);
    expect(isDayDetailsDerivedFromAtomicFields(entry({ details: "Gym ute torsdag. Husk regntøy." }))).toBe(false);
  });

  it("false når details inneholder noe utover de atomiske feltene (unik informasjon bevares)", () => {
    expect(
      isDayDetailsDerivedFromAtomicFields(
        entry({
          highlights: ["Gym ute torsdag."],
          rememberItems: ["Husk regntøy."],
          details: "Høydepunkter: Gym ute torsdag.\nHusk: Husk regntøy.\nForeldremøte kl. 18.",
        }),
      ),
    ).toBe(false);
  });

  it("streng: selv en whitespace-forskjell regnes som ikke-redundant (ingen normalisering, ingen gjetting)", () => {
    expect(
      isDayDetailsDerivedFromAtomicFields(
        entry({ highlights: ["Gym ute torsdag."], details: "Høydepunkter:  Gym ute torsdag." }),
      ),
    ).toBe(false);
  });
});

describe("produsent og detektor kan ikke drifte", () => {
  it("tekstnormaliseringens syntetiserte details gjenkjennes som redundant (også etter portal-coerce)", () => {
    const result = normalize(textShape({ highlights: ["Gym ute torsdag."], rememberItems: ["Husk regntøy."] }));
    const day = result.scheduleByDay[0]!;
    expect(day.details).toBe(renderDayDetailsFromAtomicFields(day));
    expect(isDayDetailsDerivedFromAtomicFields(day)).toBe(true);
  });

  it("bildeformens details regnes aldri som redundant", () => {
    const day = normalize(imageShape("Gym ute torsdag. Husk regntøy.")).scheduleByDay[0]!;
    expect(isDayDetailsDerivedFromAtomicFields(day)).toBe(false);
  });
});

describe("schoolBlock-fellesenheter", () => {
  it("tekstform: de to atomiske faktaene gir ett item hver — ingen «Skoleinformasjon»-blob", () => {
    const texts = blockTexts(normalize(textShape({ highlights: ["Gym ute torsdag."], rememberItems: ["Husk regntøy."] })));
    expect(texts).toEqual(
      expect.arrayContaining([
        { title: "Viktig informasjon", sourceText: "Gym ute torsdag." },
        { title: "Husk", sourceText: "Husk regntøy." },
      ]),
    );
    expect(texts).toHaveLength(2);
    expect(texts.some((t) => t.title === "Skoleinformasjon")).toBe(false);
  });

  it("bildeform: modell-skrevet details bevares uendret som «Skoleinformasjon»", () => {
    const texts = blockTexts(normalize(imageShape("Gym ute torsdag. Husk regntøy.")));
    expect(texts).toEqual([{ title: "Skoleinformasjon", sourceText: "Gym ute torsdag. Husk regntøy." }]);
  });

  it("unik details-tekst ved siden av atomiske felt bevares", () => {
    const result: AIAnalysisResult = {
      ...normalize(textShape({ highlights: ["Gym ute torsdag."], rememberItems: [] })),
    };
    result.scheduleByDay = [
      entry({ highlights: ["Gym ute torsdag."], details: "Høydepunkter: Gym ute torsdag.\nForeldremøte kl. 18." }),
    ];
    const texts = blockTexts(result);
    expect(texts.map((t) => t.sourceText)).toEqual(
      expect.arrayContaining(["Gym ute torsdag.", "Høydepunkter: Gym ute torsdag. Foreldremøte kl. 18."]),
    );
  });

  it("deterministisk: samme input gir identisk proposal to ganger", () => {
    const result = normalize(textShape({ highlights: ["Gym ute torsdag."], rememberItems: ["Husk regntøy."] }));
    const meta = { proposalId: "p-1", originalSourceType: "text" };
    expect(buildSchoolBlockProposal(result, { knownPersons: [] }, meta)).toEqual(
      buildSchoolBlockProposal(result, { knownPersons: [] }, meta),
    );
  });
});

describe("normaliserte skolefakta", () => {
  it("tekstform med fag-prefiks: kun faktumet fra det atomiske feltet — ingen falskt details-faktum", () => {
    const facts = buildNormalizedSchoolContentFacts(
      normalize(textShape({ highlights: ["Norsk: Les kapittel 3."], rememberItems: ["Husk regntøy."] })).scheduleByDay,
    );
    expect(facts.map((f) => ({ field: f.sourceField, subjectKey: f.subjectKey, text: f.text }))).toEqual([
      { field: "highlights", subjectKey: "norsk", text: "Les kapittel 3." },
    ]);
  });

  it("bildeform: fag-rader i modell-skrevet details parses som før", () => {
    const facts = buildNormalizedSchoolContentFacts(normalize(imageShape("Norsk: Les kapittel 3.")).scheduleByDay);
    expect(facts.map((f) => ({ field: f.sourceField, subjectKey: f.subjectKey }))).toEqual([
      { field: "details", subjectKey: "norsk" },
    ]);
  });
});
