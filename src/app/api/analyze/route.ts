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

function corsAllowAllForAnalyze(): boolean {
  const v = process.env.CORS_ALLOW_ALL_ORIGINS_ANALYZE?.trim().toLowerCase();
  return v === "1" || v === "true";
}

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

function resolveCorsForRequest(request: NextRequest): {
  origin: string | null;
  allowAll: boolean;
  allowed: boolean;
  allowOriginValue: string | null;
} {
  const origin = request.headers.get("origin");
  const allowAll = corsAllowAllForAnalyze();
  const allowed = origin !== null && (allowAll || allowedOrigins().has(origin));
  const allowOriginValue = !origin ? null : allowAll ? "*" : allowed ? origin : null;
  return { origin, allowAll, allowed, allowOriginValue };
}

function applyCorsHeaders(request: NextRequest, response: NextResponse): NextResponse {
  const policy = resolveCorsForRequest(request);
  if (policy.allowOriginValue) {
    response.headers.set("Access-Control-Allow-Origin", policy.allowOriginValue);
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
  if (/\b(ta med|ta med deg|ha med|pakke(?:liste)?)\b/i.test(raw)) return true;
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
  if (!t) return false;
  if (isPacklistOrRememberSuppliesOnly(t)) return false;
  const n = normalizeNorwegianLetters(t);
  if (
    isAssessmentOrExamPrimaryLine(t) &&
    lineHasConcreteAssessmentAnchorForStandalone(n, t)
  ) {
    return true;
  }
  if (isEventLikeText(t)) return false;
  return ACTIONABLE_TASK_RE.test(n);
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
  /\b(matematikk|naturfag|samfunnsfag|norsk|engelsk|tysk|spansk|fransk|krle|rle|kunst|musikk|kor|korps|kroppsoving|kroppsøving|matte|natur|samf|historie|geografi|biologi|fysikk|kjemi|informasjon|programmering)\b/i;

function lineHasConcreteAssessmentAnchorForStandalone(norm: string, raw: string): boolean {
  if (
    /\b(mandag|tirsdag|onsdag|torsdag|fredag|lordag|lørdag|sondag|søndag)\b/.test(norm)
  ) {
    return true;
  }
  if (/\b(i\s* dag|i\s+morgen)\b/.test(norm)) return true;
  if (/\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?/.test(raw)) return true;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(raw)) return true;
  if (PROGRAM_SUBJECT_TOKEN_RE.test(norm)) return true;
  if (/\b(tysk|spansk|fransk|engelsk|italiensk|nynorsk|bokmal|bokmål)\b/.test(norm)) {
    return true;
  }
  if (/\bnorsk\b/.test(norm)) return true;
  if (/\bnorsk\s+fordypning\b/.test(norm)) return true;
  return false;
}

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
function isLikelyOverlaySectionLeftLabel(raw: string): boolean {
  const n = normalizeNorwegianLetters(normalizeSpace(raw));
  return /^(i\s+timen|husk|lekse\w?|hoydepunkter|notater?|ta\s+med|ha\s+med|frister?|prove\w?|prover|vurdering|ressurser|ekstra\s+beskjed|aktivitet)$/.test(
    n,
  );
}

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
  let m = /^(.{2,50}?)\s*[–:—-]\s+(.+)$/.exec(t);
  if (m) {
    const leftProbe = normalizeSpace(m[1]);
    if (isLikelyOverlaySectionLeftLabel(leftProbe)) {
      m = null;
    }
  }
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

/**
 * A-plan-rader legger ofte fagnavn (f.eks. «Samfunnsfag») i highlights; det er fagrad, ikke «i timen»-innhold.
 * Skiller disse fra faktiske høydepunkter slik de ikke legges i iTimen og deretter stripes som svake linjer.
 */
function partitionHighlightsForOverlaySubjectRow(highlights: string[]): {
  subjectRowLabels: string[];
  contentHighlights: string[];
} {
  const subjectRowLabels: string[] = [];
  const contentHighlights: string[] = [];
  for (const raw of highlights) {
    const h = normalizeSpace(raw);
    if (!h) continue;
    if (isWeakSubjectTokenLine(h)) subjectRowLabels.push(h);
    else contentHighlights.push(h);
  }
  return { subjectRowLabels, contentHighlights };
}

function parsedSubjectFromWeakRowLabel(label: string): ReturnType<typeof parseProgramSchoolFields> {
  const t = cleanSubjectToken(normalizeSpace(label));
  const key = slugifySubjectKey(t);
  const single: SchoolSubjectCandidate[] =
    key ? [{ subject: t, subjectKey: key, weight: 1 }] : [];
  return {
    subject: t,
    subjectKey: key,
    customLabel: t,
    subjectCandidates: single,
  };
}

function mergeOverlaySubjectWithRowHint(
  rowHint: ReturnType<typeof parseProgramSchoolFields> | null,
  primary: ReturnType<typeof parseProgramSchoolFields>,
): ReturnType<typeof parseProgramSchoolFields> {
  if (!rowHint?.subjectKey) return primary;
  const bogusPrimarySubject =
    (primary.subject && isLikelyOverlaySectionLeftLabel(primary.subject)) ||
    (!primary.subjectKey && primary.subject && isWeakSubjectTokenLine(primary.subject));
  if (primary.subjectKey && !bogusPrimarySubject) return primary;
  return {
    subjectKey: rowHint.subjectKey,
    subject: rowHint.subject ?? primary.subject,
    customLabel: rowHint.customLabel ?? primary.customLabel,
    subjectCandidates:
      rowHint.subjectCandidates.length > 0 ? rowHint.subjectCandidates : primary.subjectCandidates,
  };
}

/** A-plan-tabellrad: fagoverskriften er autoritativ — ikke la første innholdslinje overstyre subjectKey. */
function mergeTableRowOverlaySubject(
  rowHint: ReturnType<typeof parseProgramSchoolFields>,
  primary: ReturnType<typeof parseProgramSchoolFields>,
): ReturnType<typeof parseProgramSchoolFields> {
  if (!rowHint?.subjectKey) return primary;
  return {
    subjectKey: rowHint.subjectKey,
    subject: rowHint.subject,
    customLabel: rowHint.customLabel,
    subjectCandidates:
      rowHint.subjectCandidates.length > 0 ? rowHint.subjectCandidates : primary.subjectCandidates,
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

function createPortalWeekDateResolver(result: AIAnalysisResult): (
  rawDate: string | null,
  rawLabel: string | null,
) => string | null {
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

  return (rawDate: string | null, rawLabel: string | null): string | null => {
    const direct = parseDateWithFallbackYear(rawDate, resolvedYear);
    if (direct) {
      const explicitYearMatch = rawDate ? /\b(20\d{2})\b/.exec(rawDate) : null;
      const explicitYear = explicitYearMatch ? Number(explicitYearMatch[1]) : null;
      const weekday = parseIsoWeekday(`${rawLabel ?? ""} ${rawDate ?? ""}`);
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

  const resolveDate = createPortalWeekDateResolver(result);

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
    result.extractedText?.raw ?? "",
    ...result.scheduleByDay.map((d) => `${d.dayLabel ?? ""} ${d.date ?? ""}`),
  ].join(" ");
  const weekNumber = parseWeekNumber(weekContext);
  if (weekNumber !== null) reasons.push("week_number_detected");

  const weekdayRows = result.scheduleByDay.filter((d) =>
    Boolean(schoolWeekdayIndexFromLabel(d.dayLabel)),
  ).length;
  if (weekdayRows >= 2) reasons.push("scheduleByDay_weekday_rows>=2");
  if (result.scheduleByDay.length >= 3) reasons.push("scheduleByDay_count>=3");
  const weekdayMentionsFromRaw = Array.from(
    new Set(
      (result.extractedText?.raw ?? "")
        .split(/\n+/)
        .map((line) => schoolWeekdayIndexFromLabel(line))
        .filter((x): x is "0" | "1" | "2" | "3" | "4" => Boolean(x)),
    ),
  ).length;
  if (weekdayMentionsFromRaw >= 2) reasons.push("raw_weekday_mentions>=2");

  const daySignal =
    weekdayRows >= 2 || result.scheduleByDay.length >= 3 || weekdayMentionsFromRaw >= 2;
  const activitySignal = documentKind === "activity_plan" || hasActivityTitleHint;
  const yes = activitySignal && daySignal && weekNumber !== null;
  return { yes, reasons };
}

function inferDailyActionsFromRawText(
  rawText: string,
): SchoolWeekOverlayProposal["dailyActions"] {
  const out: SchoolWeekOverlayProposal["dailyActions"] = {};
  const lines = rawText
    .split(/\n+/)
    .map((l) => normalizeSpace(l))
    .filter(Boolean)
    .slice(0, 500);
  let currentIdx: "0" | "1" | "2" | "3" | "4" | null = null;
  for (const line of lines) {
    const idx = schoolWeekdayIndexFromLabel(line);
    if (idx) {
      currentIdx = idx;
      if (!out[idx]) {
        out[idx] = {
          action: "enrich_existing_school_block",
          reason: null,
          summary: null,
          subjectUpdates: [],
        };
      }
      continue;
    }
    if (!currentIdx) continue;
    // Bind første meningsfulle linje til aktiv dag; unngå global lekkasje.
    if (!out[currentIdx]!.summary && line.length >= 4 && line.length <= 220) {
      const { text } = normalizeSummaryCandidateLine(line);
      if (!text) continue;
      const cls = classifyOverlayLine(text, { sectionSet: new Set(), forWeekly: false });
      if (cls !== "ok") continue;
      out[currentIdx]!.summary = text;
    }
  }
  return out;
}

function segmentRawTextByWeekday(
  rawText: string,
): Partial<Record<"0" | "1" | "2" | "3" | "4", string[]>> {
  const out: Partial<Record<"0" | "1" | "2" | "3" | "4", string[]>> = {};
  const lines = rawText
    .split(/\n+/)
    .map((l) => normalizeSpace(l))
    .filter(Boolean)
    .slice(0, 700);
  let currentIdx: "0" | "1" | "2" | "3" | "4" | null = null;
  for (const line of lines) {
    const idx = schoolWeekdayIndexFromLabel(line);
    if (idx) {
      currentIdx = idx;
      if (!out[idx]) out[idx] = [];
      continue;
    }
    if (!currentIdx) continue;
    // Stopp lekkasje: ikke legg en linje som tydelig peker til en annen ukedag i aktiv dag.
    const maybeOther = schoolWeekdayIndexFromLabel(line);
    if (maybeOther && maybeOther !== currentIdx) continue;
    out[currentIdx]!.push(line);
  }
  return out;
}

/**
 * Tekst for spesialdag-deteksjon: linjer som tydelig er en annen ukedag enn dagens rad,
 * utelates (mot lekkasje fra ukesoversikt / nabodager).
 */
function buildDayLocalSpecialDaySignalText(day: DayScheduleEntry): {
  norm: string;
  excludedOtherDayLines: number;
} {
  const dayIdx = schoolWeekdayIndexFromLabel(day.dayLabel);
  const chunks: string[] = [];
  let excludedOtherDayLines = 0;

  const considerLine = (line: string) => {
    const t = normalizeSpace(line);
    if (!t) return;
    if (dayIdx) {
      const lineDay = schoolWeekdayIndexFromLabel(t);
      if (lineDay != null && lineDay !== dayIdx) {
        excludedOtherDayLines += 1;
        return;
      }
    }
    chunks.push(t);
  };

  if (!dayIdx) {
    const fallback = normalizeNorwegianLetters(
      [day.details ?? "", ...day.highlights, ...day.notes, ...day.rememberItems, ...day.deadlines]
        .filter(Boolean)
        .join(" "),
    );
    return { norm: fallback, excludedOtherDayLines: 0 };
  }

  for (const part of (day.details ?? "").split(/\n+/)) considerLine(part);
  for (const h of day.highlights) considerLine(h);
  for (const n of day.notes) {
    for (const part of (n ?? "").split(/\n+/)) considerLine(part);
  }
  for (const r of day.rememberItems) considerLine(r);
  for (const d of day.deadlines) considerLine(d);

  return { norm: normalizeNorwegianLetters(chunks.join(" ")), excludedOtherDayLines };
}

/** Hele skoleblokken erstattes — krever eksplisitte heldags-/dagsprogram-signaler, ikke bare fagtime-prøve. */
function wholeDaySchoolReplacementSignals(norm: string): boolean {
  if (/\b(heldagspr[oø]ve|heldags\s*prove)\b/.test(norm)) return true;
  if (/\bforberedelsesdag\b/.test(norm)) return true;
  if (/\b(turdag|skoletur|klassetur|ekskursjon|leirskole|studietur)\b/.test(norm)) return true;
  if (/\b(aktivitetsdag|temadag|idrettsdag|opplevelsesdag)\b/.test(norm)) return true;
  if (/\btentamensdag\b/.test(norm)) return true;
  if (/\b(skriftlig|muntlig)\s+heldag\b/.test(norm)) return true;
  if (/\bheldag\w*\s+.*\btentamen\b|\btentamen\b.*\bheldag\w*\b/.test(norm)) return true;
  if (/\btentamen\b/.test(norm)) {
    if (/\b(hele\s+dagen|hele\s+skoledagen|ingen\s+vanlige\s+timer|kun\s+tentamen)\b/.test(norm)) {
      return true;
    }
    return false;
  }
  return false;
}

function overlayWeakSpecialDayHints(norm: string): boolean {
  return /\b(tentamen|heldags|heldag|forberedelsesdag|turdag|aktivitetsdag|fridag|skolefri)\b/.test(
    norm,
  );
}

function detectOverlayActionKind(day: DayScheduleEntry): {
  action: SchoolWeekOverlayDailyAction["action"];
  reason: string;
  signalsLocalToDay: boolean;
  excludedOtherDayLines: number;
  hadWeakSpecialDayHints: boolean;
} {
  const { norm, excludedOtherDayLines } = buildDayLocalSpecialDaySignalText(day);
  const signalsLocalToDay = schoolWeekdayIndexFromLabel(day.dayLabel) != null;
  const hadWeakSpecialDayHints = overlayWeakSpecialDayHints(norm);

  if (/\b(fri|fridag|skolefri|planleggingsdag|elevfri)\b/.test(norm)) {
    return {
      action: "remove_school_block",
      reason: "local_remove_free_or_planning",
      signalsLocalToDay,
      excludedOtherDayLines,
      hadWeakSpecialDayHints,
    };
  }
  if (wholeDaySchoolReplacementSignals(norm)) {
    return {
      action: "replace_school_block",
      reason: "local_whole_day_replacement_signal",
      signalsLocalToDay,
      excludedOtherDayLines,
      hadWeakSpecialDayHints,
    };
  }
  return {
    action: "enrich_existing_school_block",
    reason: excludedOtherDayLines
      ? "no_local_whole_day_signal_after_other_day_filter"
      : "no_local_whole_day_signal",
    signalsLocalToDay,
    excludedOtherDayLines,
    hadWeakSpecialDayHints,
  };
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

function sectionValues(sections: SchoolWeekOverlaySections): string[] {
  return [
    ...(sections.iTimen ?? []),
    ...(sections.lekse ?? []),
    ...(sections.husk ?? []),
    ...(sections.proveVurdering ?? []),
    ...(sections.ressurser ?? []),
    ...(sections.ekstraBeskjed ?? []),
  ];
}

function mergeSectionLists(a: string[] = [], b: string[] = []): string[] {
  return compactLines([...a, ...b], 12);
}

/** Generelle mål / kompetanse uten konkret hjemmeoppgave — ikke task. */
function looksLikeGenericPeriodGoal(text: string): boolean {
  const n = normalizeNorwegianLetters(text);
  if (/\b(lekse|oppgave|frist|innlever|les\s+side|les\s+kap|skriv|gjør\s+\d|øv\s+til)\b/i.test(text))
    return false;
  if (/\b(kompetansemal|kompetansemål|mal\s+for\s+perioden|leringsmal|grunnleggende\s+føringer)\b/.test(n))
    return true;
  if (/\b(vi\s+skal\s+lære|overordnede\s+mål)\b/.test(n)) return true;
  return false;
}

function splitSemicolonListConservative(line: string): string[] {
  const t = normalizeSpace(line);
  if (!t.includes(";")) return [t];
  const chunks = t.split(/\s*;\s+/).map(normalizeSpace).filter(Boolean);
  if (chunks.length < 2) return [t];
  if (chunks.some((c) => /^\d{1,2}[.:]\d{2}$/.test(c))) return [t];
  return chunks;
}

function stripInlineSectionLabelForLine(line: string): {
  text: string;
  hadPrefix: boolean;
  prefix?: string;
} {
  const m =
    /^(høydepunkter|hoydepunkter|husk|notater?|frister?|i\s+timen|lekse\w?|ta\s+med|ha\s+med|prøve|prove|vurdering)\s*:\s*(.*)$/i.exec(
      line.trim(),
    );
  if (!m) return { text: normalizeSpace(line), hadPrefix: false };
  const inner = normalizeSpace(m[2]);
  if (!inner) return { text: "", hadPrefix: true, prefix: m[1] };
  return { text: inner, hadPrefix: true, prefix: m[1] };
}

function normalizeLineDedupeKeyForSectionLine(line: string): string {
  const { text } = stripInlineSectionLabelForLine(line);
  return normalizeNorwegianLetters(text).replace(/\s+/g, " ").trim();
}

function dedupeLinesByNormalizedKey(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const k = normalizeLineDedupeKeyForSectionLine(line);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(normalizeSpace(line));
  }
  return out;
}

function finalizeOverlaySectionContent(
  sections: SchoolWeekOverlaySections,
  trace?: {
    semicolonSplits?: string[];
    prefixStrips?: Array<{ from: string; to: string }>;
  },
): SchoolWeekOverlaySections {
  const processList = (arr: string[] | undefined): string[] | undefined => {
    if (!arr?.length) return arr;
    const expanded: string[] = [];
    for (const line of arr) {
      const parts = splitSemicolonListConservative(line);
      if (parts.length > 1 && trace) {
        trace.semicolonSplits = trace.semicolonSplits ?? [];
        trace.semicolonSplits.push(line);
      }
      expanded.push(...parts);
    }
    const stripped: string[] = [];
    for (const line of expanded) {
      const st = stripInlineSectionLabelForLine(line);
      if (st.hadPrefix && st.prefix && trace && st.text && line !== st.text) {
        trace.prefixStrips = trace.prefixStrips ?? [];
        trace.prefixStrips.push({ from: line, to: st.text });
      }
      if (st.text) stripped.push(st.text);
    }
    const deduped = dedupeLinesByNormalizedKey(stripped);
    return deduped.length ? deduped : undefined;
  };
  const out: SchoolWeekOverlaySections = {};
  const keys: (keyof SchoolWeekOverlaySections)[] = [
    "iTimen",
    "lekse",
    "husk",
    "proveVurdering",
    "ressurser",
    "ekstraBeskjed",
  ];
  for (const k of keys) {
    const v = processList(sections[k]);
    if (v?.length) out[k] = v;
  }
  return out;
}

function sectionsFromLabeledBlob(text: string | null | undefined): SchoolWeekOverlaySections {
  if (!text || !text.trim()) return {};
  const out: SchoolWeekOverlaySections = {};
  const lines = text
    .split(/\n+|;\s*/g)
    .map((l) => normalizeSpace(l))
    .filter(Boolean)
    .slice(0, 120);
  let current: keyof SchoolWeekOverlaySections | null = null;
  const push = (k: keyof SchoolWeekOverlaySections, v: string) => {
    const arr = out[k] ?? [];
    out[k] = compactLines([...arr, v], 12);
  };
  for (const line of lines) {
    const n = normalizeNorwegianLetters(line);
    if (/^(hoydepunkter)\s*:?\s*$/i.test(n)) {
      current = "iTimen";
      continue;
    }
    if (/^(i timen)\s*:?\s*$/i.test(n)) {
      current = "iTimen";
      continue;
    }
    if (/^(lekse|lekser)\s*:?\s*$/i.test(n)) {
      current = "lekse";
      continue;
    }
    if (/^(husk|ta med|ha med)\s*:?\s*$/i.test(n)) {
      current = "husk";
      continue;
    }
    if (/^(frister?)\s*:?\s*$/i.test(n)) {
      current = "proveVurdering";
      continue;
    }
    if (/^(prove|prover|vurdering|test)\s*:?\s*$/i.test(n)) {
      current = "proveVurdering";
      continue;
    }
    if (/^(ressurser|ressurs|lenker)\s*:?\s*$/i.test(n)) {
      current = "ressurser";
      continue;
    }
    if (/^(notater|ekstra beskjed|beskjed)\s*:?\s*$/i.test(n)) {
      current = "ekstraBeskjed";
      continue;
    }
    if (current) {
      push(current, line);
    }
  }
  return out;
}

/** Flere etiketter i én streng / inline — splitter til sections (replace-/blob-dager). */
const INLINE_SECTION_LABEL_CAPTURE =
  /\b(høydepunkter|hoydepunkter|husk|notater?|frister?|ta\s+med|ha\s+med|prøve|prove|vurdering|i\s+timen|lekse\w?|ressurser|ekstra\s+beskjed)\s*:/gi;

function mapCapturedLabelToSectionKey(rawLabel: string): keyof SchoolWeekOverlaySections | null {
  const raw = rawLabel.replace(/\s+/g, " ").trim();
  const n = normalizeNorwegianLetters(raw);
  if (n === "hoydepunkter" || n === "i timen") return "iTimen";
  if (n.startsWith("lekse")) return "lekse";
  if (n === "husk" || n === "ta med" || n === "ha med") return "husk";
  if (n === "frister" || n === "frist") return "proveVurdering";
  if (n.startsWith("prove") || n === "vurdering") return "proveVurdering";
  if (n.startsWith("ressurser")) return "ressurser";
  if (n.startsWith("notater") || n.startsWith("ekstra beskjed")) return "ekstraBeskjed";
  return null;
}

function countInlineSectionLabels(text: string | null | undefined): number {
  if (!text) return 0;
  return (text.match(new RegExp(INLINE_SECTION_LABEL_CAPTURE.source, "gi")) ?? []).length;
}

function sectionsFromInlineLabeledBlob(text: string | null | undefined): SchoolWeekOverlaySections {
  if (!text || !text.trim()) return {};
  const out: SchoolWeekOverlaySections = {};
  const push = (k: keyof SchoolWeekOverlaySections, v: string) => {
    const arr = out[k] ?? [];
    out[k] = compactLines([...arr, v], 12);
  };
  const re = new RegExp(INLINE_SECTION_LABEL_CAPTURE.source, "gi");
  const matches: {
    absStart: number;
    labelEnd: number;
    key: keyof SchoolWeekOverlaySections;
  }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = mapCapturedLabelToSectionKey(m[1]);
    if (key) {
      matches.push({
        absStart: m.index,
        labelEnd: m.index + m[0].length,
        key,
      });
    }
  }
  if (matches.length === 0) return {};
  if (matches[0].absStart > 0) {
    const lead = normalizeSpace(text.slice(0, matches[0].absStart).replace(/^[;,:.\s]+/, ""));
    if (
      lead.length >= 8 &&
      sentenceLooksLikeScheduleReturnOrTiming(lead) &&
      !isLikelySectionLabelLine(lead)
    ) {
      push("ekstraBeskjed", lead);
    }
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].labelEnd;
    const end = i + 1 < matches.length ? matches[i + 1].absStart : text.length;
    const content = normalizeSpace(text.slice(start, end).replace(/^[;,:.\s]+/, ""));
    if (content) push(matches[i].key, content);
  }
  return out;
}

function isLikelySectionLabelLine(text: string): boolean {
  return /^(hoydepunkter|husk|notater|frister|ta med|ha med|i timen|lekse|lekser|ressurser|ekstra beskjed)\s*:?$/i.test(
    normalizeNorwegianLetters(text),
  );
}

/** Admin / skolerutiner som ikke hører hjemme i kort uke- eller dagsoppsummering. */
function isLikelyAdminOrRoutineText(text: string): boolean {
  const n = normalizeNorwegianLetters(text);
  return (
    /\b(fravaer|fravær|melde fravaer|melde fravær|sykemelding|sykmelding|ikke mott|ikke møtt)\b/.test(
      n,
    ) ||
    /\b(fravær|fravaer)\s+skal\s+(?:meldes|allerede)/.test(n) ||
    /\bmelde\s+(?:fravær|fravaer)\s+(?:til|p[aå])\b/.test(n) ||
    /\b(kontaktlaerer|kontaktlærer|kontaktlarer)\b/.test(n) ||
    /\b(foresatte|foreldre)\s+(skal|m[aå]|maa|b[oø]r)\b/.test(n) ||
    /\b(skolerutin|skolens\s+rutin|reglement|mobiltelefon|mobil\s+p[aå]\s+skolen)\b/.test(n) ||
    /\b(oppslagstavle|itslearning|skolearena)\b/.test(n)
  );
}

function isCompoundLabeledBlob(text: string): boolean {
  const n = normalizeNorwegianLetters(text);
  const hits = (
    n.match(
      /\b(hoydepunkter|husk|notater?|frister?|i\s+timen|lekse\w*|ressurser|ekstra\s+beskjed)\s*:/gi,
    ) ?? []
  ).length;
  if (hits >= 2) return true;
  return /\bhoydepunkter\s*:\s*.+\bhusk\s*:/i.test(text) || /\bhusk\s*:\s*.+\bnotater\s*:/i.test(text);
}

/** Én linje som bare er fagforkortelse / fagnavn (K&H, KRLE, «Spansk») uten faglig innhold. */
function isWeakSubjectTokenLine(text: string): boolean {
  let t = normalizeSpace(text).replace(/^[-*•·]\s*/, "");
  if (t.length > 64) return false;
  const norm = normalizeNorwegianLetters(t);
  if (/\b(lekse|pr[oø]ve|ta med|m[aå]l|kapittel|les\s|skriv|arbeider|tema)\b/.test(norm))
    return false;
  if (/\b(kap\.|side\s+\d|s\.\s*\d)/i.test(t)) return false;
  if (/^(k\s*[&\/]\s*h|k\s+og\s+h\b|kunst\s+og\s+h)/i.test(t)) return true;
  if (
    /^(krle|rle|spansk|tysk|fransk|norsk|engelsk|matte|musikk|kunst|naturfag|samfunnsfag|historie|geografi)$/i.test(
      norm,
    )
  )
    return true;
  return false;
}

/** «K&H i timen», «KRLE i timen» uten faglig substans. */
function isWeakIntimenSubjectLine(text: string): boolean {
  const norm = normalizeNorwegianLetters(normalizeSpace(text));
  if (!/\bi\s+timen\b/.test(norm)) return false;
  const rest = norm.replace(/\bi\s+timen\b/g, " ").replace(/\s+/g, " ").trim();
  if (rest.length > 28) return false;
  if (/\b(les|skriv|oppg|kap\.?|side|m[aå]l|arbeid|gjør|gjennom|se\s+på)\b/.test(rest))
    return false;
  return true;
}

function isWeakSubjectListLine(text: string): boolean {
  if (isWeakSubjectTokenLine(text)) return true;
  const n = normalizeSpace(text);
  const norm = normalizeNorwegianLetters(n);
  if (norm.length > 160) return false;
  if (/\b(lekse|ta med|pr[oø]ve|vurdering|http|www\.|@\d)/i.test(n)) return false;
  if (/\b(i\s+timen|m[aå]l|tema|arbeider\s+med|les\s+kap|kapittel)\b/i.test(norm))
    return false;
  if (/^\s*(mandag|tirsdag|onsdag|torsdag|fredag)\s*[:\-.]/i.test(n)) return false;
  const subjRe =
    /\b(norsk|matte|matematikk|engelsk|naturfag|samfunnsfag|samfunn|kroppsoving|rle|krle|musikk|kunst|spansk|tysk|fransk|historie|geografi)\b/gi;
  const matches = norm.match(subjRe);
  if (!matches || matches.length < 2) return false;
  const stripped = norm
    .replace(subjRe, " ")
    .replace(/\b(og|eller|\/|,|&|\+|med|timer|timer?|time|fag|dag|i dag|denne uken)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length <= 10;
}

function isMultiLanguageCurriculumNoise(text: string): boolean {
  const n = normalizeNorwegianLetters(text);
  const langs = ["tysk", "spansk", "fransk"].filter((w) => n.includes(w));
  if (langs.length < 2) return false;
  return (
    /\b(mal|m[aå]l|laere|lære|kompetanse|grammatikk|tema|ordforrad|ordforr[aå]d)\b/.test(n) ||
    n.length < 220
  );
}

function unwrapSingleLeadingLabel(text: string): string | null {
  const m =
    /^(høydepunkter|hoydepunkter|husk|notater?|i\s+timen|lekse\w?|frister?)\s*:\s*(.+)$/i.exec(
      text.trim(),
    );
  if (!m) return null;
  const rest = normalizeSpace(m[2]);
  if (!rest || isCompoundLabeledBlob(text)) return null;
  return rest;
}

type OverlayNoiseClass =
  | "ok"
  | "admin_routine"
  | "compound_labeled_blob"
  | "weak_subject_list"
  | "multi_language_curriculum"
  | "section_label_only"
  | "weekday_line"
  | "duplicate_of_section"
  | "contact_or_metadata";

function isLikelyContactOrMetadataLine(text: string): boolean {
  const n = normalizeNorwegianLetters(text);
  const raw = normalizeSpace(text);
  if (/^(a-plan|aplan|aktivitetsplan|ukeplan|arbeidsplan)\b/i.test(n) && /\buke\s*\d{1,2}\b/i.test(n))
    return true;
  if (/\bkontakt\s*:/i.test(raw)) return true;
  if (/\b(tlf\.?|telefon|e-?post|epost)\b/i.test(n)) return true;
  if (/@\S+\.\S+/.test(raw)) return true;
  if (/\b(laerer|lærer|kontaktl|kontaktlaer)\b/i.test(n) && /\b(kontakt|tlf|telefon)\b/i.test(n))
    return true;
  return false;
}

const WEEK_DEVIATION_HINT_RE =
  /\b(fri\b|fridag|skolefri|heldagspr[oø]ve|heldags\s*prove|forberedelsesdag|tentamen|turdag|skoletur|klassetur|planleggingsdag|elevfri|skriftlig\s+eksamen|muntlig\s+eksamen|temadag|eksamensdag)\b/i;

function lineHasWeekDeviationSignal(text: string): boolean {
  return WEEK_DEVIATION_HINT_RE.test(normalizeNorwegianLetters(text));
}

function classifyOverlayLine(
  line: string,
  ctx: { sectionSet: Set<string>; forWeekly: boolean },
): OverlayNoiseClass {
  const n = normalizeSpace(line);
  if (!n) return "section_label_only";
  if (ctx.forWeekly && isLikelyContactOrMetadataLine(n)) return "contact_or_metadata";
  if (ctx.sectionSet.has(n)) return "duplicate_of_section";
  if (isLikelySectionLabelLine(n)) return "section_label_only";
  if (!ctx.forWeekly && schoolWeekdayIndexFromLabel(n)) return "weekday_line";
  if (ctx.forWeekly && schoolWeekdayIndexFromLabel(n)) return "weekday_line";
  if (isLikelyAdminOrRoutineText(n)) return "admin_routine";
  if (isCompoundLabeledBlob(n)) return "compound_labeled_blob";
  if (isWeakSubjectListLine(n)) return "weak_subject_list";
  if (isMultiLanguageCurriculumNoise(n)) return "multi_language_curriculum";
  return "ok";
}

function normalizeSummaryCandidateLine(raw: string): { text: string | null; steps: string[] } {
  const steps: string[] = [];
  let n = normalizeSpace(raw);
  if (!n) return { text: null, steps: ["empty"] };
  const unwrapped = unwrapSingleLeadingLabel(n);
  if (unwrapped) {
    steps.push("unwrapped_single_leading_label");
    n = unwrapped;
  }
  return { text: n, steps };
}

function collectWeekDeviationCandidates(result: AIAnalysisResult): string[] {
  const out: string[] = [];
  for (const line of (result.description || "")
    .split(/\n+/)
    .map((l) => normalizeSpace(l))
    .filter(Boolean)) {
    if (!lineHasWeekDeviationSignal(line)) continue;
    if (isLikelyContactOrMetadataLine(line)) continue;
    out.push(line);
  }
  for (const d of result.scheduleByDay) {
    const blob = normalizeSpace(
      [d.dayLabel, d.details, ...d.highlights].filter(Boolean).join(" "),
    );
    if (blob.length < 10 || !lineHasWeekDeviationSignal(blob)) continue;
    const short = blob.length > 130 ? `${blob.slice(0, 127)}…` : blob;
    if (isLikelyContactOrMetadataLine(short)) continue;
    out.push(short);
  }
  return compactLines(out, 8);
}

function pickWeeklySummaryLines(result: AIAnalysisResult): {
  lines: string[];
  trace: Array<{ candidate: string; kept: boolean; reason: string }>;
} {
  const trace: Array<{ candidate: string; kept: boolean; reason: string }> = [];
  const picked: string[] = [];

  for (const line of collectWeekDeviationCandidates(result)) {
    const { text, steps } = normalizeSummaryCandidateLine(line);
    if (!text) {
      trace.push({ candidate: line, kept: false, reason: `priority_empty:${steps.join(",")}` });
      continue;
    }
    const cls = classifyOverlayLine(text, { sectionSet: new Set(), forWeekly: true });
    const ok = cls === "ok";
    const canAdd = ok && picked.length < 2;
    trace.push({
      candidate: line,
      kept: canAdd,
      reason: ok
        ? canAdd
          ? `priority_week_event:${steps.join(",")}`
          : "priority_ok_but_weekly_cap_reached"
        : `priority_rejected:${cls}`,
    });
    if (canAdd) picked.push(text);
  }

  const candidates = (result.description || "")
    .split(/\n+/)
    .map((l) => normalizeSpace(l))
    .filter(Boolean)
    .slice(0, 12);
  for (const line of candidates) {
    if (picked.length >= 2) break;
    const { text, steps } = normalizeSummaryCandidateLine(line);
    if (!text) {
      trace.push({ candidate: line, kept: false, reason: `empty:${steps.join(",")}` });
      continue;
    }
    const cls = classifyOverlayLine(text, { sectionSet: new Set(), forWeekly: true });
    const ok = cls === "ok";
    trace.push({
      candidate: line,
      kept: ok && picked.length < 2,
      reason: ok
        ? picked.length < 2
          ? `desc_ok:${steps.join(",")}`
          : "desc_ok_but_weekly_cap_reached"
        : `desc_rejected:${cls}`,
    });
    if (ok && picked.length < 2) picked.push(text);
  }
  return { lines: compactLines(picked, 2), trace };
}

function shortenReplaceReason(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const full = normalizeSpace(raw);
  if (!full) return null;
  if (isCompoundLabeledBlob(full)) return null;
  if (isLikelyAdminOrRoutineText(full)) return null;
  let t = full;
  const firstSentence = /^(.{12,}?[.!?])(\s+|$)/.exec(t);
  if (firstSentence && firstSentence[1].length <= 200) {
    t = firstSentence[1].trim();
  } else if (t.length > 160) {
    t = `${t.slice(0, 157).trim()}…`;
  }
  return t;
}

/** Kort, lesbar årsak for replace/remove uten label-blob. */
function shortReplaceReasonFromDaySignals(day: DayScheduleEntry): string | null {
  const text = normalizeNorwegianLetters(
    [day.details ?? "", ...day.highlights, ...day.notes, ...day.rememberItems].filter(Boolean).join(" "),
  );
  if (/\b(heldagspr[oø]ve|heldags\s*prove)\b/.test(text)) return "Heldagsprøve";
  if (/\bforberedelsesdag\b/.test(text)) return "Forberedelsesdag";
  if (/\btentamen\b/.test(text)) return "Tentamen";
  if (/\b(skoletur|klassetur|turdag|ekskursjon)\b/.test(text)) return "Turdag / utflukt";
  if (/\b(idrettsdag|aktivitetsdag|temadag)\b/.test(text)) return "Aktivitetsdag";
  if (/\b(fri|fridag|skolefri|elevfri|planleggingsdag)\b/.test(text)) return "Fridag / avvikende skoledag";
  if (/\bsenere\s+start|sen\s+start\b/.test(text)) return "Senere oppstart";
  if (/\btidlig\s+slutt|tidligere\s+slutt\b/.test(text)) return "Tidligere slutt";
  return null;
}

function dayHasMultipleLanguageSubjects(day: DayScheduleEntry): boolean {
  const blob = normalizeNorwegianLetters(
    [day.details ?? "", ...day.highlights, ...day.notes].filter(Boolean).join(" "),
  );
  const langs = ["tysk", "spansk", "fransk", "engelsk"].filter((l) =>
    new RegExp(`\\b${l}\\b`).test(blob),
  );
  return langs.length >= 2;
}

/**
 * Avvik i timen / praktisk «ta med» (svøm, bad, klokkeslett, tilbakemøte) — skal ikke stripes som tom faglinje
 * eller demoteres som språkstøy når linjen er kort.
 */
function sentenceLooksLikeScheduleReturnOrTiming(line: string): boolean {
  const n = normalizeNorwegianLetters(line);
  const t = normalizeSpace(line);
  if (/\bvi\s+skal\b/.test(n)) {
    if (
      /\bvi\s+skal\s+(?:l[aæ]re|laere|jobbe\s+med|arbeide\s+med|g[aå]\s+igjennom|lese\s+kap|lese\s+side)\b/.test(
        n,
      )
    ) {
      return false;
    }
    return true;
  }
  if (/\btilbake\s+(?:til\s+)?/.test(n)) return true;
  if (/\b(m[aå]\s+gjerne\s+)?(?:være\s+)?tilbake\b/.test(n)) return true;
  if (/\b(møtes|samles|hentes)\b/.test(n)) return true;
  if (/\b\d{1,2}[.:]\d{2}\b/.test(t)) {
    if (/\b(side|kap|s\.|oppg(?:ave)?)\s+\d{1,2}[.:]\d{2}\b/i.test(t)) return false;
    return true;
  }
  if (/\b(?:spr[aå]ktime|kropps[oø]vingstime|undervisningstimen)\b/.test(n)) return true;
  return false;
}

function isLikelyInClassDeviationOrBringAvvikLine(line: string): boolean {
  const n = normalizeNorwegianLetters(line);
  const raw = normalizeSpace(line);
  if (sentenceLooksLikeScheduleReturnOrTiming(raw)) return true;
  if (
    /\b(mars-?bad|mars\s+bad|sv[oø]m(?:ming|medrakt)?|bade(t[oø]y|bus|dag)?|h[aå]ndkle|idrettssal|klatresenter)\b/.test(
      n,
    )
  ) {
    return true;
  }
  if (/\b(bade|badet|sv[oø]m)\b/.test(n) && raw.length <= 96) return true;
  if (/\b(ta\s+med|pakke(?:liste)?)\b/.test(n) && raw.length <= 140) return true;
  if (/\b(avvik|bytte\s+rom|annet\s+sted|møtes\s+(?:i|p[aå]))\b/.test(n)) return true;
  return false;
}

function splitOverlayLineSeparateScheduleTails(line: string): { kept: string[]; ekstra: string[] } {
  const raw = normalizeSpace(line);
  if (!raw) return { kept: [], ekstra: [] };
  const chunks = raw.split(/\s*(?<=[.!?])\s+/).map(normalizeSpace).filter(Boolean);
  if (chunks.length < 2) return { kept: [raw], ekstra: [] };
  const ekstra: string[] = [];
  const kept: string[] = [];
  for (const c of chunks) {
    if (sentenceLooksLikeScheduleReturnOrTiming(c)) ekstra.push(c);
    else kept.push(c);
  }
  if (ekstra.length === 0) return { kept: [raw], ekstra: [] };
  if (kept.length === 0) return { kept: [chunks[0]], ekstra: chunks.slice(1) };
  return { kept, ekstra };
}

function applyDeviationTailSplitToSections(
  sections: SchoolWeekOverlaySections,
  dayDebug?: {
    overlayDeviationSectionAssigned?: Array<{ fragment: string; section: string; from: string }>;
    overlayDeviationLineAccepted?: string[];
    overlayDeviationLineDropped?: Array<{ line: string; reason: string }>;
  },
): SchoolWeekOverlaySections {
  const out: SchoolWeekOverlaySections = { ...sections };
  const extraIn: string[] = [...(out.ekstraBeskjed ?? [])];
  const keys: (keyof SchoolWeekOverlaySections)[] = ["iTimen", "husk"];
  for (const key of keys) {
    const arr = out[key];
    if (!arr?.length) continue;
    const next: string[] = [];
    for (const line of arr) {
      const { kept, ekstra } = splitOverlayLineSeparateScheduleTails(line);
      for (const k of kept) {
        if (k) next.push(k);
      }
      for (const e of ekstra) {
        if (!e) continue;
        extraIn.push(e);
        if (dayDebug) {
          if (!dayDebug.overlayDeviationSectionAssigned) dayDebug.overlayDeviationSectionAssigned = [];
          if (!dayDebug.overlayDeviationLineAccepted) dayDebug.overlayDeviationLineAccepted = [];
          dayDebug.overlayDeviationSectionAssigned.push({
            fragment: e,
            section: "ekstraBeskjed",
            from: key,
          });
          dayDebug.overlayDeviationLineAccepted.push(e);
        }
      }
    }
    if (next.length) out[key] = compactLines(next, 12);
    else delete out[key];
  }
  if (extraIn.length) out.ekstraBeskjed = compactLines(extraIn, 24);
  else delete out.ekstraBeskjed;
  return out;
}

function filterWeakSubjectLinesFromSections(sections: SchoolWeekOverlaySections): {
  sections: SchoolWeekOverlaySections;
  stripped: number;
} {
  let stripped = 0;
  const keys: (keyof SchoolWeekOverlaySections)[] = ["iTimen", "lekse", "husk"];
  const out: SchoolWeekOverlaySections = { ...sections };
  for (const k of keys) {
    const arr = out[k];
    if (!arr?.length) continue;
    const next = arr.filter((line) => {
      const n = normalizeSpace(line);
      if (isLikelyInClassDeviationOrBringAvvikLine(n)) return true;
      if (
        isWeakSubjectTokenLine(n) ||
        isWeakSubjectListLine(n) ||
        isWeakIntimenSubjectLine(n)
      ) {
        stripped += 1;
        return false;
      }
      return true;
    });
    if (next.length) out[k] = compactLines(next, 12);
    else delete out[k];
  }
  return { sections: out, stripped };
}

function linePrimaryLanguageToken(line: string): string | null {
  const n = normalizeNorwegianLetters(line);
  if (/\btysk\b/.test(n)) return "tysk";
  if (/\bspansk\b/.test(n)) return "spansk";
  if (/\bfransk\b/.test(n)) return "fransk";
  if (/\bengelsk\b/.test(n)) return "engelsk";
  if (/\bnorsk\s+fordypning\b/.test(n)) return "norsk_fordypning";
  return null;
}

function shouldDemoteLanguageLine(
  line: string,
  opts: { active: boolean; resolvedTrack: string | null },
): boolean {
  if (!opts.active) return false;
  if (isLikelyInClassDeviationOrBringAvvikLine(line)) return false;
  const langLead =
    /^\s*[-*•]?\s*(tysk|spansk|fransk|engelsk|norsk\s+fordypning)\s*[:\-–]/i;
  const langOnlyLine =
    /^\s*[-*•]?\s*(tysk|spansk|fransk|engelsk|norsk\s+fordypning)\s*\.?\s*$/i;
  if (!langLead.test(line) && !langOnlyLine.test(line)) return false;
  if (isStandaloneTaskCandidate(line)) return false;
  const primary = linePrimaryLanguageToken(line);
  if (opts.resolvedTrack && primary === opts.resolvedTrack) return false;
  return true;
}

function languageMentionCountInLine(line: string): number {
  const n = normalizeNorwegianLetters(line);
  let c = 0;
  for (const t of ["tysk", "spansk", "fransk", "engelsk"]) {
    if (new RegExp(`\\b${t}\\b`).test(n)) c += 1;
  }
  if (/\bnorsk\s+fordypning\b/.test(n)) c += 1;
  return c;
}

/** Flere språk i én linje uten konkret hjemmeoppgave → ned i ekstra (overlay). */
function demoteMultiLanguageBlobLinesInSections(
  sections: SchoolWeekOverlaySections,
  active: boolean,
): { sections: SchoolWeekOverlaySections; demoted: number } {
  if (!active) return { sections, demoted: 0 };
  let demoted = 0;
  const keys: (keyof SchoolWeekOverlaySections)[] = ["iTimen", "lekse", "husk"];
  const out: SchoolWeekOverlaySections = { ...sections };
  const extraPool: string[] = [...(sections.ekstraBeskjed ?? [])];
  for (const key of keys) {
    const arr = out[key];
    if (!arr?.length) continue;
    const keep: string[] = [];
    for (const line of arr) {
      if (
        languageMentionCountInLine(line) >= 2 &&
        !isStandaloneTaskCandidate(line) &&
        !isLikelyInClassDeviationOrBringAvvikLine(line)
      ) {
        extraPool.push(line);
        demoted += 1;
      } else {
        keep.push(line);
      }
    }
    if (keep.length) out[key] = compactLines(keep, 12);
    else delete out[key];
  }
  if (extraPool.length) {
    out.ekstraBeskjed = compactLines(extraPool, 24);
  }
  return { sections: out, demoted };
}

function demoteLanguageTaggedLinesInSections(
  sections: SchoolWeekOverlaySections,
  opts: { active: boolean; resolvedTrack: string | null },
): { sections: SchoolWeekOverlaySections; demoted: number } {
  let demoted = 0;
  const keys: (keyof SchoolWeekOverlaySections)[] = ["iTimen", "lekse", "husk"];
  const out: SchoolWeekOverlaySections = { ...sections };
  const extraPool: string[] = [...(sections.ekstraBeskjed ?? [])];
  for (const key of keys) {
    const arr = sections[key];
    if (!arr?.length) continue;
    const keep: string[] = [];
    for (const line of arr) {
      if (shouldDemoteLanguageLine(line, opts)) {
        extraPool.push(line);
        demoted += 1;
      } else {
        keep.push(line);
      }
    }
    if (keep.length) out[key] = compactLines(keep, 12);
    else delete out[key];
  }
  if (extraPool.length) {
    out.ekstraBeskjed = compactLines(extraPool, 24);
  }
  return { sections: out, demoted };
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
  const fromLineBlob = sectionsFromLabeledBlob(day.details);
  const fromInlineBlob = sectionsFromInlineLabeledBlob(day.details);
  const fromBlob = {
    iTimen: mergeSectionLists(fromLineBlob.iTimen, fromInlineBlob.iTimen),
    lekse: mergeSectionLists(fromLineBlob.lekse, fromInlineBlob.lekse),
    husk: mergeSectionLists(fromLineBlob.husk, fromInlineBlob.husk),
    proveVurdering: mergeSectionLists(fromLineBlob.proveVurdering, fromInlineBlob.proveVurdering),
    ressurser: mergeSectionLists(fromLineBlob.ressurser, fromInlineBlob.ressurser),
    ekstraBeskjed: mergeSectionLists(fromLineBlob.ekstraBeskjed, fromInlineBlob.ekstraBeskjed),
  };
  const inlineLabels = countInlineSectionLabels(day.details);
  const omitRawDetailsInExtra =
    isCompoundLabeledBlob(day.details ?? "") ||
    inlineLabels >= 2 ||
    (inlineLabels >= 1 && normalizeSpace(day.details ?? "").length > 100);
  const detailsForExtra = omitRawDetailsInExtra ? null : day.details;

  const base: SchoolWeekOverlaySections = {
    ...(day.highlights.length > 0
      ? { iTimen: compactLines(day.highlights) }
      : {}),
    ...(lekseFromNotes.length > 0 ? { lekse: lekseFromNotes } : {}),
    ...(day.rememberItems.length > 0 ? { husk: compactLines(day.rememberItems) } : {}),
    ...(day.deadlines.length > 0 || proveFromNotes.length > 0
      ? { proveVurdering: compactLines([...day.deadlines, ...proveFromNotes]) }
      : {}),
    ...(resourceFromNotes.length > 0 ? { ressurser: resourceFromNotes } : {}),
    ...(detailsForExtra || extraFromNotes.length > 0
      ? { ekstraBeskjed: compactLines([detailsForExtra, ...extraFromNotes]) }
      : {}),
  };
  return {
    iTimen: mergeSectionLists(base.iTimen, fromBlob.iTimen),
    lekse: mergeSectionLists(base.lekse, fromBlob.lekse),
    husk: mergeSectionLists(base.husk, fromBlob.husk),
    proveVurdering: mergeSectionLists(base.proveVurdering, fromBlob.proveVurdering),
    ressurser: mergeSectionLists(base.ressurser, fromBlob.ressurser),
    ekstraBeskjed: mergeSectionLists(base.ekstraBeskjed, fromBlob.ekstraBeskjed),
  };
}

function normalizeMarkdownishTicks(line: string): string {
  return normalizeSpace(line.replace(/^\s*`+|`+\s*$/g, "").trim());
}

/**
 * Word / DOCX legger ofte flere fag i én tabellcelle eller én avsnittslinje:
 * «Samfunnsfag: … Tysk: …». Uten linjeskift ser splitDetailsIntoTableSubjectRows bare én fagrad.
 * Sett inn \n før pålitelige fagoverskrifter (samme fagnavn som typisk A-plan-rader).
 */
function expandEmbeddedSubjectHeadersInDetails(details: string | null): string | null {
  if (!details?.trim()) return details;
  let t = details.replace(/\r\n/g, "\n");
  t = t.replace(/\t+/g, "\n");
  const subj =
    "Samfunnsfag|Naturfag|Norsk|Engelsk|Tysk|Spansk|Fransk|Matematikk|Matte|KRLE|RLE|Kunst|Musikk|Kor(?:ps)?|Kroppsøving|Kroppsoving|Historie|Geografi|Biologi|Fysikk|Kjemi|Informasjon|Programmering|Natur";
  const re = new RegExp(`(\\s+)(?=(?:[-*•·]\\s*)?(?:${subj})\\s*:)`, "gi");
  t = t.replace(re, "\n");
  return t;
}

/**
 * Fagnavn-rad i A-plan-tabell:
 * - «- Samfunnsfag:» egen linje
 * - «- Tysk» uten kolon
 * - «Samfunnsfag: I timen: …» — første segment er fag, resten blir første innholdslinje
 */
function tryParseTableSubjectHeaderLine(line: string): { label: string; inlineBody: string | null } | null {
  const t = normalizeMarkdownishTicks(line);
  const trimmed = normalizeSpace(t);
  if (!trimmed) return null;

  const onlyColon = /^\s*[-*•·]?\s*(.+?)\s*:\s*$/.exec(t);
  if (onlyColon) {
    const cand = cleanSubjectToken(normalizeSpace(onlyColon[1]));
    if (cand.length < 2 || cand.length > 48) return null;
    if (isLikelyOverlaySectionLeftLabel(cand)) return null;
    if (GENERIC_SUBJECT_BUCKET_RE.test(cand)) return null;
    const norm = normalizeNorwegianLetters(cand);
    if (!PROGRAM_SUBJECT_TOKEN_RE.test(norm) && !isWeakSubjectTokenLine(cand)) return null;
    return { label: cand, inlineBody: null };
  }

  if (!trimmed.includes(":")) {
    const noBullet = trimmed.replace(/^\s*[-*•·]\s*/, "").trim();
    if (noBullet.length >= 2 && noBullet.length <= 48 && !isLikelyOverlaySectionLeftLabel(noBullet)) {
      const cand = cleanSubjectToken(noBullet);
      if (!GENERIC_SUBJECT_BUCKET_RE.test(cand)) {
        const norm = normalizeNorwegianLetters(cand);
        if (PROGRAM_SUBJECT_TOKEN_RE.test(norm) || isWeakSubjectTokenLine(cand)) {
          return { label: cand, inlineBody: null };
        }
      }
    }
  }

  const withBody = /^\s*[-*•·]?\s*(.{2,48}?)\s*:\s+(.+)$/.exec(t);
  if (withBody) {
    const left = cleanSubjectToken(normalizeSpace(withBody[1]));
    if (left.length < 2 || left.length > 48) return null;
    if (isLikelyOverlaySectionLeftLabel(left)) return null;
    if (GENERIC_SUBJECT_BUCKET_RE.test(normalizeNorwegianLetters(left))) return null;
    const normL = normalizeNorwegianLetters(left);
    if (!PROGRAM_SUBJECT_TOKEN_RE.test(normL) && !isWeakSubjectTokenLine(left)) return null;
    return { label: left, inlineBody: normalizeSpace(withBody[2]) };
  }

  return null;
}

/**
 * Deler én dagens details i flere fag-rader (tabell / punktliste med fagnavn som overskrift).
 * Returnerer null hvis færre enn to rader — da brukes monolittisk flyt.
 */
function splitDetailsIntoTableSubjectRows(
  details: string | null,
): Array<{ label: string; body: string }> | null {
  const expanded = expandEmbeddedSubjectHeadersInDetails(details);
  if (!expanded?.trim()) return null;
  const segments: Array<{ label: string; lines: string[] }> = [];
  let current: { label: string; lines: string[] } | null = null;

  for (const raw of expanded.split(/\n/)) {
    const t = normalizeSpace(raw);
    if (!t) continue;
    const hdr = tryParseTableSubjectHeaderLine(t);
    if (hdr) {
      if (current?.lines.length) segments.push(current);
      current = { label: hdr.label, lines: [] };
      if (hdr.inlineBody) current.lines.push(hdr.inlineBody);
      continue;
    }
    if (current) current.lines.push(t);
  }
  if (current?.lines.length) segments.push(current);
  if (segments.length < 2) return null;
  const out = segments
    .map((s) => ({ label: s.label, body: s.lines.join("\n").trim() }))
    .filter((s) => s.label && s.body.length > 0);
  return out.length >= 2 ? out : null;
}

function promoteAssessmentLinesIntimenToProve(
  sections: SchoolWeekOverlaySections,
): SchoolWeekOverlaySections {
  const it = sections.iTimen;
  if (!it?.length) return sections;
  const keep: string[] = [];
  const prove: string[] = [...(sections.proveVurdering ?? [])];
  for (const line of it) {
    const n = normalizeNorwegianLetters(line);
    const toProve =
      isAssessmentOrExamPrimaryLine(line) ||
      /\b(skriftlig|muntlig)\s+pr[oø]ve\b/.test(n) ||
      /\b(fagpr[oø]ve|tyskpr[oø]ve)\b/.test(n);
    if (toProve) prove.push(line);
    else keep.push(line);
  }
  const out: SchoolWeekOverlaySections = { ...sections };
  if (keep.length) out.iTimen = compactLines(keep, 12);
  else delete out.iTimen;
  if (prove.length) out.proveVurdering = compactLines(prove, 12);
  else delete out.proveVurdering;
  return out;
}

function filterAdminRoutineFromSections(
  sections: SchoolWeekOverlaySections,
): SchoolWeekOverlaySections {
  const keys: (keyof SchoolWeekOverlaySections)[] = [
    "iTimen",
    "lekse",
    "husk",
    "proveVurdering",
    "ekstraBeskjed",
    "ressurser",
  ];
  const out: SchoolWeekOverlaySections = { ...sections };
  for (const k of keys) {
    const arr = out[k];
    if (!arr?.length) continue;
    const next = arr.filter((line) => !isLikelyAdminOrRoutineText(line));
    if (next.length) out[k] = compactLines(next, 12);
    else delete out[k];
  }
  return out;
}

function overlayStrongSectionSignal(sections: SchoolWeekOverlaySections): boolean {
  return (
    Number(Boolean(sections.iTimen?.length)) +
      Number(Boolean(sections.lekse?.length)) +
      Number(Boolean(sections.husk?.length)) +
      Number(Boolean(sections.proveVurdering?.length)) +
      Number(Boolean(sections.ressurser?.length)) >=
    2
  );
}

function computeOverlaySectionsPipeline(
  daySlice: DayScheduleEntry,
  dayForMultiLang: DayScheduleEntry,
  dayMeta: NonNullable<OverlayNoiseFilterDebug["days"][string]> | undefined,
  languageTrack: SchoolWeekOverlayProposal["languageTrack"],
  multiTrack: boolean,
): SchoolWeekOverlaySections {
  let sectionsRaw = buildOverlaySections(daySlice);
  const finalizeTrace: { semicolonSplits?: string[]; prefixStrips?: Array<{ from: string; to: string }> } =
    {};
  sectionsRaw = finalizeOverlaySectionContent(sectionsRaw, finalizeTrace);
  if (dayMeta) {
    if (finalizeTrace.semicolonSplits?.length) {
      dayMeta.semicolonSplits = [...(dayMeta.semicolonSplits ?? []), ...finalizeTrace.semicolonSplits];
    }
    if (finalizeTrace.prefixStrips?.length) {
      dayMeta.prefixStrips = [...(dayMeta.prefixStrips ?? []), ...finalizeTrace.prefixStrips];
    }
  }

  sectionsRaw = applyDeviationTailSplitToSections(sectionsRaw, dayMeta);

  const dayMultiLang = dayHasMultipleLanguageSubjects(dayForMultiLang);
  const multiLangOverlayNoise = multiTrack || dayMultiLang;
  const { sections: afterMultiBlob, demoted: blobDemoted } = demoteMultiLanguageBlobLinesInSections(
    sectionsRaw,
    multiLangOverlayNoise,
  );
  if (dayMeta && blobDemoted) {
    dayMeta.multiLanguageBlobsDemoted = (dayMeta.multiLanguageBlobsDemoted ?? 0) + blobDemoted;
  }

  const demoteLangActive = multiTrack || dayMultiLang;
  if (dayMeta && demoteLangActive) {
    dayMeta.languageDemoteScope = multiTrack ? "week_multi_track" : "day_multi_language";
  }
  const { sections: sDemoted, demoted } = demoteLanguageTaggedLinesInSections(afterMultiBlob, {
    active: demoteLangActive,
    resolvedTrack: languageTrack.resolvedTrack,
  });
  if (dayMeta && demoted) {
    dayMeta.languageDemotedLines = (dayMeta.languageDemotedLines ?? 0) + demoted;
  }

  const { sections: sectionsFiltered, stripped } = filterWeakSubjectLinesFromSections(sDemoted);
  if (dayMeta && stripped) {
    dayMeta.weakSubjectLinesStripped = (dayMeta.weakSubjectLinesStripped ?? 0) + stripped;
  }

  return filterAdminRoutineFromSections(promoteAssessmentLinesIntimenToProve(sectionsFiltered));
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

type OverlayNoiseFilterDebug = {
  weeklySummaryTrace: Array<{ candidate: string; kept: boolean; reason: string }>;
  days: Partial<
    Record<
      string,
      {
        summaryTrace: Array<{ candidate: string; kept: boolean; reason: string }>;
        languageDemotedLines?: number;
        languageDemoteScope?: "week_multi_track" | "day_multi_language";
        replaceReasonShortened?: boolean;
        replaceReasonDropped?: boolean;
        weakSubjectLinesStripped?: number;
        inlineSectionLabelsDetected?: number;
        replacePreferredStructuredBlob?: boolean;
        semicolonSplits?: string[];
        prefixStrips?: Array<{ from: string; to: string }>;
        multiLanguageBlobsDemoted?: number;
        overlayDeviationLineAccepted?: string[];
        overlayDeviationLineDropped?: Array<{ line: string; reason: string }>;
        overlayDeviationDropped?: Array<{ line: string; reason: string }>;
        overlayDeviationAnchoredToSubject?: {
          subjectKey: string | null;
          customLabel: string | null;
          source: "highlight_subject_row";
          rowsUsed: string[];
        };
        overlayDeviationSectionAssigned?: Array<{
          fragment: string;
          section: string;
          from: string;
        }>;
        overlayDaySpecialDayAccepted?: boolean;
        overlayDaySpecialDayRejected?: boolean;
        overlayDaySpecialDayReason?: string;
        overlayDaySignalsLocalToDay?: boolean;
        overlayDayExcludedOtherDayLines?: number;
        overlaySubjectUpdateMissingKeyRecovered?: number;
        overlaySubjectUpdateFallbackKeyUsed?: number;
      }
    >
  >;
};

type OverlayHomeworkTasksDebug = {
  accepted: Array<{
    dayIndex: string;
    title: string;
    reason: string;
    assessmentTaskAccepted?: boolean;
    assessmentTaskReason?: string;
  }>;
  rejected: Array<{
    dayIndex: string;
    line: string;
    reason: string;
    assessmentTaskRejected?: boolean;
    assessmentTaskReason?: string;
  }>;
};

function pickDayOverlaySummary(
  day: DayScheduleEntry,
  sectionSet: Set<string>,
  trace: Array<{ candidate: string; kept: boolean; reason: string }>,
): string | null {
  const candidates = compactLines([day.details, ...day.highlights], 6);
  for (const line of candidates) {
    const { text, steps } = normalizeSummaryCandidateLine(line);
    if (!text) {
      trace.push({ candidate: line, kept: false, reason: `empty:${steps.join(",")}` });
      continue;
    }
    const cls = classifyOverlayLine(text, { sectionSet, forWeekly: false });
    if (cls !== "ok") {
      trace.push({ candidate: line, kept: false, reason: cls });
      continue;
    }
    trace.push({ candidate: line, kept: true, reason: `ok:${steps.join(",")}` });
    return text;
  }
  return null;
}

const OVERLAY_SUBJECT_KEY_FALLBACK = "other";

function bumpDayMetaCount(
  dayMeta: NonNullable<OverlayNoiseFilterDebug["days"][string]>,
  key: "overlaySubjectUpdateMissingKeyRecovered" | "overlaySubjectUpdateFallbackKeyUsed",
) {
  dayMeta[key] = (dayMeta[key] ?? 0) + 1;
}

/**
 * Foreldre-App validerer at hver subjectUpdate har ikke-tom subjectKey.
 */
function resolveValidOverlaySubjectKey(
  parsed: ReturnType<typeof parseProgramSchoolFields>,
  dayMeta: NonNullable<OverlayNoiseFilterDebug["days"][string]>,
): string {
  const direct = parsed.subjectKey?.trim();
  if (direct) return direct;

  const trySlug = (raw: string | null | undefined): string | null => {
    const s = normalizeSpace(raw ?? "");
    if (s.length < 2) return null;
    return slugifySubjectKey(s);
  };

  const fromSubject = trySlug(parsed.subject);
  if (fromSubject) {
    bumpDayMetaCount(dayMeta, "overlaySubjectUpdateMissingKeyRecovered");
    return fromSubject;
  }

  if (parsed.customLabel?.trim()) {
    const lbl = parsed.customLabel.trim();
    const head = lbl.split(/\s*[–—:]\s+/)[0]?.trim() ?? lbl;
    const fromHead = trySlug(head);
    if (fromHead) {
      bumpDayMetaCount(dayMeta, "overlaySubjectUpdateMissingKeyRecovered");
      return fromHead;
    }
    const fromFull = trySlug(lbl);
    if (fromFull) {
      bumpDayMetaCount(dayMeta, "overlaySubjectUpdateMissingKeyRecovered");
      return fromFull;
    }
  }

  bumpDayMetaCount(dayMeta, "overlaySubjectUpdateFallbackKeyUsed");
  return OVERLAY_SUBJECT_KEY_FALLBACK;
}

function buildSchoolWeekOverlayProposal(
  result: AIAnalysisResult,
  sourceType: string,
): { proposal: SchoolWeekOverlayProposal | undefined; noiseDebug: OverlayNoiseFilterDebug } {
  const noiseDebug: OverlayNoiseFilterDebug = { weeklySummaryTrace: [], days: {} };
  const languageTrack = resolveLanguageTrack(result);
  const multiTrack = languageTrack.reason === "multiple_tracks_detected";

  const dailyActions: SchoolWeekOverlayProposal["dailyActions"] = {};
  for (const day of result.scheduleByDay) {
    const idx = schoolWeekdayIndexFromLabel(day.dayLabel);
    if (!idx) continue;
    const dayMeta: NonNullable<OverlayNoiseFilterDebug["days"][string]> = {
      summaryTrace: [],
    };
    noiseDebug.days[idx] = dayMeta;

    const inlineLabels = countInlineSectionLabels(day.details);
    dayMeta.inlineSectionLabelsDetected = inlineLabels;

    const tableRows = splitDetailsIntoTableSubjectRows(day.details);
    let subjectUpdates: SchoolWeekOverlaySubjectUpdate[] = [];
    let strongSections = false;

    if (tableRows && tableRows.length >= 2) {
      for (let ri = 0; ri < tableRows.length; ri++) {
        const row = tableRows[ri];
        const segmentDay: DayScheduleEntry = {
          ...day,
          details: row.body,
          highlights: [],
          notes: [],
          rememberItems: [],
          deadlines: [],
        };
        const rowHintParsed = parsedSubjectFromWeakRowLabel(row.label);
        const firstBodyLine =
          row.body
            .split(/\n+/)
            .map(normalizeSpace)
            .find((l) => l && !isLikelyAdminOrRoutineText(l)) ?? null;
        const primaryParsed = parseProgramSchoolFields(firstBodyLine);
        const parsed = mergeTableRowOverlaySubject(rowHintParsed, primaryParsed);

        const pipelineMeta = ri === 0 ? dayMeta : undefined;
        const sections = computeOverlaySectionsPipeline(
          segmentDay,
          day,
          pipelineMeta,
          languageTrack,
          multiTrack,
        );
        if (overlayStrongSectionSignal(sections)) strongSections = true;

        const hasSectionContent = Object.values(sections).some((v) => Array.isArray(v) && v.length > 0);
        if (hasSectionContent || parsed.subjectKey || parsed.customLabel) {
          subjectUpdates.push({
            subjectKey: resolveValidOverlaySubjectKey(parsed, dayMeta),
            customLabel: parsed.customLabel ?? row.label,
            sections,
          });
        }
      }
    } else {
      const { subjectRowLabels, contentHighlights } = partitionHighlightsForOverlaySubjectRow(
        day.highlights,
      );
      const dayForSections: DayScheduleEntry = { ...day, highlights: contentHighlights };

      const rowHintParsed =
        subjectRowLabels.length > 0 ? parsedSubjectFromWeakRowLabel(subjectRowLabels[0]) : null;
      const primaryParsed = parseProgramSchoolFields(
        day.details || contentHighlights[0] || day.notes[0] || null,
      );
      const parsed = mergeOverlaySubjectWithRowHint(rowHintParsed, primaryParsed);

      if (rowHintParsed?.subjectKey && parsed.subjectKey === rowHintParsed.subjectKey) {
        dayMeta.overlayDeviationAnchoredToSubject = {
          subjectKey: parsed.subjectKey,
          customLabel: parsed.customLabel,
          source: "highlight_subject_row",
          rowsUsed: subjectRowLabels.slice(0, 4),
        };
        dayMeta.overlayDeviationDropped = subjectRowLabels.map((line) => ({
          line,
          reason: "highlight_routed_to_subject_row_not_intimen_bullet",
        }));
      }

      const sections = computeOverlaySectionsPipeline(
        dayForSections,
        day,
        dayMeta,
        languageTrack,
        multiTrack,
      );
      strongSections = overlayStrongSectionSignal(sections);
      const hasSectionContent = Object.values(sections).some((v) => Array.isArray(v) && v.length > 0);
      if (hasSectionContent || parsed.subjectKey || parsed.customLabel) {
        subjectUpdates = [
          {
            subjectKey: resolveValidOverlaySubjectKey(parsed, dayMeta),
            customLabel: parsed.customLabel ?? null,
            sections,
          },
        ];
      }
    }

    const sectionSet = new Set<string>();
    for (const u of subjectUpdates) {
      for (const v of sectionValues(u.sections)) {
        sectionSet.add(normalizeSpace(v));
      }
    }

    const overlayDayKind = detectOverlayActionKind(day);
    const action = overlayDayKind.action;
    dayMeta.overlayDaySpecialDayReason = overlayDayKind.reason;
    dayMeta.overlayDaySignalsLocalToDay = overlayDayKind.signalsLocalToDay;
    if (overlayDayKind.excludedOtherDayLines) {
      dayMeta.overlayDayExcludedOtherDayLines = overlayDayKind.excludedOtherDayLines;
    }
    if (action === "replace_school_block" || action === "remove_school_block") {
      dayMeta.overlayDaySpecialDayAccepted = true;
    } else if (overlayDayKind.hadWeakSpecialDayHints) {
      dayMeta.overlayDaySpecialDayRejected = true;
    }

    const summaryCandidate = pickDayOverlaySummary(day, sectionSet, dayMeta.summaryTrace);
    const shortSignal =
      action === "replace_school_block" || action === "remove_school_block"
        ? shortReplaceReasonFromDaySignals(day)
        : null;
    const rawReason =
      action === "replace_school_block" || action === "remove_school_block"
        ? (shortSignal ?? (summaryCandidate || normalizeSpace(day.details ?? "") || null))
        : null;
    const reason = shortenReplaceReason(rawReason);
    if (action === "replace_school_block" || action === "remove_school_block") {
      if (rawReason && !reason) dayMeta.replaceReasonDropped = true;
      else if (rawReason && reason && reason !== rawReason) dayMeta.replaceReasonShortened = true;
      if (
        action === "replace_school_block" &&
        strongSections &&
        (inlineLabels >= 2 || isCompoundLabeledBlob(day.details ?? ""))
      ) {
        dayMeta.replacePreferredStructuredBlob = true;
      }
    }

    dailyActions[idx] = {
      action,
      reason,
      summary: strongSections ? null : summaryCandidate,
      subjectUpdates,
    };
  }
  if (Object.keys(dailyActions).length < 2) {
    const inferred = inferDailyActionsFromRawText(result.extractedText?.raw ?? "");
    for (const [k, v] of Object.entries(inferred)) {
      if (!dailyActions[k as keyof typeof dailyActions]) {
        dailyActions[k as keyof typeof dailyActions] = v;
      }
    }
  }
  if (Object.keys(dailyActions).length < 2) {
    return { proposal: undefined, noiseDebug };
  }

  const weekContext = [
    result.title,
    result.description,
    result.extractedText?.raw ?? "",
    ...result.scheduleByDay.map((d) => `${d.dayLabel ?? ""} ${d.date ?? ""}`),
  ].join(" ");
  const weekNumber = parseWeekNumber(weekContext);
  const { lines: weeklySummary, trace: weeklyTrace } = pickWeeklySummaryLines(result);
  noiseDebug.weeklySummaryTrace = weeklyTrace;

  return {
    proposal: {
      proposalId: randomUUID(),
      kind: "school_week_overlay",
      schemaVersion: "1.0.0",
      confidence: Math.max(0.45, Math.min(result.confidence, 0.8)),
      sourceTitle: result.title,
      originalSourceType: sourceType,
      weekNumber,
      classLabel: result.targetGroup,
      weeklySummary,
      languageTrack,
      profileMatch: {
        confidence: result.targetGroup ? 0.65 : 0.45,
        reason: result.targetGroup ? "target_group_present" : "target_group_missing",
      },
      dailyActions,
    },
    noiseDebug,
  };
}

type HomeworkSectionSource = "lekse" | "husk" | "proveVurdering";

type HomeworkCandidate = {
  text: string;
  section: HomeworkSectionSource;
};

function collectHomeworkCandidateLinesFromSections(
  sections: SchoolWeekOverlaySections,
): HomeworkCandidate[] {
  const out: HomeworkCandidate[] = [];
  for (const line of sections.lekse ?? []) {
    out.push({ text: line, section: "lekse" });
  }
  for (const line of sections.husk ?? []) {
    out.push({ text: line, section: "husk" });
  }
  for (const line of sections.proveVurdering ?? []) {
    out.push({ text: line, section: "proveVurdering" });
  }
  return out;
}

function isBlobOrSectionLabelForSubject(raw: string): boolean {
  const n = normalizeNorwegianLetters(raw);
  return /^(hoydepunkter|husk|notater|frister|i\s+timen|lekse|aktivitet|uke|a-plan|aplan|arbeidsplan)\b/.test(
    n,
  );
}

function inferHomeworkSubjectLabel(
  candidate: HomeworkCandidate,
  subjectLabel: string | null | undefined,
): string | null {
  const raw = normalizeSpace(subjectLabel ?? "");
  const base = raw
    .replace(/^fag\s*[:\-]\s*/i, "")
    .split(/[;|]/)[0]
    .split(/\s+[–—-]\s+/)[0]
    .trim();
  if (base && !isBlobOrSectionLabelForSubject(base)) {
    const n = normalizeNorwegianLetters(base);
    if (/\b(matte|matematikk)\b/.test(n)) return "Matematikk";
    if (/\bfransk\b/.test(n)) return "Fransk";
    if (/\bspansk\b/.test(n)) return "Spansk";
    if (/\btysk\b/.test(n)) return "Tysk";
    if (/\bnorsk\b/.test(n)) return "Norsk";
    if (/\bengelsk\b/.test(n)) return "Engelsk";
    if (/\bkrle|rle\b/.test(n)) return "KRLE";
    if (/^k\s*[&/]\s*h$/i.test(base) || /\bkunst\s+og\s+h/.test(n)) return "K&H";
    if (base.length <= 22) return base;
  }
  const t = normalizeNorwegianLetters(candidate.text);
  if (/\b(matte|matematikk)\b/.test(t)) return "Matematikk";
  if (/\bfranskpr[oø]ve\b/.test(t)) return "Fransk";
  if (/\bspanskpr[oø]ve\b/.test(t)) return "Spansk";
  if (/\btyskpr[oø]ve\b/.test(t)) return "Tysk";
  if (/\bengelskpr[oø]ve\b/.test(t)) return "Engelsk";
  if (/\bfransk\b/.test(t)) return "Fransk";
  if (/\bspansk\b/.test(t)) return "Spansk";
  if (/\btysk\b/.test(t)) return "Tysk";
  if (/\bnorsk\b/.test(t)) return "Norsk";
  if (/\bengelsk\b/.test(t)) return "Engelsk";
  return null;
}

type HomeworkTaskKind = "lekse" | "innlevering" | "hjemmeoppgave";

function inferHomeworkTaskKind(line: string, section: HomeworkSectionSource): HomeworkTaskKind {
  const n = normalizeNorwegianLetters(line);
  if (/\b(innlevering|innlever|lever\s*inn)\b/.test(n)) return "innlevering";
  if (/\blekse\b/.test(n) || section === "lekse") return "lekse";
  if (section === "proveVurdering") return "hjemmeoppgave";
  return "hjemmeoppgave";
}

function shortHomeworkTypeLabel(kind: HomeworkTaskKind): string {
  if (kind === "lekse") return "lekse";
  if (kind === "innlevering") return "innlevering";
  return "oppgave";
}

function homeworkShortActionCore(line: string): string | null {
  const raw = stripInlineSectionLabelForLine(normalizeSpace(line)).text;
  const m =
    /\b(skriv|les|gjør|gjor|øv|ov|forbered|lag|besvar)\b[^.!?]{0,40}/i.exec(raw);
  if (m) return trimSentence(normalizeSpace(m[0]), 28);
  if (/\b(side|kap|s\.\s*\d)/i.test(raw)) return trimSentence(raw, 28);
  return null;
}

function buildHomeworkTaskTitle(
  candidate: HomeworkCandidate,
  subjectLabel: string | null | undefined,
): { title: string; rule: string } {
  const assessTitle = tryBuildAssessmentTaskTitle(candidate, subjectLabel);
  if (assessTitle) return assessTitle;
  const subj = inferHomeworkSubjectLabel(candidate, subjectLabel);
  const kind = inferHomeworkTaskKind(candidate.text, candidate.section);
  if (subj && kind === "lekse" && /\b(matte|matematikk)\b/i.test(subj)) {
    return { title: "Mattelekse", rule: "matte_lekse_compact" };
  }
  if (subj && kind === "lekse") return { title: `${subj} lekse`, rule: "subject_lekse" };
  if (subj && kind === "innlevering") {
    return { title: `${subj} innlevering`, rule: "subject_innlevering" };
  }
  const core = homeworkShortActionCore(candidate.text);
  if (subj && core) return { title: `${subj} – ${core}`, rule: "subject_action_core" };
  if (subj) return { title: `${subj} ${shortHomeworkTypeLabel(kind)}`, rule: "subject_type_fallback" };
  const fallback = trimSentence(normalizeTaskTitle(candidate.text), 32);
  return { title: fallback, rule: "trimmed_raw_fallback" };
}

function resolveHumanHomeworkSourceLabel(result: AIAnalysisResult, sourceType: string): string | null {
  const hint = result.sourceHint;
  if (hint?.type === "docx" && hint.fileName?.trim()) {
    return normalizeSpace(hint.fileName.replace(/\.docx$/i, ""));
  }
  if (hint?.type === "pdf" && hint.fileName?.trim()) {
    return normalizeSpace(hint.fileName.replace(/\.pdf$/i, ""));
  }
  if (hint?.type === "image" && hint.fileName?.trim()) {
    return normalizeSpace(hint.fileName);
  }
  const title = normalizeSpace(result.title ?? "");
  if (title && !/^(docx|pdf|png|jpe?g|webp)$/i.test(title)) return title;
  return null;
}

function buildHomeworkTaskNotes(
  result: AIAnalysisResult,
  sourceType: string,
  candidate: HomeworkCandidate,
  subjectLabel: string | null | undefined,
  attachDetailLines?: string[],
): { notes: string; sourceUsed: string } {
  const lines: string[] = [];
  const src =
    resolveHumanHomeworkSourceLabel(result, sourceType) ??
    (normalizeSpace(result.title || "") || null);
  const sourceUsed = src ?? sourceType;
  if (src) lines.push(`Fra: ${src}`);
  else if (sourceType) lines.push(`Fra: ${sourceType}`);
  const subj = inferHomeworkSubjectLabel(candidate, subjectLabel);
  if (subj) lines.push(`Fag: ${subj}`);
  const raw = normalizeSpace(candidate.text);
  const stripped = stripInlineSectionLabelForLine(raw);
  const body = stripped.text || raw;
  const bodyKey = normalizeNorwegianLetters(body).replace(/\s+/g, " ").trim();
  const parts = body
    .split(/(?<=[.!?])\s+/)
    .map((x) => normalizeSpace(x))
    .filter(Boolean);
  if (parts.length > 0) lines.push(`Oppgave: ${parts[0]}`);
  if (parts.length > 1) lines.push(`Detaljer: ${parts.slice(1).join(" ")}`);
  for (const ex of attachDetailLines ?? []) {
    const rawEx = normalizeSpace(ex);
    if (!rawEx) continue;
    const exBody = stripInlineSectionLabelForLine(rawEx).text || rawEx;
    if (!exBody) continue;
    const exKey = normalizeNorwegianLetters(exBody).replace(/\s+/g, " ").trim();
    if (exKey && exKey === bodyKey) continue;
    lines.push(exBody);
  }
  return { notes: lines.join("\n"), sourceUsed };
}

function isResourceOnlyLine(line: string): boolean {
  const n = normalizeNorwegianLetters(line);
  if (/\b(aunivers|campus|kikora|teams|itslearning|lenke|ressurs)\b/.test(n)) {
    return !ACTIONABLE_TASK_RE.test(n);
  }
  return false;
}

function languageTokensInText(line: string): string[] {
  const n = normalizeNorwegianLetters(line);
  return ["tysk", "spansk", "fransk", "engelsk", "norsk fordypning"].filter((token) =>
    n.includes(token),
  );
}

function isLekseInnleveringOrConcreteHomework(line: string): boolean {
  const n = normalizeNorwegianLetters(line);
  if (/\b(lekse|innlevering|innlever|lever\s*inn|hjemmeoppgave)\b/.test(n)) return true;
  if (
    /\b(les\s+(side|kap|s\.|\d)|skriv\b|gjør\s|gjor\s|øv\s+til|forbered\s+til|fullf(o|ø)r)\b/.test(n)
  )
    return true;
  if (/\bjobb\s+med\b/.test(n) && /\b(oppgav|matte|matematikk)\b/.test(n)) return true;
  return false;
}

function isResourceDiscoveryNotHomeworkTask(line: string): boolean {
  const n = normalizeNorwegianLetters(line);
  if (!/\b(aunivers|campus|kikora)\b/.test(n)) return false;
  return /\b(finn|finnes|se\s+oppg|oppgav(?:er)?\s+på|logg\s+inn)\b/.test(n);
}

function isAssessmentOrExamPrimaryLine(line: string): boolean {
  const n = normalizeNorwegianLetters(line);
  if (/\b(lekse|innlevering|lever\s*inn)\b/.test(n)) return false;
  if (/\b(les\s+|skriv\b|gjør\s|gjor\s|oppgave\s*\d|hjemme|øv\s+til|forbered)\b/.test(n))
    return false;
  if (/\b(?:tysk|spansk|fransk|engelsk)pr[oø]ve\b/.test(n)) return true;
  return /\b(pr[oø]ve|fagpr[oø]ve|tentamen|vurdering|heldagspr[oø]ve|heldagsprove|eksamen|muntlig\s+eksamen|skriftlig\s+eksamen|kartlegging|standpunkt)\b/.test(
    n,
  );
}

function isOverlayAssessmentTaskAnchored(
  candidate: HomeworkCandidate,
  subjectLabel: string | null | undefined,
): boolean {
  if (candidate.section === "proveVurdering") return true;
  const raw = normalizeSpace(candidate.text);
  const norm = normalizeNorwegianLetters(raw);
  if (lineHasConcreteAssessmentAnchorForStandalone(norm, raw)) return true;
  return Boolean(inferHomeworkSubjectLabel(candidate, subjectLabel));
}

function tryBuildAssessmentTaskTitle(
  candidate: HomeworkCandidate,
  subjectLabel: string | null | undefined,
): { title: string; rule: string } | null {
  if (!isAssessmentOrExamPrimaryLine(candidate.text)) return null;
  const subj = inferHomeworkSubjectLabel(candidate, subjectLabel);
  if (!subj) return null;
  const n = normalizeNorwegianLetters(candidate.text);
  if (/\bheldagspr[oø]ve\b/.test(n)) {
    return { title: `${subj} heldagsprøve`, rule: "assessment_heldagsprove" };
  }
  if (/\bvurdering\b/.test(n)) {
    return { title: `${subj} vurdering`, rule: "assessment_vurdering" };
  }
  if (/\b(muntlig\s+eksamen|skriftlig\s+eksamen)\b/.test(n)) {
    return { title: `${subj} eksamen`, rule: "assessment_eksamen" };
  }
  if (/\beksamen\b/.test(n)) {
    return { title: `${subj} eksamen`, rule: "assessment_eksamen" };
  }
  if (/\bkartlegging\b/.test(n)) {
    return { title: `${subj} kartlegging`, rule: "assessment_kartlegging" };
  }
  if (/\bstandpunkt\b/.test(n)) {
    return { title: `${subj} standpunkt`, rule: "assessment_standpunkt" };
  }
  if (/\b(pr[oø]ve|fagpr[oø]ve|tentamen)\b/.test(n) || /\b(?:tysk|spansk|fransk|engelsk)pr[oø]ve\b/.test(n)) {
    return { title: `${subj} prøve`, rule: "assessment_prove" };
  }
  return { title: `${subj} prøve`, rule: "assessment_fallback" };
}

function isValidOverlayHomeworkCandidate(
  candidate: HomeworkCandidate,
  subjectLabel: string | null | undefined,
): {
  ok: boolean;
  reason: string;
} {
  const line = normalizeSpace(candidate.text);
  if (!line) return { ok: false, reason: "empty_line" };
  if (looksLikeGenericPeriodGoal(line)) return { ok: false, reason: "generic_period_goal" };
  if (isPacklistOrRememberSuppliesOnly(line)) return { ok: false, reason: "packlist_or_supplies" };
  if (isWeakSubjectTokenLine(line) || isWeakIntimenSubjectLine(line)) {
    return { ok: false, reason: "weak_subject_line" };
  }
  const assessmentPrimary = isAssessmentOrExamPrimaryLine(line);
  if (/\bi\s+timen\b/i.test(line)) {
    if (!(candidate.section === "proveVurdering" && assessmentPrimary)) {
      return { ok: false, reason: "classroom_only_line" };
    }
  }
  if (isResourceOnlyLine(line)) return { ok: false, reason: "resource_only_line" };
  if (isResourceDiscoveryNotHomeworkTask(line)) {
    return { ok: false, reason: "resource_discovery_not_task" };
  }
  const langs = languageTokensInText(line);
  if (langs.length >= 2) {
    return { ok: false, reason: "language_noise_multi_track" };
  }
  if (isAssessmentOrExamPrimaryLine(line)) {
    if (!isOverlayAssessmentTaskAnchored(candidate, subjectLabel)) {
      return { ok: false, reason: "assessment_not_anchored" };
    }
    if (!tryBuildAssessmentTaskTitle(candidate, subjectLabel)) {
      return { ok: false, reason: "assessment_missing_subject_for_title" };
    }
    if (candidate.section === "proveVurdering") {
      return { ok: true, reason: "accepted_concrete_assessment_task" };
    }
    if (candidate.section === "husk" && !isStandaloneTaskCandidate(line)) {
      return { ok: false, reason: "husk_not_actionable_homework" };
    }
    if (!isStandaloneTaskCandidate(line)) {
      return { ok: false, reason: "not_actionable_homework_pattern" };
    }
    return { ok: true, reason: "accepted_concrete_assessment_task" };
  }
  if (!isLekseInnleveringOrConcreteHomework(line)) {
    return { ok: false, reason: "not_lekse_or_innlevering_or_concrete_homework" };
  }
  if (candidate.section === "husk" && !isStandaloneTaskCandidate(line)) {
    return { ok: false, reason: "husk_not_actionable_homework" };
  }
  if (!isStandaloneTaskCandidate(line)) {
    return { ok: false, reason: "not_actionable_homework_pattern" };
  }
  return { ok: true, reason: "accepted_lekse_or_innlevering" };
}

/**
 * Lekser fra overlay-sections som egne portal-task items (additive med schoolWeekOverlayProposal).
 */
function buildHomeworkTaskItemsFromOverlay(
  result: AIAnalysisResult,
  sourceType: string,
  overlay: SchoolWeekOverlayProposal,
  resolveDate: (rawDate: string | null, rawLabel: string | null) => string | null,
  debug?: OverlayHomeworkTasksDebug,
): PortalTaskItem[] {
  const sourceId = randomUUID();
  const items: PortalTaskItem[] = [];
  const seenKeys = new Set<string>();

  const pushTask = (
    isoDate: string,
    candidate: HomeworkCandidate,
    subjectLabel: string | null | undefined,
    reason: string,
    dayIndex: string,
    validationReason?: string,
    attachDetailLines?: string[],
  ) => {
    const { title, rule } = buildHomeworkTaskTitle(candidate, subjectLabel);
    const { notes, sourceUsed } = buildHomeworkTaskNotes(
      result,
      sourceType,
      candidate,
      subjectLabel,
      attachDetailLines,
    );
    const dedupeKey = `${isoDate}|${normalizeNorwegianLetters(title).toLowerCase()}`;
    if (seenKeys.has(dedupeKey)) {
      debug?.rejected.push({
        dayIndex,
        line: candidate.text,
        reason: "duplicate_normalized_title",
      });
      return;
    }
    seenKeys.add(dedupeKey);
    debug?.accepted.push({
      dayIndex,
      title: title || "Oppgave",
      reason: `${reason};titleRule=${rule};source=${sourceUsed};langMentions=${languageMentionCountInLine(candidate.text)};notes=${notes.includes("Detaljer:") ? "with_details" : "basic"}`,
      ...(validationReason === "accepted_concrete_assessment_task"
        ? {
            assessmentTaskAccepted: true,
            assessmentTaskReason: validationReason,
          }
        : {}),
    });
    items.push({
      proposalId: randomUUID(),
      kind: "task",
      sourceId,
      originalSourceType: sourceType,
      confidence: Math.min(result.confidence, 0.85),
      task: {
        date: isoDate,
        personId: "pending",
        title: title || "Oppgave",
        notes,
      },
    });
  };

  for (const [dayIndex, action] of Object.entries(overlay.dailyActions)) {
    if (!action) continue;
    const dayEntry = result.scheduleByDay.find(
      (d) => schoolWeekdayIndexFromLabel(d.dayLabel) === dayIndex,
    );
    if (!dayEntry) {
      for (const su of action.subjectUpdates) {
        for (const c of collectHomeworkCandidateLinesFromSections(su.sections)) {
          debug?.rejected.push({ dayIndex, line: c.text, reason: "no_schedule_day_for_index" });
        }
      }
      continue;
    }
    const iso = resolveDate(dayEntry.date, dayEntry.dayLabel);
    if (!iso) {
      for (const su of action.subjectUpdates) {
        for (const c of collectHomeworkCandidateLinesFromSections(su.sections)) {
          debug?.rejected.push({ dayIndex, line: c.text, reason: "could_not_resolve_date" });
        }
      }
      continue;
    }
    for (const su of action.subjectUpdates) {
      for (const candidate of collectHomeworkCandidateLinesFromSections(su.sections)) {
        const verdict = isValidOverlayHomeworkCandidate(candidate, su.customLabel);
        if (!verdict.ok) {
          if (isAssessmentOrExamPrimaryLine(candidate.text)) {
            debug?.rejected.push({
              dayIndex,
              line: candidate.text,
              reason: verdict.reason,
              assessmentTaskRejected: true,
              assessmentTaskReason: verdict.reason,
            });
          } else {
            debug?.rejected.push({ dayIndex, line: candidate.text, reason: verdict.reason });
          }
          continue;
        }
        const attachHuskForAssessment =
          verdict.reason === "accepted_concrete_assessment_task" &&
          candidate.section === "proveVurdering"
            ? compactLines(su.sections.husk ?? [], 8)
            : undefined;
        pushTask(
          iso,
          candidate,
          su.customLabel,
          `from_section:${candidate.section}`,
          dayIndex,
          verdict.reason,
          attachHuskForAssessment,
        );
      }
    }
  }

  return items;
}

function decideSchoolWeekOverlayProposal(
  result: AIAnalysisResult,
  sourceType: string,
  documentKind: AnalysisDocumentKind | undefined,
): {
  proposal?: SchoolWeekOverlayProposal;
  decision: Record<string, unknown>;
  noiseDebug?: OverlayNoiseFilterDebug;
} {
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
  const { proposal, noiseDebug } = buildSchoolWeekOverlayProposal(result, sourceType);
  if (!proposal) {
    return {
      decision: {
        path: "event_items_fallback",
        reason: "overlay_candidate_but_insufficient_daily_actions",
        signals: looks.reasons,
      },
      noiseDebug,
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
    noiseDebug,
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
    noiseDebug: schoolWeekOverlayNoiseDebug,
  } = schoolProfileProposal
    ? {
        proposal: undefined,
        decision: {
          path: "overlay_skipped",
          reason: "school_profile_already_selected",
        },
        noiseDebug: undefined,
      }
    : decideSchoolWeekOverlayProposal(result, sourceType, documentKind);
  const resolveDate = createPortalWeekDateResolver(result);
  const overlayHomeworkDebug: OverlayHomeworkTasksDebug | undefined = includeDebug
    ? { accepted: [], rejected: [] }
    : undefined;
  const overlayHomeworkItems =
    schoolWeekOverlayProposal && !schoolProfileProposal
      ? buildHomeworkTaskItemsFromOverlay(
          result,
          sourceType,
          schoolWeekOverlayProposal,
          resolveDate,
          overlayHomeworkDebug,
        )
      : [];
  const items = schoolProfileProposal
    ? []
    : schoolWeekOverlayProposal
      ? overlayHomeworkItems
      : buildProposalItems(result, sourceType);
  const pipelineSnapshot = {
    extractedTextLength: result.extractedText?.raw?.length ?? 0,
    documentKind: documentKind ?? null,
    hasSchoolWeeklyProfile: Boolean(result.schoolWeeklyProfile),
    schoolWeekOverlayBuilt: Boolean(schoolWeekOverlayProposal),
    itemsLength: items.length,
    schoolProfileDecision: schoolProfileDecision.reason,
    schoolWeekOverlayDecision: schoolWeekOverlayDecision.reason,
  };
  console.log("[api/analyze] school-routing", {
    ...pipelineSnapshot,
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
    debugPayload.pipelineSnapshot = pipelineSnapshot;
    debugPayload.overlayRawDaySegments = segmentRawTextByWeekday(
      result.extractedText?.raw ?? "",
    );
    if (schoolWeekOverlayNoiseDebug) {
      debugPayload.overlayNoiseFilter = schoolWeekOverlayNoiseDebug;
    }
    if (schoolWeekOverlayProposal && overlayHomeworkDebug) {
      debugPayload.overlayHomeworkTasks = overlayHomeworkDebug;
    }
    if (schoolWeekOverlayProposal) {
      debugPayload.overlayDayDerivation = Object.entries(
        schoolWeekOverlayProposal.dailyActions,
      ).map(([day, action]) => ({
        day,
        action: action?.action ?? null,
        summary: action?.summary ?? null,
        reason: action?.reason ?? null,
        summarySuppressedByStrongSections:
          action?.summary === null &&
          Boolean(
            action?.subjectUpdates?.some(
              (u) =>
                (u.sections.iTimen?.length ?? 0) +
                  (u.sections.lekse?.length ?? 0) +
                  (u.sections.husk?.length ?? 0) +
                  (u.sections.proveVurdering?.length ?? 0) +
                  (u.sections.ressurser?.length ?? 0) >=
                  2,
            ),
          ),
        sectionKeys:
          action?.subjectUpdates?.flatMap((u) =>
            Object.entries(u.sections)
              .filter(([, v]) => Array.isArray(v) && v.length > 0)
              .map(([k]) => k),
          ) ?? [],
      }));
    }
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
  const corsPolicy = resolveCorsForRequest(request);
  console.log("[api/analyze] cors", {
    method: request.method,
    origin: corsPolicy.origin,
    allowed: corsPolicy.allowed,
    allowAll: corsPolicy.allowAll,
    allowOriginValue: corsPolicy.allowOriginValue,
  });
  const withCors = (res: NextResponse, path = "unspecified") => {
    const wrapped = applyCorsHeaders(request, res);
    console.log("[api/analyze] response", {
      path,
      status: wrapped.status,
      origin: corsPolicy.origin,
      corsAllowed: corsPolicy.allowed,
      allowOriginValue: corsPolicy.allowOriginValue,
    });
    return wrapped;
  };
  try {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      return withCors(NextResponse.json(
        {
          error:
            "Analyse-tjenesten er ikke konfigurert (mangler OPENAI_API_KEY).",
        },
        { status: 503 }
      ), "missing_openai_api_key");
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
        "text_success",
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
      ), "pdf_success");
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
      ), "docx_success");
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
        "image_success",
      );
    }

    return withCors(NextResponse.json(
      { error: "Mangler bilde, PDF, Word eller tekst i request body." },
      { status: 400 }
    ), "missing_input");
  } catch (err) {
    console.error("[api/analyze]", err);
    return withCors(NextResponse.json(
      { error: "Noe gikk galt under analysen. Prøv igjen." },
      { status: 500 }
    ), "catch_500");
  }
}

export async function OPTIONS(request: NextRequest) {
  const policy = resolveCorsForRequest(request);
  console.log("[api/analyze] preflight", {
    method: request.method,
    origin: policy.origin,
    allowed: policy.allowed,
    allowAll: policy.allowAll,
    allowOriginValue: policy.allowOriginValue,
  });
  return applyCorsHeaders(request, new NextResponse(null, { status: 204 }));
}
