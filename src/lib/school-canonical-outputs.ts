/**
 * ÉN delt, ren sammenstilling av canonical skoleoutput — mekanisk trukket ut av `toPortalBundle`
 * slik at både produksjonen og en senere canonical replay-runner bruker NØYAKTIG samme funksjon for:
 *   1. `schoolBlockProposal`            (kun `documentKind: "school"`, fra UFILTRERT normalisert result)
 *   2. normaliserte skoleinnholdsfakta  (kun school; internt mellomstadium, IKKE et wire-felt)
 *   3. `canonicalSchoolContentDraft`    (ubetinget kall; adapteren gir `null` uten schoolBlock)
 *   4. `evidenceReport`                 (ALLTID, fra KLASSEFILTRERT result — som i dag)
 *
 * Operasjonsrekkefølge, gating, kilder (ufiltrert vs. filtrert result), `sourceTitle`-fallback og
 * språksporinput (hele `schoolWeekOverlayProposal` videresendes; adapteren leser kun `languageTrack`)
 * er identiske med den tidligere inline-koden. Ingen builder er kopiert eller endret.
 *
 * Volatile verdier (proposalId) leveres UTENFRA — funksjonen bruker aldri klokke/tilfeldighet.
 * Ren: ingen Next.js/OpenAI/env/nettverk/sideeffekter; muterer aldri input.
 */
import type { AnalysisDocumentKind } from "@/lib/ai/analysis-model-router";
import {
  buildAnalysisCorpus,
  buildAnalysisEvidenceReport,
  type AnalysisEvidenceReport,
} from "@/lib/analysis-evidence";
import { buildCanonicalSchoolContentDraft } from "@/lib/canonical-school-adapter";
import type { CanonicalSchoolContentDraft } from "@/lib/school-content-canonical";
import { buildNormalizedSchoolContentFacts, type NormalizedSchoolContentFact } from "@/lib/school-content-fact";
import { buildSchoolBlockProposal } from "@/lib/school-block-proposal";
import type { PortalImportContext } from "@/lib/portal-import-person";
import type { AIAnalysisResult, SchoolBlockProposal, SchoolWeekOverlayProposal } from "@/lib/types";

export type BuildSchoolCanonicalOutputsInput = {
  /** Portal-normalisert (coerced), IKKE klassefiltrert — kilden for schoolBlock + facts. */
  normalizedResult: AIAnalysisResult;
  /** Klassefiltrert variant av samme result — kilden for evidenceReport (som i produksjonen). */
  filteredResult: AIAnalysisResult;
  documentKind: AnalysisDocumentKind | undefined;
  sourceType: string;
  personContext: PortalImportContext;
  /** Eksisterende overlay-proposal (eller undefined); adapteren leser kun `languageTrack` av den. */
  schoolWeekOverlayProposal: SchoolWeekOverlayProposal | undefined;
  /** Per-kjøring instans-ID for schoolBlockProposal. PÅKREVD når documentKind === "school". */
  proposalId: string | undefined;
  /** Fallback for draftens sourceTitle (produksjonen sender rå `resultIn.title`). */
  fallbackSourceTitle: string | null | undefined;
};

export type SchoolCanonicalOutputs = {
  schoolBlockProposal: SchoolBlockProposal | undefined;
  /** Internt mellomstadium for senere replay/tracing — IKKE et wire-felt. */
  normalizedSchoolContentFacts: NormalizedSchoolContentFact[];
  canonicalSchoolContentDraft: CanonicalSchoolContentDraft | null;
  evidenceReport: AnalysisEvidenceReport;
};

/**
 * Bygg canonical skoleoutput + evidence for et dokument. Identisk semantikk som den tidligere
 * inline-sammenstillingen i `toPortalBundle` (samme gating, samme kilder, samme rekkefølge).
 */
export function buildSchoolCanonicalOutputs(
  input: BuildSchoolCanonicalOutputsInput,
): SchoolCanonicalOutputs {
  const isSchool = input.documentKind === "school";
  if (isSchool && input.proposalId === undefined) {
    throw new Error("buildSchoolCanonicalOutputs: proposalId kreves når documentKind er 'school'.");
  }

  // 1. schoolBlockProposal — kun school; fra UFILTRERT result (builderen oppløser barnet selv og
  //    bevarer sikre ikke-matchende audience entries). Ingen try/catch — feil skal boble til den
  //    eksisterende failure boundary rundt toPortalBundle.
  const schoolBlockProposal =
    isSchool && input.proposalId !== undefined
      ? buildSchoolBlockProposal(input.normalizedResult, input.personContext, {
          proposalId: input.proposalId,
          originalSourceType: input.sourceType,
        })
      : undefined;

  // 2. Delt, pre-projeksjons fag/kategori-rad (samme rå kilde som schoolBlock).
  const normalizedSchoolContentFacts = isSchool
    ? buildNormalizedSchoolContentFacts(input.normalizedResult.scheduleByDay)
    : [];

  // 3. Canonical draft — ubetinget kall (adapteren returnerer null uten schoolBlock-grunnlag).
  const canonicalSchoolContentDraft = buildCanonicalSchoolContentDraft({
    schoolBlockProposal,
    schoolWeekOverlayProposal: input.schoolWeekOverlayProposal,
    normalizedSchoolContentFacts,
    resolvedPersonContext: input.personContext,
    originalSourceType: input.sourceType,
    sourceTitle: schoolBlockProposal?.sourceTitle ?? input.fallbackSourceTitle ?? "Skoleinformasjon",
  });

  // 4. Evidence — ALLTID, fra det KLASSEFILTRERTE resultatet (samme kilde og rekkefølge som før).
  const evidenceReport = buildAnalysisEvidenceReport(
    buildAnalysisCorpus(input.filteredResult),
    input.filteredResult,
  );

  return { schoolBlockProposal, normalizedSchoolContentFacts, canonicalSchoolContentDraft, evidenceReport };
}
