/**
 * Integrasjons-smoketest: classScheduleEntries gjennom normalizeAIAnalysisResult (samme
 * konvergenspunkt for tekst- OG bildeflyt). Låser at feltet normaliseres og returneres,
 * at tom/ugyldig liste utelates (feltet fraværende), og at øvrige AIAnalysisResult-felt
 * er uendret. Ingen prompt testes her.
 */
import { describe, expect, it } from "vitest";
import { normalizeAIAnalysisResult } from "@/lib/ai/analyze-image";

describe("normalizeAIAnalysisResult: classScheduleEntries-whitelist", () => {
  it("rå JSON MED gyldig classScheduleEntries → normalisert på resultatet", () => {
    const r = normalizeAIAnalysisResult({
      title: "Skoleuke 2ST",
      classScheduleEntries: [
        {
          classCodes: ["2STC"],
          date: "2026-06-18",
          activityTitle: "Bokinnlevering",
          start: "10:30",
          end: "11:00",
          room: "rom 332-50",
          teacher: "Marte Hermanrud",
          sourceText: "2STC 10.30-11.00",
          confidence: 0.9,
        },
        { classCodes: ["Pulje 1"], start: "09:00" }, // ugyldig kode → droppes
      ],
    });
    expect(r.classScheduleEntries).toEqual([
      {
        date: "2026-06-18",
        dayLabel: null,
        activityTitle: "Bokinnlevering",
        classCodes: ["2STC"],
        groupLabel: null,
        start: "10:30",
        end: "11:00",
        room: "332-50",
        teacher: "Marte Hermanrud",
        sourceText: "2STC 10.30-11.00",
        confidence: 0.9,
      },
    ]);
  });

  it("rå JSON UTEN classScheduleEntries → feltet finnes IKKE på resultatet", () => {
    const r = normalizeAIAnalysisResult({ title: "Vanlig beskjed" });
    expect(r.classScheduleEntries).toBeUndefined();
    expect(r).not.toHaveProperty("classScheduleEntries");
  });

  it("tom / kun-ugyldig classScheduleEntries → feltet utelates; øvrige felt uendret", () => {
    const r = normalizeAIAnalysisResult({
      title: "Rådgiveropplegg",
      description: "Opplegg med rådgiverne.",
      targetGroup: "2ST",
      classScheduleEntries: [{ classCodes: [] }, "søppel", 7],
    });
    expect(r).not.toHaveProperty("classScheduleEntries");
    expect(r.title).toBe("Rådgiveropplegg");
    expect(r.description).toBe("Opplegg med rådgiverne.");
    expect(r.targetGroup).toBe("2ST");
  });
});
