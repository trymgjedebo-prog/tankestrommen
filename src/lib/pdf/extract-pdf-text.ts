import pdfParse from "pdf-parse";

export interface PdfExtractResult {
  text: string;
  numpages: number;
}

/**
 * Trekker ut ren tekst fra en PDF-buffer (alle sider).
 * Feiler ved korrupt buffer; kallende kode bør fange.
 */
export async function extractTextFromPdfBuffer(
  buffer: Buffer
): Promise<PdfExtractResult> {
  const data = await pdfParse(buffer);
  const raw = typeof data.text === "string" ? data.text : "";
  const text = raw.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return {
    text,
    numpages: typeof data.numpages === "number" ? data.numpages : 0,
  };
}
