import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCupStructuredDayContent,
  cupLineNormKey,
  enrichCupStructuredContentWithResolvedTiming,
  formatCupEventNotesFlat,
  isBringItemsSignal,
  lineLooksLikeAdministrativeDeadline,
  parseCupTimeWindow,
} from "@/lib/cup-day-content";
import { extractOrderedHhmmTimesFromText } from "@/lib/timed-activity-highlights";
import {
  extractGlobalCupScheduleTimesByDay,
  isConditionalTournamentTextForDay,
} from "@/lib/cup-timing-context";

export type DayKey = "fredag" | "lørdag" | "søndag";
export type TimePrecision = "exact" | "start_only" | "date_only" | "time_window";

export type RegressionChild = {
  day: DayKey;
  title: string;
  date: string | null;
  start: string | null;
  timePrecision: TimePrecision;
  tentative: boolean;
  highlights: string[];
  bringItems: string[];
  notes: string | null;
};

export type RegressionPortalBundle = {
  parentTitle: string;
  children: RegressionChild[];
  tasks: Array<{
    title: string;
    date: string | null;
    dueTime: string | null;
  }>;
};

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

/** Unngå at «kl.» og «18. september»-datoer blir falske setningsgrenser (ødelegger blob for cup-dager). */
const MASK_DOT = "\uE040";

function maskNorwegianNonSentenceDots(line: string): string {
  const months =
    "januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember";
  const dateDot = new RegExp(`\\b(\\d{1,2})\\.(\s+)(${months})\\b`, "gi");
  return line.replace(/\bkl\./gi, `kl${MASK_DOT}`).replace(dateDot, (_m, d, sp, mo) => `${d}${MASK_DOT}${sp}${mo}`);
}

function unmaskNorwegianDots(s: string): string {
  return s.replaceAll(MASK_DOT, ".");
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => {
      const masked = maskNorwegianNonSentenceDots(line);
      return masked.split(/(?<=[.!?])\s+/);
    })
    .map((s) => normalizeSpace(unmaskNorwegianDots(s)))
    .filter(Boolean);
}

/** Én linje kan inneholde flere setninger (skole/dugnad); del opp for renere highlights. */
function splitNoteSegmentsForGeneral(line: string): string[] {
  const masked = maskNorwegianNonSentenceDots(line);
  return masked
    .split(/(?<=[.!?])\s+/)
    .map((s) => normalizeSpace(unmaskNorwegianDots(s)))
    .filter(Boolean);
}

function hasDayMention(sentence: string, day: DayKey): boolean {
  const n = normalizeNorwegianLetters(sentence);
  if (day === "fredag") return /\bfredag|friday\b/.test(n);
  if (day === "lørdag") return /\blordag|l[øo]rdag|saturday\b/.test(n);
  return /\bsondag|s[øo]ndag|sunday\b/.test(n);
}

function parseDayDate(text: string, day: DayKey): string | null {
  const yearMatch = /\b(20\d{2})\b/.exec(text);
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
  const m = re.exec(text);
  if (!m) return null;
  const d = Number(m[2]);
  const monthRaw = normalizeNorwegianLetters(m[3] ?? "");
  const month = monthMap[monthRaw];
  if (!month || !Number.isFinite(d) || d <= 0 || d > 31) return null;
  return `${year}-${month}-${String(d).padStart(2, "0")}`;
}

function parseExplicitAttendanceTime(text: string, day: DayKey): string | null {
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
  const dayFirst = reDayFirst.exec(text);
  if (dayFirst) return `${String(Number(dayFirst[1])).padStart(2, "0")}:${dayFirst[2]}`;

  const reAttendanceFirst = new RegExp(
    `oppm[oø]te[^\\n.!?]{0,90}?${dayExpr}[^\\n.!?]{0,40}?kl\\.?\\s*(\\d{1,2})[:.](\\d{2})`,
    "i",
  );
  const attendanceFirst = reAttendanceFirst.exec(text);
  if (!attendanceFirst) return null;
  return `${String(Number(attendanceFirst[1])).padStart(2, "0")}:${attendanceFirst[2]}`;
}

function parsePerMatchOffset(text: string, day: DayKey): number | null {
  const dayExpr =
    day === "fredag"
      ? "(fredag|friday)"
      : day === "lørdag"
        ? "(l[øo]rdag|saturday)"
        : "(s[øo]ndag|sunday)";
  const re = new RegExp(
    `${dayExpr}[^\\n.!?]{0,110}?oppm[oø]te[^\\n.!?]{0,50}?(\\d{1,3})\\s*min(?:utter)?\\s*f[øo]r\\s*hver\\s+kamp`,
    "i",
  );
  const m = re.exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 && v <= 180 ? v : null;
}

function shiftHhmm(hhmm: string, deltaMinutes: number): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]) + deltaMinutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hh = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function inferParentTitle(text: string): string {
  const first = normalizeSpace(text.split(/\n+/)[0] ?? "");
  if (/v[aå]rcupen/i.test(first)) return "Vårcupen";
  if (/h[øo]stcupen/i.test(first)) return "Høstcupen";
  return first || "Arrangement";
}

function normalizeActivityHighlightStyle(category?: string): "cup" | "general" {
  const c = (category ?? "cup").trim().toLowerCase();
  if (c === "cup") return "cup";
  return "general";
}

/** Flerdagers «pakkeliste» (komma/«og») — skal med på alle kort med innhold; korte «ta med»-hint typisk én dag. */
function bringOrphanLikelySharedAcrossDays(line: string): boolean {
  return (line.match(/\s*,\s*|\s+og\s+/gi) ?? []).length >= 2;
}

function buildGeneralDaySourceBlob(text: string, day: DayKey): string {
  const lines = text
    .split(/\n+/)
    .map((s) => normalizeSpace(s))
    .filter(Boolean);
  const weekendDays: DayKey[] = ["fredag", "lørdag", "søndag"];
  const dayLines = lines.filter((l) => hasDayMention(l, day));
  const orphans = lines.filter(
    (l) => !weekendDays.some((d) => hasDayMention(l, d)),
  );
  const daysWithContent = weekendDays.filter((d) => lines.some((l) => hasDayMention(l, d)));
  const lastDayWithContent =
    daysWithContent.length > 0 ? daysWithContent[daysWithContent.length - 1]! : null;
  const firstPrimaryDay: DayKey | null =
    weekendDays.find((d) => lines.some((l) => hasDayMention(l, d))) ?? null;

  const parts: string[] = [...dayLines];
  for (const o of orphans) {
    if (lineLooksLikeAdministrativeDeadline(o)) continue;
    if (extractOrderedHhmmTimesFromText(o).length > 0) continue;
    if (isBringItemsSignal(o)) {
      if (dayLines.length === 0) continue;
      if (bringOrphanLikelySharedAcrossDays(o) || lastDayWithContent === day) parts.push(o);
      continue;
    }
    if (firstPrimaryDay === day && dayLines.length > 0) parts.push(o);
  }
  return parts.join("\n");
}

function parseMonthToken(raw: string): string | null {
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
  return monthMap[normalizeNorwegianLetters(raw)] ?? null;
}

function parseSpondDeadlineTask(
  text: string,
  parentTitle: string,
): { title: string; date: string | null; dueTime: string | null } | null {
  const n = normalizeNorwegianLetters(text);
  if (!/\bspond\b/.test(n) || !/\b(svar|gi\s+beskjed|meld\s+fra)\b/.test(n)) return null;
  const deadlineBlobMatch =
    /\b(?:svar|gi\s+beskjed|meld\s+fra)\b[\s\S]{0,180}?\bspond\b[\s\S]{0,180}?\b(?:senest|frist)\b[\s\S]{0,180}/i.exec(
      text,
    ) ||
    /\bspond\b[\s\S]{0,180}?\b(?:senest|frist)\b[\s\S]{0,180}/i.exec(text);
  const blob = deadlineBlobMatch?.[0] ?? text;

  const dueM = /\bkl\.?\s*(\d{1,2})[.:](\d{2})\b/i.exec(blob);
  const dueTime = dueM ? `${String(Number(dueM[1])).padStart(2, "0")}:${dueM[2]}` : null;

  const year = Number((/\b(20\d{2})\b/.exec(text) ?? [])[1] ?? 2026);
  const dateM = /\b(?:mandag|tirsdag|onsdag|torsdag|fredag|l[øo]rdag|s[øo]ndag)\s+(\d{1,2})\.\s*([a-zæøå]+)/i.exec(
    blob,
  );
  let date: string | null = null;
  if (dateM) {
    const month = parseMonthToken(dateM[2] ?? "");
    const day = Number(dateM[1]);
    if (month && Number.isFinite(day) && day > 0 && day <= 31) {
      date = `${year}-${month}-${String(day).padStart(2, "0")}`;
    }
  }

  return {
    title: `Svar i Spond om deltakelse i ${parentTitle}`,
    date,
    dueTime,
  };
}

export function runTankestromFixture(
  fixturePath: string,
  options?: { category?: string },
): RegressionPortalBundle {
  const fullPath = resolve(fixturePath);
  const text = readFileSync(fullPath, "utf8");
  const parentTitle = inferParentTitle(text);
  const global = extractGlobalCupScheduleTimesByDay(text);
  const sentences = splitSentences(text);
  const days: DayKey[] = ["fredag", "lørdag", "søndag"];
  const children: RegressionChild[] = [];
  const highlightStyle = normalizeActivityHighlightStyle(options?.category);

  for (const day of days) {
    const date = parseDayDate(text, day);
    const offset = parsePerMatchOffset(text, day);

    const daySentences = sentences.filter((s) => hasDayMention(s, day));
    const genericSentences = sentences.filter(
      (s) => !hasDayMention(s, "fredag") && !hasDayMention(s, "lørdag") && !hasDayMention(s, "søndag"),
    );
    const sourceBlob =
      highlightStyle === "general"
        ? buildGeneralDaySourceBlob(text, day)
        : [...daySentences, ...genericSentences].join("\n");

    let dayTimes =
      day === "fredag" ? global.fredag : day === "lørdag" ? global.lordag : global.sondag;
    const attendanceExplicit = parseExplicitAttendanceTime(text, day);

    const twFromBlob = highlightStyle === "general" ? parseCupTimeWindow(sourceBlob) : null;
    const timeWindow =
      twFromBlob != null
        ? { earliestStart: twFromBlob.earliestStart, latestStart: twFromBlob.latestStart }
        : null;

    if (highlightStyle === "general" && !timeWindow && dayTimes.length === 0) {
      const fromBlob = extractOrderedHhmmTimesFromText(sourceBlob);
      dayTimes = attendanceExplicit
        ? fromBlob.filter((t) => t !== attendanceExplicit)
        : fromBlob;
    }

    const effectiveMatchTimes = timeWindow != null ? [] : dayTimes;

    const conditional = isConditionalTournamentTextForDay(sourceBlob, day);
    const noteLines =
      highlightStyle === "general"
        ? sourceBlob
            .split(/\n+/)
            .flatMap((line) => splitNoteSegmentsForGeneral(line))
            .map((s) => normalizeSpace(s))
            .filter(Boolean)
        : daySentences;
    const timePrecision: TimePrecision =
      timeWindow != null
        ? "time_window"
        : effectiveMatchTimes.length > 0
          ? "start_only"
          : conditional
            ? "date_only"
            : "date_only";

    const structured = buildCupStructuredDayContent({
      date: date ?? "1970-01-01",
      details: null,
      highlights: effectiveMatchTimes.map((t) => `${t} Kamp`),
      notes: noteLines,
      rememberItems: [],
      deadlines: [],
      parentTitle,
      childTitle: `${parentTitle} – ${day}`,
    });
    const enriched = enrichCupStructuredContentWithResolvedTiming(structured, {
      date: date ?? "1970-01-01",
      parentTitleNorm: cupLineNormKey(parentTitle),
      childTitleNorm: cupLineNormKey(`${parentTitle} – ${day}`),
      sourceBlob,
      attendanceTime: attendanceExplicit,
      orderedMatchTimes: effectiveMatchTimes,
      daySegmentStart:
        attendanceExplicit ?? effectiveMatchTimes[0] ?? timeWindow?.earliestStart ?? null,
      daySegmentEnd: null,
      timeWindow,
      timePrecision,
      tentative: conditional,
      activityHighlightStyle: highlightStyle,
    });

    let highlights = [...enriched.highlights];
    if (offset != null && timeWindow == null && effectiveMatchTimes.length > 0) {
      for (const t of effectiveMatchTimes) {
        const att = shiftHhmm(t, -offset);
        if (att && !highlights.some((h) => h.startsWith(`${att} `))) {
          highlights.push(`${att} Oppmøte`);
        }
      }
      highlights = highlights.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    }

    if (date || daySentences.length > 0 || dayTimes.length > 0 || timeWindow != null) {
      children.push({
        day,
        title: `${parentTitle} – ${day}`,
        date,
        start: attendanceExplicit ?? effectiveMatchTimes[0] ?? timeWindow?.earliestStart ?? null,
        timePrecision,
        tentative: conditional,
        highlights,
        bringItems: enriched.bringItems,
        notes: formatCupEventNotesFlat(enriched),
      });
    }
  }

  const tasks: RegressionPortalBundle["tasks"] = [];
  const spondTask = parseSpondDeadlineTask(text, parentTitle);
  if (spondTask) tasks.push(spondTask);

  return { parentTitle, children, tasks };
}
