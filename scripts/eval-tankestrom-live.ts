/**
 * Live Braintrust-eval med faktisk LLM-analyse (tekstfixtures).
 * Sett OPENAI_API_KEY og BRAINTRUST_API_KEY. Modell: --model=... eller EVAL_TANKESTROM_MODEL.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  effectiveEvalShape,
  loadTankestromExpected,
  resolveExpectedPath,
  type DayKey,
  type TankestromExpected,
} from "../src/evals/tankestrom-expected";
import {
  parseFixturesArg,
  resolveFixtureDefs,
  resolveFixturePath,
  TANKESTROM_LIVE_DEFAULT_FIXTURE_IDS,
} from "../src/evals/tankestrom-fixtures";
import { runAllTankestromScorers } from "../src/evals/tankestrom-scorers";
import {
  aggregateTokenUsage,
  runLiveFixtureAnalysis,
} from "../src/evals/tankestrom-live-runner";
import {
  describeTankestromEvalModelContext,
  parseModelArg,
} from "../src/lib/eval/tankestrom-eval-model-override";
import {
  getLightAnalysisModelBaseline,
  getStrongAnalysisModelBaseline,
} from "../src/lib/ai/analysis-model-router";
import type { RegressionPortalBundle } from "../src/lib/tankestrom-regression-fixture-runner";

const SCHEMA_VERSION = "tankestrom-eval-live-v1";

const FAILURE_LINE = /^\[([^\]]+)\]\s*(.*)$/;

function groupFailuresByScorer(failures: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of failures) {
    const m = line.match(FAILURE_LINE);
    if (!m) {
      (out._unparsed ??= []).push(line);
      continue;
    }
    const name = m[1];
    const msg = m[2];
    (out[name] ??= []).push(msg);
  }
  return out;
}

/** Samme normalisering som i tankestrom-scorers (deadlineCorrect). */
function normNo(s: string): string {
  return s
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

function summarizeRequiredTasks(
  bundle: RegressionPortalBundle,
  expected: TankestromExpected,
): { found: string[]; missing: string[] } {
  const found: string[] = [];
  const missing: string[] = [];
  for (const req of expected.requiredTasks) {
    const hit = bundle.tasks.find(
      (t) =>
        normNo(t.title).includes(normNo(req.titleIncludes)) &&
        t.date === req.date &&
        t.dueTime === req.dueTime,
    );
    const label = `${req.titleIncludes} | date=${req.date ?? "null"} | due=${req.dueTime ?? "null"}`;
    if (hit) found.push(label);
    else missing.push(label);
  }
  return { found, missing };
}

function bundleContext(bundle: RegressionPortalBundle): {
  childTitles: string[];
  highlightsByDay: Partial<Record<DayKey, string[]>>;
  timePrecisionByDay: Partial<Record<DayKey, string>>;
  tentativeDays: Partial<Record<DayKey, boolean>>;
} {
  const childTitles = bundle.children.map((c) => c.title);
  const highlightsByDay: Partial<Record<DayKey, string[]>> = {};
  const timePrecisionByDay: Partial<Record<DayKey, string>> = {};
  const tentativeDays: Partial<Record<DayKey, boolean>> = {};
  for (const c of bundle.children) {
    highlightsByDay[c.day] = c.highlights;
    timePrecisionByDay[c.day] = c.timePrecision;
    tentativeDays[c.day] = c.tentative;
  }
  return { childTitles, highlightsByDay, timePrecisionByDay, tentativeDays };
}

function printFixtureStdoutSummary(params: {
  fixtureId: string;
  selectedModel: string | undefined;
  structureAverage: number;
  scores: Record<string, number>;
  failures: string[];
  styleWarnings: string[];
  semanticNearMisses: string[];
  regressionBundle: RegressionPortalBundle;
  expected: TankestromExpected;
  latencyMs: number;
  modelOverrideUsed: boolean;
  tokens: ReturnType<typeof aggregateTokenUsage>;
}): void {
  const { scores, failures, styleWarnings, semanticNearMisses, regressionBundle, expected } = params;
  const failedScorers = Object.entries(scores)
    .filter(([k, v]) => k !== "structureAverage" && v < 1)
    .map(([k]) => k)
    .sort();
  const byScorer = groupFailuresByScorer(failures);
  const ctx = bundleContext(regressionBundle);
  const taskSumm = summarizeRequiredTasks(regressionBundle, expected);

  const lines: string[] = [];
  lines.push("");
  lines.push(`━━━━ ${params.fixtureId} ━━━━`);
  lines.push(`fixtureId: ${params.fixtureId}`);
  lines.push(`selectedModel: ${params.selectedModel ?? "(unknown)"}`);
  lines.push(`structureAverage: ${params.structureAverage}`);
  lines.push(`latencyMs: ${params.latencyMs}`);
  lines.push(`modelOverrideUsed: ${params.modelOverrideUsed}`);
  lines.push(
    failedScorers.length ? `failedScorers: ${failedScorers.join(", ")}` : "failedScorers: (none)",
  );

  lines.push("criticalFailures (max 5 lines per scorer):");
  if (failedScorers.length === 0) {
    lines.push("  (none)");
  } else {
    for (const name of failedScorers) {
      const msgs = byScorer[name] ?? [];
      lines.push(`  [${name}] score=${scores[name]}`);
      for (const m of msgs.slice(0, 5)) {
        lines.push(`    - ${m}`);
      }
      if (msgs.length > 5) {
        lines.push(`    … +${msgs.length - 5} more`);
      }
    }
  }

  lines.push("styleWarnings:");
  if (!styleWarnings.length) {
    lines.push("  (none)");
  } else {
    for (const w of styleWarnings.slice(0, 25)) {
      lines.push(`  - ${w}`);
    }
    if (styleWarnings.length > 25) {
      lines.push(`  … +${styleWarnings.length - 25} more`);
    }
  }

  lines.push("semanticNearMisses:");
  if (!semanticNearMisses.length) {
    lines.push("  (none)");
  } else {
    for (const s of semanticNearMisses.slice(0, 25)) {
      lines.push(`  - ${s}`);
    }
    if (semanticNearMisses.length > 25) {
      lines.push(`  … +${semanticNearMisses.length - 25} more`);
    }
  }

  if (byScorer._unparsed?.length) {
    lines.push("unparsed failure lines:");
    for (const u of byScorer._unparsed.slice(0, 5)) {
      lines.push(`  - ${u}`);
    }
    if (byScorer._unparsed.length > 5) {
      lines.push(`  … +${byScorer._unparsed.length - 5} more`);
    }
  }

  lines.push("childTitles:");
  for (const t of ctx.childTitles) {
    lines.push(`  - ${t}`);
  }

  lines.push("highlightsByDay:");
  for (const day of ["fredag", "lørdag", "søndag"] as const) {
    const hs = ctx.highlightsByDay[day];
    if (hs !== undefined && hs.length > 0) {
      lines.push(`  ${day}: ${JSON.stringify(hs)}`);
    }
  }

  lines.push("timePrecisionByDay:");
  for (const day of ["fredag", "lørdag", "søndag"] as const) {
    const p = ctx.timePrecisionByDay[day];
    if (p !== undefined) {
      lines.push(`  ${day}: ${p}`);
    }
  }

  lines.push("tentativeDays:");
  for (const day of ["fredag", "lørdag", "søndag"] as const) {
    const t = ctx.tentativeDays[day];
    if (t !== undefined) {
      lines.push(`  ${day}: ${t}`);
    }
  }

  if (expected.requiredTasks.length > 0) {
    lines.push("requiredTasks:");
    lines.push(`  found (${taskSumm.found.length}):`);
    for (const f of taskSumm.found) {
      lines.push(`    ✓ ${f}`);
    }
    lines.push(`  missing (${taskSumm.missing.length}):`);
    for (const m of taskSumm.missing) {
      lines.push(`    ✗ ${m}`);
    }
  } else {
    lines.push("requiredTasks: (none specified in expected)");
  }

  lines.push(`tokens: ${JSON.stringify(params.tokens)}`);
  console.log(lines.join("\n"));
}

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

/** --model= gjelder før importer; EVAL_TANKESTROM_MODEL fra .env når --model utelates. */
function applyModelCli(argv: string[]): void {
  const m = parseModelArg(argv);
  if (m === null) return;
  if (typeof m === "string" && m.toLowerCase() === "current") {
    delete process.env.EVAL_TANKESTROM_MODEL;
    return;
  }
  process.env.EVAL_TANKESTROM_MODEL = m;
}

async function main(): Promise<void> {
  const root = repoRoot();
  loadOptionalEnvLocal(root);
  applyModelCli(process.argv);

  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error("Mangler OPENAI_API_KEY (live-eval kaller OpenAI).");
    process.exit(1);
  }
  if (!process.env.BRAINTRUST_API_KEY?.trim()) {
    console.error("Mangler BRAINTRUST_API_KEY (live-eval logger til Braintrust).");
    process.exit(1);
  }

  const { ids: fixtureIds } = parseFixturesArg(process.argv, TANKESTROM_LIVE_DEFAULT_FIXTURE_IDS);
  const fixtures = resolveFixtureDefs(fixtureIds);

  const braintrust = await import("braintrust");
  await import("../src/app/api/analyze/route");
  const evalCtx = describeTankestromEvalModelContext();
  const requestedLabel =
    parseModelArg(process.argv) ??
    (process.env.EVAL_TANKESTROM_MODEL?.trim() || "current");

  const experiment = braintrust.init("Tankestrommen", {
    apiKey: process.env.BRAINTRUST_API_KEY,
    experiment: `tankestrom-live-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    metadata: {
      schemaVersion: SCHEMA_VERSION,
      evalKind: "live",
      branch: tryGitBranch(),
      commit: tryGitSha(),
    },
  });

  for (const fx of fixtures) {
    await experiment.traced(
      async (span) => {
        const fixturePath = resolveFixturePath(root, fx.rel);
        const expected = loadTankestromExpected(resolveExpectedPath(root, fx.id));
        const category = expected.category ?? "unknown";
        const evalShape = effectiveEvalShape(expected);

        const { regressionBundle, modelTrace, latencyMs } = await runLiveFixtureAnalysis(fixturePath);
        const { scores, failures, styleWarnings, semanticNearMisses, average } = runAllTankestromScorers(
          regressionBundle,
          expected,
        );
        const usage = aggregateTokenUsage(modelTrace);
        const selectedModel = modelTrace.finalModel ?? modelTrace.initialModel;

        const metadata: Record<string, unknown> = {
          fixtureId: fx.id,
          category,
          evalShape,
          model: requestedLabel,
          selectedModel,
          modelOverrideUsed: evalCtx.modelOverrideUsed,
          baselineLightModel: getLightAnalysisModelBaseline(),
          baselineStrongModel: getStrongAnalysisModelBaseline(),
          schemaVersion: expected.schemaVersion,
          evalSchema: SCHEMA_VERSION,
          latencyMs,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          estimatedCost: null,
          structureAverage: average,
          failures,
          styleWarnings,
          semanticNearMisses,
          branch: tryGitBranch(),
          commit: tryGitSha(),
          tokenUsageExplanation:
            usage.promptTokens != null || usage.completionTokens != null
              ? "Aggregert fra OpenAI chat.completions.usage på routed kall."
              : "Ingen usage-objekt fra API (eller tomt); sjekk modell/SDK-støtte.",
          costExplanation:
            "Ikke beregnet — OpenAI-responsen inneholder ikke USD; koble evt. prisliste manuelt i Braintrust.",
        };

        const { structureAverage: _avg, ...scoresForBt } = scores;
        span.log({
          input: { fixtureId: fx.id, fixturePath: fx.rel, category, evalShape, mode: "live_text" },
          output: {
            parentTitle: regressionBundle.parentTitle,
            childCount: regressionBundle.children.length,
            taskCount: regressionBundle.tasks.length,
          },
          expected,
          scores: scoresForBt,
          metadata,
          metrics: {
            latencyMs,
            ...(usage.promptTokens != null ? { prompt_tokens: usage.promptTokens } : {}),
            ...(usage.completionTokens != null ? { completion_tokens: usage.completionTokens } : {}),
            ...(usage.totalTokens != null ? { total_tokens: usage.totalTokens } : {}),
          },
        });

        printFixtureStdoutSummary({
          fixtureId: fx.id,
          selectedModel,
          structureAverage: average,
          scores,
          failures,
          styleWarnings,
          semanticNearMisses,
          regressionBundle,
          expected,
          latencyMs,
          modelOverrideUsed: evalCtx.modelOverrideUsed,
          tokens: usage,
        });
      },
      { name: `tankestrom_live/${fx.id}` },
    );
  }

  await experiment.flush();
  const summary = await experiment.summarize({ summarizeScores: true });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
