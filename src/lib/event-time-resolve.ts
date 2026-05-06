import { isUncertainDurationContext, parseDurationMinutes } from "./parse-duration";

export type PortalTimeComputation = {
  formula: string;
  startTime?: string;
  endTime?: string;
  durationMinutes: number;
  computedEndTime?: string;
  computedStartTime?: string;
};

export type ResolvedNonFlightTimes = {
  start: string | null;
  end: string | null;
  endNextDay: boolean;
  startPreviousDay: boolean;
  durationMinutes: number | null;
  startTimeSource: "explicit" | "computed_from_duration" | "missing_or_unreadable";
  endTimeSource: "explicit" | "computed_from_duration" | "missing_or_unreadable";
  requiresManualTimeReview: boolean;
  timeComputation?: PortalTimeComputation;
};

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59)
    return null;
  return h * 60 + min;
}

function fromTotalMinutesOnClock(total: number): string {
  const n = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addMinutesToHhmm(hhmm: string, delta: number): { hhmm: string; dayOffset: number } {
  const sm = toMinutes(hhmm);
  if (sm === null) return { hhmm, dayOffset: 0 };
  const total = sm + delta;
  const dayOffset = Math.floor(total / 1440);
  return { hhmm: fromTotalMinutesOnClock(total), dayOffset };
}

function subtractMinutesFromHhmm(hhmm: string, delta: number): { hhmm: string; dayOffset: number } {
  return addMinutesToHhmm(hhmm, -delta);
}

function normalizeClockPart(raw: string): string {
  const p = raw.replace(".", ":").split(":");
  return `${String(Number(p[0])).padStart(2, "0")}:${p[1]}`;
}

/** Klokkeslett fra schedule.time: range eller enkelt. */
export function extractStartEndFromScheduleTime(time: string | null): {
  start: string | null;
  end: string | null;
} {
  if (!time?.trim()) return { start: null, end: null };
  const t = time.trim();
  const rangeMatch = /(\d{1,2}[.:]\d{2})\s*[-–]\s*(\d{1,2}[.:]\d{2})/.exec(t);
  if (rangeMatch) {
    return {
      start: normalizeClockPart(rangeMatch[1]!),
      end: normalizeClockPart(rangeMatch[2]!),
    };
  }
  const singleMatch = /(\d{1,2})[.:](\d{2})/.exec(t);
  if (singleMatch) {
    return {
      start: normalizeClockPart(`${singleMatch[1]}:${singleMatch[2]}`),
      end: null,
    };
  }
  return { start: null, end: null };
}

function extractEffectiveTimesLoose(text: string): { start: string | null; end: string | null } {
  const range = /(\d{1,2}[.:]\d{2})\s*[-–—]\s*(\d{1,2}[.:]\d{2})/.exec(text);
  if (range) {
    return {
      start: normalizeClockPart(range[1]!),
      end: normalizeClockPart(range[2]!),
    };
  }
  const single = /(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})\b/i.exec(text);
  if (single) {
    return { start: normalizeClockPart(`${single[1]}:${single[2]}`), end: null };
  }
  return { start: null, end: null };
}

/** Sluttid ofte formulert som «ferdig / landet / slutt … kl …». */
function extractEndFromNaturalLanguage(blob: string): string | null {
  const m =
    /(?:ferdig(?:e)?|land(?:et|er)|slutt|fremme|ankom(?:st)?)\b[^.!?\n]{0,72}?(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})\b/i.exec(
      blob,
    );
  if (!m) return null;
  return normalizeClockPart(`${m[1]}:${m[2]}`);
}

/** Starttid: «starter / går / avgang … kl …». */
function extractStartFromNaturalLanguage(blob: string): string | null {
  const m =
    /(?:starter|start(?:er)?|går|avgang|tar\s+til)\b[^.!?\n]{0,72}?(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})\b/i.exec(
      blob,
    );
  if (!m) return null;
  return normalizeClockPart(`${m[1]}:${m[2]}`);
}

function durationFromStartEnd(start: string, end: string, endIsNextDay: boolean): number {
  const sm = toMinutes(start)!;
  let em = toMinutes(end)!;
  if (endIsNextDay) em += 1440;
  return em - sm;
}

/**
 * Løs start/slutt/varighet for vanlige hendelser (ikke flyinfer — den håndteres separat).
 */
export function resolveNonFlightEventTimes(input: {
  timeField: string | null;
  contextBlob: string;
}): ResolvedNonFlightTimes {
  const blob = [input.timeField ?? "", input.contextBlob ?? ""].join("\n").trim();

  let start: string | null = null;
  let end: string | null = null;
  let endNextDay = false;
  let startPreviousDay = false;
  let durationMinutes: number | null = null;

  const fromField = extractStartEndFromScheduleTime(input.timeField);
  start = fromField.start;
  end = fromField.end;

  const nlEnd = extractEndFromNaturalLanguage(blob);
  const nlStart = extractStartFromNaturalLanguage(blob);
  if (!end && nlEnd) end = nlEnd;
  if (!start && nlStart) start = nlStart;

  if (!start && !end) {
    const loose = extractEffectiveTimesLoose(blob);
    if (loose.start && loose.end) {
      start = loose.start;
      end = loose.end;
    } else if (loose.start) start = loose.start;
    else if (loose.end) end = loose.end;
  }

  const uncertain = isUncertainDurationContext(blob);
  const parsedDuration = uncertain ? null : parseDurationMinutes(blob);

  let startTimeSource: ResolvedNonFlightTimes["startTimeSource"] = "missing_or_unreadable";
  let endTimeSource: ResolvedNonFlightTimes["endTimeSource"] = "missing_or_unreadable";
  let timeComputation: PortalTimeComputation | undefined;

  if (start) startTimeSource = "explicit";
  if (end) endTimeSource = "explicit";

  // Start + slutt → varighet (ev. slutt neste dag)
  if (start && end) {
    const sm = toMinutes(start)!;
    const em = toMinutes(end)!;
    if (em < sm) {
      endNextDay = true;
      durationMinutes = durationFromStartEnd(start, end, true);
    } else {
      durationMinutes = em - sm;
    }
    timeComputation = {
      formula: "end - start = durationMinutes",
      startTime: start,
      endTime: end,
      durationMinutes: durationMinutes!,
    };
  }

  // Start + varighet → slutt
  if (start && !end && parsedDuration != null && parsedDuration > 0) {
    const r = addMinutesToHhmm(start, parsedDuration);
    end = r.hhmm;
    endNextDay = r.dayOffset > 0;
    durationMinutes = parsedDuration;
    endTimeSource = "computed_from_duration";
    startTimeSource = "explicit";
    timeComputation = {
      formula: "start + duration = end",
      startTime: start,
      durationMinutes: parsedDuration,
      computedEndTime: end,
    };
  }

  // Slutt + varighet → start
  if (!start && end && parsedDuration != null && parsedDuration > 0) {
    const r = subtractMinutesFromHhmm(end, parsedDuration);
    start = r.hhmm;
    startPreviousDay = r.dayOffset < 0;
    durationMinutes = parsedDuration;
    startTimeSource = "computed_from_duration";
    endTimeSource = "explicit";
    timeComputation = {
      formula: "end - duration = start",
      endTime: end,
      durationMinutes: parsedDuration,
      computedStartTime: start,
    };
  }

  if (start && !end) {
    endTimeSource = "missing_or_unreadable";
  }
  if (!start && end) {
    startTimeSource = "missing_or_unreadable";
  }
  if (!start && !end) {
    startTimeSource = "missing_or_unreadable";
    endTimeSource = "missing_or_unreadable";
  }

  const requiresManualTimeReview = !(start && end);

  return {
    start,
    end,
    endNextDay,
    startPreviousDay,
    durationMinutes,
    startTimeSource,
    endTimeSource,
    requiresManualTimeReview,
    ...(timeComputation ? { timeComputation } : {}),
  };
}

/** Internt: skoletimeplan-syntese når kun én tid er kjent (ikke kalender-«falsk» slutt). */
export function defaultSchoolTimetableEndFromStart(start: string): string {
  const r = addMinutesToHhmm(start, 360);
  return r.hhmm;
}
