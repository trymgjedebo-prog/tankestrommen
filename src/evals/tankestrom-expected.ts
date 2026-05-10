import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type DayKey = "fredag" | "lørdag" | "søndag";
export type TimePrecision = "exact" | "start_only" | "date_only" | "time_window";

export type ForbiddenHighlightRule = {
  day?: DayKey;
  includes: string;
};

export type RequiredTaskSpec = {
  titleIncludes: string;
  date: string | null;
  dueTime: string | null;
};

/** Hvordan live/regression forventes strukturert for scoring (default: som i dag). */
export type TankestromEvalShape = "embedded_schedule" | "single_event";

export type TankestromExpected = {
  schemaVersion: number;
  category?: string;
  /**
   * `embedded_schedule`: flerdagers parent med embeddedSchedule (cup m.m.).
   * `single_event`: en eller flere vanlige kalenderhendelser uten embedded — mappes til «barn» per dag i eval.
   */
  evalShape?: TankestromEvalShape;
  parentCount: number;
  childCount: number;
  childTitles: string[];
  highlightsByDay: Partial<Record<DayKey, string[]>>;
  requiredBringItems: string[];
  forbiddenInNotes: string[];
  forbiddenHighlights: ForbiddenHighlightRule[];
  tentativeDays: Partial<Record<DayKey, boolean>>;
  timePrecisionByDay: Partial<Record<DayKey, TimePrecision>>;
  requiredTasks: RequiredTaskSpec[];
};

export function loadTankestromExpected(absolutePath: string): TankestromExpected {
  const raw = readFileSync(absolutePath, "utf8");
  return JSON.parse(raw) as TankestromExpected;
}

export function resolveExpectedPath(repoRoot: string, fixtureId: string): string {
  return resolve(repoRoot, `fixtures/tankestrom/expected/${fixtureId}.expected.json`);
}

export function effectiveEvalShape(expected: TankestromExpected): TankestromEvalShape {
  return expected.evalShape ?? "embedded_schedule";
}
