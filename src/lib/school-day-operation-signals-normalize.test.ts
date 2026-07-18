/**
 * Deterministiske tester for `normalizeSchoolDayOperationSignalsRaw`. Låser at normaliseringen
 * KUN validerer/kanoniserer modellens strukturerte output — den inferer aldri operation, dato,
 * tid eller activityKind, dropper ugyldige oppføringer, dedupliserer identiske, beholder
 * motstridende (til builderen), muterer aldri input, og utelater feltet når intet gyldig gjenstår.
 */
import { describe, expect, it } from "vitest";
import { normalizeSchoolDayOperationSignalsRaw } from "@/lib/school-day-operation-signals-normalize";

/** Rå oppføring som ren record (modellen sender vilkårlig JSON). */
function raw(partial: Record<string, unknown>): Record<string, unknown> {
  return { sourceText: "kilde", confidence: 0.9, ...partial };
}

describe("normalizeSchoolDayOperationSignalsRaw", () => {
  it("ikke-array / tom array → undefined (additivt felt utelates)", () => {
    expect(normalizeSchoolDayOperationSignalsRaw(undefined)).toBeUndefined();
    expect(normalizeSchoolDayOperationSignalsRaw(null)).toBeUndefined();
    expect(normalizeSchoolDayOperationSignalsRaw("nope")).toBeUndefined();
    expect(normalizeSchoolDayOperationSignalsRaw([])).toBeUndefined();
  });

  it("tomt resultat (kun ugyldige rader) utelater feltet (undefined, ikke tom liste)", () => {
    const out = normalizeSchoolDayOperationSignalsRaw([
      raw({ operation: "bogus", date: "2026-06-17" }),
      raw({ operation: "adjust_start", date: "2026-06-17" }), // mangler effectiveStart
    ]);
    expect(out).toBeUndefined();
  });

  it("gyldig adjust_start beholdes med normalisert tid", () => {
    const out = normalizeSchoolDayOperationSignalsRaw([
      raw({ operation: "adjust_start", date: "2026-06-17", effectiveStart: "10.30" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out![0]).toMatchObject({
      operation: "adjust_start",
      date: "2026-06-17",
      effectiveStart: "10:30",
    });
  });

  it("adjust_start uten gyldig start droppes", () => {
    expect(
      normalizeSchoolDayOperationSignalsRaw([
        raw({ operation: "adjust_start", date: "2026-06-17" }),
      ]),
    ).toBeUndefined();
    expect(
      normalizeSchoolDayOperationSignalsRaw([
        raw({ operation: "adjust_start", date: "2026-06-17", effectiveStart: "25:99" }),
      ]),
    ).toBeUndefined();
  });

  it("adjust_start konstruerer ALDRI en sluttid", () => {
    const out = normalizeSchoolDayOperationSignalsRaw([
      raw({
        operation: "adjust_start",
        date: "2026-06-17",
        effectiveStart: "10:30",
        effectiveEnd: "14:00", // ignoreres for adjust_start
      }),
    ]);
    expect(out![0]).not.toHaveProperty("effectiveEnd");
  });

  it("gyldig adjust_end beholdes; konstruerer ALDRI en starttid", () => {
    const out = normalizeSchoolDayOperationSignalsRaw([
      raw({
        operation: "adjust_end",
        date: "2026-06-17",
        effectiveEnd: "13.15",
        effectiveStart: "08:00", // ignoreres for adjust_end
      }),
    ]);
    expect(out![0]).toMatchObject({ operation: "adjust_end", effectiveEnd: "13:15" });
    expect(out![0]).not.toHaveProperty("effectiveStart");
  });

  it("adjust_end uten gyldig slutt droppes", () => {
    expect(
      normalizeSchoolDayOperationSignalsRaw([
        raw({ operation: "adjust_end", date: "2026-06-17" }),
      ]),
    ).toBeUndefined();
  });

  it("gyldig replace_day med null tider beholdes (nullable, ikke droppet)", () => {
    const out = normalizeSchoolDayOperationSignalsRaw([
      raw({ operation: "replace_day", date: "2026-06-19", activityKind: "trip_day" }),
    ]);
    expect(out![0]).toMatchObject({
      operation: "replace_day",
      activityKind: "trip_day",
      effectiveStart: null,
      effectiveEnd: null,
    });
  });

  it("gyldig replace_day med eksplisitte tider beholdes", () => {
    const out = normalizeSchoolDayOperationSignalsRaw([
      raw({
        operation: "replace_day",
        date: "2026-06-19",
        activityKind: "activity_day",
        effectiveStart: "09.00",
        effectiveEnd: "12.00",
      }),
    ]);
    expect(out![0]).toMatchObject({
      operation: "replace_day",
      activityKind: "activity_day",
      effectiveStart: "09:00",
      effectiveEnd: "12:00",
    });
  });

  it("replace_day med ugyldig eksplisitt tid REPARERES IKKE → null (ikke droppet)", () => {
    const out = normalizeSchoolDayOperationSignalsRaw([
      raw({
        operation: "replace_day",
        date: "2026-06-19",
        activityKind: "activity_day",
        effectiveStart: "tull",
        effectiveEnd: "99:99",
      }),
    ]);
    expect(out![0]).toMatchObject({ effectiveStart: null, effectiveEnd: null });
  });

  it("replace_day uten gyldig activityKind droppes", () => {
    expect(
      normalizeSchoolDayOperationSignalsRaw([
        raw({ operation: "replace_day", date: "2026-06-19" }),
      ]),
    ).toBeUndefined();
    expect(
      normalizeSchoolDayOperationSignalsRaw([
        raw({ operation: "replace_day", date: "2026-06-19", activityKind: "party_day" }),
      ]),
    ).toBeUndefined();
  });

  it("ukjent operation droppes", () => {
    expect(
      normalizeSchoolDayOperationSignalsRaw([
        raw({ operation: "delay", date: "2026-06-17", effectiveStart: "10:30" }),
      ]),
    ).toBeUndefined();
  });

  it("manglende sourceText droppes (påkrevd evidens)", () => {
    expect(
      normalizeSchoolDayOperationSignalsRaw([
        { operation: "adjust_start", date: "2026-06-17", effectiveStart: "10:30", confidence: 0.9 },
      ]),
    ).toBeUndefined();
  });

  it("ugyldig dato droppes når ingen annen gyldig dagsscope finnes", () => {
    expect(
      normalizeSchoolDayOperationSignalsRaw([
        raw({ operation: "adjust_start", date: "2026-13-40", effectiveStart: "10:30" }),
      ]),
    ).toBeUndefined();
  });

  it("gyldig weekdayIndex uten dato beholdes", () => {
    const out = normalizeSchoolDayOperationSignalsRaw([
      raw({ operation: "adjust_start", weekdayIndex: "2", effectiveStart: "10:30" }),
    ]);
    expect(out![0]).toMatchObject({ date: null, weekdayIndex: "2", operation: "adjust_start" });
  });

  it("dato/weekday-konflikt droppes (ingen auto-korreksjon)", () => {
    // 2026-06-17 er onsdag ("2"); weekdayIndex "0" (mandag) er inkonsistent → dropp.
    expect(
      normalizeSchoolDayOperationSignalsRaw([
        raw({
          operation: "adjust_start",
          date: "2026-06-17",
          weekdayIndex: "0",
          effectiveStart: "10:30",
        }),
      ]),
    ).toBeUndefined();
  });

  it("konsistent dato + weekday beholdes", () => {
    const out = normalizeSchoolDayOperationSignalsRaw([
      raw({
        operation: "adjust_start",
        date: "2026-06-17",
        weekdayIndex: "2",
        effectiveStart: "10:30",
      }),
    ]);
    expect(out![0]).toMatchObject({ date: "2026-06-17", weekdayIndex: "2" });
  });

  it("kun dayLabel kan brukes når dato/weekday mangler", () => {
    const out = normalizeSchoolDayOperationSignalsRaw([
      raw({ operation: "adjust_start", dayLabel: "onsdag", effectiveStart: "10:30" }),
    ]);
    expect(out![0]).toMatchObject({ date: null, weekdayIndex: null, dayLabel: "onsdag" });
  });

  it("identiske entries dedupliseres", () => {
    const one = raw({ operation: "adjust_start", date: "2026-06-17", effectiveStart: "10:30" });
    const out = normalizeSchoolDayOperationSignalsRaw([one, { ...one }]);
    expect(out).toHaveLength(1);
  });

  it("motstridende entries for samme dag beholdes BEGGE (builderen avgjør konflikt)", () => {
    const out = normalizeSchoolDayOperationSignalsRaw([
      raw({ operation: "adjust_start", date: "2026-06-17", effectiveStart: "10:30" }),
      raw({
        operation: "replace_day",
        date: "2026-06-17",
        activityKind: "exam_day",
        effectiveStart: "09:00",
        effectiveEnd: "12:00",
      }),
    ]);
    expect(out).toHaveLength(2);
    expect(new Set(out!.map((s) => s.operation))).toEqual(new Set(["adjust_start", "replace_day"]));
  });

  it("rekkefølge-uavhengig: samme råsett i ulik rekkefølge gir identisk output", () => {
    const a = raw({ operation: "adjust_start", date: "2026-06-17", effectiveStart: "10:30" });
    const b = raw({
      operation: "replace_day",
      date: "2026-06-19",
      activityKind: "activity_day",
      effectiveStart: "09:00",
      effectiveEnd: "12:00",
    });
    const out1 = normalizeSchoolDayOperationSignalsRaw([a, b]);
    const out2 = normalizeSchoolDayOperationSignalsRaw([b, a]);
    expect(out1).toEqual(out2);
  });

  it("input muteres ikke", () => {
    const input = [
      raw({ operation: "adjust_start", date: "2026-06-17", effectiveStart: "10.30" }),
    ];
    const snapshot = JSON.stringify(input);
    normalizeSchoolDayOperationSignalsRaw(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("confidence clampes til 0–1 (manglende/ugyldig → 0)", () => {
    const out = normalizeSchoolDayOperationSignalsRaw([
      { operation: "adjust_start", date: "2026-06-17", effectiveStart: "10:30", sourceText: "x", confidence: 5 },
      { operation: "adjust_end", weekdayIndex: "3", effectiveEnd: "13:00", sourceText: "y" },
    ]);
    const byOp = Object.fromEntries(out!.map((s) => [s.operation, s.confidence]));
    expect(byOp.adjust_start).toBe(1);
    expect(byOp.adjust_end).toBe(0);
  });
});
