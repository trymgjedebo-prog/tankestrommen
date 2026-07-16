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
import { normalizeClassCode } from "@/lib/school-class-schedule";
import { djb2Hex } from "@/lib/stable-id";
import { normalizeSchoolDateToIso } from "@/lib/school-date";
import { normalizeSchoolTime } from "@/lib/school-time";
import {
  detectIsoWeekdayFromLabel,
  normalizeSchoolWeekdayIndex,
  schoolWeekdayIndexFromIsoDate,
} from "@/lib/school-weekday";
import type {
  AIAnalysisResult,
  ClassScheduleEntry,
  DayScheduleEntry,
  PortalEventPersonMatchStatus,
  SchoolBlockAudienceEntry,
  SchoolBlockContentItem,
  SchoolBlockDay,
  SchoolBlockProposal,
  SchoolBlockReviewFlag,
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

/* ── Steg 2A: per_audience-content-items fra classScheduleEntries ─────────────── */

const CHILD_CLASS_UNRESOLVED_MESSAGE =
  "Barnets klasse kunne ikke oppløses for klassespesifikk skoleinformasjon.";

/** Trim + kollaps intern whitespace til ett mellomrom; bevar casing; tom → null. */
function normalizeText(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
}

/**
 * Normaliser klassekoder til (a) interne nøkler og (b) wire-visningsverdier.
 *
 * `keys`: `normalizeClassCode` (casing-uavhengig) — brukes til match, ID-materiale og
 * deduplisering/sortering. `display`: bevart visningscasing per nøkkel (som eksisterende
 * `normalizeClassScheduleEntriesRaw`-semantikk «2STC»). Deterministisk visningsvalg: fjern
 * intern whitespace (som klassekode-kontrakten), velg leksikografisk minste kandidat per
 * nøkkel (uppercase sorterer før lowercase), og sorter gruppene etter normalisert nøkkel.
 */
function normalizeClassCodes(raw: readonly string[]): { keys: string[]; display: string[] } {
  const groups = new Map<string, string[]>();
  for (const code of raw) {
    if (typeof code !== "string") continue;
    const key = normalizeClassCode(code);
    if (!key) continue;
    const candidate = code.replace(/\s+/g, ""); // bevar casing, fjern all whitespace
    const list = groups.get(key);
    if (list) list.push(candidate);
    else groups.set(key, [candidate]);
  }
  const keys = [...groups.keys()].sort();
  const display = keys.map((k) => [...groups.get(k)!].sort()[0]!);
  return { keys, display };
}

/** Entydig, lengdeprefikset array-serialisering: ett ytre felt hvis innhold er de kodede elementene. */
function serializeArray(items: string[]): string {
  return encodeField(items.map(encodeField).join(""));
}

type NormalizedEntry = {
  daySemanticKey: string;
  title: string;
  activityTitle: string | null;
  pulje: string | null;
  start: string | null;
  end: string | null;
  room: string | null;
  teacher: string | null;
  sourceText: string | null;
  /** Interne casing-uavhengige nøkler (match + ID-materiale). */
  classCodeKeys: string[];
  /** Wire-visningsverdier (bevart casing, f.eks. «2STC»). */
  classCodeDisplay: string[];
  confidence: number;
};

/** Normaliser én ClassScheduleEntry, eller `null` når den ikke kan bli et gyldig item. */
function normalizeEntry(entry: ClassScheduleEntry): NormalizedEntry | null {
  const seed = seedFromRow(entry.date, entry.dayLabel);
  if (!seed) return null; // ingen sikker dag → dropp

  const { keys: classCodeKeys, display: classCodeDisplay } = normalizeClassCodes(
    entry.classCodes ?? [],
  );
  if (classCodeKeys.length === 0) return null; // ingen gyldig klassekode → dropp

  const activityTitle = normalizeText(entry.activityTitle);
  const pulje = normalizeText(entry.groupLabel);
  const room = normalizeText(entry.room);
  const teacher = normalizeText(entry.teacher);
  const sourceText = normalizeText(entry.sourceText);
  const start = normalizeSchoolTime(entry.start);
  const end = normalizeSchoolTime(entry.end);

  const hasContent = [activityTitle, pulje, start, end, room, teacher, sourceText].some(
    (v) => v !== null,
  );
  if (!hasContent) return null; // ingen faktisk innholdsfelt → dropp

  const title = activityTitle ?? pulje ?? "Klasseinformasjon";
  return {
    daySemanticKey: seed.key,
    title,
    activityTitle,
    pulje,
    start,
    end,
    room,
    teacher,
    sourceText,
    classCodeKeys,
    classCodeDisplay,
    confidence: entry.confidence,
  };
}

/**
 * Felles semantisk diskriminator for item- og audience-ID (ikke itemId som eneste nøkkel).
 * Bruker de casing-uavhengige klassekode-NØKLENE, så IDs er identiske ved forskjeller i
 * casing/whitespace/rekkefølge — mens wire-visningen kan beholde stabil casing.
 */
function itemSemanticMaterial(e: NormalizedEntry): string {
  return (
    serializeMaterial([
      "message",
      "enrich",
      e.title,
      e.activityTitle,
      e.pulje,
      e.start,
      e.end,
      e.room,
      e.teacher,
      e.sourceText,
    ]) + serializeArray(e.classCodeKeys)
  );
}

function itemIdFor(e: NormalizedEntry): string {
  const material =
    serializeMaterial(["school-item", "class-schedule-entry", e.daySemanticKey]) +
    itemSemanticMaterial(e);
  return `school-item-h${djb2Hex(material)}`;
}

function audienceEntryIdFor(e: NormalizedEntry): string {
  const material =
    serializeMaterial(["school-audience", "class-schedule-entry", e.daySemanticKey]) +
    itemSemanticMaterial(e) +
    serializeArray(e.classCodeKeys) +
    serializeMaterial([e.pulje, e.start, e.end, e.room, e.teacher, e.sourceText]);
  return `school-audience-h${djb2Hex(material)}`;
}

/** Bygg ett per_audience message/enrich-item fra én normalisert rad. */
function buildContentItem(
  e: NormalizedEntry,
  dayId: string,
  normalizedChildClass: string | null,
): SchoolBlockContentItem {
  const audienceEntryId = audienceEntryIdFor(e);
  // Match mot de interne nøklene (casing-uavhengig), aldri mot visningsverdiene.
  const isChildAudience =
    normalizedChildClass === null ? null : e.classCodeKeys.includes(normalizedChildClass);

  const audienceEntry: SchoolBlockAudienceEntry = {
    audienceEntryId,
    classCodes: e.classCodeDisplay, // wire: bevart visningscasing
    pulje: e.pulje,
    start: e.start,
    end: e.end,
    room: e.room,
    teacher: e.teacher,
    isChildAudience,
  };
  const audienceEntries = [audienceEntry];

  const itemId = itemIdFor(e);

  // resolvedChildAudience KUN når nøyaktig én entry sikkert matcher barnet.
  const childMatches = audienceEntries.filter((a) => a.isChildAudience === true);
  const resolvedChildAudience =
    childMatches.length === 1
      ? {
          audienceEntryId: childMatches[0]!.audienceEntryId,
          start: childMatches[0]!.start,
          end: childMatches[0]!.end,
          room: childMatches[0]!.room,
          teacher: childMatches[0]!.teacher,
        }
      : null;

  // Blokkerende review KUN når barnets klasse er ukjent (ikke ved sikker ikke-match).
  const reviewFlags: SchoolBlockReviewFlag[] =
    normalizedChildClass === null
      ? [
          {
            code: "child_class_unresolved",
            message: CHILD_CLASS_UNRESOLVED_MESSAGE,
            scope: { dayId, itemId }, // ikke peker på én audience — riktig entry kan ikke velges
          },
        ]
      : [];

  return {
    itemId,
    title: e.title,
    contentType: "message",
    action: "enrich",
    subject: null,
    subjectKey: null,
    customLabel: null,
    audienceScope: "per_audience",
    commonSchedule: null,
    audienceEntries,
    resolvedChildAudience,
    sections: e.sourceText !== null ? { descriptionLines: [e.sourceText] } : {},
    activityKind: null,
    evidence: null,
    sourceText: e.sourceText,
    confidence: e.confidence,
    reviewFlags,
  };
}

/** Kjent tid før null; ellers leksikografisk (HH:MM er null-padet → kronologisk). */
function compareKnownTimeFirst(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function earliestStart(item: SchoolBlockContentItem): string | null {
  const starts = item.audienceEntries.map((a) => a.start).filter((s): s is string => s !== null);
  return starts.length > 0 ? starts.sort()[0]! : null;
}
function earliestEnd(item: SchoolBlockContentItem): string | null {
  const ends = item.audienceEntries.map((a) => a.end).filter((s): s is string => s !== null);
  return ends.length > 0 ? ends.sort()[0]! : null;
}

/** per_audience før common (tie-break når begge er untimed). */
function audienceScopeRank(item: SchoolBlockContentItem): number {
  return item.audienceScope === "per_audience" ? 0 : 1;
}

/** Manglende tekst FØR ikke-manglende. */
function compareOptionalText(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/**
 * Items: første kjente start (kjent før null) → første kjente end → audience-scope
 * (per_audience før common) → title → sourceText → itemId. Tidsfeltene dominerer, så den
 * tidligere class-item-semantikken er uendret; common-items er alltid untimed og havner sist.
 */
function compareItems(a: SchoolBlockContentItem, b: SchoolBlockContentItem): number {
  const s = compareKnownTimeFirst(earliestStart(a), earliestStart(b));
  if (s !== 0) return s;
  const e = compareKnownTimeFirst(earliestEnd(a), earliestEnd(b));
  if (e !== 0) return e;
  const scope = audienceScopeRank(a) - audienceScopeRank(b);
  if (scope !== 0) return scope;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  const text = compareOptionalText(a.sourceText, b.sourceText);
  if (text !== 0) return text;
  if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
  return 0;
}

/* ── Steg 2B: common-items fra scheduleByDay ──────────────────────────────────
 * Kildeenheter: hele `details` (ÉN enhet, aldri splittet) + hvert ikke-blankt element i
 * `highlights`/`rememberItems`/`deadlines`/`notes`. `time` ignoreres fullstendig i dette
 * steget (ingen commonSchedule, ingen parsing, ikke i ID/sortering/review).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Kildefelt i DEDUPE-PRIORITERT rekkefølge (index = prioritet, lavest vinner): den mest
 * spesifikke strukturerte kilden vinner over den generelle `details`-oppsummeringen.
 * Titlene angir KUN hvilket allerede strukturert kildefelt teksten kom fra.
 */
function commonSourceFieldsInPriorityOrder(
  day: DayScheduleEntry,
): Array<{ raws: readonly (string | null)[]; title: string }> {
  return [
    { raws: day.deadlines, title: "Frist" },
    { raws: day.rememberItems, title: "Husk" },
    { raws: day.highlights, title: "Viktig informasjon" },
    { raws: day.notes, title: "Merknad" },
    { raws: [day.details], title: "Skoleinformasjon" },
  ];
}

type CommonUnit = { dayKey: string; text: string; priority: number; title: string };

/**
 * Samle sikre common-kildeenheter per semantisk dag. Dedupliserer identisk normalisert tekst
 * (casing-SENSITIVT) innen samme dag — på tvers av rader, felt og innad i samme array — og
 * velger representasjon deterministisk etter kildeprioritet (aldri inputrekkefølge).
 */
function collectCommonUnits(result: AIAnalysisResult): CommonUnit[] {
  const best = new Map<string, CommonUnit>();
  for (const day of result.scheduleByDay) {
    const seed = seedFromRow(day.date, day.dayLabel);
    if (!seed) continue; // ingen sikker dag → ingen dag og ingen common-item
    const fields = commonSourceFieldsInPriorityOrder(day);
    for (let priority = 0; priority < fields.length; priority++) {
      const field = fields[priority]!;
      for (const raw of field.raws) {
        const text = normalizeText(raw); // trim + kollaps whitespace, casing bevart
        if (text === null) continue;
        const key = `${seed.key}\u0000${text}`;
        const existing = best.get(key);
        if (!existing || priority < existing.priority) {
          best.set(key, { dayKey: seed.key, text, priority, title: field.title });
        }
      }
    }
  }
  return [...best.values()];
}

/** Identisk tekst på samme dag → samme ID, uansett kildefelt/title/confidence/rekkefølge. */
function commonItemIdFor(dayKey: string, text: string): string {
  const material = serializeMaterial([
    "school-item",
    "schedule-by-day",
    dayKey,
    "message",
    "enrich",
    text,
  ]);
  return `school-item-h${djb2Hex(material)}`;
}

/** Ikke-destruktivt common message/enrich-item. Aldri audience, tid eller review-flagg. */
function buildCommonItem(unit: CommonUnit, confidence: number): SchoolBlockContentItem {
  return {
    itemId: commonItemIdFor(unit.dayKey, unit.text),
    title: unit.title,
    contentType: "message",
    action: "enrich",
    subject: null,
    subjectKey: null,
    customLabel: null,
    audienceScope: "common",
    commonSchedule: null,
    audienceEntries: [],
    resolvedChildAudience: null,
    sections: { descriptionLines: [unit.text] },
    activityKind: null,
    evidence: null,
    sourceText: unit.text,
    confidence,
    reviewFlags: [],
  };
}

/** Deterministisk duplikat-preferanse: høyest confidence, deretter minste visnings-signatur. */
function isPreferredDuplicate(
  candidate: SchoolBlockContentItem,
  existing: SchoolBlockContentItem,
): boolean {
  if (candidate.confidence !== existing.confidence) {
    return candidate.confidence > existing.confidence;
  }
  const sig = (i: SchoolBlockContentItem) => i.audienceEntries[0]!.classCodes.join("\u0001");
  return sig(candidate) < sig(existing);
}

/** Bygg alle content-items, dedupliser via itemId, grupper per semantisk dagnøkkel. */
function collectContentItemsByDay(
  result: AIAnalysisResult,
  dayIdByKey: Map<string, string>,
  normalizedChildClass: string | null,
): Map<string, SchoolBlockContentItem[]> {
  const byItemId = new Map<string, { item: SchoolBlockContentItem; dayKey: string }>();
  for (const entry of result.classScheduleEntries ?? []) {
    const e = normalizeEntry(entry);
    if (!e) continue;
    const dayId = dayIdByKey.get(e.daySemanticKey);
    if (dayId === undefined) continue; // dagen finnes alltid (samme frølogikk), men vær defensiv
    const item = buildContentItem(e, dayId, normalizedChildClass);
    // Semantiske duplikater deler itemId (confidence + visningscasing er ikke i ID-en). Velg
    // deterministisk: høyest confidence, deretter leksikografisk minste visning — så output er
    // uavhengig av inputrekkefølge selv når duplikater har ulik casing eller lik confidence.
    const existing = byItemId.get(item.itemId);
    if (!existing || isPreferredDuplicate(item, existing.item)) {
      byItemId.set(item.itemId, { item, dayKey: e.daySemanticKey });
    }
  }
  const byDay = new Map<string, SchoolBlockContentItem[]>();
  const push = (dayKey: string, item: SchoolBlockContentItem): void => {
    const list = byDay.get(dayKey) ?? [];
    list.push(item);
    byDay.set(dayKey, list);
  };
  for (const { item, dayKey } of byItemId.values()) push(dayKey, item);

  // Common-items fra scheduleByDay. Dedupliseres KUN mot andre common-items (eget
  // ID-materiale «schedule-by-day» ≠ «class-schedule-entry»), aldri mot per_audience-items.
  for (const unit of collectCommonUnits(result)) {
    if (!dayIdByKey.has(unit.dayKey)) continue;
    push(unit.dayKey, buildCommonItem(unit, result.confidence));
  }

  for (const list of byDay.values()) list.sort(compareItems);
  return byDay;
}

/** Dedupe-nøkkel: code, dayId, itemId, audienceEntryId, message (lengdeprefikset). */
function flagDedupeKey(flag: SchoolBlockReviewFlag): string {
  return serializeMaterial([
    flag.code,
    flag.scope.dayId,
    flag.scope.itemId,
    flag.scope.audienceEntryId,
    flag.message,
  ]);
}

/** Manglende scope-felt sorteres FØR ikke-manglende. */
function compareOptional(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a < b ? -1 : 1;
}

function compareFlags(a: SchoolBlockReviewFlag, b: SchoolBlockReviewFlag): number {
  return (
    compareOptional(a.scope.dayId, b.scope.dayId) ||
    compareOptional(a.scope.itemId, b.scope.itemId) ||
    compareOptional(a.scope.audienceEntryId, b.scope.audienceEntryId) ||
    (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
    (a.message < b.message ? -1 : a.message > b.message ? 1 : 0)
  );
}

function dedupeAndSortFlags(flags: SchoolBlockReviewFlag[]): SchoolBlockReviewFlag[] {
  const seen = new Map<string, SchoolBlockReviewFlag>();
  for (const flag of flags) {
    const key = flagDedupeKey(flag);
    if (!seen.has(key)) seen.set(key, flag);
  }
  return [...seen.values()].sort(compareFlags);
}

function buildDay(
  group: DayGroup,
  confidence: number,
  contentItems: SchoolBlockContentItem[],
): SchoolBlockDay {
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
    contentItems,
    confidence,
    evidence: null,
    reviewFlags: dedupeAndSortFlags(contentItems.flatMap((i) => i.reviewFlags)),
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
  const normalizedChildClass = classCode !== null ? normalizeClassCode(classCode) : null;

  const groups = collectDayGroups(result);
  const dayIdByKey = new Map<string, string>();
  for (const group of groups) {
    const material =
      group.date !== null
        ? ["school-day", "date", group.date]
        : ["school-day", "weekday", group.weekdayIndex!];
    dayIdByKey.set(group.key, dayIdFromMaterial(material));
  }

  const itemsByDay = collectContentItemsByDay(result, dayIdByKey, normalizedChildClass);

  const days = groups
    .map((group) => buildDay(group, result.confidence, itemsByDay.get(group.key) ?? []))
    .sort(compareDays);

  const reviewFlags = dedupeAndSortFlags(days.flatMap((d) => d.reviewFlags));
  const structureStatus = reviewFlags.length > 0 ? "review_required" : "complete";

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
    structureStatus,
    reviewFlags,
  };
}
