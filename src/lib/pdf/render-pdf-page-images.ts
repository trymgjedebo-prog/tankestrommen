import { createCanvas } from "canvas";

export type PdfPageRender = {
  dataUrl: string;
  label: string;
  byteLength: number;
};

/**
 * Rasteriserer de første sidene i en PDF til JPEG data-URL-er (for visuell analyse).
 * Krever Node + canvas; feiler mykt ved korrupt PDF.
 */
export async function renderPdfPagesToJpegDataUrls(
  buffer: Buffer,
  options: { maxPages: number; scale?: number; maxEdgePx?: number },
): Promise<PdfPageRender[]> {
  const maxPages = Math.max(1, Math.min(options.maxPages, 12));
  const scaleIn = options.scale ?? 1.45;
  const maxEdgePx = options.maxEdgePx ?? 1_600;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
  });

  const doc = await loadingTask.promise;
  const n = doc.numPages;
  const toRender = Math.min(n, maxPages);
  const out: PdfPageRender[] = [];

  for (let i = 1; i <= toRender; i++) {
    const page = await doc.getPage(i);
    let scale = scaleIn;
    const baseVp = page.getViewport({ scale: 1 });
    const w0 = baseVp.width;
    const h0 = baseVp.height;
    const maxDim = Math.max(w0, h0) * scale;
    if (maxDim > maxEdgePx) {
      scale = (maxEdgePx / Math.max(w0, h0)) * 0.98;
    }
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const renderContext = {
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    };
    await page.render(renderContext).promise;
    const jpegBuf = canvas.toBuffer("image/jpeg", { quality: 0.82 });
    const dataUrl = `data:image/jpeg;base64,${jpegBuf.toString("base64")}`;
    out.push({
      dataUrl,
      label: `PDF side ${i}/${n}`,
      byteLength: jpegBuf.length,
    });
  }

  return out;
}
