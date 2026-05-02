import JSZip from "jszip";

export type DocxEmbeddedImage = {
  dataUrl: string;
  label: string;
  byteLength: number;
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/**
 * Trekker ut innsatte bilder fra word/media i en .docx (ZIP).
 * Store bilder først; filtrerer bort veldig små (ikoner/dekor).
 */
export async function extractImagesFromDocxBuffer(
  buffer: Buffer,
  options?: { minBytes?: number; maxImages?: number },
): Promise<DocxEmbeddedImage[]> {
  const minBytes = options?.minBytes ?? 3_500;
  const maxImages = options?.maxImages ?? 12;

  const zip = await JSZip.loadAsync(buffer);
  const mediaFolder = zip.folder("word/media");
  if (!mediaFolder) return [];

  const out: DocxEmbeddedImage[] = [];

  for (const [relPath, entry] of Object.entries(mediaFolder.files)) {
    if (entry.dir) continue;
    if (!IMAGE_EXT.test(relPath)) continue;
    const raw = await entry.async("nodebuffer");
    if (raw.length < minBytes) continue;

    const lower = relPath.toLowerCase();
    let mime = "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mime = "image/jpeg";
    else if (lower.endsWith(".gif")) mime = "image/gif";
    else if (lower.endsWith(".webp")) mime = "image/webp";

    const dataUrl = `data:${mime};base64,${raw.toString("base64")}`;
    const base = relPath.split("/").pop() ?? relPath;
    out.push({
      dataUrl,
      label: `Word-bilde: ${base}`,
      byteLength: raw.length,
    });
  }

  out.sort((a, b) => b.byteLength - a.byteLength);
  return out.slice(0, maxImages);
}

/** OLE/activeX eller innebygde binærfiler (ikke full støtte i runde 1). */
export async function detectDocxEmbeddedPackageFiles(buffer: Buffer): Promise<boolean> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).some(
    (p) =>
      /^word\/embeddings\//i.test(p) ||
      /^word\/activeX\//i.test(p) ||
      /\.(bin|xlsx?|pptx?)$/i.test(p),
  );
}
