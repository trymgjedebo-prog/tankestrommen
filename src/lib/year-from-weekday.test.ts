/**
 * Isolert test av ukedag→år-utledningen (hovedfiks for feil år på skole-/ukeplaner).
 * «mandag 15. juni» skal velge året der 15. juni faktisk er mandag (2026), ikke 2025.
 */
import { describe, expect, it } from "vitest";
import { isoWeekdayOfYmd, pickYearForWeekdayDate } from "@/lib/portal-week-year";

describe("isoWeekdayOfYmd", () => {
  it("15. juni 2026 = mandag (1), 15. juni 2025 = søndag (7)", () => {
    expect(isoWeekdayOfYmd(2026, 6, 15)).toBe(1);
    expect(isoWeekdayOfYmd(2025, 6, 15)).toBe(7);
  });
  it("ugyldig dato (29. feb i ikke-skuddår) → null; skuddår → gyldig", () => {
    expect(isoWeekdayOfYmd(2027, 2, 29)).toBeNull();
    expect(isoWeekdayOfYmd(2028, 2, 29)).not.toBeNull();
  });
});

describe("pickYearForWeekdayDate (ukedag→år)", () => {
  it("«mandag 15. juni» + skoleår-spenn [2025,2026] → 2026 (mekanisme A)", () => {
    expect(pickYearForWeekdayDate(6, 15, 1, [2025, 2026], 2026)).toBe(2026);
  });

  it("«mandag 15. juni» uten år-kandidater → nærmeste fremtidige år som matcher (mekanisme B)", () => {
    expect(pickYearForWeekdayDate(6, 15, 1, [], 2026)).toBe(2026);
    expect(pickYearForWeekdayDate(6, 15, 1, [], 2025)).toBe(2026); // 2025-06-15 er søndag
  });

  it("«søndag 15. juni» → 2025 (året der 15. juni faktisk er søndag)", () => {
    expect(pickYearForWeekdayDate(6, 15, 7, [2025, 2026], 2026)).toBe(2025);
  });

  it("ingen ukedag-match (umulig dato) → null → eksisterende fallback brukes", () => {
    expect(pickYearForWeekdayDate(2, 30, 1, [], 2026)).toBeNull();
  });
});
