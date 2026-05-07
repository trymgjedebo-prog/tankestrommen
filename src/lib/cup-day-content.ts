/**
 * Strukturert innhold for cup-/flerdagssegmenter (highlights, bringItems, notater).
 * Holdes i egen modul for testbarhet uten å laste hele analyze-route.
 */

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
];

function canonicalBringLabel(raw: string): string {
  const t = normalizeSpace(raw.replace(/^(gjerne|gjerne\s+)\s*/i, "").trim());
  for (const { test, label } of BRING_CANONICAL) {
    if (test(t)) return label;
  }
  return t.length ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

function isBringItemsSignal(text: string): boolean {
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
  if (isCupParentPracticalLine(label)) return null;
  if (!label || isNoiseFragment(label) || highlightLabelIsTimeWindowJunk(label)) return null;
  if (!label) {
    if (/\boppm[oø]te\b/i.test(input)) label = "Oppmøte";
    else if (/\bforste\s+kamp\b/i.test(normalizeNorwegianLetters(input))) label = "Første kamp";
    else if (/\bandre\s+kamp\b/i.test(normalizeNorwegianLetters(input))) label = "Andre kamp";
    else if (/\bkamp\b/i.test(input)) label = "Kamp";
    else if (/\bavreise\b/i.test(input)) label = "Avreise";
  }
  if (!label || titleBlocklist.has(cupLineNormKey(label))) return null;
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
  const globalTw = parseCupTimeWindow(fullBlobForWindow);
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
    if (/\b(hall|arena|skolehall|mellom\s+kampene|oppvarming|rydd|samlet|garderobe|hjemreise)\b/i.test(s)) {
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
