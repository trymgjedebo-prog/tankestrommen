import type {
  AIAnalysisResult,
  DayScheduleEntry,
  ProposedEvent,
  TimeSlot,
} from "@/lib/types";

export function toProposedEvent(result: AIAnalysisResult): ProposedEvent {
  const schedule: TimeSlot[] =
    result.schedule.length > 0
      ? result.schedule.map((s) => ({ ...s }))
      : [{ date: null, time: null, label: null }];

  const scheduleByDay: DayScheduleEntry[] =
    result.scheduleByDay.length > 0
      ? result.scheduleByDay.map((d) => ({ ...d }))
      : [];

  return {
    title: result.title,
    schedule,
    scheduleByDay,
    location: result.location ?? "",
    description: result.description,
    category: result.category,
    targetGroup: result.targetGroup ?? "",
    organizer: result.organizer ?? "",
    contactPerson: result.contactPerson ?? "",
    sourceUrl: result.sourceUrl ?? "",
  };
}

/** Konverter en File til base64 data-URL (brukes for å sende bilde til API). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
