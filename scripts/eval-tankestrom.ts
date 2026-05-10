/**
 * Braintrust eval-runner for Tankestrømmen (regression-harness adapter).
 * Kjør: npm run eval:tankestrom | npm run eval:tankestrom:dry
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTankestromExpected, resolveExpectedPath } from "../src/evals/tankestrom-expected";
import { TANKESTROM_FIXTURE_DEFS } from "../src/evals/tankestrom-fixtures";
import { runAllTankestromScorers } from "../src/evals/tankestrom-scorers";
import { runTankestromFixture } from "../src/lib/tankestrom-regression-fixture-runner";

const FIXTURES = TANKESTROM_FIXTURE_DEFS;

const SCHEMA_VERSION = "tankestrom-eval-v1";
const MODEL_LABEL = "tankestrom-regression-harness";

const __dirname = dirname(fileURLToPath(import.meta.url));

function repoRoot(): string {
  return resolve(__dirname, "..");
}

function loadOptionalEnvLocal(root: string): void {
  const p = resolve(root, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined || process.env[k] === "") {
      process.env[k] = v;
    }
  }
}

function tryGitSha(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", cwd: repoRoot() }).trim();
  } catch {
    return undefined;
  }
}

function tryGitBranch(): string | undefined {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8", cwd: repoRoot() }).trim();
  } catch {
    return undefined;
  }
}

function summarizeOutput(bundle: ReturnType<typeof runTankestromFixture>) {
  return {
    parentTitle: bundle.parentTitle,
    childCount: bundle.children.length,
    children: bundle.children.map((c) => ({
      day: c.day,
      title: c.title,
      date: c.date,
      timePrecision: c.timePrecision,
      tentative: c.tentative,
      highlights: c.highlights,
      bringItems: c.bringItems,
    })),
    tasks: bundle.tasks,
  };
}

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const root = repoRoot();
  loadOptionalEnvLocal(root);

  if (!dry) {
    const key = process.env.BRAINTRUST_API_KEY?.trim();
    if (!key) {
      console.error(
        "Mangler BRAINTRUST_API_KEY. Eksporter nøkkelen, legg den i .env.local, eller kjør med --dry.",
      );
      process.exit(1);
    }
  }

  type BraintrustModule = typeof import("braintrust");
  let braintrust: BraintrustModule | null = null;
  if (!dry) {
    braintrust = await import("braintrust");
  }

  const experiment =
    !dry && braintrust
      ? braintrust.init("Tankestrommen", {
          apiKey: process.env.BRAINTRUST_API_KEY,
          experiment: `tankestrom-eval-${new Date().toISOString().replace(/[:.]/g, "-")}`,
          metadata: {
            schemaVersion: SCHEMA_VERSION,
            model: MODEL_LABEL,
            branch: tryGitBranch(),
            commit: tryGitSha(),
          },
        })
      : null;

  const rows: Array<{
    fixtureId: string;
    average: number;
    scores: Record<string, number>;
    failures: string[];
    styleWarnings: string[];
    semanticNearMisses: string[];
    latencyMs: number;
  }> = [];

  for (const fx of FIXTURES) {
    const fixturePath = resolve(root, fx.rel);
    const expectedPath = resolveExpectedPath(root, fx.id);
    const expected = loadTankestromExpected(expectedPath);
    const t0 = performance.now();
    const bundle = runTankestromFixture(fixturePath, { category: expected.category });
    const latencyMs = Math.round(performance.now() - t0);

    const { scores, failures, styleWarnings, semanticNearMisses, average } = runAllTankestromScorers(
      bundle,
      expected,
    );
    const category = expected.category ?? "unknown";

    const metadata: Record<string, unknown> = {
      fixtureId: fx.id,
      category,
      model: MODEL_LABEL,
      schemaVersion: expected.schemaVersion,
      evalSchema: SCHEMA_VERSION,
      latencyMs,
      estimatedCost: null,
      tokenCount: null,
      branch: tryGitBranch(),
      commit: tryGitSha(),
      failures,
      styleWarnings,
      semanticNearMisses,
    };

    rows.push({ fixtureId: fx.id, average, scores, failures, styleWarnings, semanticNearMisses, latencyMs });

    if (dry) {
      console.log(`\n=== ${fx.id} ===`);
      console.log(`structureAverage: ${average.toFixed(4)}`);
      console.log("scores:", JSON.stringify(scores, null, 2));
      if (failures.length) console.log("criticalFailures:\n", failures.join("\n"));
      if (styleWarnings.length) console.log("styleWarnings:\n", styleWarnings.join("\n"));
      if (semanticNearMisses.length) {
        console.log("semanticNearMisses:\n", semanticNearMisses.join("\n"));
      }
    } else if (experiment) {
      const { structureAverage: _avg, ...scoresForBt } = scores;
      experiment.log({
        input: { fixtureId: fx.id, fixturePath: fx.rel, category },
        output: summarizeOutput(bundle),
        expected,
        scores: scoresForBt,
        metadata: { ...metadata, structureAverage: average },
        metrics: { latencyMs },
      });
    }
  }

  if (experiment) {
    await experiment.flush();
    const summary = await experiment.summarize({ summarizeScores: true });
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const overall = rows.reduce((s, r) => s + r.average, 0) / rows.length;
    console.log(`\nDry-run fullført. Gjennomsnitt structureAverage: ${overall.toFixed(4)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
