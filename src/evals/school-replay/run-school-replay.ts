/**
 * CLI: kjør canonical skole-replay offline fra en fixture-mappe.
 *
 *   tsx src/evals/school-replay/run-school-replay.ts <fixture-dir>
 *
 * Skriver stabil, formatert JSON (replay-resultatet) til stdout. Exit 0 ved suksess; exit 1 ved
 * parse-/fixturefeil; exit 2 ved manglende argument. Ingen nettverk, ingen `.env`, ingen
 * route-import, skriver aldri filer, endrer aldri repoet.
 */
import { loadSchoolReplayFixture } from "./load-school-replay-fixture";
import { runSchoolCanonicalReplayFromModelResponse } from "@/lib/school-canonical-replay";

const fixtureDir = process.argv[2];
if (!fixtureDir) {
  console.error("Bruk: run-school-replay.ts <fixture-dir> (mappe med model-response.txt, source.txt, context.json)");
  process.exit(2);
}

try {
  const input = loadSchoolReplayFixture(fixtureDir);
  const result = runSchoolCanonicalReplayFromModelResponse(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
