import { isUncertainDurationContext, parseDurationMinutes } from "./parse-duration";

function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export type PortalTimeComputation = {
  formula: string;
  startTime?: string;
  endTime?: string;
  durationMinutes: number;
  computedEndTime?: string;
  computedStartTime?: string;
};

export type ResolvedTimePrecision = "exact" | "start_only" | "date_only" | "time_window";

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
  /** Kalender-semantikk for portal-metadata (ikke-cup dugnad-vindu vs eksakt intervall). */
  timePrecision: ResolvedTimePrecision;
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

/** Bindestrek, tankestreker og unicode-minus mellom klokkeslett i modell-/PDF-tekst. */
const CLOCK_RANGE_DASH = String.raw`[-–—\u2212]`;

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
  const tilRange = /(\d{1,2}[.:]\d{2})\s+til\s+(?:kl\.?\s*)?(\d{1,2}[.:]\d{2})/i.exec(t);
  if (tilRange) {
    return {
      start: normalizeClockPart(tilRange[1]!),
      end: normalizeClockPart(tilRange[2]!),
    };
  }
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

function extractEffectiveTimesLooseDetailed(text: string): {
  start: string | null;
  end: string | null;
  hadDashPair: boolean;
} {
  const range = new RegExp(
    String.raw`(\d{1,2}[.:]\d{2})\s*${CLOCK_RANGE_DASH}\s*(\d{1,2}[.:]\d{2})`,
  ).exec(text);
  if (range) {
    return {
      start: normalizeClockPart(range[1]!),
      end: normalizeClockPart(range[2]!),
      hadDashPair: true,
    };
  }
  const single = /(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})\b/i.exec(text);
  if (single) {
    return {
      start: normalizeClockPart(`${single[1]}:${single[2]}`),
      end: null,
      hadDashPair: false,
    };
  }
  return { start: null, end: null, hadDashPair: false };
}

const WEEKDAY_LINE_RES: ReadonlyArray<{ key: string; re: RegExp }> = [
  { key: "mandag", re: /\bmandag\b/i },
  { key: "tirsdag", re: /\btirsdag\b/i },
  { key: "onsdag", re: /\bonsdag\b/i },
  { key: "torsdag", re: /\btorsdag\b/i },
  { key: "fredag", re: /\bfredag\b/i },
  { key: "lordag", re: /\blørdag\b|lørdag|lordag\b/i },
  { key: "sondag", re: /\bsøndag\b|søndag|sondag\b/i },
];

function weekdayKeyFromScheduleLabel(dayLabel: string | null | undefined): string | null {
  if (!dayLabel?.trim()) return null;
  for (const { key, re } of WEEKDAY_LINE_RES) {
    if (re.test(dayLabel)) return key;
  }
  return null;
}

/**
 * Hopp over linje som kun handler om en *annen* ukedag (ingen treff på aktiv dag).
 * Linjer med både fredag og lørdag behandles videre; vindu velges med `norWindowMatchAnchoredToDayLabel`.
 */
function lineMentionsOtherWeekdayThan(line: string, scheduleDayLabel: string | null | undefined): boolean {
  const wanted = weekdayKeyFromScheduleLabel(scheduleDayLabel);
  if (!wanted) return false;
  const wantedRe = WEEKDAY_LINE_RES.find((x) => x.key === wanted)?.re;
  if (wantedRe?.test(line)) return false;
  for (const { key, re } of WEEKDAY_LINE_RES) {
    if (key === wanted) continue;
    if (re.test(line)) return true;
  }
  return false;
}

function lastMentionedWeekdayKeyBefore(text: string): string | null {
  let best: { key: string; idx: number } | null = null;
  for (const { key, re } of WEEKDAY_LINE_RES) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const globalRe = new RegExp(re.source, flags);
    let m: RegExpExecArray | null;
    while ((m = globalRe.exec(text)) !== null) {
      if (!best || m.index > best.idx) best = { key, idx: m.index };
    }
  }
  return best?.key ?? null;
}

/** Tillat mellom/fra-til-treff bare når siste ukedag før treffet matcher aktiv dag (eller ukedag mangler). */
function norWindowMatchAnchoredToDayLabel(
  line: string,
  hit: { matchIndex: number },
  scheduleDayLabel: string | null | undefined,
): boolean {
  const wanted = weekdayKeyFromScheduleLabel(scheduleDayLabel);
  if (!wanted) return true;
  const before = line.slice(0, hit.matchIndex);
  const last = lastMentionedWeekdayKeyBefore(before);
  return last == null || last === wanted;
}

function hhmmFromOptionalMinutes(hour: string, min: string | undefined): string {
  const m = min ?? "00";
  return normalizeClockPart(`${hour}:${m}`);
}

function tryNorwegianActivityClockWindowOnLine(line: string): {
  start: string;
  end: string;
  matchIndex: number;
} | null {
  const m1 =
    /\bmellom\s+(?:kl\.?\s*)?(\d{1,2})(?:[.:](\d{2}))?\s+og\s+(?:kl\.?\s*)?(\d{1,2})(?:[.:](\d{2}))?\b/i.exec(
      line,
    );
  if (m1) {
    return {
      start: hhmmFromOptionalMinutes(m1[1]!, m1[2]),
      end: hhmmFromOptionalMinutes(m1[3]!, m1[4]),
      matchIndex: m1.index,
    };
  }
  const m2 =
    /\bfra\s+(?:kl\.?\s*)?(\d{1,2})(?:[.:](\d{2}))?\s+til\s+(?:kl\.?\s*)?(\d{1,2})(?:[.:](\d{2}))?\b/i.exec(
      line,
    );
  if (m2) {
    return {
      start: hhmmFromOptionalMinutes(m2[1]!, m2[2]),
      end: hhmmFromOptionalMinutes(m2[3]!, m2[4]),
      matchIndex: m2.index,
    };
  }
  const m3 =
    /(?:kl\.?\s*)?(\d{1,2})(?:[.:](\d{2}))?\s+til\s+(?:kl\.?\s*)?(\d{1,2})(?:[.:](\d{2}))?\b/i.exec(line);
  if (m3) {
    return {
      start: hhmmFromOptionalMinutes(m3[1]!, m3[2]),
      end: hhmmFromOptionalMinutes(m3[3]!, m3[4]),
      matchIndex: m3.index,
    };
  }
  return null;
}

/**
 * «Mellom kl. 10:00 og 12:00» / «fra … til …» / «10:00 til 12:00».
 * Med `scheduleDayLabel` (typisk ukedag fra portal) unngår vi at fredag arver lørdagens vindu fra felles `description`.
 */
function extractNorwegianActivityClockWindow(
  blob: string,
  scheduleDayLabel?: string | null,
): { start: string; end: string } | null {
  const lines = blob.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const chunks = lines.length > 0 ? lines : [blob.trim()].filter(Boolean);
  if (scheduleDayLabel?.trim()) {
    for (const line of chunks) {
      if (lineMentionsOtherWeekdayThan(line, scheduleDayLabel)) continue;
      const hit = tryNorwegianActivityClockWindowOnLine(line);
      if (hit && norWindowMatchAnchoredToDayLabel(line, hit, scheduleDayLabel)) {
        return { start: hit.start, end: hit.end };
      }
    }
    const collapsed = normalizeSpace(blob);
    if (collapsed && !lineMentionsOtherWeekdayThan(collapsed, scheduleDayLabel)) {
      const hit = tryNorwegianActivityClockWindowOnLine(collapsed);
      if (hit && norWindowMatchAnchoredToDayLabel(collapsed, hit, scheduleDayLabel)) {
        return { start: hit.start, end: hit.end };
      }
    }
    return null;
  }
  for (const line of chunks) {
    const hit = tryNorwegianActivityClockWindowOnLine(line);
    if (hit) return hit;
  }
  const collapsed = normalizeSpace(blob);
  if (collapsed) {
    const hit = tryNorwegianActivityClockWindowOnLine(collapsed);
    if (hit) return hit;
  }
  return null;
}

/**
 * Om teksten inneholder formulering som tilsier aktivitetsvindu (mellom … og …, kl-range, «til»-range).
 * Brukes bl.a. for å avgjøre om modellens `extractedText.raw` allerede bærer tidsvindu-semantikk,
 * eller om original kilde bør slås inn — løs `\bmellom\b` i råtekst gir for mange falske positiver.
 */
export function textHasActivityClockWindowCue(blob: string): boolean {
  if (!normalizeSpace(blob)) return false;
  if (extractNorwegianActivityClockWindow(blob, null) != null) return true;
  const collapsed = normalizeSpace(blob);
  if (
    new RegExp(String.raw`\b(\d{1,2}[.:]\d{2})\s*${CLOCK_RANGE_DASH}\s*(\d{1,2}[.:]\d{2})\b`).test(
      collapsed,
    )
  )
    return true;
  if (/\b(\d{1,2}[.:]\d{2})\s+til\s+(?:kl\.?\s*)?(\d{1,2}[.:]\d{2})\b/i.test(collapsed)) return true;
  return false;
}

/**
 * Varighet skal bare brukes når den står i samme «blokk» som det aktuelle klokkeslettet,
 * ellers plukker flerdagers `description` feil (f.eks. «ca. 45 min» fra et foreldremøte dagen før).
 */
function parseDurationMinutesAnchoredNearHhmm(blob: string, hhmm: string | null): number | null {
  if (!hhmm?.trim()) return null;
  const needle = normalizeClockPart(hhmm.trim());
  const lines = blob.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const picked: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/\bvalgfritt\b/i.test(line)) continue;
    if (/\bforeldrem[oø]te\b/i.test(line)) continue;
    if (i > 0 && /\bvalgfritt\b/i.test(lines[i - 1]!)) continue;
    if (i > 0 && /\bforeldrem[oø]te\b/i.test(lines[i - 1]!)) continue;
    if (parseDurationMinutes(line) == null) continue;
    if (line.includes(needle)) {
      picked.push(line);
      continue;
    }
    if (i > 0 && lines[i - 1]!.includes(needle)) {
      picked.push(line);
    }
  }
  if (picked.length === 0) return null;
  return parseDurationMinutes(picked.join("\n"));
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
  /** F.eks. «lørdag» fra kalender-suffix — begrenser «mellom … og …» mot riktig dag i flerdagers tekst. */
  scheduleDayLabel?: string | null;
}): ResolvedNonFlightTimes {
  const blob = [input.timeField ?? "", input.contextBlob ?? ""].join("\n").trim();
  const dayLabel = input.scheduleDayLabel ?? null;

  let start: string | null = null;
  let end: string | null = null;
  let endNextDay = false;
  let startPreviousDay = false;
  let durationMinutes: number | null = null;
  /** Sann når start–slutt skal tolkes som aktivitetsvindu (dugnad, åpningstid), ikke «eksakt slutt». */
  let activityClockWindow = false;

  const fromField = extractStartEndFromScheduleTime(input.timeField);
  start = fromField.start;
  end = fromField.end;
  const tfTrim = input.timeField?.trim() ?? "";
  if (
    start &&
    end &&
    tfTrim &&
    (new RegExp(String.raw`(\d{1,2}[.:]\d{2})\s*${CLOCK_RANGE_DASH}\s*(\d{1,2}[.:]\d{2})`).test(
      tfTrim,
    ) ||
      /(\d{1,2}[.:]\d{2})\s+til\s+(?:kl\.?\s*)?(\d{1,2}[.:]\d{2})/i.test(tfTrim))
  ) {
    activityClockWindow = true;
  }

  const norWindow = extractNorwegianActivityClockWindow(blob, dayLabel);
  if (norWindow) {
    start = norWindow.start;
    end = norWindow.end;
    activityClockWindow = true;
  }

  const nlEnd = extractEndFromNaturalLanguage(blob);
  const nlStart = extractStartFromNaturalLanguage(blob);
  if (!end && nlEnd) end = nlEnd;
  if (!start && nlStart) start = nlStart;

  if (!start && !end) {
    const loose = extractEffectiveTimesLooseDetailed(blob);
    if (loose.start && loose.end) {
      start = loose.start;
      end = loose.end;
      if (loose.hadDashPair) activityClockWindow = true;
    } else if (loose.start) start = loose.start;
    else if (loose.end) end = loose.end;
  } else {
    const loose = extractEffectiveTimesLooseDetailed(blob);
    if (loose.hadDashPair && loose.start && loose.end) {
      if (!start) start = loose.start;
      if (!end) end = loose.end;
      activityClockWindow = true;
    }
  }

  const uncertain = isUncertainDurationContext(blob);

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
  if (start && !end && !uncertain) {
    const parsedDuration = parseDurationMinutesAnchoredNearHhmm(blob, start);
    if (parsedDuration != null && parsedDuration > 0) {
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
  }

  // Slutt + varighet → start
  if (!start && end && !uncertain) {
    const parsedDuration = parseDurationMinutesAnchoredNearHhmm(blob, end);
    if (parsedDuration != null && parsedDuration > 0) {
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

  if (endNextDay || startPreviousDay) {
    activityClockWindow = false;
  }

  const computedEnd =
    endTimeSource === "computed_from_duration" || startTimeSource === "computed_from_duration";

  let timePrecision: ResolvedTimePrecision;
  if (!start && !end) {
    timePrecision = "date_only";
  } else if (start && end) {
    if (activityClockWindow && !computedEnd) {
      timePrecision = "time_window";
    } else {
      timePrecision = "exact";
    }
  } else if (start) {
    timePrecision = "start_only";
  } else {
    timePrecision = "date_only";
  }

  if (timePrecision === "exact" && start && end && !endNextDay && !startPreviousDay) {
    const sm = toMinutes(start)!;
    const em = toMinutes(end)!;
    const gap = em - sm;
    const blobLower = blob.toLowerCase();
    const dugnadLike =
      /\bdugnad\b/i.test(blob) ||
      (/\bklubbhus/i.test(blobLower) && /\bbidra\b/i.test(blobLower));
    if (
      gap >= 30 &&
      gap <= 12 * 60 &&
      dugnadLike &&
      !/\b(kamp|fly(?:et)?|avgang|ankomst|landing|boarding)\b/i.test(blobLower)
    ) {
      timePrecision = "time_window";
    }
  }

  return {
    start,
    end,
    endNextDay,
    startPreviousDay,
    durationMinutes,
    startTimeSource,
    endTimeSource,
    requiresManualTimeReview,
    timePrecision,
    ...(timeComputation ? { timeComputation } : {}),
  };
}

/** Internt: skoletimeplan-syntese når kun én tid er kjent (ikke kalender-«falsk» slutt). */
export function defaultSchoolTimetableEndFromStart(start: string): string {
  const r = addMinutesToHhmm(start, 360);
  return r.hhmm;
}
