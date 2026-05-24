import { describe, expect, it } from "vitest";
import {
  buildCupStructuredDayContent,
  enrichCupStructuredContentWithResolvedTiming,
  formatCupEventNotesFlat,
  isNoiseFragment,
} from "./cup-day-content";
import { extractOrderedCupMatchTimesForDay } from "./cup-resolve-day-timing";

describe("buildCupStructuredDayContent (Høstcupen-regresjon)", () => {
  const base = {
    date: "2026-09-18",
    parentTitle: "Høstcupen",
    childTitle: "Høstcupen – fredag",
  };

  it("deduper bringItems: ekstra t-skjorte vs Gjerne ekstra t-skjorte", () => {
    const r = buildCupStructuredDayContent({
      ...base,
      details: null,
      highlights: [],
      notes: ["Husk: Gjerne ekstra t-skjorte", "Husk: ekstra t-skjorte"],
      rememberItems: [],
      deadlines: [],
    });
    const t = r.bringItems.filter((x) => x.includes("t-skjorte"));
    expect(t).toHaveLength(1);
    expect(t[0]).toBe("ekstra t-skjorte");
  });

  it("formatCupEventNotesFlat har ikke genererte seksjonstitler", () => {
    const r = buildCupStructuredDayContent({
      ...base,
      details:
        "Høydepunkter: Første kamp i Nadderud Arena; Møt ferdig skiftet 50 minutter før kampstart. Husk: Gjerne ekstra t-skjorte. Notater: Kampen varer 2 x 20 minutter.",
      highlights: [],
      notes: [],
      rememberItems: [],
      deadlines: [],
    });
    const flat = formatCupEventNotesFlat(r) ?? "";
    expect(flat).not.toMatch(/Høydepunkter\s*:/i);
    expect(flat).not.toMatch(/Notater\s*:/i);
  });

  it("09:15 bag/kjølebag-koordinering er ikke highlight", () => {
    const r = buildCupStructuredDayContent({
      ...base,
      date: "2026-09-19",
      childTitle: "Høstcupen – lørdag",
      details: null,
      highlights: [
        "09:15 Første kamp",
        "09:15 Ta gjerne med ekstra stor bag eller kjølebag og skriv det i kommentarfeltet",
        "14:40 Andre kamp i Nadderud Arena",
      ],
      notes: [],
      rememberItems: [],
      deadlines: [],
    });
    const bad = r.highlights.some((h) => /kjølebag|kommentarfelt/i.test(h));
    expect(bad).toBe(false);
    expect(r.highlights.some((h) => /14:40.*Andre kamp/i.test(h))).toBe(true);
    expect(r.parentTasks.some((p) => /kjølebag/i.test(p))).toBe(true);
  });

  it("14:40 Andre kamp kun én gang (semantisk dedupe)", () => {
    const r = buildCupStructuredDayContent({
      ...base,
      date: "2026-09-19",
      childTitle: "Høstcupen – lørdag",
      details: null,
      highlights: ["14:40 i Nadderud Arena; Andre kamp", "14:40 Andre kamp"],
      notes: [],
      rememberItems: [],
      deadlines: [],
    });
    expect(r.highlights.filter((h) => h.startsWith("14:40"))).toHaveLength(1);
  });

  it("søndag: mellom 10:00 og 12:00 blir ett timeWindow, ikke fire highlights", () => {
    const r = buildCupStructuredDayContent({
      ...base,
      date: "2026-09-20",
      childTitle: "Høstcupen – søndag",
      details: null,
      highlights: [],
      notes: [
        "A-sluttspill: første kamp mellom kl. 10:00 og 12:00 dersom vi går videre.",
        "10:00 og",
        "12:00 og",
        "Ved B-sluttspill trolig etter lunsj.",
      ],
      rememberItems: [],
      deadlines: [],
    });
    expect(r.timeWindowCandidates).toHaveLength(1);
    expect(r.timeWindowCandidates[0]!.earliestStart).toBe("10:00");
    expect(r.timeWindowCandidates[0]!.latestStart).toBe("12:00");
    const hhmmHighlights = r.highlights.filter((h) => /^\d{2}:\d{2}\s/.test(h));
    expect(hhmmHighlights.length).toBe(0);
  });

  it("fragmentfilter markerer støy (og, spist litt, liste-overtrekksklær)", () => {
    expect(isNoiseFragment("og")).toBe(true);
    expect(isNoiseFragment("spist litt")).toBe(true);
    expect(isNoiseFragment("- overtrekksklær")).toBe(true);
  });

  it("beriking: date_only + tentative fjerner falske kamptider fra betinget mellom-vindu", () => {
    const structured = buildCupStructuredDayContent({
      ...base,
      date: "2026-09-20",
      childTitle: "Høstcupen – søndag",
      details: null,
      highlights: [],
      notes: ["Ved A-sluttspill kan det bli søndagskamp mellom kl. 10:00 og 12:00."],
      rememberItems: [],
      deadlines: [],
    });
    const blob =
      "Ved A-sluttspill kan det bli søndagskamp mellom kl. 10:00 og 12:00.\nHusk: Gjerne ekstra t-skjorte.";
    const enriched = enrichCupStructuredContentWithResolvedTiming(structured, {
      date: "2026-09-20",
      parentTitleNorm: "hostcupen",
      childTitleNorm: "hostcupen sondag",
      sourceBlob: blob,
      attendanceTime: null,
      orderedMatchTimes: ["10:00", "12:00"],
      daySegmentStart: null,
      daySegmentEnd: null,
      timeWindow: null,
      timePrecision: "date_only",
      tentative: true,
    });
    expect(enriched.highlights.some((h) => /10:00|12:00/.test(h))).toBe(false);
  });

  it("beriking: vindu 10:00–12:00 gir én highlight med semantisk label og (foreløpig)", () => {
    const structured = buildCupStructuredDayContent({
      ...base,
      date: "2026-09-20",
      childTitle: "Høstcupen – søndag",
      details: null,
      highlights: [],
      notes: [
        "A-sluttspill: første kamp mellom kl. 10:00 og 12:00 dersom vi går videre.",
        "10:00 og",
        "12:00 og",
      ],
      rememberItems: [],
      deadlines: [],
    });
    const enriched = enrichCupStructuredContentWithResolvedTiming(structured, {
      date: "2026-09-20",
      parentTitleNorm: "hostcupen",
      childTitleNorm: "hostcupen sondag",
      sourceBlob:
        "A-sluttspill: første kamp mellom kl. 10:00 og 12:00 dersom vi går videre.\n10:00 og\n12:00 og",
      attendanceTime: null,
      orderedMatchTimes: ["10:00", "12:00"],
      daySegmentStart: null,
      daySegmentEnd: null,
      timeWindow: { earliestStart: "10:00", latestStart: "12:00" },
      timePrecision: "time_window",
      tentative: true,
    });
    expect(enriched.highlights).toContain("10:00–12:00 Første sluttspillkamp (foreløpig)");
    expect(enriched.highlights.some((h) => /^10:00\s/.test(h) && !h.includes("–"))).toBe(false);
    expect(enriched.highlights.some((h) => /^12:00\s/.test(h) && !h.includes("–"))).toBe(false);
  });

  it("beriking: én kamptid + note uten inline tid → highlight med klokkeslett + semantikk", () => {
    const structured = buildCupStructuredDayContent({
      ...base,
      details: "Første kamp i Nadderud Arena. Oppvarming som vanlig.",
      highlights: [],
      notes: [],
      rememberItems: [],
      deadlines: [],
    });
    const enriched = enrichCupStructuredContentWithResolvedTiming(structured, {
      date: "2026-09-18",
      parentTitleNorm: "hostcupen",
      childTitleNorm: "hostcupen fredag",
      sourceBlob: "Første kamp i Nadderud Arena. Oppvarming som vanlig.\n17:30",
      attendanceTime: null,
      orderedMatchTimes: ["17:30"],
      daySegmentStart: "17:30",
      daySegmentEnd: "18:10",
      timeWindow: null,
      timePrecision: "exact",
      tentative: false,
    });
    expect(enriched.highlights.some((h) => h === "17:30 Første kamp")).toBe(true);
  });

  it("Test A: fredag får oppmøte + første kamp fra starttid og offset, varighet blir note", () => {
    const structured = buildCupStructuredDayContent({
      ...base,
      details: null,
      highlights: [],
      notes: [
        "Møt ferdig skiftet 50 minutter før kampstart.",
        "Kampen varer 2 x 20 minutter med 5 minutter pause.",
      ],
      rememberItems: [],
      deadlines: [],
    });
    const enriched = enrichCupStructuredContentWithResolvedTiming(structured, {
      date: "2026-09-18",
      parentTitleNorm: "hostcupen",
      childTitleNorm: "hostcupen fredag",
      sourceBlob:
        "17:30-18:10\nMøt ferdig skiftet 50 minutter før kampstart.\nKampen varer 2 x 20 minutter med 5 minutter pause.",
      attendanceTime: "16:40",
      orderedMatchTimes: ["17:30"],
      daySegmentStart: "17:30",
      daySegmentEnd: "18:10",
      timeWindow: null,
      timePrecision: "exact",
      tentative: false,
    });
    expect(enriched.highlights).toContain("16:40 Oppmøte");
    expect(enriched.highlights).toContain("17:30 Første kamp");
    expect(enriched.highlights.some((h) => /2 x 20|pause/i.test(h))).toBe(false);
    expect(
      [...enriched.logisticsNotes, ...enriched.generalNotes, ...enriched.uncertaintyNotes].some((n) =>
        /2 x 20|pause/i.test(n),
      ),
    ).toBe(true);
  });

  it("Test B: flere kamper + oppmøte før hver kamp gir alle highlights uten duplikater", () => {
    const structured = buildCupStructuredDayContent({
      ...base,
      date: "2026-09-19",
      childTitle: "Høstcupen – lørdag",
      details: null,
      highlights: [],
      notes: ["Oppmøte 45 minutter før hver kamp."],
      rememberItems: [],
      deadlines: [],
    });
    const enriched = enrichCupStructuredContentWithResolvedTiming(structured, {
      date: "2026-09-19",
      parentTitleNorm: "hostcupen",
      childTitleNorm: "hostcupen lordag",
      sourceBlob: "09:15 første kamp. 14:40 andre kamp. Oppmøte 45 minutter før hver kamp.",
      attendanceTime: "08:30",
      orderedMatchTimes: ["09:15", "14:40"],
      daySegmentStart: "09:15",
      daySegmentEnd: null,
      timeWindow: null,
      timePrecision: "start_only",
      tentative: false,
    });
    expect(enriched.highlights).toContain("08:30 Oppmøte før første kamp");
    expect(enriched.highlights).toContain("09:15 Første kamp");
    expect(enriched.highlights).toContain("13:55 Oppmøte før andre kamp");
    expect(enriched.highlights).toContain("14:40 Andre kamp");
    expect(new Set(enriched.highlights).size).toBe(enriched.highlights.length);
  });

  it("Vårcup mislabeled: «18:40 Oppmøte» + Kampstart i notat → Første kamp", () => {
    const structured = buildCupStructuredDayContent({
      ...base,
      date: "2026-06-12",
      childTitle: "Vårcupen – fredag",
      details: null,
      highlights: [
        "18:40 Oppmøte",
        "Mye prat om oppmøte og logistikk uten kamp-ord i denne linjen",
      ],
      notes: [
        "Oppmøte kl. 17:45 ved banen. Kampstart kl. 18:40.",
        "Det er meldt ustabilt vær.",
      ],
      rememberItems: [],
      deadlines: [],
    });
    const blob = [
      "17:45",
      ...structured.highlights,
      ...structured.generalNotes,
      "Oppmøte kl. 17:45 ved banen. Kampstart kl. 18:40.",
      "Det er meldt ustabilt vær.",
    ].join("\n");
    const enriched = enrichCupStructuredContentWithResolvedTiming(structured, {
      date: "2026-06-12",
      parentTitleNorm: "varcupen",
      childTitleNorm: "varcupen fredag",
      sourceBlob: blob,
      attendanceTime: "17:45",
      orderedMatchTimes: ["18:40"],
      daySegmentStart: "17:45",
      daySegmentEnd: null,
      timeWindow: null,
      timePrecision: "start_only",
      tentative: false,
    });
    expect(enriched.highlights.some((h) => /^18:40\s+Oppmøte\b/i.test(h))).toBe(false);
    expect(enriched.highlights.some((h) => /^18:40\s+Første kamp\b/i.test(h))).toBe(true);
  });

  it("én kamptid: mye oppmøte-tekst i blob skal ikke gi kamp-raden «18:40 Oppmøte»", () => {
    const structured = buildCupStructuredDayContent({
      ...base,
      details: null,
      highlights: [],
      notes: [],
      rememberItems: [],
      deadlines: [],
    });
    const blob = [
      "Husk oppmøte i god tid.",
      "Vi trenger hjelp til oppmøte og organisering.",
      "Kampstart er kl. 18:40.",
    ].join("\n");
    const enriched = enrichCupStructuredContentWithResolvedTiming(structured, {
      date: "2026-06-12",
      parentTitleNorm: "varcupen",
      childTitleNorm: "varcupen fredag",
      sourceBlob: blob,
      attendanceTime: "17:45",
      orderedMatchTimes: ["18:40"],
      daySegmentStart: "17:45",
      daySegmentEnd: null,
      timeWindow: null,
      timePrecision: "start_only",
      tentative: false,
    });
    expect(enriched.highlights.some((h) => /^18:40\s+Oppmøte\b/i.test(h))).toBe(false);
    expect(enriched.highlights).toContain("18:40 Første kamp");
    expect(enriched.highlights).toContain("17:45 Oppmøte");
  });

  it("eksplisitt oppmøte-klokkeslett overstyrer kamp-label på samme tid", () => {
    const structured = buildCupStructuredDayContent({
      ...base,
      details: null,
      highlights: ["17:45 Kamp", "18:40 Kamp"],
      notes: [],
      rememberItems: [],
      deadlines: [],
    });
    const enriched = enrichCupStructuredContentWithResolvedTiming(structured, {
      date: "2026-05-08",
      parentTitleNorm: "varcupen",
      childTitleNorm: "varcupen fredag",
      sourceBlob:
        "Oppmøte fredag er kl. 17:45 ved baneområdet på Ekeberg, altså 55 minutter før kampstart. Kampstart er 18:40.",
      attendanceTime: null,
      orderedMatchTimes: ["17:45", "18:40"],
      daySegmentStart: "17:45",
      daySegmentEnd: null,
      timeWindow: null,
      timePrecision: "start_only",
      tentative: false,
    });
    expect(enriched.highlights).toContain("17:45 Oppmøte");
    expect(enriched.highlights).toContain("18:40 Første kamp");
  });

  it("Test C: highlight-label som matcher event title droppes", () => {
    const structured = buildCupStructuredDayContent({
      ...base,
      details: null,
      highlights: ["17:30 Høstcupen – fredag"],
      notes: [],
      rememberItems: [],
      deadlines: [],
    });
    const enriched = enrichCupStructuredContentWithResolvedTiming(structured, {
      date: "2026-09-18",
      parentTitleNorm: "hostcupen",
      childTitleNorm: "hostcupen fredag",
      sourceBlob: "17:30 kamp",
      attendanceTime: null,
      orderedMatchTimes: ["17:30"],
      daySegmentStart: "17:30",
      daySegmentEnd: null,
      timeWindow: null,
      timePrecision: "start_only",
      tentative: false,
    });
    expect(enriched.highlights.some((h) => /høstcupen/i.test(h))).toBe(false);
    expect(enriched.highlights).toContain("17:30 Første kamp");
  });

  it("Test D: tidsvindu blir én highlight og ikke to separate", () => {
    const structured = buildCupStructuredDayContent({
      ...base,
      date: "2026-09-20",
      childTitle: "Høstcupen – søndag",
      details: null,
      highlights: [],
      notes: ["Første kamp mellom 10:00 og 12:00."],
      rememberItems: [],
      deadlines: [],
    });
    const enriched = enrichCupStructuredContentWithResolvedTiming(structured, {
      date: "2026-09-20",
      parentTitleNorm: "hostcupen",
      childTitleNorm: "hostcupen sondag",
      sourceBlob: "Første kamp mellom 10:00 og 12:00.",
      attendanceTime: null,
      orderedMatchTimes: ["10:00", "12:00"],
      daySegmentStart: null,
      daySegmentEnd: null,
      timeWindow: { earliestStart: "10:00", latestStart: "12:00" },
      timePrecision: "time_window",
      tentative: true,
    });
    expect(enriched.highlights).toContain("10:00–12:00 Første kamp (foreløpig)");
    expect(enriched.highlights.some((h) => /^10:00\s/.test(h) && !h.includes("–"))).toBe(false);
    expect(enriched.highlights.some((h) => /^12:00\s/.test(h) && !h.includes("–"))).toBe(false);
  });
});
