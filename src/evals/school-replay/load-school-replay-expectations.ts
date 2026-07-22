/**
 * Filbasert loader for `expectations.json`. Leser + parser + validerer — kjører ALDRI replay.
 * Ingen nettverk, ingen `.env`, ingen route-import. Semantisk evaluering bor i den rene
 * evaluatoren; replay-fixture-loaderen er uendret og har ikke dette ansvaret.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateSchoolReplayExpectations,
  type SchoolReplayExpectations,
} from "@/lib/school-replay-expectations";

export function loadSchoolReplayExpectations(fixtureDir: string): SchoolReplayExpectations {
  const path = join(fixtureDir, "expectations.json");
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Ugyldig school-replay-expectations i «${path}»: ikke gyldig JSON.`);
  }
  return validateSchoolReplayExpectations(parsed);
}
