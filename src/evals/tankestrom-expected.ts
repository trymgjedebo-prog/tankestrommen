import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type DayKey =
  | "mandag"
  | "tirsdag"
  | "onsdag"
  | "torsdag"
  | "fredag"
  | "lørdag"
  | "søndag";
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
  /** Forventet utledet sluttid (HH:MM) per dag — eval for varighet/ettertid. */
  inferredEndByDay?: Partial<Record<DayKey, string>>;
  /** Tillatt avvik i minutter for inferredEndByDay (default 0). */
  inferredEndToleranceMinutes?: number;
  endTimeSourceByDay?: Partial<
    Record<
      DayKey,
      | "explicit"
      | "computed_from_duration"
      | "computed_from_duration_and_aftertime"
      | "missing_or_unreadable"
    >
  >;
  durationMinutesByDay?: Partial<Record<DayKey, number>>;
  /** Klokkeslett som aldri skal dukke opp som program-highlight (f.eks. Spond-frist). */
  forbiddenProgramTimes?: string[];
  /** Hard øvre grense på antall program-barn (hallucination guard). No-op når udefinert. */
  maxChildCount?: number;
  /** Hard øvre grense på antall tasks/frister (hallucination guard). No-op når udefinert. */
  maxTaskCount?: number;
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
