import OpenAI from "openai";
import type {
  AIAnalysisResult,
  DayScheduleEntry,
  EventCategory,
  ExtractedText,
  SchoolProfileGradeBand,
  SchoolProfileLesson,
  SchoolProfileWeekday,
  SchoolProfileWeekdayIndex,
  SchoolWeeklyProfile,
  TimeSlot,
} from "@/lib/types";

const VISION_MODEL = "gpt-4o-mini";

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
  Objektet har:
  - gradeBand: trinn/klasse fritekst (f.eks. «10. trinn», «10B», «VG2») eller null – serveren normaliserer til Foreldre-App-koder
  - weekdays: objekt med nøkler "0"–"4" (0=mandag … 4=fredag), alternativt man/tir/ons/tor/fre. Lørdag/søndag ikke i skoleprofil-MVP. Hver verdi er ENTEN:
    - { "useSimpleDay": true, "schoolStart": "HH:MM", "schoolEnd": "HH:MM" } når bare skolestart/-slutt er oppgitt, ELLER
    - { "useSimpleDay": false, "lessons": [ { "subjectKey": "norsk", "customLabel": null eller tekst, "start": "HH:MM", "end": "HH:MM" }, ... ] }
  subjectKey: kort slug på norsk fagnavn i små bokstaver og bindestrek (norsk, matematikk, engelsk, naturfag, samfunnsfag, kroppsoving, musikk, kunst_og_håndverk, osv.). Bruk customLabel når faget trenger presisering (f.eks. «Spansk valgfag»).
  Tider: 24-timersformat HH:MM.

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

function normalizeSchoolProfileLesson(raw: unknown): SchoolProfileLesson | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const fromKey = typeof o.subjectKey === "string" ? o.subjectKey.trim() : "";
  const fromSubj = typeof o.subject === "string" ? o.subject.trim() : "";
  const key = slugifySubjectKey(fromKey) || slugifySubjectKey(fromSubj);
  if (!key) return null;
  const start = normalizeHHMM(asNonEmptyString(o.start));
  const end = normalizeHHMM(asNonEmptyString(o.end));
  if (!start || !end) return null;
  return {
    subjectKey: key,
    customLabel: asNonEmptyString(o.customLabel),
    start,
    end,
  };
}

function normalizeSchoolProfileWeekday(raw: unknown): SchoolProfileWeekday | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  if (o.useSimpleDay === true) {
    const schoolStart = normalizeHHMM(asNonEmptyString(o.schoolStart));
    const schoolEnd = normalizeHHMM(asNonEmptyString(o.schoolEnd));
    if (!schoolStart || !schoolEnd) return null;
    return { useSimpleDay: true, schoolStart, schoolEnd };
  }

  if (Array.isArray(o.lessons)) {
    const lessons = o.lessons
      .map(normalizeSchoolProfileLesson)
      .filter((x): x is SchoolProfileLesson => x !== null);
    if (lessons.length === 0) return null;
    return { useSimpleDay: false, lessons };
  }

  return null;
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
): SchoolWeeklyProfile | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rawGrade =
    o.gradeBand === null || o.gradeBand === undefined
      ? null
      : asNonEmptyString(o.gradeBand);

  const gradeBand = normalizeGradeBandForPortal(rawGrade, [
    context?.title,
    context?.targetGroup,
    context?.description,
  ]);

  let weekdays: Partial<Record<SchoolProfileWeekdayIndex, SchoolProfileWeekday>> =
    {};

  if (Array.isArray(o.weekdays)) {
    for (const row of o.weekdays) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const wk =
        typeof r.weekday === "string"
          ? canonicalSchoolProfileWeekdayIndex(r.weekday)
          : null;
      if (!wk) continue;
      const entry = normalizeSchoolProfileWeekday(r);
      if (entry) weekdays[wk] = entry;
    }
  } else if (o.weekdays && typeof o.weekdays === "object") {
    for (const [key, val] of Object.entries(o.weekdays as Record<string, unknown>)) {
      const wk = canonicalSchoolProfileWeekdayIndex(key);
      if (!wk) continue;
      const entry = normalizeSchoolProfileWeekday(val);
      if (entry) weekdays[wk] = entry;
    }
  }

  if (Object.keys(weekdays).length === 0) return null;
  return { gradeBand, weekdays };
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

  const schoolWeeklyProfile = normalizeSchoolWeeklyProfileRaw(
    o.schoolWeeklyProfile,
    {
      title: titleForGradeContext,
      targetGroup: targetGroupForGradeContext,
      description: descriptionForGradeContext,
    },
  );

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
  return normalizeAIAnalysisResult(parsed, sourceText);
}

export async function analyzeImage(
  imageBase64: string
): Promise<AIAnalysisResult> {
  const openai = getOpenAIClient();
  const imageUrl = toDataUrl(imageBase64);

  const completion = await openai.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Analyser bildet og returner JSON som beskrevet." },
          { type: "image_url", image_url: { url: imageUrl, detail: "auto" } },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 2800,
    temperature: 0.2,
  });

  return parseAIResponse(completion.choices[0]?.message?.content);
}

export async function analyzeText(
  text: string
): Promise<AIAnalysisResult> {
  const openai = getOpenAIClient();

  const completion = await openai.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      { role: "system", content: TEXT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyser følgende tekst og returner JSON som beskrevet:\n\n${text}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 4000,
    temperature: 0.2,
  });

  return parseAIResponse(completion.choices[0]?.message?.content);
}
