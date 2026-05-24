/**
 * Strukturert innhold for cup-/flerdagssegmenter (highlights, bringItems, notater).
 * Holdes i egen modul for testbarhet uten å laste hele analyze-route.
 */

import { extractDayBlobFromCorpus } from "@/lib/cup-day-source-blob";
import {
  extractCupMatchTimes,
  extractExplicitAttendanceHhmmTimes,
  extractKampAnchoredClockTimes,
  kampAnchoredHhmmInText,
} from "@/lib/cup-match-times";
import {
  buildTimeWindowHighlightLine,
  defaultMatchLabelByIndex,
  extractOrderedHhmmTimesFromText,
  inferTimedActivityLabelFromText,
  inferTimeWindowActivityLabel,
  lineSuggestsTimedMainActivity,
  normKeyTimed,
} from "@/lib/timed-activity-highlights";

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

const BLOB_MASK_DOT = "\uE040";

/** Unngå setningssplit i «kl.» og «18. september» når vi leter opp aktivitet per klokkeslett. */
function maskDotsForSentenceSplit(line: string): string {
  const months =
    "januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember";
  const dateDot = new RegExp(`\\b(\\d{1,2})\\.(\s+)(${months})\\b`, "gi");
  return line
    .replace(/\bkl\./gi, `kl${BLOB_MASK_DOT}`)
    .replace(dateDot, (_m, d, sp, mo) => `${d}${BLOB_MASK_DOT}${sp}${mo}`);
}

function unmaskDotsForSentenceSplit(s: string): string {
  return s.replaceAll(BLOB_MASK_DOT, ".");
}

function sourceFragmentsForHhmmLookup(line: string): string[] {
  const masked = maskDotsForSentenceSplit(line);
  const parts = masked
    .split(/(?<=[.!?])\s+/)
    .map((x) => normalizeSpace(unmaskDotsForSentenceSplit(x)))
    .filter(Boolean);
  return parts.length ? parts : [normalizeSpace(line)];
}

export function cupLineNormKey(s: string): string {
  return normalizeNorwegianLetters(normalizeSpace(s)).toLowerCase();
}

function stripCupNoteLikePrefixes(line: string): string {
  let s = normalizeSpace(line);
  for (let i = 0; i < 5; i++) {
    const next = s
      .replace(/^(notater|husk|frister|huskeliste|viktig|obs|nb)\s*:\s*/i, "")
      .replace(/^(høydepunkter|hoydepunkter|dagens\s+innhold|husk\s*\/\s*ta\s+med)\s*:\s*/i, "")
      .trim();
    if (next === s) break;
    s = next;
  }
  return normalizeSpace(s);
}

/** Fjern genererte portal-etiketter og listeprefix. */
export function stripGeneratedCupNoise(line: string): string {
  let s = normalizeSpace(line.replace(/^[\-•*]\s*/, ""));
  s = stripCupNoteLikePrefixes(s);
  return s;
}

const SHORT_VALID_BRING_ITEMS = new Set([
  "håndkle",
  "handkle",
  "sokker",
  "innesko",
  "shorts",
]);

/** Kjente utstyrspakker — normaliser varianter til én tekst. */
const BRING_CANONICAL: Array<{ test: (s: string) => boolean; label: string }> = [
  {
    test: (s) => /\b(ekstra\s+t-?skjorte|gjerne\s+ekstra\s+t-?skjorte|t-?skjorte)\b/i.test(s),
    label: "ekstra t-skjorte",
  },
  { test: (s) => /\bmatpakke\b/i.test(s), label: "matpakke" },
  { test: (s) => /\bdrikkeflaske\b/i.test(s), label: "drikkeflaske" },
  { test: (s) => /\bovertrekkskl[æa]r\b/i.test(s), label: "overtrekksklær" },
  { test: (s) => /\binnesko\b/i.test(s), label: "innesko" },
  { test: (s) => /\bhåndkle\b/i.test(s), label: "håndkle" },
  { test: (s) => /\bkampdrakt\b/i.test(s), label: "kampdrakt" },
  { test: (s) => /\bleggskinner\b/i.test(s), label: "leggskinner" },
  { test: (s) => /\barbeidshansker\b/i.test(s), label: "arbeidshansker" },
  { test: (s) => /\bgymt[oø]y\b/i.test(s), label: "gymtøy" },
];

function canonicalBringLabel(raw: string): string {
  const t = normalizeSpace(raw.replace(/^(gjerne|gjerne\s+)\s*/i, "").trim());
  for (const { test, label } of BRING_CANONICAL) {
    if (test(t)) return label;
  }
  return t.length ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

export function isBringItemsSignal(text: string): boolean {
  const n = normalizeNorwegianLetters(text);
  return (
    /\b(husk|ta\s+med|utstyr|pakkeliste)\b/i.test(n) ||
    /\b(alle|barna)\s+m[aå]\s+ha\s+med\b/i.test(text)
  );
}

function splitBringItemsFromSignalLine(text: string): string[] {
  const cleaned = normalizeSpace(
    text
      .replace(/^(husk(?:\s*\/\s*ta\s+med)?|ta\s+med|utstyr|pakkeliste)\s*:?\s*/i, "")
      .replace(/^(alle|barna)\s+ma\s+ha\s+med\s*/i, ""),
  );
  if (!cleaned) return [];
  return cleaned
    .split(/\s*(?:,|;|\bog\b)\s*/i)
    .map((s) => normalizeSpace(s.replace(/^[\-•]\s*/, "").replace(/[.!?]+$/g, "")))
    .filter((s) => s.length >= 2);
}

/** Linje som primært er kommaseparert utstyrsliste (uten «Husk»). */
function isPrimarilyEquipmentListLine(text: string): boolean {
  const t = normalizeSpace(text);
  if (t.length < 8 || t.length > 220) return false;
  if (/\b(kamp|oppm[oø]te|kl\.?\s*\d|mellom\s+kl)\b/i.test(t)) return false;
  const equipHits = BRING_CANONICAL.filter((b) => b.test(t)).length;
  return equipHits >= 2 || (equipHits >= 1 && /,/.test(t));
}

function extractBringItemsFromEquipmentListLine(text: string): string[] {
  return splitBringItemsFromSignalLine(
    text.replace(/^[\-•*]\s*/, "").replace(/^(husk|ta\s+med)\s*:?\s*/i, ""),
  )
    .map(canonicalBringLabel)
    .filter((s) => s.length >= 2);
}

export function parseCupTimeWindow(text: string): {
  earliestStart: string;
  latestStart: string;
  label?: string;
  tentative: true;
} | null {
  const m =
    /(?:([^.!?\n]{0,72}?)\s+)?(?:en\s+gang\s+)?mellom\s+(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})\s+og\s+(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})\b/i.exec(
      text,
    );
  if (!m) return null;
  const a = `${String(Number(m[2])).padStart(2, "0")}:${m[3]}`;
  const b = `${String(Number(m[4])).padStart(2, "0")}:${m[5]}`;
  const labelRaw = m[1] ? normalizeSpace(m[1].replace(/[:–\-]+$/g, "")) : "";
  const label =
    labelRaw && !/^mellom$/i.test(labelRaw)
      ? labelRaw
      : undefined;
  return { earliestStart: a, latestStart: b, ...(label ? { label } : {}), tentative: true };
}

function cupWeekdayKeyFromLabel(label: string | null | undefined): "fredag" | "lordag" | "sondag" | null {
  if (!label?.trim()) return null;
  const n = normalizeNorwegianLetters(label);
  if (/\bfri(day)?|fredag\b/.test(n)) return "fredag";
  if (/\blordag|l[øo]rdag|saturday\b/.test(n)) return "lordag";
  if (/\bsondag|s[øo]ndag|sunday\b/.test(n)) return "sondag";
  return null;
}

/**
 * «Mellom … og …» scoped til dag: søndags-sluttspill-vindu skal ikke gi timeWindow på fredag/lørdag.
 */
export function parseCupTimeWindowForDayScoped(
  text: string,
  dayLabel: string | null | undefined,
): ReturnType<typeof parseCupTimeWindow> {
  const key = cupWeekdayKeyFromLabel(dayLabel);
  for (const raw of text.replace(/\r\n/g, "\n").split(/\n/)) {
    const line = normalizeSpace(raw);
    if (!line) continue;
    const tw = parseCupTimeWindow(line);
    if (!tw) continue;
    const n = normalizeNorwegianLetters(line);
    if (key && key !== "sondag") {
      if (/\b(sondagskamp|a-?sluttspill|sluttspill)\b/.test(n) && /\b(sondag|sondags)\b/.test(n)) {
        continue;
      }
      if (/\b(sondagskamp|kamp\s+p[aå]\s+sondag)\b/.test(n)) continue;
      const mentionsThisDay =
        (key === "fredag" && /\bfredag\b/.test(n)) ||
        (key === "lordag" && /\b(lordag|l[øo]rdag)\b/.test(n));
      const mentionsOtherWeekendDay =
        (key === "fredag" && /\b(lordag|l[øo]rdag|sondag|sondags)\b/.test(n)) ||
        (key === "lordag" && /\b(fredag|sondag|sondags)\b/.test(n));
      if (mentionsOtherWeekendDay && !mentionsThisDay) continue;
    }
    return tw;
  }
  return null;
}

export function isNoiseFragment(text: string): boolean {
  const t = normalizeSpace(text);
  if (!t) return true;
  const n = normalizeNorwegianLetters(t).toLowerCase();
  if (
    n === "og" ||
    n === "dagens innhold" ||
    n === "husk / ta med" ||
    n === "husk" ||
    n === "ta med" ||
    n === "notater" ||
    n === "hoydepunkter" ||
    n === "høydepunkter" ||
    /^mellom$/i.test(t) ||
    /^spist\s+litt/i.test(n)
  ) {
    return true;
  }
  if (/^[-–—]\s*overtrekksklær/i.test(t)) return true;
  if (/^[-–—]\s*skriv\s+det\s+i\s+kommentarfeltet/i.test(t)) return true;
  if (/^i\s+(bekkestua|nadderud)\s+/i.test(t)) return true;
  if (/^i\s+[a-zæøå][\w\s.-]{0,36}$/i.test(t)) return true;
  if (t.length <= 2 && !SHORT_VALID_BRING_ITEMS.has(n)) return true;
  return false;
}

/** Foreldre-/koordinatorlinjer som ikke skal være «highlight». */
export function isCupParentPracticalLine(line: string): boolean {
  const t = normalizeSpace(line);
  if (!t || t.length > 520) return false;
  const n = normalizeNorwegianLetters(t);
  if (/\bkommentarfeltet\b/.test(n)) return true;
  if (/\bkjølebag\b/.test(n) || /\bkjolebag\b/.test(n)) return true;
  if (/\bekstra\s+stor\s+bag\b/.test(n)) return true;
  if (/\bén\s+voksen\b/.test(n) && /\btrengs\b/.test(n)) return true;
  if (/\be[nn]\s+voksen\b/.test(n) && /\btrengs\b/.test(n)) return true;
  if (/\bmatpause\b/.test(n) && /\boversikt\b/.test(n)) return true;
  if (/\bforeldre\b/.test(n) && /\b(trengs|må|ma\s+)\b/.test(n) && /\b(oversikt|koordin|mat)\b/.test(n))
    return true;
  return false;
}

function stripLocationOnlyFragment(text: string): string {
  return normalizeSpace(text.replace(/\bi\s+[A-ZÆØÅa-zæøå][^;,.]{2,40}$/i, ""));
}

function highlightLabelIsTimeWindowJunk(label: string): boolean {
  const n = normalizeNorwegianLetters(label);
  return (
    /\bmellom\b/.test(n) ||
    /^og\b/i.test(label.trim()) ||
    /\bførste\s+kamp\s+mellom\b/i.test(n) ||
    /\bsluttspill\b/i.test(n) && /\bmellom\b/.test(n)
  );
}

export function lineLooksLikeAdministrativeDeadline(line: string): boolean {
  const n = normalizeNorwegianLetters(line);
  const adminSignal =
    /\b(spond|svar|frist|senest|pamelding|påmelding|meld\s+fra|gi\s+beskjed|kommentarfelt)\b/.test(n);
  if (!adminSignal) return false;
  const activitySignal =
    /\b(kamp|kampstart|forste\s+kamp|første\s+kamp|andre\s+kamp|oppmote|oppmøte|avreise|oppvarming)\b/.test(
      n,
    );
  return !activitySignal;
}

function cleanupCupHighlight(
  raw: string,
  titleBlocklist: Set<string>,
  suppressTimes: Set<string> | null,
): { time: string; label: string; location?: string } | null {
  const input = normalizeSpace(raw);
  if (!input || isNoiseFragment(input)) return null;
  if (titleBlocklist.has(cupLineNormKey(input))) return null;
  if (parseCupTimeWindow(input)) return null;
  if (isCupParentPracticalLine(input)) return null;
  if (lineLooksLikeAdministrativeDeadline(input)) return null;

  const tm = /(\d{1,2})[.:](\d{2})/.exec(input);
  if (!tm) return null;
  const time = `${String(Number(tm[1])).padStart(2, "0")}:${tm[2]}`;
  if (suppressTimes?.has(time)) return null;

  let label = normalizeSpace(input.replace(tm[0], "").replace(/^[\s:–\-]+|[\s:–\-]+$/g, ""));
  const semicolonParts = input.split(";").map((p) => normalizeSpace(p)).filter(Boolean);
  if (semicolonParts.length >= 2) {
    const right = semicolonParts[semicolonParts.length - 1]!;
    if (!/^\d{1,2}[.:]\d{2}$/.test(right) && !isCupParentPracticalLine(right)) label = right;
  }
  const loc = /\bi\s+([A-ZÆØÅa-zæøå][^;,.]{2,40})$/i.exec(input);
  let location: string | undefined;
  if (loc) location = normalizeSpace(loc[1]);
  label = stripLocationOnlyFragment(label);
  const semantic = inferTimedActivityLabelFromText(input);
  if (semantic === "Oppmøte") label = "Oppmøte";
  if (isCupParentPracticalLine(label)) return null;
  if (!label || label.length < 2 || isNoiseFragment(label) || highlightLabelIsTimeWindowJunk(label)) {
    const inferred =
      inferTimedActivityLabelFromText(input) ??
      (/\boppm[oø]te\b/i.test(input)
        ? "Oppmøte"
        : /\bforste\s+kamp\b/.test(normalizeNorwegianLetters(input))
          ? "Første kamp"
          : /\bandre\s+kamp\b/.test(normalizeNorwegianLetters(input))
            ? "Andre kamp"
            : /\bkamp\b/.test(input)
              ? "Kamp"
              : /\bavreise\b/.test(input)
                ? "Avreise"
                : null);
    if (inferred) label = inferred;
  }
  if (!label || isNoiseFragment(label) || highlightLabelIsTimeWindowJunk(label)) return null;
  if (titleBlocklist.has(cupLineNormKey(label))) return null;
  return { time, label, ...(location ? { location } : {}) };
}

/** Splitt sammenklistrede «Høydepunkter: … Husk: …»-blobber. */
export function expandCupSourceSegments(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  let t = normalizeSpace(raw.replace(/^[\-•*]\s+/gm, ""));
  const pieces: string[] = [];
  const chunks = t.split(/\s+(?=(?:Høydepunkter|Hoydepunkter|Notater|Husk|Frister|Dagens\s+innhold|Husk\s*\/\s*ta\s+med)\s*:)/i);
  for (const chunk of chunks) {
    const c = normalizeSpace(chunk);
    if (!c) continue;
    const hm = /^(?:Høydepunkter|Hoydepunkter|Dagens\s+innhold)\s*:\s*(.+)$/i.exec(c);
    if (hm) {
      for (const bit of hm[1].split(/[;]/).map(normalizeSpace).filter(Boolean)) pieces.push(bit);
      continue;
    }
    const hk = /^Husk\s*:\s*(.+)$/i.exec(c);
    if (hk) {
      for (const bit of hk[1].split(/[;]/).map(normalizeSpace).filter(Boolean)) pieces.push(`Husk: ${bit}`);
      continue;
    }
    const hn = /^Notater\s*:\s*(.+)$/i.exec(c);
    if (hn) {
      for (const bit of hn[1].split(/[;]/).map(normalizeSpace).filter(Boolean)) pieces.push(bit);
      continue;
    }
    const hf = /^Frister\s*:\s*(.+)$/i.exec(c);
    if (hf) {
      for (const bit of hf[1].split(/[;]/).map(normalizeSpace).filter(Boolean)) pieces.push(bit);
      continue;
    }
    const hx = /^Husk\s*\/\s*ta\s+med\s*:\s*(.+)$/i.exec(c);
    if (hx) {
      for (const bit of hx[1].split(/[;]/).map(normalizeSpace).filter(Boolean))
        pieces.push(`Husk: ${bit}`);
      continue;
    }
    for (const ln of c.split(/\n+/).map(normalizeSpace).filter(Boolean)) pieces.push(ln);
  }
  return pieces.map(stripGeneratedCupNoise).filter((s) => s.length > 0);
}

export type CupStructuredDayContent = {
  highlights: string[];
  bringItems: string[];
  logisticsNotes: string[];
  parentTasks: string[];
  generalNotes: string[];
  uncertaintyNotes: string[];
  sourceOrder: string[];
  removedDuplicateHighlights: string[];
  removedFragmentNotes: string[];
  timeWindowCandidates: Array<{
    earliestStart: string;
    latestStart: string;
    label?: string;
    tentative: true;
  }>;
};

function dedupeStableOrder(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const key = cupLineNormKey(x);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  return out;
}

function dedupeSimilarUncertainty(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const k = cupLineNormKey(line);
    let skip = false;
    for (let i = 0; i < out.length; i++) {
      const ok = cupLineNormKey(out[i]!);
      if (ok === k) {
        skip = true;
        break;
      }
      if (ok.length >= 24 && k.length >= 24 && (ok.includes(k) || k.includes(ok))) {
        if (k.length > ok.length) out[i] = line;
        skip = true;
        break;
      }
    }
    if (!skip) out.push(line);
  }
  return out;
}

export function buildCupStructuredDayContent(input: {
  date: string;
  details: string | null;
  highlights: string[];
  notes: string[];
  rememberItems: string[];
  deadlines: string[];
  parentTitle: string;
  childTitle: string;
}): CupStructuredDayContent {
  const titleBlocklist = new Set<string>([
    cupLineNormKey(input.parentTitle),
    cupLineNormKey(input.childTitle),
  ]);

  const bringItems: string[] = [];
  const logisticsNotes: string[] = [];
  const parentTasks: string[] = [];
  const generalNotes: string[] = [];
  const uncertaintyNotes: string[] = [];
  const removedFragmentNotes: string[] = [];
  const timeWindowCandidates: CupStructuredDayContent["timeWindowCandidates"] = [];
  const highlightsRaw: string[] = [];

  const addBring = (raw: string) => {
    const c = canonicalBringLabel(raw);
    if (!c || isNoiseFragment(c)) return;
    bringItems.push(c);
  };

  const collectBringFromLine = (raw: string) => {
    if (isBringItemsSignal(raw)) {
      for (const item of splitBringItemsFromSignalLine(raw)) addBring(item);
      return;
    }
    for (const { test } of BRING_CANONICAL) {
      if (test(raw)) {
        addBring(raw);
        return;
      }
    }
    if (isPrimarilyEquipmentListLine(raw)) {
      for (const item of extractBringItemsFromEquipmentListLine(raw)) addBring(item);
    }
  };

  const fullBlobForWindow = [
    input.details ?? "",
    ...input.highlights,
    ...input.notes,
    ...input.rememberItems,
    ...input.deadlines,
  ].join("\n");
  const dayFromTitle = /\b(fredag|l[øo]rdag|s[øo]ndag)\b/i.exec(input.childTitle)?.[1] ?? null;
  const globalTw = parseCupTimeWindowForDayScoped(fullBlobForWindow, dayFromTitle);
  if (globalTw) {
    timeWindowCandidates.push(globalTw);
    uncertaintyNotes.push(
      `${globalTw.label ?? "Første kamp"} mellom ${globalTw.earliestStart} og ${globalTw.latestStart} (foreløpig)`,
    );
  }

  const suppressHighlightTimes =
    globalTw != null ? new Set([globalTw.earliestStart, globalTw.latestStart]) : null;

  const addNote = (raw: string) => {
    const s = normalizeSpace(raw);
    if (!s || isNoiseFragment(s)) {
      if (s) removedFragmentNotes.push(s);
      return;
    }
    if (/^(høydepunkter|notater|husk|frister|dagens\s+innhold)\s*:/i.test(s)) {
      removedFragmentNotes.push(s);
      return;
    }
    if (isBringItemsSignal(s) || isPrimarilyEquipmentListLine(s)) {
      collectBringFromLine(s);
      return;
    }
    if (isCupParentPracticalLine(s)) {
      parentTasks.push(s);
      return;
    }
    if (globalTw && parseCupTimeWindow(s)) return;
    if (/\b(avhenger|betinget|usikkert|tidspunkt\s+ikke\s+klart|kommer\s+senere|trolig\s+etter|ved\s+B-?sluttspill)\b/i.test(s)) {
      uncertaintyNotes.push(s);
      return;
    }
    const n = normalizeNorwegianLetters(s);
    const venueOrLogistics =
      /\b(hall|arena|skolehall|mellom\s+kampene|oppvarming|rydd|samlet|garderobe|hjemreise)\b/i.test(
        n,
      );
    if (venueOrLogistics && !lineSuggestsTimedMainActivity(s)) {
      logisticsNotes.push(s);
      return;
    }
    generalNotes.push(s);
  };

  const gatherParts: string[] = [];
  for (const x of expandCupSourceSegments(input.details)) gatherParts.push(x);
  for (const h of input.highlights) gatherParts.push(...expandCupSourceSegments(h));
  for (const n of input.notes) gatherParts.push(...expandCupSourceSegments(n));
  for (const r of input.rememberItems) {
    collectBringFromLine(r);
    gatherParts.push(...expandCupSourceSegments(r));
  }
  for (const d of input.deadlines) gatherParts.push(...expandCupSourceSegments(d));

  for (const raw of gatherParts) {
    const s = normalizeSpace(raw);
    if (!s) continue;
    if (globalTw && parseCupTimeWindow(s)) continue;
    const lineTw = parseCupTimeWindow(s);
    if (lineTw && !globalTw) {
      timeWindowCandidates.push(lineTw);
      uncertaintyNotes.push(
        `${lineTw.label ?? "Kamp"} mellom ${lineTw.earliestStart} og ${lineTw.latestStart} (foreløpig)`,
      );
      continue;
    }
    collectBringFromLine(s);
    const parsed = cleanupCupHighlight(s, titleBlocklist, suppressHighlightTimes);
    if (parsed) {
      highlightsRaw.push(
        `${parsed.time} ${parsed.label}${parsed.location ? ` (${parsed.location})` : ""}`.trim(),
      );
      continue;
    }
    if (isBringItemsSignal(s) || isPrimarilyEquipmentListLine(s)) continue;
    addNote(s);
  }

  const bySemanticKey = new Map<string, string>();
  const byTimeKey = new Map<string, string>();
  const removedDuplicateHighlights: string[] = [];
  for (const h of highlightsRaw) {
    const m = /^(\d{2}:\d{2})\s+(.+)$/.exec(h);
    if (!m) continue;
    const label = m[2] || "";
    const activityKey = cupLineNormKey(label.replace(/\([^)]+\)/g, "").trim());
    const semKey = `${input.date}|${m[1]}|${activityKey}`;
    if (bySemanticKey.has(semKey)) {
      removedDuplicateHighlights.push(h);
      continue;
    }
    const timeKey = `${input.date}|${m[1]}`;
    const prev = byTimeKey.get(timeKey);
    if (prev) {
      const prevLab = prev.replace(/^\d{2}:\d{2}\s+/, "");
      const junkPrev = isCupParentPracticalLine(prevLab) || highlightLabelIsTimeWindowJunk(prevLab);
      const junkCur = isCupParentPracticalLine(label) || highlightLabelIsTimeWindowJunk(label);
      if (junkCur && !junkPrev) {
        removedDuplicateHighlights.push(h);
        continue;
      }
      if (junkPrev && !junkCur) {
        const prevAct = cupLineNormKey(prevLab.replace(/\([^)]+\)/g, "").trim());
        bySemanticKey.delete(`${input.date}|${m[1]}|${prevAct}`);
        removedDuplicateHighlights.push(prev);
        byTimeKey.delete(timeKey);
      } else {
        removedDuplicateHighlights.push(h);
        continue;
      }
    }
    bySemanticKey.set(semKey, h);
    byTimeKey.set(timeKey, h);
  }

  const highlightsOrdered = [...bySemanticKey.values()];

  const finalBring = dedupeStableOrder(bringItems);
  const finalLogistics = dedupeStableOrder(logisticsNotes);
  const finalParent = dedupeStableOrder(parentTasks);
  const finalGeneral = dedupeStableOrder(generalNotes);
  const finalUncertainty = dedupeSimilarUncertainty(dedupeStableOrder(uncertaintyNotes));

  const sourceOrder: string[] = [];
  for (const tw of timeWindowCandidates) {
    sourceOrder.push(`timeWindow:${tw.label ?? "kamp"}|${tw.earliestStart}-${tw.latestStart}`);
  }
  for (const h of highlightsOrdered) sourceOrder.push(`highlight:${h}`);
  for (const b of finalBring) sourceOrder.push(`bringItem:${b}`);
  for (const x of finalLogistics) sourceOrder.push(`logistics:${x}`);
  for (const x of finalParent) sourceOrder.push(`parentTask:${x}`);
  for (const x of finalGeneral) sourceOrder.push(`general:${x}`);
  for (const x of finalUncertainty) sourceOrder.push(`uncertainty:${x}`);

  return {
    highlights: highlightsOrdered,
    bringItems: finalBring,
    logisticsNotes: finalLogistics,
    parentTasks: finalParent,
    generalNotes: finalGeneral,
    uncertaintyNotes: finalUncertainty,
    sourceOrder,
    removedDuplicateHighlights,
    removedFragmentNotes: dedupeStableOrder(removedFragmentNotes),
    timeWindowCandidates,
  };
}

export type CupTimingEnrichmentInput = {
  date: string;
  /** `cupLineNormKey` av foreldre- og child-tittel */
  parentTitleNorm: string;
  childTitleNorm: string;
  /** Rå tekst for aktivitetsforståelse (notater, highlights, detaljer) */
  sourceBlob: string;
  attendanceTime: string | null;
  /** Kamp-/programtider i rekkefølge */
  orderedMatchTimes: string[];
  daySegmentStart: string | null;
  daySegmentEnd: string | null;
  timeWindow: { earliestStart: string; latestStart: string } | null;
  timePrecision: "exact" | "start_only" | "date_only" | "time_window";
  tentative: boolean;
  /**
   * `cup` (default): behold kamp-ordinaler og cup-oppførsel.
   * `general`: ikke-cup tekster — bruk aktivitetsinferens per klokkeslett, ikke «Første kamp» som standard.
   */
  activityHighlightStyle?: "cup" | "general";
};

function hhmmToMinutesLocal(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function minutesToHhmmLocal(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function shiftHhmmLocal(hhmm: string, delta: number): string | null {
  const m = hhmmToMinutesLocal(hhmm);
  if (m == null) return null;
  return minutesToHhmmLocal(m + delta);
}

function parseAttendanceOffsetForEachMatch(text: string): number | null {
  const n = normalizeNorwegianLetters(text);
  const m =
    /\b(?:oppm[oø]te|m[oø]t)\b[^.!?\n]{0,70}?(\d{1,3})\s*min(?:utter)?\s*f[øo]r[^.!?\n]{0,30}?\b(?:hver|alle)\s+kamp\b/i.exec(
      n,
    ) ||
    /\b(?:hver|alle)\s+kamp\b[^.!?\n]{0,70}?(\d{1,3})\s*min(?:utter)?\s*f[øo]r\b/i.exec(n);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 && v <= 180 ? v : null;
}

function ordinalAttendanceLabel(
  indexZeroBased: number,
  totalMatches: number,
  style: "cup" | "general",
): string {
  if (style === "general") return "Oppmøte";
  if (totalMatches <= 1) return "Oppmøte";
  const kamp = defaultMatchLabelByIndex(indexZeroBased).toLowerCase();
  return `Oppmøte før ${kamp}`;
}

function isOrdinalAttendanceLabel(label: string): boolean {
  return /^Oppmøte\s+før\s+/i.test(label.trim());
}

function highlightCoversTime(list: string[], hhmm: string): boolean {
  for (const h of list) {
    if (h.startsWith(`${hhmm} `)) return true;
    if (h.startsWith(`${hhmm}–`) || h.startsWith(`${hhmm}-`)) return true;
    const m = /^(\d{2}:\d{2})[–-](\d{2}:\d{2})\s/.exec(h);
    if (m && m[1]! <= hhmm && hhmm <= m[2]!) return true;
  }
  return false;
}

function isTitleLikeHighlightLine(line: string, titleBlock: Set<string>): boolean {
  const core = line.replace(/\s*\(foreløpig\)\s*$/i, "").trim();
  const noTime = core.replace(/^\d{2}:\d{2}(?:[–-]\d{2}:\d{2})?\s+/, "").trim();
  if (!noTime) return false;
  return titleBlock.has(cupLineNormKey(noTime)) || titleBlock.has(normKeyTimed(noTime));
}

function highlightIsJunkAtWindowEdge(line: string, edge: Set<string>): boolean {
  const m = /^(\d{2}:\d{2})\s+(.+)$/.exec(line);
  if (!m || !edge.has(m[1]!)) return false;
  const rest = (m[2] || "").trim();
  if (highlightLabelIsTimeWindowJunk(rest)) return true;
  if (/^og\b/i.test(rest)) return true;
  if (/\bforel[øo]pig\b/i.test(rest) && rest.length < 24) return true;
  return false;
}

/**
 * Klokkeslett fra «HH:MM …»-highlights som kan være kamp (reserve når kamplisten ble tom).
 * Utelater linjer som tydelig bare beskriver oppmøte, med mindre samme klokkeslett er kamp-forankret i blob.
 */
function uniqueSortedClocksFromHighlights(
  list: string[],
  explicitAttendanceTimes: string[],
  kampClocksInBlob: Set<string>,
): string[] {
  const out: string[] = [];
  const maxAttMin =
    explicitAttendanceTimes.length > 0
      ? Math.max(...explicitAttendanceTimes.map((x) => hhmmToMinutesLocal(x) ?? -1))
      : null;
  for (const h of list) {
    const m = /^(\d{2}:\d{2})\s+(.+)$/.exec(h);
    if (!m) continue;
    const t = m[1]!;
    const rest = (m[2] ?? "").trim();
    if (explicitAttendanceTimes.includes(t)) continue;
    if (/\boppm[oø]te\b/i.test(rest) && !kampClocksInBlob.has(t)) {
      const tm = hhmmToMinutesLocal(t);
      if (tm == null) continue;
      if (maxAttMin == null || tm <= maxAttMin) continue;
    }
    if (!out.includes(t)) out.push(t);
  }
  return out.sort((a, b) => hhmmToMinutesLocal(a)! - hhmmToMinutesLocal(b)!);
}

/** Modell-/portal-highlights der kampstart er feilmerket som oppmøte på samme klokkeslett. */
export function relabelOppmoteHighlightsAtKampTimes(
  highlights: string[],
  corpusBlob: string,
  dayLabel?: string | null,
): string[] {
  const scoped =
    dayLabel && corpusBlob.trim()
      ? extractDayBlobFromCorpus(corpusBlob, dayLabel).trim() || corpusBlob
      : corpusBlob;
  const probe = `${scoped}\n${highlights.join("\n")}`;
  const matchTimes = new Set([
    ...extractCupMatchTimes(probe),
    ...extractCupMatchTimes(corpusBlob),
  ]);
  if (matchTimes.size === 0) return highlights;
  return highlights.map((h) => {
    const m = /^(\d{1,2}):(\d{2})\s+oppm[oø]te\b/i.exec(normalizeSpace(h));
    if (!m) return h;
    const t = `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
    if (!matchTimes.has(t)) return h;
    return `${t} Første kamp`;
  });
}

/**
 * Beriker strukturerte highlights med anker-tider fra kalender-/blob-resolving,
 * uten å bruke event-tittel som highlight-label.
 */
export function enrichCupStructuredContentWithResolvedTiming(
  content: CupStructuredDayContent,
  enrichment: CupTimingEnrichmentInput,
): CupStructuredDayContent {
  const highlightStyle = enrichment.activityHighlightStyle ?? "cup";
  const titleBlock = new Set(
    [enrichment.parentTitleNorm, enrichment.childTitleNorm].filter((x) => x && x.length > 0),
  );
  const blob = enrichment.sourceBlob;

  function bestSourceLineForHhmm(blobText: string, hhmm: string): string | null {
    for (const raw of blobText.split(/\n+/).map(normalizeSpace).filter(Boolean)) {
      for (const frag of sourceFragmentsForHhmmLookup(raw)) {
        if (extractOrderedHhmmTimesFromText(frag).includes(hhmm)) return frag;
      }
    }
    return null;
  }

  let highlights = content.highlights.filter((h) => !isTitleLikeHighlightLine(h, titleBlock));
  let logisticsNotes = [...content.logisticsNotes];
  let generalNotes = [...content.generalNotes];

  const window = enrichment.timeWindow;
  if (window && enrichment.timePrecision === "time_window") {
    highlights = highlights.map((h) => {
      const t = normalizeSpace(h);
      if (!t || /\d{1,2}:\d{2}\s*[-–—\u2212]\s*\d{1,2}:\d{2}/.test(t)) return h;
      const m = /^(\d{2}:\d{2})\s+(.+)$/.exec(t);
      if (!m) return h;
      if (m[1] !== window.earliestStart) return h;
      if (/^oppm[oø]te\b/i.test((m[2] ?? "").trim())) return h;
      return `${window.earliestStart}–${window.latestStart} ${(m[2] ?? "").trim()}`;
    });

    const label = inferTimeWindowActivityLabel(blob);
    const line = buildTimeWindowHighlightLine({
      earliest: window.earliestStart,
      latest: window.latestStart,
      label,
      tentative: enrichment.tentative,
    });
    const hasWindow = highlights.some(
      (h) =>
        h.includes(`${window.earliestStart}–${window.latestStart}`) ||
        h.includes(`${window.earliestStart}-${window.latestStart}`),
    );
    if (!hasWindow) highlights.unshift(line);

    const edge = new Set([window.earliestStart, window.latestStart]);
    highlights = highlights.filter((h) => !highlightIsJunkAtWindowEdge(h, edge));
  }

  const suppressTimes =
    window && enrichment.timePrecision === "time_window"
      ? new Set([window.earliestStart, window.latestStart])
      : null;

  const deferConfirmedMatchHighlights =
    enrichment.tentative && enrichment.timePrecision === "date_only";

  const explicitAttendanceTimes = [...extractExplicitAttendanceHhmmTimes(blob)];
  const extractedMatches = deferConfirmedMatchHighlights ? [] : extractCupMatchTimes(blob);
  const kampAnchored = deferConfirmedMatchHighlights ? [] : extractKampAnchoredClockTimes(blob);
  const fromRoute = enrichment.orderedMatchTimes;
  /**
   * Når ruta allerede har kamptider for denne dagen: stol på den listen alene.
   * (Å slå inn kampAnchored fra hele blobben kan trekke inn lørdagstider når global ukeplan er med.)
   */
  const mergedMatchClocks = deferConfirmedMatchHighlights
    ? []
    : fromRoute.length > 0
      ? [...fromRoute].sort((a, b) => hhmmToMinutesLocal(a)! - hhmmToMinutesLocal(b)!)
      : [...new Set([...extractedMatches, ...kampAnchored])].sort(
          (a, b) => hhmmToMinutesLocal(a)! - hhmmToMinutesLocal(b)!,
        );
  const suppressedFiltered = mergedMatchClocks.filter(
    (t) => !suppressTimes?.has(t) && !explicitAttendanceTimes.includes(t),
  );

  highlights = highlights.filter((h) => {
    const m = /^(\d{2}:\d{2})\s+(.+)$/.exec(h);
    if (!m) return true;
    const merged = `${m[1]} ${m[2]}`;
    return !lineLooksLikeAdministrativeDeadline(merged);
  });

  const clocksFromHighlights = uniqueSortedClocksFromHighlights(
    highlights,
    explicitAttendanceTimes,
    kampAnchoredHhmmInText(blob),
  );
  const matchClocksOrdered = (
    fromRoute.length > 0
      ? [...fromRoute]
      : [...new Set([...suppressedFiltered, ...clocksFromHighlights])]
  )
    .filter((t) => !explicitAttendanceTimes.includes(t))
    .sort((a, b) => hhmmToMinutesLocal(a)! - hhmmToMinutesLocal(b)!);

  /** Kamprad-label: aldri global «Oppmøte» fra hele blobben for én kamptid (cup). */
  function matchRowLabelForIndex(i: number): string {
    if (highlightStyle === "general") {
      const t = matchClocksOrdered[i]!;
      const lineHit = bestSourceLineForHhmm(blob, t);
      if (lineHit) {
        const inf = inferTimedActivityLabelFromText(lineHit);
        if (inf) return inf;
      }
      if (matchClocksOrdered.length === 1) {
        const infAll = inferTimedActivityLabelFromText(blob);
        if (infAll) return infAll;
      }
      return "Aktivitet";
    }
    if (matchClocksOrdered.length !== 1) return defaultMatchLabelByIndex(i);
    const inferred = inferTimedActivityLabelFromText(blob);
    if (
      !inferred ||
      inferred === "Oppmøte" ||
      inferred === "Møte" ||
      inferred === "Samling" ||
      inferred === "Ankomst" ||
      inferred === "Kamp" ||
      inferred === "Kampstart"
    ) {
      return defaultMatchLabelByIndex(0);
    }
    return inferred;
  }

  const timeLabelByMatch = new Map<string, string>();
  for (let i = 0; i < matchClocksOrdered.length; i++) {
    const t = matchClocksOrdered[i]!;
    timeLabelByMatch.set(t, matchRowLabelForIndex(i));
  }

  function labelForMatchClock(time: string): string | undefined {
    const idx = matchClocksOrdered.indexOf(time);
    if (idx < 0) return undefined;
    return timeLabelByMatch.get(time) ?? matchRowLabelForIndex(idx);
  }

  highlights = highlights.map((h) => {
    const m = /^(\d{2}:\d{2})\s+(.+)$/.exec(h);
    if (!m) return h;
    const time = m[1]!;
    const label = (m[2] ?? "").trim();
    const n = normalizeNorwegianLetters(label);
    const genericMatchLabel = /^(kamp|kampstart)(\s+kl\.?)?$/.test(n);
    const kampClocksFromBlob = kampAnchoredHhmmInText(blob);
    const wrongAttendanceOnMatchTime =
      /^oppm[oø]te\b/i.test(label) &&
      (kampClocksFromBlob.has(time) ||
        fromRoute.includes(time) ||
        matchClocksOrdered.includes(time) ||
        !explicitAttendanceTimes.includes(time));
    if (wrongAttendanceOnMatchTime) {
      const target = labelForMatchClock(time) ?? defaultMatchLabelByIndex(0);
      return `${time} ${target}`;
    }
    const target = labelForMatchClock(time);
    if (!target) return h;
    if (genericMatchLabel) return `${time} ${target}`;
    return h;
  });

  for (let i = 0; i < matchClocksOrdered.length; i++) {
    const t = matchClocksOrdered[i]!;
    if (highlightCoversTime(highlights, t)) continue;
    const label = timeLabelByMatch.get(t) ?? matchRowLabelForIndex(i);
    if (!label || titleBlock.has(normKeyTimed(label))) continue;
    highlights.push(`${t} ${label}`);
  }

  const perMatchOffset = parseAttendanceOffsetForEachMatch(blob);
  if (perMatchOffset != null && matchClocksOrdered.length > 0) {
    for (let i = 0; i < matchClocksOrdered.length; i++) {
      const t = matchClocksOrdered[i]!;
      const attPerMatch = shiftHhmmLocal(t, -perMatchOffset);
      if (!attPerMatch || highlightCoversTime(highlights, attPerMatch)) continue;
      highlights.push(
        `${attPerMatch} ${ordinalAttendanceLabel(i, matchClocksOrdered.length, highlightStyle)}`,
      );
    }
  }

  if (explicitAttendanceTimes.length > 0) {
    highlights = highlights.map((h) => {
      const m = /^(\d{2}:\d{2})\s+(.+)$/.exec(h);
      if (!m) return h;
      if (!explicitAttendanceTimes.includes(m[1]!)) return h;
      if (isOrdinalAttendanceLabel(m[2] ?? "")) return h;
      return `${m[1]} Oppmøte`;
    });
    for (const t of explicitAttendanceTimes) {
      if (!highlightCoversTime(highlights, t)) highlights.push(`${t} Oppmøte`);
    }
  }

  const att = enrichment.attendanceTime;
  if (att && /\boppm[oø]te\b/i.test(blob)) {
    highlights = highlights.map((h) => {
      if (!h.startsWith(`${att} `)) return h;
      const current = h.replace(/^\d{2}:\d{2}\s+/, "");
      if (isOrdinalAttendanceLabel(current)) return h;
      return `${att} Oppmøte`;
    });
  }
  if (att && !highlightCoversTime(highlights, att)) {
    const firstMatch = enrichment.orderedMatchTimes[0];
    if (!firstMatch || att !== firstMatch || /\boppm[oø]te\b/i.test(blob)) {
      highlights.push(`${att} Oppmøte`);
    }
  }

  /** Etter oppmøte-normalisering: fiks feilmerket «HH:MM Oppmøte» på kamptid (skal ikke overskrives tilbake). */
  const kampScheduleTimes = new Set(extractCupMatchTimes(blob));
  highlights = highlights.map((h) => {
    const m = /^(\d{2}:\d{2})\s+(.+)$/.exec(h);
    if (!m) return h;
    const time = m[1]!;
    const label = (m[2] ?? "").trim();
    if (!/^oppm[oø]te\b/i.test(label)) return h;
    if (att === time) return h;
    if (kampScheduleTimes.has(time)) {
      const target = labelForMatchClock(time) ?? defaultMatchLabelByIndex(0);
      return `${time} ${target}`;
    }
    if (fromRoute.includes(time) && !explicitAttendanceTimes.includes(time)) {
      const idx = fromRoute.indexOf(time);
      const target =
        labelForMatchClock(time) ?? defaultMatchLabelByIndex(idx >= 0 ? idx : 0);
      return `${time} ${target}`;
    }
    return h;
  });

  const noPointHighlight = !highlights.some((h) => /^\d{2}:\d{2}\s+/.test(h) && !/\d{2}:\d{2}[–-]\d{2}:\d{2}/.test(h));
  if (
    !window &&
    noPointHighlight &&
    enrichment.daySegmentStart &&
    enrichment.timePrecision !== "time_window"
  ) {
    const ds = enrichment.daySegmentStart;
    const matchIdx = matchClocksOrdered.indexOf(ds);
    const label: string | null =
      matchIdx >= 0
        ? highlightStyle === "general"
          ? matchRowLabelForIndex(matchIdx)
          : defaultMatchLabelByIndex(matchIdx)
        : inferTimedActivityLabelFromText(blob);
    if (
      label &&
      !titleBlock.has(normKeyTimed(label)) &&
      !highlightCoversTime(highlights, ds)
    ) {
      highlights.push(`${ds} ${label}`);
    }
  }

  const seenH = new Set<string>();
  highlights = highlights.filter((h) => {
    const k = cupLineNormKey(h);
    if (!k || seenH.has(k)) return false;
    seenH.add(k);
    return true;
  });

  if (enrichment.timePrecision === "date_only" && enrichment.tentative) {
    const twFromBlob = parseCupTimeWindow(blob);
    if (twFromBlob) {
      highlights = highlights.filter((h) => !/^\d{2}:\d{2}/.test(h));
    } else {
      highlights = highlights.filter((h) => !/^\d{2}:\d{2}[–-]\d{2}:\d{2}\s+/.test(h));
    }
  }

  const promoteLabelKeys = new Set<string>();
  for (const h of highlights) {
    const m = /^\d{2}:\d{2}(?:[–-]\d{2}:\d{2})?\s+(.+)$/.exec(h);
    if (m)
      promoteLabelKeys.add(normKeyTimed(m[1]!.replace(/\s*\([^)]+\)\s*$/, "").trim()));
  }

  const stripPromoted = (arr: string[]) =>
    arr.filter((line) => {
      const lab = inferTimedActivityLabelFromText(line);
      if (!lab) return true;
      if (promoteLabelKeys.has(normKeyTimed(lab)) && lineSuggestsTimedMainActivity(line)) return false;
      return true;
    });

  logisticsNotes = stripPromoted(logisticsNotes);
  generalNotes = stripPromoted(generalNotes);

  const sourceOrder: string[] = [];
  for (const tw of content.timeWindowCandidates) {
    sourceOrder.push(`timeWindow:${tw.label ?? "kamp"}|${tw.earliestStart}-${tw.latestStart}`);
  }
  for (const h of highlights) sourceOrder.push(`highlight:${h}`);
  for (const b of content.bringItems) sourceOrder.push(`bringItem:${b}`);
  for (const x of logisticsNotes) sourceOrder.push(`logistics:${x}`);
  for (const x of content.parentTasks) sourceOrder.push(`parentTask:${x}`);
  for (const x of generalNotes) sourceOrder.push(`general:${x}`);
  for (const x of content.uncertaintyNotes) sourceOrder.push(`uncertainty:${x}`);

  return {
    ...content,
    highlights,
    logisticsNotes,
    generalNotes,
    sourceOrder,
  };
}

export type CupFlatNotesInput = Pick<
  CupStructuredDayContent,
  "logisticsNotes" | "generalNotes" | "uncertaintyNotes" | "parentTasks"
>;

/** Flate hendelsesnotater uten «Dagens innhold» / «Husk / ta med»-overskrifter. */
export function formatCupEventNotesFlat(content: CupFlatNotesInput): string | null {
  const blocks: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = stripGeneratedCupNoise(s);
    if (!t || isNoiseFragment(t)) return;
    const k = cupLineNormKey(t);
    if (!k || seen.has(k)) return;
    if (/^(høydepunkter|hoydepunkter|notater|husk|dagens\s+innhold|husk\s*\/\s*ta\s+med)\s*:/i.test(t))
      return;
    seen.add(k);
    blocks.push(t);
  };
  for (const x of content.logisticsNotes) push(x);
  for (const x of content.generalNotes) push(x);
  for (const x of content.parentTasks) push(x);
  for (const x of content.uncertaintyNotes) push(x);
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}
