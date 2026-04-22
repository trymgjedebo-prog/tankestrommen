export interface UploadedImage {
  file: File;
  previewUrl: string;
  name: string;
  size: number;
}

export interface ExtractedText {
  raw: string;
  language: string;
  confidence: number;
}

export type EventCategory =
  | "arrangement"
  | "frist"
  | "beskjed"
  | "trening"
  | "møte"
  | "annet";

export interface TimeSlot {
  date: string | null;
  time: string | null;
  label: string | null;
}

/** Per dag når innholdet er ukeplan, flerdagers plan eller lignende. Tom = ikke brukt. */
export interface DayScheduleEntry {
  dayLabel: string | null;
  date: string | null;
  time: string | null;
  details: string | null;
  highlights: string[];
  rememberItems: string[];
  deadlines: string[];
  notes: string[];
}

/** Satt av API ved bilde/PDF/Word, ikke av språkmodellen. */
export type AnalysisSourceHint =
  | { type: "pdf"; fileName: string; pageCount: number; fileUrl?: string }
  | { type: "docx"; fileName: string; fileUrl?: string }
  | { type: "image"; fileName: string; fileUrl?: string };

/**
 * Mandag = "0" … fredag = "4" (Foreldre-App `ChildSchoolProfile.weekdays`).
 * Lørdag/søndag inngår ikke i skoleprofil-MVP.
 */
export type SchoolProfileWeekdayIndex = "0" | "1" | "2" | "3" | "4";

/** Alternativt fag i samme tidsslot (f.eks. «Matte D1 / Norsk D2»). */
export interface SchoolProfileLessonCandidate {
  subjectKey: string;
  subject: string;
  /** 1 = foretrukket / først i kilden, lavere = mindre sannsynlig for dette barnet. */
  weight: number;
}

/** Én undervisningstime i en fast ukesplan. */
export interface SchoolProfileLesson {
  subjectKey: string;
  customLabel: string | null;
  start: string;
  end: string;
  /**
   * Valgfritt: hvis samme slot inneholder to valgfag/spor, legg dem her slik at
   * Foreldre-App kan matche til riktig fag for eleven. Utelates når bare ett fag.
   */
  subjectCandidates?: SchoolProfileLessonCandidate[];
}

export interface SchoolProfileWeekdaySimple {
  useSimpleDay: true;
  schoolStart: string;
  schoolEnd: string;
}

export interface SchoolProfileWeekdayLessons {
  useSimpleDay: false;
  lessons: SchoolProfileLesson[];
}

export type SchoolProfileWeekday =
  | SchoolProfileWeekdaySimple
  | SchoolProfileWeekdayLessons;

/**
 * Trinn-/program-bånd slik Foreldre-App validerer det på `ChildSchoolProfile`.
 */
export type SchoolProfileGradeBand =
  | "1-4"
  | "5-7"
  | "8-10"
  | "vg1"
  | "vg2"
  | "vg3";

/**
 * Gjentakende ukesplan (timeplan) – ikke én ukes A-plan.
 * Brukes til ChildSchoolProfile / faste skoleblokker i Foreldre-App.
 */
export interface SchoolWeeklyProfile {
  gradeBand: SchoolProfileGradeBand | null;
  weekdays: Partial<Record<SchoolProfileWeekdayIndex, SchoolProfileWeekday>>;
}

export interface SchoolWeekOverlaySections {
  iTimen?: string[];
  lekse?: string[];
  husk?: string[];
  proveVurdering?: string[];
  ressurser?: string[];
  ekstraBeskjed?: string[];
}

export interface SchoolWeekOverlaySubjectUpdate {
  subjectKey: string | null;
  customLabel?: string | null;
  sections: SchoolWeekOverlaySections;
}

export type SchoolWeekOverlayActionKind =
  | "remove_school_block"
  | "replace_school_block"
  | "enrich_existing_school_block";

export interface SchoolWeekOverlayDailyAction {
  action: SchoolWeekOverlayActionKind;
  reason?: string | null;
  summary?: string | null;
  subjectUpdates: SchoolWeekOverlaySubjectUpdate[];
}

export interface SchoolWeekOverlayProposal {
  proposalId: string;
  kind: "school_week_overlay";
  schemaVersion: "1.0.0";
  confidence: number;
  sourceTitle: string;
  originalSourceType: string;
  weekNumber: number | null;
  classLabel: string | null;
  weeklySummary: string[];
  languageTrack: {
    resolvedTrack: string | null;
    confidence: number;
    reason: string;
  };
  profileMatch: {
    confidence: number;
    reason: string;
  };
  dailyActions: Partial<Record<SchoolProfileWeekdayIndex, SchoolWeekOverlayDailyAction>>;
}

export interface AIAnalysisResult {
  title: string;
  schedule: TimeSlot[];
  /** Fylles ut når kilden tydelig er ukeplan / flere dager med egen info per dag. */
  scheduleByDay: DayScheduleEntry[];
  location: string | null;
  description: string;
  category: EventCategory;
  targetGroup: string | null;
  organizer: string | null;
  contactPerson: string | null;
  sourceUrl: string | null;
  confidence: number;
  extractedText: ExtractedText;
  /** Valgfri merking av kilde (f.eks. PDF med filnavn og antall sider). */
  sourceHint?: AnalysisSourceHint;
  /**
   * Når kilden er en fast timeplan (samme mønster hver uke).
   * Tom/undefined for A-plan, invitasjoner og ukespesifikt innhold.
   */
  schoolWeeklyProfile?: SchoolWeeklyProfile;
  /**
   * Intern diagnostikk for grid-timeplan-parsing. Serialiseres til klienten
   * kun når `?debug=1` er satt i portal-modus. Ikke en del av stabil kontrakt.
   */
  schoolWeeklyProfileDebug?: SchoolWeeklyProfileDebug;
  /**
   * Valgfri spor av modell-routing (lett/sterk, eskalering). Fjernes fra svar
   * når debug ikke er aktiv; brukes i `debug.analysisModel` i portal-modus.
   */
  analysisModelTrace?: AnalysisModelTrace;
}

/** Spor av hvilken OpenAI-modell som ble brukt (MVP routing). */
export interface AnalysisModelTrace {
  initialTier: "light" | "strong";
  initialModel: string;
  finalModel: string;
  escalated: boolean;
  reasons: string[];
}

/** Debug-rapport per dag fra normalisering av skoleprofil. */
export interface SchoolWeeklyProfileDebug {
  rawGradeBand: string | null;
  resolvedGradeBand: SchoolProfileGradeBand | null;
  days: Array<{
    rawKey: string;
    canonicalIndex: SchoolProfileWeekdayIndex | null;
    kept: boolean;
    reason?: string;
    inputLessons: number;
    keptLessons: number;
    droppedLessons: Array<{
      index: number;
      raw: unknown;
      reason: string;
    }>;
    adjustedLessons: Array<{
      index: number;
      subjectKey: string | null;
      changes: string[];
    }>;
  }>;
  rawRoot: unknown;
}

export interface ProposedEvent {
  title: string;
  schedule: TimeSlot[];
  scheduleByDay: DayScheduleEntry[];
  location: string;
  description: string;
  category: EventCategory;
  targetGroup: string;
  organizer: string;
  contactPerson: string;
  sourceUrl: string;
}

export interface ConfirmedEvent extends ProposedEvent {
  confirmedAt: string;
}

export type AnalysisInput =
  | { type: "image"; file: File }
  | { type: "pdf"; file: File }
  | { type: "docx"; file: File }
  | { type: "text"; text: string };
