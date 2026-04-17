import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { analyzeImage, analyzeText } from "@/lib/ai/analyze-image";
import { extractTextFromPdfBuffer } from "@/lib/pdf/extract-pdf-text";
import { extractTextFromDocxBuffer } from "@/lib/docx/extract-docx-text";
import type {
  AnalysisSourceHint,
  AIAnalysisResult,
  DayScheduleEntry,
} from "@/lib/types";

/** pdf-parse / mammoth krever Node (ikke Edge). */
export const runtime = "nodejs";

const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_DOCX_BYTES = 12 * 1024 * 1024;
const MAX_DOC_TEXT_FOR_MODEL = 45_000;
const MAX_EXTRACTED_RAW_DISPLAY = 80_000;

function mapAnalyzeTextError(err: unknown): {
  status: number;
  error: string;
} {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const lower = msg.toLowerCase();

  if (lower.includes("openai_api_key")) {
    return {
      status: 503,
      error: "Analyse-tjenesten er ikke konfigurert (mangler OPENAI_API_KEY).",
    };
  }
  if (
    lower.includes("context_length") ||
    lower.includes("token") ||
    lower.includes("maximum context length")
  ) {
    return {
      status: 422,
      error:
        "Dokumentteksten er for omfattende til å analyseres i ett steg. Prøv et kortere utdrag eller del dokumentet opp.",
    };
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("insufficient_quota")
  ) {
    return {
      status: 429,
      error:
        "Analyse-tjenesten er midlertidig overbelastet eller har nådd kvoten. Prøv igjen om litt.",
    };
  }
  return {
    status: 502,
    error:
      "Kunne ikke analysere dokumentteksten akkurat nå. Prøv igjen, eller lim inn et kortere tekstutdrag i «Tekst»-fanen.",
  };
}

function sanitizeFileName(name: string, fallback: string): string {
  const trimmed = name.trim().slice(0, 200);
  return trimmed || fallback;
}

function pdfDataUrlToBuffer(dataUrl: string): Buffer {
  const trimmed = dataUrl.trim();
  const m = /^data:application\/pdf;base64,(.+)$/i.exec(trimmed);
  if (!m) {
    throw new Error("Ugyldig PDF-format.");
  }
  return Buffer.from(m[1], "base64");
}

function docxDataUrlToBuffer(dataUrl: string): Buffer {
  const trimmed = dataUrl.trim();
  const m = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  if (!m) {
    throw new Error("Ugyldig Word-format.");
  }
  const mime = m[1].toLowerCase();
  if (mime === "application/msword") {
    throw new Error(
      "DOC_LEGACY: Gammelt Word-format (.doc) støttes ikke. Lagre som .docx eller bruk PDF."
    );
  }
  const ok =
    mime.includes("wordprocessingml.document") ||
    mime === "application/octet-stream" ||
    mime === "application/x-zip-compressed";
  if (!ok) {
    throw new Error("Ugyldig Word-format. Bruk .docx.");
  }
  return Buffer.from(m[2], "base64");
}

async function analyzeFromExtractedText(
  rawText: string,
  preamble: string,
  sourceHint: AnalysisSourceHint,
  portalMode: boolean,
) {
  let textForModel = rawText;
  if (textForModel.length > MAX_DOC_TEXT_FOR_MODEL) {
    textForModel =
      textForModel.slice(0, MAX_DOC_TEXT_FOR_MODEL) +
      "\n\n[... Teksten er forkortet for analyse. Full tekst vises under «Original tekst».]";
  }

  let result;
  try {
    result = await analyzeText(preamble + textForModel);
  } catch (err) {
    const mapped = mapAnalyzeTextError(err);
    console.error("[api/analyze text]", err);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const displayRaw =
    rawText.length > MAX_EXTRACTED_RAW_DISPLAY
      ? rawText.slice(0, MAX_EXTRACTED_RAW_DISPLAY) +
        "\n\n[... Teksten er forkortet i visning ...]"
      : rawText;

  return wrapResponse(result, portalMode, sourceHint.type, {
    sourceHint,
    extractedText: {
      raw: displayRaw,
      language: result.extractedText.language || "no",
      confidence: 1,
    },
  });
}

interface ParsedBody {
  image?: string;
  text?: string;
  pdf?: string;
  docx?: string;
  fileName?: string;
}

async function fileToDataUrl(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  return `data:${file.type || "application/octet-stream"};base64,${buf.toString("base64")}`;
}

async function parseMultipartBody(request: NextRequest): Promise<ParsedBody> {
  const form = await request.formData();
  const file = form.get("file") as File | null;
  const textField = form.get("text") as string | null;

  if (textField && typeof textField === "string") {
    return { text: textField };
  }

  if (!file) {
    return {};
  }

  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  const dataUrl = await fileToDataUrl(file);

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return { pdf: dataUrl, fileName: file.name };
  }
  if (
    name.endsWith(".docx") ||
    mime.includes("wordprocessingml.document")
  ) {
    return { docx: dataUrl, fileName: file.name };
  }
  if (mime.startsWith("image/")) {
    return { image: dataUrl };
  }

  return { pdf: dataUrl, fileName: file.name };
}

function isMultipart(request: NextRequest): boolean {
  const ct = request.headers.get("content-type") ?? "";
  return ct.includes("multipart/form-data");
}

/* ------------------------------------------------------------------ */
/*  Adapter: AIAnalysisResult  →  PortalImportProposalBundle (v1)     */
/* ------------------------------------------------------------------ */

const NB_MONTHS: Record<string, number> = {
  januar: 1, februar: 2, mars: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

const NB_MONTH_ALIASES: Record<string, keyof typeof NB_MONTHS> = {
  jan: "januar",
  feb: "februar",
  mar: "mars",
  apr: "april",
  mai: "mai",
  jun: "juni",
  jul: "juli",
  aug: "august",
  sep: "september",
  sept: "september",
  okt: "oktober",
  nov: "november",
  des: "desember",
};

const NB_WEEKDAYS: Record<string, number> = {
  mandag: 1,
  tirsdag: 2,
  onsdag: 3,
  torsdag: 4,
  fredag: 5,
  lordag: 6,
  sondag: 7,
};

function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

function normalizeMonthName(rawMonth: string): string {
  const cleaned = normalizeNorwegianLetters(rawMonth.replace(/\./g, "").trim());
  return NB_MONTH_ALIASES[cleaned] ?? cleaned;
}

function parseIsoWeekDate(year: number, week: number, isoWeekday: number): string | null {
  if (week < 1 || week > 53 || isoWeekday < 1 || isoWeekday > 7) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4IsoDay = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4IsoDay - 1));
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7 + (isoWeekday - 1));
  return target.toISOString().slice(0, 10);
}

function parseWeekNumber(raw: string | null): number | null {
  if (!raw) return null;
  const m = /\b(?:uke|week|v)\s*[.:]?\s*(\d{1,2})\b/i.exec(raw);
  if (!m) return null;
  const week = Number(m[1]);
  return week >= 1 && week <= 53 ? week : null;
}

/** Brukes av `tryParseNorwegianDate` etter merge med main (ISO-uke → Date). */
function getIsoWeekDateUtc(year: number, week: number, isoWeekday: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4IsoWeekday = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const week1Monday = new Date(Date.UTC(year, 0, 4 - (jan4IsoWeekday - 1)));
  const d = new Date(week1Monday);
  d.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7 + (isoWeekday - 1));
  return d;
}

function isoDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function detectIsoWeekdayFromText(raw: string): number | null {
  const s = raw.toLowerCase();
  if (/\b(man(day)?|mandag)\b/i.test(s)) return 1;
  if (/\b(tue(s(day)?)?|tirsdag)\b/i.test(s)) return 2;
  if (/\b(wed(nesday)?|onsdag)\b/i.test(s)) return 3;
  if (/\b(thu(rs(day)?)?|torsdag)\b/i.test(s)) return 4;
  if (/\b(fri(day)?|fredag)\b/i.test(s)) return 5;
  if (/\b(sat(urday)?|l[øo]rdag)\b/i.test(s)) return 6;
  if (/\b(sun(day)?|s[øo]ndag)\b/i.test(s)) return 7;
  return null;
}

function parseIsoWeekday(raw: string | null): number | null {
  if (!raw) return null;
  const fromText = detectIsoWeekdayFromText(raw);
  if (fromText !== null) return fromText;
  const normalized = normalizeNorwegianLetters(raw);
  for (const [label, weekday] of Object.entries(NB_WEEKDAYS)) {
    if (normalized.includes(label)) return weekday;
  }
  return null;
}

function inferRealisticYear(candidates: number[], weekNumber: number | null): number {
  const currentYear = new Date().getFullYear();
  const realistic = candidates.filter((y) => y >= currentYear - 1 && y <= currentYear + 2);
  if (realistic.length > 0) return realistic[0];
  if (weekNumber && weekNumber >= 1 && weekNumber <= 26) return currentYear;
  return currentYear;
}

function collectYearCandidates(result: AIAnalysisResult): number[] {
  const context = [
    result.title,
    result.description,
    ...result.scheduleByDay.map((d) => `${d.dayLabel ?? ""} ${d.date ?? ""}`),
    ...result.schedule.map((s) => `${s.label ?? ""} ${s.date ?? ""}`),
  ].join(" ");
  const years = Array.from(context.matchAll(/\b(20\d{2})\b/g), (m) => Number(m[1]));
  return years.filter((y) => Number.isFinite(y));
}

function tryParseNorwegianDate(raw: string | null): string | null {
  if (!raw) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (isoMatch) return raw.trim();

  const nbMatch = /(\d{1,2})\.\s*([a-zæøå.]+)\s+(\d{4})/i.exec(raw);
  if (nbMatch) {
    const day = Number(nbMatch[1]);
    const month = NB_MONTHS[normalizeMonthName(nbMatch[2])];
    const year = Number(nbMatch[3]);
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const slashMatch = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(raw.trim());
  if (slashMatch) {
    const d = Number(slashMatch[1]);
    const m = Number(slashMatch[2]);
    const y = Number(slashMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  // Fallback for ISO-week input without explicit year.
  // If the week has already passed this year, prefer next year to avoid stale dates near year-end.
  const weekMatch = /\buke\s*(\d{1,2})(?:\D+(20\d{2}))?/i.exec(raw);
  if (weekMatch) {
    const week = Number(weekMatch[1]);
    if (Number.isFinite(week) && week >= 1 && week <= 53) {
      const now = new Date();
      const thisYear = now.getFullYear();
      const explicitYear = weekMatch[2] ? Number(weekMatch[2]) : null;
      const isoWeekday = detectIsoWeekdayFromText(raw) ?? 1;

      if (explicitYear) {
        return isoDateKey(getIsoWeekDateUtc(explicitYear, week, isoWeekday));
      }

      const candidateThisYear = getIsoWeekDateUtc(thisYear, week, isoWeekday);
      const todayUtc = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      );
      return candidateThisYear < todayUtc
        ? isoDateKey(getIsoWeekDateUtc(thisYear + 1, week, isoWeekday))
        : isoDateKey(candidateThisYear);
    }
  }

  return null;
}

function parseDateWithFallbackYear(raw: string | null, fallbackYear: number): string | null {
  if (!raw) return null;
  const explicit = tryParseNorwegianDate(raw);
  if (explicit) return explicit;

  const nbMatchNoYear = /(\d{1,2})\.\s*([a-zæøå.]+)\b/i.exec(raw);
  if (nbMatchNoYear) {
    const day = Number(nbMatchNoYear[1]);
    const month = NB_MONTHS[normalizeMonthName(nbMatchNoYear[2])];
    if (month && day >= 1 && day <= 31) {
      return `${fallbackYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const slashNoYear = /^(\d{1,2})[./](\d{1,2})$/.exec(raw.trim());
  if (slashNoYear) {
    const day = Number(slashNoYear[1]);
    const month = Number(slashNoYear[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${fallbackYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

function normalizeSpace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function isGenericWeekPlanTitle(title: string): boolean {
  const normalized = normalizeNorwegianLetters(title);
  const hasPlanKeyword =
    /\b(a-plan|aplan|ukeplan|aktivitetsplan)\b/.test(normalized);
  const hasWeek = /\b(?:uke|week|v)\s*\.?:?\s*\d{1,2}\b/.test(normalized);
  if (!hasPlanKeyword || !hasWeek) return false;
  // Short titles with just plan+week are considered too generic for calendar blocks.
  return normalizeSpace(title).length <= 28;
}

function getPlanPrefix(title: string): string | null {
  const normalized = normalizeNorwegianLetters(title);
  if (/\b(a-plan|aplan)\b/.test(normalized)) return "A-plan";
  if (/\b(ukeplan)\b/.test(normalized)) return "Ukeplan";
  if (/\b(aktivitetsplan)\b/.test(normalized)) return "Aktivitetsplan";
  return null;
}

function buildCalendarEventTitle(
  result: AIAnalysisResult,
  titleSuffix: string | null
): string {
  const baseTitle = normalizeSpace(result.title || "").trim();
  const suffix = normalizeSpace(titleSuffix || "").trim();
  const targetGroup = normalizeSpace(result.targetGroup || "").trim();

  if (!suffix) return baseTitle || "Hendelse";

  if (isGenericWeekPlanTitle(baseTitle)) {
    const prefix = getPlanPrefix(baseTitle);
    if (prefix && targetGroup) return `${prefix} ${targetGroup} – ${suffix}`;
    if (targetGroup) return `${targetGroup} – ${suffix}`;
    if (prefix) return `${prefix} – ${suffix}`;
  }

  return baseTitle ? `${baseTitle} – ${suffix}` : suffix;
}

function trimSentence(raw: string, maxLen = 56): string {
  const firstChunk = raw.split(/[.;\n]/)[0] ?? raw;
  const cleaned = normalizeSpace(firstChunk).replace(/^[-:]\s*/, "");
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
}

function planHeadTitle(result: AIAnalysisResult): string {
  const baseTitle = normalizeSpace(result.title || "");
  if (!isGenericWeekPlanTitle(baseTitle)) return baseTitle || "Hendelse";
  const prefix = getPlanPrefix(baseTitle);
  const targetGroup = normalizeSpace(result.targetGroup || "");
  if (prefix && targetGroup) return `${prefix} ${targetGroup}`;
  if (targetGroup) return targetGroup;
  if (prefix) return prefix;
  return baseTitle || "Hendelse";
}

function extractEventProgramHint(dayContext?: {
  rememberItems: string[];
  deadlines: string[];
  notes: string[];
  highlights: string[];
  details?: string | null;
}): string | null {
  if (!dayContext) return null;
  const candidates = [dayContext.details ?? "", ...dayContext.highlights]
    .map((v) => normalizeSpace(v))
    .filter((v) => v.length > 0);
  for (const candidate of candidates) {
    if (isTaskLikeText(candidate)) continue;
    const hint = trimSentence(candidate, 42);
    if (hint.length >= 4) return hint;
  }
  return null;
}

function buildEventProposalTitle(
  result: AIAnalysisResult,
  titleSuffix: string | null,
  dayContext?: {
    rememberItems: string[];
    deadlines: string[];
    notes: string[];
    highlights: string[];
    details?: string | null;
  },
): string {
  const fallback = buildCalendarEventTitle(result, titleSuffix);
  const programHint = extractEventProgramHint(dayContext);
  if (!programHint) return fallback;
  if (isGenericWeekPlanTitle(result.title || "")) {
    return `${planHeadTitle(result)} – ${programHint}`;
  }
  return fallback;
}

function normalizeTaskTitle(taskText: string): string {
  const stripped = normalizeSpace(taskText)
    .replace(/^(husk|lekse(?:r)?|oppgave(?:r)?)\s*[:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const compact = trimSentence(stripped, 54);
  return compact || "Oppgave";
}

function extractStartEnd(time: string | null): { start: string; end: string } {
  const fallback = { start: "08:00", end: "09:00" };
  if (!time) return fallback;
  const rangeMatch = /(\d{1,2}[.:]\d{2})\s*[-–]\s*(\d{1,2}[.:]\d{2})/.exec(time);
  if (rangeMatch) {
    return {
      start: rangeMatch[1].replace(".", ":"),
      end: rangeMatch[2].replace(".", ":"),
    };
  }
  const singleMatch = /(\d{1,2})[.:](\d{2})/.exec(time);
  if (singleMatch) {
    const h = Number(singleMatch[1]);
    const m = singleMatch[2];
    const s = `${String(h).padStart(2, "0")}:${m}`;
    const eH = Math.min(h + 1, 23);
    const e = `${String(eH).padStart(2, "0")}:${m}`;
    return { start: s, end: e };
  }
  return fallback;
}

function composeDayNotes(
  day: DayScheduleEntry,
  fallbackDescription: string | null
): string | null {
  const parts: string[] = [];
  if (day.details) parts.push(day.details);
  if (day.highlights.length > 0) {
    parts.push(`Høydepunkter: ${day.highlights.join("; ")}`);
  }
  if (day.rememberItems.length > 0) {
    parts.push(`Husk: ${day.rememberItems.join("; ")}`);
  }
  if (day.deadlines.length > 0) {
    parts.push(`Frister: ${day.deadlines.join("; ")}`);
  }
  if (day.notes.length > 0) {
    parts.push(`Notater: ${day.notes.join("; ")}`);
  }
  if (parts.length === 0 && fallbackDescription) {
    parts.push(fallbackDescription);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

type PortalEventItem = {
  proposalId: string;
  kind: "event";
  sourceId: string;
  originalSourceType: string;
  confidence: number;
  event: {
    date: string;
    personId: string;
    title: string;
    start: string;
    end: string;
    notes?: string;
    location?: string;
  };
};

type PortalTaskItem = {
  proposalId: string;
  kind: "task";
  sourceId: string;
  originalSourceType: string;
  confidence: number;
  task: {
    date: string;
    personId: string;
    title: string;
    notes?: string;
  };
};

type PortalProposalItem = PortalEventItem | PortalTaskItem;

const TASK_KEYWORDS =
  /\b(lekse|lekser|husk|ta med|les|skriv|oppgave|øv|ov|gjør|gjor)\b/i;
const EVENT_KEYWORDS =
  /\b(prøve|prove|tentamen|tur|aktivitetsdag|forestilling|møte|mote|arrangement)\b/i;

function splitTaskCandidates(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/\n|;|•|-/)
    .map((part) => normalizeSpace(part))
    .filter((part) => part.length > 0);
}

function isTaskLikeText(raw: string | null): boolean {
  if (!raw) return false;
  return TASK_KEYWORDS.test(normalizeNorwegianLetters(raw));
}

function isEventLikeText(raw: string | null): boolean {
  if (!raw) return false;
  return EVENT_KEYWORDS.test(normalizeNorwegianLetters(raw));
}

function buildProposalItems(
  result: AIAnalysisResult,
  sourceType: string,
): PortalProposalItem[] {
  const items: PortalProposalItem[] = [];

  const sourceId = randomUUID();
  const weekContext = [
    result.title,
    result.description,
    ...result.scheduleByDay.map((d) => `${d.dayLabel ?? ""} ${d.date ?? ""}`),
    ...result.schedule.map((s) => `${s.label ?? ""} ${s.date ?? ""}`),
  ].join(" ");
  const weekNumber = parseWeekNumber(weekContext);
  const resolvedYear = inferRealisticYear(collectYearCandidates(result), weekNumber);
  const weekPlanLike =
    /\b(a-plan|aplan|ukeplan|aktivitetsplan)\b/i.test(result.title) &&
    weekNumber !== null;

  const resolveDate = (rawDate: string | null, rawLabel: string | null): string | null => {
    // Preserve existing explicit date parsing first.
    const direct = parseDateWithFallbackYear(rawDate, resolvedYear);
    if (direct) {
      const explicitYearMatch = rawDate ? /\b(20\d{2})\b/.exec(rawDate) : null;
      const explicitYear = explicitYearMatch ? Number(explicitYearMatch[1]) : null;
      const weekday = parseIsoWeekday(`${rawLabel ?? ""} ${rawDate ?? ""}`);
      // Merge-safe guard: for week plans, ignore stale AI years (e.g. 2023) if
      // we can calculate date from current week/year context and weekday.
      if (
        weekPlanLike &&
        weekNumber &&
        explicitYear &&
        Math.abs(explicitYear - resolvedYear) >= 2 &&
        weekday
      ) {
        const byWeek = parseIsoWeekDate(resolvedYear, weekNumber, weekday);
        if (byWeek) return byWeek;
      }
      return direct;
    }
    if (!weekNumber) return null;
    const weekday = parseIsoWeekday(`${rawLabel ?? ""} ${rawDate ?? ""}`);
    if (!weekday) return null;
    return parseIsoWeekDate(resolvedYear, weekNumber, weekday);
  };

  const asListSection = (heading: string, values: string[]): string | null => {
    const clean = values
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (clean.length === 0) return null;
    return `${heading}\n${clean.map((v) => `- ${v}`).join("\n")}`;
  };

  const buildStructuredNotes = (
    noteBase: string | null,
    dayContext?: {
      rememberItems: string[];
      deadlines: string[];
      notes: string[];
      highlights: string[];
    },
  ): string | null => {
    if (!dayContext) {
      return noteBase ?? result.description;
    }

    const sections: string[] = [];
    const base = (noteBase ?? "").trim();
    if (base) sections.push(base);
    const highlightsSection = asListSection("Dagens innhold", dayContext.highlights);
    if (highlightsSection) sections.push(highlightsSection);
    const tasksSection = asListSection("Gjøremål / husk", dayContext.rememberItems);
    if (tasksSection) sections.push(tasksSection);
    const deadlinesSection = asListSection("Frister", dayContext.deadlines);
    if (deadlinesSection) sections.push(deadlinesSection);
    const notesSection = asListSection("Notater", dayContext.notes);
    if (notesSection) sections.push(notesSection);

    if (sections.length === 0) return null;
    return sections.join("\n\n");
  };

  const buildEventItem = (
    date: string,
    time: string | null,
    titleSuffix: string | null,
    notes: string | null,
    dayContext?: {
      rememberItems: string[];
      deadlines: string[];
      notes: string[];
      highlights: string[];
    },
  ): PortalEventItem => {
    const { start, end } = extractStartEnd(time);
    const item: PortalEventItem = {
      proposalId: randomUUID(),
      kind: "event",
      sourceId,
      originalSourceType: sourceType,
      confidence: result.confidence,
      event: {
        date,
        personId: "pending",
        title: buildEventProposalTitle(result, titleSuffix, dayContext),
        start,
        end,
      },
    };
    const n = buildStructuredNotes(notes, dayContext);
    if (n) item.event.notes = n;
    if (result.location) item.event.location = result.location;
    return item;
  };

  const buildTaskItem = (
    date: string,
    dayLabel: string | null,
    taskText: string,
  ): PortalTaskItem => {
    const cleanTask = normalizeTaskTitle(taskText);
    const day = normalizeSpace(dayLabel || "");
    const title = day ? `${day} – ${cleanTask}` : cleanTask;
    return {
      proposalId: randomUUID(),
      kind: "task",
      sourceId,
      originalSourceType: sourceType,
      confidence: result.confidence,
      task: {
        date,
        personId: "pending",
        title: title || "Oppgave",
        notes: result.title ? `Fra: ${result.title}` : undefined,
      },
    };
  };

  if (result.scheduleByDay.length > 0) {
    for (const day of result.scheduleByDay) {
      const isoDate = resolveDate(day.date, day.dayLabel);
      if (!isoDate) continue;

      const taskCandidates = [
        ...day.rememberItems,
        ...day.deadlines,
        ...day.notes.flatMap((n) => splitTaskCandidates(n)),
        ...splitTaskCandidates(day.details),
      ];
      const taskTexts = Array.from(
        new Set(
          taskCandidates
            .map((text) => normalizeSpace(text))
            .filter(
              (text) =>
                text.length > 0 &&
                isTaskLikeText(text) &&
                !isEventLikeText(text),
            ),
        ),
      );

      const combinedDayText = [
        day.details,
        ...day.highlights,
        ...day.notes,
      ].join(" ");
      const hasEventSignal =
        Boolean(day.time) ||
        isEventLikeText(combinedDayText) ||
        day.highlights.length > 0 ||
        (day.details !== null && !isTaskLikeText(day.details));

      if (hasEventSignal || taskTexts.length === 0) {
        items.push(
          buildEventItem(isoDate, day.time, day.dayLabel, day.details, {
            rememberItems: day.rememberItems,
            deadlines: day.deadlines,
            notes: day.notes,
            highlights: day.highlights,
          }),
        );
      }

      for (const taskText of taskTexts) {
        items.push(buildTaskItem(isoDate, day.dayLabel, taskText));
      }
    }
  }

  if (items.length === 0 && result.schedule.length > 0) {
    for (const slot of result.schedule) {
      const isoDate = resolveDate(slot.date, slot.label);
      if (!isoDate) continue;
      const slotSignal = `${slot.label ?? ""} ${slot.date ?? ""}`;
      if (isTaskLikeText(slotSignal) && !isEventLikeText(slotSignal)) {
        items.push(buildTaskItem(isoDate, slot.label, slotSignal));
      } else {
        items.push(buildEventItem(isoDate, slot.time, slot.label, null));
      }
    }
  }

  if (items.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    items.push(buildEventItem(today, null, null, null));
  }

  return items;
}

function toPortalBundle(
  result: AIAnalysisResult,
  sourceType: string,
): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0",
    provenance: {
      sourceSystem: "tankestrom",
      sourceType,
      generatedAt: new Date().toISOString(),
      importRunId: randomUUID(),
    },
    items: buildProposalItems(result, sourceType),
  };
}

function wrapResponse(
  result: AIAnalysisResult,
  portalMode: boolean,
  sourceType: string,
  extra?: Record<string, unknown>,
): NextResponse {
  if (portalMode) {
    const bundle = toPortalBundle(result, sourceType);
    console.log("[api/analyze] portal-mode → returning PortalImportProposalBundle", {
      schemaVersion: bundle.schemaVersion,
      itemCount: (bundle.items as unknown[]).length,
    });
    return NextResponse.json(bundle);
  }
  return NextResponse.json(extra ? { ...result, ...extra } : result);
}

/**
 * Detect portal-mode ONCE before the body is consumed.
 * Must be called before request.json() / request.formData().
 */
function detectPortalMode(request: NextRequest): boolean {
  const ct = (request.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("multipart/form-data")) return true;

  const accept = (request.headers.get("accept") ?? "").toLowerCase();
  if (accept.includes("application/vnd.foreldre.proposal+json")) return true;

  const param = request.nextUrl.searchParams.get("format");
  if (param === "portal") return true;

  return false;
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      return NextResponse.json(
        {
          error:
            "Analyse-tjenesten er ikke konfigurert (mangler OPENAI_API_KEY).",
        },
        { status: 503 }
      );
    }

    const multipart = isMultipart(request);
    const portalMode = detectPortalMode(request);
    console.log("[api/analyze] incoming request", {
      contentType: request.headers.get("content-type"),
      multipart,
      portalMode,
    });

    const { image, text, pdf, docx, fileName }: ParsedBody = multipart
      ? await parseMultipartBody(request)
      : await request.json();

    if (text && typeof text === "string") {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return NextResponse.json({ error: "Teksten er tom." }, { status: 400 });
      }
      if (trimmed.length > 15_000) {
        return NextResponse.json(
          { error: "Teksten er for lang. Maks 15 000 tegn." },
          { status: 413 }
        );
      }
      const result = await analyzeText(trimmed);
      return wrapResponse(result, portalMode, "text");
    }

    if (pdf && typeof pdf === "string") {
      if (pdf.length > 18_000_000) {
        return NextResponse.json(
          { error: "PDF-filen er for stor. Maks ca. 12 MB." },
          { status: 413 }
        );
      }
      let buffer: Buffer;
      try {
        buffer = pdfDataUrlToBuffer(pdf);
      } catch {
        return NextResponse.json(
          { error: "Ugyldig PDF-data. Last opp filen på nytt." },
          { status: 400 }
        );
      }
      if (buffer.length > MAX_PDF_BYTES) {
        return NextResponse.json(
          { error: "PDF-filen er for stor. Maks 12 MB." },
          { status: 413 }
        );
      }

      let extracted: { text: string; numpages: number };
      try {
        extracted = await extractTextFromPdfBuffer(buffer);
      } catch (e) {
        console.error("[api/analyze pdf-parse]", e);
        return NextResponse.json(
          {
            error:
              "Kunne ikke lese PDF-filen. Filen kan være skadet, passordbeskyttet eller bare bilder uten tekstlag.",
          },
          { status: 422 }
        );
      }

      const rawText = extracted.text;
      if (!rawText || rawText.length < 3) {
        return NextResponse.json(
          {
            error:
              "Fant ingen lesbar tekst i PDF-en. Prøv «Tekst»-fanen, eller et dokument med tekst (ikke skannet bilde uten OCR).",
          },
          { status: 422 }
        );
      }

      const safeName = sanitizeFileName(
        typeof fileName === "string" ? fileName : "",
        "dokument.pdf"
      );

      const preamble = `Dette er tekst uttrekk fra PDF-filen «${safeName}» (${extracted.numpages || "?"} sider). Tolke og strukturer innholdet som beskrevet.\n\n`;

      return analyzeFromExtractedText(rawText, preamble, {
        type: "pdf",
        fileName: safeName,
        pageCount: Math.max(1, extracted.numpages),
      }, portalMode);
    }

    if (docx && typeof docx === "string") {
      if (docx.length > 18_000_000) {
        return NextResponse.json(
          { error: "Word-filen er for stor. Maks ca. 12 MB." },
          { status: 413 }
        );
      }
      let buffer: Buffer;
      try {
        buffer = docxDataUrlToBuffer(docx);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.startsWith("DOC_LEGACY:")) {
          return NextResponse.json(
            { error: msg.replace("DOC_LEGACY: ", "") },
            { status: 400 }
          );
        }
        return NextResponse.json(
          { error: "Ugyldig Word-data. Last opp en .docx-fil." },
          { status: 400 }
        );
      }
      if (buffer.length > MAX_DOCX_BYTES) {
        return NextResponse.json(
          { error: "Word-filen er for stor. Maks 12 MB." },
          { status: 413 }
        );
      }

      let rawText: string;
      try {
        rawText = await extractTextFromDocxBuffer(buffer);
      } catch (e) {
        console.error("[api/analyze mammoth]", e);
        return NextResponse.json(
          {
            error:
              "Kunne ikke lese Word-filen. Filen kan være skadet eller ikke være i .docx-format.",
          },
          { status: 422 }
        );
      }

      if (!rawText || rawText.length < 3) {
        return NextResponse.json(
          {
            error:
              "Fant ingen lesbar tekst i dokumentet. Sjekk at filen er .docx med faktisk innhold.",
          },
          { status: 422 }
        );
      }

      const safeName = sanitizeFileName(
        typeof fileName === "string" ? fileName : "",
        "dokument.docx"
      );

      const preamble = `Dette er tekst uttrekk fra Word-filen «${safeName}» (.docx). Tolke og strukturer innholdet som beskrevet (ukeplan, datoer, kontakt osv. når det finnes).\n\n`;

      return analyzeFromExtractedText(rawText, preamble, {
        type: "docx",
        fileName: safeName,
      }, portalMode);
    }

    if (image && typeof image === "string") {
      if (!image.startsWith("data:image/")) {
        return NextResponse.json(
          { error: "Ugyldig bildeformat. Last opp en gyldig bildefil." },
          { status: 400 }
        );
      }
      if (image.length > 11_000_000) {
        return NextResponse.json(
          { error: "Bildet er for stort. Maks filstørrelse er 8 MB." },
          { status: 413 }
        );
      }
      const result = await analyzeImage(image);
      return wrapResponse(result, portalMode, "image");
    }

    return NextResponse.json(
      { error: "Mangler bilde, PDF, Word eller tekst i request body." },
      { status: 400 }
    );
  } catch (err) {
    console.error("[api/analyze]", err);
    return NextResponse.json(
      { error: "Noe gikk galt under analysen. Prøv igjen." },
      { status: 500 }
    );
  }
}
