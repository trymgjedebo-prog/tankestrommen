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

function tryParseNorwegianDate(raw: string | null): string | null {
  if (!raw) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (isoMatch) return raw.trim();

  const nbMatch = /(\d{1,2})\.\s*([a-zæøå]+)\s+(\d{4})/i.exec(raw);
  if (nbMatch) {
    const day = Number(nbMatch[1]);
    const month = NB_MONTHS[nbMatch[2].toLowerCase()];
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

function buildEventItems(
  result: AIAnalysisResult,
  sourceType: string,
): Array<{
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
}> {
  const items: Array<{
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
  }> = [];

  const sourceId = randomUUID();
  const usedKeys = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);

  const buildItem = (
    date: string,
    time: string | null,
    titleSuffix: string | null,
    notes: string | null,
  ) => {
    const { start, end } = extractStartEnd(time);
    const item: (typeof items)[number] = {
      proposalId: randomUUID(),
      kind: "event",
      sourceId,
      originalSourceType: sourceType,
      confidence: result.confidence,
      event: {
        date,
        personId: "pending",
        title: titleSuffix ? `${result.title} – ${titleSuffix}` : result.title,
        start,
        end,
      },
    };
    const n = notes ?? result.description;
    if (n) item.event.notes = n;
    if (result.location) item.event.location = result.location;
    return item;
  };

  if (result.scheduleByDay.length > 0) {
    for (const day of result.scheduleByDay) {
      const isoDate = tryParseNorwegianDate(day.date);
      const key = `${isoDate ?? today}|${day.time ?? ""}|${day.dayLabel ?? ""}`;
      if (usedKeys.has(key)) continue;
      const notes = composeDayNotes(day, result.description);
      if (!isoDate) {
        const extra = [
          notes,
          day.date ? `Original dato: ${day.date}` : null,
          day.dayLabel ? `Dag: ${day.dayLabel}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        items.push(
          buildItem(today, day.time, day.dayLabel, extra || result.description)
        );
      } else {
        items.push(buildItem(isoDate, day.time, day.dayLabel, notes));
      }
      usedKeys.add(key);
    }
  }

  if (result.schedule.length > 0) {
    for (const slot of result.schedule) {
      const isoDate = tryParseNorwegianDate(slot.date);
      const key = `${isoDate ?? today}|${slot.time ?? ""}|${slot.label ?? ""}`;
      if (usedKeys.has(key)) continue;
      if (!isoDate) {
        const notes = [
          result.description,
          slot.date ? `Original dato: ${slot.date}` : null,
          slot.label ? `Etikett: ${slot.label}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        items.push(buildItem(today, slot.time, slot.label, notes));
      } else {
        items.push(buildItem(isoDate, slot.time, slot.label, null));
      }
      usedKeys.add(key);
    }
  }

  if (items.length === 0) {
    items.push(buildItem(today, null, null, null));
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
    items: buildEventItems(result, sourceType),
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
