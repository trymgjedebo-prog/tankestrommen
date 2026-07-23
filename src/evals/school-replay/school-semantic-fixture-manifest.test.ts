/**
 * Manifesttester: låser at det eksplisitte manifestet lister nøyaktig de elleve
 * regression-fixturene i fast rekkefølge, at alle mapper/filer finnes, at fixtureId matcher
 * expectations, og at alle fem familier er representert — med kategoriinnhold verifisert fra
 * de FAKTISKE check-typene (via CHECK_KIND_CATEGORY), aldri inferert fra mappenavn.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCHOOL_SEMANTIC_FIXTURE_MANIFEST } from "./school-semantic-fixture-manifest";
import { loadSchoolReplayExpectations } from "./load-school-replay-expectations";
import { CHECK_KIND_CATEGORY, type SchoolReplayFailureCategory } from "@/lib/school-replay-expectations";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const REQUIRED_FIXTURE_FILES = ["model-response.txt", "source.txt", "context.json", "expectations.json"];

const FAMILY_ORDER: SchoolReplayFailureCategory[] = [
  "DAY_OPERATION",
  "SUBJECT_PLACEMENT",
  "LANGUAGE_TRACK",
  "DUPLICATION",
  "SOURCE_COVERAGE",
];

describe("school semantic fixture manifest", () => {
  it("lister nøyaktig elleve regression-fixtures i fast, eksplisitt rekkefølge", () => {
    expect(SCHOOL_SEMANTIC_FIXTURE_MANIFEST).toHaveLength(11);
    // Låser hele rekkefølgen — en endring her er en bevisst kontraktendring.
    expect(SCHOOL_SEMANTIC_FIXTURE_MANIFEST.map((e) => e.fixtureId)).toEqual([
      "day-operation-free-day",
      "day-operation-exam-day",
      "subject-placement-multi-subject",
      "subject-placement-day-scope",
      "language-track-selected",
      "language-track-unresolved",
      "duplication-single-logical-item",
      "duplication-no-residual-leak",
      "duplication-day-scope",
      "source-coverage-full",
      "source-coverage-partial",
    ]);
  });

  it("har unike fixtureId-er og unike paths; smoke er ikke med", () => {
    const ids = SCHOOL_SEMANTIC_FIXTURE_MANIFEST.map((e) => e.fixtureId);
    const dirs = SCHOOL_SEMANTIC_FIXTURE_MANIFEST.map((e) => e.dir);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(dirs).size).toBe(dirs.length);
    expect(ids).not.toContain("smoke");
    expect(dirs).not.toContain("smoke");
  });

  it("alle fixture-mapper finnes med de fire nødvendige filene", () => {
    for (const entry of SCHOOL_SEMANTIC_FIXTURE_MANIFEST) {
      for (const file of REQUIRED_FIXTURE_FILES) {
        expect(existsSync(join(FIXTURES_ROOT, entry.dir, file)), `${entry.dir}/${file}`).toBe(true);
      }
    }
  });

  it("manifestets fixtureId matcher expectations.fixtureId i hver mappe", () => {
    for (const entry of SCHOOL_SEMANTIC_FIXTURE_MANIFEST) {
      const expectations = loadSchoolReplayExpectations(join(FIXTURES_ROOT, entry.dir));
      expect(expectations.fixtureId, entry.dir).toBe(entry.fixtureId);
    }
  });

  it("familiene grupperes i fast rekkefølge og alle fem er representert", () => {
    expect(SCHOOL_SEMANTIC_FIXTURE_MANIFEST.map((e) => e.family)).toEqual([
      "DAY_OPERATION",
      "DAY_OPERATION",
      "SUBJECT_PLACEMENT",
      "SUBJECT_PLACEMENT",
      "LANGUAGE_TRACK",
      "LANGUAGE_TRACK",
      "DUPLICATION",
      "DUPLICATION",
      "DUPLICATION",
      "SOURCE_COVERAGE",
      "SOURCE_COVERAGE",
    ]);
    expect(new Set(SCHOOL_SEMANTIC_FIXTURE_MANIFEST.map((e) => e.family))).toEqual(new Set(FAMILY_ORDER));
  });

  it("hver familie dekkes av FAKTISKE check-kategorier i familiens expectations (ikke mappenavn)", () => {
    // family er organisering — enkeltfixtures kan ha checks i andre kategorier (f.eks. har
    // language-track-unresolved SUBJECT_PLACEMENT- og DUPLICATION-checks). Kravet her er at
    // familien SAMLET faktisk utøver sin kategori i minst én check.
    for (const family of FAMILY_ORDER) {
      const categories = new Set<SchoolReplayFailureCategory>();
      for (const entry of SCHOOL_SEMANTIC_FIXTURE_MANIFEST.filter((e) => e.family === family)) {
        const expectations = loadSchoolReplayExpectations(join(FIXTURES_ROOT, entry.dir));
        for (const check of expectations.checks) categories.add(CHECK_KIND_CATEGORY[check.kind]);
      }
      expect(categories.has(family), `familien ${family} mangler checks i sin egen kategori`).toBe(true);
    }
  });
});
