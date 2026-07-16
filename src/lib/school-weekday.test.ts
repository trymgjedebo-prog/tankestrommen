import { describe, expect, it } from "vitest";
import {
  detectIsoWeekdayFromLabel,
  normalizeSchoolWeekdayIndex,
  schoolWeekdayIndexFromIsoDate,
} from "@/lib/school-weekday";

/**
 * Deterministiske tester. `normalizeSchoolWeekdayIndex`/`detectIsoWeekdayFromLabel` låser den
 * uendrede semantikken til de flyttede `canonicalSchoolProfileWeekdayIndex`/`detectIsoWeekday`;
 * `schoolWeekdayIndexFromIsoDate` er den nye, rene ISO-dato-helperen (UTC + round-trip).
 */
describe("normalizeSchoolWeekdayIndex (uendret canonical-semantikk)", () => {
  it("mandag → '0', fredag → '4'", () => {
    expect(normalizeSchoolWeekdayIndex("mandag")).toBe("0");
    expect(normalizeSchoolWeekdayIndex("fredag")).toBe("4");
  });
  it("casing behandles som før", () => {
    expect(normalizeSchoolWeekdayIndex("MANDAG")).toBe("0");
    expect(normalizeSchoolWeekdayIndex("Torsdag")).toBe("3");
  });
  it("whitespace kollapses som før (og trailing punktum fjernes)", () => {
    expect(normalizeSchoolWeekdayIndex("  mandag  ")).toBe("0");
    expect(normalizeSchoolWeekdayIndex("ons dag")).toBe("2"); // all whitespace fjernes
    expect(normalizeSchoolWeekdayIndex("fre.")).toBe("4");
  });
  it("eksisterende engelske former", () => {
    expect(normalizeSchoolWeekdayIndex("monday")).toBe("0");
    expect(normalizeSchoolWeekdayIndex("wednesday")).toBe("2");
    expect(normalizeSchoolWeekdayIndex("mon")).toBe("0");
    expect(normalizeSchoolWeekdayIndex("fri")).toBe("4");
  });
  it("eksisterende norske forkortelser", () => {
    expect(normalizeSchoolWeekdayIndex("man")).toBe("0");
    expect(normalizeSchoolWeekdayIndex("tir")).toBe("1");
    expect(normalizeSchoolWeekdayIndex("fre")).toBe("4");
  });
  it("eksisterende numerisk form '0'–'4'", () => {
    expect(normalizeSchoolWeekdayIndex("0")).toBe("0");
    expect(normalizeSchoolWeekdayIndex("4")).toBe("4");
    expect(normalizeSchoolWeekdayIndex("5")).toBeNull(); // utenfor man–fre
  });
  it("lørdag og søndag → null (norsk + engelsk)", () => {
    expect(normalizeSchoolWeekdayIndex("lørdag")).toBeNull();
    expect(normalizeSchoolWeekdayIndex("søndag")).toBeNull();
    expect(normalizeSchoolWeekdayIndex("laurdag")).toBeNull();
    expect(normalizeSchoolWeekdayIndex("saturday")).toBeNull();
    expect(normalizeSchoolWeekdayIndex("sunday")).toBeNull();
    expect(normalizeSchoolWeekdayIndex("sat")).toBeNull();
  });
  it("ukjent tekst → null (ingen friteksttolkning)", () => {
    expect(normalizeSchoolWeekdayIndex("Mandag 15. juni")).toBeNull(); // gammel adferd: kollaps → ikke-match
    expect(normalizeSchoolWeekdayIndex("bogus")).toBeNull();
  });
  it("null / undefined / tom → null", () => {
    expect(normalizeSchoolWeekdayIndex(null)).toBeNull();
    expect(normalizeSchoolWeekdayIndex(undefined)).toBeNull();
    expect(normalizeSchoolWeekdayIndex("")).toBeNull();
    expect(normalizeSchoolWeekdayIndex("   ")).toBeNull();
  });
});

describe("detectIsoWeekdayFromLabel (uendret detectIsoWeekday-semantikk)", () => {
  it("mandag → 1, fredag → 5", () => {
    expect(detectIsoWeekdayFromLabel("mandag")).toBe(1);
    expect(detectIsoWeekdayFromLabel("fredag")).toBe(5);
  });
  it("helg følger eksisterende adferd (6/7, ikke null)", () => {
    expect(detectIsoWeekdayFromLabel("lørdag")).toBe(6);
    expect(detectIsoWeekdayFromLabel("søndag")).toBe(7);
  });
  it("ord-grense-detektor i fritekst (annet ansvar enn normalize)", () => {
    expect(detectIsoWeekdayFromLabel("Mandag 15. juni")).toBe(1);
  });
  it("ukjent label / null → null", () => {
    expect(detectIsoWeekdayFromLabel("bogus")).toBeNull();
    expect(detectIsoWeekdayFromLabel(null)).toBeNull();
    expect(detectIsoWeekdayFromLabel("")).toBeNull();
  });
});

describe("schoolWeekdayIndexFromIsoDate (ny, UTC + round-trip)", () => {
  it("mandag-dato → '0', fredag-dato → '4'", () => {
    expect(schoolWeekdayIndexFromIsoDate("2026-06-15")).toBe("0");
    expect(schoolWeekdayIndexFromIsoDate("2026-06-19")).toBe("4");
  });
  it("lørdag og søndag → null", () => {
    expect(schoolWeekdayIndexFromIsoDate("2026-06-20")).toBeNull();
    expect(schoolWeekdayIndexFromIsoDate("2026-06-21")).toBeNull();
  });
  it("ugyldig kalenderdato → null", () => {
    expect(schoolWeekdayIndexFromIsoDate("2026-02-30")).toBeNull();
    expect(schoolWeekdayIndexFromIsoDate("2025-02-29")).toBeNull(); // ikke skuddår
  });
  it("skuddårsdato valideres korrekt", () => {
    expect(schoolWeekdayIndexFromIsoDate("2024-02-29")).toBe("3"); // gyldig skuddår → torsdag
  });
  it("ikke-ISO-format → null", () => {
    expect(schoolWeekdayIndexFromIsoDate("15.06.2026")).toBeNull();
    expect(schoolWeekdayIndexFromIsoDate("2026-6-15")).toBeNull();
    expect(schoolWeekdayIndexFromIsoDate("mandag")).toBeNull();
  });
  it("ytre whitespace rundt gyldig ISO-dato håndteres", () => {
    expect(schoolWeekdayIndexFromIsoDate("  2026-06-15  ")).toBe("0");
  });
  it("null / undefined / tom → null", () => {
    expect(schoolWeekdayIndexFromIsoDate(null)).toBeNull();
    expect(schoolWeekdayIndexFromIsoDate(undefined)).toBeNull();
    expect(schoolWeekdayIndexFromIsoDate("")).toBeNull();
  });
});
