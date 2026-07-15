import { describe, expect, it } from "vitest";
import {
  normalizeSchoolTime,
  schoolMinutesToTime,
  schoolTimeRangesOverlap,
  schoolTimeToMinutes,
} from "@/lib/school-time";

/**
 * Deterministiske tester for de delte tidshjelperne. Faste forventninger, ingen live-LLM.
 * `normalizeSchoolTime`/`schoolMinutesToTime` låser den flyttede `normalizeHHMM`/
 * `minutesToHHMM`-adferden; overlapp-testene låser halvåpne `[start, end)`-intervaller.
 */
describe("normalizeSchoolTime (uendret normalizeHHMM-semantikk)", () => {
  it("1) HH:MM passerer uendret", () => {
    expect(normalizeSchoolTime("10:30")).toBe("10:30");
  });
  it("2) punktumformat 10.30 → 10:30", () => {
    expect(normalizeSchoolTime("10.30")).toBe("10:30");
  });
  it("3) ett-sifret time 9 → 09:00", () => {
    expect(normalizeSchoolTime("9")).toBe("09:00");
    expect(normalizeSchoolTime("9:05")).toBe("09:05");
  });
  it("4) whitespace trimmes", () => {
    expect(normalizeSchoolTime("  10:30  ")).toBe("10:30");
  });
  it("5) ugyldig time → null", () => {
    expect(normalizeSchoolTime("25:00")).toBeNull();
  });
  it("6) ugyldige minutter → null", () => {
    expect(normalizeSchoolTime("10:60")).toBeNull();
  });
  it("7) manglende verdi → null", () => {
    expect(normalizeSchoolTime(null)).toBeNull();
    expect(normalizeSchoolTime(undefined)).toBeNull();
    expect(normalizeSchoolTime("")).toBeNull();
    expect(normalizeSchoolTime("tull")).toBeNull();
  });
  it("8) 24:00 → null (låst eksisterende adferd)", () => {
    expect(normalizeSchoolTime("24:00")).toBeNull();
  });
});

describe("schoolTimeToMinutes / schoolMinutesToTime", () => {
  it("9) 00:00 → 0", () => {
    expect(schoolTimeToMinutes("00:00")).toBe(0);
  });
  it("10) 10:30 → 630", () => {
    expect(schoolTimeToMinutes("10:30")).toBe(630);
  });
  it("11) siste gyldige tidspunkt 23:59 → 1439", () => {
    expect(schoolTimeToMinutes("23:59")).toBe(1439);
  });
  it("12) ugyldig/utenfor-døgn verdi → null", () => {
    expect(schoolTimeToMinutes("25:00")).toBeNull();
    expect(schoolTimeToMinutes("24:00")).toBeNull();
    expect(schoolTimeToMinutes(null)).toBeNull();
    expect(schoolTimeToMinutes("tull")).toBeNull();
  });
  it("13) minutter → korrekt HH:MM", () => {
    expect(schoolMinutesToTime(0)).toBe("00:00");
    expect(schoolMinutesToTime(630)).toBe("10:30");
    expect(schoolMinutesToTime(1439)).toBe("23:59");
  });
  it("14) negativt minuttall → null", () => {
    expect(schoolMinutesToTime(-1)).toBeNull();
  });
  it("15) utenfor døgnområdet → null (ingen modulo-wrap)", () => {
    expect(schoolMinutesToTime(1440)).toBeNull();
    expect(schoolMinutesToTime(5000)).toBeNull();
    expect(schoolMinutesToTime(Number.NaN)).toBeNull();
  });
});

describe("schoolTimeRangesOverlap (halvåpne intervaller [start, end))", () => {
  it("16) delvis overlapp → true", () => {
    expect(schoolTimeRangesOverlap("10:00", "11:00", "10:30", "11:30")).toBe(true);
  });
  it("17) identiske intervaller → true", () => {
    expect(schoolTimeRangesOverlap("10:00", "11:00", "10:00", "11:00")).toBe(true);
  });
  it("18) berøring i endepunkt → false", () => {
    expect(schoolTimeRangesOverlap("10:00", "11:00", "11:00", "12:00")).toBe(false);
  });
  it("19) helt separate intervaller → false", () => {
    expect(schoolTimeRangesOverlap("10:00", "11:00", "13:00", "14:00")).toBe(false);
  });
  it("20) manglende sluttid → false (gjetter aldri)", () => {
    expect(schoolTimeRangesOverlap("10:00", "11:00", "10:30", null)).toBe(false);
    expect(schoolTimeRangesOverlap("10:00", null, "10:30", "11:30")).toBe(false);
  });
  it("21) reversert intervall (end <= start) → false", () => {
    expect(schoolTimeRangesOverlap("11:00", "10:00", "10:30", "11:30")).toBe(false);
    expect(schoolTimeRangesOverlap("10:00", "11:00", "11:30", "10:30")).toBe(false);
  });
  it("22) ugyldig klokkeslett → false", () => {
    expect(schoolTimeRangesOverlap("10:00", "tull", "10:30", "11:30")).toBe(false);
    expect(schoolTimeRangesOverlap("25:00", "11:00", "10:30", "11:30")).toBe(false);
  });
});
