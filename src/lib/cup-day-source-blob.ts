import { lineLooksLikeAdministrativeDeadline } from "@/lib/cup-day-content";
import { extractDaySourceSection } from "@/lib/analysis-evidence";

export type CupWeekendDayKey = "fredag" | "lørdag" | "søndag";

function normalizeSpace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

function hasDayMention(sentence: string, day: CupWeekendDayKey): boolean {
  const n = normalizeNorwegianLetters(sentence);
  if (day === "fredag") return /\bfredag|friday\b/.test(n);
  if (day === "lørdag") return /\blordag|l[øo]rdag|saturday\b/.test(n);
  return /\bsondag|s[øo]ndag|sunday\b/.test(n);
}

/** Ukedager nevnt på linjen (cup-helg). */
export function cupWeekendDaysMentionedInLine(line: string): Set<CupWeekendDayKey> {
  const out = new Set<CupWeekendDayKey>();
  if (hasDayMention(line, "fredag")) out.add("fredag");
  if (hasDayMention(line, "lørdag")) out.add("lørdag");
  if (hasDayMention(line, "søndag")) out.add("søndag");
  return out;
}

/**
 * Linje tilhører dagens segment når den nevner ukedagen (narrativ «fredag kl. …» / «på lørdag …»).
 * Administrative frister og rene overskrifter uten innhold scoper ikke tid til program.
 */
export function lineOwnedByCupDay(line: string, day: CupWeekendDayKey): boolean {
  const l = normalizeSpace(line);
  if (!l || lineLooksLikeAdministrativeDeadline(l)) return false;
  const mentioned = cupWeekendDaysMentionedInLine(l);
  if (mentioned.size === 0) return false;
  return mentioned.has(day);
}

const DAY_MENTION_PATTERNS: { key: CupWeekendDayKey; re: RegExp }[] = [
  { key: "fredag", re: /\bfredag\b|\bfriday\b/gi },
  { key: "lørdag", re: /\bl[øo]rdag\b|\bsaturday\b/gi },
  { key: "søndag", re: /\bs[øo]ndag\b|\bsunday\b/gi },
];

function findDayMentionsInLine(line: string): Array<{ key: CupWeekendDayKey; index: number }> {
  const mentions: Array<{ key: CupWeekendDayKey; index: number }> = [];
  for (const { key, re } of DAY_MENTION_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      mentions.push({ key, index: m.index });
    }
  }
  return mentions.sort((a, b) => a.index - b.index);
}

function findClockTimesInLine(line: string): Array<{ hhmm: string; index: number }> {
  const out: Array<{ hhmm: string; index: number }> = [];
  const re = /\b(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || hh < 0 || hh > 23 || mm < 0 || mm > 59) continue;
    out.push({
      hhmm: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
      index: m.index,
    });
  }
  return out;
}

function dayForTimeOnMultiDayLine(
  mentions: Array<{ key: CupWeekendDayKey; index: number }>,
  timeIndex: number,
): CupWeekendDayKey | null {
  let assigned: CupWeekendDayKey | null = null;
  for (const m of mentions) {
    if (m.index <= timeIndex) assigned = m.key;
    else break;
  }
  return assigned;
}

/** Klokkeslett på linje med én eller flere ukedager — bruk nærmeste dag før tiden, ikke hele linjen. */
export function timeOnLineOwnedByCupDay(
  line: string,
  hhmm: string,
  day: CupWeekendDayKey,
): boolean {
  const l = normalizeSpace(line);
  if (!l || lineLooksLikeAdministrativeDeadline(l)) return false;
  const esc = hhmm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const timeRe = new RegExp(`(?:^|\\D)${esc}(?!\\d)|\\bkl\\.?\\s*${esc.replace(":", "[.:]")}\\b`, "i");
  if (!timeRe.test(l)) return false;

  const mentions = findDayMentionsInLine(l);
  const times = findClockTimesInLine(l);
  const timeEntry = times.find((t) => t.hhmm === hhmm);
  if (!timeEntry) return false;
  if (mentions.length === 0) return false;
  if (mentions.length === 1) return mentions[0]!.key === day;
  return dayForTimeOnMultiDayLine(mentions, timeEntry.index) === day;
}

function lineInCupDayHeaderSection(
  corpus: string,
  line: string,
  day: CupWeekendDayKey,
): boolean {
  const normLine = normalizeSpace(line);
  if (!normLine) return false;
  const lines = corpus.replace(/\r\n/g, "\n").split(/\n+/).map(normalizeSpace).filter(Boolean);
  const dayHeader =
    day === "fredag" ? /^fredag\b/i : day === "lørdag" ? /^l[øo]rdag\b/i : /^s[øo]ndag\b/i;
  const anyDayHeader = /^(fredag|l[øo]rdag|s[øo]ndag)\b/i;
  let inSection = false;
  for (const l of lines) {
    if (dayHeader.test(l)) {
      inSection = true;
      if (l === normLine) return true;
      continue;
    }
    if (inSection && anyDayHeader.test(l) && !dayHeader.test(l)) break;
    if (inSection && l === normLine) return true;
  }
  return false;
}

function lineGrantsTimeOwnership(
  corpus: string,
  line: string,
  hhmm: string,
  day: CupWeekendDayKey,
): boolean {
  const l = normalizeSpace(line);
  if (!l) return false;
  const esc = hhmm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const timeRe = new RegExp(`(?:^|\\D)${esc}(?!\\d)|\\bkl\\.?\\s*${esc.replace(":", "[.:]")}\\b`, "i");
  if (!timeRe.test(l)) return false;
  if (
    lineInCupDayHeaderSection(corpus, l, day) &&
    cupWeekendDaysMentionedInLine(l).size === 0
  ) {
    return true;
  }
  return timeOnLineOwnedByCupDay(l, hhmm, day);
}

/**
 * Klokkeslett finnes på en linje som eies av `dayLabel` i korpus (header-seksjon eller narrativ daglinje),
 * eller i strukturerte dag-felt (scheduleByDay highlights/notater for samme dag).
 */
export function clockTimeOwnedByCupDay(
  corpus: string,
  hhmm: string,
  dayLabel: string | null | undefined,
  structuredDayFields?: string | null,
): boolean {
  const key = cupWeekendDayKeyFromLabel(dayLabel);
  if (!key) return true;
  const corpusNorm = corpus.replace(/\r\n/g, "\n");
  for (const line of corpusNorm.split(/\n/)) {
    if (lineGrantsTimeOwnership(corpusNorm, line, hhmm, key)) return true;
  }
  if (structuredDayFields?.trim()) {
    for (const line of structuredDayFields.replace(/\r\n/g, "\n").split(/\n/)) {
      const l = normalizeSpace(line);
      if (!l) continue;
      const esc = hhmm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const timeRe = new RegExp(`(?:^|\\D)${esc}(?!\\d)|\\bkl\\.?\\s*${esc.replace(":", "[.:]")}\\b`, "i");
      if (!timeRe.test(l)) continue;
      const mentions = cupWeekendDaysMentionedInLine(l);
      if (mentions.size === 0) return true;
      if (timeOnLineOwnedByCupDay(l, hhmm, key)) return true;
    }
  }
  return false;
}

export function filterClockTimesOwnedByCupDay(
  times: string[],
  corpus: string,
  dayLabel: string | null | undefined,
  structuredDayFields?: string | null,
): string[] {
  const key = cupWeekendDayKeyFromLabel(dayLabel);
  if (!key) return times;
  return times.filter((t) => clockTimeOwnedByCupDay(corpus, t, dayLabel, structuredDayFields));
}

/**
 * Linjebasert dagseksjon for cup-helger: fra «Fredag …»-overskrift til neste dag,
 * pluss narrativ tekst som nevner ukedagen (uten å kreve overskrift).
 */
export function buildCupWeekendDayBlob(text: string, day: CupWeekendDayKey): string {
  const lines = text
    .split(/\n+/)
    .map((s) => normalizeSpace(s))
    .filter(Boolean);
  const dayHeader =
    day === "fredag" ? /^fredag\b/i : day === "lørdag" ? /^l[øo]rdag\b/i : /^s[øo]ndag\b/i;
  const anyDayHeader = /^(fredag|l[øo]rdag|s[øo]ndag)\b/i;
  const parts: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (dayHeader.test(line)) {
      inSection = true;
      parts.push(line);
      continue;
    }
    if (inSection && anyDayHeader.test(line) && !dayHeader.test(line)) {
      break;
    }
    if (inSection) parts.push(line);
  }
  for (const line of lines) {
    if (lineLooksLikeAdministrativeDeadline(line)) continue;
    if (lineOwnedByCupDay(line, day)) parts.push(line);
    if (/\bved\s+a-sluttspill\b/i.test(line) && day === "søndag") parts.push(line);
  }
  return [...new Set(parts)].join("\n");
}

export function cupWeekendDayKeyFromLabel(label: string | null | undefined): CupWeekendDayKey | null {
  if (!label?.trim()) return null;
  const n = normalizeNorwegianLetters(label);
  if (/\bfredag\b/.test(n)) return "fredag";
  if (/\blordag|lørdag\b/.test(n)) return "lørdag";
  if (/\bsondag|søndag\b/.test(n)) return "søndag";
  return null;
}

function lineIsSundayOnlyPlayoffConditional(line: string): boolean {
  const spaced = normalizeSpace(line);
  const n = normalizeNorwegianLetters(spaced);
  if (/\b(sluttspilltid|endelig\s+sluttspill)\b/.test(n) && /\b(publiseres|arrangor|arrangør|appen)\b/.test(n)) {
    return true;
  }
  const mentionsSunday = /\b(sondag|søndag)\b/.test(spaced) || /\bsondag\b/.test(n);
  if (!mentionsSunday) return false;
  return (
    /\b(sluttspill|a-?sluttspill|finale|semifinale|kamp)\b/.test(n) &&
    /\b(hvis|dersom|eventuell|avhengig|formiddag|ettermiddag|tidlig)\b/.test(n)
  );
}

function lineIsParentOrganizerVolunteerNote(line: string): boolean {
  const n = normalizeNorwegianLetters(normalizeSpace(line));
  if (/\bfrukt\b/.test(n) && /\b(voksne|ansvar|trengs|koordin)\b/.test(n)) return true;
  if (/\b(medisin|medisiner|allergi)\b/.test(n) && /\b(beskjed|meld|gi|informer)\b/.test(n)) return true;
  if (/\btrengs\s+to\s+voksne\b/.test(n) || /\bto\s+voksne\b/.test(n)) return true;
  return false;
}

/**
 * Skal linjen inkluderes som programnotat for ett cup-segment (ikke global admin/Spond/søndag-betingelse).
 */
export function cupProgramNoteLineOwnedByDay(line: string, day: CupWeekendDayKey): boolean {
  const l = normalizeSpace(line);
  if (!l || lineLooksLikeAdministrativeDeadline(l)) return false;
  if (/^nb:\s*/i.test(l)) return false;
  if (lineIsParentOrganizerVolunteerNote(l)) return false;
  if (lineIsSundayOnlyPlayoffConditional(l) && day !== "søndag") return false;

  const mentioned = cupWeekendDaysMentionedInLine(l);
  if (mentioned.size === 0) {
    if (/\b45\s+minutter\s+før\s+hver\s+kamp\b/i.test(l) || /\bm[oø]t\s+45\s+minutter\b/i.test(l)) {
      return day === "lørdag";
    }
    if (/\b(betinget|usikkert|avhenger|ikke\s+endelig|forel[oø]pig)\b/i.test(l)) return day === "søndag";
    return false;
  }
  if (!mentioned.has(day)) return false;
  if (mentioned.size > 1) {
    return [...mentioned].every((d) => d === day);
  }
  return true;
}

export function extractDayBlobFromCorpus(corpus: string, dayLabel: string | null): string {
  const key = cupWeekendDayKeyFromLabel(dayLabel);
  if (key) {
    return buildCupWeekendDayBlob(corpus, key);
  }
  return extractDaySourceSection(corpus, { dayLabel, date: null });
}
