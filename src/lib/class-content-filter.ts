import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";
import { lineIsRelevantForClass } from "@/lib/school-class-schedule";

function filterStringArray(arr: string[], childClassCode: string): string[] {
  return arr.filter((s) => lineIsRelevantForClass(s, childClassCode));
}

function filterDetails(details: string | null, childClassCode: string): string | null {
  if (!details) return details;
  return details
    .split(/\r?\n/)
    .filter((line) => lineIsRelevantForClass(line, childClassCode))
    .join("\n");
}

function filterDay(day: DayScheduleEntry, childClassCode: string): DayScheduleEntry {
  return {
    ...day,
    details: filterDetails(day.details, childClassCode),
    highlights: filterStringArray(day.highlights, childClassCode),
    rememberItems: filterStringArray(day.rememberItems, childClassCode),
    deadlines: filterStringArray(day.deadlines, childClassCode),
    notes: filterStringArray(day.notes, childClassCode),
  };
}

/**
 * Oppgave 7: filtrer ukeplan-INNHOLD til elevens klasse. Behold fellesinnhold (uten klassemarkør)
 * og innhold for barnets klasse; dropp innhold eksplisitt tagget for andre klasser.
 *
 * Konservativt: opererer kun på per-dag-innhold (`scheduleByDay`) og løse `schedule`-linjer. Rører
 * IKKE timeplan (`schoolWeeklyProfile`), tittel eller beskrivelse — og fjerner ikke hele dag-entries
 * (tomme dager gir ingen items nedstrøms). Uten klassekontekst returneres resultatet uendret.
 */
export function filterAnalysisContentByClass(
  result: AIAnalysisResult,
  childClassCode: string | undefined,
): AIAnalysisResult {
  const child = childClassCode?.trim();
  if (!child) return result;
  return {
    ...result,
    scheduleByDay: result.scheduleByDay.map((d) => filterDay(d, child)),
    schedule: result.schedule.filter((s) => lineIsRelevantForClass(s.label ?? "", child)),
  };
}
