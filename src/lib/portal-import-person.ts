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
  const rawName =
    opts.documentExtractedName == null || opts.documentExtractedName === undefined
      ? ""
      : typeof opts.documentExtractedName === "string"
        ? opts.documentExtractedName.trim()
        : "";
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
  const d = typeof dateYmd === "string" ? dateYmd.trim() : "";
  if (typeof hhmm !== "string") {
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : "";
  }
  const t = hhmm.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return t;
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : "";
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  return `${d}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
}

export function isLikelyHHMM(timeField: string | null | undefined): boolean {
  if (timeField == null || typeof timeField !== "string") return false;
  return /^\d{1,2}:\d{2}$/.test(timeField.trim());
}

function isValidPortalEventDateYmd(d: unknown): d is string {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim());
}

export function travelFlightMetadataFromInference(tf: TravelFlightInference): {
  type: "flight";
  origin: string;
  originCity: string | null;
  destination: string;
  destinationCity: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  durationMinutes: number | null;
  passengerName: string | null;
  flightNumber: string | null;
} {
  return {
    type: "flight",
    origin: tf.origin,
    originCity: tf.originCity,
    destination: tf.destination,
    destinationCity: tf.destCity,
    departureTime: tf.departureTime,
    arrivalTime: tf.arrivalTime,
    durationMinutes: tf.durationMinutes,
    passengerName: tf.passengerName,
    flightNumber: tf.flightNumber,
  };
}

/** Sikrer Foreldre-App-kontrakt: personId aldri «pending»/tom, ISO start/slutt, dokumentimport-felt. */
function sanitizePortalTimeField(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || /^unknown$/i.test(t)) return null;
  return t;
}

export function normalizePortalProposalEventItem<
  T extends {
    kind: "event";
    event: {
      date: string;
      start: string | null;
      end: string | null;
      personId?: string | null;
      personMatchStatus?: PortalEventPersonMatchStatus;
      sourceKind?: string;
      requiresPerson?: boolean;
      requiresManualTimeReview?: boolean;
      [key: string]: unknown;
    };
  },
>(item: T): T {
  const e = item.event;
  let personId: string | null = e.personId ?? null;
  if (personId === "" || personId === "pending") personId = null;

  const startRaw = sanitizePortalTimeField(e.start);
  const endRaw = sanitizePortalTimeField(e.end);
  const dateOk = isValidPortalEventDateYmd(e.date);

  const start =
    startRaw === null
      ? null
      : isLikelyHHMM(startRaw)
        ? dateOk
          ? portalEventDateTimeIso(e.date.trim(), startRaw) || null
          : null
        : startRaw;
  const end =
    endRaw === null
      ? null
      : isLikelyHHMM(endRaw)
        ? dateOk
          ? portalEventDateTimeIso(e.date.trim(), endRaw) || null
          : null
        : endRaw;

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
