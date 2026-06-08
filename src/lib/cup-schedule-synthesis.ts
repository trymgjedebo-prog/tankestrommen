import { buildAnalysisCorpus } from "@/lib/analysis-evidence";
import { lineLooksLikeAdministrativeDeadline } from "@/lib/cup-day-content";
import { buildCupWeekendDayBlob, filterClockTimesOwnedByCupDay } from "@/lib/cup-day-source-blob";
import { extractExplicitAttendanceHhmmTimes } from "@/lib/cup-match-times";
import {
  extractGlobalCupScheduleTimesByDay,
  isConditionalTournamentTextForDay,
} from "@/lib/cup-timing-context";
import { extractOrderedHhmmTimesFromText } from "@/lib/timed-activity-highlights";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

type CupWeekendDayKey = "fredag" | "lørdag" | "søndag";

const CUP_WEEKEND_DAYS: CupWeekendDayKey[] = ["fredag", "lørdag", "søndag"];

function normalizeSpace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

function looksLikeCupWeekendCorpus(corpus: string): boolean {
  const n = normalizeNorwegianLetters(corpus);
  if (/\b(a-plan|aplan|ukeplan|aktivitetsplan|skoleplan)\b/.test(n)) return false;
  return /\b(cup|turnering|stevne|sluttspill|seriekamp|idrett|fotball|handball|oppm[oø]te|samling|pulje|finale)\b/.test(
    n,
  );
}

function parseDayDateIso(corpus: string, day: CupWeekendDayKey): string | null {
  const yearMatch = /\b(20\d{2})\b/.exec(corpus);
  const year = yearMatch ? Number(yearMatch[1]) : 2026;
  const monthMap: Record<string, string> = {
    januar: "01",
    februar: "02",
    mars: "03",
    april: "04",
    mai: "05",
    juni: "06",
    juli: "07",
    august: "08",
    september: "09",
    oktober: "10",
    november: "11",
    desember: "12",
  };
  const dayExpr =
    day === "fredag"
      ? "(fredag|friday)"
      : day === "lørdag"
        ? "(l[øo]rdag|saturday)"
        : "(s[øo]ndag|sunday)";
  const re = new RegExp(`\\b${dayExpr}\\b[^\\n.!?]{0,20}?(\\d{1,2})\\.\\s*([a-zæøå]+)`, "i");
  const m = re.exec(corpus);
  if (!m) return null;
  const d = Number(m[2]);
  const monthRaw = normalizeNorwegianLetters(m[3] ?? "");
  const month = monthMap[monthRaw];
  if (!month || !Number.isFinite(d) || d <= 0 || d > 31) return null;
  return `${year}-${month}-${String(d).padStart(2, "0")}`;
}

function parseExplicitAttendanceTime(corpus: string, day: CupWeekendDayKey): string | null {
  const dayExpr =
    day === "fredag"
      ? "(fredag|friday)"
      : day === "lørdag"
        ? "(l[øo]rdag|saturday)"
        : "(s[øo]ndag|sunday)";
  const reDayFirst = new RegExp(
    `${dayExpr}[^\\n.!?]{0,90}?oppm[oø]te[^\\n.!?]{0,40}?kl\\.?\\s*(\\d{1,2})[:.](\\d{2})`,
    "i",
  );
  const dayFirst = reDayFirst.exec(corpus);
  if (dayFirst) return `${String(Number(dayFirst[1])).padStart(2, "0")}:${dayFirst[2]}`;

  const reAttendanceFirst = new RegExp(
    `oppm[oø]te[^\\n.!?]{0,90}?${dayExpr}[^\\n.!?]{0,40}?kl\\.?\\s*(\\d{1,2})[:.](\\d{2})`,
    "i",
  );
  const attendanceFirst = reAttendanceFirst.exec(corpus);
  if (!attendanceFirst) return null;
  return `${String(Number(attendanceFirst[1])).padStart(2, "0")}:${attendanceFirst[2]}`;
}

function hhmmOnLine(line: string): boolean {
  return /\b\d{1,2}:\d{2}\b/.test(line);
}

export function dayScheduleEntryHasConfirmedProgramTimes(day: DayScheduleEntry): boolean {
  if (day.time && /^\d{1,2}:\d{2}$/.test(day.time.trim())) {
    const timeContext = `${day.time.trim()} ${day.details ?? ""} ${day.highlights.join(" ")}`.trim();
    if (!lineLooksLikeAdministrativeDeadline(timeContext)) return true;
  }
  for (const h of day.highlights) {
    const line = normalizeSpace(h);
    if (!hhmmOnLine(line) || lineLooksLikeAdministrativeDeadline(line)) continue;
    return true;
  }
  return false;
}

export function scheduleByDayHasConfirmedCupProgram(days: DayScheduleEntry[]): boolean {
  const withProgram = days.filter(dayScheduleEntryHasConfirmedProgramTimes);
  return withProgram.length >= 2;
}

export function corpusHasConfirmedCupProgramTimes(corpus: string): boolean {
  const byDay = extractGlobalCupScheduleTimesByDay(corpus);
  return byDay.fredag.length + byDay.lordag.length > 0;
}

export function collectCupSynthesisCorpus(result: AIAnalysisResult): string {
  return [
    buildAnalysisCorpus(result),
    result.title ?? "",
    result.description ?? "",
    result.extractedText?.raw ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Original paste har bekreftede kamptider som LLM-/portal-corpus mangler. */
export function shouldMergeSourceTextForCupScheduleSynthesis(
  sourceText: string,
  result: AIAnalysisResult,
): boolean {
  const src = sourceText.trim();
  if (!src) return false;
  if (!corpusHasConfirmedCupProgramTimes(src)) return false;
  const currentCorpus = collectCupSynthesisCorpus(result);
  if (corpusHasConfirmedCupProgramTimes(currentCorpus)) return false;
  const cupLikeBlob = [src, result.title ?? "", currentCorpus].filter(Boolean).join("\n");
  return looksLikeCupWeekendCorpus(cupLikeBlob);
}

/** Bygg scheduleByDay fra narrativ cup-/helgetekst når modellen ikke strukturerte dagene. */
export function synthesizeCupScheduleByDayFromCorpus(corpus: string): DayScheduleEntry[] {
  if (!looksLikeCupWeekendCorpus(corpus) || !corpusHasConfirmedCupProgramTimes(corpus)) {
    return [];
  }

  const global = extractGlobalCupScheduleTimesByDay(corpus);
  const out: DayScheduleEntry[] = [];

  for (const day of CUP_WEEKEND_DAYS) {
    const date = parseDayDateIso(corpus, day);
    const weekendBlob = buildCupWeekendDayBlob(corpus, day).trim();
    if (!weekendBlob && !date) continue;

    const conditional = isConditionalTournamentTextForDay(weekendBlob || corpus, day);
    const globalTimes =
      day === "fredag" ? global.fredag : day === "lørdag" ? global.lordag : global.sondag;

    let matchTimes = [...globalTimes];
    if (weekendBlob && !conditional) {
      const blobTimes = extractOrderedHhmmTimesFromText(weekendBlob);
      const owned = filterClockTimesOwnedByCupDay(blobTimes, corpus, day, weekendBlob);
      if (owned.length > 0) {
        matchTimes = [...new Set([...matchTimes, ...owned])].sort((a, b) =>
          a < b ? -1 : a > b ? 1 : 0,
        );
      }
    }

    const attendanceExplicit = parseExplicitAttendanceTime(corpus, day);
    const attendanceOnly = extractExplicitAttendanceHhmmTimes(weekendBlob);
    if (attendanceExplicit) attendanceOnly.add(attendanceExplicit);
    matchTimes = matchTimes.filter((t) => !attendanceOnly.has(t));

    if (conditional) matchTimes = [];

    const noteLines = weekendBlob
      .split(/\n+/)
      .map(normalizeSpace)
      .filter((l) => l && !/\bkampoppsett\s*:/i.test(l) && !lineLooksLikeAdministrativeDeadline(l));

    const highlights: string[] = [];
    if (attendanceExplicit) highlights.push(`${attendanceExplicit} Oppmøte`);
    for (let i = 0; i < matchTimes.length; i++) {
      const t = matchTimes[i]!;
      const label =
        matchTimes.length === 1
          ? "Første kamp"
          : i === 0
            ? "Første kamp"
            : i === 1
              ? "Andre kamp"
              : "Kamp";
      highlights.push(`${t} ${label}`);
    }

    const hasProgram = highlights.some(hhmmOnLine) || Boolean(attendanceExplicit);
    const includeDay = Boolean(date) && (hasProgram || conditional || noteLines.length > 0);
    if (!includeDay) continue;

    out.push({
      dayLabel: day,
      date,
      time: attendanceExplicit ?? matchTimes[0] ?? null,
      details: null,
      highlights,
      rememberItems: [],
      deadlines: [],
      notes: noteLines,
    });
  }

  return out;
}

/**
 * Fyll inn scheduleByDay fra råtekst når cup har bekreftede kamptider men mangelfull struktur.
 * Administrative frister påvirker ikke denne pathen — de håndteres separat som tasks.
 */
export function augmentCupScheduleByDayFromCorpus(result: AIAnalysisResult): void {
  const corpus = collectCupSynthesisCorpus(result);
  if (!looksLikeCupWeekendCorpus(corpus) || !corpusHasConfirmedCupProgramTimes(corpus)) return;

  const synthesized = synthesizeCupScheduleByDayFromCorpus(corpus);
  if (synthesized.length < 2) return;

  const existing = Array.isArray(result.scheduleByDay) ? result.scheduleByDay : [];
  if (existing.length === 0 || !scheduleByDayHasConfirmedCupProgram(existing)) {
    result.scheduleByDay = synthesized;
  }
}
