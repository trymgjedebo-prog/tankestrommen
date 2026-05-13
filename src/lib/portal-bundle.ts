import { randomUUID } from "node:crypto";
import type { AnalysisDocumentKind } from "@/lib/ai/analysis-model-router";
import {
  BT_TRUNC_BUNDLE_SNAPSHOT,
  mergeTelemetrySourceType,
  portalBundleJsonSnapshot,
  summarizePortalProposalItemsForBraintrust,
  truncateForBraintrust,
  type BraintrustPortalItem,
} from "@/lib/braintrust-analyze-telemetry";
import { ensureBraintrustLoggerForProject, TANKESTROM_BRAINTRUST_PROJECT } from "@/lib/braintrust-init";
import { getDeployFingerprint } from "@/lib/deploy-fingerprint";
import {
  normalizePortalProposalEventItem,
  type PortalImportContext,
} from "@/lib/portal-import-person";
import {
  buildAnalysisCorpus,
  buildAnalysisEvidenceReport,
} from "@/lib/analysis-evidence";
import type { AIAnalysisResult, SchoolWeekOverlayProposal } from "@/lib/types";
import { currentSpan, startSpan } from "braintrust";

type PortalItemKind = { kind: string; proposalId?: string };

/**
 * Funksjoner fra `route.ts` med interne typer (f.eks. overlay-hjemmelekse-debug).
 * Bruker `any` her slik at registreringen type-sjekkes uten å eksportere private hjelpertyper fra ruta.
 */
export type PortalBundleRuntime = {
  decideSchoolProfileProposal: (
    result: AIAnalysisResult,
    sourceType: string,
    documentKind?: AnalysisDocumentKind,
  ) => { proposal?: Record<string, unknown>; decision: Record<string, unknown> };
  decideSchoolWeekOverlayProposal: (
    result: AIAnalysisResult,
    sourceType: string,
    documentKind: AnalysisDocumentKind | undefined,
  ) => {
    proposal?: SchoolWeekOverlayProposal;
    decision: Record<string, unknown>;
    noiseDebug?: unknown;
  };
  createPortalWeekDateResolver: (result: AIAnalysisResult) => (
    rawDate: string | null,
    rawLabel: string | null,
  ) => string | null;
  parseWeekNumber: (raw: string | null) => number | null;
  inferRealisticYear: (candidates: number[], weekNumber: number | null) => number;
  collectYearCandidates: (result: AIAnalysisResult) => number[];
  buildHomeworkTaskItemsFromOverlay: (...args: any[]) => any[];
  buildProposalItems: (...args: any[]) => Promise<any[]>;
  dedupeArrangementChildEvents: (items: any[]) => any[];
  buildSecondaryPortalTaskCandidates: (...args: any[]) => any[];
  segmentRawTextByWeekday: (
    rawText: string,
  ) => Partial<Record<"0" | "1" | "2" | "3" | "4", string[]>>;
  stripInternalAnalysisDebug: (result: AIAnalysisResult) => AIAnalysisResult;
};

let runtime: PortalBundleRuntime | null = null;

export function registerPortalBundleRuntime(deps: PortalBundleRuntime): void {
  runtime = deps;
}

function requireRuntime(): PortalBundleRuntime {
  if (!runtime) {
    throw new Error(
      "Portal bundle runtime not registered. Import @/app/api/analyze/route so registerPortalBundleRuntime runs.",
    );
  }
  return runtime;
}

/**
 * Bygg portal-import bundle (samme som `/api/analyze` i portal-modus).
 * Registreres fra `route.ts` via {@link registerPortalBundleRuntime}.
 */
export async function toPortalBundle(
  resultIn: AIAnalysisResult,
  sourceType: string,
  documentKind: AnalysisDocumentKind | undefined,
  includeDebug: boolean,
  portalImport: PortalImportContext = { knownPersons: [] },
): Promise<Record<string, unknown>> {
  const deps = requireRuntime();
  const btPortal = Boolean(process.env.BRAINTRUST_API_KEY?.trim());
  if (btPortal) ensureBraintrustLoggerForProject();
  const portalBundleSpan = btPortal ? startSpan({ name: "portal_bundle" }) : null;
  try {
    portalBundleSpan?.log({
      input: {
        projectName: TANKESTROM_BRAINTRUST_PROJECT,
        sourceType,
        documentKind: documentKind ?? null,
        aiTitleTrunc: truncateForBraintrust(resultIn.title ?? "", 200),
        extractedTextLen: resultIn.extractedText?.raw?.length ?? 0,
      },
    });

    const { coerceAIAnalysisResultForPortal } = await import("@/lib/analysis-null-safety");
    const result = coerceAIAnalysisResultForPortal(resultIn);
    const { proposal: schoolProfileProposal, decision: schoolProfileDecision } =
      deps.decideSchoolProfileProposal(result, sourceType, documentKind);
    const {
      proposal: schoolWeekOverlayProposal,
      decision: schoolWeekOverlayDecision,
      noiseDebug: schoolWeekOverlayNoiseDebug,
    } = schoolProfileProposal
      ? {
          proposal: undefined,
          decision: {
            path: "overlay_skipped",
            reason: "school_profile_already_selected",
          },
          noiseDebug: undefined,
        }
      : deps.decideSchoolWeekOverlayProposal(result, sourceType, documentKind);
    const resolveDate = deps.createPortalWeekDateResolver(result);
    const weekContextForYear = [
      result.title,
      result.description,
      ...result.scheduleByDay.map((d) => `${d.dayLabel ?? ""} ${d.date ?? ""}`),
      ...result.schedule.map((s) => `${s.label ?? ""} ${s.date ?? ""}`),
    ].join(" ");
    const weekNumberForYear = deps.parseWeekNumber(weekContextForYear);
    const resolvedYear = deps.inferRealisticYear(
      deps.collectYearCandidates(result),
      weekNumberForYear,
    );
    const overlayHomeworkDebug: { accepted: unknown[]; rejected: unknown[] } | undefined = includeDebug
      ? { accepted: [], rejected: [] }
      : undefined;
    const overlayHomeworkItems =
      schoolWeekOverlayProposal && !schoolProfileProposal
        ? deps.buildHomeworkTaskItemsFromOverlay(
            result,
            sourceType,
            schoolWeekOverlayProposal,
            resolveDate,
            overlayHomeworkDebug,
          )
        : [];
    const rawProposalItems = schoolProfileProposal
      ? []
      : schoolWeekOverlayProposal
        ? overlayHomeworkItems
        : await deps.buildProposalItems(result, sourceType, portalImport);
    const { dedupePortalFlightDepartureArrivalEvents } = await import("@/lib/portal-flight-dedupe");
    const travelDeduped = dedupePortalFlightDepartureArrivalEvents(rawProposalItems);
    const fileErrors: Array<{
      fileName?: string | null;
      errorCode: string;
      message: string;
      debugMessage: string;
      proposalId?: string;
    }> = [];
    const items: PortalItemKind[] = [];
    const normalizeSpan = btPortal ? startSpan({ name: "normalize_items" }) : null;
    try {
      normalizeSpan?.log({ input: { rawItemCount: travelDeduped.length } });
      for (const it of travelDeduped) {
        try {
          if (it.kind === "event") {
            items.push(normalizePortalProposalEventItem(it as never));
          } else {
            items.push(it);
          }
        } catch (err) {
          console.error("[api/analyze] normalizePortalProposalEventItem failed", err);
          fileErrors.push({
            errorCode: "PROPOSAL_ITEM_NORMALIZE_FAILED",
            message: "Kunne ikke normalisere et forslag fra dokumentet.",
            debugMessage: err instanceof Error ? err.message : String(err),
            proposalId: "proposalId" in it ? String(it.proposalId) : undefined,
          });
        }
      }
      normalizeSpan?.log({
        output: {
          normalizedItemCount: items.length,
          normalizeFileErrors: fileErrors.length,
        },
      });
    } finally {
      normalizeSpan?.end();
    }
    const dedupedItems = deps.dedupeArrangementChildEvents(items);
    const arrangementSpan = btPortal ? startSpan({ name: "arrangement_linking_metadata" }) : null;
    try {
      const telem = mergeTelemetrySourceType(
        summarizePortalProposalItemsForBraintrust(dedupedItems as unknown as BraintrustPortalItem[]),
        sourceType,
      );
      const am = result.analysisModelTrace;
      const updateIntentSample = dedupedItems
        .filter((i) => i.kind === "event")
        .map((i) => (i as { event?: { metadata?: { updateIntent?: unknown } } }).event?.metadata?.updateIntent)
        .find((u) => u != null && typeof u === "object");
      arrangementSpan?.log({
        output: {
          ...telem,
          model: am?.finalModel ?? am?.initialModel ?? null,
          tier: am?.initialTier ?? null,
          bundleSnapshotTrunc: portalBundleJsonSnapshot(
            dedupedItems as unknown as BraintrustPortalItem[],
            BT_TRUNC_BUNDLE_SNAPSHOT,
          ),
          ...(updateIntentSample
            ? {
                updateIntentTrunc: truncateForBraintrust(
                  JSON.stringify(updateIntentSample),
                  2000,
                ),
              }
            : {}),
        },
      });
    } finally {
      arrangementSpan?.end();
    }
    const secondaryTaskCandidates =
      !schoolProfileProposal && !schoolWeekOverlayProposal
        ? deps.buildSecondaryPortalTaskCandidates(
            result,
            dedupedItems,
            resolveDate,
            resolvedYear,
            sourceType,
          )
        : [];
    const pipelineSnapshot = {
      extractedTextLength: result.extractedText?.raw?.length ?? 0,
      documentKind: documentKind ?? null,
      hasSchoolWeeklyProfile: Boolean(result.schoolWeeklyProfile),
      schoolWeekOverlayBuilt: Boolean(schoolWeekOverlayProposal),
      itemsLength: dedupedItems.length,
      secondaryTaskCandidatesLength: secondaryTaskCandidates.length,
      schoolProfileDecision: schoolProfileDecision.reason,
      schoolWeekOverlayDecision: schoolWeekOverlayDecision.reason,
    };
    console.log("[api/analyze] school-routing", {
      ...pipelineSnapshot,
      schoolProfilePath: schoolProfileDecision.path,
      schoolProfileReason: schoolProfileDecision.reason,
      schoolProfileSignals: schoolProfileDecision.signals ?? [],
      schoolWeekOverlayPath: schoolWeekOverlayDecision.path,
      schoolWeekOverlayReason: schoolWeekOverlayDecision.reason,
      schoolWeekOverlaySignals: schoolWeekOverlayDecision.signals ?? [],
      hasSchoolProfileProposal: Boolean(schoolProfileProposal),
      hasSchoolWeekOverlayProposal: Boolean(schoolWeekOverlayProposal),
      itemCount: dedupedItems.length,
    });
    const debugPayload: Record<string, unknown> = {};
    if (includeDebug) {
      debugPayload.deploy = getDeployFingerprint();
      debugPayload.schoolProfileRouting = schoolProfileDecision;
      debugPayload.schoolWeekOverlayRouting = schoolWeekOverlayDecision;
      debugPayload.pipelineSnapshot = pipelineSnapshot;
      debugPayload.overlayRawDaySegments = deps.segmentRawTextByWeekday(
        result.extractedText?.raw ?? "",
      );
      if (schoolWeekOverlayNoiseDebug) {
        debugPayload.overlayNoiseFilter = schoolWeekOverlayNoiseDebug;
      }
      if (schoolWeekOverlayNoiseDebug && overlayHomeworkDebug) {
        const taskCountByDay = new Map<string, number>();
        for (const a of overlayHomeworkDebug.accepted as Array<{ dayIndex: string }>) {
          taskCountByDay.set(a.dayIndex, (taskCountByDay.get(a.dayIndex) ?? 0) + 1);
        }
        for (const [dayIdx, n] of taskCountByDay) {
          const dm = (schoolWeekOverlayNoiseDebug as { days?: Record<string, { overlayTasksBuiltFromRows?: number; overlayTasksBuiltAfterOrphanAssignment?: number }> }).days?.[dayIdx];
          if (dm) {
            dm.overlayTasksBuiltFromRows = n;
            dm.overlayTasksBuiltAfterOrphanAssignment = n;
          }
        }
      }
      if (schoolWeekOverlayProposal && overlayHomeworkDebug) {
        debugPayload.overlayHomeworkTasks = overlayHomeworkDebug;
      }
      if (schoolWeekOverlayProposal) {
        debugPayload.overlayDayDerivation = Object.entries(
          schoolWeekOverlayProposal.dailyActions,
        ).map(([day, action]) => ({
          day,
          action: action?.action ?? null,
          summary: action?.summary ?? null,
          reason: action?.reason ?? null,
          summarySuppressedByStrongSections:
            action?.summary === null &&
            Boolean(
              action?.subjectUpdates?.some(
                (u) =>
                  (u.sections.iTimen?.length ?? 0) +
                    (u.sections.lekse?.length ?? 0) +
                    (u.sections.husk?.length ?? 0) +
                    (u.sections.proveVurdering?.length ?? 0) +
                    (u.sections.ressurser?.length ?? 0) >=
                    2,
              ),
            ),
          sectionKeys:
            action?.subjectUpdates?.flatMap((u) =>
              Object.entries(u.sections)
                .filter(([, v]) => Array.isArray(v) && v.length > 0)
                .map(([k]) => k),
            ) ?? [],
        }));
      }
    }
    if (includeDebug && result.schoolWeeklyProfileDebug) {
      debugPayload.schoolWeeklyProfile = result.schoolWeeklyProfileDebug;
    }
    if (includeDebug && result.analysisModelTrace) {
      debugPayload.analysisModel = result.analysisModelTrace;
    }
    if (includeDebug && sourceType === "text") {
      debugPayload.textAnalyzeTrace = {
        textAnalyzeResponseShape: "PortalImportProposalBundle",
        textAnalyzeWrappedBundle: true,
        textAnalyzeSchemaVersion: "1.0.0",
        textAnalyzePortalBundleReturned: true,
      };
    }
    const bundleOut = {
      schemaVersion: "1.0.0",
      provenance: {
        sourceSystem: "tankestrom",
        sourceType,
        generatedAt: new Date().toISOString(),
        importRunId: randomUUID(),
      },
      items: dedupedItems,
      fileErrors,
      ...(secondaryTaskCandidates.length > 0 ? { secondaryTaskCandidates } : {}),
      ...(schoolProfileProposal ? { schoolProfileProposal } : {}),
      ...(schoolWeekOverlayProposal ? { schoolWeekOverlayProposal } : {}),
      evidenceReport: buildAnalysisEvidenceReport(buildAnalysisCorpus(result), result),
      ...(Object.keys(debugPayload).length > 0 ? { debug: debugPayload } : {}),
    };
    portalBundleSpan?.log({
      output: {
        ...mergeTelemetrySourceType(
          summarizePortalProposalItemsForBraintrust(dedupedItems as unknown as BraintrustPortalItem[]),
          sourceType,
        ),
        schemaVersion: bundleOut.schemaVersion,
        fileErrorsCount: fileErrors.length,
        secondaryTaskCandidates: secondaryTaskCandidates.length,
        schoolProfileProposal: Boolean(schoolProfileProposal),
        schoolWeekOverlayProposal: Boolean(schoolWeekOverlayProposal),
        model: result.analysisModelTrace?.finalModel ?? result.analysisModelTrace?.initialModel ?? null,
        tier: result.analysisModelTrace?.initialTier ?? null,
      },
    });
    return bundleOut;
  } finally {
    portalBundleSpan?.end();
  }
}
