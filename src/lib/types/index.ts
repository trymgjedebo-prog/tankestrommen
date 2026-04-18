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

/** Ukedag-nøkler i API (matcher typisk lagring i Foreldre-App). */
export type SchoolProfileWeekdayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/** Én undervisningstime i en fast ukesplan. */
export interface SchoolProfileLesson {
  subjectKey: string;
  customLabel: string | null;
  start: string;
  end: string;
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
 * Gjentakende ukesplan (timeplan) – ikke én ukes A-plan.
 * Brukes til ChildSchoolProfile / faste skoleblokker i Foreldre-App.
 */
export interface SchoolWeeklyProfile {
  gradeBand: string | null;
  weekdays: Partial<Record<SchoolProfileWeekdayKey, SchoolProfileWeekday>>;
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
