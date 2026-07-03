/**
 * Event-tid fra barnets klasse-linje — TRYGG BRO til #1+#3 (oppgave 9, fag↔time-matching).
 *
 * Når et dokument har per-klasse-differensierte tider («Bokinnlevering: 2STA 13.10-13.40,
 * 2STC 10.30-11.00, …») og barnets classCode er kjent, skal event-tiden være BARNETS tid —
 * ikke en vilkårlig klasses (i dag: første klokke-range i teksten). Dette steget matcher
 * SELV barnets kode blant linjene (lener seg ikke på noe filter) og parser tiden ut.
 *
 * Bevisst ENKEL parser (vanlige formater; alt annet → null → dagens oppførsel beholdes):
 * dette er en bro, ikke den strukturerte tids-løsningen — #1+#3 tar den jobben senere.
 * Kontrakt: null betyr alltid «ingen overstyring» — aldri gjett, aldri tøm.
 */
import { extractClassCodes, normalizeClassCode } from "@/lib/school-class-schedule";

/** Grov «linjen har et klokkeslett»-sjekk (gate før dyrere parsing). */
const HAS_CLOCK_RE = /\d{1,2}[.:]\d{2}/;

/**
 * Vanlige formater: «10:30-11:00», «10.30-11.00», «10:30–11:00» (-, – eller —, evt. « til »),
 * valgfritt «kl»-prefiks, valgfri slutt-tid. Første treff i linjen brukes.
 */
const TIME_RANGE_RE =
  /(?:\bkl\.?\s*)?(\d{1,2})[.:](\d{2})(?:\s*(?:[-–—]|\btil\b)\s*(?:kl\.?\s*)?(\d{1,2})[.:](\d{2}))?/i;

function toClock(h: string, mm: string): string | null {
  const hn = Number(h);
  const mn = Number(mm);
  if (!Number.isInteger(hn) || !Number.isInteger(mn) || hn > 23 || mn > 59) return null;
  return `${String(hn).padStart(2, "0")}:${mm}`;
}

function clockToMinutes(clock: string): number {
  const [h, m] = clock.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Trekk start/(slutt) ut av en per-klasse-linje. Ukjent/ugyldig format (timer > 23,
 * slutt ≤ start, ingen klokke) → null — kalleren degraderer til dagens event-tid.
 */
export function parseTimeRangeFromLine(line: string): { start: string; end?: string } | null {
  const m = TIME_RANGE_RE.exec(line);
  if (!m) return null;
  const start = toClock(m[1]!, m[2]!);
  if (!start) return null;
  if (m[3] && m[4]) {
    const end = toClock(m[3], m[4]);
    if (!end) return null;
    if (clockToMinutes(end) <= clockToMinutes(start)) return null; // omvendt/tomt spenn → uklart
    return { start, end };
  }
  return { start };
}

/**
 * Finn barnets tids-fragment blant linjene. Linjer splittes på `;`/`,` slik at både rene
 * per-klasse-linjer (én per linje), tekst-stiens syntetiserte komposittlinje
 * («Frister: … 2STA …; … 2STC …») og rå inline-lister («…, 2STC 10.30-11.00, …») gir
 * fragmentet som hører til BARNETS kode. Første fragment med barnets kode OG et klokkeslett
 * vinner (tidsløse omtaler som «Til 2STC-elevane» blokkerer ikke). Ingen treff → null.
 */
export function findChildClassTimeLine(lines: string[], childClassCode: string): string | null {
  const child = normalizeClassCode(childClassCode);
  if (!child) return null;
  for (const line of lines) {
    for (const fragRaw of line.split(/[;,]/)) {
      const frag = fragRaw.trim();
      if (!frag || !HAS_CLOCK_RE.test(frag)) continue;
      if (extractClassCodes(frag).some((c) => normalizeClassCode(c) === child)) return frag;
    }
  }
  return null;
}

/**
 * Utløser-garde: kilden må vise PER-KLASSE-differensiering — minst to ULIKE klassekoder
 * som hver står i et fragment med klokkeslett. Hindrer at en enkelt barnetagget del-tid
 * kaprer eventet («Foreldremøte 18:00-19:30 … 2STC framfører 18.45» → én kode → false).
 */
export function hasPerClassTimeDifferentiation(
  parts: Array<string | null | undefined>,
): boolean {
  const codesWithTime = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const line of part.split(/\r?\n/)) {
      for (const fragRaw of line.split(/[;,]/)) {
        const frag = fragRaw.trim();
        if (!frag || !HAS_CLOCK_RE.test(frag)) continue;
        for (const c of extractClassCodes(frag)) codesWithTime.add(normalizeClassCode(c));
        if (codesWithTime.size >= 2) return true;
      }
    }
  }
  return false;
}

/**
 * Orkestrering for route-gluen: returnerer et ferdig `timeField`-substitutt
 * («HH:MM-HH:MM») når ALLE vilkår holder, ellers null (→ dagens oppførsel, uendret):
 *  - barnets classCode kjent,
 *  - per-klasse-differensierte tider i kilden (rå tekst + linjer),
 *  - barnets fragment funnet blant linjene,
 *  - KOMPLETT range parset. Kun-start overstyrer IKKE: tids-maskineriet fyller manglende
 *    slutt fra første dash-par i kontekst-blobben (event-time-resolve L399-406) — det ville
 *    limt en annen klasses sluttid på barnets start. Komplett-range-kravet fjerner fellen.
 */
export function resolveChildClassEventTimeField(
  childClassCode: string | null | undefined,
  lines: string[],
  rawText: string | null | undefined,
): string | null {
  if (!childClassCode?.trim()) return null;
  if (!hasPerClassTimeDifferentiation([rawText, ...lines])) return null;
  const frag = findChildClassTimeLine(lines, childClassCode);
  if (!frag) return null;
  const parsed = parseTimeRangeFromLine(frag);
  if (!parsed?.end) return null;
  return `${parsed.start}-${parsed.end}`;
}
