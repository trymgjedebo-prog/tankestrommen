/**
 * Fag-/timeplan-diagnostikken (console + localhost-ingest) håndterer barnets timeplan og skal være
 * AV i normal produksjonsflyt:
 *   - default (ingen options) → ingen fetch, ingen timeplan-/lærer-/rom-logging
 *   - klientens timeplan (`validateClientSchoolWeeklyProfile`, kjøres når en request har schoolProfile)
 *     slår den aldri på
 *   - NODE_ENV=production sperrer selv eksplisitt `enableDiagnostics: true`
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAndNormalizeModelResponse, validateClientSchoolWeeklyProfile } from "@/lib/ai/analyze-image";

const TEACHER = "Lærer Testesen";
const ROOM = "Rom 314";

const profile = {
  gradeBand: "vg2",
  weekdays: {
    "0": {
      useSimpleDay: false,
      lessons: [
        { subjectKey: "norsk", customLabel: null, start: "08:00", end: "09:00", room: ROOM, teacher: TEACHER },
        // Utløser en fag-korreksjon (tidligere en ustyrt console-logg med fagcelle-tekst).
        { subjectKey: "naturfag", subject: "Kunst og håndverk", customLabel: null, start: "09:00", end: "10:00" },
      ],
    },
  },
};

const rawWithProfile = () =>
  JSON.stringify({ title: "Timeplan", description: "", schedule: [], scheduleByDay: [], schoolWeeklyProfile: profile });

function spyAll() {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const logged = () => logSpy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
  return { fetchSpy, logged };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("fag-/timeplan-diagnostikk er AV som default", () => {
  it("modellens timeplan: ingen fetch og ingen logging av timeplan, lærer eller rom", () => {
    const { fetchSpy, logged } = spyAll();
    const result = parseAndNormalizeModelResponse(rawWithProfile(), { now: new Date("2026-06-01T00:00:00Z") });
    expect(result.schoolWeeklyProfile).toBeTruthy(); // normaliseringen kjører fortsatt som før
    expect(fetchSpy).not.toHaveBeenCalled();
    const out = logged();
    expect(out).not.toContain("[SUBJECT-");
    expect(out).not.toContain("schoolWeeklyProfile");
    expect(out).not.toContain(TEACHER);
    expect(out).not.toContain(ROOM);
  });

  it("klientens timeplan (request med schoolProfile) slår ikke på diagnostikken", () => {
    const { fetchSpy, logged } = spyAll();
    expect(validateClientSchoolWeeklyProfile(profile)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logged()).not.toContain("[SUBJECT-");
  });
});

describe("hard sperre i produksjon", () => {
  it("NODE_ENV=production + eksplisitt enableDiagnostics: true → fortsatt ingen fetch og ingen timeplan-logging", () => {
    vi.stubEnv("NODE_ENV", "production");
    const { fetchSpy, logged } = spyAll();
    parseAndNormalizeModelResponse(rawWithProfile(), { now: new Date("2026-06-01T00:00:00Z"), enableDiagnostics: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logged()).not.toContain(TEACHER);
  });

  it("utenfor produksjon gir eksplisitt opt-in fortsatt lokal diagnostikk (mekanismen er bevart)", () => {
    const { fetchSpy, logged } = spyAll();
    parseAndNormalizeModelResponse(rawWithProfile(), { now: new Date("2026-06-01T00:00:00Z"), enableDiagnostics: true });
    expect(fetchSpy).toHaveBeenCalled();
    expect(logged()).toContain("[SUBJECT-DIAG]");
  });
});
