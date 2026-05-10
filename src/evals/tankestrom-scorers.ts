import type { RegressionPortalBundle } from "@/lib/tankestrom-regression-fixture-runner";
import {
  type DayKey,
  effectiveEvalShape,
  type TankestromExpected,
  type TimePrecision,
} from "@/evals/tankestrom-expected";

export type ScorerResult = {
  score: number;
  /** Kritiske avvik som påvirker score. */
  failures: string[];
  /** Stil / forventet formulering — påvirker ikke score. */
  styleWarnings?: string[];
  /** Semantisk treff med annen ordlyd — påvirker ikke score. */
  semanticNearMisses?: string[];
};

function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

function childByDay(bundle: RegressionPortalBundle, day: DayKey) {
  return bundle.children.find((c) => c.day === day);
}

const ENGLISH_WEEKDAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const YEAR_IN_TITLE = /\b20\d{2}\b/;
const CLASS_CODE = /\b[jJ]\d{3,4}\b|\b[gG]\d{1,2}\b|\b[uU]\d{1,2}\b/;
const TITLE_TRAILING_LONE_NUMBER = /[–-]\s*\d{1,2}\s*$/;

function weekdayInTitlePattern(day: DayKey): RegExp {
  if (day === "fredag") return /\bfredag\b/i;
  if (day === "lørdag") return /\blørdag\b/i;
  return /\bsøndag\b/i;
}

function titleStructuralViolations(title: string): string[] {
  const v: string[] = [];
  if (/\b\d{1,2}[./]\d{1,2}\b/.test(title)) v.push("datotoken");
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(title)) v.push("ISO-dato");
  if (YEAR_IN_TITLE.test(title)) v.push("årstall");
  if (CLASS_CODE.test(title)) v.push("klassekode");
  if (ENGLISH_WEEKDAY.test(title)) v.push("engelsk ukedag");
  if (TITLE_TRAILING_LONE_NUMBER.test(title.trim())) v.push("isolert tall etter bindestrek");
  return v;
}

/** Undertrykk støy-flagg som allerede er forventet i canonical childTitles (f.eks. år i turnstevne). */
function titleStructuralViolationsRelative(title: string, expectedTitle: string | undefined): string[] {
  const v = titleStructuralViolations(title);
  if (!expectedTitle) return v;
  return v.filter((viol) => {
    if (viol === "årstall" && YEAR_IN_TITLE.test(expectedTitle)) return false;
    if (viol === "klassekode" && CLASS_CODE.test(expectedTitle)) return false;
    if (viol === "datotoken" && /\b\d{1,2}[./]\d{1,2}\b/.test(expectedTitle)) return false;
    if (viol === "ISO-dato" && /\b\d{4}-\d{2}-\d{2}\b/.test(expectedTitle)) return false;
    if (viol === "engelsk ukedag" && ENGLISH_WEEKDAY.test(expectedTitle)) return false;
    if (viol === "isolert tall etter bindestrek" && TITLE_TRAILING_LONE_NUMBER.test(expectedTitle.trim())) {
      return false;
    }
    return true;
  });
}

function titleHasCorrectNorwegianWeekday(title: string, day: DayKey): boolean {
  return weekdayInTitlePattern(day).test(title);
}

function extractExpectedTitleCore(expectedTitle: string): string {
  const parts = expectedTitle.split(/[–-]/).map((s) => s.trim());
  return (parts[0] ?? expectedTitle).trim();
}

function firstTitleSegment(actualTitle: string): string {
  return (actualTitle.split(/[–-]/)[0] ?? actualTitle).trim();
}

function acceptableTitleVariant(actual: string, expected: string, day: DayKey): boolean {
  if (titleStructuralViolations(actual).length > 0) return false;
  if (!titleHasCorrectNorwegianWeekday(actual, day)) return false;
  const expCore = extractExpectedCoreNorm(expected);
  const actFirst = normalizeNorwegianLetters(firstTitleSegment(actual));
  if (!actFirst.startsWith(expCore)) return false;
  return true;
}

function extractExpectedCoreNorm(expectedTitle: string): string {
  return normalizeNorwegianLetters(extractExpectedTitleCore(expectedTitle));
}

/** Kritiske tittelstrukturer: dato, år, klasse, feil språk, manglende riktig ukedag. */
export function scoreCleanTitlesCritical(
  bundle: RegressionPortalBundle,
  expected: TankestromExpected,
): ScorerResult {
  const failures: string[] = [];
  bundle.children.forEach((c, i) => {
    const expTitle = expected.childTitles[i];
    const bad = titleStructuralViolationsRelative(c.title, expTitle);
    if (bad.length > 0) {
      failures.push(`[${c.day}] Strukturell tittelfeil (${bad.join(", ")}): "${c.title}"`);
    }
    if (!titleHasCorrectNorwegianWeekday(c.title, c.day)) {
      failures.push(`[${c.day}] Tittel mangler korrekt norsk ukedag for kortet: "${c.title}"`);
    }
  });
  return { score: failures.length === 0 ? 1 : 0, failures };
}

/**
 * Forventet formulering (expected.childTitles). Eksakt treff eller akseptabel kjernevariant
 * (f.eks. «Høstcupen håndball – fredag» når forventet «Høstcupen – fredag»).
 */
export function scoreTitleMatchesExpectedStyle(
  bundle: RegressionPortalBundle,
  expected: TankestromExpected,
): ScorerResult {
  const failures: string[] = [];
  const styleWarnings: string[] = [];
  const actual = bundle.children.map((c) => c.title);
  if (actual.length !== expected.childTitles.length) {
    failures.push(`Antall titler stemmer ikke: forventet ${expected.childTitles.length}, fikk ${actual.length}`);
    return { score: 0, failures };
  }
  let ok = 0;
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const e = expected.childTitles[i];
    const day = bundle.children[i].day;
    if (a === e) {
      ok++;
      continue;
    }
    if (acceptableTitleVariant(a, e, day)) {
      ok++;
      styleWarnings.push(
        `childTitles[${i}] stilavvik (akseptert kjerne): forventet "${e}", fikk "${a}"`,
      );
      continue;
    }
    failures.push(`childTitles[${i}]: forventet "${e}", fikk "${a}" (ikke godkjent variant)`);
  }
  return {
    score: ok === actual.length ? 1 : 0,
    failures,
    styleWarnings: styleWarnings.length ? styleWarnings : undefined,
  };
}

function looksLikeDeadlineHighlight(text: string): boolean {
  const n = normalizeNorwegianLetters(text);
  return /\b(spond|svar|frist|senest|pamelding|påmelding|om\s+barnet\s+kan\s+delta)\b/.test(n);
}

function classifyHighlightKind(text: string): "oppmote" | "kamp" | "annet" {
  const n = normalizeNorwegianLetters(text);
  if (/\boppm[oø]te\b/.test(n)) return "oppmote";
  if (/\b(kamp|kamper|match)\b/.test(n) || /sluttspillkamp/.test(n)) return "kamp";
  return "annet";
}

function extractTimesFromHighlight(text: string): string[] {
  const re = /\b(\d{1,2}):(\d{2})\b/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(`${String(parseInt(m[1], 10)).padStart(2, "0")}:${m[2]}`);
  }
  return out;
}

function ordinalHints(text: string): { første: boolean; andre: boolean; tredje: boolean } {
  const n = normalizeNorwegianLetters(text);
  return {
    første: /\bf[oø]rste\b/.test(n),
    andre: /\bandre\b/.test(n) || /\b2\.\s*kamp\b/.test(n),
    tredje: /\btredje\b/.test(n) || /\b3\.\s*kamp\b/.test(n),
  };
}

function highlightSemanticAccept(required: string, actual: string): boolean {
  if (looksLikeDeadlineHighlight(actual)) return false;

  const reqKind = classifyHighlightKind(required);
  const actKind = classifyHighlightKind(actual);
  const reqLow = normalizeNorwegianLetters(required);
  const actLow = normalizeNorwegianLetters(actual);

  const timesR = extractTimesFromHighlight(required);
  const timesA = extractTimesFromHighlight(actual);
  const primaryR = timesR[0] ?? null;

  if (primaryR !== null && !timesA.includes(primaryR)) return false;

  const reqO = ordinalHints(required);
  const actO = ordinalHints(actual);

  if (reqKind === "oppmote") {
    if (actKind !== "oppmote") return false;
    if (/for\s+andre/.test(reqLow) && !/andre/.test(actLow)) return false;
    if (/for\s+forste/.test(reqLow) && /andre/.test(actLow) && !/forste/.test(actLow)) return false;
  } else if (reqKind === "kamp") {
    if (actKind !== "kamp") return false;
    if (reqO.andre) {
      if (!actO.andre) return false;
    } else if (reqO.første) {
      if (actO.andre && !actO.første) return false;
    }
    if (reqO.tredje && !actO.tredje) return false;
  } else {
    if (primaryR !== null && !timesA.includes(primaryR)) return false;
  }

  return true;
}

function findSemanticHighlightMatch(
  required: string,
  actualList: string[],
): { matched: string; exact: boolean } | null {
  if (actualList.includes(required)) {
    return { matched: required, exact: true };
  }
  for (const act of actualList) {
    if (highlightSemanticAccept(required, act)) {
      return { matched: act, exact: false };
    }
  }
  return null;
}

export function scoreParentCountCorrect(
  bundle: RegressionPortalBundle,
  expected: TankestromExpected,
): ScorerResult {
  if (effectiveEvalShape(expected) === "single_event") {
    const ok = bundle.parentTitle.trim().length > 0 && bundle.children.length > 0;
    return {
      score: ok ? 1 : 0,
      failures: ok
        ? []
        : [
            `single_event: forventet ikke-tom parentTitle og minst ett barn, fikk parentTitle="${bundle.parentTitle}" childCount=${bundle.children.length}`,
          ],
    };
  }
  const ok = expected.parentCount === 1 && bundle.parentTitle.length > 0;
  return {
    score: ok ? 1 : 0,
    failures: ok
      ? []
      : [`Forventet parentCount=${expected.parentCount} med ikke-tom tittel, fikk parentTitle="${bundle.parentTitle}"`],
  };
}

export function scoreChildCountCorrect(
  bundle: RegressionPortalBundle,
  expected: TankestromExpected,
): ScorerResult {
  const n = bundle.children.length;
  const ok = n === expected.childCount;
  return {
    score: ok ? 1 : 0,
    failures: ok ? [] : [`Forventet childCount=${expected.childCount}, fikk ${n}`],
  };
}

export function scoreHighlightsCorrect(bundle: RegressionPortalBundle, expected: TankestromExpected): ScorerResult {
  const failures: string[] = [];
  const semanticNearMisses: string[] = [];
  let pass = 0;
  let total = 0;

  for (const [day, required] of Object.entries(expected.highlightsByDay) as [DayKey, string[]][]) {
    if (!required?.length) continue;
    const child = childByDay(bundle, day);
    if (!child) {
      for (const _ of required) {
        total++;
        failures.push(`Mangler dag ${day} for påkrevde highlights`);
      }
      continue;
    }
    for (const h of required) {
      total++;
      const hit = findSemanticHighlightMatch(h, child.highlights);
      if (hit) {
        pass++;
        if (!hit.exact) {
          semanticNearMisses.push(
            `[${day}] Semantisk treff, annen formulering: forventet "${h}" → "${hit.matched}"`,
          );
        }
      } else {
        failures.push(`[${day}] Mangler highlight (semantisk): "${h}" (har: ${JSON.stringify(child.highlights)})`);
      }
    }
  }

  for (const rule of expected.forbiddenHighlights) {
    total++;
    let violated = false;
    const targets = rule.day ? bundle.children.filter((c) => c.day === rule.day) : bundle.children;
    for (const c of targets) {
      for (const h of c.highlights) {
        if (h.includes(rule.includes)) {
          violated = true;
          failures.push(`[${c.day}] Forbudt highlight-innhold "${rule.includes}" funnet i "${h}"`);
        }
      }
    }
    if (!violated) pass++;
  }

  if (total === 0) return { score: 1, failures: [] };
  return {
    score: pass / total,
    failures,
    semanticNearMisses: semanticNearMisses.length ? semanticNearMisses : undefined,
  };
}

export function scoreNoDuplicateDays(bundle: RegressionPortalBundle): ScorerResult {
  const keys = bundle.children.map((c) => `${c.date ?? "none"}|${normalizeNorwegianLetters(c.day)}`);
  const ok = new Set(keys).size === keys.length;
  return {
    score: ok ? 1 : 0,
    failures: ok ? [] : [`Duplikat dag-nøkkel: ${keys.join(", ")}`],
  };
}

export function scoreNoEventTitleAsHighlight(bundle: RegressionPortalBundle): ScorerResult {
  const failures: string[] = [];
  for (const c of bundle.children) {
    for (const h of c.highlights) {
      const label = h.replace(/^\d{2}:\d{2}(?:[–-]\d{2}:\d{2})?\s+/, "").trim();
      if (normalizeNorwegianLetters(label) === normalizeNorwegianLetters(c.title)) {
        failures.push(`[${c.day}] Highlight-label er lik barnetittel: "${label}"`);
      }
      if (normalizeNorwegianLetters(label) === normalizeNorwegianLetters(bundle.parentTitle)) {
        failures.push(`[${c.day}] Highlight-label er lik foreldretittel: "${label}"`);
      }
    }
  }
  return { score: failures.length === 0 ? 1 : 0, failures };
}

export function scoreNoStructureFallbackInNotes(bundle: RegressionPortalBundle): ScorerResult {
  const failures: string[] = [];
  for (const c of bundle.children) {
    const note = c.notes ?? "";
    /** Kun «Høydepunkter:»-prefiks er sikker pipeline-/serialiseringslekkasje; «Dagens innhold» brukes uten kolon i koden, og modeller skriver ofte «Dagens innhold:» som vanlig seksjonstittel. */
    if (/(?:^|\n)\s*(?:Høydepunkter|Hoydepunkter)\s*:/i.test(note)) {
      failures.push(`[${c.day}] Struktur-fallback i notes: ${JSON.stringify(note.slice(0, 120))}`);
    }
  }
  return { score: failures.length === 0 ? 1 : 0, failures };
}

export function scoreCorrectTimePrecision(
  bundle: RegressionPortalBundle,
  expected: TankestromExpected,
): ScorerResult {
  const failures: string[] = [];
  const checks: boolean[] = [];
  for (const [day, prec] of Object.entries(expected.timePrecisionByDay) as [DayKey, TimePrecision][]) {
    if (prec === undefined) continue;
    const child = childByDay(bundle, day);
    if (!child) {
      failures.push(`timePrecision: mangler ${day}`);
      checks.push(false);
      continue;
    }
    const ok = child.timePrecision === prec;
    checks.push(ok);
    if (!ok) failures.push(`[${day}] timePrecision forventet "${prec}", fikk "${child.timePrecision}"`);
  }
  if (checks.length === 0) return { score: 1, failures: [] };
  return { score: checks.filter(Boolean).length / checks.length, failures };
}

export function scoreTentativeCorrect(bundle: RegressionPortalBundle, expected: TankestromExpected): ScorerResult {
  const failures: string[] = [];
  const checks: boolean[] = [];
  for (const [day, want] of Object.entries(expected.tentativeDays) as [DayKey, boolean][]) {
    if (want === undefined) continue;
    const child = childByDay(bundle, day);
    if (!child) {
      failures.push(`tentative: mangler ${day}`);
      checks.push(false);
      continue;
    }
    const ok = child.tentative === want;
    checks.push(ok);
    if (!ok) failures.push(`[${day}] tentative forventet ${want}, fikk ${child.tentative}`);
  }
  if (checks.length === 0) return { score: 1, failures: [] };
  return { score: checks.filter(Boolean).length / checks.length, failures };
}

export function scoreBringItemsCorrect(bundle: RegressionPortalBundle, expected: TankestromExpected): ScorerResult {
  if (expected.requiredBringItems.length === 0) return { score: 1, failures: [] };
  const flat = bundle.children.flatMap((c) => c.bringItems).join("\n");
  const n = normalizeNorwegianLetters(flat);
  const failures: string[] = [];
  for (const item of expected.requiredBringItems) {
    if (!n.includes(normalizeNorwegianLetters(item))) {
      failures.push(`Mangler bring-item (eller lik tekst): "${item}"`);
    }
  }
  return {
    score: failures.length === 0 ? 1 : 0,
    failures,
  };
}

export function scoreDeadlineCorrect(bundle: RegressionPortalBundle, expected: TankestromExpected): ScorerResult {
  if (expected.requiredTasks.length === 0) return { score: 1, failures: [] };
  const failures: string[] = [];
  for (const req of expected.requiredTasks) {
    const hit = bundle.tasks.find(
      (t) =>
        normalizeNorwegianLetters(t.title).includes(normalizeNorwegianLetters(req.titleIncludes)) &&
        t.date === req.date &&
        t.dueTime === req.dueTime,
    );
    if (!hit) {
      failures.push(
        `Mangler oppgave: titleIncludes="${req.titleIncludes}" date=${req.date} dueTime=${req.dueTime} (har ${JSON.stringify(bundle.tasks)})`,
      );
    }
  }
  return { score: failures.length === 0 ? 1 : 0, failures };
}

export function scoreNoDeadlineInProgramHighlights(bundle: RegressionPortalBundle): ScorerResult {
  const failures: string[] = [];
  for (const c of bundle.children) {
    for (const h of c.highlights) {
      const n = normalizeNorwegianLetters(h);
      if (/\b(spond|svar|frist|senest|pamelding|påmelding|om\s+barnet\s+kan\s+delta)\b/.test(n)) {
        failures.push(`[${c.day}] Program-highlight ser ut som frist/deadline: "${h}"`);
      }
    }
  }
  return { score: failures.length === 0 ? 1 : 0, failures };
}

export function scoreForbiddenInNotes(bundle: RegressionPortalBundle, expected: TankestromExpected): ScorerResult {
  if (expected.forbiddenInNotes.length === 0) return { score: 1, failures: [] };
  const failures: string[] = [];
  for (const c of bundle.children) {
    const note = normalizeNorwegianLetters(c.notes ?? "");
    for (const frag of expected.forbiddenInNotes) {
      if (note.includes(normalizeNorwegianLetters(frag))) {
        failures.push(`[${c.day}] Notes inneholder forbudt fragment: "${frag}"`);
      }
    }
  }
  return { score: failures.length === 0 ? 1 : 0, failures };
}

/** Kjør alle innebygde scorers og returner map + samlet gjennomsnitt. */
export function runAllTankestromScorers(
  bundle: RegressionPortalBundle,
  expected: TankestromExpected,
): {
  scores: Record<string, number>;
  /** Kun kritiske scorer-feil (påvirker score). */
  failures: string[];
  styleWarnings: string[];
  semanticNearMisses: string[];
  average: number;
} {
  const parts: [string, ScorerResult][] = [
    ["parentCountCorrect", scoreParentCountCorrect(bundle, expected)],
    ["childCountCorrect", scoreChildCountCorrect(bundle, expected)],
    ["cleanTitlesCritical", scoreCleanTitlesCritical(bundle, expected)],
    ["titleMatchesExpectedStyle", scoreTitleMatchesExpectedStyle(bundle, expected)],
    ["highlightsCorrect", scoreHighlightsCorrect(bundle, expected)],
    ["forbiddenInNotes", scoreForbiddenInNotes(bundle, expected)],
    ["noDuplicateDays", scoreNoDuplicateDays(bundle)],
    ["noEventTitleAsHighlight", scoreNoEventTitleAsHighlight(bundle)],
    ["noStructureFallbackInNotes", scoreNoStructureFallbackInNotes(bundle)],
    ["correctTimePrecision", scoreCorrectTimePrecision(bundle, expected)],
    ["tentativeCorrect", scoreTentativeCorrect(bundle, expected)],
    ["bringItemsCorrect", scoreBringItemsCorrect(bundle, expected)],
    ["deadlineCorrect", scoreDeadlineCorrect(bundle, expected)],
    ["noDeadlineInProgramHighlights", scoreNoDeadlineInProgramHighlights(bundle)],
  ];

  const baseScores: Record<string, number> = {};
  const failures: string[] = [];
  const styleWarnings: string[] = [];
  const semanticNearMisses: string[] = [];
  for (const [name, r] of parts) {
    baseScores[name] = r.score;
    for (const f of r.failures) failures.push(`[${name}] ${f}`);
    for (const w of r.styleWarnings ?? []) styleWarnings.push(`[${name}] ${w}`);
    for (const s of r.semanticNearMisses ?? []) semanticNearMisses.push(`[${name}] ${s}`);
  }
  const vals = Object.values(baseScores);
  const average = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    scores: { ...baseScores, structureAverage: average },
    failures,
    styleWarnings,
    semanticNearMisses,
    average,
  };
}
