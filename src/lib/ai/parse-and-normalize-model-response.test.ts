/**
 * Tester for den offentlige parse-/normaliseringssømmen `parseAndNormalizeModelResponse`.
 * Sømmen gjenbruker NØYAKTIG dagens interne produksjonsparser (`parseAIResponse` /
 * `parseAIResponseWithSource`) + `normalizeAIAnalysisResult` — ingen ny parser, samme feil,
 * samme normaliseringsregler. `now` og `enableDiagnostics` er additive; uten options = dagens
 * oppførsel.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAndNormalizeModelResponse } from "@/lib/ai/analyze-image";

function modelJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: "Ukeplan uke 15",
    description: "",
    schedule: [],
    scheduleByDay: [
      { dayLabel: "Mandag", details: "Norsk" },
      { dayLabel: "Tirsdag", details: "Matte" },
    ],
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gyldig rå modelltekst", () => {
  it("gir et forventet AIAnalysisResult (samme normalisering som produksjon)", () => {
    const r = parseAndNormalizeModelResponse(modelJson(), { now: new Date("2026-06-01T00:00:00Z"), enableDiagnostics: false });
    expect(r.title).toBe("Ukeplan uke 15");
    expect(r.scheduleByDay.map((d) => d.dayLabel)).toEqual(["Mandag", "Tirsdag"]);
    expect(r.extractedText).toBeTruthy();
  });
});

describe("feilhåndtering (identisk med produksjon)", () => {
  it("ugyldig JSON → samme parserfeil", () => {
    expect(() => parseAndNormalizeModelResponse("{ikke json")).toThrow("Kunne ikke tolke JSON fra modellen");
  });
  it("tom respons → samme tom-feil", () => {
    expect(() => parseAndNormalizeModelResponse("")).toThrow("Tom respons fra OpenAI");
  });
  it("JSON 'null' → samme ugyldig-feil fra normalisering", () => {
    expect(() => parseAndNormalizeModelResponse("null")).toThrow("Ugyldig JSON fra modellen");
  });
});

describe("sourceText", () => {
  it("sourceText-veien gir gyldig resultat (delegerer til parseAIResponseWithSource)", () => {
    const r = parseAndNormalizeModelResponse(modelJson(), { sourceText: "Ukeplan for 2STC", now: new Date("2026-06-01T00:00:00Z"), enableDiagnostics: false });
    expect(r.title).toBe("Ukeplan uke 15");
  });
});

describe("fast klokke → deterministisk årsinferens", () => {
  it("samme now → identisk resultat; ulik now → ulikt inferert år", () => {
    const raw = modelJson();
    const a = parseAndNormalizeModelResponse(raw, { now: new Date("2028-06-01T00:00:00Z"), enableDiagnostics: false });
    const b = parseAndNormalizeModelResponse(raw, { now: new Date("2028-06-01T00:00:00Z"), enableDiagnostics: false });
    expect(a).toEqual(b); // deterministisk
    const c = parseAndNormalizeModelResponse(raw, { now: new Date("2031-06-01T00:00:00Z"), enableDiagnostics: false });
    expect(a.scheduleByDay[0]!.date).toContain("2028");
    expect(c.scheduleByDay[0]!.date).toContain("2031");
    expect(a.scheduleByDay[0]!.date).not.toBe(c.scheduleByDay[0]!.date); // now driver året
  });
});

describe("produksjonsdefault", () => {
  it("uten options: gyldig resultat med dagens oppførsel (år = inneværende år når dokumentet mangler år)", () => {
    const r = parseAndNormalizeModelResponse(modelJson());
    expect(r.title).toBe("Ukeplan uke 15");
    expect(r.scheduleByDay[0]!.date).toContain(String(new Date().getFullYear()));
  });
});

describe("diagnostikk deaktivert → ingen fetch", () => {
  const rawWithProfile = () =>
    modelJson({ schoolWeeklyProfile: { weekdays: { "0": { lessons: [{ subjectKey: "norsk", start: "08:00", end: "09:00" }] } } } });

  it("enableDiagnostics: false → fetch kalles ikke", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    parseAndNormalizeModelResponse(rawWithProfile(), { now: new Date("2026-06-01T00:00:00Z"), enableDiagnostics: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("default (diagnostikk på) → fetch forsøkes (bevis på at gating faktisk styrer)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    parseAndNormalizeModelResponse(rawWithProfile(), { now: new Date("2026-06-01T00:00:00Z") });
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("immutabilitet", () => {
  it("muterer ikke options eller (implisitt) rå tekst", () => {
    const options = { sourceText: "S", now: new Date("2026-06-01T00:00:00Z"), enableDiagnostics: false };
    const snap = JSON.stringify(options);
    parseAndNormalizeModelResponse(modelJson(), options);
    expect(JSON.stringify(options)).toBe(snap);
  });
});
