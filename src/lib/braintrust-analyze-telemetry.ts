/** Minste felles form for portal-items (unngår sirkulær import fra route). */
export type BraintrustPortalItem =
  | {
      kind: "event";
      proposalId: string;
      event: {
        title?: string;
        date?: string;
        start?: string | null;
        end?: string | null;
        metadata?: Record<string, unknown>;
      };
    }
  | {
      kind: "task";
      proposalId: string;
      task: { title?: string; date?: string };
    };

/** Max tegn for rå modell-JSON i Braintrust metadata. */
export const BT_TRUNC_RAW_COMPLETION = 12_000;
/** Max tegn for serialisert bundle-snapshot. */
export const BT_TRUNC_BUNDLE_SNAPSHOT = 16_000;
/** Max tegn for reiseblob (kan inneholde navn — hold kort). */
export const BT_TRUNC_TRAVEL_BLOB = 2_000;

export function truncateForBraintrust(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

export function safeFileNameForLog(name: string | null | undefined): string | null {
  if (name == null || typeof name !== "string") return null;
  const t = name.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!t) return null;
  if (t.length > 200) return `${t.slice(0, 200)}…`;
  return t;
}

export type PortalBundleTelemetry = {
  sourceType: string;
  model?: string | null;
  tier?: string | null;
  itemCount: number;
  eventCount: number;
  taskCount: number;
  parentCount: number;
  childCount: number;
  embeddedScheduleCount: number;
  stableKeys: string[];
  hasUpdateIntent: boolean;
  /** Korte titler for cup/arrangement-innsikt (truncated). */
  eventTitleSamples: string[];
};

export function summarizePortalProposalItemsForBraintrust(
  items: BraintrustPortalItem[],
): PortalBundleTelemetry {
  let eventCount = 0;
  let taskCount = 0;
  let parentCount = 0;
  let childCount = 0;
  let embeddedScheduleCount = 0;
  const stableKeys: string[] = [];
  let hasUpdateIntent = false;
  const eventTitleSamples: string[] = [];

  for (const it of items) {
    if (it.kind === "event") {
      eventCount++;
      const m = it.event.metadata;
      if (m?.isArrangementParent) parentCount++;
      if (m?.isArrangementChild) childCount++;
      const sk = m?.arrangementStableKey;
      if (typeof sk === "string" && sk) stableKeys.push(sk);
      if (m?.updateIntent && typeof m.updateIntent === "object") hasUpdateIntent = true;
      const emb = m?.embeddedSchedule;
      if (Array.isArray(emb)) embeddedScheduleCount += emb.length;
      if (eventTitleSamples.length < 8) {
        const title = typeof it.event.title === "string" ? it.event.title : "";
        eventTitleSamples.push(truncateForBraintrust(title, 120));
      }
    } else {
      taskCount++;
    }
  }

  return {
    sourceType: "",
    itemCount: items.length,
    eventCount,
    taskCount,
    parentCount,
    childCount,
    embeddedScheduleCount,
    stableKeys: [...new Set(stableKeys)].slice(0, 40),
    hasUpdateIntent,
    eventTitleSamples,
  };
}

export function mergeTelemetrySourceType(
  t: PortalBundleTelemetry,
  sourceType: string,
): PortalBundleTelemetry {
  return { ...t, sourceType };
}

export function portalBundleJsonSnapshot(items: BraintrustPortalItem[], maxChars: number): string {
  try {
    const slim = items.map((it) => {
      if (it.kind === "event") {
        return {
          kind: "event",
          proposalId: it.proposalId,
          title: truncateForBraintrust(it.event.title ?? "", 200),
          date: it.event.date,
          start: it.event.start,
          end: it.event.end,
          metadata: {
            arrangementStableKey: it.event.metadata?.arrangementStableKey ?? null,
            isArrangementParent: it.event.metadata?.isArrangementParent ?? false,
            isArrangementChild: it.event.metadata?.isArrangementChild ?? false,
            parentArrangementStableKey: it.event.metadata?.parentArrangementStableKey ?? null,
            embeddedSchedulePointCount: it.event.metadata?.embeddedSchedulePointCount ?? null,
            updateIntent: it.event.metadata?.updateIntent ?? null,
            importCategory: it.event.metadata?.importCategory ?? null,
          },
        };
      }
      return {
        kind: "task",
        proposalId: it.proposalId,
        title: truncateForBraintrust(it.task.title ?? "", 200),
        date: it.task.date,
      };
    });
    return truncateForBraintrust(JSON.stringify(slim), maxChars);
  } catch {
    return "[bundle_snapshot_error]";
  }
}
