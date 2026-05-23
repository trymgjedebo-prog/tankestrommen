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

/**
 * Linjebasert dagseksjon for cup-helger: fra «Fredag …»-overskrift til neste dag.
 * Inkluderer også globale linjer som kampoppsett når de nevner dagen.
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

export function extractDayBlobFromCorpus(corpus: string, dayLabel: string | null): string {
  const key = cupWeekendDayKeyFromLabel(dayLabel);
  if (key) {
    return buildCupWeekendDayBlob(corpus, key);
  }
  return extractDaySourceSection(corpus, { dayLabel, date: null });
}
