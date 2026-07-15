/**
 * `buildSchoolBlockProposal` — steg 1: rent, deterministisk proposal-/DAGSSKALL.
 *
 * Dette steget bygger KUN proposalets toppnivå + sikre dagsskall (tomme contentItems,
 * `dayOperation: { op: "none" }`, `dayResolution: "enrich_only"`). Innhold, audience-logikk
 * og dagsoperasjoner er bevisst UTSATT til senere steg.
 *
 * Builderen er helt ren: ingen `Date.now()`, ingen `Math.random()`, ingen UUID, ingen
 * runtime-klokke, ingen mutasjon av `result`/`context`. Samme input → identisk output.
 * Alle ID-er er deterministiske (djb2Hex over lengdeprefikset, semantisk materiale).
 */
import { selectChildForDocument } from "@/lib/child-selection";
import type { PortalImportContext } from "@/lib/portal-import-person";
import { djb2Hex } from "@/lib/stable-id";
import { normalizeSchoolDateToIso } from "@/lib/school-date";
import {
  detectIsoWeekdayFromLabel,
  normalizeSchoolWeekdayIndex,
  schoolWeekdayIndexFromIsoDate,
} from "@/lib/school-weekday";
import type {
  AIAnalysisResult,
  PortalEventPersonMatchStatus,
  SchoolBlockDay,
  SchoolBlockProposal,
  SchoolProfileWeekdayIndex,
} from "@/lib/types";

export interface BuildSchoolBlockProposalMeta {
  proposalId: string;
  originalSourceType: string;
  sourceTitle?: string;
  weekNumber?: number | null;
}

const CANONICAL_WEEKDAY_LABELS: Record<SchoolProfileWeekdayIndex, string> = {
  "0": "Mandag",
  "1": "Tirsdag",
  "2": "Onsdag",
  "3": "Torsdag",
  "4": "Fredag",
};

/** Trim → `null` når tom/manglende. */
function trimToNull(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

/**
 * Lengdeprefikset feltkoding (entydig, unngår kollisjon mellom manglende verdi, bokstavelig
 * «<null>» og tekst som inneholder separatoren). `.length` er UTF-16 code units — konsistent
 * med `djb2Hex`. `null`/`undefined` → `N;`, streng → `S<lengde>:<verdi>;`. Privat: dagsskallets
 * ID-materiale er alltid ikke-null strenger, så null-vs-«<null>»-egenskapen testes senere når
 * `itemId`/`audienceEntryId` faktisk bygges fra nullable felt.
 */
function encodeField(value: string | null | undefined): string {
  if (value == null) return "N;";
  return `S${value.length}:${value};`;
}

function serializeMaterial(fields: (string | null | undefined)[]): string {
  return fields.map(encodeField).join("");
}

function dayIdFromMaterial(fields: string[]): string {
  return `school-day-h${djb2Hex(serializeMaterial(fields))}`;
}

/** Ett dagfrø fra en (date, dayLabel)-rad. `null` → raden droppes (ingen dag konstrueres). */
type DaySeed = {
  key: string;
  date: string | null;
  weekdayIndex: SchoolProfileWeekdayIndex | null;
  sourceLabel: string | null;
};

function seedFromRow(
  rawDate: string | null,
  rawLabel: string | null,
): DaySeed | null {
  const iso = normalizeSchoolDateToIso(rawDate);
  if (iso) {
    // Dato er kilde til ukedagen når den finnes.
    const wk = schoolWeekdayIndexFromIsoDate(iso); // "0"–"4" for man–fre, null for helg
    return {
      key: `date:${iso}`,
      date: iso,
      weekdayIndex: wk,
      sourceLabel: trimToNull(rawLabel),
    };
  }
  // Ingen sikker dato → forsøk sikker mandag–fredag fra label. Aldri inferer dato herfra.
  let wk = normalizeSchoolWeekdayIndex(rawLabel);
  if (!wk) {
    const isoW = detectIsoWeekdayFromLabel(rawLabel); // 1–7 (helg 6–7)
    if (isoW !== null && isoW >= 1 && isoW <= 5) {
      wk = String(isoW - 1) as SchoolProfileWeekdayIndex;
    }
  }
  if (wk) {
    return {
      key: `weekday:${wk}`,
      date: null,
      weekdayIndex: wk,
      sourceLabel: trimToNull(rawLabel),
    };
  }
  return null;
}

type DayGroup = {
  key: string;
  date: string | null;
  weekdayIndex: SchoolProfileWeekdayIndex | null;
  sourceLabels: string[];
};

function collectDayGroups(result: AIAnalysisResult): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  const addSeed = (seed: DaySeed | null): void => {
    if (!seed) return;
    let group = groups.get(seed.key);
    if (!group) {
      group = {
        key: seed.key,
        date: seed.date,
        weekdayIndex: seed.weekdayIndex,
        sourceLabels: [],
      };
      groups.set(seed.key, group);
    }
    if (seed.sourceLabel !== null) group.sourceLabels.push(seed.sourceLabel);
  };

  // Les uten å mutere/sortere input-arrayene.
  for (const day of result.scheduleByDay) {
    addSeed(seedFromRow(day.date, day.dayLabel));
  }
  for (const entry of result.classScheduleEntries ?? []) {
    addSeed(seedFromRow(entry.date, entry.dayLabel));
  }
  return Array.from(groups.values());
}

function labelForGroup(group: DayGroup): string | null {
  if (group.weekdayIndex !== null) {
    return CANONICAL_WEEKDAY_LABELS[group.weekdayIndex];
  }
  // Helgedato: deterministisk, trimmet kildelabel (leksikografisk minste), ellers null.
  // Ingen konstruksjon av «Lørdag»/«Søndag» i dette steget.
  if (group.sourceLabels.length === 0) return null;
  return [...group.sourceLabels].sort()[0]!;
}

function buildDay(group: DayGroup, confidence: number): SchoolBlockDay {
  const material =
    group.date !== null
      ? ["school-day", "date", group.date]
      : ["school-day", "weekday", group.weekdayIndex!];
  return {
    dayId: dayIdFromMaterial(material),
    date: group.date,
    weekdayIndex: group.weekdayIndex,
    dayLabel: labelForGroup(group),
    blockTitle: null,
    dayOperation: { op: "none" },
    dayResolution: "enrich_only",
    contentItems: [],
    confidence,
    evidence: null,
    reviewFlags: [],
  };
}

/** Deterministisk: datofestede før udaterte; date↑; weekdayIndex↑; label; dayId. */
function compareDays(a: SchoolBlockDay, b: SchoolBlockDay): number {
  const aDated = a.date !== null;
  const bDated = b.date !== null;
  if (aDated !== bDated) return aDated ? -1 : 1;
  if (aDated && a.date !== b.date) return a.date! < b.date! ? -1 : 1;
  const aw = a.weekdayIndex ?? "~"; // null sorterer etter "0"–"4"
  const bw = b.weekdayIndex ?? "~";
  if (aw !== bw) return aw < bw ? -1 : 1;
  const al = a.dayLabel ?? "";
  const bl = b.dayLabel ?? "";
  if (al !== bl) return al < bl ? -1 : 1;
  if (a.dayId !== b.dayId) return a.dayId < b.dayId ? -1 : 1;
  return 0;
}

function requireNonBlank(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} må være en ikke-blank streng`);
  }
}

function resolveSourceTitle(
  metaTitle: string | undefined,
  resultTitle: string,
): string {
  return trimToNull(metaTitle) ?? trimToNull(resultTitle) ?? "Skoleinformasjon";
}

type PersonResolution = {
  personId: string | null;
  personMatchStatus: PortalEventPersonMatchStatus;
  classCode: string | null;
};

function resolvePersonAndClass(
  result: AIAnalysisResult,
  context: PortalImportContext,
): PersonResolution {
  const selection = selectChildForDocument(result, context);
  const legacyClassCode = trimToNull(selection.relevanceContext?.classCode) ?? null;

  if (selection.match) {
    if (selection.match.status === "matched") {
      return {
        personId: selection.match.personId,
        personMatchStatus: "matched",
        classCode: legacyClassCode,
      };
    }
    // ambiguous | no_signal → uavklart barn; ingen felles klassekode rekonstrueres.
    return { personId: null, personMatchStatus: "child_unresolved", classCode: null };
  }

  // Legacy relevanceContext eller ingen kontekst → ikke en sikker personmatch.
  return { personId: null, personMatchStatus: "not_specified", classCode: legacyClassCode };
}

export function buildSchoolBlockProposal(
  result: AIAnalysisResult,
  context: PortalImportContext,
  meta: BuildSchoolBlockProposalMeta,
): SchoolBlockProposal {
  requireNonBlank(meta.proposalId, "proposalId");
  requireNonBlank(meta.originalSourceType, "originalSourceType");

  const sourceTitle = resolveSourceTitle(meta.sourceTitle, result.title);
  const { personId, personMatchStatus, classCode } = resolvePersonAndClass(
    result,
    context,
  );

  const days = collectDayGroups(result)
    .map((group) => buildDay(group, result.confidence))
    .sort(compareDays);

  const hasWeekNumber = Object.prototype.hasOwnProperty.call(meta, "weekNumber");

  return {
    proposalId: meta.proposalId, // caller-levert identitet, beholdt eksakt (ikke trimmet)
    kind: "school_block",
    schemaVersion: "1.0.0",
    sourceTitle,
    originalSourceType: meta.originalSourceType.trim(),
    confidence: result.confidence,
    personId,
    personMatchStatus,
    classCode,
    ...(hasWeekNumber ? { weekNumber: meta.weekNumber } : {}),
    days,
    structureStatus: "complete",
    reviewFlags: [],
  };
}
