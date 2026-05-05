import type { TravelFlightInference } from "@/lib/travel-document-infer";

export type PortalKnownPerson = {
  personId: string;
  displayName: string;
};

export type PortalImportContext = {
  knownPersons: PortalKnownPerson[];
};

export type PortalEventPersonMatchStatus =
  | "not_specified"
  | "unmatched_document_name"
  | "matched";

function nameMatchKey(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,]/g, "")
    .trim();
}

function parseKnownPersonRow(row: unknown): PortalKnownPerson | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  const idRaw =
    typeof o.personId === "string"
      ? o.personId
      : typeof o.id === "string"
        ? o.id
        : null;
  const personId = idRaw?.trim() || null;
  const nameRaw =
    typeof o.displayName === "string"
      ? o.displayName
      : typeof o.name === "string"
        ? o.name
        : null;
  const displayName = nameRaw?.trim() || null;
  if (!personId || !displayName) return null;
  return { personId, displayName };
}

export function parseKnownPersonsFromBody(raw: unknown): PortalKnownPerson[] {
  if (!raw || !Array.isArray(raw)) return [];
  const out: PortalKnownPerson[] = [];
  for (const row of raw) {
    const p = parseKnownPersonRow(row);
    if (p) out.push(p);
  }
  return out;
}

export function resolvePortalEventPersonMatch(opts: {
  documentExtractedName: string | null | undefined;
  knownPersons: PortalKnownPerson[];
}): {
  personId: string | null;
  personMatchStatus: PortalEventPersonMatchStatus;
  documentExtractedPersonName?: string;
} {
  const rawName = opts.documentExtractedName?.trim() || "";
  if (!rawName) {
    return { personId: null, personMatchStatus: "not_specified" };
  }

  const docKey = nameMatchKey(rawName);
  for (const kp of opts.knownPersons) {
    if (nameMatchKey(kp.displayName) === docKey) {
      return {
        personId: kp.personId,
        personMatchStatus: "matched",
        documentExtractedPersonName: rawName,
      };
    }
  }

  return {
    personId: null,
    personMatchStatus: "unmatched_document_name",
    documentExtractedPersonName: rawName,
  };
}

/** Kalender-ISO for Foreldre-App (`yyyy-mm-dd` + `HH:MM`). */
export function portalEventDateTimeIso(dateYmd: string, hhmm: string): string {
  const t = hhmm.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return t;
    return `${dateYmd}T00:00:00`;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  return `${dateYmd}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
}

export function isLikelyHHMM(timeField: string): boolean {
  return /^\d{1,2}:\d{2}$/.test(timeField.trim());
}

export function travelFlightMetadataFromInference(tf: TravelFlightInference): {
  type: "flight";
  origin: string;
  originCity: string | null;
  destination: string;
  destinationCity: string | null;
  departureTime: string;
  arrivalTime: string;
  passengerName: string | null;
  flightNumber: string | null;
} {
  const arrivalHHMM = tf.arrivalTime ?? tf.endTime;
  return {
    type: "flight",
    origin: tf.origin,
    originCity: tf.originCity,
    destination: tf.destination,
    destinationCity: tf.destCity,
    departureTime: tf.departureTime,
    arrivalTime: arrivalHHMM,
    passengerName: tf.passengerName,
    flightNumber: tf.flightNumber,
  };
}

/** Sikrer Foreldre-App-kontrakt: personId aldri «pending»/tom, ISO start/slutt, dokumentimport-felt. */
export function normalizePortalProposalEventItem<
  T extends {
    kind: "event";
    event: {
      date: string;
      start: string;
      end: string;
      personId?: string | null;
      personMatchStatus?: PortalEventPersonMatchStatus;
      sourceKind?: string;
      requiresPerson?: boolean;
      [key: string]: unknown;
    };
  },
>(item: T): T {
  const e = item.event;
  let personId: string | null = e.personId ?? null;
  if (personId === "" || personId === "pending") personId = null;

  const start = isLikelyHHMM(e.start)
    ? portalEventDateTimeIso(e.date, e.start)
    : e.start;
  const end = isLikelyHHMM(e.end) ? portalEventDateTimeIso(e.date, e.end) : e.end;

  return {
    ...item,
    event: {
      ...e,
      personId,
      personMatchStatus: e.personMatchStatus ?? "not_specified",
      sourceKind: "document_import",
      requiresPerson: false,
      start,
      end,
    },
  };
}
