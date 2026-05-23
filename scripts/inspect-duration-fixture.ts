/**
 * Inspiser varighet/sluttid for en tekstfixture (regresjon + cup-timing + valgfritt live LLM).
 * Usage: npx tsx --tsconfig tsconfig.json scripts/inspect-duration-fixture.ts [fixtureRelPath]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "@/app/api/analyze/route";
import { buildCupWeekendDayBlob } from "@/lib/cup-day-source-blob";
import { resolveCupDayTiming } from "@/lib/cup-resolve-day-timing";
import { isConditionalTournamentTextForDay } from "@/lib/cup-timing-context";
import type { CupWeekendDayKey } from "@/lib/cup-day-source-blob";
import { runTankestromFixture } from "@/lib/tankestrom-regression-fixture-runner";
import { toPortalBundle } from "@/lib/portal-bundle";
import { portalBundleToRegressionBundle } from "@/evals/portal-bundle-to-regression";
import { analyzeTextWithRouting } from "@/lib/ai/analyze-image";
import type { DayScheduleEntry } from "@/lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const fixtureRel =
  process.argv[2] ?? "fixtures/tankestrom/hostcup_duration_endtime_rich.txt";
const fixturePath = resolve(repoRoot, fixtureRel);
const outDir = resolve(repoRoot, "fixtures/tankestrom/debug");
const outBase = fixtureRel.replace(/[\\/]/g, "_").replace(/\.txt$/, "");

function extractHhmmFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : null;
}

function summarizePortalItems(portalBundle: Record<string, unknown>) {
  const items = (portalBundle.items ?? []) as Array<{
    kind: string;
    event?: {
      title?: string;
      start?: string | null;
      end?: string | null;
      metadata?: Record<string, unknown>;
    };
    task?: { title?: string; date?: string; dueTime?: string | null };
  }>;
  return items.map((it) => {
    if (it.kind === "task" && it.task) {
      return {
        kind: "task",
        title: it.task.title,
        date: it.task.date,
        dueTime: it.task.dueTime,
      };
    }
    if (it.kind === "event" && it.event) {
      const emb = it.event.metadata?.embeddedSchedule as
        | Array<{
            title?: string;
            start?: string | null;
            end?: string | null;
            startTime?: string | null;
            timePrecision?: string;
            isConditional?: boolean;
            dayContent?: { highlights?: string[] };
          }>
        | undefined;
      if (emb?.length) {
        return {
          kind: "event",
          title: it.event.title,
          embeddedSchedule: emb.map((s) => ({
            title: s.title,
            start: extractHhmmFromIso(s.start ?? s.startTime ?? null),
            end: extractHhmmFromIso(s.end ?? null),
            timePrecision: s.timePrecision,
            isConditional: s.isConditional,
            highlights: s.dayContent?.highlights ?? [],
          })),
        };
      }
      const meta = it.event.metadata ?? {};
      return {
        kind: "event",
        title: it.event.title,
        start: extractHhmmFromIso(it.event.start),
        end: extractHhmmFromIso(it.event.end),
        timePrecision: meta.timePrecision,
        endTimeSource: meta.endTimeSource,
        durationMinutes: meta.durationMinutes,
        postEventBufferMinutes: meta.postEventBufferMinutes,
        timeComputation: meta.timeComputation,
        highlights: (meta.dayContent as { highlights?: string[] } | undefined)?.highlights,
      };
    }
    return { kind: it.kind };
  });
}

async function main() {
  const text = readFileSync(fixturePath, "utf8");
  const regression = runTankestromFixture(fixturePath, { category: "cup" });

  const cupTimingByDay: Record<string, ReturnType<typeof resolveCupDayTiming>> = {};
  for (const child of regression.children) {
    const day: DayScheduleEntry = {
      dayLabel: child.day,
      date: child.date,
      time: child.start,
      details: null,
      highlights: child.highlights,
      rememberItems: child.bringItems,
      deadlines: [],
      notes: child.notes ? child.notes.split("\n") : [],
    };
    const dayKey = child.day as CupWeekendDayKey;
    const sourceBlob = buildCupWeekendDayBlob(text, dayKey);
    cupTimingByDay[child.day] = resolveCupDayTiming({
      day,
      detailsForEvent: null,
      highlightsForEventFinal: child.highlights,
      notesOnlyForEvent: day.notes,
      rememberForEvent: child.bringItems,
      deadlinesForEvent: [],
      conditionalDay: isConditionalTournamentTextForDay(sourceBlob, child.day),
      supplementalTimeContextBlob: sourceBlob,
      fullCorpus: text,
    });
  }

  const report: Record<string, unknown> = {
    fixture: fixtureRel,
    capturedAt: new Date().toISOString(),
    regressionHarness: regression,
    resolveCupDayTiming: cupTimingByDay,
  };

  if (process.env.OPENAI_API_KEY?.trim()) {
    try {
      const { result, modelTrace } = await analyzeTextWithRouting(text, {
        documentKind: "text",
        sourceRoute: "text",
        analysisResponseMode: "portal",
      });
      const portalBundle = await toPortalBundle(
        { ...result, analysisModelTrace: modelTrace },
        "text",
        "text",
        true,
        { knownPersons: [] },
      );
      report.liveAnalysis = {
        model: modelTrace.finalModel ?? modelTrace.initialModel,
        scheduleByDay: result.scheduleByDay,
        portalSummary: summarizePortalItems(portalBundle),
        evidenceReport: portalBundle.evidenceReport,
        regressionFromPortal: portalBundleToRegressionBundle(portalBundle),
      };
      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        resolve(outDir, `${outBase}_live_portal.json`),
        JSON.stringify(portalBundle, null, 2),
        "utf8",
      );
    } catch (err) {
      report.liveAnalysisError = err instanceof Error ? err.message : String(err);
    }
  } else {
    report.liveAnalysisSkipped = "OPENAI_API_KEY not set";
  }

  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `${outBase}_inspect.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.error(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
