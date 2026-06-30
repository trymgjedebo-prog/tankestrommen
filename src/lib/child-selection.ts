/**
 * Vei 1, lag 2: glue som kobler den rene `matchDocumentToChild` inn i analyse-pipelinen.
 * Holdt ute av route.ts (Next-route → kan ikke eksportere ekstra symboler) slik at det kan
 * enhetstestes isolert — inkludert BAKOVERKOMPAT-beviset (gammel ett-barns-form uendret).
 */
import {
  matchDocumentToChild,
  type MatchDocumentToChildResult,
} from "@/lib/match-document-to-child";
import type {
  PortalImportContext,
  PortalRelevanceContext,
} from "@/lib/portal-import-person";
import type { AIAnalysisResult } from "@/lib/types";

/**
 * Bygg matchings-tekst fra analyse-resultatet (der klassekoder står). `targetGroup` settes
 * FØRST og er PRIMÆRSIGNALET: LLM-en har alt renset ut klassekoden («10B» / «klasse 10B») uten
 * rom-/benk-støy, så ungdomsskole-koder fanges trygt her uten å lene seg på regex-eksklusjonslisten.
 */
export function buildChildMatchDocumentText(result: AIAnalysisResult): string {
  const parts: string[] = [
    result.targetGroup ?? "",
    result.title ?? "",
    result.description ?? "",
    result.extractedText?.raw ?? "",
  ];
  for (const d of result.scheduleByDay) {
    parts.push(d.dayLabel ?? "", d.date ?? "", d.details ?? "", ...d.highlights, ...d.notes);
  }
  for (const s of result.schedule) parts.push(s.label ?? "");
  return parts.filter(Boolean).join("\n");
}

/**
 * Velg barnet et dokument gjelder når klienten sendte en children-liste, og reduser til ETT
 * relevanceContext (classCode + schoolProfile) slik at resten av pipelinen kjører uendret.
 *
 * BAKOVERKOMPAT: når `children` mangler (gammel prod-frontend, eller cup) returneres
 * `portalImport.relevanceContext` UENDRET og `match: null` → ingen ny oppførsel.
 *
 * NB lag 3 (filtrerings-nyanse): den NYE children-formen filtrerer innhold KUN ved `matched`
 * (ellers `relevanceContext: undefined` → ingen klasse-filtrering), mens den GAMLE
 * `{ classCode }`-formen filtrerer UBETINGET. For klasseløse dokumenter er resultatet identisk;
 * for dokumenter som nevner kun andre klasser beholder ny form innholdet (mer konservativt — vi
 * vet ikke om det er barnets). Filtrerings-oppførselen kan derfor endres litt når frontend bytter
 * form — lag 3-testingen må være klar over dette.
 */
export function selectChildForDocument(
  result: AIAnalysisResult,
  portalImport: PortalImportContext,
): {
  relevanceContext: PortalRelevanceContext | undefined;
  match: MatchDocumentToChildResult | null;
} {
  if (!portalImport.children || portalImport.children.length === 0) {
    return { relevanceContext: portalImport.relevanceContext, match: null };
  }
  const match = matchDocumentToChild(buildChildMatchDocumentText(result), portalImport.children);
  if (match.status === "matched") {
    const chosen = portalImport.children.find((c) => c.personId === match.personId);
    if (chosen) {
      return {
        relevanceContext: {
          ...(chosen.classCode ? { classCode: chosen.classCode } : {}),
          ...(chosen.schoolProfile ? { schoolProfile: chosen.schoolProfile } : {}),
        },
        match,
      };
    }
  }
  // ambiguous / no_signal → ingen klasse-filtrering; bruker velger barn (se applyChildSelectionToItems).
  return { relevanceContext: undefined, match };
}

/**
 * Post-pass på bundle-items etter at barnet er valgt. Setter personId + personMatchStatus på
 * items som ikke alt har en ekte person (rører ikke fly-navne-match). Gjelder BÅDE event- og
 * task-items (paritet): `matched` → valgt personId + status "matched"; `ambiguous`/`no_signal`
 * → status "child_unresolved" (personId forblir uendret → bruker velger).
 * No-op når `match` er null (gammel form / cup).
 */
export function applyChildSelectionToItems(
  items: unknown[],
  match: MatchDocumentToChildResult | null,
): void {
  if (!match) return;
  const isUnset = (p: unknown) => p == null || p === "" || p === "pending";
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const item = it as { kind?: string; event?: Record<string, unknown>; task?: Record<string, unknown> };
    if (match.status === "matched") {
      if (item.kind === "event" && item.event && isUnset(item.event.personId)) {
        item.event.personId = match.personId;
        item.event.personMatchStatus = "matched";
      } else if (item.kind === "task" && item.task && isUnset(item.task.personId)) {
        item.task.personId = match.personId;
        item.task.personMatchStatus = "matched";
      }
    } else if (item.kind === "event" && item.event && isUnset(item.event.personId)) {
      item.event.personMatchStatus = "child_unresolved";
    } else if (item.kind === "task" && item.task && isUnset(item.task.personId)) {
      item.task.personMatchStatus = "child_unresolved";
    }
  }
}
