/**
 * Heuristikk for flybilletter, boardingpass og lignende reisedokumenter:
 * semantisk departure/arrival-tid, flere etapper, kalendervennlige titler (ikke «analyse»-språk).
 */

import { parseDurationMinutes } from "./parse-duration";

export type TravelFlightStartTimeSource = "explicit" | "missing_or_unreadable";

export type TravelFlightEndTimeSource =
  | "explicit_arrival_time"
  | "computed_from_duration"
  | "missing_or_unreadable";

export type TravelFlightInference = {
  /** Avgang / departure — `null` når uleselig eller mangler. */
  departureTime: string | null;
  /** Ankomst-slutt — `null` uten eksplisitt ankomst (ingen gjetning). */
  endTime: string | null;
  arrivalTime: string | null;
  durationMinutes: number | null;
  endNextDay: boolean;
  startTimeSource: TravelFlightStartTimeSource;
  endTimeSource: TravelFlightEndTimeSource;
  inferredEndTime: boolean;
  requiresManualTimeReview: boolean;
  origin: string;
  destination: string;
  originCity: string | null;
  destCity: string | null;
  passengerName: string | null;
  flightNumber: string | null;
  proposedTitle: string;
};

const REJECT_END_CONTEXT =
  /\b(boarding|gate\s+closes?|check[\s-]?in|innsjekk|oppm[oø]te|deadline|senest\s+innen)\b/i;

const DEP_LINE =
  /\b(departure|avreise|depart(?:ure)?|dep\.|take[\s-]?off|takeoff|from)\b/i;
const ARR_LINE =
  /\b(arrival|ankomst|arriv(?:e|al)?|destination|ankomsttid)\b/i;

const FLIGHT_DOC_HINT =
  /\b(boarding\s*pass|boardingpass|bordingpass|gate\b|e-?\s*ticket|flybillett|flight\s+confirmation|reisebekreftelse\s+.*fly|airline)\b/i;

const FLIGHT_NO_RE = /\b([A-Z]{1,3}\d{1,4})\b/;

function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function normalizeHHMM(h: string, mm: string): string {
  return `${String(Number(h)).padStart(2, "0")}:${mm}`;
}

function collectHHMMInOrder(line: string): string[] {
  const out: string[] = [];
  const re = /(\d{1,2})[.:](\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out.push(normalizeHHMM(m[1]!, m[2]!));
  }
  return out;
}

function hhmmToMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

function computeEndFromDuration(
  departureTime: string | null,
  durationMinutes: number | null,
): { endTime: string | null; endNextDay: boolean } {
  if (!departureTime || !durationMinutes) return { endTime: null, endNextDay: false };
  const startMinutes = hhmmToMinutes(departureTime);
  if (startMinutes === null) return { endTime: null, endNextDay: false };
  const endTotal = startMinutes + durationMinutes;
  const endMinutes = ((endTotal % 1440) + 1440) % 1440;
  const endNextDay = endTotal >= 1440;
  const hh = Math.floor(endMinutes / 60);
  const mm = endMinutes % 60;
  return {
    endTime: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    endNextDay,
  };
}

function lineRejectsAsArrivalTime(line: string): boolean {
  return REJECT_END_CONTEXT.test(line);
}

function scoreFlightDocument(blob: string): number {
  let s = 0;
  if (FLIGHT_DOC_HINT.test(blob)) s += 4;
  if (DEP_LINE.test(blob) && ARR_LINE.test(blob)) s += 2;
  if (FLIGHT_NO_RE.test(blob)) s += 2;
  const iataHits = blob.match(/\b[A-Z]{3}\b/g) ?? [];
  if (iataHits.length >= 2) s += 1;
  return s;
}

function extractFlightNumber(blob: string): string | null {
  const m = FLIGHT_NO_RE.exec(blob);
  return m ? m[1]! : null;
}

function extractPassengerName(blob: string): string | null {
  const patterns: RegExp[] = [
    /\bpassenger\s*(?:name)?\s*[:\s]+\s*([A-ZÆØÅ][A-Za-zÆØÅæøå]+(?:\s+[A-ZÆØÅ][A-Za-zÆØÅæøå]+)+)\b/,
    /\bname\s+of\s+passenger\s*[:\s]+\s*([A-ZÆØÅ][A-Za-zÆØÅæøå]+(?:\s+[A-ZÆØÅ][A-Za-zÆØÅæøå]+)+)\b/i,
    /\bpassasjer(?:navn)?\s*[:\s]+\s*([A-ZÆØÅ][A-Za-zÆØÅæøå]+(?:\s+[A-ZÆØÅ][A-Za-zÆØÅæøå]+)+)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(blob);
    if (m) return normalizeSpace(m[1]!);
  }
  return null;
}

type AirportRow = { code: string; city: string };

/**
 * Tre-bokstavers koder som ofte feiltolkes som flyplass (måned/ukedag/kolonneoverskrifter).
 * Ekte IATA kan teoretisk kollidere (sjelden); da faller vi tilbake til «Flyreise».
 */
const PSEUDO_IATA_THREE_LETTER = new Set([
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
  "SUN",
  "DEP",
  "ARR",
  "ETD",
  "ETA",
  "STD",
  "ATD",
  "ATA",
]);

/** Måneds-/kalenderord (norsk/engelsk) som ikke skal brukes som stedsnavn i tittel. */
const CALENDAR_PLACE_STOPWORDS = new Set(
  [
    "jan",
    "januar",
    "feb",
    "februar",
    "mar",
    "mars",
    "apr",
    "april",
    "mai",
    "may",
    "jun",
    "juni",
    "june",
    "jul",
    "juli",
    "july",
    "aug",
    "august",
    "sep",
    "sept",
    "september",
    "okt",
    "oktober",
    "oct",
    "october",
    "nov",
    "november",
    "des",
    "desember",
    "dec",
    "december",
    "mandag",
    "monday",
    "tirsdag",
    "tuesday",
    "onsdag",
    "wednesday",
    "torsdag",
    "thursday",
    "fredag",
    "friday",
    "lørdag",
    "saturday",
    "søndag",
    "sunday",
    "man",
    "tir",
    "ons",
    "tor",
    "fre",
    "lør",
    "søn",
  ].map((w) => w.toLowerCase()),
);

export function isPseudoCalendarIataToken(code: string): boolean {
  const u = normalizeSpace(code).toUpperCase();
  return u.length === 3 && /^[A-Z]{3}$/.test(u) && PSEUDO_IATA_THREE_LETTER.has(u);
}

/** IATA som kan vises i kalendertittel (ikke måned/ukedag/pseudo). */
export function isUsableIataForFlightTitle(code: string): boolean {
  if (!code || code === "Ukjent") return false;
  if (!/^[A-Z]{3}$/.test(code)) return false;
  if (isPseudoCalendarIataToken(code)) return false;
  return true;
}

function placeStopwordKey(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\./g, "")
    .trim();
}

/** Renser byfelt fra typisk boardingpass-/OCR-støy før validering. */
function sanitizeAirportCityLabel(city: string): string {
  let c = normalizeSpace(city.replace(/[,;].*$/, "").trim());
  c = c.replace(/\s*[–—-]\s*Ankomst(\s+til\s+[A-Z]{3})?.*$/i, "").trim();
  c = c.replace(/\s*[–—-]\s*Avreise\b.*$/i, "").trim();
  c = c.replace(/\bAnkomst\s+til\s+[A-Z]{3}\b.*$/i, "").trim();
  c = c.replace(/\bAvreise\s+til\s+[A-Z]{3}\b.*$/i, "").trim();
  return normalizeSpace(c);
}

/** Byer som bare er tall / klokkeslett / måneder / pseudo-IATA — ikke bruk i kalendertittel. */
export function isUsableCalendarPlaceLabel(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) return false;
  const s = normalizeSpace(raw);
  if (s.length < 2) return false;
  if (/^\d+$/.test(s)) return false;
  if (/^\d{4}$/.test(s)) return false;
  if (/^\d{1,2}[.:]\d{2}$/.test(s)) return false;
  if (/^\d{1,2}\s*$/i.test(s)) return false;
  const asWord = placeStopwordKey(s);
  if (CALENDAR_PLACE_STOPWORDS.has(asWord)) return false;
  if (s.length === 3 && /^[A-Z]{3}$/.test(s) && isPseudoCalendarIataToken(s)) return false;
  return true;
}

/**
 * Kalendertittel for fly (ikke «flybillett», «avreise»-suffix eller kildespråk).
 * 1) by–by  2) IATA–IATA  3) til dest  4) Flyreise
 */
export function buildCalendarFlightTitle(
  originCity: string | null,
  destCity: string | null,
  originCode: string,
  destCode: string,
): string {
  const oc = isUsableCalendarPlaceLabel(originCity) ? normalizeSpace(originCity!) : null;
  const dc = isUsableCalendarPlaceLabel(destCity) ? normalizeSpace(destCity!) : null;
  const oIata = isUsableIataForFlightTitle(originCode) ? originCode : null;
  const dIata = isUsableIataForFlightTitle(destCode) ? destCode : null;

  if (oc && dc) {
    if (oc.toLowerCase() === dc.toLowerCase()) return "Flyreise";
    return `Flyreise ${oc}–${dc}`;
  }
  if (oIata && dIata) {
    if (oIata === dIata) return "Flyreise";
    return `Flyreise ${oIata}–${dIata}`;
  }
  if (dc) return `Flyreise til ${dc}`;
  if (dIata) return `Flyreise til ${dIata}`;
  if (oc) return `Flyreise fra ${oc}`;
  if (oIata) return `Flyreise fra ${oIata}`;
  return "Flyreise";
}

function extractAllAirportRows(blob: string): AirportRow[] {
  const rows: AirportRow[] = [];
  for (const rawLine of blob.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^(?:[-•*\u2022]\s*)?([A-Z]{3})\s+(.{2,80})$/u.exec(line);
    if (m && /^[A-Z]{3}$/.test(m[1]!) && !isPseudoCalendarIataToken(m[1]!)) {
      const city = sanitizeAirportCityLabel(m[2]!);
      if (city.length >= 2) rows.push({ code: m[1]!, city });
    }
  }
  if (rows.length >= 2) return rows;
  const codes = Array.from(blob.matchAll(/\b([A-Z]{3})\b/g))
    .map((x) => x[1]!)
    .filter((c) => !isPseudoCalendarIataToken(c));
  const uniq: string[] = [];
  for (const c of codes) {
    if (!uniq.includes(c)) uniq.push(c);
  }
  if (uniq.length >= 2) {
    return uniq.map((c) => ({ code: c, city: c }));
  }
  return rows;
}

function deriveLegsFromAirportRows(
  rows: AirportRow[],
): Array<{ from: AirportRow; to: AirportRow }> {
  if (rows.length < 2) return [];
  if (rows.length === 2) return [{ from: rows[0]!, to: rows[1]! }];
  if (rows.length === 4 && rows[1]!.code === rows[2]!.code) {
    return [
      { from: rows[0]!, to: rows[1]! },
      { from: rows[2]!, to: rows[3]! },
    ];
  }
  if (rows.length >= 3) {
    const legs: Array<{ from: AirportRow; to: AirportRow }> = [];
    for (let i = 0; i < rows.length - 1; i++) {
      legs.push({ from: rows[i]!, to: rows[i + 1]! });
    }
    return legs;
  }
  return [{ from: rows[0]!, to: rows[1]! }];
}

function globalLabeledTime(blob: string, which: "dep" | "arr"): string | null {
  const esc =
    which === "dep"
      ? "(?:departure|avreise|depart|dep\\.?|take\\s*off|from)"
      : "(?:arrival|ankomst|arrive|destination)";
  const re = new RegExp(
    `\\b${esc}\\b\\D{0,48}?(\\d{1,2})[.:](\\d{2})\\b`,
    "i",
  );
  const m = re.exec(blob);
  if (!m) return null;
  const slice = blob.slice(Math.max(0, m.index - 48), m.index + m[0].length);
  if (which === "arr" && REJECT_END_CONTEXT.test(slice)) return null;
  return normalizeHHMM(m[1]!, m[2]!);
}

function scanLinesForLabeledTimes(
  blob: string,
  blobOneLine: string,
): { dep: string | null; arr: string | null } {
  let dep: string | null = null;
  let arr: string | null = null;

  for (const rawLine of blob.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const times = collectHHMMInOrder(line);
    if (times.length === 0) continue;

    const depHit = DEP_LINE.test(line);
    const arrHit = ARR_LINE.test(line) && !lineRejectsAsArrivalTime(line);

    if (depHit && !arrHit) {
      dep = dep ?? times[0]!;
      continue;
    }
    if (arrHit && !depHit) {
      arr = arr ?? times[times.length - 1]!;
      continue;
    }
    if (depHit && arrHit && times.length >= 2) {
      dep = dep ?? times[0]!;
      arr = arr ?? times[times.length - 1]!;
    }
  }

  dep = dep ?? globalLabeledTime(blobOneLine, "dep");
  arr = arr ?? globalLabeledTime(blobOneLine, "arr");

  return { dep, arr };
}

function twoTimeHeuristic(blob: string, isFlight: boolean): {
  dep: string | null;
  arr: string | null;
} {
  if (!isFlight) return { dep: null, arr: null };
  const all = collectHHMMInOrder(blob.replace(/\r/g, "\n"));
  const uniq: string[] = [];
  for (const t of all) {
    if (!uniq.includes(t)) uniq.push(t);
  }
  if (uniq.length !== 2) return { dep: null, arr: null };
  const low = uniq[0]!;
  const high = uniq[1]!;
  if (low >= high) return { dep: null, arr: null };
  return { dep: low, arr: high };
}

/** Flere departure/arrival-par i dokumentrekkefølge (én per flyetappe). */
function extractOrderedDepArrPairs(blob: string): Array<{ dep: string; arr: string }> {
  const out: Array<{ dep: string; arr: string }> = [];
  const re =
    /departure\s*[:\s]*(\d{1,2})[.:](\d{2})[\s\S]{0,160}?arrival\s*[:\s]*(\d{1,2})[.:](\d{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) {
    out.push({
      dep: normalizeHHMM(m[1]!, m[2]!),
      arr: normalizeHHMM(m[3]!, m[4]!),
    });
  }
  return out;
}

function buildLegInference(
  leg: { from: AirportRow; to: AirportRow },
  times: { dep: string | null; arr: string | null; durationMinutes: number | null },
  shared: { passengerName: string | null; flightNumber: string | null },
): TravelFlightInference {
  const explicitArrival = times.arr;
  const computed = !explicitArrival
    ? computeEndFromDuration(times.dep, times.durationMinutes)
    : { endTime: null, endNextDay: false };
  const resolvedEnd = explicitArrival ?? computed.endTime;
  const startTimeSource: TravelFlightStartTimeSource = times.dep
    ? "explicit"
    : "missing_or_unreadable";
  const endTimeSource: TravelFlightEndTimeSource = explicitArrival
    ? "explicit_arrival_time"
    : computed.endTime
      ? "computed_from_duration"
    : "missing_or_unreadable";
  const requiresManualTimeReview =
    startTimeSource === "missing_or_unreadable" ||
    endTimeSource === "missing_or_unreadable";

  const fromCityRaw = sanitizeAirportCityLabel(leg.from.city);
  const toCityRaw = sanitizeAirportCityLabel(leg.to.city);
  const originCity = isUsableCalendarPlaceLabel(fromCityRaw) ? fromCityRaw : null;
  const destCity = isUsableCalendarPlaceLabel(toCityRaw) ? toCityRaw : null;

  const proposedTitle = buildCalendarFlightTitle(
    originCity,
    destCity,
    leg.from.code,
    leg.to.code,
  );

  return {
    departureTime: times.dep,
    endTime: resolvedEnd,
    arrivalTime: explicitArrival,
    durationMinutes: times.durationMinutes,
    endNextDay: !explicitArrival && computed.endNextDay,
    startTimeSource,
    endTimeSource,
    inferredEndTime: false,
    requiresManualTimeReview,
    origin: leg.from.code,
    destination: leg.to.code,
    originCity,
    destCity,
    passengerName: shared.passengerName,
    flightNumber: shared.flightNumber,
    proposedTitle,
  };
}

/**
 * Alle flyetapper i dokumentet (typisk 1; 2+ ved f.eks. JFK→LHR og LHR→OSL).
 */
export function inferTravelFlightsFromBlob(rawBlob: string): TravelFlightInference[] {
  const blob = rawBlob.replace(/\r\n/g, "\n").trim();
  if (blob.length < 24) return [];

  const blobOneLine = blob
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");

  const score = scoreFlightDocument(blobOneLine);
  if (score < 4) return [];

  const rows = extractAllAirportRows(blob);
  const legs = deriveLegsFromAirportRows(rows);
  const pairs = extractOrderedDepArrPairs(blob);
  const globalTimes = scanLinesForLabeledTimes(blob, blobOneLine);
  const durationMinutes = parseDurationMinutes(blobOneLine);
  const shared = {
    passengerName: extractPassengerName(blobOneLine),
    flightNumber: extractFlightNumber(blobOneLine),
  };

  if (legs.length === 0) {
    let dep = globalTimes.dep;
    let arr = globalTimes.arr;
    if (!dep || !arr) {
      const hint = twoTimeHeuristic(blobOneLine, true);
      dep = dep ?? hint.dep;
      arr = arr ?? hint.arr;
    }
    return [
      buildLegInference(
        { from: { code: "Ukjent", city: "" }, to: { code: "Ukjent", city: "" } },
        { dep, arr, durationMinutes },
        shared,
      ),
    ];
  }

  return legs.map((leg, i) => {
    let dep: string | null = null;
    let arr: string | null = null;
    if (pairs[i]) {
      dep = pairs[i]!.dep;
      arr = pairs[i]!.arr;
    }
    if (legs.length === 1) {
      dep = dep ?? globalTimes.dep;
      arr = arr ?? globalTimes.arr;
      if (!dep || !arr) {
        const hint = twoTimeHeuristic(blobOneLine, true);
        dep = dep ?? hint.dep;
        arr = arr ?? hint.arr;
      }
    }
    return buildLegInference(leg, { dep, arr, durationMinutes }, shared);
  });
}

/** Bakoverkompat: første etappe eller tom. */
export function inferTravelFlightFromBlob(rawBlob: string): TravelFlightInference | null {
  const legs = inferTravelFlightsFromBlob(rawBlob);
  return legs.length > 0 ? legs[0]! : null;
}
