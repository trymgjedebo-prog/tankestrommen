/**
 * EKSPLISITT manifest over alle semantiske regression-fixtures for skole-replay-batchen.
 * Ingen globbing, ingen runtime-discovery: batchen kjører NØYAKTIG disse mappene, i NØYAKTIG
 * denne rekkefølgen. `smoke` er bevisst utelatt — den er en smoke-fixture, ikke en regression.
 *
 * `family` er ORGANISERING (grupperingsrekkefølgen i manifestet), ikke semantisk fasit:
 * faktiske check-kategorier kommer alltid fra evaluatorrapportene (via check-typen).
 * Eksempel: `language-track-unresolved` ligger i LANGUAGE_TRACK-familien, men forventningene
 * dens er SUBJECT_PLACEMENT- og DUPLICATION-checks (bevaring uten fagplassering).
 */
import type { SchoolReplayFailureCategory } from "@/lib/school-replay-expectations";

export type SchoolSemanticFixtureManifestEntry = {
  /** Skal være identisk med `fixtureId` i mappens expectations.json (verifiseres av batchen). */
  fixtureId: string;
  /** Relativt mappenavn under fixtures-roten. */
  dir: string;
  /** Organiserende familie — IKKE kilde til check-kategori. */
  family: SchoolReplayFailureCategory;
};

export const SCHOOL_SEMANTIC_FIXTURE_MANIFEST: readonly SchoolSemanticFixtureManifestEntry[] = [
  // 1. DAY_OPERATION
  { fixtureId: "day-operation-free-day", dir: "day-operation-free-day", family: "DAY_OPERATION" },
  { fixtureId: "day-operation-exam-day", dir: "day-operation-exam-day", family: "DAY_OPERATION" },
  // 2. SUBJECT_PLACEMENT
  { fixtureId: "subject-placement-multi-subject", dir: "subject-placement-multi-subject", family: "SUBJECT_PLACEMENT" },
  { fixtureId: "subject-placement-day-scope", dir: "subject-placement-day-scope", family: "SUBJECT_PLACEMENT" },
  // 3. LANGUAGE_TRACK
  { fixtureId: "language-track-selected", dir: "language-track-selected", family: "LANGUAGE_TRACK" },
  { fixtureId: "language-track-unresolved", dir: "language-track-unresolved", family: "LANGUAGE_TRACK" },
  // 4. DUPLICATION
  { fixtureId: "duplication-single-logical-item", dir: "duplication-single-logical-item", family: "DUPLICATION" },
  { fixtureId: "duplication-no-residual-leak", dir: "duplication-no-residual-leak", family: "DUPLICATION" },
  { fixtureId: "duplication-day-scope", dir: "duplication-day-scope", family: "DUPLICATION" },
  // 5. SOURCE_COVERAGE
  { fixtureId: "source-coverage-full", dir: "source-coverage-full", family: "SOURCE_COVERAGE" },
  { fixtureId: "source-coverage-partial", dir: "source-coverage-partial", family: "SOURCE_COVERAGE" },
];
