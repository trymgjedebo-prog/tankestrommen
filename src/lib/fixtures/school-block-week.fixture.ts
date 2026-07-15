/**
 * Syntetisk/anonymisert fixture for `buildSchoolBlockProposal`-tester. Bevarer strukturen fra
 * den verifiserte skoleanalysen, men uten ekte personnavn (lærer → «Lærer C»). Tilfredsstiller
 * de faktiske TypeScript-typene uten `as any`/`as unknown as`. Fabrikk-funksjoner returnerer
 * FERSKE objekter per kall, slik at mutasjons-tester kan sammenligne før/etter trygt.
 */
import type {
  AIAnalysisResult,
  ClassScheduleEntry,
  DayScheduleEntry,
} from "@/lib/types";
import type { PortalRelevanceChild } from "@/lib/portal-import-person";

function makeDay(partial: Partial<DayScheduleEntry>): DayScheduleEntry {
  return {
    dayLabel: null,
    date: null,
    time: null,
    details: null,
    highlights: [],
    rememberItems: [],
    deadlines: [],
    notes: [],
    ...partial,
  };
}

function makeClassEntry(partial: Partial<ClassScheduleEntry>): ClassScheduleEntry {
  return {
    date: null,
    dayLabel: null,
    activityTitle: null,
    classCodes: [],
    groupLabel: null,
    start: null,
    end: null,
    room: null,
    teacher: null,
    sourceText: null,
    confidence: 0.9,
    ...partial,
  };
}

/** Minimal, fullt typet AIAnalysisResult med tomme dagkilder — for ad-hoc test-varianter. */
export function makeMinimalAnalysisResult(
  overrides: Partial<AIAnalysisResult> = {},
): AIAnalysisResult {
  return {
    title: "Skoleuke",
    schedule: [],
    scheduleByDay: [],
    location: null,
    description: "",
    category: "beskjed",
    targetGroup: null,
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    extractedText: { raw: "", language: "no", confidence: 0.9 },
    ...overrides,
  };
}

/**
 * Hoved-fixture: avslutningsuke for VG2 2STC. Dagene er i IKKE-kronologisk inputrekkefølge
 * (ons, man, fre, tir, drop-rad) for å teste sortering. Mandag finnes i BEGGE dagkilder med
 * ulikt datoformat (`scheduleByDay`: «mandag 15. juni 2026», `classScheduleEntries`:
 * «2026-06-15») og skal slås sammen til én dag. Klassekoden 2STC er tydelig til stede for
 * deterministisk barnematch; rom «332-50» beholdt; lærer anonymisert til «Lærer C».
 */
export function makeSchoolBlockWeekResult(): AIAnalysisResult {
  return makeMinimalAnalysisResult({
    title: "Uke 25 – avslutningsuke",
    targetGroup: "VG2 – 2STA, 2STB, 2STC",
    confidence: 0.97,
    description: "Avslutningsuke for 2STC med bokinnlevering og pulje-opplegg.",
    extractedText: {
      raw: "Uke 25. Bokinnlevering 2STC 10.30-11.00. Pulje 1: 2STC rom 332-50.",
      language: "no",
      confidence: 0.9,
    },
    scheduleByDay: [
      makeDay({
        dayLabel: "Onsdag",
        date: "onsdag 17. juni 2026",
        details: "Elevens oppmøte kl. 10.30. Bokinnlevering for alle som har hatt eksamen.",
      }),
      makeDay({
        dayLabel: "Mandag",
        date: "mandag 15. juni 2026",
        details: "Bokinnlevering 2STC 10.30-11.00.",
      }),
      makeDay({
        dayLabel: "Fredag",
        date: "fredag 19. juni 2026",
        details: "Siste skoledag. Opplegg 09.00-12.00.",
      }),
      makeDay({
        dayLabel: "tirsdag",
        date: null,
        details: "Klasseavslutning for 2STC (tid avtales med lærer).",
      }),
      makeDay({
        dayLabel: "Generell info",
        date: null,
        details: "Husk å levere alle skolebøker før sommeren.",
      }),
    ],
    classScheduleEntries: [
      makeClassEntry({
        date: "2026-06-15",
        dayLabel: "mandag",
        activityTitle: "Bokinnlevering",
        classCodes: ["2STC"],
        start: "10:30",
        end: "11:00",
        sourceText: "2STC: 10.30-11.00",
        confidence: 0.98,
      }),
      makeClassEntry({
        date: "2026-06-18",
        dayLabel: "torsdag",
        classCodes: ["2STC"],
        groupLabel: "Pulje 1",
        start: "11:15",
        end: "12:15",
        room: "332-50",
        teacher: "Lærer C",
        sourceText: "2STC: rom 332-50 med Lærer C",
        confidence: 0.92,
      }),
    ],
  });
}

/** Barnet dokumentet gjelder (VG2 2STC). */
export const CHILD_2STC_CLASS_CODE = "2STC";

/** Fersk children-liste: ett matchende barn (2STC) + ett ikke-matchende (10B). */
export function makeChildren(): PortalRelevanceChild[] {
  return [
    { personId: "child-2stc", classCode: "2STC" },
    { personId: "child-10b", classCode: "10B" },
  ];
}
