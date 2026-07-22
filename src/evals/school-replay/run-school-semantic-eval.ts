/**
 * CLI: semantisk evaluering av en school-replay-fixture (offline).
 *
 *   tsx src/evals/school-replay/run-school-semantic-eval.ts <fixture-dir>
 *
 * Flyt: loadSchoolReplayFixture → runSchoolCanonicalReplayFromModelResponse →
 * loadSchoolReplayExpectations → evaluateSchoolReplaySemantics → JSON-rapport til stdout.
 *
 * Exit codes:
 *   0 — alle checks består
 *   1 — replay fullførte, men ≥1 semantisk check feiler (FULL gyldig JSON-rapport skrives likevel)
 *   2 — fixture-/expectations-/parse-/runtime-feil (presis feil til stderr)
 *
 * Ingen nettverk, ingen `.env`, ingen route-import; skriver aldri filer, endrer aldri repoet.
 */
import { loadSchoolReplayFixture } from "./load-school-replay-fixture";
import { loadSchoolReplayExpectations } from "./load-school-replay-expectations";
import { runSchoolCanonicalReplayFromModelResponse } from "@/lib/school-canonical-replay";
import { evaluateSchoolReplaySemantics } from "@/lib/school-replay-semantic-evaluator";

const fixtureDir = process.argv[2];
if (!fixtureDir) {
  console.error("Bruk: run-school-semantic-eval.ts <fixture-dir> (mappe med model-response.txt, source.txt, context.json, expectations.json)");
  process.exit(2);
}

try {
  const input = loadSchoolReplayFixture(fixtureDir);
  const replay = runSchoolCanonicalReplayFromModelResponse(input);
  const expectations = loadSchoolReplayExpectations(fixtureDir);
  const report = evaluateSchoolReplaySemantics(replay, expectations);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.passed ? 0 : 1);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}
