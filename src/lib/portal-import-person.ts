import type { TravelFlightInference } from "@/lib/travel-document-infer";
import type { PortalEventPersonMatchStatus, SchoolWeeklyProfile } from "@/lib/types";

export type PortalKnownPerson = {
  personId: string;
  displayName: string;
};

/** Oppgave 6: minimal relevanskontekst fra klienten (utvides av 7/8 med fag/språkspor). */
export type PortalRelevanceContext = {
  /** Elevens klassekode, f.eks. «2STC». */
  classCode?: string;
  /**
   * Oppgave 9 (steg 1): barnets lagrede timeplan, validert fra klient-input
   * (ChildSchoolProfile). Tilgjengeliggjøres for senere fag↔time-matching.
   */
  schoolProfile?: SchoolWeeklyProfile | null;
};

/**
 * Vei 1 (lag 2): ett barn i en children-liste. Må ha personId + classCode (for klasse-match);
 * schoolProfile er valgfri. Strukturelt lik matcherens MatchChild (parseren garanterer classCode).
 */
export type PortalRelevanceChild = {
  personId: string;
  classCode: string;
  schoolProfile?: SchoolWeeklyProfile | null;
};

export type PortalImportContext = {
  knownPersons: PortalKnownPerson[];
  relevanceContext?: PortalRelevanceContext;
  /** Vei 1 (lag 2): liste av barn som serveren matcher dokumentet mot for å velge ett. */
  children?: PortalRelevanceChild[];
};

// Kanonisk definisjon flyttet til @/lib/types; re-eksporteres her for eksisterende importstier.
export type { PortalEventPersonMatchStatus };

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

/**
 * Parser klientens valgfrie relevanskontekst. Aksepterer både objekt (JSON-body) og
 * JSON-streng (multipart-felt). Returnerer undefined når verken klasse eller timeplan finnes.
 *
 * `validateProfile` injiseres av kalleren (route.ts) for å validere en evt. `schoolProfile`
 * (oppgave 9, steg 1) — slik at denne lib-en slipper å avhenge av den tunge LLM-modulen.
 * Råinput valideres ALLTID via denne før den beholdes; ugyldig profil droppes (null).
 */
export function parseRelevanceContextFromBody(
  raw: unknown,
  validateProfile?: (raw: unknown) => SchoolWeeklyProfile | null,
): PortalRelevanceContext | undefined {
  let val: unknown = raw;
  if (typeof val === "string") {
    const t = val.trim();
    if (!t) return undefined;
    try {
      val = JSON.parse(t);
    } catch {
      return undefined;
    }
  }
  if (!val || typeof val !== "object" || Array.isArray(val)) return undefined;
  const o = val as Record<string, unknown>;
  const classCode = typeof o.classCode === "string" ? o.classCode.trim() : "";
  const schoolProfile =
    validateProfile && o.schoolProfile !== undefined && o.schoolProfile !== null
      ? validateProfile(o.schoolProfile)
      : null;
  if (!classCode && !schoolProfile) return undefined;
  return {
    ...(classCode ? { classCode } : {}),
    ...(schoolProfile ? { schoolProfile } : {}),
  };
}

/**
 * Vei 1 (lag 2): parser den NYE children-liste-formen `{ children: [{ personId, classCode,
 * schoolProfile }] }`. Returnerer undefined når `children` IKKE er en ikke-tom array med gyldige
 * barn → kalleren faller da byte-identisk tilbake til den gamle ett-barns-formen via
 * `parseRelevanceContextFromBody`. `validateProfile` injiseres som for ett-barns-formen.
 */
export function parseRelevanceChildrenFromBody(
  raw: unknown,
  validateProfile?: (raw: unknown) => SchoolWeeklyProfile | null,
): PortalRelevanceChild[] | undefined {
  let val: unknown = raw;
  if (typeof val === "string") {
    const t = val.trim();
    if (!t) return undefined;
    try {
      val = JSON.parse(t);
    } catch {
      return undefined;
    }
  }
  if (!val || typeof val !== "object" || Array.isArray(val)) return undefined;
  const arr = (val as Record<string, unknown>).children;
  if (!Array.isArray(arr)) return undefined;
  const out: PortalRelevanceChild[] = [];
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const personId = typeof o.personId === "string" ? o.personId.trim() : "";
    const classCode = typeof o.classCode === "string" ? o.classCode.trim() : "";
    if (!personId || !classCode) continue; // må kunne identifiseres + matches på klasse
    const schoolProfile =
      validateProfile && o.schoolProfile !== undefined && o.schoolProfile !== null
        ? validateProfile(o.schoolProfile)
        : null;
    out.push({
      personId,
      classCode,
      ...(schoolProfile ? { schoolProfile } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Oppgave 6: når klienten sendte elevens klasse, gjør ukeplan-overlayens hovedkontekst
 * klassepresis («Ukeplan for 2STC») i stedet for modellens brede targetGroup. Returnerer
 * feltene som skal overstyres, eller null når ingen klasse er oppgitt.
 */
export function relevanceOverlayOverride(
  relevanceContext: PortalRelevanceContext | undefined,
): { classLabel: string; sourceTitle: string } | null {
  const classCode = relevanceContext?.classCode?.trim();
  if (!classCode) return null;
  return { classLabel: classCode, sourceTitle: `Ukeplan for ${classCode}` };
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
