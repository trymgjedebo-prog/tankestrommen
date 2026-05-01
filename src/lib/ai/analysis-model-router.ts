import type { AIAnalysisResult, AnalysisModelTrace } from "@/lib/types";

/**
 * Valgfri hint fra klient (multipart `documentKind` eller JSON `documentKind`).
 * `auto` = regelbasert ut fra kilde (bilde → start lett, eskalér ved behov).
 */
export type AnalysisDocumentKind =
  | "timetable"
  | "activity_plan"
  | "event_doc"
  | "text"
  | "auto";

export type AnalysisSourceRoute = "image" | "text" | "pdf" | "docx";

export interface AnalysisModelRoutingInput {
  documentKind?: AnalysisDocumentKind | null;
  sourceRoute: AnalysisSourceRoute;
}

const WEAK_CONFIDENCE_THRESHOLD = 0.42;

function envModel(key: string, fallback: string): string {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : fallback;
}

/** Lett / rask modell (standard: mini). Overstyr med OPENAI_ANALYSIS_MODEL_LIGHT. */
export function getLightAnalysisModel(): string {
  return envModel("OPENAI_ANALYSIS_MODEL_LIGHT", "gpt-4o-mini");
}

/** Sterk modell for grid-timeplan m.m. Overstyr med OPENAI_ANALYSIS_MODEL_STRONG. */
export function getStrongAnalysisModel(): string {
  return envModel("OPENAI_ANALYSIS_MODEL_STRONG", "gpt-4o");
}

/**
 * Velger første modell basert på dokument-type og kilde.
 * - timetable / activity_plan → alltid sterk
 * - event_doc / text → lett
 * - auto + tekst/PDF/Word → lett
 * - auto + bilde → lett (eskalering skjer i routed-analyse ved svakhet/feil)
 */
export function selectInitialAnalysisModel(
  input: AnalysisModelRoutingInput,
): { model: string; tier: "light" | "strong"; reason: string } {
  const light = getLightAnalysisModel();
  const strong = getStrongAnalysisModel();
  const kind = (input.documentKind ?? "auto").toLowerCase() as AnalysisDocumentKind;

  if (kind === "timetable") {
    return {
      model: strong,
      tier: "strong",
      reason: "document_kind:timetable→strong",
    };
  }
  if (kind === "activity_plan") {
    return {
      model: strong,
      tier: "strong",
      reason: "document_kind:activity_plan→strong",
    };
  }
  if (kind === "event_doc") {
    return {
      model: light,
      tier: "light",
      reason: "document_kind:event_doc→light",
    };
  }
  if (kind === "text") {
    return {
      model: light,
      tier: "light",
      reason: "document_kind:text→light",
    };
  }

  // auto
  if (input.sourceRoute === "image") {
    return {
      model: light,
      tier: "light",
      reason: "auto:source:image→light_then_maybe_escalate",
    };
  }
  return {
    model: light,
    tier: "light",
    reason: `auto:source:${input.sourceRoute}→light`,
  };
}

/** True når resultatet ser for tynt ut til å stole på (etter lett modell). */
export function analysisLooksWeakForEscalation(
  result: AIAnalysisResult,
): { weak: boolean; reason?: string } {
  if (result.confidence < WEAK_CONFIDENCE_THRESHOLD) {
    return {
      weak: true,
      reason: `low_confidence:${result.confidence.toFixed(3)}<${WEAK_CONFIDENCE_THRESHOLD}`,
    };
  }
  const hasStructure =
    result.schedule.length > 0 ||
    result.scheduleByDay.length > 0 ||
    (result.schoolWeeklyProfile &&
      Object.keys(result.schoolWeeklyProfile.weekdays ?? {}).length > 0);
  const descLen = result.description.trim().length;
  const titleLen = result.title.trim().length;
  if (!hasStructure && descLen < 36 && titleLen < 4) {
    return { weak: true, reason: "sparse_extract:no_schedule_and_short_text" };
  }
  return { weak: false };
}

export function parseDocumentKind(raw: unknown): AnalysisDocumentKind | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toLowerCase().replace(/-/g, "_");
  if (
    v === "timetable" ||
    v === "activity_plan" ||
    v === "event_doc" ||
    v === "text" ||
    v === "auto"
  ) {
    return v as AnalysisDocumentKind;
  }
  return undefined;
}

export function emptyAnalysisModelTrace(
  initial: ReturnType<typeof selectInitialAnalysisModel>,
): AnalysisModelTrace {
  return {
    initialTier: initial.tier,
    initialModel: initial.model,
    finalModel: initial.model,
    escalated: false,
    reasons: [initial.reason],
  };
}
