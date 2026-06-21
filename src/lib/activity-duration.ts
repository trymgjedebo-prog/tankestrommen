/**
 * Strukturert parsing av kampvarighet, ettertid og relative varighetsreferanser.
 * Brukes av cup-timing, evidence og eval.
 */

import { extractDaySourceSection } from "@/lib/analysis-evidence";
import { extractDayBlobFromCorpus } from "@/lib/cup-day-source-blob";

export type DurationEvidence = {
  totalMinutes: number;
  periodCount?: number;
  periodMinutes?: number;
  breakMinutes?: number;
  sourceQuote: string | null;
  /** true når total er arvet eller buffer er estimert/usikker. */
  inferred: boolean;
  validation: "confirmed" | "inherited" | "tentative";
};

export type BufferEvidence = {
  minutes: number;
  sourceQuote: string | null;
  estimated: boolean;
};

export type AttendanceOffsetEvidence = {
  minutes: number;
  /** 45 min før hver kamp → perMatch true */
  perMatch: boolean;
  sourceQuote: string | null;
};

export type DurationEndFact = {
  dayLabel: string | null;
  activityDurationMinutes: number | null;
  breakMinutes: number | null;
  afterBufferMinutes: number | null;
  inferredEndTime: string | null;
  endTimeSource:
    | "explicit"
    | "computed_from_duration"
    | "computed_from_duration_and_aftertime"
    | "missing_or_unreadable"
    | null;
  sourceQuotes: {
    duration?: string | null;
    buffer?: string | null;
    offset?: string | null;
  };
  validation: "confirmed" | "inherited" | "tentative" | "unsupported";
};

const DEFAULT_VAGUE_AFTER_BUFFER_MINUTES = 30;

function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

function findSourceLine(text: string, pattern: RegExp): string | null {
  for (const raw of text.replace(/\r\n/g, "\n").split(/\n/)) {
    const line = normalizeSpace(raw);
    if (line && pattern.test(line)) return line.slice(0, 280);
  }
  const flat = normalizeSpace(text);
  const m = pattern.exec(flat);
  if (!m) return null;
  return flat.slice(Math.max(0, m.index - 40), m.index + m[0].length + 80);
}

/** «2 x 20 minutter» + ev. «5 minutter pause». */
export function parseStructuredMatchDuration(text: string): DurationEvidence | null {
  const normalized = normalizeNorwegianLetters(text).toLowerCase();
  const mult =
    /\b(\d{1,2})\s*x\s*(\d{1,2})\s*min(?:utter)?\b/.exec(normalized) ||
    /\b(\d{1,2})\s*omganger?[^\d]{0,14}(\d{1,2})\s*min(?:utter)?\b/.exec(normalized);
  // Fallback: «(Én) kamp(ene) varer (ca.) N minutter» → én periode på N minutter.
  const single = mult
    ? null
    : /\bkamp(?:ene|en|er)?\b[^.!?\n]{0,30}?\bvarer\b[^.!?\n]{0,20}?(\d{1,3})\s*min(?:utter)?\b/.exec(
        normalized,
      );
  let periodCount: number;
  let periodMinutes: number;
  if (mult) {
    periodCount = Number(mult[1]);
    periodMinutes = Number(mult[2]);
  } else if (single) {
    periodCount = 1;
    periodMinutes = Number(single[1]);
  } else {
    return null;
  }
  if (!Number.isFinite(periodCount) || !Number.isFinite(periodMinutes) || periodCount <= 0 || periodMinutes <= 0) {
    return null;
  }
  let breakMinutes = 0;
  const pause =
    /(?:\+\s*|med\s+|,\s*og\s+|og\s+)(\d{1,2})\s*min(?:utter)?s?\s*pause\b/.exec(normalized) ??
    /\b(\d{1,2})\s*min(?:utter)?s?\s*pause\b/.exec(normalized);
  if (pause) {
    const p = Number(pause[1]);
    if (Number.isFinite(p) && p > 0 && p <= 45) breakMinutes = p;
  }
  const totalMinutes = periodCount * periodMinutes + breakMinutes;
  const sourceQuote =
    findSourceLine(text, /\b\d{1,2}\s*x\s*\d{1,2}\s*min/i) ??
    findSourceLine(text, /\b\d{1,2}\s*omganger?/i) ??
    findSourceLine(text, /\bvarer\s+\d{1,3}\s*min/i);
  return {
    totalMinutes,
    periodCount,
    periodMinutes,
    breakMinutes: breakMinutes || undefined,
    sourceQuote,
    inferred: false,
    validation: "confirmed",
  };
}

function referencedWeekdayFromBlob(blob: string): string | null {
  const n = normalizeNorwegianLetters(blob);
  if (/\bsamme\s+spilletid\s+som\s+fredag\b/.test(n)) return "fredag";
  if (/\bsamme\s+spilletid\s+som\s+lordag\b/.test(n)) return "lørdag";
  if (/\bsamme\s+spilletid\s+som\s+sondag\b/.test(n)) return "søndag";
  return null;
}

/** «samme spilletid som fredag» / «like lenge som de andre». */
export function parseInheritedMatchDuration(dayBlob: string, corpus: string): DurationEvidence | null {
  const n = normalizeNorwegianLetters(dayBlob);
  const refDay = referencedWeekdayFromBlob(dayBlob);
  if (refDay) {
    const refSection = extractDayBlobFromCorpus(corpus, refDay);
    const parsed = parseStructuredMatchDuration(refSection);
    if (parsed) {
      return {
        ...parsed,
        sourceQuote: findSourceLine(dayBlob, /samme\s+spilletid/i) ?? parsed.sourceQuote,
        inferred: true,
        validation: "inherited",
      };
    }
  }
  if (/\b(en\s+kamp\s+varer\s+)?like\s+lenge\s+som\s+(de\s+andre|de\s+andres)\b/.test(n)) {
    const fri = parseStructuredMatchDuration(extractDayBlobFromCorpus(corpus, "fredag"));
    if (fri) {
      return {
        ...fri,
        sourceQuote: findSourceLine(dayBlob, /like\s+lenge/i) ?? fri.sourceQuote,
        inferred: true,
        validation: "inherited",
      };
    }
  }
  return null;
}

export function resolveMatchDurationMinutes(
  dayBlob: string,
  corpus: string,
  dayLabel?: string | null,
): DurationEvidence | null {
  const blobs = [dayBlob];
  if (dayLabel) {
    const section = extractDayBlobFromCorpus(corpus, dayLabel);
    if (section.trim() && section !== dayBlob) blobs.push(section);
  }
  for (const blob of blobs) {
    const parsed = parseStructuredMatchDuration(blob);
    if (parsed) return parsed;
  }
  return parseInheritedMatchDuration(dayBlob, corpus);
}

/** Buffer/ettertid: dag-blob først, deretter hel dagseksjon fra korpus. */
export function resolvePostEventBufferForDay(
  dayBlob: string,
  corpus: string,
  dayLabel?: string | null,
): BufferEvidence | null {
  const blobs = [dayBlob];
  if (dayLabel) {
    const section = extractDayBlobFromCorpus(corpus, dayLabel);
    if (section.trim() && section !== dayBlob) blobs.push(section);
  }
  for (const blob of blobs) {
    const parsed = parsePostEventBufferMinutes(blob);
    if (parsed) return parsed;
  }
  return null;
}

/** Ettertid / buffer etter siste kamp (inkl. «omtrent en halvtime etter kampslutt»). */
export function parsePostEventBufferMinutes(text: string): BufferEvidence | null {
  const normalized = normalizeNorwegianLetters(text).toLowerCase();
  if (
    /\bberegn\s+(?:litt\s+)?tid\s+etter\s+siste\s+kamp\b/.test(normalized) ||
    /\btid\s+etter\s+siste\s+kamp\b/.test(normalized)
  ) {
    return {
      minutes: DEFAULT_VAGUE_AFTER_BUFFER_MINUTES,
      sourceQuote:
        findSourceLine(text, /beregn\s+(?:litt\s+)?tid\s+etter\s+siste\s+kamp/i) ??
        findSourceLine(text, /tid\s+etter\s+siste\s+kamp/i),
      estimated: true,
    };
  }
  if (
    /\brydding\b/.test(normalized) &&
    /\b(etter\s+siste\s+kamp|siste\s+kamp)\b/.test(normalized)
  ) {
    return {
      minutes: DEFAULT_VAGUE_AFTER_BUFFER_MINUTES,
      sourceQuote: findSourceLine(text, /rydding/i),
      estimated: true,
    };
  }
  if (/\bkort\s+prat\b/.test(normalized) && /\b(etter\s+siste\s+kamp|siste\s+kamp)\b/.test(normalized)) {
    return {
      minutes: DEFAULT_VAGUE_AFTER_BUFFER_MINUTES,
      sourceQuote: findSourceLine(text, /kort\s+prat/i),
      estimated: true,
    };
  }
  const halfAfter =
    /\b(?:ca\.?\s+|omtrent\s+)?(?:en\s+)?halvtime\s+etter\s+(?:kampslutt|kampen|siste\s+kamp)\b/.exec(
      normalized,
    ) ||
    /\b(?:ca\.?\s+|omtrent\s+)?(?:en\s+)?halv\s+time\s+etter\s+(?:kampslutt|kampen|siste\s+kamp)\b/.exec(
      normalized,
    ) ||
    /\bikke\s+(?:er\s+)?ute\s+(?:av\s+\S+\s+)?(?:for|før)\s+(?:ca\.?\s+|omtrent\s+)?(?:en\s+)?halv(?:time|\s+time)\s+etter\s+(?:kampslutt|kampen|siste\s+kamp)\b/.exec(
      normalized,
    ) ||
    /\bregn\s+med\s+at\s+dere\s+ikke\s+(?:er\s+)?ute\s+av\s+\S+\s+før\s+(?:ca\.?\s+|omtrent\s+)?(?:en\s+)?halv(?:time|\s+time)\s+etter\s+kampen\b/.exec(
      normalized,
    );
  if (halfAfter) {
    return {
      minutes: 30,
      sourceQuote: findSourceLine(text, /halv\s*time\s+etter|halvtime\s+etter/i),
      estimated: /\b(?:ca\.?|omtrent)\b/.test(halfAfter[0] ?? ""),
    };
  }
  // Tall-først: «N minutter etter siste kamp (er vi ferdige)».
  const numberFirst =
    /\b(\d{1,3})\s*min(?:utter)?\s+etter\s+(?:siste\s+kamp|kampen|kampslutt)\b/.exec(normalized);
  if (numberFirst) {
    const n = Number(numberFirst[1]);
    if (Number.isFinite(n) && n > 0 && n <= 180) {
      return {
        minutes: n,
        sourceQuote: findSourceLine(text, /\d{1,3}\s*min(?:utter)?\s+etter\s+(?:siste\s+kamp|kampen|kampslutt)/i),
        estimated: false,
      };
    }
  }
  const m =
    /\b(?:ikke\s+ute\s+for|ikke\s+ferdig\s+for|etter\s+kampen|etter\s+siste\s+kamp)\b[^.!?\n]{0,80}?(\d{1,3})\s*min(?:utter)?\b/.exec(
      normalized,
    );
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= 180) {
      return {
        minutes: n,
        sourceQuote: findSourceLine(text, new RegExp(`${n}\\s*min`, "i")),
        estimated: false,
      };
    }
  }
  return null;
}

/** Oppmøte-offset scoped til dag-blob (50 min før kampstart vs 45 før hver kamp). */
export function parseScopedAttendanceOffsetMinutes(dayBlob: string): AttendanceOffsetEvidence | null {
  const normalized = normalizeNorwegianLetters(dayBlob);
  const perMatch =
    /\b(\d{1,3})\s*min(?:utter)?\s*f[øo]r\s*hver\s+kamp\b/.exec(normalized) ||
    /\boppm[oø]te\b[^.!?\n]{0,50}?(\d{1,3})\s*min(?:utter)?\s*f[øo]r\s*hver\s+kamp\b/.exec(normalized);
  if (perMatch) {
    const n = Number(perMatch[1]);
    if (Number.isFinite(n) && n > 0 && n <= 180) {
      return {
        minutes: n,
        perMatch: true,
        sourceQuote: findSourceLine(dayBlob, /f[øo]r\s*hver\s+kamp/i),
      };
    }
  }
  const beforeStart =
    /\b(?:m[oø]t(?:er)?(?:\s+ferdig\s+skiftet)?|oppm[oø]te)\b[^.!?\n]{0,70}?(\d{1,3})\s*min(?:utter)?\s*f[øo]r\s+(?:kampstart|(?:f[øo]rste\s+|andre\s+|tredje\s+)?kamp)\b/.exec(
      normalized,
    ) ||
    /\b(\d{1,3})\s*min(?:utter)?\s*f[øo]r\s+kampstart\b/.exec(normalized);
  if (beforeStart) {
    const n = Number(beforeStart[1]);
    if (Number.isFinite(n) && n > 0 && n <= 180) {
      return {
        minutes: n,
        perMatch: false,
        sourceQuote: findSourceLine(dayBlob, /f[øo]r\s+kampstart|f[øo]r\s+kamp\b/i),
      };
    }
  }
  return null;
}

function hhmmToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  return h * 60 + mm;
}

function minutesToHhmm(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function shiftHhmm(hhmm: string, delta: number): string | null {
  const m = hhmmToMinutes(hhmm);
  if (m == null) return null;
  return minutesToHhmm(m + delta);
}

export function computeInferredDayEnd(input: {
  lastMatchTime: string | null;
  duration: DurationEvidence | null;
  buffer: BufferEvidence | null;
}): { endTime: string | null; endTimeSource: DurationEndFact["endTimeSource"] } {
  const { lastMatchTime, duration, buffer } = input;
  if (!lastMatchTime || !duration) {
    return { endTime: null, endTimeSource: "missing_or_unreadable" };
  }
  const after = buffer?.minutes ?? 0;
  if (after > 0) {
    const end = shiftHhmm(lastMatchTime, duration.totalMinutes + after);
    return end
      ? { endTime: end, endTimeSource: "computed_from_duration_and_aftertime" }
      : { endTime: null, endTimeSource: "missing_or_unreadable" };
  }
  const end = shiftHhmm(lastMatchTime, duration.totalMinutes);
  return end
    ? { endTime: end, endTimeSource: "computed_from_duration" }
    : { endTime: null, endTimeSource: "missing_or_unreadable" };
}

export function buildDurationEndFact(input: {
  dayLabel: string | null;
  dayBlob: string;
  corpus: string;
  lastMatchTime: string | null;
}): DurationEndFact {
  const duration = resolveMatchDurationMinutes(input.dayBlob, input.corpus, input.dayLabel);
  const buffer = resolvePostEventBufferForDay(input.dayBlob, input.corpus, input.dayLabel);
  const { endTime, endTimeSource } = computeInferredDayEnd({
    lastMatchTime: input.lastMatchTime,
    duration,
    buffer,
  });
  let validation: DurationEndFact["validation"] = "unsupported";
  if (duration?.validation === "confirmed" && endTime && !buffer?.estimated) validation = "confirmed";
  else if (duration?.validation === "inherited" && endTime) validation = "inherited";
  else if (endTime && (buffer?.estimated || duration?.inferred)) validation = "tentative";
  else if (endTime) validation = "confirmed";

  return {
    dayLabel: input.dayLabel,
    activityDurationMinutes: duration?.totalMinutes ?? null,
    breakMinutes: duration?.breakMinutes ?? null,
    afterBufferMinutes: buffer?.minutes ?? null,
    inferredEndTime: endTime,
    endTimeSource,
    sourceQuotes: {
      duration: duration?.sourceQuote ?? null,
      buffer: buffer?.sourceQuote ?? null,
    },
    validation,
  };
}
