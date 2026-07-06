/**
 * Unit-tester for isoWeekAndYearOfIsoDate (dato → ISO-uke/-år) — matten bak dato-basert
 * weekNumber-redundans i overlay-rutingen. Kantene som betyr noe: årsskiftet (ISO-år ≠
 * kalenderår), uke-53-år, og null ved ugyldig/ikke-ISO input (degradering).
 */
import { describe, expect, it } from "vitest";
import { isoWeekAndYearOfIsoDate } from "@/lib/portal-week-year";

describe("isoWeekAndYearOfIsoDate", () => {
  it("vanlige datoer midt i året", () => {
    expect(isoWeekAndYearOfIsoDate("2026-06-15")).toEqual({ isoYear: 2026, isoWeek: 25 }); // man
    expect(isoWeekAndYearOfIsoDate("2026-06-18")).toEqual({ isoYear: 2026, isoWeek: 25 }); // tor
    expect(isoWeekAndYearOfIsoDate("2026-06-19")).toEqual({ isoYear: 2026, isoWeek: 25 }); // fre
    expect(isoWeekAndYearOfIsoDate("2026-06-22")).toEqual({ isoYear: 2026, isoWeek: 26 }); // neste man
  });

  it("årsskifte: ISO-året kan avvike fra kalenderåret", () => {
    expect(isoWeekAndYearOfIsoDate("2025-12-29")).toEqual({ isoYear: 2026, isoWeek: 1 }); // man i uke 1/2026
    expect(isoWeekAndYearOfIsoDate("2026-01-01")).toEqual({ isoYear: 2026, isoWeek: 1 }); // tor
    expect(isoWeekAndYearOfIsoDate("2024-12-30")).toEqual({ isoYear: 2025, isoWeek: 1 }); // man i uke 1/2025
  });

  it("uke 53: 2026 starter på torsdag → har 53 uker; 1. jan 2027 (fre) tilhører uke 53/2026", () => {
    expect(isoWeekAndYearOfIsoDate("2027-01-01")).toEqual({ isoYear: 2026, isoWeek: 53 });
    expect(isoWeekAndYearOfIsoDate("2026-12-28")).toEqual({ isoYear: 2026, isoWeek: 53 }); // man i uke 53
  });

  it("ugyldig/ikke-ISO input → null (degradering: teller ikke som dato)", () => {
    expect(isoWeekAndYearOfIsoDate("2026-02-30")).toBeNull(); // ugyldig dato
    expect(isoWeekAndYearOfIsoDate("18. juni 2026")).toBeNull(); // norsk format — parses oppstrøms
    expect(isoWeekAndYearOfIsoDate("2026-6-18")).toBeNull(); // ikke zero-paddet ISO
    expect(isoWeekAndYearOfIsoDate("")).toBeNull();
  });
});
