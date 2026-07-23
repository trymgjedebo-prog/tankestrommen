/**
 * CI-validator for dry-eval-output (`eval:tankestrom:dry`).
 *
 * Stoler ikke på exit code alene: leser den faktiske outputen og krever at ALLE forekomster
 * av structureAverage er nøyaktig 1 (både menneskelig `structureAverage: 1.0000` og
 * JSON-formen `"structureAverage": 1`), og at minst én forekomst finnes.
 *
 * Ren Node stdlib: ingen dependencies, ingen nettverk, ingen `.env`, ingen klokke/random.
 * Exit 0 = kontrakten holder, 1 = brudd.
 *
 * Bruk: node scripts/ci/check-dry-eval.mjs <outputfil>
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/** Finner alle structureAverage-verdier i både tekst- og JSON-form. */
export function extractStructureAverages(text) {
  if (typeof text !== "string") return [];
  const values = [];
  const re = /"?structureAverage"?\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    values.push(Number.parseFloat(match[1]));
  }
  return values;
}

/** Ren validering: minst én verdi, og alle må være nøyaktig 1. */
export function validateDryEvalOutput(text) {
  const values = extractStructureAverages(text);
  const problems = [];
  if (values.length === 0) {
    problems.push("Fant ingen structureAverage i dry-eval-output.");
  }
  for (const value of values) {
    if (value !== 1) problems.push(`structureAverage er ${value}, forventet nøyaktig 1.`);
  }
  return { ok: problems.length === 0, values, problems };
}

function main() {
  const outputPath = process.argv[2] ?? "dry-eval-output.txt";
  let text;
  try {
    text = readFileSync(outputPath, "utf8");
  } catch {
    console.error(`::error title=Dry eval::Fant ikke dry-eval-outputfilen (${outputPath}).`);
    return 1;
  }
  const { ok, values, problems } = validateDryEvalOutput(text);
  if (ok) {
    console.log(`Dry eval OK: structureAverage = 1 (${values.length} forekomst(er) kontrollert).`);
    return 0;
  }
  for (const problem of problems) console.error(problem);
  console.error(`::error title=Dry eval::${problems[0]}`);
  return 1;
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  process.exit(main());
}
