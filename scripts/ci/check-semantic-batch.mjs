/**
 * CI-validator for semantic batch-rapporten (`eval:school:semantic:batch`).
 *
 * Leser rapportfilen, validerer dagens eksplisitte kontrakt (11 fixtures / 36 checks /
 * kategorisummer i fast rekkefølge) og presenterer `firstFailure` tydelig. Utfører ALDRI
 * egen semantisk matching — kun lesing av batchrapportens kontrollerte felter.
 *
 * Ren Node stdlib: ingen dependencies, ingen nettverk, ingen `.env`, ingen klokke/random.
 * Fungerer lokalt (Windows) og i GitHub Actions (Linux). Exit 0 = kontrakten holder, 1 = brudd.
 *
 * Bruk: node scripts/ci/check-semantic-batch.mjs <rapportfil>
 */
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/** Dagens forventede totalsummer — utvides bevisst sammen med nye fixtures. */
export const EXPECTED_BATCH_TOTALS = {
  fixturesTotal: 11,
  checksTotal: 36,
  byCategory: {
    DAY_OPERATION: 4,
    SUBJECT_PLACEMENT: 19,
    LANGUAGE_TRACK: 2,
    DUPLICATION: 9,
    SOURCE_COVERAGE: 2,
  },
};

export const BATCH_CATEGORY_ORDER = [
  "DAY_OPERATION",
  "SUBJECT_PLACEMENT",
  "LANGUAGE_TRACK",
  "DUPLICATION",
  "SOURCE_COVERAGE",
];

/** Én linje bygget av firstFailure sine kontrollerte felter — aldri stier eller stack traces. */
export function formatFirstFailure(firstFailure) {
  if (!firstFailure || typeof firstFailure !== "object") return null;
  return `fixture «${firstFailure.fixtureId}», check «${firstFailure.checkId}» [${firstFailure.category}]: ${firstFailure.description}`;
}

/** Ren validering av et allerede parset rapportobjekt. Returnerer { ok, problems }. */
export function validateSemanticBatchReport(report, expected = EXPECTED_BATCH_TOTALS) {
  const problems = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return { ok: false, problems: ["Batchrapporten er ikke et JSON-objekt."] };
  }
  if (report.error && typeof report.error === "object") {
    problems.push(`Batch-CLI-en rapporterte operasjonell feil: ${report.error.code}: ${report.error.message}`);
    return { ok: false, problems };
  }
  if (report.schemaVersion !== "1.0.0") {
    problems.push(`schemaVersion er ${JSON.stringify(report.schemaVersion)}, forventet "1.0.0".`);
  }
  if (report.passed !== true) {
    problems.push(`passed er ${JSON.stringify(report.passed)}, forventet true.`);
    const first = formatFirstFailure(report.firstFailure);
    if (first) problems.push(`Første semantiske feil: ${first}`);
  }
  const s = report.summary;
  if (!s || typeof s !== "object") {
    problems.push("summary mangler eller er ikke et objekt.");
    return { ok: false, problems };
  }
  const exactFields = {
    fixturesTotal: expected.fixturesTotal,
    fixturesPassed: expected.fixturesTotal,
    fixturesFailed: 0,
    checksTotal: expected.checksTotal,
    checksPassed: expected.checksTotal,
    checksFailed: 0,
  };
  for (const [field, want] of Object.entries(exactFields)) {
    if (s[field] !== want) problems.push(`summary.${field} er ${JSON.stringify(s[field])}, forventet ${want}.`);
  }
  if (report.firstFailure !== null) {
    problems.push(`firstFailure er ikke null: ${formatFirstFailure(report.firstFailure) ?? JSON.stringify(report.firstFailure)}`);
  }
  const byCategory = s.byCategory;
  if (!byCategory || typeof byCategory !== "object") {
    problems.push("summary.byCategory mangler.");
    return { ok: problems.length === 0, problems };
  }
  const actualOrder = Object.keys(byCategory);
  if (JSON.stringify(actualOrder) !== JSON.stringify(BATCH_CATEGORY_ORDER)) {
    problems.push(`byCategory-kategoriene/rekkefølgen er [${actualOrder.join(", ")}], forventet [${BATCH_CATEGORY_ORDER.join(", ")}].`);
  }
  for (const category of BATCH_CATEGORY_ORDER) {
    const want = expected.byCategory[category];
    const got = byCategory[category];
    if (!got || typeof got !== "object") {
      problems.push(`byCategory.${category} mangler.`);
      continue;
    }
    if (got.total !== want) problems.push(`byCategory.${category}.total er ${JSON.stringify(got.total)}, forventet ${want}.`);
    if (got.passed !== want) problems.push(`byCategory.${category}.passed er ${JSON.stringify(got.passed)}, forventet ${want}.`);
    if (got.failed !== 0) problems.push(`byCategory.${category}.failed er ${JSON.stringify(got.failed)}, forventet 0.`);
  }
  return { ok: problems.length === 0, problems };
}

/** Parser + validerer rapporttekst; ugyldig JSON gir kontrollert problem, aldri exception. */
export function validateSemanticBatchReportText(text, expected = EXPECTED_BATCH_TOTALS) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["Batchrapporten er ikke gyldig JSON."], report: null };
  }
  const result = validateSemanticBatchReport(parsed, expected);
  return { ...result, report: parsed };
}

/** Kort Markdown-oppsummering for $GITHUB_STEP_SUMMARY — ingen ny kontrakt, kun visning. */
export function buildStepSummary(report) {
  const lines = ["## School semantic replay batch"];
  const s = report && typeof report === "object" ? report.summary : undefined;
  if (!s || typeof s !== "object") {
    lines.push("", "Rapporten manglet gyldig summary.");
    return lines.join("\n");
  }
  lines.push(
    "",
    `- Resultat: ${report.passed === true ? "PASS" : "FAIL"}`,
    `- Fixtures: ${s.fixturesPassed}/${s.fixturesTotal} (failed: ${s.fixturesFailed})`,
    `- Checks: ${s.checksPassed}/${s.checksTotal} (failed: ${s.checksFailed})`,
    `- firstFailure: ${formatFirstFailure(report.firstFailure) ?? "none"}`,
    "",
    "| Kategori | Total | Passed | Failed |",
    "| --- | --- | --- | --- |",
  );
  for (const category of BATCH_CATEGORY_ORDER) {
    const c = s.byCategory?.[category] ?? {};
    lines.push(`| ${category} | ${c.total ?? "?"} | ${c.passed ?? "?"} | ${c.failed ?? "?"} |`);
  }
  return lines.join("\n");
}

function main() {
  const reportPath = process.argv[2] ?? "semantic-batch-report.json";
  let text;
  try {
    text = readFileSync(reportPath, "utf8");
  } catch {
    console.error(`::error title=School semantic replay::Fant ikke batchrapporten (${reportPath}).`);
    return 1;
  }
  const { ok, problems, report } = validateSemanticBatchReportText(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${buildStepSummary(report)}\n`);
  }
  if (ok) {
    console.log(
      `Semantic batch OK: ${EXPECTED_BATCH_TOTALS.fixturesTotal} fixtures, ${EXPECTED_BATCH_TOTALS.checksTotal} checks, firstFailure: none.`,
    );
    return 0;
  }
  for (const problem of problems) console.error(problem);
  const firstFailureLine = report ? formatFirstFailure(report.firstFailure) : null;
  const annotation = firstFailureLine ?? problems[0] ?? "Batchrapporten brøt kontrakten.";
  console.error(`::error title=School semantic replay::${annotation}`);
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
