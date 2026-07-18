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

/** Diagnostikk når PDF/Word analyseres med tillegg fra innsatte bilder / rasteriserte sider. */
export type DocumentVisualExtractionDebug = {
  documentEmbeddedImagesDetected?: number;
  documentEmbeddedImagesAnalyzed?: number;
  documentImageAnalysisUsedAsSupplement?: boolean;
  documentImageAnalysisUsedAsFallback?: boolean;
  documentTextLayerWeak?: boolean;
  documentEmbeddedFileDetected?: boolean;
};

/** Satt av API ved bilde/PDF/Word, ikke av språkmodellen. */
export type AnalysisSourceHint =
  | {
      type: "pdf";
      fileName: string;
      pageCount: number;
      fileUrl?: string;
      documentVisualExtractionDebug?: DocumentVisualExtractionDebug;
    }
  | {
      type: "docx";
      fileName: string;
      fileUrl?: string;
      documentVisualExtractionDebug?: DocumentVisualExtractionDebug;
    }
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
  /** Klasserom/lokale når synlig i kilden (f.eks. «203», «Gymsal»), ellers utelatt/null. */
  room?: string | null;
  /** Lærer når synlig i kilden (navn eller initialer), ellers utelatt/null. */
  teacher?: string | null;
  /**
   * Oppløst spor/variant for valgfag/språkfag (f.eks. «Tysk», «Programmering»).
   * Speiler Foreldre-Appens `lessonSubcategory`. Utelates når faget ikke har spor.
   */
  lessonSubcategory?: string | null;
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
  /** Slug (aldrig tom); Foreldre-App krever gyldig nøkkel per update. */
  subjectKey: string;
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
  /**
   * Når satt (f.eks. for `documentKind: activity_plan`), prioriteres ordrett/bevarende tekst
   * i overlay-seksjoner og kortere oppsummeringer — valgfri kontrakt for klienter.
   */
  overlayTextMode?: "preserve_source" | "standard";
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

/**
 * Per-klasse-lokasjon når kilden eksplisitt kobler klasse → rom/lærer (f.eks.
 * «2STA: rom 332-40 med Andreas Vågen»). classCode skrives SOM I KILDEN (visning);
 * frontend normaliserer selv for sammenligning/utheving. room/teacher utelates når
 * fraværende (optional-uten-null på wire). Flat `location` beholdes som fallback.
 */
export interface ClassLocation {
  classCode: string;
  room?: string;
  teacher?: string;
}

/**
 * Strukturert klasse-/puljeplan-oppføring (rå analysenivå). Additivt, inert felt: settes kun
 * når modellen eksplisitt emitterer det (ingen prompt-regel gjør det ennå). Bevarer koblingen
 * mellom aktivitet, klasse(r)/pulje, tid, rom og lærer som `ClassLocation` (uten tid) og fritekst
 * i `scheduleByDay` ikke kan uttrykke. Forbrukes senere av `buildSchoolBlockProposal`.
 */
export interface ClassScheduleEntry {
  /**
   * Eksplisitt dato for aktiviteten når kilden oppgir den.
   * ISO YYYY-MM-DD etter normalisering, ellers null.
   */
  date: string | null;

  /**
   * Ukedags-/dagsetikett fra kilden, for eksempel «Mandag».
   * Trimmet, men ellers bevart.
   */
  dayLabel: string | null;

  /**
   * Aktiviteten denne klasse-/puljeoppføringen gjelder.
   * Eksempel: «Bokinnlevering», «Matteeksamen».
   */
  activityTitle: string | null;

  /**
   * Én eller flere eksplisitte klassekoder.
   * Flere koder betyr at klassene deler samme pulje/tid/rom/lærer.
   */
  classCodes: string[];

  /** Pulje- eller gruppenavn fra kilden, ellers null. */
  groupLabel: string | null;

  /** Normalisert HH:MM, ellers null. */
  start: string | null;

  /** Normalisert HH:MM, ellers null. */
  end: string | null;

  room: string | null;
  teacher: string | null;

  /** Ordrett eller nær-ordrett kildelinje som binder feltene sammen. */
  sourceText: string | null;

  /** Normalisert til intervallet 0–1. */
  confidence: number;
}

/**
 * Strukturert dagsoperasjons-signal (rå analysenivå). Additivt, valgfritt felt: settes kun når
 * modellen eksplisitt emitterer det. Beskriver at HELE elevens skoledag påvirkes — forsinket
 * start, tidligere slutt, eller et heldekkende spesialprogram som erstatter ordinær undervisning.
 * Fravær/tom liste = ingen strukturert dagsoperasjon (ingen eksplisitt `none`-entry i råkontrakten).
 * Konsumeres deterministisk av `buildSchoolBlockProposal` → `SchoolBlockDayOperation`. Builderen
 * tolker ALDRI fritekst; dette feltet er den eneste strukturerte kilden til dagsoperasjoner.
 */
export type SchoolDayOperationSignalOperation =
  | "adjust_start"
  | "adjust_end"
  | "replace_day";

/** Felles dagsscope + evidens for alle signaltyper (etter normalisering). */
export interface SchoolDayOperationSignalBase {
  /** Eksplisitt ISO YYYY-MM-DD etter normalisering, ellers null. Aldri gjettet. */
  date: string | null;
  /** Normalisert mandag–fredag-indeks ("0"–"4"), ellers null. */
  weekdayIndex: SchoolProfileWeekdayIndex | null;
  /** Trimmet dagsetikett fra kilden, ellers null. */
  dayLabel: string | null;
  /** Kort begrunnelse fra kilden, ellers null. */
  reason: string | null;
  /** Ikke-tom støttende kildetekst (evidens, ikke modellens resonnement). */
  sourceText: string;
  /** Normalisert til intervallet 0–1. */
  confidence: number;
}

/** Hele elevens skoledag/oppmøte starter på dette tidspunktet (ingen sluttid). */
export interface SchoolDayAdjustStartSignal extends SchoolDayOperationSignalBase {
  operation: "adjust_start";
  effectiveStart: string;
}

/** Hele skoledagen slutter på dette tidspunktet (ingen starttid). */
export interface SchoolDayAdjustEndSignal extends SchoolDayOperationSignalBase {
  operation: "adjust_end";
  effectiveEnd: string;
}

/** Ordinær undervisning erstattes av et heldekkende spesialprogram (nullable samlet start/slutt). */
export interface SchoolDayReplaceSignal extends SchoolDayOperationSignalBase {
  operation: "replace_day";
  activityKind: SchoolBlockActivityKind;
  effectiveStart: string | null;
  effectiveEnd: string | null;
}

export type SchoolDayOperationSignal =
  | SchoolDayAdjustStartSignal
  | SchoolDayAdjustEndSignal
  | SchoolDayReplaceSignal;

export interface AIAnalysisResult {
  title: string;
  schedule: TimeSlot[];
  /** Fylles ut når kilden tydelig er ukeplan / flere dager med egen info per dag. */
  scheduleByDay: DayScheduleEntry[];
  location: string | null;
  /** Per-klasse-lokasjon (kun ved eksplisitt klasse→rom/lærer-kobling i kilden). */
  classLocations?: ClassLocation[];
  /**
   * Strukturert klasse-/puljeplan (aktivitet→klasse(r)→tid→rom→lærer). Additivt, inert:
   * settes kun når modellen emitterer det (ingen prompt gjør det ennå). Utelates når tom.
   */
  classScheduleEntries?: ClassScheduleEntry[];
  /**
   * Strukturerte dagsoperasjons-signaler (forsinket start / tidligere slutt / erstatningsdag).
   * Additivt, valgfritt: settes kun når modellen emitterer det. Utelates når tom. Konsumeres av
   * `buildSchoolBlockProposal` for deterministisk `dayOperation`/`dayResolution`.
   */
  schoolDayOperationSignals?: SchoolDayOperationSignal[];
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
  /** Valgfri aggregering av OpenAI chat.completions usage (tekst/bilde-kall). */
  tokenUsageCalls?: Array<{
    model: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  }>;
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

/**
 * Kanonisk wire-type for person-/barnematch-status på portal-forslag.
 * Definert her (types) som eneste kilde; `portal-import-person` re-eksporterer den.
 */
export type PortalEventPersonMatchStatus =
  | "not_specified"
  | "unmatched_document_name"
  | "matched"
  /** Vei 1 (lag 2): children-liste sendt, men serveren kunne ikke velge ett barn → bruker velger. */
  | "child_unresolved";

/* ────────────────────────────────────────────────────────────────────────────
 * schoolBlockProposal — offisiell wire-kontrakt (schemaVersion "1.0.0").
 *
 * Ny, ADDITIV portal-bundle-nøkkel for `documentKind: "school"` (produseres senere).
 * Samler event-veiens strukturerte skoledata (fag, oppløst tid, klasse, rom, lærer,
 * pulje, berik/erstatt) i én representasjon Synka integrerer i barnets skoleblokk.
 * Denne commiten definerer KUN typene — ingen produsent, ruting eller innkobling.
 * ──────────────────────────────────────────────────────────────────────────── */

export type SchoolBlockProposalKind = "school_block";

/** Strukturell kvalitet (IKKE import-automatikk; brukeren godkjenner alltid previewen). */
export type SchoolBlockStructureStatus = "complete" | "review_required";

export type SchoolBlockAudienceScope = "common" | "per_audience";

/** Element-nivå-handling. `replace_day` er dag-nivå (se SchoolBlockDayOperation). */
export type SchoolBlockElementAction = "enrich" | "replace_range";

/** Avledet dags-oppsummering (presedens: full_replace > partial_replace > hours_adjusted > enrich_only). */
export type SchoolBlockDayResolution =
  | "enrich_only"
  | "partial_replace"
  | "full_replace"
  | "hours_adjusted";

/** Kun HELDAGS-aktivitetstyper; delayed_start/early_end er dayOperation, ikke activityKind. */
export type SchoolBlockActivityKind =
  | "exam_day"
  | "trip_day"
  | "activity_day"
  | "free_day"
  | "other";

export type SchoolBlockContentType =
  | "lesson"
  | "homework"
  | "assessment"
  | "reminder"
  | "resource"
  | "message"
  | "alternative_program";

export type SchoolBlockReviewCode =
  | "missing_time"
  | "ambiguous_subject"
  | "child_class_unresolved"
  | "unrecognized_activity"
  | "conflicting_actions"
  | "low_confidence";

export interface SchoolBlockReviewFlag {
  code: SchoolBlockReviewCode;
  message: string;
  /** Peker presist. `dayId` (IKKE dayIndex), `itemId`, `audienceEntryId` — alle valgfrie. */
  scope: { dayId?: string; itemId?: string; audienceEntryId?: string };
}

/** Arver overlay-bøttene; `descriptionLines` for alternativt opplegg (program/praktisk info). */
export interface SchoolBlockSections extends SchoolWeekOverlaySections {
  descriptionLines?: string[];
}

/** Én klasse-/pulje-oppføring med SIN egen tid/rom/lærer (bevarer koblingen strukturelt). */
export interface SchoolBlockAudienceEntry {
  audienceEntryId: string;
  classCodes: string[];
  pulje: string | null;
  start: string | null;
  end: string | null;
  room: string | null;
  teacher: string | null;
  /** true=barnets klasse; false=eksplisitt andre klasser (classCode kjent); null=ukjent/tvetydig. */
  isChildAudience: boolean | null;
}

export interface SchoolBlockContentItem {
  itemId: string;
  title: string;
  contentType: SchoolBlockContentType;
  action: SchoolBlockElementAction;

  subject: string | null;
  subjectKey: string | null;
  customLabel: string | null;
  subjectCandidates?: SchoolProfileLessonCandidate[];

  audienceScope: SchoolBlockAudienceScope;
  /** Felles tid/rom/lærer — kan være null (untimed fellesinfo). Kun ved "common". */
  commonSchedule:
    | { start: string | null; end: string | null; room: string | null; teacher: string | null }
    | null;
  /** Per-klasse/pulje-oppføringer. Kun ved "per_audience" (≥1). */
  audienceEntries: SchoolBlockAudienceEntry[];
  /** Oppløst for BARNET — kun når nøyaktig én entry matcher sikkert; ellers null. */
  resolvedChildAudience:
    | {
        audienceEntryId: string | null;
        start: string | null;
        end: string | null;
        room: string | null;
        teacher: string | null;
      }
    | null;

  sections: SchoolBlockSections;
  /** Satt når contentType="alternative_program"; ellers null. */
  activityKind: SchoolBlockActivityKind | null;

  evidence: string | null;
  sourceText: string | null;
  confidence: number;
  reviewFlags: SchoolBlockReviewFlag[];
}

/** Diskriminert dags-operasjon: skiller hel erstatning fra start-/slutt-justering. */
export type SchoolBlockDayOperation =
  | { op: "none" }
  | {
      op: "replace_day";
      activityKind: SchoolBlockActivityKind;
      effectiveStart: string | null;
      effectiveEnd: string | null;
      reason: string | null;
      confidence: number;
    }
  | { op: "adjust_start"; effectiveStart: string; reason: string | null; confidence: number }
  | { op: "adjust_end"; effectiveEnd: string; reason: string | null; confidence: number };

export interface SchoolBlockDay {
  dayId: string;
  date: string | null;
  weekdayIndex: SchoolProfileWeekdayIndex | null;
  dayLabel: string | null;

  /** Dynamisk overskrift; kun ved full_replace, ellers null. */
  blockTitle: string | null;
  dayOperation: SchoolBlockDayOperation;
  dayResolution: SchoolBlockDayResolution;

  contentItems: SchoolBlockContentItem[];

  confidence: number;
  evidence: string | null;
  reviewFlags: SchoolBlockReviewFlag[];
}

export interface SchoolBlockProposal {
  proposalId: string;
  kind: SchoolBlockProposalKind;
  schemaVersion: "1.0.0";
  sourceTitle: string;
  originalSourceType: string;
  confidence: number;

  personId: string | null;
  /** Eneste kilde til match-status — gjenbruker eksisterende union. */
  personMatchStatus: PortalEventPersonMatchStatus;
  classCode: string | null;

  /** Valgfri → én-dags-støtte (ingen ukenummer-krav). */
  weekNumber?: number | null;
  days: SchoolBlockDay[];

  /** Eneste readiness-felt (strukturell kvalitet). */
  structureStatus: SchoolBlockStructureStatus;
  reviewFlags: SchoolBlockReviewFlag[];

  languageTrack?: { resolvedTrack: string | null; confidence: number; reason: string };
}
