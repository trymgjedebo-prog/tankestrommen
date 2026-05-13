/**
 * Evidens- og valideringslag for Tankestrøm-analyse.
 *
 * Mål: Foreldreappen får strukturert sporbarhet (kildeutdrag, confidence,
 * confirmed/tentative/unsupported) uten at hele portal-pipeline må skrives om
 * i én omgang. Modellen kan fortsatt returnere scheduleByDay som i dag;
 * denne modulen **utleder** sourceQuote der det er mulig og **flagger** brudd.
 */

import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

export type EvidenceValidationStatus =
  | "confirmed"
  | "tentative"
  | "unsupported"
  | "needs_review";

export interface HighlightEvidenceRecord {
  /** Tekstlinje fra modellen (f.eks. «17:45 Oppmøte»). */
  highlightText: string;
  dayLabel: string | null;
  date: string | null;
  /** Kort utdrag fra kilden som støtter klokkeslett + tolkning, eller null. */
  sourceQuote: string | null;
  /** Litt bredere utdrag (f.eks. flere linjer) for «Kilde»-UI; kan overlappe sourceQuote. */
  sourceSnippet: string | null;
  confidence: number;
  validation: EvidenceValidationStatus;
  /** Menneskelesbar forklaring (UI / debug). */
  reason?: string;
}

export interface AnalysisEvidenceReport {
  schemaVersion: 1;
  /** Samlet råtekst som ble brukt til matching (lengde + første tegn for logging). */
  corpusMeta: { charCount: number; preview: string };
  perDay: Array<{
    dayLabel: string | null;
    date: string | null;
    /** Linjer fra kilden som ble regnet som «denne dagens» seksjon. */
    daySourceSection: string;
    highlights: HighlightEvidenceRecord[];
  }>;
  confirmedFacts: HighlightEvidenceRecord[];
  tentativeFacts: HighlightEvidenceRecord[];
  unsupportedCandidates: Array<{
    highlightText: string;
    dayLabel: string | null;
    reason: string;
  }>;
  questionsForUser: string[];
}

const NB_WEEKDAYS = [
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lordag",
  "lørdag",
  "sondag",
  "søndag",
] as const;

function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

function weekdayKeyFromLabel(label: string | null | undefined): string | null {
  if (!label?.trim()) return null;
  const n = normalizeNorwegianLetters(label);
  for (const w of NB_WEEKDAYS) {
    if (n.includes(w)) return w;
  }
  return null;
}

/** Regex som matcher norsk ukedag i linje (inkl. skrivevarianter). */
function weekdayPatternForKey(key: string): RegExp | null {
  const map: Record<string, RegExp> = {
    mandag: /\bmandag\b/i,
    tirsdag: /\btirsdag\b/i,
    onsdag: /\bonsdag\b/i,
    torsdag: /\btorsdag\b/i,
    fredag: /\bfredag\b/i,
    lordag: /\blørdag\b|\blordag\b/i,
    lørdag: /\blørdag\b|\blordag\b/i,
    sondag: /\bsøndag\b|\bsondag\b/i,
    søndag: /\bsøndag\b|\bsondag\b/i,
  };
  return map[key] ?? null;
}

function lineMentionsWeekdayKey(line: string, key: string): boolean {
  const re = weekdayPatternForKey(key);
  return re ? re.test(line) : false;
}

function weekdaysMentionedInLine(line: string): Set<string> {
  const out = new Set<string>();
  const n = line;
  for (const w of ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"] as const) {
    const re = weekdayPatternForKey(w === "lørdag" ? "lørdag" : w);
    if (re?.test(n)) out.add(w === "lørdag" ? "lørdag" : w);
  }
  const nn = normalizeNorwegianLetters(n);
  if (/\bsondagskamp\b|\bsøndagskamp\b/.test(nn)) out.add("søndag");
  if (/\blordagskamp\b|\blørdagskamp\b/.test(nn)) out.add("lørdag");
  return out;
}

export function buildAnalysisCorpus(result: AIAnalysisResult): string {
  const parts = [result.title ?? "", result.description ?? "", result.extractedText?.raw ?? ""]
    .map((p) => p.replace(/\r\n/g, "\n").trim())
    .filter(Boolean);
  return parts.join("\n\n");
}

/**
 * Grov dag-seksjon: linjer som nevner aktuell ukedag (eller dato-strengen om satt).
 * Brukes til «tid må finnes i riktig dagseksjon» — ikke full semantisk parser.
 */
export function extractDaySourceSection(
  corpus: string,
  day: Pick<DayScheduleEntry, "dayLabel" | "date">,
): string {
  const lines = corpus
    .replace(/\r\n/g, "\n")
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const key = weekdayKeyFromLabel(day.dayLabel);
  const dateHint = day.date?.trim();
  const kept: string[] = [];
  for (const line of lines) {
    if (key && lineMentionsWeekdayKey(line, key)) {
      kept.push(line);
      continue;
    }
    if (dateHint && dateHint.length >= 4 && line.includes(dateHint)) {
      kept.push(line);
    }
  }
  if (kept.length === 0 && key) {
    // Linjer med klokkeslett som også nevner en annen dag kan fortsatt inneholde
    // «fredag kl. …» i samme setning som lørdag — hele korpus som siste utvei.
    return corpus;
  }
  return kept.join("\n");
}

function extractPrimaryHhmm(highlight: string): string | null {
  const lead = /^(\d{1,2}):(\d{2})\b/.exec(normalizeSpace(highlight));
  if (lead) return `${String(Number(lead[1])).padStart(2, "0")}:${lead[2]}`;
  const kl = /\bkl\.?\s*(\d{1,2})[.:](\d{2})\b/i.exec(highlight);
  if (kl) return `${String(Number(kl[1])).padStart(2, "0")}:${kl[2]}`;
  return null;
}

function highlightLabelKind(h: string): "oppmote" | "kamp" | "unknown" {
  const n = normalizeNorwegianLetters(h);
  if (/\boppm[oø]te\b/.test(n)) return "oppmote";
  if (/\bkamp\b/.test(n)) return "kamp";
  return "unknown";
}

function lineSupportsLabelKind(line: string, kind: "oppmote" | "kamp" | "unknown"): boolean {
  const n = normalizeNorwegianLetters(line);
  if (kind === "unknown") return true;
  if (kind === "oppmote") return /\boppm[oø]te\b/.test(n);
  if (kind === "kamp")
    return (
      /\bkamp\b/.test(n) ||
      /\bkampoppsett\b/.test(n) ||
      /\b(f[oø]rste|andre)\s+kamp\b/.test(n) ||
      /\bseriekamp\b/.test(n) ||
      /\bsluttspill\b/.test(n)
    );
  return true;
}

function snippetAround(haystack: string, needle: string, radius = 220): string | null {
  if (!haystack.trim() || !needle.trim()) return null;
  const idx = haystack.indexOf(needle);
  if (idx < 0) return haystack.slice(0, Math.min(haystack.length, radius * 2)).trim() || null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(haystack.length, idx + needle.length + radius);
  return haystack.slice(start, end).trim() || null;
}

function findBestSourceLineForTime(
  corpusLines: string[],
  hhmm: string,
  labelKind: "oppmote" | "kamp" | "unknown",
): string | null {
  const esc = hhmm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const timeRe = new RegExp(`(?:^|\\D)${esc}(?!\\d)|\\bkl\\.?\\s*${esc.replace(":", "[.:]")}\\b`, "i");
  const candidates: string[] = [];
  for (const line of corpusLines) {
    if (!timeRe.test(line)) continue;
    if (!lineSupportsLabelKind(line, labelKind)) continue;
    candidates.push(line);
  }
  if (candidates.length === 0) {
    for (const line of corpusLines) {
      if (timeRe.test(line)) candidates.push(line);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0]!.slice(0, 280);
}

function linesWithTimeAndWeekdayClaims(corpus: string, hhmm: string): Array<{ line: string; days: Set<string> }> {
  const out: Array<{ line: string; days: Set<string> }> = [];
  const esc = hhmm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const timeRe = new RegExp(`(?:^|\\D)${esc}(?!\\d)|\\bkl\\.?\\s*${esc.replace(":", "[.:]")}\\b`, "i");
  for (const line of corpus.replace(/\r\n/g, "\n").split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    if (!timeRe.test(line)) continue;
    out.push({ line, days: weekdaysMentionedInLine(line) });
  }
  return out;
}

function dayBlobTentative(day: DayScheduleEntry): boolean {
  const blob = [day.details ?? "", ...day.notes, ...day.highlights].join(" ");
  const n = normalizeNorwegianLetters(blob);
  return (
    /\bforelopig\b/.test(n) ||
    /\bforeløpig\b/.test(n) ||
    /\bdersom\b/.test(n) ||
    /\b(vi\s+går|går)\s+videre\b/.test(n) ||
    /\bsluttspill\b/.test(n) ||
    /\btbd\b/.test(n) ||
    /\btid\s+kommer\b/.test(n) ||
    /\b(usikkert|usikker)\b/.test(n) ||
    /\b(publiseres|kommer)\s+senere\b/.test(n)
  );
}

function timeSupportedForWeekday(
  corpus: string,
  hhmm: string,
  wantedKey: string | null,
): { ok: boolean; reason: string } {
  if (!wantedKey) return { ok: true, reason: "ingen ukedag å sjekke mot" };
  const hits = linesWithTimeAndWeekdayClaims(corpus, hhmm);
  if (hits.length === 0) return { ok: false, reason: `fant ikke ${hhmm} i kilden` };
  const normalizedWanted =
    wantedKey === "lordag" || wantedKey === "lørdag"
      ? "lørdag"
      : wantedKey === "sondag" || wantedKey === "søndag"
        ? "søndag"
        : wantedKey;
  const supporting = hits.filter((h) => {
    if (h.days.size === 0) return false;
    return (
      h.days.has(normalizedWanted) ||
      (normalizedWanted === "lørdag" && (h.days.has("lørdag") || h.days.has("lordag")))
    );
  });
  if (supporting.length > 0) return { ok: true, reason: "tid funnet på linje som nevner riktig dag" };
  const otherDays = [...new Set([...hits.flatMap((h) => [...h.days])])];
  return {
    ok: false,
    reason: `${hhmm} forekommer i kilden kun sammen med andre dager (${otherDays.join(", ") || "ingen ukedag"}) — ikke som bevis for ${normalizedWanted}`,
  };
}

/**
 * Bygger evidensrapport: sourceQuote, validering og gruppering for Foreldre-app / UI.
 */
export function buildAnalysisEvidenceReport(
  corpus: string,
  result: AIAnalysisResult,
): AnalysisEvidenceReport {
  const c = corpus.replace(/\r\n/g, "\n").trim();
  const lines = c
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const questionsForUser: string[] = [];
  const confirmedFacts: HighlightEvidenceRecord[] = [];
  const tentativeFacts: HighlightEvidenceRecord[] = [];
  const unsupportedCandidates: AnalysisEvidenceReport["unsupportedCandidates"] = [];
  const perDay: AnalysisEvidenceReport["perDay"] = [];

  for (const day of result.scheduleByDay) {
    const daySection = extractDaySourceSection(c, day);
    const daySectionLines = daySection.split(/\n/).map((l) => normalizeSpace(l)).filter(Boolean);
    const dayKey = weekdayKeyFromLabel(day.dayLabel);
    const tentativeDay = dayBlobTentative(day);
    const dayRecords: HighlightEvidenceRecord[] = [];

    for (const h of day.highlights) {
      const highlightText = normalizeSpace(h);
      if (!highlightText) continue;
      const hhmm = extractPrimaryHhmm(highlightText);
      const labelKind = highlightLabelKind(highlightText);
      let sourceQuote: string | null = null;
      let sourceSnippet: string | null = null;
      let validation: EvidenceValidationStatus = "needs_review";
      let confidence = 0.45;
      let reason = "";

      if (hhmm) {
        const inSection = findBestSourceLineForTime(daySectionLines.length ? daySectionLines : lines, hhmm, labelKind);
        sourceQuote = inSection ?? findBestSourceLineForTime(lines, hhmm, labelKind);
        if (sourceQuote) {
          sourceSnippet =
            snippetAround(daySection, sourceQuote) ??
            snippetAround(daySection, hhmm) ??
            snippetAround(c, sourceQuote) ??
            snippetAround(c, hhmm);
        } else if (daySection.includes(hhmm) || c.includes(hhmm)) {
          sourceSnippet = snippetAround(daySection, hhmm) ?? snippetAround(c, hhmm);
        }
        const cross = timeSupportedForWeekday(c, hhmm, dayKey);
        if (!cross.ok) {
          validation = "unsupported";
          confidence = 0.2;
          reason = cross.reason;
          unsupportedCandidates.push({ highlightText, dayLabel: day.dayLabel, reason });
        } else if (
          tentativeDay &&
          !/\bkl\.?\s*\d{1,2}[.:]\d{2}\b/i.test(daySection) &&
          !/\b\d{1,2}:\d{2}\b/.test(daySection)
        ) {
          validation = "tentative";
          confidence = sourceQuote ? 0.55 : 0.35;
          reason =
            "Dagen er merket som foreløpig/usikker i kildetekst; konkret klokkeslett krever eksplisitt oppgitt tid for denne dagen.";
        } else if (sourceQuote && lineSupportsLabelKind(sourceQuote, labelKind)) {
          validation = "confirmed";
          confidence = 0.88;
          reason = "Klokkeslett og type (oppmøte/kamp) funnet i dagens kildeseksjon.";
        } else if (sourceQuote) {
          validation = "needs_review";
          confidence = 0.5;
          reason =
            "Klokkeslett funnet i kilde, men nøkkelord for oppmøte/kamp matcher ikke tydelig — bør verifiseres.";
        } else {
          validation = "unsupported";
          confidence = 0.25;
          reason = "Fant ikke klokkeslettet i den relevante kildeseksjonen.";
          unsupportedCandidates.push({ highlightText, dayLabel: day.dayLabel, reason });
        }
      } else {
        validation = sourceQuote ? "tentative" : "needs_review";
        confidence = sourceQuote ? 0.5 : 0.35;
        reason = hhmm ? "" : "Ingen klokkeslett i highlight — kan ikke verifisere mot timekilder.";
      }

      if (hhmm && tentativeDay && validation === "confirmed" && !/\bkl\.?\s*\d{1,2}[.:]\d{2}\b/i.test(sourceQuote ?? "")) {
        // Ekstra sikring: foreløpig dag skal ikke «låses» uten eksplisitt kl i sitat
        const rel = timeSupportedForWeekday(c, hhmm, dayKey);
        if (rel.ok && dayKey && (dayKey === "søndag" || dayKey === "sondag")) {
          const sundayExplicit =
            /\bsøndag\b.*\bkl\.?\s*\d{1,2}[.:]\d{2}|\bkl\.?\s*\d{1,2}[.:]\d{2}.*\bsøndag\b/i.test(daySection);
          if (!sundayExplicit && dayBlobTentative(day)) {
            validation = "tentative";
            confidence = Math.min(confidence, 0.55);
            reason =
              "Søndag/foreløpig opplegg: tid krever eksplisitt søndagslinje med kl. i kilden for å behandles som endelig.";
          }
        }
      }

      const rec: HighlightEvidenceRecord = {
        highlightText,
        dayLabel: day.dayLabel,
        date: day.date,
        sourceQuote,
        sourceSnippet,
        confidence,
        validation,
        reason: reason || undefined,
      };
      dayRecords.push(rec);
      if (validation === "confirmed") confirmedFacts.push(rec);
      else if (validation === "tentative") tentativeFacts.push(rec);
      else if (validation === "needs_review" && hhmm)
        questionsForUser.push(`Vurder «${highlightText}» (${day.dayLabel ?? "?"}): ${reason || "mangler tydelig kildebevis."}`);
    }

    perDay.push({
      dayLabel: day.dayLabel,
      date: day.date,
      daySourceSection: daySection.slice(0, 8000),
      highlights: dayRecords,
    });
  }

  return {
    schemaVersion: 1,
    corpusMeta: {
      charCount: c.length,
      preview: c.slice(0, 160),
    },
    perDay,
    confirmedFacts,
    tentativeFacts,
    unsupportedCandidates,
    questionsForUser: [...new Set(questionsForUser)],
  };
}
