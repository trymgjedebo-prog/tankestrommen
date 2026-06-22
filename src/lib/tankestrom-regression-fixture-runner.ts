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
import { extractExplicitAttendanceHhmmTimes } from "@/lib/cup-match-times";
import { extractOrderedHhmmTimesFromText } from "@/lib/timed-activity-highlights";
import {
  extractGlobalCupScheduleTimesByDay,
  isConditionalTournamentTextForDay,
} from "@/lib/cup-timing-context";
import { buildCupWeekendDayBlob, filterClockTimesOwnedByCupDay } from "@/lib/cup-day-source-blob";
import { resolveCupDayTiming } from "@/lib/cup-resolve-day-timing";
import { parseScopedAttendanceOffsetMinutes } from "@/lib/activity-duration";
import { classifyTaskIntent, type TaskIntent } from "@/lib/task-intent";

// Typealias utvidet til alle ukedager for eval-/type-kompatibilitet (man–søn).
// Selve fixture-runneren itererer fortsatt kun helgedager (se `days` i runTankestromFixture);
// dette er en ren type-utvidelse uten endring i runtime-oppførsel.
export type DayKey =
  | "mandag"
  | "tirsdag"
  | "onsdag"
  | "torsdag"
  | "fredag"
  | "lørdag"
  | "søndag";
export type TimePrecision = "exact" | "start_only" | "date_only" | "time_window";

export type RegressionChild = {
  day: DayKey;
  title: string;
  date: string | null;
  start: string | null;
  end?: string | null;
  endTimeSource?: string | null;
  durationMinutes?: number | null;
  postEventBufferMinutes?: number | null;
  timePrecision: TimePrecision;
  tentative: boolean;
  highlights: string[];
  bringItems: string[];
  notes: string | null;
};

export type { TaskIntent };

export type RegressionTask = {
  title: string;
  date: string | null;
  dueTime: string | null;
  /** must_do: svar/frist/påmelding. can_help: frivillig «kan noen …». No-op-felt i eldre scorere. */
  taskIntent?: TaskIntent;
};

export type RegressionPortalBundle = {
  parentTitle: string;
  children: RegressionChild[];
  tasks: RegressionTask[];
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

const DAY_MENTION_PATTERNS: Record<DayKey, RegExp> = {
  mandag: /\bmandag|monday\b/,
  tirsdag: /\btirsdag|tuesday\b/,
  onsdag: /\bonsdag|wednesday\b/,
  torsdag: /\btorsdag|thursday\b/,
  fredag: /\bfredag|friday\b/,
  lørdag: /\blordag|l[øo]rdag|saturday\b/,
  søndag: /\bsondag|s[øo]ndag|sunday\b/,
};

function hasDayMention(sentence: string, day: DayKey): boolean {
  return DAY_MENTION_PATTERNS[day].test(normalizeNorwegianLetters(sentence));
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
  const dayExprByDay: Record<DayKey, string> = {
    mandag: "(mandag|monday)",
    tirsdag: "(tirsdag|tuesday)",
    onsdag: "(onsdag|wednesday)",
    torsdag: "(torsdag|thursday)",
    fredag: "(fredag|friday)",
    lørdag: "(l[øo]rdag|saturday)",
    søndag: "(s[øo]ndag|sunday)",
  };
  const dayExpr = dayExprByDay[day];
  const re = new RegExp(`\\b${dayExpr}\\b[^\\n.!?]{0,20}?(\\d{1,2})\\.\\s*([a-zæøå]+)`, "i");
  const m = re.exec(text);
  if (!m) return null;
  const d = Number(m[2]);
  const monthRaw = normalizeNorwegianLetters(m[3] ?? "");
  const month = monthMap[monthRaw];
  if (!month || !Number.isFinite(d) || d <= 0 || d > 31) return null;
  return `${year}-${month}-${String(d).padStart(2, "0")}`;
}

const WEEKDAY_EVENT_KEYS: DayKey[] = ["mandag", "tirsdag", "onsdag", "torsdag"];

/**
 * Hverdager (man–tor) som opptrer som ekte event i teksten: nevnt på en linje med klokkeslett
 * som IKKE ser ut som en administrativ frist (Spond/svar/frist). Hindrer at fristlinjer i
 * helge-fixtures (f.eks. «Svar i Spond senest tirsdag …») gir falske hverdags-barn.
 */
function detectEventWeekdays(text: string): DayKey[] {
  const lines = text
    .split(/\n+/)
    .map((l) => normalizeSpace(l))
    .filter(Boolean);
  return WEEKDAY_EVENT_KEYS.filter((day) =>
    lines.some(
      (line) =>
        hasDayMention(line, day) &&
        !lineLooksLikeAdministrativeDeadline(line) &&
        /\d{1,2}[.:]\d{2}/.test(line),
    ),
  );
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

/** Fjerner administrative frist-/svarlinjer (uten aktivitetssignal) fra en blob. */
function stripAdminDeadlineLines(blob: string): string {
  return blob
    .split(/\n+/)
    .filter((line) => !lineLooksLikeAdministrativeDeadline(normalizeSpace(line)))
    .join("\n");
}

/**
 * Frist-/svar-task (must_do). Gjenkjenner Spond, men også «innen/senest», «frist for påmelding»
 * og «gi beskjed innen» uten Spond. Fristtiden hentes fra selve frist-linja
 * (`lineLooksLikeAdministrativeDeadline`) — ikke fra første programtid i teksten — og «kl. 20»
 * tolkes som «20:00».
 */
export function parseDeadlineTask(text: string, parentTitle: string): RegressionTask | null {
  const n = normalizeNorwegianLetters(text);
  const hasVerb = /\b(svar|gi\s+beskjed|meld\s+fra)\b/.test(n);
  const isDeadline =
    (/\bspond\b/.test(n) && hasVerb) ||
    (hasVerb && /\b(innen|senest)\b/.test(n)) ||
    /\bfrist\s+for\s+p[aå]melding\b/.test(n) ||
    /\bp[aå]meldingsfrist\b/.test(n);
  if (!isDeadline) return null;

  const lines = text.split(/\n+/).map((l) => normalizeSpace(l)).filter(Boolean);
  const deadlineLine =
    lines.find((l) => lineLooksLikeAdministrativeDeadline(l)) ??
    lines.find((l) => /\b(?:frist|p[aå]melding)\b/i.test(l)) ??
    text;

  // «kl. 20» → «20:00», «kl. 20:00» → «20:00». Hentet fra frist-linja, ikke første programtid.
  const dueM = /\bkl\.?\s*(\d{1,2})(?:[.:](\d{2}))?\b/i.exec(deadlineLine);
  let dueTime: string | null = null;
  if (dueM) {
    const h = Number(dueM[1]);
    if (Number.isFinite(h) && h >= 0 && h <= 23) {
      dueTime = `${String(h).padStart(2, "0")}:${dueM[2] ?? "00"}`;
    }
  }

  const year = Number((/\b(20\d{2})\b/.exec(text) ?? [])[1] ?? 2026);
  const dateM = /\b(?:mandag|tirsdag|onsdag|torsdag|fredag|l[øo]rdag|s[øo]ndag)\s+(\d{1,2})\.\s*([a-zæøå]+)/i.exec(
    deadlineLine,
  );
  let date: string | null = null;
  if (dateM) {
    const month = parseMonthToken(dateM[2] ?? "");
    const day = Number(dateM[1]);
    if (month && Number.isFinite(day) && day > 0 && day <= 31) {
      date = `${year}-${month}-${String(day).padStart(2, "0")}`;
    }
  }

  const title = /\bspond\b/.test(n)
    ? `Svar i Spond om deltakelse i ${parentTitle}`
    : `Frist: svar om deltakelse i ${parentTitle}`;
  return { title, date, dueTime, taskIntent: classifyTaskIntent(text) ?? "must_do" };
}

const VOLUNTEER_HELP_PATTERNS: RegExp[] = [
  /\bkan\s+noen\b/,
  /\bvi\s+trenger\s+noen\s+som\s+kan\b/,
  /\bhvem\s+kan\s+(?:hjelpe|ta\s+med|bidra|stille|lage|bake)\b/,
  /\bnoen\s+som\s+kan\s+ta\s+med\b/,
];

/**
 * Frivillige oppgaver («Kan noen kutte frukt?», «Vi trenger noen som kan ta med frukt»,
 * «Hvem kan hjelpe med kake?») → task med taskIntent can_help. Frist-/svarlinjer hoppes over
 * (de er must_do, ikke can_help).
 */
export function parseVolunteerHelpTasks(text: string): RegressionTask[] {
  const out: RegressionTask[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = normalizeSpace(raw);
    if (!sentence) continue;
    if (lineLooksLikeAdministrativeDeadline(sentence)) continue;
    const sn = normalizeNorwegianLetters(sentence);
    if (!VOLUNTEER_HELP_PATTERNS.some((re) => re.test(sn))) continue;
    const title = sentence.replace(/\s*\?\s*$/, "").trim();
    const key = normalizeNorwegianLetters(title);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, date: null, dueTime: null, taskIntent: classifyTaskIntent(sentence) ?? "can_help" });
  }
  return out;
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
  // Helgedager prosesseres alltid (bakoverkompatibelt). I tillegg tas hverdager (man–tor) med
  // KUN når de opptrer på en ikke-administrativ linje med klokkeslett (ekte event, ikke frist),
  // slik at fristlinjer i helge-fixtures ikke gir falske hverdags-barn.
  const days: DayKey[] = ["fredag", "lørdag", "søndag", ...detectEventWeekdays(text)];
  const children: RegressionChild[] = [];
  const highlightStyle = normalizeActivityHighlightStyle(options?.category);

  for (const day of days) {
    const date = parseDayDate(text, day);

    const daySentences = sentences.filter((s) => hasDayMention(s, day));
    // Cup-helgeblob er kun definert for helgedager (CupWeekendDayKey). For hverdager faller vi
    // tilbake til den generelle dag-blobben.
    const weekendBlob =
      day === "fredag" || day === "lørdag" || day === "søndag"
        ? buildCupWeekendDayBlob(text, day)
        : "";
    const cupDaySectionBlob = weekendBlob.trim().length > 0;
    const sourceBlob =
      highlightStyle === "general"
        ? buildGeneralDaySourceBlob(text, day)
        : cupDaySectionBlob
          ? weekendBlob
          : buildGeneralDaySourceBlob(text, day);
    // Programtider hentes fra blob UTEN administrative frist-/svarlinjer, slik at f.eks.
    // «Svar i Spond innen tirsdag kl. 20:00» ikke lekker inn som kamptid.
    const programTimeBlob = stripAdminDeadlineLines(sourceBlob);

    const conditional = isConditionalTournamentTextForDay(sourceBlob, day);
    const twFromBlob = parseCupTimeWindow(sourceBlob);
    const rawTimeWindow =
      twFromBlob != null
        ? { earliestStart: twFromBlob.earliestStart, latestStart: twFromBlob.latestStart }
        : null;
    const timeWindow = conditional ? null : rawTimeWindow;

    const attendanceExplicit = parseExplicitAttendanceTime(text, day);

    let dayTimes =
      day === "fredag" ? global.fredag : day === "lørdag" ? global.lordag : global.sondag;

    if (cupDaySectionBlob && !conditional && !rawTimeWindow) {
      const blobTimes = extractOrderedHhmmTimesFromText(programTimeBlob);
      const ownedBlobTimes = filterClockTimesOwnedByCupDay(blobTimes, text, day, sourceBlob);
      if (ownedBlobTimes.length > 0) {
        const merged = [...dayTimes, ...ownedBlobTimes];
        dayTimes = [...new Set(merged)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      }
    }

    const attendanceOnly = extractExplicitAttendanceHhmmTimes(sourceBlob);
    if (attendanceExplicit) attendanceOnly.add(attendanceExplicit);
    dayTimes = dayTimes.filter((t) => !attendanceOnly.has(t));

    const offsetEvidence = parseScopedAttendanceOffsetMinutes(sourceBlob);
    const offset =
      offsetEvidence?.minutes ??
      parsePerMatchOffset(text, day);

    if (highlightStyle === "general" && !rawTimeWindow && dayTimes.length === 0) {
      const fromBlob = extractOrderedHhmmTimesFromText(programTimeBlob);
      dayTimes = attendanceExplicit
        ? fromBlob.filter((t) => t !== attendanceExplicit)
        : fromBlob;
    }

    const effectiveMatchTimes = conditional || rawTimeWindow != null ? [] : dayTimes;

    const attendanceFromOffset =
      !attendanceExplicit &&
      offsetEvidence &&
      effectiveMatchTimes.length > 0
        ? shiftHhmm(
            effectiveMatchTimes[0]!,
            -(offsetEvidence.perMatch && effectiveMatchTimes.length > 1
              ? offsetEvidence.minutes
              : offsetEvidence.minutes),
          )
        : null;
    const attendanceForEnrich = attendanceExplicit ?? attendanceFromOffset;

    const noteLines =
      highlightStyle === "general"
        ? sourceBlob
            .split(/\n+/)
            .flatMap((line) => splitNoteSegmentsForGeneral(line))
            .map((s) => normalizeSpace(s))
            .filter(Boolean)
        : sourceBlob
            .split(/\n+/)
            .map((s) => normalizeSpace(s))
            .filter((l) => l && !/\bkampoppsett\s*:/i.test(l));
    const timePrecision: TimePrecision = conditional
      ? "date_only"
      : timeWindow != null
        ? "time_window"
        : effectiveMatchTimes.length > 0
          ? "exact"
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
      dayLabel: day,
      ownershipCorpus: text,
      attendanceTime: attendanceForEnrich,
      orderedMatchTimes: effectiveMatchTimes,
      daySegmentStart:
        attendanceForEnrich ?? effectiveMatchTimes[0] ?? timeWindow?.earliestStart ?? null,
      daySegmentEnd: null,
      timeWindow,
      timePrecision,
      tentative: conditional,
      activityHighlightStyle: highlightStyle,
    });

    const cupTiming = resolveCupDayTiming({
      day: {
        dayLabel: day,
        date,
        time: attendanceForEnrich ?? effectiveMatchTimes[0] ?? null,
        details: null,
        highlights: effectiveMatchTimes.map((t) => `${t} Kamp`),
        rememberItems: enriched.bringItems,
        deadlines: [],
        notes: noteLines,
      },
      detailsForEvent: null,
      highlightsForEventFinal: effectiveMatchTimes.map((t) => `${t} Kamp`),
      notesOnlyForEvent: noteLines,
      rememberForEvent: enriched.bringItems,
      deadlinesForEvent: [],
      conditionalDay: conditional,
      fullCorpus: text,
      supplementalTimeContextBlob: sourceBlob,
    });

    let highlights = [...enriched.highlights];
    if (offset != null && !offsetEvidence?.perMatch && timeWindow == null && effectiveMatchTimes.length > 0) {
      for (const t of effectiveMatchTimes) {
        const att = shiftHhmm(t, -offset);
        if (att && !highlights.some((h) => h.startsWith(`${att} `))) {
          highlights.push(`${att} Oppmøte`);
        }
      }
      highlights = highlights.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    }

    if (date || daySentences.length > 0 || dayTimes.length > 0 || timeWindow != null) {
      const resolvedPrecision =
        cupTiming.timePrecision !== "date_only" ? cupTiming.timePrecision : timePrecision;
      children.push({
        day,
        title: `${parentTitle} – ${day}`,
        date,
        start: cupTiming.start ?? attendanceExplicit ?? effectiveMatchTimes[0] ?? timeWindow?.earliestStart ?? null,
        end: cupTiming.end,
        endTimeSource: cupTiming.endTimeSource,
        durationMinutes: cupTiming.durationMinutes,
        postEventBufferMinutes: cupTiming.postEventBufferMinutes,
        timePrecision: resolvedPrecision,
        tentative: conditional,
        highlights,
        bringItems: enriched.bringItems,
        notes: formatCupEventNotesFlat(enriched),
      });
    }
  }

  const tasks: RegressionPortalBundle["tasks"] = [];
  const deadlineTask = parseDeadlineTask(text, parentTitle);
  if (deadlineTask) tasks.push(deadlineTask);
  tasks.push(...parseVolunteerHelpTasks(text));

  return { parentTitle, children, tasks };
}
