import mammoth from "mammoth";

/**
 * Trekker ut ren tekst fra en .docx-buffer (Office Open XML).
 * Støtter ikke eldre .doc (binær Word).
 */
export async function extractTextFromDocxBuffer(
  buffer: Buffer
): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  const raw = typeof value === "string" ? value : "";
  return raw.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
