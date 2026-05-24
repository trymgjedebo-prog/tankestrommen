/**
 * Capture portal bundle + evidence for live-like Høstcup input (buffer kun i fredag-notes).
 * Usage: npx tsx --tsconfig tsconfig.json scripts/capture-hostcup-live-fixture.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "@/app/api/analyze/route";
import { buildAnalysisCorpus, buildAnalysisEvidenceReport } from "@/lib/analysis-evidence";
import { hostcupLiveDevToolsInput } from "@/lib/hostcup-live-devtools-fixture";
import { toPortalBundle } from "@/lib/portal-bundle";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function extractHhmm(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : iso.match(/^\d{2}:\d{2}$/) ? iso : null;
}

async function main() {
  const input = hostcupLiveDevToolsInput();
  const bundle = await toPortalBundle(input, "text", "text", true, { knownPersons: [] });
  const parent = (bundle.items as Array<{ event?: { metadata?: Record<string, unknown> } }>).find(
    (i) => (i.event?.metadata?.embeddedSchedule as unknown[])?.length,
  );
  const emb = (parent?.event?.metadata?.embeddedSchedule ?? []) as Array<Record<string, unknown>>;
  const debug = parent?.event?.metadata?.cupProposalDebug as
    | { childEndTimeSources?: string[] }
    | undefined;
  const evidence = bundle.evidenceReport as ReturnType<typeof buildAnalysisEvidenceReport>;

  const fixture = {
    schemaVersion: 1,
    capturedAt: "2026-05-24T20:30:00.000Z",
    source:
      "reproduced via toPortalBundle(hostcupLiveDevToolsInput) — matches Foreldre-App DevTools live contract path",
    liveObservedBug: {
      childEndTimeSources: [
        "computed_from_duration",
        "computed_from_duration_and_aftertime",
        "missing_or_unreadable",
      ],
      durationEndFactsFredag: {
        afterBufferMinutes: null,
        inferredEndTime: "18:15",
        endTimeSource: "computed_from_duration",
      },
    },
    input: {
      title: input.title,
      scheduleByDay: input.scheduleByDay.map((d) => ({
        dayLabel: d.dayLabel,
        date: d.date,
        highlights: d.highlights,
        notes: d.notes,
      })),
      rawTextExcerpt: input.extractedText?.raw?.slice(0, 400),
    },
    contract: {
      embeddedSchedule: emb.map((s, i) => ({
        index: i,
        dayLabel: s.dayLabel ?? s.title,
        start: extractHhmm(s.start as string | null),
        end: extractHhmm(s.end as string | null),
        afterBufferMinutes: s.afterBufferMinutes ?? s.postEventBufferMinutes ?? null,
        endTimeSource: s.endTimeSource ?? null,
      })),
      childEndTimeSources: debug?.childEndTimeSources ?? [],
      durationEndFacts: (evidence.durationEndFacts ?? []).map((f) => ({
        dayLabel: f.dayLabel,
        activityDurationMinutes: f.activityDurationMinutes,
        breakMinutes: f.breakMinutes,
        afterBufferMinutes: f.afterBufferMinutes,
        inferredEndTime: f.inferredEndTime,
        endTimeSource: f.endTimeSource,
      })),
    },
  };

  const outDir = resolve(repoRoot, "fixtures/tankestrom/live");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "hostcup_duration_live_response_2026_05_24.json");
  writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log("Wrote", outPath);
  console.log("fredag embedded[0]:", JSON.stringify(fixture.contract.embeddedSchedule[0]));
  console.log("lørdag embedded[1]:", JSON.stringify(fixture.contract.embeddedSchedule[1]));
  console.log("fredag durationEndFacts:", JSON.stringify(fixture.contract.durationEndFacts[0]));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
