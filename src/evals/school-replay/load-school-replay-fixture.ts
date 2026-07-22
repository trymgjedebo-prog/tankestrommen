/**
 * Filbasert loader for school-replay-fixtures. All filsystemlogikk bor HER — den rene replay-
 * runneren (`school-canonical-replay.ts`) leser aldri filer. Ingen nettverk, ingen `.env`, ingen
 * route-import.
 *
 * Fixture-mappe:
 *   model-response.txt  — modellens rå tekstinnhold (choices[0].message.content), IKKE envelope
 *   source.txt          — sammenslått kilde-/dokumenttekst (produksjonens sourceText)
 *   context.json        — { schemaVersion, now, sourceType, proposalId, languageTrack, personContext }
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunSchoolCanonicalReplayInput } from "@/lib/school-canonical-replay";
import type { SchoolLanguageTrackResolution } from "@/lib/school-language-track";
import type { PortalImportContext } from "@/lib/portal-import-person";

const CONTEXT_SCHEMA_VERSION = "1.0.0";

type RawReplayContext = {
  schemaVersion?: unknown;
  now?: unknown;
  sourceType?: unknown;
  proposalId?: unknown;
  languageTrack?: unknown;
  personContext?: unknown;
};

function fail(fixtureDir: string, message: string): never {
  throw new Error(`Ugyldig school-replay-fixture i «${fixtureDir}»: ${message}`);
}

export function loadSchoolReplayFixture(fixtureDir: string): RunSchoolCanonicalReplayInput {
  const rawModelContent = readFileSync(join(fixtureDir, "model-response.txt"), "utf8");
  const sourceText = readFileSync(join(fixtureDir, "source.txt"), "utf8");
  const contextRaw = readFileSync(join(fixtureDir, "context.json"), "utf8");

  let context: RawReplayContext;
  try {
    context = JSON.parse(contextRaw) as RawReplayContext;
  } catch {
    fail(fixtureDir, "context.json er ikke gyldig JSON.");
  }
  if (context.schemaVersion !== CONTEXT_SCHEMA_VERSION) {
    fail(fixtureDir, `context.schemaVersion må være "${CONTEXT_SCHEMA_VERSION}".`);
  }
  if (typeof context.now !== "string" || Number.isNaN(new Date(context.now).getTime())) {
    fail(fixtureDir, "context.now må være en gyldig ISO-dato-streng.");
  }
  if (typeof context.sourceType !== "string" || context.sourceType.trim() === "") {
    fail(fixtureDir, "context.sourceType må være en ikke-tom streng.");
  }
  if (typeof context.proposalId !== "string" || context.proposalId.trim() === "") {
    fail(fixtureDir, "context.proposalId må være en ikke-tom streng.");
  }
  if (!context.personContext || typeof context.personContext !== "object") {
    fail(fixtureDir, "context.personContext må være et objekt (PortalImportContext-form).");
  }

  // JSON kan ikke uttrykke undefined: `null` (eller utelatt) betyr «ingen språksporbeslutning».
  const languageTrack =
    context.languageTrack === null || context.languageTrack === undefined
      ? undefined
      : (context.languageTrack as SchoolLanguageTrackResolution);

  return {
    rawModelContent,
    sourceText,
    now: new Date(context.now),
    sourceType: context.sourceType,
    proposalId: context.proposalId,
    languageTrack,
    personContext: context.personContext as PortalImportContext,
  };
}
