import { describe, expect, it } from "vitest";
import { runAllTankestromScorers, scoreNoHallucinatedEvents } from "./tankestrom-scorers";
import type { TankestromExpected } from "./tankestrom-expected";
import type { RegressionPortalBundle } from "@/lib/tankestrom-regression-fixture-runner";

function expectedWith(partial: Partial<TankestromExpected>): TankestromExpected {
  return {
    schemaVersion: 1,
    parentCount: 1,
    childCount: 0,
    childTitles: [],
    highlightsByDay: {},
    requiredBringItems: [],
    forbiddenInNotes: [],
    forbiddenHighlights: [],
    tentativeDays: {},
    timePrecisionByDay: {},
    requiredTasks: [],
    ...partial,
  };
}

function bundleWith(partial: Partial<RegressionPortalBundle>): RegressionPortalBundle {
  return { parentTitle: "Test", children: [], tasks: [], ...partial };
}

describe("scoreNoHallucinatedEvents", () => {
  it("no-op (score 1) når maxChildCount/maxTaskCount ikke er satt", () => {
    const r = scoreNoHallucinatedEvents(
      bundleWith({ tasks: [{ title: "Svar i Spond", date: null, dueTime: null }] }),
      expectedWith({}),
    );
    expect(r.score).toBe(1);
    expect(r.failures).toEqual([]);
  });

  it("ren støy (0 events / 0 tasks) er grønt mot maks 0", () => {
    const r = scoreNoHallucinatedEvents(
      bundleWith({}),
      expectedWith({ maxChildCount: 0, maxTaskCount: 0 }),
    );
    expect(r.score).toBe(1);
    expect(r.failures).toEqual([]);
  });

  it("feiler hvis en task hallusineres fra støytekst (maxTaskCount: 0)", () => {
    const r = scoreNoHallucinatedEvents(
      bundleWith({ tasks: [{ title: "Svar i Spond", date: "2026-06-12", dueTime: "20:00" }] }),
      expectedWith({ maxChildCount: 0, maxTaskCount: 0 }),
    );
    expect(r.score).toBe(0);
    expect(r.failures.length).toBeGreaterThan(0);
  });

  it("feiler hvis et program-barn hallusineres (maxChildCount: 0)", () => {
    const r = scoreNoHallucinatedEvents(
      bundleWith({
        children: [
          {
            day: "fredag",
            title: "Velkommen – fredag",
            date: "2026-06-12",
            start: null,
            timePrecision: "date_only",
            tentative: false,
            highlights: [],
            bringItems: [],
            notes: null,
          },
        ],
      }),
      expectedWith({ maxChildCount: 0, maxTaskCount: 0 }),
    );
    expect(r.score).toBe(0);
    expect(r.failures.length).toBeGreaterThan(0);
  });
});

describe("DayKey man–søn foundation", () => {
  it("scorers håndterer en ukedag utenfor fre/lør/søn (tirsdag) uten å brekke", () => {
    const bundle = bundleWith({
      parentTitle: "Klubbtrening",
      children: [
        {
          day: "tirsdag",
          title: "Klubbtrening – tirsdag",
          date: "2026-06-16",
          start: "17:00",
          timePrecision: "start_only",
          tentative: false,
          highlights: ["17:00 Trening"],
          bringItems: [],
          notes: null,
        },
      ],
    });
    const expected = expectedWith({
      parentCount: 1,
      childCount: 1,
      childTitles: ["Klubbtrening – tirsdag"],
      highlightsByDay: { tirsdag: ["17:00 Trening"] },
      timePrecisionByDay: { tirsdag: "start_only" },
      tentativeDays: { tirsdag: false },
      maxChildCount: 1,
      maxTaskCount: 0,
    });
    const { scores, failures, average } = runAllTankestromScorers(bundle, expected);
    expect(failures).toEqual([]);
    expect(average).toBe(1);
    // Bekrefter at tittel-/dag-spesifikke scorers traff riktig ukedag (tirsdag, ikke søndag-fallback).
    expect(scores.cleanTitlesCritical).toBe(1);
    expect(scores.highlightsCorrect).toBe(1);
    expect(scores.correctTimePrecision).toBe(1);
    expect(scores.tentativeCorrect).toBe(1);
  });
});
