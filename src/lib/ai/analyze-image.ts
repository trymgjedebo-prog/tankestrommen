import OpenAI from "openai";
import type {
  AIAnalysisResult,
  AnalysisModelTrace,
  DayScheduleEntry,
  EventCategory,
  ExtractedText,
  SchoolProfileGradeBand,
  SchoolProfileLesson,
  SchoolProfileLessonCandidate,
  SchoolProfileWeekday,
  SchoolProfileWeekdayIndex,
  SchoolWeeklyProfile,
  SchoolWeeklyProfileDebug,
  TimeSlot,
} from "@/lib/types";
import {
  analysisLooksWeakForEscalation,
  emptyAnalysisModelTrace,
  getStrongAnalysisModel,
  selectInitialAnalysisModel,
  type AnalysisModelRoutingInput,
} from "@/lib/ai/analysis-model-router";

const EVENT_CATEGORIES: EventCategory[] = [
  "arrangement",
  "frist",
  "beskjed",
  "trening",
  "møte",
  "annet",
];

interface ParentDayItem {
  dayLabel: string | null;
  date: string | null;
  time: string | null;
  highlights: string[];
  rememberItems: string[];
  deadlines: string[];
  notes: string[];
}

const SYSTEM_PROMPT = `Du analyserer bilder av beskjeder, invitasjoner, skjermbilder og dokumenter for norske foreldre.
Les all synlig tekst. Avgjør om innholdet beskriver et arrangement, en frist, en beskjed, trening, et møte, eller annet.

VIKTIG dato-regel for ukeplaner:
- Hvis kilden inneholder uke-nummer (f.eks. "Uke 13" eller "Week 42") og ukedager (mandag–søndag / monday–sunday), skal du beregne eksakt kalenderdato per dag med ISO-uke:
  - Mandag er første dag i uken.
  - Uke 1 er uken som inneholder årets første torsdag.
- Finn årstall i kilden hvis mulig.
- Hvis årstall mangler, bruk inneværende år med mindre konteksten tydelig tilsier annet.
- Ikke la date stå tom når uke-nummer + ukedag gjør beregning mulig.
- Ved norsk tekst, formater dato som: "mandag 27. mars 2023".

Svar med ETT JSON-objekt (ingen markdown-kodeblokker) med nøyaktig disse nøklene:
- title: kort tittel på norsk (string)
- schedule: en LISTE med tidspunkter. Hvert element er et objekt med:
  - date: dato som tekst (f.eks. "fredag 10. april 2025"), eller null hvis ukjent (string | null)
  - time: klokkeslett eller tidsrom (f.eks. "15:00" eller "15:00–17:00"), eller null hvis ukjent (string | null)
  - label: valgfri kort beskrivelse av denne dagen (f.eks. "Dag 1", "Fredag"), eller null (string | null)
  VIKTIGE REGLER for schedule:
  - Hvis arrangementet skjer på ÉN dag med ETT tidspunkt: bruk én oppføring.
  - Hvis arrangementet går over FLERE dager eller har ULIKE tidspunkter på forskjellige dager: bruk ÉN oppføring PER dag/tidspunkt. IKKE slå sammen til ett tidsrom.
  - Hvis ingen dato eller tid finnes: bruk en tom liste [].
  - Hvis bare dato er kjent (ikke tid): sett time til null.
  - Hvis bare tid er kjent (ikke dato): sett date til null.
- location: sted hvis funnet, ellers null (string | null)
- description: kort oppsummering på norsk (string)
- category: én av: arrangement, frist, beskjed, trening, møte, annet
- targetGroup: hvem det gjelder (f.eks. klasse, lag, foreldre), ellers null (string | null)
- organizer: arrangør eller avsender (f.eks. skole, klubb, organisasjon), ellers null (string | null)
- contactPerson: kontaktperson med navn og evt. telefon/e-post, ellers null (string | null)
- sourceUrl: lenke/URL til mer info eller påmelding hvis synlig i bildet, ellers null (string | null)
- scheduleByDay: en LISTE for ukeplaner, aktivitetsplaner over flere dager, turneringer/stevner, leir, cup osv. Hvert element:
  - dayLabel: ukedag eller merking (f.eks. "Mandag", "Dag 2", "Lørdag"), eller null (string | null)
  - date: konkret dato hvis synlig, ellers null (string | null)
  - time: klokkeslett eller tidsrom denne dagen hvis relevant, ellers null (string | null)
  - details: kort og konkret oppsummering av hva eleven/forelder må vite denne dagen (aktiviteter, lekse, forberedelser, påminnelser/NB, praktiske beskjeder), eller null (string | null)
  REGLER for scheduleByDay:
  - Bruk KUN denne listen når innholdet tydelig er fordelt per dag (ukeplan, tabell med mandag–fredag, program per dag, osv.), ELLER flerdagers arrangement der hver dag har egen beskrivelse.
  - Ved EN enkel hendelse på én eller få dager uten «program per dag»: sett scheduleByDay til tom liste [] og bruk feltet schedule som vanlig.
  - IKKE finn på detaljer per dag du ikke ser i kilden. Ved tvil: tom scheduleByDay, beskriv heller i description og bruk schedule hvis det passer.
  - Én rad per dag eller per oppføring i kilden som hører til én dag.
  - Hvis en dag ikke har stor hendelse, men har meningsfullt skoleinnhold ("I timen", lekse, oppgaver, lesing/skriving, innlevering, forberedelse til prøve/vurdering, NB/påminnelser): fyll details med kort handlingsrettet oppsummering.
  - Ikke la en ukedag stå tom dersom kilden har meningsfull skoleinformasjon for den dagen.
- confidence: tall 0–1 for hvor sikker du er på tolkningen (number)
- extractedText: objekt med:
  - raw: transkripsjon av relevant tekst fra bildet (string)
  - language: ISO 639-1 språkkode, typisk "no" (string)
  - confidence: tall 0–1 for OCR/lesbarhet (number)
- schoolWeeklyProfile: null ELLER et objekt for FAST UKENTLIG TIMEPLAN (samme fag/timer hver uke, typisk «Timeplan», «Ukeskjema», tabell med klokkeslett + fag mandag–fredag). IKKE bruk dette for A-plan, aktivitetsplan for én bestemt uke, invitasjoner eller endagshendelser – da null.
  Når schoolWeeklyProfile er utfylt: sett schedule til [] og scheduleByDay til [] (unngå duplikat kalenderdata).

GRID-TIMEPLAN – LES LAYOUTEN FØR DU TOLKER TEKSTEN:
  Timeplaner er en 2D-ruter. Du MÅ tolke hver fagboks ut fra HVOR den står visuelt:
  1) Først finn DAGSKOLONNENE langs toppen: Mandag, Tirsdag, Onsdag, Torsdag, Fredag (stå ALDRI på feil kolonne – om boksen ligger midt mellom to, pek på den dagen boksens senter er innenfor).
  2) Finn TIDSRADENE langs venstre kolonne. Dette er tidsnavene som hver rad starter/ender på (f.eks. 08:15, 09:00, 09:15, 10:05, 10:45, 11:30, 12:15, 13:00).
  3) For HVER fagboks: bestem hvilken dag-kolonne (horisontal posisjon) og hvilken tidsrad (vertikal posisjon) den dekker. Fagboksens vertikale høyde avgjør start og slutt. En boks som går over flere rader → lengre time.
  4) IKKE gjett fag etter rekkefølge i en liste. Rekkefølgen i kildeteksten er ikke pålitelig; KUN visuell plassering gjelder.
  5) Kryssjekk før du skriver time: "Denne boksen ligger under kolonne X og fra rad Y1 til Y2 → dag=X, start=Y1, slutt=Y2".
  6) Hvis to bokser står i SAMME slot (samme dag + samme tidsrad) med ulike fag (f.eks. «Matte D1» over, «Norsk D2» under, eller delt boks):
     - Rapporter det som ÉN lesson for slotten med subjectKey=mest sannsynlige fag for en tilfeldig elev, customLabel=den originale teksten slik den står, og legg alle alternativ i subjectCandidates (se under).
     - IKKE legg det som to separate lessons for samme elev.
  7) Pauser som «Lillefri», «Storefri», «Friminutt», «Pause», «Lunsj», «Midttime» er IKKE fag – IKKE ta dem med i lessons.
  8) Tekst inni boksen kan overstyre raden:
     - «Begynner 10.05» / «Starter 10:05» → bytt ut start med 10:05.
     - «varer til 09.45» / «Slutter 09:45» → bytt ut slutt med 09:45.
     - «30 min» / «45 min» → beregn sluttet ut fra start hvis starten er sikker, ellers bruk raden.
     - «Etter høstferien» / «Fra uke …» → fortsatt ta med (dette er en fast time), men du kan legge teksten i customLabel.
  9) Hvis en time bare dekker PART av en rad og tekst bekrefter kortere varighet, tro på teksten først, raden som fallback.
  10) Når usikker på en spesifikk boks, hopp den over fremfor å gjette feil dag/tid. Hellere en ufullstendig timeplan enn feilplassert fag.
  11) FAGNAVN INNI BOKSEN:
     - Kjente kanoniske slugs: norsk, matematikk, engelsk, naturfag, samfunnsfag, krle, kroppsoving, musikk, kunst-og-handverk, mat-og-helse, utdanningsvalg, valgfag, spansk, tysk, fransk, historie, geografi.
     - IKKE KOPIER fagnavn fra en annen boks på samme dag.
     - HVIS BOKSEN INNEHOLDER TYDELIG FULLT NAVN: bruk riktig slug + skriv navnet i customLabel (f.eks. subjectKey="kroppsoving", customLabel="Kroppsøving").
     - HVIS BOKSEN BARE HAR EN FORKORTELSE DU IKKE ER SIKKER PÅ («UTV», «K&H», «K/H», «Språk», «PR», «Sm», etc.): IKKE gjett et kjent fag. Sett subject og subjectKey til forkortelsen akkurat slik den står (f.eks. subject="UTV", subjectKey="UTV"), og customLabel til samme tekst. Serveren vil konvertere det til en trygg fallback-key.
     - Bedre å beholde rå tekst fra timeplanen enn å gjette feil fag.

  Objektet har:
  - gradeBand: trinn/klasse fritekst (f.eks. «10. trinn», «10B», «VG2») eller null – serveren normaliserer til Foreldre-App-koder
  - weekdays: objekt med nøkler "0"–"4" (0=mandag … 4=fredag), alternativt man/tir/ons/tor/fre. Lørdag/søndag ikke i skoleprofil-MVP. Hver verdi er ENTEN:
    - { "useSimpleDay": true, "schoolStart": "HH:MM", "schoolEnd": "HH:MM" } når bare skolestart/-slutt er oppgitt, ELLER
    - { "useSimpleDay": false, "lessons": [ { "subjectKey": "norsk", "customLabel": null eller tekst, "start": "HH:MM", "end": "HH:MM", "subjectCandidates": [ { "subject": "Matematikk", "subjectKey": "matematikk", "weight": 1 }, { "subject": "Norsk", "subjectKey": "norsk", "weight": 1 } ] }, ... ] }
  subjectKey: kort slug på norsk fagnavn i små bokstaver og bindestrek (norsk, matematikk, engelsk, naturfag, samfunnsfag, kroppsoving, musikk, kunst_og_håndverk, osv.). Bruk customLabel når faget trenger presisering (f.eks. «Spansk valgfag»). subjectCandidates KUN når samme slot har flere alternative fag/spor – da en rad per alternativ, weight=1 for begge (eller høyere for førstnevnte).
  Tider: 24-timersformat HH:MM. Sorter lessons innen hver dag etter start tid, stigende.

Hvis bildet ikke inneholder lesbar tekst, sett lav confidence og forklar kort i description.`;

function toDataUrl(image: string): string {
  if (image.startsWith("data:")) return image;
  return `data:image/jpeg;base64,${image}`;
}

function clamp01(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function parseCategory(value: unknown): EventCategory {
  if (
    typeof value === "string" &&
    EVENT_CATEGORIES.includes(value as EventCategory)
  ) {
    return value as EventCategory;
  }
  return "annet";
}

function normalizeExtractedText(raw: unknown): ExtractedText {
  if (!raw || typeof raw !== "object") {
    return { raw: "", language: "no", confidence: 0 };
  }
  const o = raw as Record<string, unknown>;
  return {
    raw: typeof o.raw === "string" ? o.raw : "",
    language: typeof o.language === "string" ? o.language : "no",
    confidence: clamp01(o.confidence),
  };
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

function asNonEmptyString(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// #region agent log
/** Samler per-lesson subject-rådata → én aggregert emit ved slutt av ukeprofil-normalisering. */
const subjectLessonDiagBuffer: Array<Record<string, unknown>> = [];
const SUBJECT_LESSON_DIAG_CAP = 150;

function clearSubjectLessonDiagBuffer(): void {
  subjectLessonDiagBuffer.length = 0;
}

function pushSubjectLessonDiag(entry: Record<string, unknown>): void {
  if (subjectLessonDiagBuffer.length >= SUBJECT_LESSON_DIAG_CAP) return;
  subjectLessonDiagBuffer.push({ ...entry, _ts: Date.now() });
}

function diagSubjectPipeline(payload: {
  hypothesisId: string;
  phase: string;
  location: string;
  data: Record<string, unknown>;
  runId?: string;
}): void {
  const body = {
    sessionId: "f55091",
    timestamp: Date.now(),
    ...payload,
  };
  console.log("[SUBJECT-DIAG]", JSON.stringify(body));
  fetch("http://127.0.0.1:7371/ingest/a8a2064f-db06-4673-9cf1-7b503a131f2a", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "f55091",
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}

function flushSubjectLessonDiagBuffer(flushReason: string): void {
  if (subjectLessonDiagBuffer.length === 0) return;
  diagSubjectPipeline({
    hypothesisId: "H2",
    phase: "aggregate_normalizeSchoolProfileLesson",
    location: "analyze-image.ts:flushSubjectLessonDiagBuffer",
    data: {
      flushReason,
      entryCount: subjectLessonDiagBuffer.length,
      entries: subjectLessonDiagBuffer,
    },
  });
  subjectLessonDiagBuffer.length = 0;
}

/** Kompakt rå `schoolWeeklyProfile` fra modell før server-normalisering (hypotese H1). */
function summarizeRawSchoolProfileForDiag(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return { error: "not_object" };
  const o = raw as Record<string, unknown>;
  const wd = o.weekdays;
  if (!wd || typeof wd !== "object") return { weekdays: "missing_or_invalid" };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(wd as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const day = v as Record<string, unknown>;
    const lessons = Array.isArray(day.lessons) ? day.lessons : [];
    out[k] = (lessons as unknown[]).slice(0, 50).map((L, i) => {
      if (!L || typeof L !== "object") return { i, err: "bad_lesson" };
      const l = L as Record<string, unknown>;
      return {
        i,
        subjectKey: typeof l.subjectKey === "string" ? l.subjectKey : null,
        subject: typeof l.subject === "string" ? l.subject : null,
        customLabel:
          typeof l.customLabel === "string" ? l.customLabel : null,
        start: typeof l.start === "string" ? l.start : null,
        end: typeof l.end === "string" ? l.end : null,
      };
    });
  }
  return { gradeBand: o.gradeBand ?? null, weekdays: out };
}

/** Normalisert profil etter normalize (hypotese H2 vs H1 + evt. H3). */
function summarizeNormalizedSchoolProfileForDiag(
  profile: SchoolWeeklyProfile,
): unknown {
  const out: Record<string, unknown> = {};
  for (const [k, wd] of Object.entries(profile.weekdays ?? {})) {
    if (!wd || wd.useSimpleDay) continue;
    out[k] = wd.lessons.slice(0, 50).map((l, i) => ({
      i,
      subjectKey: l.subjectKey,
      customLabel: l.customLabel,
      start: l.start,
      end: l.end,
      candidateCount: l.subjectCandidates?.length ?? 0,
    }));
  }
  return out;
}
// #endregion

function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

function slugifySubjectKey(raw: string): string | null {
  const s = normalizeSpace(raw);
  if (s.length < 2) return null;
  const slug = normalizeNorwegianLetters(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

function normalizeHHMM(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/\./g, ":");
  const m = /^(\d{1,2}):(\d{2})\s*$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  const bare = /^(\d{1,2})\s*$/.exec(t);
  if (bare) {
    const h = Number(bare[1]);
    if (h < 0 || h > 23) return null;
    return `${String(h).padStart(2, "0")}:00`;
  }
  return null;
}

/** Mandag = "0" … fredag = "4" (Foreldre-App). Lør/søn → null. */
function canonicalSchoolProfileWeekdayIndex(
  raw: string,
): SchoolProfileWeekdayIndex | null {
  const k = raw.toLowerCase().trim().replace(/\.$/, "");
  const collapsed = k.replace(/\s+/g, "");

  if (/^[0-4]$/.test(collapsed)) {
    return collapsed as SchoolProfileWeekdayIndex;
  }

  const nbAbbr: Record<string, SchoolProfileWeekdayIndex> = {
    man: "0",
    tir: "1",
    ons: "2",
    tor: "3",
    fre: "4",
  };
  if (nbAbbr[collapsed]) return nbAbbr[collapsed];

  const nb = normalizeNorwegianLetters(collapsed);
  if (nb === "lordag" || nb === "sondag" || nb === "laurdag") return null;

  const nbFull: Record<string, SchoolProfileWeekdayIndex> = {
    mandag: "0",
    tirsdag: "1",
    onsdag: "2",
    torsdag: "3",
    fredag: "4",
  };
  if (nbFull[nb]) return nbFull[nb];

  if (
    collapsed === "saturday" ||
    collapsed === "sunday" ||
    collapsed === "sat" ||
    collapsed === "sun"
  ) {
    return null;
  }

  const enFull: Record<string, SchoolProfileWeekdayIndex> = {
    monday: "0",
    tuesday: "1",
    wednesday: "2",
    thursday: "3",
    friday: "4",
  };
  if (enFull[collapsed]) return enFull[collapsed];

  const enShort: Record<string, SchoolProfileWeekdayIndex> = {
    mon: "0",
    ma: "0",
    tue: "1",
    ti: "1",
    wed: "2",
    on: "2",
    thu: "3",
    to: "3",
    fri: "4",
    fr: "4",
  };
  if (enShort[collapsed]) return enShort[collapsed];

  return null;
}

/** Pauser/slots som IKKE skal være lessons i en skoleprofil. */
const BREAK_SUBJECT_KEYS = new Set<string>([
  "lillefri",
  "storefri",
  "friminutt",
  "friminutter",
  "pause",
  "pauser",
  "lunsj",
  "lunch",
  "spising",
  "mat",
  "matpause",
  "midttime",
]);

const BREAK_TEXT_RE =
  /\b(lillefri|storefri|friminutt|friminutter|pause|pauser|lunsj|spising|matpause|midttime)\b/i;

/**
 * Streng celle-bevis for faget «norsk»: modellen setter ofte subjectKey=norsk
 * uten at timeplan-boksen faktisk sier det. Tillat kun når teksten inneholder
 * «Norsk», fagkode «NO» (ordgrense), eller «Norsk D1» / «Norsk D2».
 */
function cellTextAllowsNorskSubjectEvidence(text: string | null | undefined): boolean {
  if (!text || !text.trim()) return false;
  if (/\bnorsk\s*d[12]\b/i.test(text)) return true;
  if (/\bnorsk\b/i.test(text)) return true;
  if (/\bNO\b/i.test(text)) return true;
  return false;
}

function hhmmToMinutes(t: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToHHMM(n: number): string | null {
  if (!Number.isFinite(n) || n < 0 || n >= 24 * 60) return null;
  const h = Math.floor(n / 60);
  const min = n % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Trekk «Begynner 10.05», «Starter 10:05», «varer til 09.45», «Slutter 09:45», «30 min» ut av tekst. */
function extractTimeHintsFromText(text: string | null): {
  start?: string;
  end?: string;
  durationMinutes?: number;
} {
  if (!text) return {};
  const out: { start?: string; end?: string; durationMinutes?: number } = {};

  const startRe =
    /\b(?:begynner|starter|start\s+(?:kl\.?|at)?)\s*(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})\b/i;
  const endRe =
    /\b(?:varer\s+til|slutter|til)\s*(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})\b/i;
  const durRe = /\b(\d{1,3})\s*min(?:utt|utes)?\b/i;

  const s = startRe.exec(text);
  if (s) {
    const hh = String(Number(s[1])).padStart(2, "0");
    if (Number(s[1]) <= 23 && Number(s[2]) <= 59) out.start = `${hh}:${s[2]}`;
  }
  const e = endRe.exec(text);
  if (e) {
    const hh = String(Number(e[1])).padStart(2, "0");
    if (Number(e[1]) <= 23 && Number(e[2]) <= 59) out.end = `${hh}:${e[2]}`;
  }
  const d = durRe.exec(text);
  if (d) {
    const n = Number(d[1]);
    if (n > 0 && n <= 600) out.durationMinutes = n;
  }
  return out;
}

function normalizeSchoolProfileLessonCandidate(
  raw: unknown,
): SchoolProfileLessonCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const subject = asNonEmptyString(o.subject);
  const rawKey = typeof o.subjectKey === "string" ? o.subjectKey.trim() : "";
  const slugged =
    slugifySubjectKey(rawKey) || (subject ? slugifySubjectKey(subject) : null);
  if (!slugged || !subject) return null;
  const canonical = canonicalizeSubjectFromStrings([rawKey, subject]);
  // Konservativ fallback: ikke velg et kjent fag hvis vi ikke er sikre.
  const fallbackKey = buildCustomSubjectKey(rawKey || subject);
  let subjectKey = canonical?.subjectKey ?? fallbackKey;
  if (subjectKey === "norsk" && !cellTextAllowsNorskSubjectEvidence(subject)) {
    // `subject` er allerede trimmet ikke-tom (asNonEmptyString); det er celle-beviset.
    const newKey = buildCustomSubjectKey(rawKey || subject);
    console.log(
      "[SUBJECT-ANTI-NORSK]",
      JSON.stringify({
        change: `subject_norsk_rejected_without_cell_evidence→${newKey}`,
        phase: "normalizeSchoolProfileLessonCandidate",
        subject,
        rawKey,
      }),
    );
    subjectKey = newKey;
  }
  if (BREAK_SUBJECT_KEYS.has(subjectKey)) return null;
  const rawWeight = typeof o.weight === "number" ? o.weight : Number(o.weight);
  const weight =
    Number.isFinite(rawWeight) && rawWeight > 0 ? Math.min(2, rawWeight) : 1;
  return {
    subject: subjectKey.startsWith("custom:")
      ? subject
      : canonical?.displayName ?? subject,
    subjectKey,
    weight,
  };
}

/* ----------------------------------------------------------------- */
/* Kanonisk fag-tabell + alias-matching (norsk grunnskole/VGS).      */
/* Brukt for å unngå at små bokser / forkortelser i timeplan får     */
/* feil subjectKey, og for å kryssjekke mot customLabel.             */
/* ----------------------------------------------------------------- */

interface CanonicalSubject {
  /** Intern `subjectKey` (bindestrek-slug), matcher det Foreldre-App bruker. */
  subjectKey: string;
  /** Lesbart norsk fagnavn. */
  displayName: string;
  /** Alias-tokens (allerede normaliserte: små bokstaver, æ→e, ø→o, å→a, kun bokstaver). */
  aliases: string[];
}

const CANONICAL_SUBJECTS: CanonicalSubject[] = [
  {
    subjectKey: "norsk",
    displayName: "Norsk",
    // Ikke «no»/«nor» — for ofte falsk positiv (OCR/modell). Celle må vise
    // «Norsk», «NO», «Norsk D1/D2» via cellTextAllowsNorskSubjectEvidence.
    aliases: ["norsk", "norsk-hovedmal", "norsk-sidemal"],
  },
  {
    subjectKey: "matematikk",
    displayName: "Matematikk",
    aliases: ["matematikk", "matte", "mat", "ma", "mat1p", "mat1t", "matta"],
  },
  {
    subjectKey: "engelsk",
    displayName: "Engelsk",
    aliases: ["engelsk", "eng", "english"],
  },
  {
    subjectKey: "naturfag",
    displayName: "Naturfag",
    aliases: ["naturfag", "natur", "nat"],
  },
  {
    subjectKey: "samfunnsfag",
    displayName: "Samfunnsfag",
    aliases: ["samfunnsfag", "samf", "samfunn"],
  },
  {
    subjectKey: "krle",
    displayName: "KRLE",
    aliases: ["krle", "rle", "krl", "kr-le", "krle-livssyn"],
  },
  {
    subjectKey: "kroppsoving",
    displayName: "Kroppsøving",
    aliases: ["kroppsoving", "kroppsov", "kropp", "gym", "kroppsovning", "kroppsoeving"],
  },
  {
    subjectKey: "musikk",
    displayName: "Musikk",
    aliases: ["musikk", "mus"],
  },
  {
    subjectKey: "kunst-og-handverk",
    displayName: "Kunst og håndverk",
    // Kun fulle/entydige varianter. «K&H», «K/H», «KH» holdes rå via fallback
    // fordi de kan være tvetydige på enkelte skoler.
    aliases: ["kunstoghandverk", "kunst-og-handverk"],
  },
  {
    subjectKey: "mat-og-helse",
    displayName: "Mat og helse",
    aliases: ["matoghelse", "mat-og-helse", "mat-helse"],
  },
  {
    subjectKey: "utdanningsvalg",
    displayName: "Utdanningsvalg",
    // Utelatt "utv"/"utd" med vilje – noen skoler bruker UTV med ulik betydning,
    // og konservativ fallback er tryggere enn feil mapping.
    aliases: ["utdanningsvalg"],
  },
  {
    subjectKey: "valgfag",
    displayName: "Valgfag",
    aliases: ["valgfag", "valg"],
  },
  {
    subjectKey: "spansk",
    displayName: "Spansk",
    aliases: ["spansk", "spa"],
  },
  {
    subjectKey: "tysk",
    displayName: "Tysk",
    aliases: ["tysk", "ty"],
  },
  {
    subjectKey: "fransk",
    displayName: "Fransk",
    aliases: ["fransk", "fra"],
  },
  {
    subjectKey: "historie",
    displayName: "Historie",
    aliases: ["historie", "hist"],
  },
  {
    subjectKey: "geografi",
    displayName: "Geografi",
    aliases: ["geografi", "geo"],
  },
];

/** Normaliser en tekst til et alias-friendly token (a-z0-9 kun, æøå foldet). */
function subjectAliasKey(raw: string): string {
  return normalizeNorwegianLetters(raw)
    .replace(/&/g, " og ")
    .replace(/\//g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Prøv å matche en tekst (eks. «K&H», «KRLE», «Kroppsøving») mot kanoniske fag.
 * Returner første kanonisk match eller null.
 */
function canonicalizeSubjectFromText(
  text: string | null,
): CanonicalSubject | null {
  if (!text) return null;
  const key = subjectAliasKey(text);
  if (!key) return null;
  // Eksakt alias-treff først.
  for (const s of CANONICAL_SUBJECTS) {
    if (s.aliases.includes(key)) return s;
  }
  // «Kortform + annet» (f.eks. «krle-livssyn», «mat-og-helse-nb»): alias som prefix.
  for (const s of CANONICAL_SUBJECTS) {
    for (const a of s.aliases) {
      if (a.length >= 3 && key.startsWith(a)) return s;
    }
  }
  // Ord-by-ord: hvis noe av inputs ordtokens matcher en alias.
  const words = normalizeNorwegianLetters(text)
    .replace(/&/g, " og ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const w of words) {
    for (const s of CANONICAL_SUBJECTS) {
      if (s.aliases.includes(w)) return s;
    }
  }
  return null;
}

/** Prøv flere kilder (f.eks. subjectKey, subject, customLabel) i rekkefølge. */
function canonicalizeSubjectFromStrings(
  sources: Array<string | null | undefined>,
): CanonicalSubject | null {
  for (const s of sources) {
    if (!s) continue;
    const found = canonicalizeSubjectFromText(s);
    if (found) return found;
  }
  return null;
}

/** Prefix som markerer at faget IKKE kunne mappes til et kjent kanonisk fag. */
const CUSTOM_SUBJECT_PREFIX = "custom:";

/**
 * Bygg en konservativ `subjectKey` for ukjente/usikre fag. Beholder rå tekst
 * som differensiator slik at ulike ukjente fag ikke kolliderer i dedup.
 * Eksempler:
 *   «UTV»      → "custom:utv"
 *   «K&H»      → "custom:k-h"   (& → "-")
 *   «Språk»    → "custom:sprak"
 */
function buildCustomSubjectKey(rawText: string): string {
  const slug =
    normalizeNorwegianLetters(rawText)
      .replace(/&/g, "-")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "ukjent";
  return `${CUSTOM_SUBJECT_PREFIX}${slug}`;
}

/** Velg beste rå tekst til å vise/lagre som customLabel for ukjente fag. */
function pickRawSubjectText(
  fromKey: string,
  fromSubj: string,
  customLabel: string | null,
): string | null {
  const first = [fromSubj, fromKey, customLabel ?? ""]
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  return first ? normalizeSpace(first) : null;
}

/**
 * Let etter "FagA (/|,) FagB"-mønster i customLabel. Brukes for D1/D2-bokser
 * når modellen har levert én lesson med begge fag i teksten i stedet for
 * `subjectCandidates`. Returnerer distinkte kanoniske fag i original rekkefølge.
 */
function extractDualCanonicalSubjectsFromLabel(
  label: string | null,
): CanonicalSubject[] {
  if (!label) return [];
  if (!/[\/,]|\b(d1|d2|gruppe|spor)\b/i.test(label)) return [];
  const parts = label
    .split(/\s*[\/,]\s*|\s+(?:eller|or)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return [];
  const matches: CanonicalSubject[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const cleaned = p.replace(/\bd1\b|\bd2\b|\bgruppe\b|\bspor\b/gi, "").trim();
    const hit = canonicalizeSubjectFromText(cleaned);
    if (hit && !seen.has(hit.subjectKey)) {
      matches.push(hit);
      seen.add(hit.subjectKey);
    }
  }
  return matches.length >= 2 ? matches : [];
}

type LessonNormalizationResult =
  | { ok: true; lesson: SchoolProfileLesson; changes: string[] }
  | { ok: false; reason: string };

function normalizeSchoolProfileLesson(
  raw: unknown,
): LessonNormalizationResult {
  if (!raw || typeof raw !== "object") {
    pushSubjectLessonDiag({
      hypothesisId: "H2",
      phase: "normalizeSchoolProfileLesson_exit",
      location: "analyze-image.ts:normalizeSchoolProfileLesson",
      data: { ok: false, reason: "not_object" },
    });
    return { ok: false, reason: "not_object" };
  }
  const o = raw as Record<string, unknown>;
  const fromKey = typeof o.subjectKey === "string" ? o.subjectKey.trim() : "";
  const fromSubj = typeof o.subject === "string" ? o.subject.trim() : "";
  const initialSlug = slugifySubjectKey(fromKey) || slugifySubjectKey(fromSubj);
  if (!initialSlug) {
    pushSubjectLessonDiag({
      hypothesisId: "H2",
      phase: "normalizeSchoolProfileLesson_exit",
      location: "analyze-image.ts:normalizeSchoolProfileLesson",
      data: { ok: false, reason: "missing_subject_key", fromKey, fromSubj },
    });
    return { ok: false, reason: "missing_subject_key" };
  }

  if (BREAK_SUBJECT_KEYS.has(initialSlug)) {
    pushSubjectLessonDiag({
      hypothesisId: "H2",
      phase: "normalizeSchoolProfileLesson_exit",
      location: "analyze-image.ts:normalizeSchoolProfileLesson",
      data: {
        ok: false,
        reason: `break_subject_key:${initialSlug}`,
        fromKey,
        fromSubj,
        initialSlug,
      },
    });
    return { ok: false, reason: `break_subject_key:${initialSlug}` };
  }
  const customLabelRaw = asNonEmptyString(o.customLabel);
  let customLabel = customLabelRaw;
  if (
    customLabel &&
    BREAK_TEXT_RE.test(customLabel) &&
    !/\b(matte|norsk|engelsk|naturfag|samfunnsfag|krle|rle|kroppsov|musikk|kunst|historie|fysikk|kjemi|biologi|tysk|spansk|fransk)\b/i.test(
      customLabel,
    )
  ) {
    pushSubjectLessonDiag({
      hypothesisId: "H2",
      phase: "normalizeSchoolProfileLesson_exit",
      location: "analyze-image.ts:normalizeSchoolProfileLesson",
      data: {
        ok: false,
        reason: "break_in_custom_label",
        fromKey,
        fromSubj,
        initialSlug,
        customLabel,
      },
    });
    return { ok: false, reason: "break_in_custom_label" };
  }

  const changes: string[] = [];
  const beforeSnap = {
    fromKey,
    fromSubj,
    customLabel: customLabelRaw,
    initialSlug,
  };

  // Kanonisk fag-mapping: prøv i rekkefølge subjectKey → subject → customLabel.
  // Hvis customLabel avslører et annet kanonisk fag enn det subject/subjectKey peker på,
  // er det som regel modellen som har lagt feil slug – label er mer direkte fra boksen.
  const canonicalFromKeyOrSubject = canonicalizeSubjectFromStrings([fromKey, fromSubj]);
  const canonicalFromLabel = canonicalizeSubjectFromText(customLabel);
  let canonical: CanonicalSubject | null = canonicalFromKeyOrSubject;
  if (
    canonicalFromLabel &&
    canonicalFromKeyOrSubject &&
    canonicalFromLabel.subjectKey !== canonicalFromKeyOrSubject.subjectKey
  ) {
    // Stol på customLabel (boksens originaltekst) over modellens egen slug.
    canonical = canonicalFromLabel;
    changes.push(
      `subject_corrected_from_label:${canonicalFromKeyOrSubject.subjectKey}→${canonicalFromLabel.subjectKey}`,
    );
  } else if (!canonicalFromKeyOrSubject && canonicalFromLabel) {
    canonical = canonicalFromLabel;
    changes.push(`subject_recovered_from_label:${canonicalFromLabel.subjectKey}`);
  }

  let key: string;
  if (canonical) {
    key = canonical.subjectKey;
  } else {
    // Konservativ fallback: behold rå tekst i stedet for å gjette feil fag.
    const rawText = pickRawSubjectText(fromKey, fromSubj, customLabel);
    if (!rawText) {
      pushSubjectLessonDiag({
        hypothesisId: "H2",
        phase: "normalizeSchoolProfileLesson_exit",
        location: "analyze-image.ts:normalizeSchoolProfileLesson",
        data: {
          ok: false,
          reason: "missing_subject_text_for_fallback",
          before: beforeSnap,
          canonicalFromKeyOrSubject:
            canonicalFromKeyOrSubject?.subjectKey ?? null,
          canonicalFromLabel: canonicalFromLabel?.subjectKey ?? null,
        },
      });
      return { ok: false, reason: "missing_subject_text_for_fallback" };
    }
    key = buildCustomSubjectKey(rawText);
    if (!customLabel) {
      // Sørg for at råteksten bevares synlig for bruker.
      customLabel = rawText;
    }
    changes.push(`subject_fallback_to_custom_label:${rawText}`);
  }

  // Streng norsk: krever celle-bevis (customLabel hvis satt, ellers modellfelt).
  if (key === "norsk") {
    const hasLabel = Boolean(customLabel?.trim());
    const evidenceSource = hasLabel
      ? customLabel!
      : `${fromKey} ${fromSubj}`.trim();
    if (!cellTextAllowsNorskSubjectEvidence(evidenceSource)) {
      const rawForCustom =
        (customLabel?.trim() ? customLabel.trim() : "") ||
        pickRawSubjectText(fromKey, fromSubj, null) ||
        fromSubj ||
        fromKey;
      if (rawForCustom.trim()) {
        key = buildCustomSubjectKey(rawForCustom);
        if (!customLabel?.trim()) customLabel = normalizeSpace(rawForCustom);
        changes.push(
          `subject_norsk_rejected_without_cell_evidence→${key}`,
        );
      }
    }
  }

  if (BREAK_SUBJECT_KEYS.has(key)) {
    pushSubjectLessonDiag({
      hypothesisId: "H2",
      phase: "normalizeSchoolProfileLesson_exit",
      location: "analyze-image.ts:normalizeSchoolProfileLesson",
      data: {
        ok: false,
        reason: `break_subject_key_after_canonical:${key}`,
        before: beforeSnap,
        provisionalKey: key,
        canonicalFromKeyOrSubject:
          canonicalFromKeyOrSubject?.subjectKey ?? null,
        canonicalFromLabel: canonicalFromLabel?.subjectKey ?? null,
      },
    });
    return { ok: false, reason: `break_subject_key_after_canonical:${key}` };
  }
  const rawStart = asNonEmptyString(o.start);
  const rawEnd = asNonEmptyString(o.end);
  let start = normalizeHHMM(rawStart);
  let end = normalizeHHMM(rawEnd);
  if (rawStart && !start) changes.push(`invalid_raw_start:${rawStart}`);
  if (rawEnd && !end) changes.push(`invalid_raw_end:${rawEnd}`);

  const hints = extractTimeHintsFromText(customLabel);
  if (hints.start && hints.start !== start) {
    changes.push(`start_override_from_label:${start ?? "∅"}→${hints.start}`);
    start = hints.start;
  }
  if (hints.end && hints.end !== end) {
    changes.push(`end_override_from_label:${end ?? "∅"}→${hints.end}`);
    end = hints.end;
  }
  if (!end && start && hints.durationMinutes) {
    const startMin = hhmmToMinutes(start);
    if (startMin !== null) {
      const newEnd = minutesToHHMM(startMin + hints.durationMinutes);
      if (newEnd) {
        changes.push(`end_from_duration:${hints.durationMinutes}min→${newEnd}`);
        end = newEnd;
      }
    }
  }
  if (!start && end && hints.durationMinutes) {
    const endMin = hhmmToMinutes(end);
    if (endMin !== null) {
      const newStart = minutesToHHMM(endMin - hints.durationMinutes);
      if (newStart) {
        changes.push(
          `start_from_duration:${hints.durationMinutes}min→${newStart}`,
        );
        start = newStart;
      }
    }
  }

  if (!start || !end) {
    pushSubjectLessonDiag({
      hypothesisId: "H2",
      phase: "normalizeSchoolProfileLesson_exit",
      location: "analyze-image.ts:normalizeSchoolProfileLesson",
      data: {
        ok: false,
        reason: "missing_start_or_end",
        before: beforeSnap,
        finalSubjectKey: key,
        finalCustomLabel: customLabel,
        rawStart,
        rawEnd,
      },
    });
    return { ok: false, reason: "missing_start_or_end" };
  }
  const startMin = hhmmToMinutes(start);
  const endMin = hhmmToMinutes(end);
  if (startMin === null || endMin === null || endMin <= startMin) {
    pushSubjectLessonDiag({
      hypothesisId: "H2",
      phase: "normalizeSchoolProfileLesson_exit",
      location: "analyze-image.ts:normalizeSchoolProfileLesson",
      data: {
        ok: false,
        reason: `non_positive_duration:${start}-${end}`,
        before: beforeSnap,
        finalSubjectKey: key,
        finalCustomLabel: customLabel,
        start,
        end,
      },
    });
    return { ok: false, reason: `non_positive_duration:${start}-${end}` };
  }

  const rawCandidates = Array.isArray(o.subjectCandidates)
    ? (o.subjectCandidates
        .map(normalizeSchoolProfileLessonCandidate)
        .filter(
          (x): x is SchoolProfileLessonCandidate => x !== null,
        ) as SchoolProfileLessonCandidate[])
    : [];
  const seen = new Set<string>();
  let candidates = rawCandidates.filter((c) => {
    if (seen.has(c.subjectKey)) return false;
    seen.add(c.subjectKey);
    return true;
  });

  // Hvis modellen ikke har rapportert candidates, men customLabel inneholder en
  // tydelig D1/D2-splitt (f.eks. «Matte D1 / Norsk D2»), bygg candidates selv.
  if (candidates.length < 2) {
    const dual = extractDualCanonicalSubjectsFromLabel(customLabel);
    if (dual.length >= 2) {
      candidates = dual.map((d, i) => ({
        subject: d.displayName,
        subjectKey: d.subjectKey,
        weight: i === 0 ? 1 : 1,
      }));
      changes.push(`subjectCandidates_from_label:${dual.length}`);
    }
  }

  const lesson: SchoolProfileLesson = {
    subjectKey: key,
    customLabel,
    start,
    end,
  };
  if (candidates.length >= 2) {
    lesson.subjectCandidates = candidates;
    changes.push(`subjectCandidates:${candidates.length}`);
  }
  pushSubjectLessonDiag({
    hypothesisId: "H2",
    phase: "after_normalizeSchoolProfileLesson",
    location: "analyze-image.ts:normalizeSchoolProfileLesson",
    data: {
      ok: true,
      before: beforeSnap,
      canonicalFromKeyOrSubject:
        canonicalFromKeyOrSubject?.subjectKey ?? null,
      canonicalFromLabel: canonicalFromLabel?.subjectKey ?? null,
      resolvedCanonicalKey: canonical?.subjectKey ?? null,
      finalSubjectKey: lesson.subjectKey,
      finalCustomLabel: lesson.customLabel,
      changes,
      start: lesson.start,
      end: lesson.end,
      subjectCandidates: candidates.length,
    },
  });
  return { ok: true, lesson, changes };
}

function dedupeAndSortLessons(
  lessons: SchoolProfileLesson[],
): SchoolProfileLesson[] {
  const sorted = [...lessons].sort((a, b) => {
    const am = hhmmToMinutes(a.start) ?? 0;
    const bm = hhmmToMinutes(b.start) ?? 0;
    if (am !== bm) return am - bm;
    return (hhmmToMinutes(a.end) ?? 0) - (hhmmToMinutes(b.end) ?? 0);
  });
  const seen = new Set<string>();
  const out: SchoolProfileLesson[] = [];
  for (const l of sorted) {
    const key = `${l.start}-${l.end}|${l.subjectKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

type WeekdayNormalizationReport = {
  inputLessons: number;
  keptLessons: number;
  droppedLessons: Array<{ index: number; raw: unknown; reason: string }>;
  adjustedLessons: Array<{
    index: number;
    subjectKey: string | null;
    changes: string[];
  }>;
};

function normalizeSchoolProfileWeekday(raw: unknown): {
  weekday: SchoolProfileWeekday | null;
  report: WeekdayNormalizationReport;
  rejectReason?: string;
} {
  const report: WeekdayNormalizationReport = {
    inputLessons: 0,
    keptLessons: 0,
    droppedLessons: [],
    adjustedLessons: [],
  };
  if (!raw || typeof raw !== "object") {
    return { weekday: null, report, rejectReason: "weekday_not_object" };
  }
  const o = raw as Record<string, unknown>;

  if (o.useSimpleDay === true) {
    const schoolStart = normalizeHHMM(asNonEmptyString(o.schoolStart));
    const schoolEnd = normalizeHHMM(asNonEmptyString(o.schoolEnd));
    if (!schoolStart || !schoolEnd) {
      return {
        weekday: null,
        report,
        rejectReason: "simple_day_missing_start_or_end",
      };
    }
    return {
      weekday: { useSimpleDay: true, schoolStart, schoolEnd },
      report,
    };
  }

  if (Array.isArray(o.lessons)) {
    report.inputLessons = o.lessons.length;
    const accepted: SchoolProfileLesson[] = [];
    o.lessons.forEach((entry, index) => {
      const res = normalizeSchoolProfileLesson(entry);
      if (!res.ok) {
        report.droppedLessons.push({
          index,
          raw: entry,
          reason: res.reason,
        });
        return;
      }
      if (res.changes.length > 0) {
        report.adjustedLessons.push({
          index,
          subjectKey: res.lesson.subjectKey,
          changes: res.changes,
        });
      }
      accepted.push(res.lesson);
    });
    const lessons = dedupeAndSortLessons(accepted);
    if (lessons.length < accepted.length) {
      report.adjustedLessons.push({
        index: -1,
        subjectKey: null,
        changes: [
          `deduped:${accepted.length - lessons.length}`,
        ],
      });
    }
    report.keptLessons = lessons.length;
    if (lessons.length === 0) {
      return { weekday: null, report, rejectReason: "no_lessons_after_filter" };
    }
    return { weekday: { useSimpleDay: false, lessons }, report };
  }

  return { weekday: null, report, rejectReason: "no_lessons_array" };
}

/**
 * Foreldre-App: `ChildSchoolProfile.gradeBand` må være nøyaktig én av disse.
 */
function normalizeGradeBandForPortal(
  raw: string | null | undefined,
  fallbacks: (string | null | undefined)[] = [],
): SchoolProfileGradeBand | null {
  const candidates = [raw, ...fallbacks].filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  for (const c of candidates) {
    const mapped = mapOneGradeBandHint(c.trim());
    if (mapped) return mapped;
  }
  return null;
}

function trinnNumberToBand(n: number): SchoolProfileGradeBand | null {
  if (n >= 1 && n <= 4) return "1-4";
  if (n >= 5 && n <= 7) return "5-7";
  if (n >= 8 && n <= 10) return "8-10";
  return null;
}

/** Tall 1–10 fra klasse/trinn (ikke VG – håndteres for seg). */
function extractGrunnskoleTrinnNumber(s: string): number | null {
  const patterns: RegExp[] = [
    /(\d{1,2})\s*\.\s*trinn\b/i,
    /\btrinn\s*:?\s*(\d{1,2})\b/i,
    /(?:^|\b)(?:klasse|kl\.)\s*:?\s*(\d{1,2})\b/i,
    /\b(\d{1,2})\s*klasse\b/i,
    /\b(\d{1,2})\s*\.?\s*kl\.\b/i,
    /\b([1-9]|10)\s*[a-zæøå]\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (!m) continue;
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 10) return n;
  }
  return null;
}

function mapOneGradeBandHint(text: string): SchoolProfileGradeBand | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();
  const collapsed = lower
    .replace(/\s+/g, "")
    .replace(/[–—]/g, "-");

  const direct: SchoolProfileGradeBand[] = [
    "1-4",
    "5-7",
    "8-10",
    "vg1",
    "vg2",
    "vg3",
  ];
  for (const d of direct) {
    if (collapsed === d) return d;
  }

  const vgWord = /\bvg\s*([123])\b/i.exec(lower);
  if (vgWord) return `vg${vgWord[1]}` as SchoolProfileGradeBand;

  if (/^vg[123]$/.test(collapsed)) {
    return collapsed as SchoolProfileGradeBand;
  }

  const range = /\b([1-9]|10)\s*[-–]\s*([1-9]|10)\b/.exec(lower);
  if (range) {
    const a = Number.parseInt(range[1], 10);
    const b = Number.parseInt(range[2], 10);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (lo >= 1 && hi <= 4) return "1-4";
    if (lo >= 5 && hi <= 7) return "5-7";
    if (lo >= 8 && hi <= 10) return "8-10";
  }

  const trinn = extractGrunnskoleTrinnNumber(text);
  if (trinn !== null) return trinnNumberToBand(trinn);

  return null;
}

function normalizeSchoolWeeklyProfileRaw(
  raw: unknown,
  context?: {
    title?: string | null;
    targetGroup?: string | null;
    description?: string | null;
  },
): { profile: SchoolWeeklyProfile | null; debug: SchoolWeeklyProfileDebug } {
  clearSubjectLessonDiagBuffer();
  const debug: SchoolWeeklyProfileDebug = {
    rawGradeBand: null,
    resolvedGradeBand: null,
    days: [],
    rawRoot: raw,
  };
  if (raw === null || raw === undefined) {
    flushSubjectLessonDiagBuffer("raw_null");
    return { profile: null, debug };
  }
  if (typeof raw !== "object") {
    flushSubjectLessonDiagBuffer("raw_not_object");
    return { profile: null, debug };
  }
  const o = raw as Record<string, unknown>;
  const rawGrade =
    o.gradeBand === null || o.gradeBand === undefined
      ? null
      : asNonEmptyString(o.gradeBand);
  debug.rawGradeBand = rawGrade;

  const gradeBand = normalizeGradeBandForPortal(rawGrade, [
    context?.title,
    context?.targetGroup,
    context?.description,
  ]);
  debug.resolvedGradeBand = gradeBand;

  const weekdays: Partial<
    Record<SchoolProfileWeekdayIndex, SchoolProfileWeekday>
  > = {};

  const pushDay = (
    rawKey: string,
    payload: unknown,
    wk: SchoolProfileWeekdayIndex | null,
  ) => {
    if (!wk) {
      debug.days.push({
        rawKey,
        canonicalIndex: null,
        kept: false,
        reason: "weekday_key_not_recognized",
        inputLessons: 0,
        keptLessons: 0,
        droppedLessons: [],
        adjustedLessons: [],
      });
      return;
    }
    const { weekday, report, rejectReason } =
      normalizeSchoolProfileWeekday(payload);
    if (!weekday) {
      debug.days.push({
        rawKey,
        canonicalIndex: wk,
        kept: false,
        reason: rejectReason ?? "rejected",
        inputLessons: report.inputLessons,
        keptLessons: 0,
        droppedLessons: report.droppedLessons,
        adjustedLessons: report.adjustedLessons,
      });
      return;
    }
    weekdays[wk] = weekday;
    debug.days.push({
      rawKey,
      canonicalIndex: wk,
      kept: true,
      inputLessons: report.inputLessons,
      keptLessons: report.keptLessons,
      droppedLessons: report.droppedLessons,
      adjustedLessons: report.adjustedLessons,
    });
  };

  if (Array.isArray(o.weekdays)) {
    for (const row of o.weekdays) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const rawKey = typeof r.weekday === "string" ? r.weekday : "(no key)";
      const wk =
        typeof r.weekday === "string"
          ? canonicalSchoolProfileWeekdayIndex(r.weekday)
          : null;
      pushDay(rawKey, r, wk);
    }
  } else if (o.weekdays && typeof o.weekdays === "object") {
    for (const [key, val] of Object.entries(o.weekdays as Record<string, unknown>)) {
      const wk = canonicalSchoolProfileWeekdayIndex(key);
      pushDay(key, val, wk);
    }
  }

  if (Object.keys(weekdays).length === 0) {
    flushSubjectLessonDiagBuffer("weekdays_empty");
    return { profile: null, debug };
  }
  flushSubjectLessonDiagBuffer("profile_ok");
  return { profile: { gradeBand, weekdays }, debug };
}

function detectIsoWeekday(dayLabel: string | null): number | null {
  if (!dayLabel) return null;
  const s = dayLabel.toLowerCase();
  const has = (re: RegExp) => re.test(s);

  if (has(/\b(man(day)?|ma\.?|mandag)\b/i)) return 1;
  if (has(/\b(tue(s(day)?)?|ti\.?|tirsdag)\b/i)) return 2;
  if (has(/\b(wed(nesday)?|on\.?|onsdag)\b/i)) return 3;
  if (has(/\b(thu(rs(day)?)?|to\.?|torsdag)\b/i)) return 4;
  if (has(/\b(fri(day)?|fr\.?|fredag)\b/i)) return 5;
  if (has(/\b(sat(urday)?|l[øo]r\.?|l[øo]rdag)\b/i)) return 6;
  if (has(/\b(sun(day)?|s[øo]n\.?|s[øo]ndag)\b/i)) return 7;

  return null;
}

function getIsoWeekDateUtc(year: number, week: number, isoWeekday: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4IsoWeekday = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const week1Monday = new Date(Date.UTC(year, 0, 4 - (jan4IsoWeekday - 1)));
  const d = new Date(week1Monday);
  d.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7 + (isoWeekday - 1));
  return d;
}

function formatDateNbNo(date: Date): string {
  return new Intl.DateTimeFormat("nb-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function inferIsoWeekAndYearFromContext(
  context: string,
  fallbackYear: number
): { week: number; year: number } | null {
  const weekMatch = /\b(?:uke|week)\s*(\d{1,2})\b/i.exec(context);
  if (!weekMatch) return null;

  const week = Number.parseInt(weekMatch[1], 10);
  if (!Number.isFinite(week) || week < 1 || week > 53) return null;

  const yearMatch = /\b(20\d{2})\b/.exec(context);
  const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : fallbackYear;
  return { week, year };
}

function inferDateFromWeekdayLabel(
  dayLabel: string | null,
  weekYear: { week: number; year: number } | null
): string | null {
  if (!weekYear) return null;
  const isoWeekday = detectIsoWeekday(dayLabel);
  if (!isoWeekday) return null;
  const d = getIsoWeekDateUtc(weekYear.year, weekYear.week, isoWeekday);
  return formatDateNbNo(d);
}

function inferParentDayDates(
  days: ParentDayItem[],
  weekYear: { week: number; year: number } | null
): ParentDayItem[] {
  if (days.length === 0 || !weekYear) return days;
  return days.map((day) => {
    if (day.date) return day;
    const inferred = inferDateFromWeekdayLabel(day.dayLabel, weekYear);
    if (!inferred) return day;
    return { ...day, date: inferred };
  });
}

function inferDayEntryDates(
  entries: DayScheduleEntry[],
  weekYear: { week: number; year: number } | null
): DayScheduleEntry[] {
  if (entries.length === 0 || !weekYear) return entries;
  return entries.map((entry) => {
    if (entry.date) return entry;
    const inferred = inferDateFromWeekdayLabel(entry.dayLabel, weekYear);
    if (!inferred) return entry;
    return { ...entry, date: inferred };
  });
}

function inferTimeSlotDates(
  slots: TimeSlot[],
  weekYear: { week: number; year: number } | null
): TimeSlot[] {
  if (slots.length === 0 || !weekYear) return slots;
  return slots.map((slot) => {
    if (slot.date) return slot;
    const inferred = inferDateFromWeekdayLabel(slot.label, weekYear);
    if (!inferred) return slot;
    return { ...slot, date: inferred };
  });
}

function normalizeParentDayItem(raw: unknown): ParentDayItem {
  if (!raw || typeof raw !== "object") {
    return {
      dayLabel: null,
      date: null,
      time: null,
      highlights: [],
      rememberItems: [],
      deadlines: [],
      notes: [],
    };
  }
  const o = raw as Record<string, unknown>;
  const str = (k: string) =>
    typeof o[k] === "string" && (o[k] as string).trim()
      ? (o[k] as string).trim()
      : null;
  return {
    dayLabel: str("dayLabel"),
    date: str("date"),
    time: str("time"),
    highlights: normalizeStringArray(o.highlights),
    rememberItems: normalizeStringArray(o.rememberItems),
    deadlines: normalizeStringArray(o.deadlines),
    notes: normalizeStringArray(o.notes),
  };
}

function normalizeParentDays(raw: unknown): ParentDayItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeParentDayItem)
    .filter(
      (d) =>
        d.dayLabel !== null ||
        d.date !== null ||
        d.time !== null ||
        d.highlights.length > 0 ||
        d.rememberItems.length > 0 ||
        d.deadlines.length > 0 ||
        d.notes.length > 0
    );
}

function dayDetailsFromParentItem(day: ParentDayItem): string | null {
  const sections: string[] = [];
  if (day.highlights.length > 0) {
    sections.push(`Høydepunkter: ${day.highlights.join("; ")}`);
  }
  if (day.rememberItems.length > 0) {
    sections.push(`Husk: ${day.rememberItems.join("; ")}`);
  }
  if (day.deadlines.length > 0) {
    sections.push(`Frister: ${day.deadlines.join("; ")}`);
  }
  if (day.notes.length > 0) {
    sections.push(`Notater: ${day.notes.join("; ")}`);
  }
  return sections.length > 0 ? sections.join("\n") : null;
}

function scheduleByDayFromParentDays(days: ParentDayItem[]): DayScheduleEntry[] {
  return days.map((day) => ({
    dayLabel: day.dayLabel,
    date: day.date,
    time: day.time,
    details: dayDetailsFromParentItem(day),
    highlights: day.highlights,
    rememberItems: day.rememberItems,
    deadlines: day.deadlines,
    notes: day.notes,
  }));
}

function scheduleFromParentDays(days: ParentDayItem[]): TimeSlot[] {
  return days
    .map((day) => ({
      date: day.date,
      time: day.time,
      label: day.dayLabel,
    }))
    .filter((slot) => slot.date !== null || slot.time !== null || slot.label !== null);
}

function inferCategoryFromParentDays(days: ParentDayItem[]): EventCategory {
  if (days.some((d) => d.deadlines.length > 0)) return "frist";
  if (days.some((d) => d.highlights.length > 0 || d.rememberItems.length > 0)) {
    return "arrangement";
  }
  return "beskjed";
}

function normalizeTimeSlot(raw: unknown): TimeSlot {
  if (!raw || typeof raw !== "object") {
    return { date: null, time: null, label: null };
  }
  const o = raw as Record<string, unknown>;
  return {
    date: typeof o.date === "string" && o.date.trim() ? o.date.trim() : null,
    time: typeof o.time === "string" && o.time.trim() ? o.time.trim() : null,
    label: typeof o.label === "string" && o.label.trim() ? o.label.trim() : null,
  };
}

function normalizeSchedule(raw: unknown): TimeSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeTimeSlot)
    .filter((s) => s.date !== null || s.time !== null);
}

function normalizeDayEntry(raw: unknown): DayScheduleEntry {
  if (!raw || typeof raw !== "object") {
    return {
      dayLabel: null,
      date: null,
      time: null,
      details: null,
      highlights: [],
      rememberItems: [],
      deadlines: [],
      notes: [],
    };
  }
  const o = raw as Record<string, unknown>;
  const str = (k: string) =>
    typeof o[k] === "string" && (o[k] as string).trim()
      ? (o[k] as string).trim()
      : null;
  return {
    dayLabel: str("dayLabel"),
    date: str("date"),
    time: str("time"),
    details: str("details"),
    highlights: normalizeStringArray(o.highlights),
    rememberItems: normalizeStringArray(o.rememberItems),
    deadlines: normalizeStringArray(o.deadlines),
    notes: normalizeStringArray(o.notes),
  };
}

function normalizeScheduleByDay(raw: unknown): DayScheduleEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeDayEntry)
    .filter(
      (d) =>
        d.dayLabel !== null ||
        d.date !== null ||
        d.time !== null ||
        (d.details !== null && d.details.length > 0) ||
        d.highlights.length > 0 ||
        d.rememberItems.length > 0 ||
        d.deadlines.length > 0 ||
        d.notes.length > 0
    );
}

function normalizeAIAnalysisResult(
  data: unknown,
  sourceText?: string
): AIAnalysisResult {
  if (!data || typeof data !== "object") {
    throw new Error("Ugyldig JSON fra modellen");
  }
  const o = data as Record<string, unknown>;

  const extractedRaw =
    o.extractedText && typeof o.extractedText === "object"
      ? asNonEmptyString((o.extractedText as Record<string, unknown>).raw)
      : null;
  const weekInferenceContext = [
    sourceText,
    asNonEmptyString(o.title),
    asNonEmptyString(o.description),
    extractedRaw,
  ]
    .filter(Boolean)
    .join("\n");
  const weekYear = inferIsoWeekAndYearFromContext(
    weekInferenceContext,
    new Date().getFullYear()
  );

  const parentDays = inferParentDayDates(normalizeParentDays(o.days), weekYear);
  const mappedScheduleByDay = scheduleByDayFromParentDays(parentDays);
  const mappedSchedule = inferTimeSlotDates(
    scheduleFromParentDays(parentDays),
    weekYear
  );
  const generalImportantInfo = normalizeStringArray(o.generalImportantInfo);
  const contacts = normalizeStringArray(o.contacts);

  const normalizedSchedule = inferTimeSlotDates(normalizeSchedule(o.schedule), weekYear);
  const normalizedScheduleByDay = inferDayEntryDates(
    normalizeScheduleByDay(o.scheduleByDay),
    weekYear
  );

  const fallbackDescriptionParts: string[] = [];
  if (generalImportantInfo.length > 0) {
    fallbackDescriptionParts.push(
      `Viktig for hele perioden: ${generalImportantInfo.join("; ")}`
    );
  }
  if (contacts.length > 0) {
    fallbackDescriptionParts.push(`Kontakt: ${contacts.join("; ")}`);
  }

  const titleForGradeContext =
    typeof o.title === "string" && o.title.trim() ? o.title.trim() : null;
  const targetGroupForGradeContext =
    o.targetGroup === null || o.targetGroup === undefined
      ? null
      : String(o.targetGroup).trim() || null;

  const descriptionForGradeContext = (() => {
    if (typeof o.description === "string" && o.description.trim()) {
      return o.description.trim();
    }
    if (fallbackDescriptionParts.length > 0) {
      return fallbackDescriptionParts.join("\n").trim();
    }
    return null;
  })();

  const schoolWeeklyProfileResult = normalizeSchoolWeeklyProfileRaw(
    o.schoolWeeklyProfile,
    {
      title: titleForGradeContext,
      targetGroup: targetGroupForGradeContext,
      description: descriptionForGradeContext,
    },
  );
  const schoolWeeklyProfile = schoolWeeklyProfileResult.profile;
  const schoolWeeklyProfileDebug = schoolWeeklyProfileResult.debug;

  if (schoolWeeklyProfile) {
    diagSubjectPipeline({
      hypothesisId: "H2b",
      phase: "after_normalize_full_schoolWeeklyProfile",
      location: "analyze-image.ts:normalizeAIAnalysisResult",
      data: {
        note: "Sammenlign med H1: samme slot skal ha samme subjectKey med mindre normalisering endret den.",
        normalizedSchoolWeeklyProfileSummary:
          summarizeNormalizedSchoolProfileForDiag(schoolWeeklyProfile),
      },
    });
  }

  if (schoolWeeklyProfileDebug.rawRoot !== undefined && schoolWeeklyProfileDebug.rawRoot !== null) {
    const summary = {
      rawGradeBand: schoolWeeklyProfileDebug.rawGradeBand,
      resolvedGradeBand: schoolWeeklyProfileDebug.resolvedGradeBand,
      days: schoolWeeklyProfileDebug.days.map((d) => ({
        rawKey: d.rawKey,
        canonicalIndex: d.canonicalIndex,
        kept: d.kept,
        reason: d.reason,
        inputLessons: d.inputLessons,
        keptLessons: d.keptLessons,
        drops: d.droppedLessons.map((x) => ({ i: x.index, reason: x.reason })),
        adjustments: d.adjustedLessons,
      })),
    };
    console.log(
      "[analyze-image] schoolWeeklyProfile debug:",
      JSON.stringify(summary, null, 2),
    );
    if (schoolWeeklyProfile) {
      console.log(
        "[analyze-image] schoolWeeklyProfile normalized:",
        JSON.stringify(schoolWeeklyProfile, null, 2),
      );
    }
  }

  return {
    title: typeof o.title === "string" ? o.title : "Uten tittel",
    schedule: (() => {
      if (normalizedSchedule.length > 0) return normalizedSchedule;
      return mappedSchedule;
    })(),
    scheduleByDay: (() => {
      if (normalizedScheduleByDay.length > 0) return normalizedScheduleByDay;
      return mappedScheduleByDay;
    })(),
    location:
      o.location === null || o.location === undefined
        ? null
        : String(o.location),
    description:
      typeof o.description === "string"
        ? o.description
        : fallbackDescriptionParts.length > 0
          ? fallbackDescriptionParts.join("\n")
          : "Ingen beskrivelse tilgjengelig.",
    category:
      o.category === null || o.category === undefined
        ? inferCategoryFromParentDays(parentDays)
        : parseCategory(o.category),
    targetGroup:
      o.targetGroup === null || o.targetGroup === undefined
        ? null
        : String(o.targetGroup),
    organizer:
      o.organizer === null || o.organizer === undefined
        ? null
        : String(o.organizer),
    contactPerson:
      o.contactPerson === null || o.contactPerson === undefined
        ? contacts.length > 0
          ? contacts.join("; ")
          : null
        : String(o.contactPerson),
    sourceUrl:
      o.sourceUrl === null || o.sourceUrl === undefined
        ? null
        : String(o.sourceUrl),
    confidence: clamp01(o.confidence),
    extractedText: normalizeExtractedText(o.extractedText),
    ...(schoolWeeklyProfile ? { schoolWeeklyProfile } : {}),
    ...(schoolWeeklyProfileDebug.rawRoot !== undefined &&
    schoolWeeklyProfileDebug.rawRoot !== null
      ? { schoolWeeklyProfileDebug }
      : {}),
  };
}

const TEXT_SYSTEM_PROMPT = `You are extracting useful daily information for a parent from a school plan, weekly plan, invitation, or similar document.

Your goal is NOT to simply repeat the document.
Your goal is to identify what is actually important to remember.

Focus especially on:
- tests, exams, quizzes, assessments
- deadlines and submission times
- special activities, trips, swimming, events, meetings
- things the child must bring or remember
- unusual schedule changes
- important practical messages for that specific day

Do NOT focus on:
- ordinary school hours unless they provide useful context
- generic subject lists without any important action
- long repetitive text that does not create action
- broad learning goals unless they clearly affect that day

Return structured JSON only.

Rules:
1. Group information by day whenever the document is organized by weekday.
2. For each day, extract only the most important actionable items.
3. If there is nothing special for a day, you may leave arrays empty.
4. If there are things to remember, put them in "rememberItems".
5. If there are deadlines, put them in "deadlines".
6. Keep each item short, concrete, and parent-friendly.
7. Do not invent information.
8. Use the language of the source document.
9. Include the day time only if it is clearly stated and useful.
10. If the document is a weekly plan, prioritize exceptions, assessments, reminders, and required equipment over ordinary schedule structure.
11. If a week number is present (e.g. "Uke 13", "Week 42") and weekdays are listed, calculate the exact calendar date for each weekday using ISO week numbering.
12. Infer the year from document context; if no explicit year is present, use the current calendar year unless context strongly suggests otherwise.
13. Do not leave "date" blank when week number + weekday is enough to calculate it.
14. Keep Norwegian date formatting when source language is Norwegian (example: "mandag 27. mars 2023").
15. A day should not be empty if meaningful school-related information exists (lesson content, homework, preparation, reminders, practical notices).
16. Include "I timen" information when it explains what the student is working on or preparing for.
17. Include homework/assignments/reading/writing/tasks in "notes" unless they clearly fit better in "deadlines".
18. Include reminders/NB/practical notices in "notes".
19. If there is no extraordinary event, still populate that day with concise schoolwork/task summaries.
20. Summarize into clean actionable language; do not copy long raw paragraphs.
21. If the source is a recurring weekly timetable (same subjects/periods every week: "timeplan", "ukeskjema", grid with clock times + subjects Mon–Fri), set "schoolWeeklyProfile" to an object and set "days" to []. Do not copy each lesson into "days".
22. For A-plans, one-off weekly activity plans, invitations, or week-specific narratives, set "schoolWeeklyProfile" to null and use "days" as usual.

Return this JSON shape:

{
  "title": string,
  "targetGroup": string | null,
  "days": [
    {
      "dayLabel": string,
      "date": string | null,
      "time": string | null,
      "highlights": string[],
      "rememberItems": string[],
      "deadlines": string[],
      "notes": string[]
    }
  ],
  "generalImportantInfo": string[],
  "contacts": string[],
  "schoolWeeklyProfile": null | {
    "gradeBand": string | null (class/year free text, e.g. "10B", "10. trinn", "VG2"; server maps to 1-4, 5-7, 8-10, vg1, vg2, vg3),
    "weekdays": object whose keys are "0"–"4" (Monday=0 … Friday=4), or man/tir/ons/tor/fre. Each value is either:
      { "useSimpleDay": true, "schoolStart": "HH:MM", "schoolEnd": "HH:MM" }
      or { "useSimpleDay": false, "lessons": [ { "subjectKey": string, "customLabel": string | null, "start": "HH:MM", "end": "HH:MM" } ] }
  }
}

Use English weekday keys only. subjectKey: lowercase slug from Norwegian subject name (norsk, matematikk, engelsk). customLabel when extra detail is needed. Times 24h HH:MM.`;

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY er ikke satt i miljøvariabler");
  }
  return new OpenAI({ apiKey });
}

/**
 * Nyere OpenAI-modeller (gpt-5.x, o-serien m.fl.) avviser `max_tokens` i
 * chat.completions og krever `max_completion_tokens`. Eldre modeller bruker
 * fortsatt `max_tokens`.
 */
function chatCompletionOutputTokenParam(
  model: string,
  maxOutput: number,
): { max_tokens: number } | { max_completion_tokens: number } {
  const m = model.trim().toLowerCase();
  if (
    m.includes("gpt-5") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4")
  ) {
    return { max_completion_tokens: maxOutput };
  }
  return { max_tokens: maxOutput };
}

function parseAIResponse(content: string | null | undefined): AIAnalysisResult {
  if (!content) {
    throw new Error("Tom respons fra OpenAI");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error("Kunne ikke tolke JSON fra modellen");
  }
  if (parsed && typeof parsed === "object") {
    const swp = (parsed as Record<string, unknown>).schoolWeeklyProfile;
    if (swp !== null && swp !== undefined) {
      diagSubjectPipeline({
        hypothesisId: "H1",
        phase: "after_openai_before_normalize",
        location: "analyze-image.ts:parseAIResponse",
        data: {
          rawSchoolWeeklyProfileSummary: summarizeRawSchoolProfileForDiag(swp),
        },
      });
    }
  }
  return normalizeAIAnalysisResult(parsed);
}

function parseAIResponseWithSource(
  content: string | null | undefined,
  sourceText: string
): AIAnalysisResult {
  if (!content) {
    throw new Error("Tom respons fra OpenAI");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error("Kunne ikke tolke JSON fra modellen");
  }
  if (parsed && typeof parsed === "object") {
    const swp = (parsed as Record<string, unknown>).schoolWeeklyProfile;
    if (swp !== null && swp !== undefined) {
      diagSubjectPipeline({
        hypothesisId: "H1",
        phase: "after_openai_before_normalize",
        location: "analyze-image.ts:parseAIResponseWithSource",
        data: {
          rawSchoolWeeklyProfileSummary: summarizeRawSchoolProfileForDiag(swp),
        },
      });
    }
  }
  return normalizeAIAnalysisResult(parsed, sourceText);
}

async function analyzeImageWithModel(
  imageBase64: string,
  model: string,
): Promise<AIAnalysisResult> {
  const openai = getOpenAIClient();
  const imageUrl = toDataUrl(imageBase64);

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Analyser bildet og returner JSON som beskrevet." },
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
        ],
      },
    ],
    response_format: { type: "json_object" },
    ...chatCompletionOutputTokenParam(model, 2800),
    temperature: 0.2,
  });

  return parseAIResponse(completion.choices[0]?.message?.content);
}

async function analyzeTextWithModel(
  text: string,
  model: string,
): Promise<AIAnalysisResult> {
  const openai = getOpenAIClient();

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: TEXT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyser følgende tekst og returner JSON som beskrevet:\n\n${text}`,
      },
    ],
    response_format: { type: "json_object" },
    ...chatCompletionOutputTokenParam(model, 4000),
    temperature: 0.2,
  });

  return parseAIResponse(completion.choices[0]?.message?.content);
}

function runRoutedImageAnalysis(
  imageBase64: string,
  input: AnalysisModelRoutingInput,
): Promise<{ result: AIAnalysisResult; modelTrace: AnalysisModelTrace }> {
  const initial = selectInitialAnalysisModel(input);
  return runRoutedVisionLikeAnalysis(initial, (model) =>
    analyzeImageWithModel(imageBase64, model),
  );
}

function runRoutedTextAnalysis(
  text: string,
  input: AnalysisModelRoutingInput,
): Promise<{ result: AIAnalysisResult; modelTrace: AnalysisModelTrace }> {
  const initial = selectInitialAnalysisModel(input);
  return runRoutedVisionLikeAnalysis(initial, (model) =>
    analyzeTextWithModel(text, model),
  );
}

/**
 * Felles retry: ved lett modell → én eskalering til sterk ved feil eller «svakt» resultat.
 */
async function runRoutedVisionLikeAnalysis(
  initial: ReturnType<typeof selectInitialAnalysisModel>,
  runWithModel: (model: string) => Promise<AIAnalysisResult>,
): Promise<{ result: AIAnalysisResult; modelTrace: AnalysisModelTrace }> {
  const strong = getStrongAnalysisModel();
  const trace = emptyAnalysisModelTrace(initial);

  console.log("[analysis-model] initial", {
    model: initial.model,
    tier: initial.tier,
    reason: initial.reason,
  });

  try {
    let result = await runWithModel(initial.model);
    if (initial.tier === "light") {
      const weak = analysisLooksWeakForEscalation(result);
      if (weak.weak) {
        trace.reasons.push(`escalate:weak:${weak.reason ?? "unknown"}`);
        result = await runWithModel(strong);
        trace.escalated = true;
        trace.finalModel = strong;
        console.log("[analysis-model] escalated (weak)", { finalModel: strong });
      }
    }
    return { result, modelTrace: trace };
  } catch (err) {
    if (initial.tier === "light") {
      trace.reasons.push(
        `escalate:error:${err instanceof Error ? err.message : String(err)}`,
      );
      const result = await runWithModel(strong);
      trace.escalated = true;
      trace.finalModel = strong;
      console.warn("[analysis-model] escalated (error)", {
        finalModel: strong,
        err,
      });
      return { result, modelTrace: trace };
    }
    throw err;
  }
}

/** Bildeanalyse med modell-routing (lett/sterk + eskalering). */
export async function analyzeImageWithRouting(
  imageBase64: string,
  input: AnalysisModelRoutingInput,
): Promise<{ result: AIAnalysisResult; modelTrace: AnalysisModelTrace }> {
  return runRoutedImageAnalysis(imageBase64, input);
}

/** Tekstanalyse med modell-routing. */
export async function analyzeTextWithRouting(
  text: string,
  input: AnalysisModelRoutingInput,
): Promise<{ result: AIAnalysisResult; modelTrace: AnalysisModelTrace }> {
  return runRoutedTextAnalysis(text, input);
}
