import { getActiveTankestromEvalModelOverride } from "@/lib/eval/tankestrom-eval-model-override";
import type { AIAnalysisResult, AnalysisModelTrace } from "@/lib/types";

/**
 * Modellvalg (produksjon):
 * - Lett: OPENAI_ANALYSIS_MODEL_LIGHT → TANKESTROM_LIGHT_MODEL → gpt-4o-mini
 * - Sterk: OPENAI_ANALYSIS_MODEL_STRONG → TANKESTROM_DEFAULT_MODEL → TANKESTROM_HEAVY_MODEL → gpt-4o
 * - Bilde (første kall): OPENAI_ANALYSIS_MODEL_IMAGE → TANKESTROM_IMAGE_MODEL → samme som lett
 * Se `selectInitialAnalysisModel` for dokumenttype → lett/sterk.
 *
 * Eval-only overstyr (alle tre over hopper over når aktiv): EVAL_TANKESTROM_MODEL eller `current`.
 * Tillatelse: ikke produksjon, eller ALLOW_EVAL_MODEL_OVERRIDE=true. Se `tankestrom-eval-model-override.ts`.
 */

/**
 * Valgfri hint fra klient (multipart `documentKind` eller JSON `documentKind`).
 * `auto` = regelbasert ut fra kilde (bilde → start lett, eskalér ved behov).
 */
export type AnalysisDocumentKind =
  | "timetable"
  | "activity_plan"
  | "event_doc"
  | "text"
  /**
   * Bredt skoledokument (klasseplaner, prøver, lekser, beskjeder, klokkeslett). Egen type slik
   * at `schoolBlockProposal` senere kan produseres additivt uten å gjenbruke `activity_plan`.
   * NB: gir foreløpig KUN eksplisitt modellruting — ingen overlay-boost (se selectInitialAnalysisModel).
   */
  | "school"
  | "auto";

export type AnalysisSourceRoute = "image" | "text" | "pdf" | "docx";

export interface AnalysisModelRoutingInput {
  documentKind?: AnalysisDocumentKind | null;
  sourceRoute: AnalysisSourceRoute;
  /**
   * Kun logging / observability: om svaret pakkes som portal-bundle eller rå JSON.
   * Påvirker ikke modellvalg i dag.
   */
  analysisResponseMode?: "portal" | "raw" | "unknown";
}

const WEAK_CONFIDENCE_THRESHOLD = 0.42;

function firstDefinedEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

/**
 * Konfigurert «lett» modell uten eval-overstyr (til sammenligning i telemetri).
 */
export function getLightAnalysisModelBaseline(): string {
  return (
    firstDefinedEnv("OPENAI_ANALYSIS_MODEL_LIGHT", "TANKESTROM_LIGHT_MODEL") ??
    "gpt-4o-mini"
  );
}

/**
 * Konfigurert «sterk» modell uten eval-overstyr.
 */
export function getStrongAnalysisModelBaseline(): string {
  return (
    firstDefinedEnv(
      "OPENAI_ANALYSIS_MODEL_STRONG",
      "TANKESTROM_DEFAULT_MODEL",
      "TANKESTROM_HEAVY_MODEL",
    ) ?? "gpt-4o"
  );
}

/**
 * Lett modell (tekst/PDF/Word/auto, og bilde når ikke annet er satt).
 * Prioritet: OPENAI_ANALYSIS_MODEL_LIGHT → TANKESTROM_LIGHT_MODEL → gpt-4o-mini
 */
export function getLightAnalysisModel(): string {
  const evalModel = getActiveTankestromEvalModelOverride();
  if (evalModel) return evalModel;
  return getLightAnalysisModelBaseline();
}

/**
 * Sterk modell (timeplan/aktivitetsplan, og eskalering fra light).
 * Prioritet: OPENAI_ANALYSIS_MODEL_STRONG → TANKESTROM_DEFAULT_MODEL → TANKESTROM_HEAVY_MODEL → gpt-4o
 */
export function getStrongAnalysisModel(): string {
  const evalModel = getActiveTankestromEvalModelOverride();
  if (evalModel) return evalModel;
  return getStrongAnalysisModelBaseline();
}

/**
 * Første modell ved bildeanalyse (auto + sourceRoute image).
 * Prioritet: OPENAI_ANALYSIS_MODEL_IMAGE → TANKESTROM_IMAGE_MODEL → samme som light.
 */
export function getImageInitialAnalysisModel(): string {
  const evalModel = getActiveTankestromEvalModelOverride();
  if (evalModel) return evalModel;
  return (
    firstDefinedEnv("OPENAI_ANALYSIS_MODEL_IMAGE", "TANKESTROM_IMAGE_MODEL") ??
    getLightAnalysisModel()
  );
}

/**
 * Resultat av modellvalg. `escalationModel` er den EKSPLISITTE, modality-trygge modellen et
 * light-kall får eskalere til; `null` = ingen eskalering (bl.a. for ALLE bildekilder, som aldri
 * skal sende `image_url` til den generiske — potensielt ikke-vision — strong-modellen).
 */
export type AnalysisModelRoutingSelection = {
  model: string;
  tier: "light" | "strong";
  reason: string;
  escalationModel: string | null;
};

/**
 * Velger første modell (og trygt eskaleringsmål) basert på kilde og dokument-type.
 * - MODALITY-FIRST: enhver bildekilde → image-initial-modellen, uansett documentKind, og ALDRI
 *   eskalering til strong (bilde må aldri treffe en ikke-bildekapabel modell).
 * - timetable / activity_plan / school (ikke-bilde) → alltid sterk
 * - event_doc / text → lett, eskalerer til strong
 * - auto + tekst/PDF/Word → lett, eskalerer til strong
 */
export function selectInitialAnalysisModel(
  input: AnalysisModelRoutingInput,
): AnalysisModelRoutingSelection {
  const light = getLightAnalysisModel();
  const strong = getStrongAnalysisModel();
  const imageInitial = getImageInitialAnalysisModel();
  const kind = (input.documentKind ?? "auto").toLowerCase() as AnalysisDocumentKind;

  // Modality-first: alle bildekilder bruker den bildekapable modellen og eskalerer aldri til
  // strong. Har presedens over documentKind, så school/activity_plan/timetable + bilde ikke
  // lenger ruter `image_url` til en tekst-strong-modell.
  if (input.sourceRoute === "image") {
    return {
      model: imageInitial,
      tier: "light",
      reason: `source:image+document_kind:${kind}→image_initial`,
      escalationModel: null,
    };
  }

  if (kind === "timetable") {
    return {
      model: strong,
      tier: "strong",
      reason: "document_kind:timetable→strong",
      escalationModel: null,
    };
  }
  if (kind === "activity_plan") {
    return {
      model: strong,
      tier: "strong",
      reason: "document_kind:activity_plan→strong",
      escalationModel: null,
    };
  }
  // Bredt skoledokument: `classScheduleEntries` er kritisk strukturert output, og de øvrige
  // skole-typene bruker allerede sterk modell. Eksplisitt gren — ALDRI light-fallthrough.
  if (kind === "school") {
    return {
      model: strong,
      tier: "strong",
      reason: "document_kind:school→strong",
      escalationModel: null,
    };
  }
  if (kind === "event_doc") {
    return {
      model: light,
      tier: "light",
      reason: "document_kind:event_doc→light",
      escalationModel: strong,
    };
  }
  if (kind === "text") {
    return {
      model: light,
      tier: "light",
      reason: "document_kind:text→light",
      escalationModel: strong,
    };
  }

  // auto (ikke-bilde: tekst/PDF/Word)
  return {
    model: light,
    tier: "light",
    reason: `auto:source:${input.sourceRoute}→light`,
    escalationModel: strong,
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
    v === "school" ||
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
