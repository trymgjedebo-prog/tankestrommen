import {
  computeInferredDayEnd,
  parseScopedAttendanceOffsetMinutes,
  resolveMatchDurationMinutes,
  resolvePostEventBufferForDay,
} from "@/lib/activity-duration";
import { extractDayBlobFromCorpus } from "@/lib/cup-day-source-blob";
import { lineLooksLikeAdministrativeDeadline, parseCupTimeWindow } from "@/lib/cup-day-content";
import {
  extractCupMatchTimes,
  extractExplicitAttendanceHhmmTimes,
  extractKampAnchoredClockTimes,
} from "@/lib/cup-match-times";
import { resolveNonFlightEventTimes } from "@/lib/event-time-resolve";
import type { DayScheduleEntry } from "@/lib/types";

function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

function normalizeSpace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function extractAttendanceTimeFromDay(day: DayScheduleEntry): string | null {
  const pool = [day.time ?? "", day.details ?? "", ...day.highlights, ...day.notes].join("\n");
  for (const line of [day.time ?? "", ...day.highlights]) {
    const timeFirst = /\b(\d{1,2})[.:](\d{2})\s+oppm[oø]te\b/i.exec(normalizeSpace(line));
    if (timeFirst) {
      const h = Number(timeFirst[1]);
      const mm = timeFirst[2]!;
      if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:${mm}`;
    }
  }
  const fromPhrases = extractExplicitAttendanceHhmmTimes(pool);
  if (fromPhrases.size === 1) return [...fromPhrases][0]!;
  const m = /\boppm[oø]te(?:\s*kl\.?)?\s*(\d{1,2})[.:](\d{2})\b/i.exec(pool);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export type CupDayTiming = {
  start: string | null;
  end: string | null;
  attendanceTime: string | null;
  attendanceOffsetMinutes: number | null;
  durationMinutes: number | null;
  activityDurationMinutes?: number | null;
  breakMinutes?: number | null;
  postEventBufferMinutes: number | null;
  afterBufferMinutes?: number | null;
  inferredEndTime?: boolean;
  timeWindow?: { earliestStart: string; latestStart: string };
  timePrecision: "exact" | "start_only" | "date_only" | "time_window";
  startTimeSource: "explicit" | "missing_or_unreadable";
  endTimeSource:
    | "explicit"
    | "computed_from_duration"
    | "computed_from_duration_and_aftertime"
    | "missing_or_unreadable";
  requiresManualTimeReview: boolean;
  timeComputation?: {
    formula: string;
    startTime?: string;
    endTime?: string;
    durationMinutes: number;
    computedEndTime?: string;
    computedStartTime?: string;
  };
};

function hhmmFromHighlightLine(line: string): string | null {
  const m = /^(\d{1,2}):(\d{2})\b/.exec(normalizeSpace(line));
  if (!m) return null;
  const hour = Number(m[1]);
  const mm = m[2]!;
  if (hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${mm}`;
}

/** Siste kamp-klokkeslett fra highlights (hopper over oppmøte-rader). */
export function lastKampTimeFromHighlights(highlights: string[]): string | null {
  let last: string | null = null;
  for (const line of highlights) {
    const n = normalizeNorwegianLetters(line);
    if (/\boppm[oø]te\b/.test(n) && !/\b(første|andre|tredje)\s+kamp\b/.test(n)) continue;
    if (!/\bkamp\b/.test(n) && !/\bførste\s+kamp\b/.test(n) && !/\bandre\s+kamp\b/.test(n)) continue;
    const t = hhmmFromHighlightLine(line);
    if (t) last = t;
  }
  return last;
}

/** Oppmøte fra highlights når klokka er før første kamp (ekskl. feilmerket «kamp som oppmøte»). */
export function attendanceTimeFromOppmoteHighlights(
  highlights: string[],
  kampClocks: string[],
): string | null {
  const kampMins = kampClocks
    .map((t) => hhmmToMinutesLocal(t))
    .filter((x): x is number => x != null);
  const firstKampMin = kampMins.length > 0 ? Math.min(...kampMins) : null;
  for (const line of highlights) {
    if (!/\boppm[oø]te\b/i.test(line)) continue;
    const t = hhmmFromHighlightLine(line);
    if (!t) continue;
    const tm = hhmmToMinutesLocal(t);
    if (tm == null) continue;
    if (firstKampMin != null && tm >= firstKampMin) continue;
    return t;
  }
  return null;
}

function highlightIsKampNotOppmote(h: string): boolean {
  const n = normalizeNorwegianLetters(h);
  if (/\b(første|andre|tredje)\s+kamp\b/.test(n)) return true;
  if (/\bkamp\b/.test(n) && !/\boppm[oø]te\b/.test(n)) return true;
  return false;
}

/**
 * Kamptider for dag (sortert), uten rene oppmøte-klokker som ikke er kampankret.
 * Brukes av evidence og portal-enrich.
 */
export function extractOrderedCupMatchTimesForDay(
  dayBlob: string,
  corpus: string,
  highlights: string[] = [],
  dayLabel?: string | null,
): string[] {
  const scopedParts = [dayBlob.trim()];
  if (dayLabel && corpus.trim()) {
    const section = extractDayBlobFromCorpus(corpus, dayLabel).trim();
    if (section) scopedParts.push(section);
  }
  const scoped = scopedParts.filter(Boolean).join("\n").trim() || extractDayBlobFromCorpus(corpus, "");
  const kampAnchored = extractKampAnchoredClockTimes(scoped);
  const raw =
    kampAnchored.length > 0 ? kampAnchored : extractCupMatchTimes(scoped);
  const kampFromBlob = new Set(kampAnchored);
  const out: string[] = [];

  for (const t of raw) {
    const mislabeledOppmote =
      highlights.some((h) => {
        const ht = hhmmFromHighlightLine(h);
        if (ht !== t) return false;
        return /\boppm[oø]te\b/i.test(h) && !highlightIsKampNotOppmote(h);
      }) && !kampFromBlob.has(t);
    if (mislabeledOppmote) continue;
    const onlyOppmoteHighlight =
      highlights.some((h) => hhmmFromHighlightLine(h) === t && /\boppm[oø]te\b/i.test(h) && !highlightIsKampNotOppmote(h)) &&
      !highlights.some((h) => hhmmFromHighlightLine(h) === t && highlightIsKampNotOppmote(h));
    if (onlyOppmoteHighlight && !kampFromBlob.has(t)) continue;
    if (!out.includes(t)) out.push(t);
  }

  for (const h of highlights) {
    if (!highlightIsKampNotOppmote(h)) continue;
    const t = hhmmFromHighlightLine(h);
    if (t && !out.includes(t)) out.push(t);
  }

  return out.sort((a, b) => hhmmToMinutesLocal(a)! - hhmmToMinutesLocal(b)!);
}

function hhmmToMinutesLocal(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59)
    return null;
  return h * 60 + mm;
}

function minutesToHhmmLocal(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function shiftHhmmLocal(hhmm: string, delta: number): string | null {
  const m = hhmmToMinutesLocal(hhmm);
  if (m == null) return null;
  return minutesToHhmmLocal(m + delta);
}

function resolveDayScopedBlob(input: {
  day: DayScheduleEntry;
  blob: string;
  fullCorpus?: string | null;
}): string {
  const corpus = (input.fullCorpus ?? input.blob).replace(/\r\n/g, "\n").trim();
  return extractDayBlobFromCorpus(corpus, input.day.dayLabel).trim();
}

type CupWeekdayKey = "fredag" | "lordag" | "sondag";

function cupWeekdayKeyFromDayLabel(label: string | null): CupWeekdayKey | null {
  const n = normalizeNorwegianLetters(label ?? "");
  if (/\bfri(day)?|fredag\b/.test(n)) return "fredag";
  if (/\blordag|l[øo]rdag|saturday\b/.test(n)) return "lordag";
  if (/\bsondag|s[øo]ndag|sunday\b/.test(n)) return "sondag";
  return null;
}

/**
 * «Mellom … og …» i tekst om søndagskamp (f.eks. «søndagskamp mellom 10 og 12») skal ikke gi
 * `time_window` for fredag/lørdag når blob deles på tvers av cup-dager.
 */
function parseCupTimeWindowForScheduleDay(
  blob: string,
  dayLabel: string | null,
): ReturnType<typeof parseCupTimeWindow> | null {
  const tw = parseCupTimeWindow(blob);
  if (!tw) return null;
  const key = cupWeekdayKeyFromDayLabel(dayLabel);
  if (!key || key === "sondag") return tw;
  const n = normalizeNorwegianLetters(blob);
  const sundayPlayoffMellom =
    /\bmellom\b/.test(n) && /\b(sondagskamp|kamp\s+p[aå]\s+sondag)\b/.test(n);
  if (sundayPlayoffMellom) return null;
  return tw;
}

/**
 * `resolveNonFlightEventTimes` plukker opp «mellom kl. … og …» fra hele dagens blob.
 * På fredag/lørdag kan en søndagskamp-vindu-linje (deles på tvers av dager) feilaktig
 * gi sluttid / time_window i cup-stien — fjern kun slike linjer fra konteksten til non-flight-resolve.
 */
function stripSundayPlayoffClockWindowLinesForNonFlight(blob: string, dayLabel: string | null): string {
  const key = cupWeekdayKeyFromDayLabel(dayLabel);
  if (!key || key === "sondag") return blob;
  const lines = blob.split(/\r?\n/);
  const kept = lines.filter((raw) => {
    const line = raw.trim();
    if (!line) return true;
    const n = normalizeNorwegianLetters(line);
    const isSundayPlayoffWindowLine =
      /\bmellom\b/.test(n) &&
      /\b(sondagskamp|kamp\s+p[aå]\s+sondag)\b/.test(n) &&
      /\d{1,2}[.:]\d{2}/.test(line);
    return !isSundayPlayoffWindowLine;
  });
  return kept.join("\n");
}

/** Linje som inneholder «mellom kl. … og …» (samme som parseCupTimeWindow forventer). */
function findMellomClockWindowLine(blob: string): string | null {
  for (const raw of blob.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (
      /\bmellom\s+(?:kl\.?\s*)?\d{1,2}[.:]\d{2}\s+og\s+(?:kl\.?\s*)?\d{1,2}[.:]\d{2}\b/i.test(
        line,
      )
    )
      return line;
  }
  return null;
}

/**
 * Tentativ cup-«mellom»-vindu (null start/slutt) skal bare brukes når vinduet er kamp-/cup-ankret
 * på samme linje — ellers faller vi til non-flight-resolve (f.eks. dugnad mellom kl. 10 og 12).
 */
function mellomWindowLineLooksCupOriented(mellomLine: string): boolean {
  const n = normalizeNorwegianLetters(mellomLine);
  return /\b(kamp|kampstart|forste\s+kamp|første\s+kamp|andre\s+kamp|sluttspill|sondagskamp|spill\b|avkast)\b/.test(
    n,
  );
}

export function resolveCupDayTiming(input: {
  day: DayScheduleEntry;
  detailsForEvent: string | null;
  highlightsForEventFinal: string[];
  notesOnlyForEvent: string[];
  rememberForEvent: string[];
  deadlinesForEvent: string[];
  conditionalDay: boolean;
  /** Ekstra kontekst (typisk rå/description) når modellen utelater «mellom … og …» i strukturerte felt. */
  supplementalTimeContextBlob?: string | null;
  /** Full kildetekst for arv av varighet («samme spilletid som fredag»). */
  fullCorpus?: string | null;
}): CupDayTiming {
  const supplemental = normalizeSpace(input.supplementalTimeContextBlob ?? "");
  const blob = [
    input.day.time ?? "",
    input.detailsForEvent ?? "",
    ...input.highlightsForEventFinal,
    ...input.notesOnlyForEvent,
    ...input.rememberForEvent,
    ...input.deadlinesForEvent,
    ...(supplemental ? [supplemental] : []),
  ].join("\n");

  const twParsed = parseCupTimeWindowForScheduleDay(blob, input.day.dayLabel);
  const mellomLine = twParsed ? findMellomClockWindowLine(blob) : null;
  const useTentativeCupMellomWindow =
    Boolean(twParsed) &&
    !input.conditionalDay &&
    mellomLine != null &&
    mellomWindowLineLooksCupOriented(mellomLine);
  if (useTentativeCupMellomWindow && twParsed) {
    return {
      start: null,
      end: null,
      attendanceTime: null,
      attendanceOffsetMinutes: null,
      durationMinutes: null,
      postEventBufferMinutes: null,
      timeWindow: { earliestStart: twParsed.earliestStart, latestStart: twParsed.latestStart },
      timePrecision: "time_window",
      startTimeSource: "missing_or_unreadable",
      endTimeSource: "missing_or_unreadable",
      requiresManualTimeReview: true,
    };
  }

  const nonFlightBlob = stripSundayPlayoffClockWindowLinesForNonFlight(blob, input.day.dayLabel);
  const r = resolveNonFlightEventTimes({
    timeField: input.day.time,
    contextBlob: nonFlightBlob,
    scheduleDayLabel: input.day.dayLabel,
  });
  const fullCorpus = (input.fullCorpus ?? supplemental ?? blob).replace(/\r\n/g, "\n").trim();
  const dayScopedBlob = resolveDayScopedBlob({ day: input.day, blob, fullCorpus });
  const timingBlob = dayScopedBlob
    .split(/\n/)
    .filter((l) => !lineLooksLikeAdministrativeDeadline(l.trim()))
    .join("\n");
  const timingSource = timingBlob.length ? timingBlob : dayScopedBlob;
  const matchTimes = extractOrderedCupMatchTimesForDay(
    timingSource,
    fullCorpus,
    input.highlightsForEventFinal,
  );
  const durationEvidence = resolveMatchDurationMinutes(
    timingSource,
    fullCorpus,
    input.day.dayLabel,
  );
  const durationMinutes = durationEvidence?.totalMinutes ?? null;
  const breakMinutes = durationEvidence?.breakMinutes ?? null;
  const offsetEvidence = parseScopedAttendanceOffsetMinutes(timingSource);
  const attendanceOffsetMinutes = offsetEvidence?.minutes ?? null;
  const bufferEvidence = resolvePostEventBufferForDay(
    timingSource,
    fullCorpus,
    input.day.dayLabel,
  );
  const postEventBufferMinutes = bufferEvidence?.minutes ?? null;
  const afterBufferMinutes = postEventBufferMinutes;
  const firstMatch = matchTimes[0] ?? r.start;
  let lastMatch =
    matchTimes.length > 0
      ? matchTimes[matchTimes.length - 1]!
      : lastKampTimeFromHighlights(input.highlightsForEventFinal) ?? r.start;
  const explicitAttendanceFromDay = extractAttendanceTimeFromDay(input.day);
  const explicitTimesBlob = extractExplicitAttendanceHhmmTimes(blob);
  const explicitFromBlob =
    explicitTimesBlob.size === 1 ? [...explicitTimesBlob][0]! : null;
  const attendanceFromHighlights = attendanceTimeFromOppmoteHighlights(
    input.highlightsForEventFinal,
    matchTimes,
  );
  const timeFieldMatch = input.day.time?.trim()
    ? /^(\d{1,2}):(\d{2})$/.exec(input.day.time.trim())
    : null;
  const timeFieldHhmm = timeFieldMatch
    ? `${String(Number(timeFieldMatch[1])).padStart(2, "0")}:${timeFieldMatch[2]}`
    : null;
  const timeFieldAsAttendance =
    timeFieldHhmm &&
    lastMatch &&
    hhmmToMinutesLocal(timeFieldHhmm) != null &&
    hhmmToMinutesLocal(lastMatch) != null &&
    hhmmToMinutesLocal(timeFieldHhmm)! < hhmmToMinutesLocal(lastMatch)! &&
    !matchTimes.includes(timeFieldHhmm)
      ? timeFieldHhmm
      : null;
  const explicitAttendance =
    attendanceFromHighlights ??
    explicitAttendanceFromDay ??
    timeFieldAsAttendance ??
    explicitFromBlob;
  const attendanceTime =
    explicitAttendance ??
    (matchTimes[0] && attendanceOffsetMinutes != null
      ? shiftHhmmLocal(matchTimes[0], -attendanceOffsetMinutes)
      : null);

  let start: string | null = attendanceTime ?? firstMatch ?? r.start;
  let end: string | null = r.end;
  let endTimeSource: CupDayTiming["endTimeSource"] = r.end ? "explicit" : "missing_or_unreadable";
  let timeComputation: CupDayTiming["timeComputation"] | undefined;

  let inferredEndTime = false;
  if (lastMatch && durationMinutes != null) {
    end = null;
    const inferred = computeInferredDayEnd({
      lastMatchTime: lastMatch,
      duration: durationEvidence,
      buffer: bufferEvidence,
    });
    if (inferred.endTime) {
      end = inferred.endTime;
      inferredEndTime = true;
      endTimeSource =
        inferred.endTimeSource == null || inferred.endTimeSource === "missing_or_unreadable"
          ? "missing_or_unreadable"
          : inferred.endTimeSource;
      timeComputation = {
        formula:
          postEventBufferMinutes != null
            ? "lastMatch + duration + postEventBuffer = end"
            : "lastMatch + duration = end",
        startTime: lastMatch,
        durationMinutes,
        computedEndTime: inferred.endTime,
      };
    }
  }

  if (input.conditionalDay) {
    start = null;
    end = null;
    endTimeSource = "missing_or_unreadable";
  }

  let timePrecision: CupDayTiming["timePrecision"] =
    start && end ? "exact" : start ? "start_only" : "date_only";
  if (!input.conditionalDay && r.timePrecision === "time_window" && start && end) {
    const startMin = hhmmToMinutesLocal(start);
    const endMin = hhmmToMinutesLocal(end);
    const singleMatchAtWindowStart =
      matchTimes.length === 1 &&
      matchTimes[0] === start &&
      endMin != null &&
      startMin != null &&
      endMin > startMin;
    /** «mellom 10 og 12» gir ofte to treff i extractCupMatchTimes — ikke regn dem som to kamper. */
    const windowBoundary =
      r.start && r.end ? new Set<string>([r.start, r.end]) : null;
    const hasKampLikeMatchOutsideWindow =
      windowBoundary != null && matchTimes.some((t) => !windowBoundary.has(t));
    if (
      matchTimes.length === 0 ||
      singleMatchAtWindowStart ||
      (matchTimes.length > 0 && !hasKampLikeMatchOutsideWindow)
    ) {
      timePrecision = "time_window";
    }
  }

  const timeWindowForPortal =
    timePrecision === "time_window" && start && end
      ? { earliestStart: start, latestStart: end }
      : undefined;

  return {
    start,
    end,
    attendanceTime,
    attendanceOffsetMinutes: attendanceOffsetMinutes ?? null,
    durationMinutes: durationMinutes ?? null,
    activityDurationMinutes: durationMinutes ?? null,
    breakMinutes: breakMinutes ?? null,
    postEventBufferMinutes: postEventBufferMinutes ?? null,
    afterBufferMinutes: afterBufferMinutes ?? null,
    inferredEndTime: inferredEndTime || undefined,
    timePrecision,
    startTimeSource: start ? "explicit" : "missing_or_unreadable",
    endTimeSource,
    requiresManualTimeReview: !(start && end),
    ...(timeComputation ? { timeComputation } : {}),
    ...(timeWindowForPortal ? { timeWindow: timeWindowForPortal } : {}),
  };
}
