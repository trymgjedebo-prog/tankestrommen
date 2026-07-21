/**
 * Delt, ren mapping + konfliktløsning fra NORMALISERTE `SchoolDayOperationSignal` til wire-
 * operasjonen `SchoolBlockDayOperation`. Semantisk UENDRET ekstraksjon fra `school-block-proposal.ts`
 * (samme implementasjon, samme konflikt-/dedup-regel) slik at den kommende canonical-adapteren kan
 * gjenbruke den uten å dra inn schoolBlock-builderen og uten å duplisere logikk.
 *
 * Ansvaret her er KUN: (1) ett normalisert signal → én wire-operasjon, og (2) konfliktløsning når
 * flere operasjoner gjelder samme dag. Denne modulen eier IKKE: rå-AI-signalnormalisering (se
 * `school-day-operation-signals-normalize.ts`), daggruppering, dayId/itemId, review-flagg-bygging,
 * dayResolution-avledning eller noen builder-/adapter-spesifikk logikk.
 *
 * Ren: ingen Next.js/OpenAI/env/nettverk/sideeffekter; ingen fritekst-tolkning. Muterer aldri input.
 */
import type { SchoolBlockDayOperation, SchoolDayOperationSignal } from "@/lib/types";

/** Utfall av dagsoperasjons-resolusjon for én dag: en valgt operasjon, eller konflikt. */
export type DayOperationResolution =
  | { kind: "operation"; dayOperation: SchoolBlockDayOperation }
  | { kind: "conflict" };

/** Ett normalisert signal → dags-operasjon (eksisterende wire-kontrakt, ingen nye felt). */
export function schoolDayOperationFromSignal(signal: SchoolDayOperationSignal): SchoolBlockDayOperation {
  switch (signal.operation) {
    case "adjust_start":
      return {
        op: "adjust_start",
        effectiveStart: signal.effectiveStart,
        reason: signal.reason,
        confidence: signal.confidence,
      };
    case "adjust_end":
      return {
        op: "adjust_end",
        effectiveEnd: signal.effectiveEnd,
        reason: signal.reason,
        confidence: signal.confidence,
      };
    case "replace_day":
      return {
        op: "replace_day",
        activityKind: signal.activityKind,
        effectiveStart: signal.effectiveStart,
        effectiveEnd: signal.effectiveEnd,
        reason: signal.reason,
        confidence: signal.confidence,
      };
  }
}

/** Signatur som skiller ULIKE operasjoner (ignorerer reason/confidence/dagsscope-form). */
function operationSignature(op: SchoolBlockDayOperation): string {
  switch (op.op) {
    case "adjust_start":
      return `adjust_start|${op.effectiveStart}`;
    case "adjust_end":
      return `adjust_end|${op.effectiveEnd}`;
    case "replace_day":
      return `replace_day|${op.activityKind}|${op.effectiveStart ?? ""}|${op.effectiveEnd ?? ""}`;
    case "none":
      return "none";
  }
}

function operationConfidence(op: SchoolBlockDayOperation): number {
  return op.op === "none" ? 0 : op.confidence;
}

/** Deterministisk valg innen samme signatur: høyest confidence, deretter minste reason. */
function isPreferredOperation(
  candidate: SchoolBlockDayOperation,
  existing: SchoolBlockDayOperation,
): boolean {
  const cc = operationConfidence(candidate);
  const ec = operationConfidence(existing);
  if (cc !== ec) return cc > ec;
  const cr = candidate.op === "none" ? "" : candidate.reason ?? "";
  const er = existing.op === "none" ? "" : existing.reason ?? "";
  return cr < er;
}

/**
 * Løs flere operasjoner for ÉN dag. `none` er en NØYTRAL fraværsverdi, ikke en konkurrerende
 * operasjon — den filtreres bort før signatur/dedup, slik at konflikt kun avgjøres mellom AKTIVE
 * operasjoner. Aktive operasjoner som deler samme OPERASJONSSIGNATUR (samme handling/tider) regnes
 * som samme operasjon og kollapses deterministisk (høyest confidence, så minste reason); to ULIKE
 * aktive signaturer → konflikt. Ingen aktive operasjoner → `{ op: "none" }`. Muterer aldri input;
 * rekkefølge-uavhengig.
 *
 * NB: produksjonsbuilderen sender aldri `none` inn her (`schoolDayOperationFromSignal` returnerer
 * aldri `none`), så filtreringen endrer ikke eksisterende produksjonsoutput — den gjør bare
 * funksjonen total og korrekt for `none`-som-fravær.
 */
export function resolveSchoolDayOperationConflict(
  operations: readonly SchoolBlockDayOperation[],
): DayOperationResolution {
  const active = operations.filter((op) => op.op !== "none");
  if (active.length === 0) return { kind: "operation", dayOperation: { op: "none" } };
  const bySignature = new Map<string, SchoolBlockDayOperation>();
  for (const op of active) {
    const sig = operationSignature(op);
    const existing = bySignature.get(sig);
    if (!existing || isPreferredOperation(op, existing)) bySignature.set(sig, op);
  }
  if (bySignature.size >= 2) return { kind: "conflict" };
  return { kind: "operation", dayOperation: [...bySignature.values()][0]! };
}
