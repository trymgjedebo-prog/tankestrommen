/**
 * Slår sammen dupliserte fly-hendelser (f.eks. modell laget både «avreise» og «ankomst»)
 * når metadata viser samme etappe.
 */

import { buildCalendarFlightTitle } from "./travel-document-infer";

export type PortalFlightEventLike = {
  kind: "event";
  event: {
    date: string;
    title: string;
    start: string | null;
    end: string | null;
    metadata?: {
      travel?: {
        type: string;
        origin: string;
        originCity?: string | null;
        destination: string;
        destinationCity?: string | null;
        flightNumber: string | null;
        passengerName: string | null;
        departureTime?: string | null;
        arrivalTime?: string | null;
      };
    };
  };
};

function hhmmToMin(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (!t) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})/.exec(t);
  if (iso) return Number(iso[2]) * 60 + Number(iso[3]);
  const hm = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  return null;
}

function minToHHMM(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function flightMergeKey(ev: PortalFlightEventLike): string | null {
  const t = ev.event.metadata?.travel;
  if (!t || t.type !== "flight") return null;
  return [
    ev.event.date,
    t.origin,
    t.destination,
    t.passengerName ?? "",
    t.flightNumber ?? "",
  ].join("|");
}

function mergeFlightPair(keep: PortalFlightEventLike, drop: PortalFlightEventLike): void {
  const tk = keep.event.metadata?.travel;
  const td = drop.event.metadata?.travel;

  let depMin: number | null = null;
  let arrMax: number | null = null;

  for (const t of [tk?.departureTime, td?.departureTime]) {
    const m = hhmmToMin(t ?? null);
    if (m !== null) depMin = depMin === null ? m : Math.min(depMin, m);
  }
  for (const t of [tk?.arrivalTime, td?.arrivalTime]) {
    const m = hhmmToMin(t ?? null);
    if (m !== null) arrMax = arrMax === null ? m : Math.max(arrMax, m);
  }

  if (depMin === null) {
    for (const t of [keep.event.start, drop.event.start]) {
      const m = hhmmToMin(t ?? null);
      if (m !== null) depMin = depMin === null ? m : Math.min(depMin, m);
    }
  }
  if (arrMax === null) {
    for (const t of [keep.event.end, drop.event.end]) {
      const m = hhmmToMin(t ?? null);
      if (m !== null) arrMax = arrMax === null ? m : Math.max(arrMax, m);
    }
  }
  if (arrMax === null || (depMin !== null && arrMax <= depMin)) {
    for (const t of [keep.event.start, drop.event.start]) {
      const m = hhmmToMin(t ?? null);
      if (m !== null && depMin !== null && m > depMin) {
        arrMax = arrMax === null ? m : Math.max(arrMax, m);
      }
    }
  }

  if (depMin === null && arrMax === null) return;

  const depS = depMin !== null ? minToHHMM(depMin) : keep.event.start ?? drop.event.start;
  const arrS = arrMax !== null ? minToHHMM(arrMax) : keep.event.end ?? drop.event.end;
  if (depS && arrS && depMin !== null && arrMax !== null && depMin < arrMax) {
    keep.event.start = depS;
    keep.event.end = arrS;
  } else if (depS) {
    keep.event.start = keep.event.start ?? depS;
    keep.event.end = keep.event.end ?? arrS ?? keep.event.end;
  }

  if (tk) {
    tk.departureTime = tk.departureTime ?? td?.departureTime ?? (depS ?? null);
    tk.arrivalTime = tk.arrivalTime ?? td?.arrivalTime ?? (arrS ?? null);
    tk.originCity = tk.originCity ?? td?.originCity ?? null;
    tk.destinationCity = tk.destinationCity ?? td?.destinationCity ?? null;
    keep.event.title = buildCalendarFlightTitle(
      tk.originCity ?? null,
      tk.destinationCity ?? null,
      tk.origin,
      tk.destination,
    );
  }
}

/**
 * Én hendelse per flyetappe: fjern ekstra kandidat med samme dato/rute/passasjer/flightnr.
 */
export function dedupePortalFlightDepartureArrivalEvents<T extends { kind: string }>(
  items: T[],
): T[] {
  const keyToIndices = new Map<string, number[]>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || it.kind !== "event") continue;
    const k = flightMergeKey(it as unknown as PortalFlightEventLike);
    if (!k) continue;
    if (!keyToIndices.has(k)) keyToIndices.set(k, []);
    keyToIndices.get(k)!.push(i);
  }

  const drop = new Set<number>();
  for (const idxs of keyToIndices.values()) {
    if (idxs.length < 2) continue;
    const sorted = [...idxs].sort((a, b) => a - b);
    const keepIdx = sorted[0]!;
    for (let k = 1; k < sorted.length; k++) {
      const j = sorted[k]!;
      if (drop.has(keepIdx) || drop.has(j)) continue;
      mergeFlightPair(
        items[keepIdx] as unknown as PortalFlightEventLike,
        items[j] as unknown as PortalFlightEventLike,
      );
      drop.add(j);
    }
  }

  if (drop.size === 0) return items;
  return items.filter((_, i) => !drop.has(i)) as T[];
}
