/**
 * Produksjonsnær regresjon (toPortalBundle): skole-/eksamensuke der dagen er gitt som
 * ukedag + dag/måned UTEN fullt år skal få riktig år via ukedag-matching.
 *
 * Bug: «mandag 15. juni» fikk 2025-06-15 (søndag) fordi år-utledningen tok første år-kandidat
 * («2025» fra skoleår-spennet «2025/2026»). Hovedfiks: velg året der 15. juni faktisk er mandag = 2026.
 *
 * Kontroll: fullt daterte datoer («15. juni 2026») skal være uendret.
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

function day(p: Partial<DayScheduleEntry> & Pick<DayScheduleEntry, "dayLabel">): DayScheduleEntry {
  return {
    dayLabel: p.dayLabel,
    date: p.date ?? null,
    time: p.time ?? null,
    details: p.details ?? null,
    highlights: p.highlights ?? [],
    rememberItems: p.rememberItems ?? [],
    deadlines: p.deadlines ?? [],
    notes: p.notes ?? [],
  };
}

/** Samle ALLE ISO-datoer (YYYY-MM-DD) som forekommer hvor som helst i bundle-items. */
function collectDates(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== "object") return;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v === "string") {
      const m = /(\d{4}-\d{2}-\d{2})/.exec(v);
      if (m) out.add(m[1]!);
    } else if (typeof v === "object") {
      collectDates(v, out);
    }
  }
}

function schoolWeekResult(monDate: string, tueDate: string, description: string): AIAnalysisResult {
  return {
    title: "Eksamensplan uke 25",
    schedule: [],
    scheduleByDay: [
      day({ dayLabel: "mandag", date: monDate, highlights: ["09:00 Skriftlig eksamen"] }),
      day({ dayLabel: "tirsdag", date: tueDate, highlights: ["08:30 Bokinnlevering"] }),
    ],
    location: "Auditoriet",
    description,
    category: "school_week" as AIAnalysisResult["category"],
    targetGroup: "2STA",
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.9,
    extractedText: { raw: description, language: "no", confidence: 1 },
  };
}

async function bundleDates(result: AIAnalysisResult): Promise<Set<string>> {
  const bundle = (await toPortalBundle(result, "text", undefined, false, {
    knownPersons: [],
  })) as { items: unknown[] };
  const out = new Set<string>();
  for (const i of bundle.items) collectDates(i, out);
  return out;
}

describe("Skole-/eksamensuke: riktig år fra ukedag (toPortalBundle)", () => {
  it("«mandag 15. juni» + skoleår-spenn «2025/2026» → 2026-06-15 (mandag), ikke 2025-06-15 (søndag)", async () => {
    const dates = await bundleDates(
      schoolWeekResult(
        "15. juni",
        "16. juni",
        "Eksamensplan for skoleåret 2025/2026. Mandag 15. juni skriftlig eksamen, tirsdag 16. juni bokinnlevering.",
      ),
    );
    expect(dates.has("2026-06-15")).toBe(true);
    expect(dates.has("2025-06-15")).toBe(false);
  });

  it("kontroll: fullt datert «15. juni 2026» → uendret 2026-06-15", async () => {
    const dates = await bundleDates(
      schoolWeekResult(
        "15. juni 2026",
        "16. juni 2026",
        "Eksamensplan. Mandag 15. juni 2026 skriftlig eksamen, tirsdag 16. juni 2026 bokinnlevering.",
      ),
    );
    expect(dates.has("2026-06-15")).toBe(true);
    expect(dates.has("2025-06-15")).toBe(false);
  });
});
