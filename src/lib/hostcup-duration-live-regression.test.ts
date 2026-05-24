import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { buildAnalysisCorpus, buildAnalysisEvidenceReport } from "@/lib/analysis-evidence";
import { hostcupLiveDevToolsInput } from "@/lib/hostcup-live-devtools-fixture";
import { toPortalBundle } from "@/lib/portal-bundle";

type EmbSeg = {
  end?: string | null;
  endTimeSource?: string;
  afterBufferMinutes?: number | null;
  postEventBufferMinutes?: number | null;
};

function extractHhmm(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (m) return `${m[1]}:${m[2]}`;
  return /^\d{2}:\d{2}$/.test(iso) ? iso : null;
}

function embeddedSchedule(bundle: Record<string, unknown>): EmbSeg[] {
  const items = bundle.items as Array<{
    event?: { metadata?: { embeddedSchedule?: EmbSeg[]; cupProposalDebug?: { childEndTimeSources?: string[] } } };
  }>;
  const parent = items.find((i) => i.event?.metadata?.embeddedSchedule?.length);
  return parent?.event?.metadata?.embeddedSchedule ?? [];
}

function childEndTimeSources(bundle: Record<string, unknown>): string[] {
  const items = bundle.items as Array<{
    event?: { metadata?: { cupProposalDebug?: { childEndTimeSources?: string[] } } };
  }>;
  return (
    items
      .map((i) => i.event?.metadata?.cupProposalDebug?.childEndTimeSources)
      .find((s): s is string[] => Array.isArray(s)) ?? []
  );
}

describe("Høstcup live DevTools contract (2026-05-24)", () => {
  const fixturePath = resolve(
    "fixtures/tankestrom/live/hostcup_duration_live_response_2026_05_24.json",
  );

  it("fixture metadata documents observed live bug shape", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      liveObservedBug: {
        childEndTimeSources: string[];
        durationEndFactsFredag: {
          afterBufferMinutes: null;
          inferredEndTime: string;
          endTimeSource: string;
        };
      };
    };
    expect(fixture.liveObservedBug.childEndTimeSources[0]).toBe("computed_from_duration");
    expect(fixture.liveObservedBug.childEndTimeSources[1]).toBe(
      "computed_from_duration_and_aftertime",
    );
    expect(fixture.liveObservedBug.durationEndFactsFredag.afterBufferMinutes).toBeNull();
    expect(fixture.liveObservedBug.durationEndFactsFredag.inferredEndTime).toBe("18:15");
    expect(fixture.liveObservedBug.durationEndFactsFredag.endTimeSource).toBe(
      "computed_from_duration",
    );
  });

  it("portal + evidence: fredag index 0 og lørdag index 1 — per felt, ikke «finnes et sted»", async () => {
    const input = hostcupLiveDevToolsInput();
    const bundle = await toPortalBundle(input, "text", "text", true, { knownPersons: [] });
    const emb = embeddedSchedule(bundle);
    expect(emb).toHaveLength(3);

    const friEmb = emb[0]!;
    const lorEmb = emb[1]!;
    const friEnd = extractHhmm(friEmb.end ?? null);
    const lorEnd = extractHhmm(lorEmb.end ?? null);
    const friBuffer = friEmb.afterBufferMinutes ?? friEmb.postEventBufferMinutes ?? null;
    const lorBuffer = lorEmb.afterBufferMinutes ?? lorEmb.postEventBufferMinutes ?? null;
    const sources = childEndTimeSources(bundle);

    expect(friEnd).toBe("18:45");
    expect(friBuffer).toBe(30);
    expect(friEmb.endTimeSource).toBe("computed_from_duration_and_aftertime");
    expect(sources[0]).toBe("computed_from_duration_and_aftertime");

    expect(lorEnd).toBe("15:55");
    expect(lorBuffer).toBe(30);
    expect(lorEmb.endTimeSource).toBe("computed_from_duration_and_aftertime");
    expect(sources[1]).toBe("computed_from_duration_and_aftertime");

    const report = buildAnalysisEvidenceReport(buildAnalysisCorpus(input), input);
    const friFact = report.durationEndFacts?.[0];
    const lorFact = report.durationEndFacts?.[1];

    expect(friFact?.dayLabel).toBe("fredag");
    expect(friFact?.afterBufferMinutes).toBe(30);
    expect(friFact?.inferredEndTime).toBe("18:45");
    expect(friFact?.endTimeSource).toBe("computed_from_duration_and_aftertime");

    expect(lorFact?.dayLabel).toBe("lørdag");
    expect(lorFact?.afterBufferMinutes).toBe(30);
    expect(lorFact?.inferredEndTime).toBe("15:55");
    expect(lorFact?.endTimeSource).toBe("computed_from_duration_and_aftertime");

    const evidenceFromBundle = (bundle.evidenceReport as typeof report).durationEndFacts;
    expect(evidenceFromBundle?.[0]?.afterBufferMinutes).toBe(30);
    expect(evidenceFromBundle?.[0]?.inferredEndTime).toBe("18:45");
    expect(evidenceFromBundle?.[0]?.endTimeSource).toBe("computed_from_duration_and_aftertime");

    // Rapportér eksakt output for fredag/lørdag (brukes i CI-logg ved feil)
    const summary = {
      fredag: {
        embeddedSchedule: {
          end: friEnd,
          afterBufferMinutes: friBuffer,
          endTimeSource: friEmb.endTimeSource,
        },
        childEndTimeSources: sources[0],
        durationEndFacts: {
          afterBufferMinutes: friFact?.afterBufferMinutes,
          inferredEndTime: friFact?.inferredEndTime,
          endTimeSource: friFact?.endTimeSource,
        },
      },
      lørdag: {
        embeddedSchedule: {
          end: lorEnd,
          afterBufferMinutes: lorBuffer,
          endTimeSource: lorEmb.endTimeSource,
        },
        childEndTimeSources: sources[1],
        durationEndFacts: {
          afterBufferMinutes: lorFact?.afterBufferMinutes,
          inferredEndTime: lorFact?.inferredEndTime,
          endTimeSource: lorFact?.endTimeSource,
        },
      },
    };
    expect(summary).toEqual({
      fredag: {
        embeddedSchedule: {
          end: "18:45",
          afterBufferMinutes: 30,
          endTimeSource: "computed_from_duration_and_aftertime",
        },
        childEndTimeSources: "computed_from_duration_and_aftertime",
        durationEndFacts: {
          afterBufferMinutes: 30,
          inferredEndTime: "18:45",
          endTimeSource: "computed_from_duration_and_aftertime",
        },
      },
      lørdag: {
        embeddedSchedule: {
          end: "15:55",
          afterBufferMinutes: 30,
          endTimeSource: "computed_from_duration_and_aftertime",
        },
        childEndTimeSources: "computed_from_duration_and_aftertime",
        durationEndFacts: {
          afterBufferMinutes: 30,
          inferredEndTime: "15:55",
          endTimeSource: "computed_from_duration_and_aftertime",
        },
      },
    });
  });
});
