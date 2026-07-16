import { describe, expect, it } from "vitest";
import { normalizeSchoolDateToIso } from "@/lib/school-date";

/**
 * Deterministiske tester for `normalizeSchoolDateToIso`. Ingen live-LLM, ingen klokke.
 * Forventningene er faste; validering skjer via UTC round-trip (`isoWeekdayOfYmd`).
 */
describe("normalizeSchoolDateToIso", () => {
  it("eksakt ISO passerer validert", () => {
    expect(normalizeSchoolDateToIso("2026-06-15")).toBe("2026-06-15");
  });

  it("«mandag 15. juni 2026» → 2026-06-15 (ukedagsord ignoreres)", () => {
    expect(normalizeSchoolDateToIso("mandag 15. juni 2026")).toBe("2026-06-15");
  });

  it("«15. juni 2026» uten ukedag følger eksisterende semantikk", () => {
    expect(normalizeSchoolDateToIso("15. juni 2026")).toBe("2026-06-15");
  });

  it("casing følger eksisterende semantikk", () => {
    expect(normalizeSchoolDateToIso("Mandag 15. JUNI 2026")).toBe("2026-06-15");
  });

  it("ytre whitespace håndteres", () => {
    expect(normalizeSchoolDateToIso("  2026-06-15  ")).toBe("2026-06-15");
    expect(normalizeSchoolDateToIso("  mandag 15. juni 2026 ")).toBe("2026-06-15");
  });

  it("ugyldig dag i måned → null", () => {
    expect(normalizeSchoolDateToIso("31. juni 2026")).toBeNull(); // juni har 30 dager
  });

  it("ugyldig måned → null", () => {
    expect(normalizeSchoolDateToIso("15. blahmåned 2026")).toBeNull();
    expect(normalizeSchoolDateToIso("15.13.2026")).toBeNull();
  });

  it("2026-02-30 → null", () => {
    expect(normalizeSchoolDateToIso("2026-02-30")).toBeNull();
  });

  it("gyldig skuddårsdag → korrekt ISO", () => {
    expect(normalizeSchoolDateToIso("2024-02-29")).toBe("2024-02-29");
    expect(normalizeSchoolDateToIso("29. februar 2024")).toBe("2024-02-29");
  });

  it("ugyldig skuddårsdag → null", () => {
    expect(normalizeSchoolDateToIso("2025-02-29")).toBeNull();
    expect(normalizeSchoolDateToIso("29. februar 2025")).toBeNull();
  });

  it("manglende år → null", () => {
    expect(normalizeSchoolDateToIso("15. juni")).toBeNull();
    expect(normalizeSchoolDateToIso("15.06")).toBeNull();
  });

  it("bare ukedag → null (ingen datoinferens fra ukedag)", () => {
    expect(normalizeSchoolDateToIso("mandag")).toBeNull();
  });

  it("null / undefined / tom streng → null", () => {
    expect(normalizeSchoolDateToIso(null)).toBeNull();
    expect(normalizeSchoolDateToIso(undefined)).toBeNull();
    expect(normalizeSchoolDateToIso("")).toBeNull();
    expect(normalizeSchoolDateToIso("   ")).toBeNull();
  });

  it("punktumformat følger eksisterende semantikk", () => {
    expect(normalizeSchoolDateToIso("15.06.2026")).toBe("2026-06-15");
    expect(normalizeSchoolDateToIso("15/06/2026")).toBe("2026-06-15");
  });

  it("engelsk dato følger eksisterende semantikk (ikke støttet → null)", () => {
    expect(normalizeSchoolDateToIso("15. June 2026")).toBeNull();
    expect(normalizeSchoolDateToIso("June 15 2026")).toBeNull();
  });

  it("mismatching ukedagsord følger eksisterende semantikk (ordet ignoreres)", () => {
    // 15. juni 2026 er en mandag; «søndag» valideres IKKE mot datoen.
    expect(normalizeSchoolDateToIso("søndag 15. juni 2026")).toBe("2026-06-15");
  });

  it("samme dato i ISO og norsk tekst normaliseres til identisk streng", () => {
    expect(normalizeSchoolDateToIso("2026-06-15")).toBe(
      normalizeSchoolDateToIso("mandag 15. juni 2026"),
    );
  });

  it("resultatet påvirkes ikke av lokal tidssone (ingen dag-forskyvning ved døgnkant)", () => {
    // UTC-basert bygging → ingen off-by-one uansett vertens tidssone.
    expect(normalizeSchoolDateToIso("2026-01-01")).toBe("2026-01-01");
    expect(normalizeSchoolDateToIso("2026-12-31")).toBe("2026-12-31");
  });
});
