import type { AIAnalysisResult, DayScheduleEntry, ExtractedText, TimeSlot } from "@/lib/types";

/** Trygg streng for portalfelt (unngår `.trim()` på tall/objekt fra modell-JSON). */
export function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Normaliserer tidsfelt til string eller null — aldri kast på uventet type.
 */
export function safeNormalizeTime(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t || /^unknown$/i.test(t)) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}/.test(t)) return t;
  if (/^\d{1,2}:\d{2}$/.test(t)) return t;
  return t;
}

function coerceDayEntry(d: unknown): DayScheduleEntry {
  if (!d || typeof d !== "object") {
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
  const x = d as Record<string, unknown>;
  const bag = (a: unknown): string[] =>
    Array.isArray(a) ? a.filter((y): y is string => typeof y === "string") : [];
  const detailsRaw = x.details;
  return {
    dayLabel: typeof x.dayLabel === "string" ? x.dayLabel : null,
    date: typeof x.date === "string" ? x.date : null,
    time: typeof x.time === "string" ? x.time : null,
    details: typeof detailsRaw === "string" ? detailsRaw : null,
    highlights: bag(x.highlights),
    rememberItems: bag(x.rememberItems),
    deadlines: bag(x.deadlines),
    notes: bag(x.notes),
  };
}

/**
 * Gjør AI-resultat trygt for portal-pipelinen dersom modellen har levert ufullstendige typer.
 */
export function coerceAIAnalysisResultForPortal(result: AIAnalysisResult): AIAnalysisResult {
  const schedule: TimeSlot[] = Array.isArray(result.schedule) ? result.schedule : [];
  const scheduleByDay: DayScheduleEntry[] = Array.isArray(result.scheduleByDay)
    ? result.scheduleByDay.map(coerceDayEntry)
    : [];

  let extractedText: ExtractedText;
  if (result.extractedText && typeof result.extractedText === "object") {
    const e = result.extractedText as ExtractedText;
    extractedText = {
      raw: typeof e.raw === "string" ? e.raw : "",
      language: typeof e.language === "string" ? e.language : "no",
      confidence:
        typeof e.confidence === "number" && Number.isFinite(e.confidence) ? e.confidence : 0,
    };
  } else {
    extractedText = { raw: "", language: "no", confidence: 0 };
  }

  return {
    ...result,
    title: typeof result.title === "string" ? result.title : "Uten tittel",
    description: typeof result.description === "string" ? result.description : "",
    schedule,
    scheduleByDay,
    extractedText,
    confidence:
      typeof result.confidence === "number" && Number.isFinite(result.confidence)
        ? result.confidence
        : 0,
    location:
      result.location === null || result.location === undefined
        ? null
        : String(result.location),
    targetGroup:
      result.targetGroup === null || result.targetGroup === undefined
        ? null
        : String(result.targetGroup),
    organizer:
      result.organizer === null || result.organizer === undefined
        ? null
        : String(result.organizer),
    contactPerson:
      result.contactPerson === null || result.contactPerson === undefined
        ? null
        : String(result.contactPerson),
    sourceUrl:
      result.sourceUrl === null || result.sourceUrl === undefined
        ? null
        : String(result.sourceUrl),
  };
}
