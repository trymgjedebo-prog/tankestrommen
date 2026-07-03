/**
 * Event-tid fra barnets klasse-linje (bro til #1+#3), unit-laget: enkel parser + finn
 * barnets fragment + per-klasse-garde + orkestrering. Kontrakt: null = ingen overstyring
 * (dagens event-tid beholdes); aldri gjett, aldri tøm.
 */
import { describe, expect, it } from "vitest";
import {
  findChildClassTimeLine,
  hasPerClassTimeDifferentiation,
  parseTimeRangeFromLine,
  resolveChildClassEventTimeField,
} from "@/lib/event-time-from-child-class";

const RAADGIVER_LINES = [
  "Opplegg med rådgjevarane om vidare utdanningsval.",
  "Bokinnlevering 2STA 13.10-13.40",
  "Bokinnlevering 2STB 10.00-10.30",
  "Bokinnlevering 2STC 10.30-11.00",
  "Bokinnlevering 2STD 11.00-11.30",
  "Bokinnlevering 2STE 13.40-14.10",
  "Bokinnlevering 2STF 09.30-10.00",
];

const RAADGIVER_RAW =
  "Bokinnlevering: 2STA 13.10-13.40, 2STB 10.00-10.30, 2STC 10.30-11.00, 2STD 11.00-11.30, 2STE 13.40-14.10, 2STF 09.30-10.00.";

describe("parseTimeRangeFromLine (enkel parser — vanlige formater, null ved uklarhet)", () => {
  it("vanlige range-formater parses og normaliseres", () => {
    expect(parseTimeRangeFromLine("Bokinnlevering 2STC 10:30-11:00")).toEqual({
      start: "10:30",
      end: "11:00",
    });
    expect(parseTimeRangeFromLine("10.30-11.00")).toEqual({ start: "10:30", end: "11:00" });
    expect(parseTimeRangeFromLine("10:30–11:00")).toEqual({ start: "10:30", end: "11:00" }); // en-dash
    expect(parseTimeRangeFromLine("kl 10.30-11.00")).toEqual({ start: "10:30", end: "11:00" });
    expect(parseTimeRangeFromLine("10:30 til 11:00")).toEqual({ start: "10:30", end: "11:00" });
    expect(parseTimeRangeFromLine("9.30-10.00")).toEqual({ start: "09:30", end: "10:00" });
  });

  it("kun start («kl 10:30») → start uten end", () => {
    expect(parseTimeRangeFromLine("Oppmøte kl 10:30")).toEqual({ start: "10:30" });
  });

  it("søppel/ugyldig → null (degradering)", () => {
    expect(parseTimeRangeFromLine("i morgon i gymsalen")).toBeNull();
    expect(parseTimeRangeFromLine("25:99-26:00")).toBeNull();
    expect(parseTimeRangeFromLine("11:00-10:30")).toBeNull(); // slutt før start → uklart
    expect(parseTimeRangeFromLine("rom 332-40")).toBeNull(); // romkode, ikke klokke
  });
});

describe("findChildClassTimeLine (matcher SELV barnets kode — lener seg ikke på filter)", () => {
  it("rene per-klasse-linjer → barnets linje (blant ALLE klassers)", () => {
    expect(findChildClassTimeLine(RAADGIVER_LINES, "2STC")).toBe(
      "Bokinnlevering 2STC 10.30-11.00",
    );
  });

  it("tekst-stiens komposittlinje (join('; ')) → barnets fragment, ikke første klasses", () => {
    const composite = `Frister: ${RAADGIVER_LINES.slice(1).join("; ")}`;
    expect(findChildClassTimeLine([composite], "2STC")).toBe("Bokinnlevering 2STC 10.30-11.00");
  });

  it("rå inline-liste (komma) → barnets fragment", () => {
    expect(findChildClassTimeLine([RAADGIVER_RAW], "2STC")).toBe("2STC 10.30-11.00");
  });

  it("tidsløs omtale av barnets klasse blokkerer ikke senere tids-linje", () => {
    expect(
      findChildClassTimeLine(["Til 2STC-elevane", "Bokinnlevering 2STC 10.30-11.00"], "2STC"),
    ).toBe("Bokinnlevering 2STC 10.30-11.00");
  });

  it("ingen match for barnet → null", () => {
    expect(findChildClassTimeLine(RAADGIVER_LINES, "3STG")).toBeNull();
  });
});

describe("hasPerClassTimeDifferentiation (garde mot del-tids-kapring)", () => {
  it("flere klassekoder med tider → true", () => {
    expect(hasPerClassTimeDifferentiation([RAADGIVER_RAW])).toBe(true);
    expect(hasPerClassTimeDifferentiation([null, ...RAADGIVER_LINES])).toBe(true);
  });

  it("én kode med del-tid (foreldremøte-caset) → false", () => {
    expect(
      hasPerClassTimeDifferentiation([
        "Foreldremøte i gymsalen 18:00-19:30.\n2STC framfører 18.45-19.00",
      ]),
    ).toBe(false);
  });

  it("tider uten klassekoder (vanlig event/cup) → false", () => {
    expect(hasPerClassTimeDifferentiation(["Oppmøte 08:35", "Kamp 09:20-10:00"])).toBe(false);
  });
});

describe("resolveChildClassEventTimeField (orkestrering — null = uendret event-tid)", () => {
  it("rådgiver-caset, barn=2STC → «10:30-11:00» (ikke 2STAs 13:10)", () => {
    expect(resolveChildClassEventTimeField("2STC", RAADGIVER_LINES, RAADGIVER_RAW)).toBe(
      "10:30-11:00",
    );
  });

  it("barn ukjent → null", () => {
    expect(resolveChildClassEventTimeField(null, RAADGIVER_LINES, RAADGIVER_RAW)).toBeNull();
    expect(resolveChildClassEventTimeField("  ", RAADGIVER_LINES, RAADGIVER_RAW)).toBeNull();
  });

  it("ingen per-klasse-differensiering (foreldremøte-caset) → null", () => {
    const lines = ["Foreldremøte i gymsalen.", "2STC framfører 18.45-19.00"];
    expect(
      resolveChildClassEventTimeField("2STC", lines, "Foreldremøte 18:00-19:30. 2STC framfører 18.45-19.00"),
    ).toBeNull();
  });

  it("barnets linje har kun start-tid → null (franken-fellen: maskineriet ville limt en annen klasses slutt på barnets start)", () => {
    const lines = ["Bokinnlevering 2STA 13.10-13.40", "Bokinnlevering 2STC kl 10.30"];
    expect(resolveChildClassEventTimeField("2STC", lines, lines.join("\n"))).toBeNull();
  });

  it("barnets linje uparsebar → null", () => {
    const lines = ["Bokinnlevering 2STA 13.10-13.40", "Bokinnlevering 2STC 99.99-11.00"];
    expect(resolveChildClassEventTimeField("2STC", lines, lines.join("\n"))).toBeNull();
  });
});
