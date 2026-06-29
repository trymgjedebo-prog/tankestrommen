/**
 * Fiks A (dynamisk prompt-dato) + Fiks B (deterministisk år-korreksjon) mot LLM-ens år-gjetting.
 *
 * Bakgrunn: LLM-en får aldri vite dagens dato, så «bruk inneværende år» feiler og den gjetter
 * året (2026 noen ganger, 2025 andre) for år-løse kilder. A injiserer dagens dato i prompten;
 * B lar serverens deterministiske weekYear-år overstyre LLM-årets når kilden har ukenummer men
 * mangler eksplisitt år (ren år-token-swap, dag/måned bevart).
 */
import { describe, expect, it } from "vitest";
import {
  correctGuessedYear,
  currentDateDirective,
  normalizeAIAnalysisResult,
} from "@/lib/ai/analyze-image";

describe("currentDateDirective (Fiks A)", () => {
  it("inneholder dagens ISO-dato og inneværende år", () => {
    const d = currentDateDirective(new Date("2026-06-29T00:00:00Z"));
    expect(d).toContain("2026-06-29");
    expect(d).toContain("(2026)");
  });
});

describe("correctGuessedYear (Fiks B — ren år-token-swap)", () => {
  it("bytter KUN år-tokenet, rører ikke dag/måned/ukedag-ord", () => {
    expect(correctGuessedYear("søndag 15. juni 2025", 2026)).toBe("søndag 15. juni 2026");
    expect(correctGuessedYear("15. juni 2025", 2026)).toBe("15. juni 2026");
    expect(correctGuessedYear("15.06.2025", 2026)).toBe("15.06.2026");
  });
  it("rører ikke strenger uten år-token", () => {
    expect(correctGuessedYear("15. juni", 2026)).toBe("15. juni");
  });
});

function rawDoc(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    title: "Uke 25 – skoleavslutning",
    description: "Plan for uke 25 med eksamen og avslutning.",
    schedule: [],
    scheduleByDay: [],
    category: "beskjed",
    confidence: 0.8,
    extractedText: { raw: "Uke 25\n15.06\n16.06", language: "no", confidence: 1 },
    ...overrides,
  };
}

describe("normalizeAIAnalysisResult: deterministisk år-korreksjon (Fiks B, gated)", () => {
  const y = new Date().getFullYear();

  it("«Uke 25» + år-løs kilde + LLM-dato med 2025 → år korrigeres til inneværende år", () => {
    const r = normalizeAIAnalysisResult(
      rawDoc({
        scheduleByDay: [
          { dayLabel: "Mandag", date: "søndag 15. juni 2025", time: null, details: null },
          { dayLabel: "Tirsdag", date: "16. juni 2025", time: null, details: null },
        ],
      }),
    );
    expect(r.scheduleByDay[0]!.date).toContain(String(y));
    expect(r.scheduleByDay[0]!.date).not.toContain("2025");
    expect(r.scheduleByDay[0]!.date).toContain("15. juni"); // dag/måned bevart
    expect(r.scheduleByDay[1]!.date).toContain(String(y));
    expect(r.scheduleByDay[1]!.date).not.toContain("2025");
  });

  it("kontroll: kilde MED eksplisitt år → gate hopper over (LLM-året uendret)", () => {
    const r = normalizeAIAnalysisResult(
      rawDoc({
        title: "Uke 25 2026 – skoleavslutning",
        extractedText: { raw: "Uke 25 2026", language: "no", confidence: 1 },
        scheduleByDay: [{ dayLabel: "Mandag", date: "15. juni 2025", time: null, details: null }],
      }),
    );
    // yearFromSource=true → vi overstyrer KUN når kilden mangler år → datoen er uendret.
    expect(r.scheduleByDay[0]!.date).toContain("2025");
  });

  it("kontroll: ingen ukenummer → weekYear=null → ingen korreksjon", () => {
    const r = normalizeAIAnalysisResult(
      rawDoc({
        title: "Skoleavslutning",
        description: "Plan for avslutning.",
        extractedText: { raw: "15.06", language: "no", confidence: 1 },
        scheduleByDay: [{ dayLabel: "Mandag", date: "15. juni 2025", time: null, details: null }],
      }),
    );
    expect(r.scheduleByDay[0]!.date).toContain("2025");
  });
});
