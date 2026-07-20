/**
 * Enhetstester for den delte day-operation-resolusjonen (ekstrahert fra school-block-proposal.ts,
 * null tilsiktet atferdsendring). Låser mapping (signal → wire-operasjon) og konflikt-/dedup-regelen
 * EKSAKT som builderen brukte den. Ingen nye produktregler.
 *
 * NB: i produksjonsflyten kalles `resolveSchoolDayOperationConflict` alltid med ≥1 IKKE-none
 * operasjon (`schoolDayOperationFromSignal` returnerer aldri `none`; en dag uten gyldig signal
 * havner aldri i operasjonslista). Tom liste er derfor en defensiv, ikke-produksjonssti.
 */
import { describe, expect, it } from "vitest";
import {
  resolveSchoolDayOperationConflict,
  schoolDayOperationFromSignal,
} from "@/lib/school-day-operation-resolution";
import type { SchoolBlockDayOperation, SchoolDayOperationSignal } from "@/lib/types";

const adjustStartSignal: SchoolDayOperationSignal = {
  operation: "adjust_start",
  date: "2026-03-02",
  weekdayIndex: "0",
  dayLabel: "mandag",
  effectiveStart: "10:30",
  reason: "Oppmøte 10.30",
  sourceText: "Elevens oppmøte kl. 10.30.",
  confidence: 0.9,
};
const adjustEndSignal: SchoolDayOperationSignal = {
  operation: "adjust_end",
  date: "2026-03-02",
  weekdayIndex: "0",
  dayLabel: "mandag",
  effectiveEnd: "13:15",
  reason: null,
  sourceText: "Skoledagen slutter 13.15.",
  confidence: 0.8,
};
const replaceDaySignal: SchoolDayOperationSignal = {
  operation: "replace_day",
  date: "2026-03-06",
  weekdayIndex: "4",
  dayLabel: "fredag",
  activityKind: "activity_day",
  effectiveStart: "09:00",
  effectiveEnd: "12:00",
  reason: "Aktivitetsdag",
  sourceText: "Opplegg 09.00–12.00.",
  confidence: 0.95,
};

describe("schoolDayOperationFromSignal", () => {
  it("adjust_start: bevarer effectiveStart, reason, confidence (ingen sluttid)", () => {
    expect(schoolDayOperationFromSignal(adjustStartSignal)).toEqual({
      op: "adjust_start",
      effectiveStart: "10:30",
      reason: "Oppmøte 10.30",
      confidence: 0.9,
    });
  });

  it("adjust_end: bevarer effectiveEnd, reason, confidence (ingen starttid)", () => {
    expect(schoolDayOperationFromSignal(adjustEndSignal)).toEqual({
      op: "adjust_end",
      effectiveEnd: "13:15",
      reason: null,
      confidence: 0.8,
    });
  });

  it("replace_day: bevarer activityKind, effectiveStart, effectiveEnd, reason, confidence", () => {
    expect(schoolDayOperationFromSignal(replaceDaySignal)).toEqual({
      op: "replace_day",
      activityKind: "activity_day",
      effectiveStart: "09:00",
      effectiveEnd: "12:00",
      reason: "Aktivitetsdag",
      confidence: 0.95,
    });
  });

  it("replace_day med nullable tider bevarer null", () => {
    const op = schoolDayOperationFromSignal({ ...replaceDaySignal, effectiveStart: null, effectiveEnd: null });
    expect(op).toMatchObject({ op: "replace_day", effectiveStart: null, effectiveEnd: null });
  });

  it("returnerer aldri op: none for noen signaltype", () => {
    for (const s of [adjustStartSignal, adjustEndSignal, replaceDaySignal]) {
      expect(schoolDayOperationFromSignal(s).op).not.toBe("none");
    }
  });

  it("muterer ikke input-signalet", () => {
    const snap = JSON.stringify(adjustStartSignal);
    schoolDayOperationFromSignal(adjustStartSignal);
    expect(JSON.stringify(adjustStartSignal)).toBe(snap);
  });
});

describe("resolveSchoolDayOperationConflict", () => {
  const start = (t: string, conf = 0.9, reason: string | null = null): SchoolBlockDayOperation => ({ op: "adjust_start", effectiveStart: t, reason, confidence: conf });

  it("tom liste → { op: none } (defensiv, ikke-produksjonssti)", () => {
    expect(resolveSchoolDayOperationConflict([])).toEqual({ kind: "operation", dayOperation: { op: "none" } });
  });

  it("én operasjon → den operasjonen", () => {
    const op = schoolDayOperationFromSignal(adjustStartSignal);
    expect(resolveSchoolDayOperationConflict([op])).toEqual({ kind: "operation", dayOperation: op });
  });

  it("identiske operasjoner (samme signatur) kollapses til én", () => {
    const a = start("10:30", 0.7, "a");
    const b = start("10:30", 0.95, "b"); // høyest confidence vinner deterministisk
    expect(resolveSchoolDayOperationConflict([a, b])).toEqual({ kind: "operation", dayOperation: b });
  });

  it("to ULIKE operasjoner (ulik signatur) → konflikt", () => {
    const op1 = schoolDayOperationFromSignal(adjustStartSignal);
    const op2 = schoolDayOperationFromSignal({ ...replaceDaySignal, date: "2026-03-02" });
    expect(resolveSchoolDayOperationConflict([op1, op2])).toEqual({ kind: "conflict" });
  });

  it("ulik effektiv tid = ulik signatur → konflikt", () => {
    expect(resolveSchoolDayOperationConflict([start("10:30"), start("11:00")])).toEqual({ kind: "conflict" });
  });

  it("rekkefølge-uavhengig: samme sett i motsatt rekkefølge gir identisk utfall", () => {
    const a = start("10:30", 0.7, "a");
    const b = start("10:30", 0.95, "b");
    expect(resolveSchoolDayOperationConflict([a, b])).toEqual(resolveSchoolDayOperationConflict([b, a]));
    const op1 = schoolDayOperationFromSignal(adjustStartSignal);
    const op2 = schoolDayOperationFromSignal({ ...replaceDaySignal, date: "2026-03-02" });
    expect(resolveSchoolDayOperationConflict([op1, op2])).toEqual(resolveSchoolDayOperationConflict([op2, op1]));
  });

  it("muterer ikke input-lista", () => {
    const ops = [start("10:30", 0.7, "a"), start("10:30", 0.95, "b")];
    const snap = JSON.stringify(ops);
    resolveSchoolDayOperationConflict(ops);
    expect(JSON.stringify(ops)).toBe(snap);
  });
});

describe("none som nøytral fraværsverdi (hardening)", () => {
  const none: SchoolBlockDayOperation = { op: "none" };
  const start = (t: string, conf = 0.9, reason: string | null = null): SchoolBlockDayOperation => ({ op: "adjust_start", effectiveStart: t, reason, confidence: conf });
  const replace: SchoolBlockDayOperation = { op: "replace_day", activityKind: "activity_day", effectiveStart: "09:00", effectiveEnd: "12:00", reason: null, confidence: 0.9 };

  it("bare én none → { op: none }", () => {
    expect(resolveSchoolDayOperationConflict([none])).toEqual({ kind: "operation", dayOperation: { op: "none" } });
  });

  it("flere none → { op: none }", () => {
    expect(resolveSchoolDayOperationConflict([none, none])).toEqual({ kind: "operation", dayOperation: { op: "none" } });
  });

  it("none + én adjust_start → den aktive operasjonen", () => {
    const active = start("10:30", 0.9, "Senere oppmøte");
    expect(resolveSchoolDayOperationConflict([none, active])).toEqual({ kind: "operation", dayOperation: active });
  });

  it("adjust_start + none i motsatt rekkefølge → deep-equal (none ignoreres)", () => {
    const active = start("10:30", 0.9, "Senere oppmøte");
    expect(resolveSchoolDayOperationConflict([none, active])).toEqual(resolveSchoolDayOperationConflict([active, none]));
  });

  it("none + to identiske aktive operasjoner → kollapses til én (none ignorert)", () => {
    const a = start("10:30", 0.7, "a");
    const b = start("10:30", 0.95, "b"); // høyest confidence vinner
    expect(resolveSchoolDayOperationConflict([none, a, b])).toEqual({ kind: "operation", dayOperation: b });
  });

  it("none + to motstridende aktive operasjoner → konflikt (kun aktive teller)", () => {
    expect(resolveSchoolDayOperationConflict([none, start("10:30"), replace])).toEqual({ kind: "conflict" });
  });

  it("inputrekkefølge påvirker ikke resultatet (med none spredt inn)", () => {
    const a = start("10:30");
    expect(resolveSchoolDayOperationConflict([none, a, replace])).toEqual(resolveSchoolDayOperationConflict([replace, none, a]));
  });

  it("muterer ikke input-lista med none", () => {
    const ops = [none, start("10:30", 0.9, "x")];
    const snap = JSON.stringify(ops);
    resolveSchoolDayOperationConflict(ops);
    expect(JSON.stringify(ops)).toBe(snap);
  });
});
