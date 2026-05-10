import type { RegressionPortalBundle } from "@/lib/tankestrom-regression-fixture-runner";
import { stripGeneratedCupNoise } from "@/lib/cup-day-content";
import type { DayKey, TimePrecision } from "@/evals/tankestrom-expected";

function dayKeyFromTitle(title: string): DayKey | null {
  const t = title.toLowerCase();
  if (/\blørdag\b|saturday\b/.test(t)) return "lørdag";
  if (/\bsøndag\b|sunday\b/.test(t)) return "søndag";
  if (/\bfredag\b|friday\b/.test(t)) return "fredag";
  return null;
}

/** Kalenderdato → helgedag (fredag–søndag); brukes når tittel mangler ukedag. */
function dayKeyFromIsoWeekend(iso: string): DayKey | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dow = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)).getUTCDay();
  if (dow === 5) return "fredag";
  if (dow === 6) return "lørdag";
  if (dow === 0) return "søndag";
  return null;
}

function joinNotes(parts: (string | undefined)[]): string | null {
  const raw = parts.flatMap((p) => (p ? p.split(/\r?\n/) : [])).map((s) => s.trim()).filter(Boolean);
  const lines = raw
    .map((s) => stripGeneratedCupNoise(s).trim())
    .filter(Boolean)
    .filter(
      (s) =>
        !/^(høydepunkter|hoydepunkter|notater|husk|dagens\s+innhold|husk\s*\/\s*ta\s+med)\s*:/i.test(s),
    );
  if (!lines.length) return null;
  return [...new Set(lines)].join("\n");
}

type BundleItem = {
  kind: string;
  event?: {
    title?: string;
    date?: string;
    notes?: string;
    start?: string | null;
    metadata?: {
      isArrangementParent?: boolean;
      embeddedSchedule?: EmbeddedSeg[];
      arrangementCoreTitle?: string;
      isTentative?: boolean;
      timePrecision?: TimePrecision;
      dayContent?: {
        highlights?: string[];
        bringItems?: string[];
        logisticsNotes?: string[];
        generalNotes?: string[];
        uncertaintyNotes?: string[];
      };
    };
  };
  task?: {
    title?: string;
    date?: string;
    dueTime?: string;
  };
};

type EmbeddedSeg = {
  date: string;
  title: string;
  start?: string | null;
  startTime?: string | null;
  timePrecision?: TimePrecision;
  isConditional?: boolean;
  notes?: string;
  dayContent?: {
    highlights?: string[];
    bringItems?: string[];
    logisticsNotes?: string[];
    generalNotes?: string[];
    uncertaintyNotes?: string[];
  };
};

function extractTasksFromItems(items: BundleItem[]) {
  return items
    .filter((i) => i.kind === "task" && i.task)
    .map((i) => ({
      title: i.task!.title ?? "",
      date: i.task!.date?.trim() ? i.task!.date : null,
      dueTime: i.task!.dueTime?.trim() ? i.task!.dueTime : null,
    }));
}

/** «Dagens innhold» / «Husk / ta med» fra portal-buildStructuredNotes (ikke-cup). */
export function parseStructuredPortalEventNotes(notes: string | undefined): {
  highlights: string[];
  bringItems: string[];
} {
  if (!notes?.trim()) return { highlights: [], bringItems: [] };
  let section: "dagens" | "husk" | null = null;
  const highlights: string[] = [];
  const bringItems: string[] = [];
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^Dagens innhold$/i.test(line)) {
      section = "dagens";
      continue;
    }
    if (/^Husk\s*\/\s*ta\s+med$/i.test(line)) {
      section = "husk";
      continue;
    }
    if (/^(Frister|Notater)$/i.test(line)) {
      section = null;
      continue;
    }
    const bullet = /^[-•*]\s+(.+)$/.exec(line);
    if (bullet && section === "dagens") highlights.push(bullet[1]!.trim());
    if (bullet && section === "husk") bringItems.push(bullet[1]!.trim());
  }
  return { highlights, bringItems };
}

function extractHhmmFromPortalStart(start: string | null | undefined): string | null {
  if (start == null || start === "") return null;
  const iso = /T(\d{1,2}):(\d{2})(?::\d{2})?/.exec(start);
  if (iso) return `${String(Number(iso[1])).padStart(2, "0")}:${iso[2]}`;
  const plain = /^(\d{1,2}):(\d{2})$/.exec(start);
  if (plain) return `${String(Number(plain[1])).padStart(2, "0")}:${plain[2]}`;
  return null;
}

function stripTrailingWeekdayFromTitle(title: string): string {
  return title.replace(/\s*[–-]\s*(fredag|lørdag|søndag|friday|saturday|sunday)\s*$/i, "").trim();
}

function regressionChildrenFromEmbedded(emb: EmbeddedSeg[]): RegressionPortalBundle["children"] {
  const children = emb
    .map((seg) => {
      const day = dayKeyFromTitle(seg.title);
      if (!day) return null;
      const dc = seg.dayContent;
      const highlights = [...(dc?.highlights ?? [])];
      const notesFlat = joinNotes([
        seg.notes,
        ...(dc?.logisticsNotes ?? []),
        ...(dc?.generalNotes ?? []),
        ...(dc?.uncertaintyNotes ?? []),
      ]);
      const timePrecision: TimePrecision = seg.timePrecision ?? "date_only";
      const tentative = Boolean(seg.isConditional);
      const start = seg.start ?? seg.startTime ?? null;
      return {
        day,
        title: seg.title,
        date: seg.date ?? null,
        start,
        timePrecision,
        tentative,
        highlights,
        bringItems: [...(dc?.bringItems ?? [])],
        notes: notesFlat,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const dayOrder: DayKey[] = ["fredag", "lørdag", "søndag"];
  children.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));
  return children;
}

/**
 * Enkelt- eller flere topnivå-hendelser uten embeddedSchedule (typisk lagmelding / skole per dag).
 */
function regressionBundleFromStandaloneEvents(
  standalone: BundleItem[],
  items: BundleItem[],
): RegressionPortalBundle {
  const mapped: RegressionPortalBundle["children"] = [];

  for (const it of standalone) {
    const e = it.event;
    if (!e?.date) continue;
    const title = (e.title ?? "").trim();
    const day = dayKeyFromTitle(title) ?? dayKeyFromIsoWeekend(e.date);
    if (!day) continue;

    const dc = e.metadata?.dayContent;
    let highlights = [...(dc?.highlights ?? [])];
    let bringItems = [...(dc?.bringItems ?? [])];
    let notesFlat = joinNotes([
      ...(dc?.logisticsNotes ?? []),
      ...(dc?.generalNotes ?? []),
      ...(dc?.uncertaintyNotes ?? []),
    ]);

    if (!dc) {
      const parsed = parseStructuredPortalEventNotes(e.notes);
      highlights = parsed.highlights;
      bringItems = parsed.bringItems;
    } else if (highlights.length === 0 || bringItems.length === 0) {
      const parsed = parseStructuredPortalEventNotes(e.notes);
      if (highlights.length === 0) highlights = parsed.highlights;
      if (bringItems.length === 0) bringItems = parsed.bringItems;
    }
    if (!notesFlat && e.notes?.trim()) {
      notesFlat = e.notes.trim();
    }

    const timePrecision: TimePrecision = e.metadata?.timePrecision ?? "date_only";
    const tentative = Boolean(e.metadata?.isTentative);
    const start = extractHhmmFromPortalStart(e.start);

    mapped.push({
      day,
      title,
      date: e.date,
      start,
      timePrecision,
      tentative,
      highlights,
      bringItems,
      notes: notesFlat,
    });
  }

  const dayOrder: DayKey[] = ["fredag", "lørdag", "søndag"];
  mapped.sort((a, b) => {
    const da = a.date ?? "";
    const db = b.date ?? "";
    if (da !== db) return da.localeCompare(db);
    return dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
  });

  const coreTitles = mapped
    .map((c) => stripTrailingWeekdayFromTitle(c.title))
    .filter(Boolean);
  const parentTitle =
    standalone[0]?.event?.metadata?.arrangementCoreTitle?.trim() ||
    (coreTitles.length > 0 && coreTitles.every((t) => t === coreTitles[0]) ? coreTitles[0]! : "") ||
    (mapped[0] ? stripTrailingWeekdayFromTitle(mapped[0]!.title) : "");

  return {
    parentTitle,
    children: mapped,
    tasks: extractTasksFromItems(items),
  };
}

/**
 * Mapper portal-import bundle (items) til RegressionPortalBundle for eval-scorere.
 * Støtter arrangement med embeddedSchedule og vanlige enkelt-/flerdags-hendelser uten embedded.
 */
export function portalBundleToRegressionBundle(bundle: Record<string, unknown>): RegressionPortalBundle {
  const items = bundle.items as BundleItem[] | undefined;
  if (!Array.isArray(items)) {
    return { parentTitle: "", children: [], tasks: [] };
  }

  const tasks = extractTasksFromItems(items);
  const events = items.filter((i) => i.kind === "event" && i.event);

  const embeddedParent = events.find((e) => e.event?.metadata?.embeddedSchedule?.length);
  const emb = embeddedParent?.event?.metadata?.embeddedSchedule;
  if (embeddedParent?.event && emb?.length) {
    const parentTitle =
      embeddedParent.event.metadata?.arrangementCoreTitle?.trim() ||
      embeddedParent.event.title?.trim() ||
      "";
    return {
      parentTitle,
      children: regressionChildrenFromEmbedded(emb),
      tasks,
    };
  }

  const standalone = events.filter((e) => {
    const meta = e.event?.metadata;
    const schedule = meta?.embeddedSchedule;
    if (Array.isArray(schedule) && schedule.length > 0) return false;
    if (meta?.isArrangementParent && (!schedule || schedule.length === 0)) return false;
    return true;
  });

  if (standalone.length > 0) {
    return regressionBundleFromStandaloneEvents(standalone, items);
  }

  return { parentTitle: "", children: [], tasks };
}
