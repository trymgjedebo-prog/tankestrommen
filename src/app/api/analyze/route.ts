import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  analyzeImageWithRouting,
  analyzeTextWithRouting,
} from "@/lib/ai/analyze-image";
import {
  parseDocumentKind,
  type AnalysisDocumentKind,
} from "@/lib/ai/analysis-model-router";
import { getDeployFingerprint } from "@/lib/deploy-fingerprint";
import { extractTextFromPdfBuffer } from "@/lib/pdf/extract-pdf-text";
import { extractTextFromDocxBuffer } from "@/lib/docx/extract-docx-text";
import type {
  AnalysisSourceHint,
  AIAnalysisResult,
  DayScheduleEntry,
  SchoolWeekOverlayDailyAction,
  SchoolWeekOverlayProposal,
  SchoolWeekOverlaySections,
  SchoolWeekOverlaySubjectUpdate,
  SchoolWeeklyProfile,
} from "@/lib/types";

/** pdf-parse / mammoth krever Node (ikke Edge). */
export const runtime = "nodejs";

const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_DOCX_BYTES = 12 * 1024 * 1024;
const MAX_DOC_TEXT_FOR_MODEL = 45_000;
const MAX_EXTRACTED_RAW_DISPLAY = 80_000;
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function allowedOrigins(): Set<string> {
  const fromEnv =
    process.env.CORS_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const foreldreAppOrigin = process.env.FORELDRE_APP_ORIGIN?.trim();
  return new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...fromEnv,
    ...(foreldreAppOrigin ? [foreldreAppOrigin] : []),
  ]);
}

function applyCorsHeaders(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins().has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.append("Vary", "Origin");
  }
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept",
  );
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

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
  includeDebug: boolean = false,
  documentKind?: AnalysisDocumentKind,
) {
  let textForModel = rawText;
  if (textForModel.length > MAX_DOC_TEXT_FOR_MODEL) {
    textForModel =
      textForModel.slice(0, MAX_DOC_TEXT_FOR_MODEL) +
      "\n\n[... Teksten er forkortet for analyse. Full tekst vises under «Original tekst».]";
  }

  let result;
  try {
    const routing = await analyzeTextWithRouting(preamble + textForModel, {
      documentKind: documentKind ?? undefined,
      sourceRoute: sourceHint.type === "pdf" ? "pdf" : "docx",
    });
    result = {
      ...routing.result,
      analysisModelTrace: routing.modelTrace,
    };
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

  return wrapResponse(
    result,
    portalMode,
    sourceHint.type,
    documentKind,
    {
      sourceHint,
      extractedText: {
        raw: displayRaw,
        language: result.extractedText.language || "no",
        confidence: 1,
      },
    },
    includeDebug,
  );
}

interface ParsedBody {
  image?: string;
  text?: string;
  pdf?: string;
  docx?: string;
  fileName?: string;
  /** Valgfri: timetable | activity_plan | event_doc | text | auto (streng fra JSON/multipart) */
  documentKind?: unknown;
}

async function fileToDataUrl(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  return `data:${file.type || "application/octet-stream"};base64,${buf.toString("base64")}`;
}

async function parseMultipartBody(request: NextRequest): Promise<ParsedBody> {
  const form = await request.formData();
  const file = form.get("file") as File | null;
  const textField = form.get("text") as string | null;
  const documentKind = parseDocumentKind(form.get("documentKind"));

  if (textField && typeof textField === "string") {
    return { text: textField, ...(documentKind ? { documentKind } : {}) };
  }

  if (!file) {
    return { ...(documentKind ? { documentKind } : {}) };
  }

  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  const dataUrl = await fileToDataUrl(file);

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return {
      pdf: dataUrl,
      fileName: file.name,
      ...(documentKind ? { documentKind } : {}),
    };
  }
  if (
    name.endsWith(".docx") ||
    mime.includes("wordprocessingml.document")
  ) {
    return {
      docx: dataUrl,
      fileName: file.name,
      ...(documentKind ? { documentKind } : {}),
    };
  }
  if (mime.startsWith("image/")) {
    return { image: dataUrl, ...(documentKind ? { documentKind } : {}) };
  }

  return {
    pdf: dataUrl,
    fileName: file.name,
    ...(documentKind ? { documentKind } : {}),
  };
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
    if (isStandaloneTaskCandidate(candidate)) continue;
    if (isPacklistOrRememberSuppliesOnly(candidate)) continue;
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

/** MVP: Foreldre-App beriker skoleblokk via metadata på importerte events. */
type SchoolPortalItemType =
  | "lesson_note"
  | "homework"
  | "reminder"
  | "general";

type SchoolSubjectCandidate = {
  /** Visningsnavn, f.eks. «Spansk». */
  subject: string;
  subjectKey: string;
  /**
   * 1 = høyest (første i plan / foretrukket for matching).
   * Lavere for neste alternativ – Foreldre-App kan velge blant kandidater.
   */
  weight: number;
};

type SchoolDayOverrideKind =
  | "exam_day"
  | "trip_day"
  | "activity_day"
  | "free_day"
  | "delayed_start"
  | "early_end";

/** Hvordan Foreldre-App bør behandle dagen – «merge» berikelse, «replace» trumfer normal plan. */
type SchoolDayOverrideMode = "merge" | "replace";

type SchoolDayOverride = {
  overrideMode: SchoolDayOverrideMode;
  overrideKind: SchoolDayOverrideKind;
  /** HH:MM, hvis kjent (særlig for delayed_start / early_end / heldagsprøve). */
  effectiveStart: string | null;
  effectiveEnd: string | null;
  /** Kort setning fra kilden, for UI-visning. */
  reason: string | null;
  /** 0–1. Settes lavere når deteksjon er svak. */
  confidence: number;
};

type EventSchoolContext = {
  /** Primært fagnavn for visning/matching (kan være første språk ved valg). */
  subject: string | null;
  subjectKey: string | null;
  customLabel: string | null;
  /**
   * Valgfritt: flere mulige fag (f.eks. spansk/tysk/fransk).
   * Mangler i JSON når tom – bakoverkompatibelt for eldre klienter.
   */
  subjectCandidates?: SchoolSubjectCandidate[];
  lessonStart: string | null;
  lessonEnd: string | null;
  itemType: SchoolPortalItemType;
  confidence: number;
  sourceKind: string;
};

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
    metadata?: {
      /** Vanlig skolekontekst for berikelse av eksisterende skoleblokk. */
      schoolContext?: EventSchoolContext;
      /**
       * Avviksdag som potensielt trumfer normal skoleplan.
       * Foreldre-App leser dette fra `event.metadata.schoolDayOverride`.
       */
      schoolDayOverride?: SchoolDayOverride;
    };
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

/** Ekte skolearbeid / frist – ikke generell huskeliste eller pakkeliste. */
const ACTIONABLE_TASK_RE = new RegExp(
  [
    String.raw`\b(innlevering|innlever(?:es|ing)?|lever\s*inn|frist|innleveringsdag)\b`,
    String.raw`\blekse(?:r)?\b`,
    String.raw`\boppgave(?:r)?\b`,
    String.raw`\b(gjør|gjor|fullfør|fullfor)\s+\w+`, // f.eks. «gjør oppgave»
    String.raw`les\s+(?:side|s\.?\s*\d+|kap\.?|kapitel|kapittel|\d)`,
    String.raw`skriv\s+(?:stil|essay|sammendrag|besvarelse|tekst|reportasje|notat)`,
    String.raw`øv(?:e)?\s+(?:til\s+)?(?:prøve|prove|tentamen|eksamen)`,
    String.raw`forbered(?:else)?\s+(?:til\s+)?(?:prøve|prove|tentamen)`,
  ].join("|"),
  "i",
);

const EVENT_KEYWORDS =
  /\b(prøve|prove|tentamen|tur|aktivitetsdag|forestilling|møte|mote|arrangement)\b/i;

function splitTaskCandidates(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/\n|;|•|-/)
    .map((part) => normalizeSpace(part))
    .filter((part) => part.length > 0);
}

/** Linjer som primært er «ta med» / utstyr – skal ikke bli egne tasks. */
function isPacklistOrRememberSuppliesOnly(raw: string | null): boolean {
  if (!raw) return false;
  const n = normalizeNorwegianLetters(raw);
  if (ACTIONABLE_TASK_RE.test(n)) return false;
  if (/\b(ta med|ta med deg|pakke(?:liste)?)\b/i.test(raw)) return true;
  if (
    /\bhusk\b/i.test(raw) &&
    /\b(pennal|skrivebok|skrivebøker|lærebok|larebok|notatbok|pc|laptop|ipad|nettbrett|oppladet|lader|sekken?|gymklær|treningstøy|matboks|flaske)\b/i.test(
      n,
    )
  ) {
    return true;
  }
  if (
    /\b(pennal|skrivebok|skrivebøker|oppladet\s*pc)\b/i.test(n) &&
    raw.length < 90
  ) {
    return true;
  }
  return false;
}

function isStandaloneTaskCandidate(text: string): boolean {
  const t = normalizeSpace(text);
  if (!t || isEventLikeText(t)) return false;
  if (isPacklistOrRememberSuppliesOnly(t)) return false;
  return ACTIONABLE_TASK_RE.test(normalizeNorwegianLetters(t));
}

function isEventLikeText(raw: string | null): boolean {
  if (!raw) return false;
  return EVENT_KEYWORDS.test(normalizeNorwegianLetters(raw));
}

function isSchoolPlanBundleContext(
  result: AIAnalysisResult,
  weekPlanLike: boolean,
): boolean {
  if (weekPlanLike) return true;
  const t = normalizeNorwegianLetters(result.title);
  return /\b(a-plan|aplan|ukeplan|aktivitetsplan|skoleplan)\b/.test(t);
}

function slugifySubjectKey(raw: string): string | null {
  const s = normalizeSpace(raw);
  if (s.length < 2) return null;
  const slug = normalizeNorwegianLetters(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

/** Venstre side ser ut som språkvalg / valgfag-bøtte (ikke konkret fagnavn). */
const GENERIC_SUBJECT_BUCKET_RE =
  /^(sprak|språk|fremmedsprak|fremmedspråk|valgfag|sprakvalg|språkvalg|felles|aktivitet|uke|programfag|program|linje|modul|moduler|studieretning)\b/i;

/** Typiske språk / spor der høyre side ofte lister alternativer. */
const LANGUAGE_OR_TRACK_HINT_RE =
  /\b(spansk|tysk|fransk|engelsk|italiensk|latin|russisk|portugis|polsk|mandarin|kinesisk|arabisk|kroatisk|svensk|dansk|nynorsk|bokmal|bokmål)\b/i;

/** Vanlige programfag (korte token – brukes til vekt-profil, ikke hard krav). */
const PROGRAM_SUBJECT_TOKEN_RE =
  /\b(matematikk|naturfag|samfunnsfag|norsk|engelsk|krle|rle|kunst|musikk|kor|korps|kroppsoving|kroppsøving|matte|natur|samf|historie|geografi|biologi|fysikk|kjemi|informasjon|programmering)\b/i;

type CandidateWeightProfile = "language_alternatives" | "elective_list" | "default";

function cleanSubjectToken(raw: string): string {
  return normalizeSpace(raw.replace(/[.,;:]+$/g, ""));
}

function splitSubjectAlternatives(text: string): string[] {
  return text
    .split(/\s*(?:,|\/|\||\bor\b|\beller\b)\s*/i)
    .map((s) => cleanSubjectToken(s))
    .filter((s) => s.length >= 2 && s.length <= 44);
}

function tokenLooksLikeLanguageOrTrack(s: string): boolean {
  return LANGUAGE_OR_TRACK_HINT_RE.test(s);
}

function tokenLooksLikeProgramSubject(s: string): boolean {
  return PROGRAM_SUBJECT_TOKEN_RE.test(normalizeNorwegianLetters(s));
}

function detectCandidateWeightProfile(
  uniq: string[],
  genericLeft: boolean,
): CandidateWeightProfile {
  if (uniq.length < 2) return "default";
  const allLang =
    uniq.length >= 2 && uniq.every((s) => tokenLooksLikeLanguageOrTrack(s));
  if (allLang) return "language_alternatives";
  if (genericLeft) return "elective_list";
  const allProg =
    uniq.length >= 2 && uniq.every((s) => tokenLooksLikeProgramSubject(s));
  if (allProg) return "elective_list";
  return "default";
}

/** Vekter for Foreldre-App: tydeligere topp ved språk, litt flatere ved lange lister. */
function alternativeWeights(
  n: number,
  profile: CandidateWeightProfile,
): number[] {
  if (n <= 0) return [];
  if (n === 1) return [1];
  if (profile === "language_alternatives") {
    return Array.from({ length: n }, (_, i) =>
      Math.max(0.58, 1 - i * (0.1 + 0.015 * Math.max(0, n - 3))),
    );
  }
  if (profile === "elective_list") {
    return Array.from({ length: n }, (_, i) =>
      Math.max(0.48, 1 - i * (0.14 + 0.025 * Math.max(0, n - 3))),
    );
  }
  return Array.from({ length: n }, (_, i) =>
    Math.max(0.38, 1 - (i * 0.7) / Math.max(n, 1)),
  );
}

function shouldTreatRightAsSubjectAlternatives(left: string, right: string): boolean {
  const alts = splitSubjectAlternatives(right);
  if (alts.length < 2) return false;
  if (GENERIC_SUBJECT_BUCKET_RE.test(normalizeNorwegianLetters(left))) return true;
  return LANGUAGE_OR_TRACK_HINT_RE.test(right);
}

function dedupeSubjectCandidates(
  candidates: SchoolSubjectCandidate[],
): SchoolSubjectCandidate[] {
  const byKey = new Map<string, SchoolSubjectCandidate>();
  for (const c of candidates) {
    const prev = byKey.get(c.subjectKey);
    if (!prev || prev.weight < c.weight) byKey.set(c.subjectKey, c);
  }
  return [...byKey.values()].sort((a, b) => b.weight - a.weight);
}

function candidatesFromSubjectList(
  subjects: string[],
  fullCustomLabel: string,
  opts?: { genericLeft?: boolean },
): {
  subject: string | null;
  subjectKey: string | null;
  customLabel: string | null;
  subjectCandidates: SchoolSubjectCandidate[];
} {
  const uniq = [...new Set(subjects.map((s) => cleanSubjectToken(s)))].filter(Boolean);
  const n = uniq.length;
  const profile = detectCandidateWeightProfile(uniq, Boolean(opts?.genericLeft));
  const weights = alternativeWeights(n, profile);
  const raw: SchoolSubjectCandidate[] = uniq.map((subj, i) => {
    const key =
      slugifySubjectKey(subj) ||
      normalizeNorwegianLetters(subj).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
      "fag";
    const weight = weights[i] ?? weights[weights.length - 1] ?? 1;
    return { subject: subj, subjectKey: key, weight };
  });
  const deduped = dedupeSubjectCandidates(raw);
  const first = deduped[0];
  return {
    subject: first?.subject ?? null,
    subjectKey: first?.subjectKey ?? null,
    customLabel: normalizeSpace(fullCustomLabel),
    subjectCandidates: deduped,
  };
}

/**
 * Tolker én programlinje til subject / subjectKey / customLabel og ev. flere kandidater.
 */
function parseProgramSchoolFields(line: string | null): {
  subject: string | null;
  subjectKey: string | null;
  customLabel: string | null;
  subjectCandidates: SchoolSubjectCandidate[];
} {
  const empty = {
    subject: null as string | null,
    subjectKey: null as string | null,
    customLabel: null as string | null,
    subjectCandidates: [] as SchoolSubjectCandidate[],
  };
  if (!line) return empty;
  const t = normalizeSpace(line);
  const m = /^(.{2,50}?)\s*[–:—-]\s+(.+)$/.exec(t);
  if (!m) {
    const alts = splitSubjectAlternatives(t);
    if (alts.length >= 2 && LANGUAGE_OR_TRACK_HINT_RE.test(t)) {
      return candidatesFromSubjectList(alts, t, { genericLeft: false });
    }
    return { ...empty, customLabel: normalizeSpace(t) };
  }
  const left = normalizeSpace(m[1]);
  const right = normalizeSpace(m[2]);
  if (left.length < 2 || left.length > 48) {
    return { ...empty, customLabel: t };
  }

  if (shouldTreatRightAsSubjectAlternatives(left, right)) {
    const alts = splitSubjectAlternatives(right);
    if (alts.length >= 1) {
      const genericLeft = GENERIC_SUBJECT_BUCKET_RE.test(
        normalizeNorwegianLetters(left),
      );
      return candidatesFromSubjectList(alts, `${left} – ${right}`, {
        genericLeft,
      });
    }
  }

  const key = slugifySubjectKey(left);
  const single: SchoolSubjectCandidate[] =
    key ? [{ subject: cleanSubjectToken(left), subjectKey: key, weight: 1 }] : [];
  return {
    subject: cleanSubjectToken(left),
    subjectKey: key,
    customLabel: normalizeSpace(`${left} – ${right}`),
    subjectCandidates: single,
  };
}

/** Svake og sterke signaler for spesialdager. Holdes bevisst enkelt i MVP. */
const OVERRIDE_PATTERNS: Array<{
  kind: SchoolDayOverrideKind;
  mode: SchoolDayOverrideMode;
  baseConfidence: number;
  regex: RegExp;
}> = [
  {
    kind: "exam_day",
    mode: "replace",
    baseConfidence: 0.8,
    regex:
      /\b(heldagsprøve|heldagsprove|heldags\s*prove|tentamen|eksamensdag|skriftlig\s+eksamen|muntlig\s+eksamen)\b/i,
  },
  {
    kind: "trip_day",
    mode: "replace",
    baseConfidence: 0.75,
    regex:
      /\b(skoletur|klassetur|ekskursjon|leirskole|leirdag|dagstur|studietur|tur til)\b/i,
  },
  {
    kind: "activity_day",
    mode: "replace",
    baseConfidence: 0.7,
    regex:
      /\b(aktivitetsdag|idrettsdag|temadag|opplevelsesdag|friluftsdag|karneval|skolefest|forestilling)\b/i,
  },
  {
    kind: "free_day",
    mode: "replace",
    baseConfidence: 0.8,
    regex:
      /\b(fri|fridag|skolefri|planleggingsdag|studiedag|elevfri|fri\s+dag|ingen\s+undervisning|helligdag)\b/i,
  },
  {
    kind: "delayed_start",
    mode: "replace",
    baseConfidence: 0.7,
    regex:
      /\b(senere\s+start|sen\s+start|skolen\s+starter\s+(?:kl\.?\s*)?\d{1,2}(?:[.:]\d{2})?|oppmote\s+kl|oppmøte\s+kl|møt\s+(?:kl\.?\s*)?\d)/i,
  },
  {
    kind: "early_end",
    mode: "replace",
    baseConfidence: 0.7,
    regex:
      /\b(tidligere\s+slutt|tidlig\s+slutt|kortere\s+dag|skoledagen\s+slutter\s+(?:kl\.?\s*)?\d{1,2}(?:[.:]\d{2})?|slutter\s+tidlig|fri\s+etter\s+(?:kl\.?\s*)?\d)/i,
  },
];

function extractEffectiveTimes(text: string): {
  start: string | null;
  end: string | null;
} {
  const range = /(\d{1,2}[.:]\d{2})\s*[-–—]\s*(\d{1,2}[.:]\d{2})/.exec(text);
  if (range) {
    return {
      start: range[1].replace(".", ":"),
      end: range[2].replace(".", ":"),
    };
  }
  const single = /(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})\b/i.exec(text);
  if (single) {
    const hh = String(Number(single[1])).padStart(2, "0");
    return { start: `${hh}:${single[2]}`, end: null };
  }
  const bareHour = /\bkl\.?\s*(\d{1,2})\b/i.exec(text);
  if (bareHour) {
    const hh = String(Number(bareHour[1])).padStart(2, "0");
    return { start: `${hh}:00`, end: null };
  }
  return { start: null, end: null };
}

function firstSentenceContaining(text: string, re: RegExp): string | null {
  const parts = text.split(/(?<=[.!?\n])\s+/);
  for (const p of parts) {
    if (re.test(p)) return normalizeSpace(p);
  }
  return normalizeSpace(text);
}

function detectSchoolDayOverride(
  day: DayScheduleEntry,
  fallbackTime: string | null,
): SchoolDayOverride | null {
  const haystack = [
    day.dayLabel ?? "",
    day.details ?? "",
    ...day.highlights,
    ...day.notes,
  ]
    .filter((s) => typeof s === "string" && s.length > 0)
    .join("\n");
  if (!haystack) return null;

  for (const pat of OVERRIDE_PATTERNS) {
    if (!pat.regex.test(haystack)) continue;

    const reason = firstSentenceContaining(haystack, pat.regex);
    const times = extractEffectiveTimes(reason ?? haystack);
    let effectiveStart = times.start;
    let effectiveEnd = times.end;

    if (!effectiveStart && !effectiveEnd && fallbackTime) {
      const fallback = extractStartEnd(fallbackTime);
      effectiveStart = fallback.start;
      effectiveEnd = fallback.end;
    }

    // Litt høyere tillit når vi fant et eksplisitt klokkeslett i samme setning.
    const timeBoost = times.start ? 0.1 : 0;
    const confidence = Math.min(1, pat.baseConfidence + timeBoost);

    return {
      overrideMode: pat.mode,
      overrideKind: pat.kind,
      effectiveStart,
      effectiveEnd,
      reason,
      confidence,
    };
  }

  return null;
}

function portalSourceKind(
  sourceType: string,
  weekPlanLike: boolean,
  title: string,
): string {
  const n = normalizeNorwegianLetters(title);
  if (/\b(a-plan|aplan)\b/.test(n)) return "a_plan";
  if (/\b(ukeplan|aktivitetsplan|skoleplan)\b/.test(n)) return "school_week";
  if (weekPlanLike) return "school_week";
  if (sourceType === "docx") return "school_docx";
  if (sourceType === "pdf") return "school_pdf";
  return `school_${sourceType || "unknown"}`;
}

function buildEventSchoolContext(
  day: DayScheduleEntry,
  result: AIAnalysisResult,
  sourceType: string,
  weekPlanLike: boolean,
  time: string | null,
): EventSchoolContext | null {
  if (!isSchoolPlanBundleContext(result, weekPlanLike)) return null;

  const dayContext = {
    rememberItems: day.rememberItems,
    deadlines: day.deadlines,
    notes: day.notes,
    highlights: day.highlights,
    details: day.details ?? undefined,
  };
  const hint = extractEventProgramHint(dayContext);
  let parsed = {
    subject: null as string | null,
    subjectKey: null as string | null,
    customLabel: null as string | null,
    subjectCandidates: [] as SchoolSubjectCandidate[],
  };

  if (hint) {
    parsed = parseProgramSchoolFields(hint);
  } else if (day.highlights[0]) {
    const h = day.highlights[0];
    if (
      !isStandaloneTaskCandidate(h) &&
      !isPacklistOrRememberSuppliesOnly(h)
    ) {
      parsed = parseProgramSchoolFields(h);
    }
  }

  const { start, end } = extractStartEnd(time);
  const hadProgramHint = Boolean(hint);
  let itemType: SchoolPortalItemType = "general";
  if (hadProgramHint || parsed.subjectKey) {
    itemType = "lesson_note";
  } else if (day.rememberItems.length > 0) {
    itemType = "reminder";
  }

  const multiCandidates =
    parsed.subjectCandidates.length > 1 ? parsed.subjectCandidates : undefined;

  return {
    subject: parsed.subject ? cleanSubjectToken(parsed.subject) : null,
    subjectKey: parsed.subjectKey,
    customLabel: parsed.customLabel ? normalizeSpace(parsed.customLabel) : null,
    ...(multiCandidates ? { subjectCandidates: multiCandidates } : {}),
    lessonStart: time ? start : null,
    lessonEnd: time ? end : null,
    itemType,
    confidence: result.confidence,
    sourceKind: portalSourceKind(sourceType, weekPlanLike, result.title),
  };
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
    const tasksSection = asListSection("Husk / ta med", dayContext.rememberItems);
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
    schoolContext?: EventSchoolContext | null,
    schoolDayOverride?: SchoolDayOverride | null,
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
    if (schoolContext || schoolDayOverride) {
      item.event.metadata = {
        ...(schoolContext ? { schoolContext } : {}),
        ...(schoolDayOverride ? { schoolDayOverride } : {}),
      };
    }
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

      // Huskeliste / «ta med» ligger i event-notater; ikke egne tasks.
      const taskCandidates = [
        ...day.deadlines,
        ...day.notes.flatMap((n) => splitTaskCandidates(n)),
        ...splitTaskCandidates(day.details),
      ];
      const taskTexts = Array.from(
        new Set(
          taskCandidates
            .map((text) => normalizeSpace(text))
            .filter((text) => text.length > 0 && isStandaloneTaskCandidate(text)),
        ),
      );

      const combinedDayText = [
        day.details,
        ...day.highlights,
        ...day.notes,
      ].join(" ");
      const detailParts = day.details ? splitTaskCandidates(day.details) : [];
      const hasNonTaskDetailPart =
        detailParts.some(
          (p) => !isStandaloneTaskCandidate(p) && normalizeSpace(p).length > 0,
        ) ||
        (detailParts.length === 0 &&
          Boolean(day.details) &&
          normalizeSpace(day.details ?? "").length > 0 &&
          !isStandaloneTaskCandidate(day.details ?? ""));
      const hasNonTaskNote = day.notes.some((n) => {
        const parts = splitTaskCandidates(n);
        if (parts.length === 0) {
          return normalizeSpace(n).length > 0 && !isStandaloneTaskCandidate(n);
        }
        return parts.some(
          (p) => !isStandaloneTaskCandidate(p) && normalizeSpace(p).length > 0,
        );
      });
      const hasEventSignal =
        Boolean(day.time) ||
        isEventLikeText(combinedDayText) ||
        day.highlights.length > 0 ||
        hasNonTaskDetailPart ||
        day.rememberItems.length > 0 ||
        hasNonTaskNote;

      if (hasEventSignal || taskTexts.length === 0) {
        const schoolCtx = buildEventSchoolContext(
          day,
          result,
          sourceType,
          weekPlanLike,
          day.time,
        );
        // Override detekteres separat og legges på event.metadata.schoolDayOverride.
        // Vanlige skoledager får kun schoolContext; avviksdager får ev. begge.
        const dayOverride = isSchoolPlanBundleContext(result, weekPlanLike)
          ? detectSchoolDayOverride(day, day.time)
          : null;
        items.push(
          buildEventItem(
            isoDate,
            day.time,
            day.dayLabel,
            day.details,
            {
              rememberItems: day.rememberItems,
              deadlines: day.deadlines,
              notes: day.notes,
              highlights: day.highlights,
            },
            schoolCtx,
            dayOverride,
          ),
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
      if (isStandaloneTaskCandidate(slotSignal) && !isEventLikeText(slotSignal)) {
        items.push(buildTaskItem(isoDate, slot.label, slotSignal));
      } else {
        items.push(
          buildEventItem(isoDate, slot.time, slot.label, null, undefined, null, null),
        );
      }
    }
  }

  if (items.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    items.push(buildEventItem(today, null, null, null, undefined, null, null));
  }

  return items;
}

function isUsableSchoolWeeklyProfile(
  p: SchoolWeeklyProfile | undefined,
): p is SchoolWeeklyProfile {
  if (!p || typeof p !== "object") return false;
  const keys = Object.keys(p.weekdays ?? {});
  return keys.length > 0;
}

function schoolWeekdayIndexFromLabel(raw: string | null): "0" | "1" | "2" | "3" | "4" | null {
  if (!raw) return null;
  const n = normalizeNorwegianLetters(raw);
  if (/\b(man(day)?|mandag)\b/i.test(raw) || /\bmandag\b/.test(n)) return "0";
  if (/\b(tue(s(day)?)?|tirsdag)\b/i.test(raw) || /\btirsdag\b/.test(n)) return "1";
  if (/\b(wed(nesday)?|onsdag)\b/i.test(raw) || /\bonsdag\b/.test(n)) return "2";
  if (/\b(thu(rs(day)?)?|torsdag)\b/i.test(raw) || /\btorsdag\b/.test(n)) return "3";
  if (/\b(fri(day)?|fredag)\b/i.test(raw) || /\bfredag\b/.test(n)) return "4";
  return null;
}

function looksLikeRecurringTimetable(result: AIAnalysisResult): {
  yes: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const title = normalizeNorwegianLetters(result.title || "");
  if (/\b(timeplan|ukeskjema|skoletimeplan|timetable)\b/.test(title)) {
    reasons.push("title_timetable_keyword");
  }
  if (result.scheduleByDay.length >= 3) {
    reasons.push("scheduleByDay_count>=3");
  }
  const weekdayRows = result.scheduleByDay.filter((d) =>
    Boolean(schoolWeekdayIndexFromLabel(d.dayLabel)),
  ).length;
  if (weekdayRows >= 2) {
    reasons.push("scheduleByDay_weekday_rows>=2");
  }
  const scheduleWeekdayRows = result.schedule.filter((s) =>
    Boolean(schoolWeekdayIndexFromLabel(s.label)),
  ).length;
  if (scheduleWeekdayRows >= 2) {
    reasons.push("schedule_weekday_rows>=2");
  }
  return { yes: reasons.length > 0, reasons };
}

function synthesizeSchoolWeeklyProfileFromTimetableSignals(
  result: AIAnalysisResult,
): SchoolWeeklyProfile | null {
  const byDay = new Map<"0" | "1" | "2" | "3" | "4", Array<{ start: string; end: string }>>();
  const put = (idx: "0" | "1" | "2" | "3" | "4", time: string | null) => {
    const { start, end } = extractStartEnd(time);
    const arr = byDay.get(idx) ?? [];
    arr.push({ start, end });
    byDay.set(idx, arr);
  };

  for (const d of result.scheduleByDay) {
    const idx = schoolWeekdayIndexFromLabel(d.dayLabel);
    if (!idx) continue;
    put(idx, d.time);
  }
  for (const s of result.schedule) {
    const idx = schoolWeekdayIndexFromLabel(s.label);
    if (!idx) continue;
    put(idx, s.time);
  }

  const weekdays: Partial<Record<"0" | "1" | "2" | "3" | "4", { useSimpleDay: true; schoolStart: string; schoolEnd: string }>> = {};
  for (const [idx, slots] of byDay.entries()) {
    if (slots.length === 0) continue;
    const starts = slots.map((x) => x.start).sort();
    const ends = slots.map((x) => x.end).sort();
    weekdays[idx] = {
      useSimpleDay: true,
      schoolStart: starts[0],
      schoolEnd: ends[ends.length - 1],
    };
  }
  if (Object.keys(weekdays).length < 2) return null;
  return {
    gradeBand: null,
    weekdays,
  };
}

/**
 * Egen import-flyt for fast timeplan → Foreldre-App `ChildSchoolProfile`.
 * Toppnivåfelt (ikke `items`) så kalender-import ikke blander inn profile-rader.
 */
function buildSchoolProfileProposal(
  result: AIAnalysisResult,
  sourceType: string,
): Record<string, unknown> | undefined {
  if (!isUsableSchoolWeeklyProfile(result.schoolWeeklyProfile)) return undefined;
  return {
    proposalId: randomUUID(),
    kind: "school_profile",
    schemaVersion: "1.0.0",
    confidence: result.confidence,
    profile: result.schoolWeeklyProfile,
    sourceTitle: result.title,
    originalSourceType: sourceType,
  };
}

function buildSchoolProfileProposalFromProfile(
  profile: SchoolWeeklyProfile,
  sourceType: string,
  sourceTitle: string,
  confidence: number,
): Record<string, unknown> {
  return {
    proposalId: randomUUID(),
    kind: "school_profile",
    schemaVersion: "1.0.0",
    confidence,
    profile,
    sourceTitle,
    originalSourceType: sourceType,
  };
}

function decideSchoolProfileProposal(
  result: AIAnalysisResult,
  sourceType: string,
  documentKind?: AnalysisDocumentKind,
): { proposal?: Record<string, unknown>; decision: Record<string, unknown> } {
  const existing = buildSchoolProfileProposal(result, sourceType);
  if (existing) {
    return {
      proposal: existing,
      decision: {
        path: "school_profile",
        reason: "usable_schoolWeeklyProfile_from_analysis",
      },
    };
  }

  const looks = looksLikeRecurringTimetable(result);
  if (documentKind === "timetable" && looks.yes) {
    const synthesized = synthesizeSchoolWeeklyProfileFromTimetableSignals(result);
    if (synthesized) {
      return {
        proposal: buildSchoolProfileProposalFromProfile(
          synthesized,
          sourceType,
          result.title,
          Math.min(result.confidence, 0.55),
        ),
        decision: {
          path: "school_profile",
          reason: "timetable_documentKind_with_weekly_signals_synthesized_profile",
          signals: looks.reasons,
        },
      };
    }
    return {
      decision: {
        path: "event_items_fallback",
        reason: "timetable_documentKind_but_not_enough_weekday_signals_for_profile",
        signals: looks.reasons,
      },
    };
  }

  return {
    decision: {
      path: "event_items_fallback",
      reason:
        documentKind === "timetable"
          ? "timetable_documentKind_without_weekly_signals"
          : "no_usable_schoolWeeklyProfile",
      signals: looks.reasons,
    },
  };
}

function isLikelyActivityPlanOverlay(
  result: AIAnalysisResult,
  documentKind: AnalysisDocumentKind | undefined,
): { yes: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const titleNorm = normalizeNorwegianLetters(result.title || "");
  const hasActivityTitleHint =
    /\b(a-plan|aplan|aktivitetsplan|arbeidsplan|ukeplan)\b/.test(titleNorm);
  if (documentKind === "activity_plan") reasons.push("document_kind:activity_plan");
  if (hasActivityTitleHint) reasons.push("title_activity_plan_keyword");

  const weekContext = [
    result.title,
    result.description,
    ...result.scheduleByDay.map((d) => `${d.dayLabel ?? ""} ${d.date ?? ""}`),
  ].join(" ");
  const weekNumber = parseWeekNumber(weekContext);
  if (weekNumber !== null) reasons.push("week_number_detected");

  const weekdayRows = result.scheduleByDay.filter((d) =>
    Boolean(schoolWeekdayIndexFromLabel(d.dayLabel)),
  ).length;
  if (weekdayRows >= 2) reasons.push("scheduleByDay_weekday_rows>=2");
  if (result.scheduleByDay.length >= 3) reasons.push("scheduleByDay_count>=3");

  const daySignal = weekdayRows >= 2 || result.scheduleByDay.length >= 3;
  const activitySignal = documentKind === "activity_plan" || hasActivityTitleHint;
  const yes = activitySignal && daySignal && weekNumber !== null;
  return { yes, reasons };
}

function detectOverlayActionKind(day: DayScheduleEntry): SchoolWeekOverlayDailyAction["action"] {
  const text = normalizeNorwegianLetters(
    [day.details ?? "", ...day.highlights, ...day.notes, ...day.rememberItems, ...day.deadlines]
      .filter(Boolean)
      .join(" "),
  );
  if (/\b(fri|fridag|skolefri|planleggingsdag|elevfri)\b/.test(text)) {
    return "remove_school_block";
  }
  if (
    /\b(heldagsprøve|heldagsprove|forberedelsesdag|tentamen|turdag|aktivitetsdag)\b/.test(
      text,
    )
  ) {
    return "replace_school_block";
  }
  return "enrich_existing_school_block";
}

function compactLines(lines: Array<string | null | undefined>, max = 6): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const v = normalizeSpace(raw ?? "");
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function buildOverlaySections(day: DayScheduleEntry): SchoolWeekOverlaySections {
  const noteLines = compactLines(day.notes);
  const proveFromNotes = noteLines.filter((n) =>
    /\b(prøve|prove|vurdering|test|tentamen)\b/i.test(n),
  );
  const resourceFromNotes = noteLines.filter((n) =>
    /(https?:\/\/|www\.|campus|skolenmin|itslearning|teams)/i.test(n),
  );
  const lekseFromNotes = noteLines.filter(
    (n) =>
      /\b(lekse|oppgave|les|skriv|gj[oø]r)\b/i.test(n) &&
      !proveFromNotes.includes(n) &&
      !resourceFromNotes.includes(n),
  );
  const extraFromNotes = noteLines.filter(
    (n) =>
      !proveFromNotes.includes(n) &&
      !resourceFromNotes.includes(n) &&
      !lekseFromNotes.includes(n),
  );
  return {
    ...(day.highlights.length > 0
      ? { iTimen: compactLines(day.highlights) }
      : {}),
    ...(lekseFromNotes.length > 0 ? { lekse: lekseFromNotes } : {}),
    ...(day.rememberItems.length > 0 ? { husk: compactLines(day.rememberItems) } : {}),
    ...(day.deadlines.length > 0 || proveFromNotes.length > 0
      ? { proveVurdering: compactLines([...day.deadlines, ...proveFromNotes]) }
      : {}),
    ...(resourceFromNotes.length > 0 ? { ressurser: resourceFromNotes } : {}),
    ...(day.details || extraFromNotes.length > 0
      ? { ekstraBeskjed: compactLines([day.details, ...extraFromNotes]) }
      : {}),
  };
}

function resolveLanguageTrack(result: AIAnalysisResult): SchoolWeekOverlayProposal["languageTrack"] {
  const text = normalizeNorwegianLetters(
    [result.title, result.description, ...result.scheduleByDay.map((d) => d.details ?? "")]
      .filter(Boolean)
      .join(" "),
  );
  const tracks = [
    /\btysk\b/.test(text) ? "tysk" : null,
    /\bspansk\b/.test(text) ? "spansk" : null,
    /\bfransk\b/.test(text) ? "fransk" : null,
  ].filter((x): x is string => Boolean(x));
  if (tracks.length === 1) {
    return { resolvedTrack: tracks[0], confidence: 0.8, reason: "single_track_detected" };
  }
  if (tracks.length > 1) {
    return { resolvedTrack: null, confidence: 0.45, reason: "multiple_tracks_detected" };
  }
  return { resolvedTrack: null, confidence: 0.35, reason: "no_track_detected" };
}

function buildSchoolWeekOverlayProposal(
  result: AIAnalysisResult,
  sourceType: string,
): SchoolWeekOverlayProposal | undefined {
  const dailyActions: SchoolWeekOverlayProposal["dailyActions"] = {};
  for (const day of result.scheduleByDay) {
    const idx = schoolWeekdayIndexFromLabel(day.dayLabel);
    if (!idx) continue;
    const parsed = parseProgramSchoolFields(
      day.details || day.highlights[0] || day.notes[0] || null,
    );
    const sections = buildOverlaySections(day);
    const hasSectionContent = Object.values(sections).some((v) => Array.isArray(v) && v.length > 0);
    const subjectUpdates: SchoolWeekOverlaySubjectUpdate[] =
      hasSectionContent || parsed.subjectKey || parsed.customLabel
        ? [
            {
              subjectKey: parsed.subjectKey,
              customLabel: parsed.customLabel ?? null,
              sections,
            },
          ]
        : [];
    dailyActions[idx] = {
      action: detectOverlayActionKind(day),
      reason: day.details ?? null,
      summary: compactLines([day.details, ...day.highlights], 1)[0] ?? null,
      subjectUpdates,
    };
  }
  if (Object.keys(dailyActions).length < 2) return undefined;

  const weekContext = [
    result.title,
    result.description,
    ...result.scheduleByDay.map((d) => `${d.dayLabel ?? ""} ${d.date ?? ""}`),
  ].join(" ");
  const weekNumber = parseWeekNumber(weekContext);
  const weeklySummary = compactLines(
    [
      result.description,
      ...result.scheduleByDay.flatMap((d) => [d.details, ...d.highlights, ...d.deadlines]),
    ],
    4,
  );
  return {
    proposalId: randomUUID(),
    kind: "school_week_overlay",
    schemaVersion: "1.0.0",
    confidence: Math.max(0.45, Math.min(result.confidence, 0.8)),
    sourceTitle: result.title,
    originalSourceType: sourceType,
    weekNumber,
    classLabel: result.targetGroup,
    weeklySummary,
    languageTrack: resolveLanguageTrack(result),
    profileMatch: {
      confidence: result.targetGroup ? 0.65 : 0.45,
      reason: result.targetGroup ? "target_group_present" : "target_group_missing",
    },
    dailyActions,
  };
}

function decideSchoolWeekOverlayProposal(
  result: AIAnalysisResult,
  sourceType: string,
  documentKind: AnalysisDocumentKind | undefined,
): { proposal?: SchoolWeekOverlayProposal; decision: Record<string, unknown> } {
  const looks = isLikelyActivityPlanOverlay(result, documentKind);
  if (!looks.yes) {
    return {
      decision: {
        path: "event_items_fallback",
        reason: "not_likely_activity_plan_overlay",
        signals: looks.reasons,
      },
    };
  }
  const proposal = buildSchoolWeekOverlayProposal(result, sourceType);
  if (!proposal) {
    return {
      decision: {
        path: "event_items_fallback",
        reason: "overlay_candidate_but_insufficient_daily_actions",
        signals: looks.reasons,
      },
    };
  }
  return {
    proposal,
    decision: {
      path: "school_week_overlay",
      reason: "activity_plan_overlay_selected",
      signals: looks.reasons,
      dailyActions: Object.keys(proposal.dailyActions).length,
    },
  };
}

function toPortalBundle(
  result: AIAnalysisResult,
  sourceType: string,
  documentKind: AnalysisDocumentKind | undefined,
  includeDebug: boolean,
): Record<string, unknown> {
  const { proposal: schoolProfileProposal, decision: schoolProfileDecision } = decideSchoolProfileProposal(
    result,
    sourceType,
    documentKind,
  );
  const {
    proposal: schoolWeekOverlayProposal,
    decision: schoolWeekOverlayDecision,
  } = schoolProfileProposal
    ? {
        proposal: undefined,
        decision: {
          path: "overlay_skipped",
          reason: "school_profile_already_selected",
        },
      }
    : decideSchoolWeekOverlayProposal(result, sourceType, documentKind);
  const items =
    schoolProfileProposal || schoolWeekOverlayProposal
      ? []
      : buildProposalItems(result, sourceType);
  console.log("[api/analyze] school-routing", {
    documentKind: documentKind ?? null,
    schoolProfilePath: schoolProfileDecision.path,
    schoolProfileReason: schoolProfileDecision.reason,
    schoolProfileSignals: schoolProfileDecision.signals ?? [],
    schoolWeekOverlayPath: schoolWeekOverlayDecision.path,
    schoolWeekOverlayReason: schoolWeekOverlayDecision.reason,
    schoolWeekOverlaySignals: schoolWeekOverlayDecision.signals ?? [],
    hasSchoolProfileProposal: Boolean(schoolProfileProposal),
    hasSchoolWeekOverlayProposal: Boolean(schoolWeekOverlayProposal),
    itemCount: items.length,
  });
  const debugPayload: Record<string, unknown> = {};
  if (includeDebug) {
    debugPayload.deploy = getDeployFingerprint();
    debugPayload.schoolProfileRouting = schoolProfileDecision;
    debugPayload.schoolWeekOverlayRouting = schoolWeekOverlayDecision;
  }
  if (includeDebug && result.schoolWeeklyProfileDebug) {
    debugPayload.schoolWeeklyProfile = result.schoolWeeklyProfileDebug;
  }
  if (includeDebug && result.analysisModelTrace) {
    debugPayload.analysisModel = result.analysisModelTrace;
  }
  return {
    schemaVersion: "1.0.0",
    provenance: {
      sourceSystem: "tankestrom",
      sourceType,
      generatedAt: new Date().toISOString(),
      importRunId: randomUUID(),
    },
    items,
    ...(schoolProfileProposal ? { schoolProfileProposal } : {}),
    ...(schoolWeekOverlayProposal ? { schoolWeekOverlayProposal } : {}),
    ...(Object.keys(debugPayload).length > 0 ? { debug: debugPayload } : {}),
  };
}

function isDebugRequest(request: NextRequest): boolean {
  const p = request.nextUrl.searchParams.get("debug");
  if (p === "1" || p === "true") return true;
  const h = (request.headers.get("x-tankestrom-debug") ?? "").toLowerCase();
  return h === "1" || h === "true";
}

function wrapResponse(
  result: AIAnalysisResult,
  portalMode: boolean,
  sourceType: string,
  documentKind: AnalysisDocumentKind | undefined,
  extra?: Record<string, unknown>,
  includeDebug: boolean = false,
): NextResponse {
  if (portalMode) {
    const bundle = toPortalBundle(
      includeDebug ? result : stripInternalAnalysisDebug(result),
      sourceType,
      documentKind,
      includeDebug,
    );
    console.log("[api/analyze] portal-mode → returning PortalImportProposalBundle", {
      schemaVersion: bundle.schemaVersion,
      itemCount: (bundle.items as unknown[]).length,
      hasSchoolProfile: Boolean(bundle.schoolProfileProposal),
      hasSchoolWeekOverlay: Boolean(
        (bundle as Record<string, unknown>).schoolWeekOverlayProposal,
      ),
      schoolProfileRouting: (bundle.debug as Record<string, unknown> | undefined)
        ?.schoolProfileRouting ?? null,
      schoolWeekOverlayRouting: (bundle.debug as Record<string, unknown> | undefined)
        ?.schoolWeekOverlayRouting ?? null,
      debug: Boolean(bundle.debug),
    });
    return NextResponse.json(bundle);
  }
  // Non-portal: strip debug by default, keep when asked.
  const clean = includeDebug ? result : stripInternalAnalysisDebug(result);
  const deployWrap = includeDebug ? { deploy: getDeployFingerprint() } : {};
  return NextResponse.json(
    extra ? { ...clean, ...extra, ...deployWrap } : { ...clean, ...deployWrap },
  );
}

/** Fjerner interne debug-felter fra AIAnalysisResult når klient ikke ba om debug. */
function stripInternalAnalysisDebug(result: AIAnalysisResult): AIAnalysisResult {
  const { schoolWeeklyProfileDebug: _sw, analysisModelTrace: _am, ...rest } =
    result;
  return rest as AIAnalysisResult;
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
  const withCors = (res: NextResponse) => applyCorsHeaders(request, res);
  try {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      return withCors(NextResponse.json(
        {
          error:
            "Analyse-tjenesten er ikke konfigurert (mangler OPENAI_API_KEY).",
        },
        { status: 503 }
      ));
    }

    const multipart = isMultipart(request);
    const portalMode = detectPortalMode(request);
    const debug = isDebugRequest(request);
    console.log("[api/analyze] incoming request", {
      contentType: request.headers.get("content-type"),
      multipart,
      portalMode,
      debug,
    });

    const body: ParsedBody = multipart
      ? await parseMultipartBody(request)
      : await request.json();
    const { image, text, pdf, docx, fileName } = body;
    const documentKind = parseDocumentKind(body.documentKind);

    if (text && typeof text === "string") {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return withCors(
          NextResponse.json({ error: "Teksten er tom." }, { status: 400 }),
        );
      }
      if (trimmed.length > 15_000) {
        return withCors(NextResponse.json(
          { error: "Teksten er for lang. Maks 15 000 tegn." },
          { status: 413 }
        ));
      }
      const routing = await analyzeTextWithRouting(trimmed, {
        documentKind: documentKind ?? undefined,
        sourceRoute: "text",
      });
      const result: AIAnalysisResult = {
        ...routing.result,
        analysisModelTrace: routing.modelTrace,
      };
      return withCors(
        wrapResponse(result, portalMode, "text", documentKind, undefined, debug),
      );
    }

    if (pdf && typeof pdf === "string") {
      if (pdf.length > 18_000_000) {
        return withCors(NextResponse.json(
          { error: "PDF-filen er for stor. Maks ca. 12 MB." },
          { status: 413 }
        ));
      }
      let buffer: Buffer;
      try {
        buffer = pdfDataUrlToBuffer(pdf);
      } catch {
        return withCors(NextResponse.json(
          { error: "Ugyldig PDF-data. Last opp filen på nytt." },
          { status: 400 }
        ));
      }
      if (buffer.length > MAX_PDF_BYTES) {
        return withCors(NextResponse.json(
          { error: "PDF-filen er for stor. Maks 12 MB." },
          { status: 413 }
        ));
      }

      let extracted: { text: string; numpages: number };
      try {
        extracted = await extractTextFromPdfBuffer(buffer);
      } catch (e) {
        console.error("[api/analyze pdf-parse]", e);
        return withCors(NextResponse.json(
          {
            error:
              "Kunne ikke lese PDF-filen. Filen kan være skadet, passordbeskyttet eller bare bilder uten tekstlag.",
          },
          { status: 422 }
        ));
      }

      const rawText = extracted.text;
      if (!rawText || rawText.length < 3) {
        return withCors(NextResponse.json(
          {
            error:
              "Fant ingen lesbar tekst i PDF-en. Prøv «Tekst»-fanen, eller et dokument med tekst (ikke skannet bilde uten OCR).",
          },
          { status: 422 }
        ));
      }

      const safeName = sanitizeFileName(
        typeof fileName === "string" ? fileName : "",
        "dokument.pdf"
      );

      const preamble = `Dette er tekst uttrekk fra PDF-filen «${safeName}» (${extracted.numpages || "?"} sider). Tolke og strukturer innholdet som beskrevet.\n\n`;

      return withCors(await analyzeFromExtractedText(
        rawText,
        preamble,
        {
          type: "pdf",
          fileName: safeName,
          pageCount: Math.max(1, extracted.numpages),
        },
        portalMode,
        debug,
        documentKind,
      ));
    }

    if (docx && typeof docx === "string") {
      if (docx.length > 18_000_000) {
        return withCors(NextResponse.json(
          { error: "Word-filen er for stor. Maks ca. 12 MB." },
          { status: 413 }
        ));
      }
      let buffer: Buffer;
      try {
        buffer = docxDataUrlToBuffer(docx);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.startsWith("DOC_LEGACY:")) {
          return withCors(NextResponse.json(
            { error: msg.replace("DOC_LEGACY: ", "") },
            { status: 400 }
          ));
        }
        return withCors(NextResponse.json(
          { error: "Ugyldig Word-data. Last opp en .docx-fil." },
          { status: 400 }
        ));
      }
      if (buffer.length > MAX_DOCX_BYTES) {
        return withCors(NextResponse.json(
          { error: "Word-filen er for stor. Maks 12 MB." },
          { status: 413 }
        ));
      }

      let rawText: string;
      try {
        rawText = await extractTextFromDocxBuffer(buffer);
      } catch (e) {
        console.error("[api/analyze mammoth]", e);
        return withCors(NextResponse.json(
          {
            error:
              "Kunne ikke lese Word-filen. Filen kan være skadet eller ikke være i .docx-format.",
          },
          { status: 422 }
        ));
      }

      if (!rawText || rawText.length < 3) {
        return withCors(NextResponse.json(
          {
            error:
              "Fant ingen lesbar tekst i dokumentet. Sjekk at filen er .docx med faktisk innhold.",
          },
          { status: 422 }
        ));
      }

      const safeName = sanitizeFileName(
        typeof fileName === "string" ? fileName : "",
        "dokument.docx"
      );

      const preamble = `Dette er tekst uttrekk fra Word-filen «${safeName}» (.docx). Tolke og strukturer innholdet som beskrevet (ukeplan, datoer, kontakt osv. når det finnes).\n\n`;

      return withCors(await analyzeFromExtractedText(
        rawText,
        preamble,
        {
          type: "docx",
          fileName: safeName,
        },
        portalMode,
        debug,
        documentKind,
      ));
    }

    if (image && typeof image === "string") {
      if (!image.startsWith("data:image/")) {
        return withCors(NextResponse.json(
          { error: "Ugyldig bildeformat. Last opp en gyldig bildefil." },
          { status: 400 }
        ));
      }
      if (image.length > 11_000_000) {
        return withCors(NextResponse.json(
          { error: "Bildet er for stort. Maks filstørrelse er 8 MB." },
          { status: 413 }
        ));
      }
      const routing = await analyzeImageWithRouting(image, {
        documentKind: documentKind ?? undefined,
        sourceRoute: "image",
      });
      const result: AIAnalysisResult = {
        ...routing.result,
        analysisModelTrace: routing.modelTrace,
      };
      return withCors(
        wrapResponse(result, portalMode, "image", documentKind, undefined, debug),
      );
    }

    return withCors(NextResponse.json(
      { error: "Mangler bilde, PDF, Word eller tekst i request body." },
      { status: 400 }
    ));
  } catch (err) {
    console.error("[api/analyze]", err);
    return withCors(NextResponse.json(
      { error: "Noe gikk galt under analysen. Prøv igjen." },
      { status: 500 }
    ));
  }
}

export async function OPTIONS(request: NextRequest) {
  return applyCorsHeaders(request, new NextResponse(null, { status: 204 }));
}
