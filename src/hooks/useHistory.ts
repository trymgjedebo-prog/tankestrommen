"use client";

import { useState, useEffect, useCallback } from "react";
import type { ConfirmedEvent } from "@/lib/types";

const STORAGE_KEY = "tankestrommen-history";

function loadFromStorage(): ConfirmedEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((e) => {
      const row = e as Record<string, unknown>;
      const sourceHint =
        row.sourceHint && typeof row.sourceHint === "object"
          ? ({ ...(row.sourceHint as Record<string, unknown>) } as Record<
              string,
              unknown
            >)
          : null;

      if (
        sourceHint &&
        typeof sourceHint.fileUrl === "string" &&
        sourceHint.fileUrl.startsWith("blob:")
      ) {
        delete sourceHint.fileUrl;
      }

      return {
        ...row,
        ...(sourceHint ? { sourceHint } : {}),
        scheduleByDay: Array.isArray(row.scheduleByDay)
          ? row.scheduleByDay
          : [],
      };
    }) as ConfirmedEvent[];
  } catch {
    return [];
  }
}

function saveToStorage(history: ConfirmedEvent[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    /* quota exceeded or unavailable — silently ignore */
  }
}

export function useHistory() {
  const [history, setHistory] = useState<ConfirmedEvent[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHistory(loadFromStorage());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveToStorage(history);
  }, [history, hydrated]);

  const add = useCallback((event: ConfirmedEvent) => {
    setHistory((prev) => [event, ...prev]);
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
  }, []);

  return { history, add, clear, hydrated };
}
