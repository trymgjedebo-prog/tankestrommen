/**
 * Delt, deterministisk hash-helper for stabile ID-er / stable keys.
 *
 * djb2 (Dan Bernstein) med 32-bits unsigned utdata som 8-sifret hex. Flyttet
 * byte-for-byte semantisk uendret fra `src/app/api/analyze/route.ts` slik at ett kanonisk
 * sted eier algoritmen (route.ts skal ikke eksportere hjelpere). Helperen hasher KUN
 * strengen den mottar — ingen trimming, normalisering eller sortering. Kallere er ansvarlige
 * for å bygge input-strengen (semantiske felt) før den sendes inn.
 */
export function djb2Hex(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i)!;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
