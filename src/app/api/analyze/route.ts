import { NextRequest, NextResponse } from "next/server";
import { analyzeImage, analyzeText } from "@/lib/ai/analyze-image";
import { extractTextFromPdfBuffer } from "@/lib/pdf/extract-pdf-text";
import { extractTextFromDocxBuffer } from "@/lib/docx/extract-docx-text";
import type { AnalysisSourceHint } from "@/lib/types";

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
  sourceHint: AnalysisSourceHint
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

  return NextResponse.json({
    ...result,
    sourceHint,
    extractedText: {
      raw: displayRaw,
      language: result.extractedText.language || "no",
      confidence: 1,
    },
  });
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

    const body = await request.json();
    const { image, text, pdf, docx, fileName } = body as {
      image?: string;
      text?: string;
      pdf?: string;
      docx?: string;
      fileName?: string;
    };

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
      return NextResponse.json(result);
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
      });
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
      });
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
      return NextResponse.json(result);
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
