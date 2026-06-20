/**
 * Tankestrømmen eval-matrise (dokumentasjon/spesifikasjon — IKKE en kjørende scorer).
 *
 * Formål: beskrive HVA Tankestrømmen skal måles på *bredt* — ikke bare cup/Høstcup —
 * før vi vurderer flere modeller, API-nøkler, Braintrust eller LLM-as-judge.
 *
 * Denne filen introduserer bevisst INGEN nye scorer-funksjoner. Den refererer til
 * eksisterende deterministiske scorers i {@link ./tankestrom-scorers} ved navn, og markerer
 * tydelig hvor dagens scorer-sett mangler dekning (`gapsNeedingNewScorers`) og hvilke
 * kvalitetsvurderinger som senere egner seg som LLM-as-judge (`judgeCandidates`).
 *
 * Matrisen er ren data + typer (ingen imports), slik at den ikke kan påvirke produksjons-
 * eller analyse-/parserlogikk.
 */

/** Output-typer Foreldre-Appen forventer fra Tankestrømmen. */
export type ScoredOutputField =
  | "calendar_events"
  | "attendance_times"
  | "end_times_duration"
  | "tasks_due_time"
  | "bring_remember_items"
  | "tentative_conditional"
  | "multi_day_program"
  | "portal_bundle_shape"
  | "no_false_positives"
  | "location_person_routing";

/** Hvor godt kategorien er dekket av dagens fixtures/expected. */
export type CoverageStatus = "well_covered" | "partial" | "missing";

export type EvalCategoryId =
  | "cup_tournament"
  | "multi_day_activity"
  | "single_calendar_event"
  | "recurring_activity"
  | "deadline_task_only"
  | "school_week_overlay"
  | "tentative_conditional"
  | "date_time_year_robustness"
  | "negative_noise_input"
  | "multi_topic_multi_child";

export type EvalCategory = {
  id: EvalCategoryId;
  title: string;
  /** Hva caset dekker (parent-vennlig beskrivelse). */
  description: string;
  /** Output-felter som bør scores for denne kategorien. */
  scoredFields: ScoredOutputField[];
  /**
   * Deterministiske scorer-kandidater. Navn som finnes i `tankestrom-scorers.ts` i dag er
   * markert uten suffiks; foreslåtte, ennå ikke-implementerte scorers står i `gapsNeedingNewScorers`.
   */
  deterministicScorers: string[];
  /** Felter/sjekker som ville krevd NYE deterministiske scorers (ikke laget ennå). */
  gapsNeedingNewScorers: string[];
  /** Kvalitetsvurderinger som senere kan være LLM-as-judge (subjektiv fritekst-kvalitet). */
  judgeCandidates: string[];
  /** Dekning i dagens fixtures. */
  coverage: CoverageStatus;
  /** Eksisterende fixture-id-er som representerer kategorien (tom = mangler). */
  exampleFixtures: string[];
  /** Forslag til nye fixture-id-er for å lukke gap. */
  proposedFixtures: string[];
};

/**
 * Deterministiske scorers som finnes i dag (jf. `runAllTankestromScorers`).
 * Brukes for å skille «dekket av eksisterende scorer» fra «trenger ny scorer».
 */
export const EXISTING_DETERMINISTIC_SCORERS = [
  "parentCountCorrect",
  "childCountCorrect",
  "cleanTitlesCritical",
  "titleMatchesExpectedStyle",
  "highlightsCorrect",
  "forbiddenInNotes",
  "noDuplicateDays",
  "noEventTitleAsHighlight",
  "noStructureFallbackInNotes",
  "correctTimePrecision",
  "tentativeCorrect",
  "bringItemsCorrect",
  "deadlineCorrect",
  "noDeadlineInProgramHighlights",
  "inferredEndCorrect",
  "durationMinutesCorrect",
  "endTimeSourceCorrect",
  "forbiddenProgramTimes",
] as const;

export const TANKESTROM_EVAL_MATRIX: EvalCategory[] = [
  {
    id: "cup_tournament",
    title: "Cup / turnering (flerdags arrangement)",
    description:
      "Helg-/turneringsprogram med oppmøtetider, kampstart, varighet/sluttid og tentativ siste dag. " +
      "Parent-arrangement med embeddedSchedule per dag.",
    scoredFields: [
      "calendar_events",
      "attendance_times",
      "end_times_duration",
      "multi_day_program",
      "tasks_due_time",
      "tentative_conditional",
      "portal_bundle_shape",
    ],
    deterministicScorers: [
      "parentCountCorrect",
      "childCountCorrect",
      "cleanTitlesCritical",
      "highlightsCorrect",
      "correctTimePrecision",
      "tentativeCorrect",
      "inferredEndCorrect",
      "durationMinutesCorrect",
      "endTimeSourceCorrect",
      "deadlineCorrect",
      "noDeadlineInProgramHighlights",
      "forbiddenProgramTimes",
    ],
    gapsNeedingNewScorers: [],
    judgeCandidates: [
      "Er highlight-formuleringene parent-vennlige og entydige?",
      "Er tentativ-hedging på siste dag riktig formulert (ikke for skråsikker)?",
    ],
    coverage: "well_covered",
    exampleFixtures: [
      "vaacup_original",
      "hostcup_handball",
      "hostcup_duration_endtime_rich",
      "cup_mixed_days_deadlines_relative_attendance",
    ],
    proposedFixtures: [],
  },
  {
    id: "multi_day_activity",
    title: "Flerdags aktivitet / tur",
    description:
      "Speiderhelg, leirskole, turnstevne o.l. Avreise-/retur-tider, pakke-/ta-med-lister, " +
      "ofte uten kamptider men med flerdagsprogram.",
    scoredFields: [
      "calendar_events",
      "bring_remember_items",
      "multi_day_program",
      "tentative_conditional",
      "portal_bundle_shape",
    ],
    deterministicScorers: [
      "childCountCorrect",
      "cleanTitlesCritical",
      "highlightsCorrect",
      "bringItemsCorrect",
      "correctTimePrecision",
      "tentativeCorrect",
      "noDeadlineInProgramHighlights",
    ],
    gapsNeedingNewScorers: [
      "weekday-generalisering (man–søn, ikke bare fre/lør/søn) for turer som ikke er helg",
    ],
    judgeCandidates: [
      "Fanget ta-med-listen alt en forelder trenger uten å duplisere?",
    ],
    coverage: "well_covered",
    exampleFixtures: ["speiderhelg", "turnstevne"],
    proposedFixtures: ["leirskole_man_fre"],
  },
  {
    id: "single_calendar_event",
    title: "Enkelt kalenderhendelse",
    description:
      "Én hendelse (foreldresamtale, legetime, enkelt trening, konsert). Dato + start + ev. sluttid + sted. " +
      "Eval-shape `single_event`.",
    scoredFields: [
      "calendar_events",
      "attendance_times",
      "end_times_duration",
      "bring_remember_items",
      "location_person_routing",
      "no_false_positives",
    ],
    deterministicScorers: [
      "parentCountCorrect",
      "childCountCorrect",
      "cleanTitlesCritical",
      "titleMatchesExpectedStyle",
      "correctTimePrecision",
      "bringItemsCorrect",
    ],
    gapsNeedingNewScorers: [
      "scoreEventDateExact (eksakt dato/år-match for enkelt-event)",
      "scoreLocation (sted som eget felt scores ikke i dag)",
    ],
    judgeCandidates: [
      "Er tittelen kort og forelder-lesbar uten å miste det viktigste?",
    ],
    coverage: "partial",
    exampleFixtures: ["spond_lagtrening_fredag"],
    proposedFixtures: ["foreldresamtale_enkelt", "legetime_enkelt"],
  },
  {
    id: "recurring_activity",
    title: "Tilbakevendende aktivitet",
    description:
      "Ukentlig/repeterende plan («trening hver tirsdag 17–18», «svømming onsdager»). " +
      "Skal gi en recurrence, ikke N dupliserte enkelt-events.",
    scoredFields: [
      "calendar_events",
      "attendance_times",
      "end_times_duration",
      "no_false_positives",
    ],
    deterministicScorers: ["cleanTitlesCritical", "correctTimePrecision"],
    gapsNeedingNewScorers: [
      "scoreRecurrenceRule (gjentakelsesregel + dag + start/slutt)",
      "scoreNoHallucinatedEvents (ingen per-uke-duplikater)",
    ],
    judgeCandidates: [
      "Er gjentakelsen beskrevet tydelig nok for en forelder (når, hvor ofte, til når)?",
    ],
    coverage: "missing",
    exampleFixtures: [],
    proposedFixtures: ["ukentlig_trening_tirsdag", "svomming_onsdager"],
  },
  {
    id: "deadline_task_only",
    title: "Ren frist / task",
    description:
      "Melding som primært er en frist/oppgave («meld på innen onsdag 20:00», betaling, samtykkeskjema) " +
      "uten program. Skal bli task med dueTime, og IKKE skape falske program-events.",
    scoredFields: ["tasks_due_time", "no_false_positives"],
    deterministicScorers: [
      "deadlineCorrect",
      "noDeadlineInProgramHighlights",
      "forbiddenProgramTimes",
    ],
    gapsNeedingNewScorers: [
      "scoreNoHallucinatedEvents (forventet 0 program-events/0 falske highlights)",
    ],
    judgeCandidates: [
      "Er oppgavetittelen handlingsrettet og tydelig på hva forelderen må gjøre?",
    ],
    coverage: "partial",
    exampleFixtures: ["spond_lagtrening_fredag"],
    proposedFixtures: ["spond_frist_only", "betaling_frist_only"],
  },
  {
    id: "school_week_overlay",
    title: "Skoleuke / fag-overlay",
    description:
      "Ukeplan man–fre med fag, lekser, prøver, ta-med og beskjeder. Egen overlay-shape " +
      "(subjectUpdates per dag, seksjoner iTimen/lekse/prøve/husk) som scores i sin egen form.",
    scoredFields: [
      "multi_day_program",
      "bring_remember_items",
      "tasks_due_time",
      "portal_bundle_shape",
    ],
    deterministicScorers: ["bringItemsCorrect", "correctTimePrecision"],
    gapsNeedingNewScorers: [
      "weekday-generalisering (man–fre)",
      "scoreSchoolOverlayShape (fag × dag, seksjoner iTimen/lekse/prøve)",
    ],
    judgeCandidates: [
      "Er fag-/lekseoppsummeringen tro mot kilden uten å hallusinere oppgaver?",
    ],
    coverage: "partial",
    exampleFixtures: ["skole_uke12_foreldre"],
    proposedFixtures: ["skoleuke_fag_overlay_rik"],
  },
  {
    id: "tentative_conditional",
    title: "Tentativ / conditional plan",
    description:
      "Dag/plan som kun er betinget («dersom laget går videre», «avhenger av påmelding/vær»). " +
      "Skal bli date_only/tentativ og ikke arve konkrete tider fra andre dager.",
    scoredFields: ["tentative_conditional", "multi_day_program", "no_false_positives"],
    deterministicScorers: [
      "tentativeCorrect",
      "correctTimePrecision",
      "forbiddenProgramTimes",
    ],
    gapsNeedingNewScorers: [],
    judgeCandidates: [
      "Er usikkerheten kommunisert riktig (verken for skråsikker eller for vag)?",
    ],
    coverage: "well_covered",
    exampleFixtures: ["turnstevne", "cup_mixed_days_deadlines_relative_attendance"],
    proposedFixtures: ["betinget_paamelding_vaer"],
  },
  {
    id: "date_time_year_robustness",
    title: "Dato / tid / år-robusthet",
    description:
      "Stresser format-variasjon: DD.MM, «18. sept», ISO, ukenummer→år, «halv 8», «kl 9», «neste fredag». " +
      "Skal gi korrekt dato/år og timePrecision uavhengig av formuleringen.",
    scoredFields: ["calendar_events", "attendance_times"],
    deterministicScorers: ["correctTimePrecision"],
    gapsNeedingNewScorers: [
      "scoreEventDateExact (eksakt dato)",
      "scoreYearResolution (ukenummer/kontekst → riktig år)",
    ],
    judgeCandidates: [],
    coverage: "missing",
    exampleFixtures: [],
    proposedFixtures: ["datoformat_miks", "ukenummer_aar", "klokkeslett_uvanlig"],
  },
  {
    id: "negative_noise_input",
    title: "Negativ / støy-input",
    description:
      "Input som IKKE er en hendelse (nyhetsbrev, reklame, irrelevant tekst). " +
      "Skal gi 0 events og 0 tasks — hallucination guard.",
    scoredFields: ["no_false_positives"],
    deterministicScorers: ["childCountCorrect", "deadlineCorrect"],
    gapsNeedingNewScorers: [
      "scoreNoHallucinatedEvents (maks-antall / 0 falske events+tasks)",
    ],
    judgeCandidates: [
      "Ville en forelder oppfatte at det med rette ikke ble laget noen hendelse?",
    ],
    coverage: "missing",
    exampleFixtures: [],
    proposedFixtures: ["nyhetsbrev_uten_event"],
  },
  {
    id: "multi_topic_multi_child",
    title: "Multi-tema / multi-barn",
    description:
      "Én melding med flere tema (skole + cup + dugnad) eller flere barn/lag. " +
      "Krever korrekt segmentering/routing og person-tilordning uten kryss-lekkasje.",
    scoredFields: [
      "calendar_events",
      "location_person_routing",
      "portal_bundle_shape",
      "no_false_positives",
    ],
    deterministicScorers: ["childCountCorrect", "noDuplicateDays"],
    gapsNeedingNewScorers: [
      "scorePersonRouting (riktig barn/lag per hendelse)",
      "scoreDocumentRouting (riktig documentKind / proposal-path)",
    ],
    judgeCandidates: [
      "Er hvert tema korrekt skilt ut uten at info fra ett tema lekker til et annet?",
    ],
    coverage: "missing",
    exampleFixtures: [],
    proposedFixtures: ["multi_tema_skole_cup_dugnad", "multi_barn_lagmelding"],
  },
];

/** Kompakt dekningsoversikt (for rapport/CI-logging). */
export function summarizeMatrixCoverage(
  matrix: EvalCategory[] = TANKESTROM_EVAL_MATRIX,
): Record<CoverageStatus, EvalCategoryId[]> {
  const out: Record<CoverageStatus, EvalCategoryId[]> = {
    well_covered: [],
    partial: [],
    missing: [],
  };
  for (const c of matrix) out[c.coverage].push(c.id);
  return out;
}
