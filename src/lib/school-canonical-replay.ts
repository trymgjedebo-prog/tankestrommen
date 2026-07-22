/**
 * REN canonical skole-replay: kjør lagret rå modelltekst (`completion.choices[0].message.content`)
 * gjennom NØYAKTIG de samme produksjonsfunksjonene som `toPortalBundle` bruker for canonical
 * skoleoutput — uten modellkall, nettverk, `route.ts`, `PortalBundleRuntime`, overlay-seksjons-
 * pipeline eller generiske items/tasks:
 *
 *   rawModelContent
 *   → parseAndNormalizeModelResponse   (produksjonens parser/normalisering; diagnostikk AV, fast now)
 *   → coerceAIAnalysisResultForPortal  (portal-normalisering)
 *   → filterAnalysisContentByClass     (klassefiltrering fra samme personContext-felt som produksjonen)
 *   → buildSchoolCanonicalOutputs      (delt canonical assembly; documentKind eksplisitt "school")
 *
 * SPRÅKSPOR: `languageTrack` er EKSPLISITT input (samme kontrakt som produksjonens
 * `schoolWeekOverlayProposal?.languageTrack`, som kan være undefined). Runneren kjører ALDRI
 * `resolveSchoolLanguageTrack` skjult — caller/fixture bestemmer verdien. Dermed er canonical-
 * inputen identisk mellom replay og produksjon, uten kunstig overlay.
 *
 * DEKNING: kun canonical skoleoutput (+ evidence). IKKE overlay-seksjoner, generiske items,
 * secondary tasks eller full portal-bundle — se `coverage`-feltet.
 *
 * Ren: ingen filsystem/nettverk/env/logging; ingen global klokke eller tilfeldighet (now/proposalId
 * injiseres); muterer aldri input. Parserfeil bobler UENDRET fra produksjonssømmen.
 */
import { parseAndNormalizeModelResponse } from "@/lib/ai/analyze-image";
import { coerceAIAnalysisResultForPortal } from "@/lib/analysis-null-safety";
import { filterAnalysisContentByClass } from "@/lib/class-content-filter";
import {
  buildSchoolCanonicalOutputs,
  type SchoolCanonicalOutputs,
} from "@/lib/school-canonical-outputs";
import type { SchoolLanguageTrackResolution } from "@/lib/school-language-track";
import type { PortalImportContext } from "@/lib/portal-import-person";
import type { AIAnalysisResult } from "@/lib/types";

export type RunSchoolCanonicalReplayInput = {
  /** Modellens rå tekstinnhold (`completion.choices[0].message.content`) — IKKE provider-envelope. */
  rawModelContent: string;
  /** Den sammenslåtte kilde-/dokumentteksten produksjonen ville sendt som sourceText. */
  sourceText: string;
  /** Fast klokke for årsinferens (deterministisk replay). */
  now: Date;
  sourceType: string;
  personContext: PortalImportContext;
  /** Eksplisitt besluttet språksporresultat (eller undefined) — aldri resolvet skjult her. */
  languageTrack: SchoolLanguageTrackResolution | undefined;
  /** Deterministisk instans-ID for schoolBlockProposal. */
  proposalId: string;
};

export type SchoolCanonicalReplayResult = {
  schemaVersion: "1.0.0";
  mode: "canonical_school_replay";
  /** Eksplisitt scope: dette er IKKE full portal-bundle-paritet. */
  coverage: {
    canonicalSchoolOutputs: true;
    schoolWeekOverlaySections: false;
    genericItems: false;
    secondaryTasks: false;
  };
  /** Stage captures — første avvik skal kunne lokaliseres per steg. Internt format, ikke wire. */
  stages: {
    modelNormalizedResult: AIAnalysisResult;
    portalNormalizedResult: AIAnalysisResult;
    classFilteredResult: AIAnalysisResult;
    languageTrack: SchoolLanguageTrackResolution | undefined;
  };
  /** Samme objekt som produksjonens canonical assembly returnerer (inkl. normalizedSchoolContentFacts). */
  outputs: SchoolCanonicalOutputs;
};

export function runSchoolCanonicalReplayFromModelResponse(
  input: RunSchoolCanonicalReplayInput,
): SchoolCanonicalReplayResult {
  // Egne replay-inputs valideres FØR parsing, med presise TypeError — parserfeil skal forbli
  // parserfeil (samme failure boundary som produksjonen), aldri maskeres av inputfeil eller omvendt.
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    throw new TypeError("runSchoolCanonicalReplayFromModelResponse: 'now' må være en gyldig Date.");
  }
  if (typeof input.proposalId !== "string" || input.proposalId.trim() === "") {
    throw new TypeError("runSchoolCanonicalReplayFromModelResponse: 'proposalId' må være en ikke-tom streng.");
  }
  if (typeof input.sourceType !== "string" || input.sourceType.trim() === "") {
    throw new TypeError("runSchoolCanonicalReplayFromModelResponse: 'sourceType' må være en ikke-tom streng.");
  }

  // 1. Produksjonens parse-/normaliseringssøm. Parserfeil («Tom respons fra OpenAI», «Kunne ikke
  //    tolke JSON fra modellen», «Ugyldig JSON fra modellen») bobler uendret.
  const modelNormalizedResult = parseAndNormalizeModelResponse(input.rawModelContent, {
    sourceText: input.sourceText,
    now: input.now,
    enableDiagnostics: false,
  });

  // 2. Portal-normalisering (samme som toPortalBundle).
  const portalNormalizedResult = coerceAIAnalysisResultForPortal(modelNormalizedResult);

  // 3. Klassefiltrering — klassekoden hentes fra SAMME personContext-felt som produksjonen.
  const classFilteredResult = filterAnalysisContentByClass(
    portalNormalizedResult,
    input.personContext.relevanceContext?.classCode,
  );

  // 4. Delt canonical assembly — identisk input-form som produksjonen (fallbackSourceTitle er
  //    modellresultatets opprinnelige title, slik produksjonen sender resultIn.title).
  const outputs = buildSchoolCanonicalOutputs({
    normalizedResult: portalNormalizedResult,
    filteredResult: classFilteredResult,
    documentKind: "school",
    sourceType: input.sourceType,
    personContext: input.personContext,
    languageTrack: input.languageTrack,
    proposalId: input.proposalId,
    fallbackSourceTitle: modelNormalizedResult.title,
  });

  return {
    schemaVersion: "1.0.0",
    mode: "canonical_school_replay",
    coverage: {
      canonicalSchoolOutputs: true,
      schoolWeekOverlaySections: false,
      genericItems: false,
      secondaryTasks: false,
    },
    stages: {
      modelNormalizedResult,
      portalNormalizedResult,
      classFilteredResult,
      languageTrack: input.languageTrack,
    },
    outputs,
  };
}
