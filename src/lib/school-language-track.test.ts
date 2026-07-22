/**
 * Tester for den delte språkspormodulen: subject-key-predikatet og den mekanisk flyttede
 * dokument-resolveren `resolveSchoolLanguageTrack` (fra route.ts). Semantikk, confidence og
 * reason-verdier skal være NØYAKTIG som før flyttingen — dette er en ekstraksjon, ikke en
 * forbedring. Paritetstestene låser overlayens `languageTrack` gjennom den faktiske
 * produksjonsveien (`toPortalBundle`).
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route"; // side-effekt: registerPortalBundleRuntime (kun paritetstestene)
import { toPortalBundle } from "@/lib/portal-bundle";
import {
  isLanguageTrackSubjectKey,
  LANGUAGE_TRACK_SUBJECT_KEYS,
  resolveSchoolLanguageTrack,
} from "@/lib/school-language-track";
import type { AIAnalysisResult, SchoolWeekOverlayProposal } from "@/lib/types";

function result(overrides: Partial<AIAnalysisResult> = {}): AIAnalysisResult {
  return {
    title: "Ukeplan uke 12",
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
    extractedText: { raw: "", language: "no", confidence: 0.9 },
    ...overrides,
  };
}
function dayWithDetails(details: string): AIAnalysisResult["scheduleByDay"][number] {
  return { dayLabel: "Mandag", date: null, time: null, details, highlights: [], rememberItems: [], deadlines: [], notes: [] };
}

describe("språksporliste og predikat (eksisterende kontrakt)", () => {
  it("én autoritativ liste: tysk/spansk/fransk i stabil rekkefølge", () => {
    expect(LANGUAGE_TRACK_SUBJECT_KEYS).toEqual(["tysk", "spansk", "fransk"]);
  });
  it("isLanguageTrackSubjectKey matcher kun sporene", () => {
    expect(isLanguageTrackSubjectKey("tysk")).toBe(true);
    expect(isLanguageTrackSubjectKey("norsk")).toBe(false);
    expect(isLanguageTrackSubjectKey(null)).toBe(false);
  });
});

describe("resolveSchoolLanguageTrack — ett språk", () => {
  it("kun Tysk → resolvedTrack tysk, confidence 0.8, single_track_detected", () => {
    const r = resolveSchoolLanguageTrack(result({ scheduleByDay: [dayWithDetails("Tysk i timen: Gloser kapittel 4.")] }));
    expect(r).toEqual({ resolvedTrack: "tysk", confidence: 0.8, reason: "single_track_detected" });
  });
  it("kun Spansk (annet spor) → resolvedTrack spansk", () => {
    const r = resolveSchoolLanguageTrack(result({ description: "Spansk lekse: skriv åtte setninger." }));
    expect(r).toEqual({ resolvedTrack: "spansk", confidence: 0.8, reason: "single_track_detected" });
  });
});

describe("resolveSchoolLanguageTrack — flere språk", () => {
  it("Tysk + Spansk + Fransk → null, 0.45, multiple_tracks_detected", () => {
    const r = resolveSchoolLanguageTrack(
      result({ scheduleByDay: [dayWithDetails("Tysk: Gloser. Spansk: Verb. Fransk: Dialog.")] }),
    );
    expect(r).toEqual({ resolvedTrack: null, confidence: 0.45, reason: "multiple_tracks_detected" });
  });
});

describe("resolveSchoolLanguageTrack — ingen språk", () => {
  it("uten språkspor-tokens → null, 0.35, no_track_detected", () => {
    const r = resolveSchoolLanguageTrack(result({ scheduleByDay: [dayWithDetails("Norsk: Les kapittel 2. Matematikk: Oppgaver.")] }));
    expect(r).toEqual({ resolvedTrack: null, confidence: 0.35, reason: "no_track_detected" });
  });
});

describe("normalisering (samme semantikk som dagens funksjon)", () => {
  it("store bokstaver matches (lowercase-normalisering)", () => {
    const r = resolveSchoolLanguageTrack(result({ title: "TYSK GRUPPE UKE 12" }));
    expect(r.resolvedTrack).toBe("tysk");
  });
  it("æ/ø/å rundt token forstyrrer ikke ordgrensen", () => {
    const r = resolveSchoolLanguageTrack(result({ description: "Vi øver på spansk før prøven." }));
    expect(r).toEqual({ resolvedTrack: "spansk", confidence: 0.8, reason: "single_track_detected" });
  });
  it("token inne i sammensatt ord uten ordgrense matcher ikke (\\b-semantikk bevart)", () => {
    // «tyskland» inneholder «tysk» uten høyre ordgrense → dagens \btysk\b matcher likevel ikke.
    const r = resolveSchoolLanguageTrack(result({ description: "Tur til Tyskland." }));
    expect(r.reason).toBe("no_track_detected");
  });
});

describe("datakilder: title + description + scheduleByDay.details", () => {
  it("leser fra title", () => {
    expect(resolveSchoolLanguageTrack(result({ title: "Fransk uke 12" })).resolvedTrack).toBe("fransk");
  });
  it("leser fra description", () => {
    expect(resolveSchoolLanguageTrack(result({ description: "fransk dialog" })).resolvedTrack).toBe("fransk");
  });
  it("leser fra scheduleByDay.details", () => {
    expect(resolveSchoolLanguageTrack(result({ scheduleByDay: [dayWithDetails("fransk gloser")] })).resolvedTrack).toBe("fransk");
  });
  it("leser IKKE fra andre felt (f.eks. notes/highlights)", () => {
    const r = result();
    r.scheduleByDay = [{ dayLabel: "Mandag", date: null, time: null, details: null, highlights: ["tysk"], rememberItems: [], deadlines: [], notes: ["spansk"] }];
    expect(resolveSchoolLanguageTrack(r).reason).toBe("no_track_detected");
  });
});

describe("immutabilitet", () => {
  it("muterer ikke input", () => {
    const r = result({ title: "Tysk uke", scheduleByDay: [dayWithDetails("Tysk: Gloser.")] });
    const snap = JSON.stringify(r);
    resolveSchoolLanguageTrack(r);
    expect(JSON.stringify(r)).toBe(snap);
  });
});

/* ── Produksjonsparitet: overlayens languageTrack gjennom faktisk toPortalBundle ─────────────── */

async function overlayLanguageTrackFor(details: string[]): Promise<SchoolWeekOverlayProposal["languageTrack"] | undefined> {
  const r = result({
    title: "Ukeplan uke 12 – 2STC",
    targetGroup: "2STC",
    scheduleByDay: [
      { dayLabel: "Mandag", date: "2026-03-16", time: null, details: details[0] ?? null, highlights: [], rememberItems: [], deadlines: [], notes: [] },
      { dayLabel: "Tirsdag", date: "2026-03-17", time: null, details: details[1] ?? "Vanlig skoledag.", highlights: [], rememberItems: [], deadlines: [], notes: [] },
    ],
  });
  const bundle = (await toPortalBundle(r, "text", "school" as never, false, { knownPersons: [] })) as {
    schoolWeekOverlayProposal?: SchoolWeekOverlayProposal;
  };
  return bundle.schoolWeekOverlayProposal?.languageTrack;
}

describe("produksjonsparitet: overlay.languageTrack er uendret etter ekstraksjonen", () => {
  it("single-track-dokument → eksakt låst objekt", async () => {
    const lt = await overlayLanguageTrackFor(["Tysk i timen: Gloser kapittel 4."]);
    expect(lt).toEqual({ resolvedTrack: "tysk", confidence: 0.8, reason: "single_track_detected" });
  });
  it("multiple-track-dokument → eksakt låst objekt", async () => {
    const lt = await overlayLanguageTrackFor(["Tysk: Gloser. Spansk: Verb.", "Fransk: Dialog."]);
    expect(lt).toEqual({ resolvedTrack: null, confidence: 0.45, reason: "multiple_tracks_detected" });
  });
  it("no-track-dokument → eksakt låst objekt", async () => {
    const lt = await overlayLanguageTrackFor(["Norsk: Les kapittel 2.", "Matematikk: Oppgaver."]);
    expect(lt).toEqual({ resolvedTrack: null, confidence: 0.35, reason: "no_track_detected" });
  });
});
