declare module "pdf-parse" {
  import type { Buffer } from "buffer";

  interface PdfParseResult {
    numpages: number;
    text: string;
  }

  function pdfParse(data: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
