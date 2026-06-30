/**
 * Ungdomsskole-klassekode-gjenkjenning (gated) + targetGroup-primærsignal.
 * VGS-regex uendret; ungdomsskole (NN[A-G]) gated mot false positives (rom/oppgave/gruppe).
 */
import { describe, expect, it } from "vitest";
import {
  countDistinctClassCodes,
  extractClassCodes,
  hasStrongSchoolEvidence,
  lineIsRelevantForClass,
} from "@/lib/school-class-schedule";
import { matchDocumentToChild, type MatchChild } from "@/lib/match-document-to-child";
import { buildChildMatchDocumentText } from "@/lib/child-selection";
import type { AIAnalysisResult } from "@/lib/types";

describe("extractClassCodes — ungdomsskole (gated) + VGS uendret", () => {
  it("gjenkjenner ungdomsskole-koder i klasse-/uke-kontekst", () => {
    expect(extractClassCodes("klasse 10B")).toEqual(["10b"]);
    expect(extractClassCodes("10B uke 13")).toEqual(["10b"]);
    expect(extractClassCodes("Arbeidsplan // klasse 10B")).toEqual(["10b"]);
    expect(extractClassCodes("8A og 9B har tur")).toEqual(["8a", "9b"]);
  });

  it("GATING: rom/oppgave/gruppe-prefiks → IKKE klassekode (false positive)", () => {
    expect(extractClassCodes("rom 10B")).toEqual([]);
    expect(extractClassCodes("klasserom 9A")).toEqual([]);
    expect(extractClassCodes("oppgave 3a")).toEqual([]);
    expect(extractClassCodes("gruppe 8A")).toEqual([]);
    expect(extractClassCodes("side 9b")).toEqual([]);
  });

  it("trinn-område 1-10: «13B»/«20A» er ikke klassekoder", () => {
    expect(extractClassCodes("13B")).toEqual([]);
    expect(extractClassCodes("20A")).toEqual([]);
    expect(extractClassCodes("uke 13")).toEqual([]);
  });

  it("VGS uendret + blandet; VGS dobbelt-telles ikke som ungdomsskole", () => {
    expect(extractClassCodes("2STC")).toEqual(["2stc"]);
    expect(extractClassCodes("2STA og 2STB")).toEqual(["2sta", "2stb"]);
    expect(extractClassCodes("2STC og 10B")).toEqual(["2stc", "10b"]);
    expect(extractClassCodes("3BAA")).toEqual(["3baa"]); // VGS «ba»-programkode, ikke «3b»
  });

  it("normalisering: «10 B» / casing → «10b»", () => {
    expect(extractClassCodes("10 B")).toEqual(["10b"]);
    expect(extractClassCodes("KLASSE 10b")).toEqual(["10b"]);
  });
});

describe("countDistinctClassCodes / hasStrongSchoolEvidence med ungdomsskole", () => {
  it("teller ungdomsskole-koder; VGS uendret; gated bort", () => {
    expect(countDistinctClassCodes("2STA og 2STB")).toBe(2);
    expect(countDistinctClassCodes("klasse 8A og klasse 9B")).toBe(2);
    expect(countDistinctClassCodes("rom 10B")).toBe(0);
  });
  it("2 ungdomsskole-koder + skoleord → strong evidence; uten skoleord → ikke", () => {
    expect(hasStrongSchoolEvidence("8A og 9B: eksamen i auditoriet")).toBe(true);
    expect(hasStrongSchoolEvidence("8A og 9B på fotballcup")).toBe(false);
  });
});

describe("lineIsRelevantForClass med ungdomsskole", () => {
  it("filtrerer på ungdomsskole-klasse; «rom 10B» er ikke en klassekode", () => {
    expect(lineIsRelevantForClass("10B: skriftlig tyskprøve", "10B")).toBe(true);
    expect(lineIsRelevantForClass("9A: gym", "10B")).toBe(false);
    expect(lineIsRelevantForClass("Felles for alle", "10B")).toBe(true);
    expect(lineIsRelevantForClass("møtes i rom 10B", "10B")).toBe(true);
  });
});

describe("barn-valg: targetGroup primært + ungdomsskole-regex backup (Idas A-plan)", () => {
  const CHILDREN: MatchChild[] = [
    { personId: "p-stellan", classCode: "2STC" },
    { personId: "p-ida", classCode: "10B", schoolProfile: { gradeBand: "8-10", weekdays: {} } },
  ];

  it("«klasse 10B» i tekst → matched Ida (primær, nå at 10b gjenkjennes)", () => {
    expect(matchDocumentToChild("klasse 10B uke 13, skriftlig tyskprøve", CHILDREN)).toEqual({
      personId: "p-ida",
      status: "matched",
    });
  });

  it("targetGroup bærer klassen når tittelen ikke gjør det → matched Ida", () => {
    const result = {
      title: "Arbeidsplan uke 15",
      description: "",
      schedule: [],
      scheduleByDay: [],
      location: null,
      category: "frist",
      targetGroup: "klasse 10B",
      organizer: null,
      contactPerson: null,
      sourceUrl: null,
      confidence: 0.8,
      extractedText: { raw: "diverse fag, mars-bad, tyskprøve", language: "no", confidence: 1 },
    } as unknown as AIAnalysisResult;
    const docText = buildChildMatchDocumentText(result);
    expect(docText).toContain("klasse 10B");
    expect(matchDocumentToChild(docText, CHILDREN)).toEqual({ personId: "p-ida", status: "matched" });
  });
});
