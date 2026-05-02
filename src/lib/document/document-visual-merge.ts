import { transcribeDocumentImageForMerge } from "@/lib/ai/analyze-image";
import type {
  AnalysisDocumentKind,
  AnalysisModelRoutingInput,
} from "@/lib/ai/analysis-model-router";
import {
  detectDocxEmbeddedPackageFiles,
  extractImagesFromDocxBuffer,
} from "@/lib/docx/extract-docx-images";
import { renderPdfPagesToJpegDataUrls } from "@/lib/pdf/render-pdf-page-images";
import type { DocumentVisualExtractionDebug } from "@/lib/types";

export function isDocumentTextLayerWeak(text: string, pageCount: number): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 48) return true;
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words < 15) return true;
  const pc = Math.max(1, pageCount);
  if (t.length / pc < 40) return true;
  const alnum = (t.match(/[a-zæøåA-ZÆØÅ0-9]/g) ?? []).length;
  if (t.length > 80 && alnum / t.length < 0.11) return true;
  return false;
}

const MAX_IMAGE_CHARS = 10_500_000;

export async function buildPdfDocumentVisualMerge(
  buffer: Buffer,
  rawText: string,
  pageCount: number,
  documentKind: AnalysisDocumentKind | undefined,
): Promise<{ supplement: string; debug: DocumentVisualExtractionDebug }> {
  const textWeak = isDocumentTextLayerWeak(rawText, pageCount);
  const routing: AnalysisModelRoutingInput = {
    documentKind: documentKind ?? undefined,
    sourceRoute: "pdf",
  };

  let pageRenders: Awaited<ReturnType<typeof renderPdfPagesToJpegDataUrls>> = [];
  try {
    if (textWeak || rawText.trim().length < 3) {
      pageRenders = await renderPdfPagesToJpegDataUrls(buffer, {
        maxPages: rawText.trim().length < 3 ? 6 : 5,
        scale: 1.42,
      });
    }
  } catch (e) {
    console.warn("[document-visual-merge] pdf render failed", e);
  }

  const maxTranscribe =
    textWeak || rawText.trim().length < 3 ? Math.min(6, pageRenders.length) : 0;
  let analyzed = 0;
  const parts: string[] = [];

  for (const pr of pageRenders.slice(0, maxTranscribe)) {
    if (pr.dataUrl.length > MAX_IMAGE_CHARS) continue;
    try {
      const t = await transcribeDocumentImageForMerge(pr.dataUrl, routing);
      if (t.replace(/\s+/g, " ").trim().length >= 8) {
        parts.push(`### ${pr.label}\n${t.trim()}`);
        analyzed++;
      }
    } catch (e) {
      console.warn("[document-visual-merge] pdf page transcribe failed", e);
    }
  }

  const supplement = parts.length
    ? `\n\n---\nVISUELL PDF-DATA (sider som bilder, automatisk transkribert – bruk sammen med tekstlaget):\n${parts.join("\n\n")}`
    : "";

  const noRealText = rawText.trim().length < 3;
  const hasRealText = !noRealText;

  return {
    supplement,
    debug: {
      documentEmbeddedImagesDetected: pageRenders.length,
      documentEmbeddedImagesAnalyzed: analyzed,
      documentEmbeddedFileDetected: false,
      documentTextLayerWeak: textWeak,
      documentImageAnalysisUsedAsFallback: Boolean(analyzed > 0 && (noRealText || textWeak)),
      documentImageAnalysisUsedAsSupplement: Boolean(analyzed > 0 && hasRealText),
    },
  };
}

export async function buildDocxDocumentVisualMerge(
  buffer: Buffer,
  rawText: string,
  documentKind: AnalysisDocumentKind | undefined,
): Promise<{ supplement: string; debug: DocumentVisualExtractionDebug }> {
  const textWeak = isDocumentTextLayerWeak(rawText, 1);
  const routing: AnalysisModelRoutingInput = {
    documentKind: documentKind ?? undefined,
    sourceRoute: "docx",
  };

  let embeddedFile = false;
  try {
    embeddedFile = await detectDocxEmbeddedPackageFiles(buffer);
  } catch {
    /* ignore */
  }

  let images: Awaited<ReturnType<typeof extractImagesFromDocxBuffer>> = [];
  try {
    images = await extractImagesFromDocxBuffer(buffer, { minBytes: 3_500, maxImages: 14 });
  } catch (e) {
    console.warn("[document-visual-merge] docx images", e);
  }

  const maxTranscribe = textWeak ? 5 : 2;
  let analyzed = 0;
  const parts: string[] = [];

  for (const im of images.slice(0, maxTranscribe)) {
    if (im.dataUrl.length > MAX_IMAGE_CHARS) continue;
    try {
      const t = await transcribeDocumentImageForMerge(im.dataUrl, routing);
      if (t.replace(/\s+/g, " ").trim().length >= 8) {
        parts.push(`### ${im.label}\n${t.trim()}`);
        analyzed++;
      }
    } catch (e) {
      console.warn("[document-visual-merge] docx image transcribe failed", e);
    }
  }

  const supplement = parts.length
    ? `\n\n---\nVISUELL WORD-DATA (innsatte bilder, automatisk transkribert – bruk sammen med tekstlaget):\n${parts.join("\n\n")}`
    : "";

  return {
    supplement,
    debug: {
      documentEmbeddedImagesDetected: images.length,
      documentEmbeddedImagesAnalyzed: analyzed,
      documentEmbeddedFileDetected: embeddedFile,
      documentTextLayerWeak: textWeak,
      documentImageAnalysisUsedAsFallback: textWeak && analyzed > 0,
      documentImageAnalysisUsedAsSupplement: !textWeak && analyzed > 0,
    },
  };
}
