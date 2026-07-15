import { describe, expect, it } from "vitest";
import {
  buildSchoolBlockProposal,
  type BuildSchoolBlockProposalMeta,
} from "@/lib/school-block-proposal";
import {
  makeChildren,
  makeMinimalAnalysisResult,
  makeSchoolBlockWeekResult,
} from "@/lib/fixtures/school-block-week.fixture";
import type { PortalImportContext } from "@/lib/portal-import-person";
import type { AIAnalysisResult } from "@/lib/types";

const META: BuildSchoolBlockProposalMeta = {
  proposalId: "prop-123",
  originalSourceType: "image",
};

const EMPTY_CTX: PortalImportContext = { knownPersons: [] };

function build(
  result: AIAnalysisResult,
  ctx: PortalImportContext = EMPTY_CTX,
  meta: BuildSchoolBlockProposalMeta = META,
) {
  return buildSchoolBlockProposal(result, ctx, meta);
}

/** Ett fullt typet AIAnalysisResult med én scheduleByDay-rad. */
function oneDayResult(date: string | null, dayLabel: string | null): AIAnalysisResult {
  return makeMinimalAnalysisResult({
    scheduleByDay: [
      { dayLabel, date, time: null, details: "x", highlights: [], rememberItems: [], deadlines: [], notes: [] },
    ],
  });
}

describe("buildSchoolBlockProposal — metadata", () => {
  it("beholder proposalId eksakt (validering trimmer kun for blank-sjekk)", () => {
    const proposalId = "  prop-EXACT  ";
    const p = build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, proposalId });
    // Ytre whitespace bevares: caller-strengen returneres uendret.
    expect(p.proposalId).toBe("  prop-EXACT  ");
  });

  it("blank / whitespace proposalId kaster TypeError", () => {
    expect(() => build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, proposalId: "" })).toThrow(TypeError);
    expect(() => build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, proposalId: "   " })).toThrow(TypeError);
  });

  it("blank / whitespace originalSourceType kaster TypeError", () => {
    expect(() => build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, originalSourceType: "" })).toThrow(TypeError);
    expect(() => build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, originalSourceType: "  " })).toThrow(TypeError);
  });

  it("originalSourceType trimmes i output", () => {
    const p = build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, originalSourceType: "  pdf  " });
    expect(p.originalSourceType).toBe("pdf");
  });

  it("sourceTitle følger prioritetsregelen", () => {
    expect(build(makeMinimalAnalysisResult({ title: "Res tittel" }), EMPTY_CTX, { ...META, sourceTitle: "  Meta tittel " }).sourceTitle).toBe("Meta tittel");
    expect(build(makeMinimalAnalysisResult({ title: "Res tittel" }), EMPTY_CTX, { ...META, sourceTitle: "   " }).sourceTitle).toBe("Res tittel");
    expect(build(makeMinimalAnalysisResult({ title: "   " }), EMPTY_CTX, { ...META, sourceTitle: undefined }).sourceTitle).toBe("Skoleinformasjon");
  });

  it("eksplisitt weekNumber: null bevares", () => {
    const p = build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META, weekNumber: null });
    expect("weekNumber" in p).toBe(true);
    expect(p.weekNumber).toBeNull();
  });

  it("utelatt weekNumber gir ikke feltet i output", () => {
    const p = build(makeMinimalAnalysisResult(), EMPTY_CTX, { ...META });
    expect("weekNumber" in p).toBe(false);
  });

  it("konstante toppnivåfelt", () => {
    const p = build(makeMinimalAnalysisResult({ confidence: 0.42 }));
    expect(p.kind).toBe("school_block");
    expect(p.schemaVersion).toBe("1.0.0");
    expect(p.confidence).toBe(0.42);
    expect(p.structureStatus).toBe("complete");
    expect(p.reviewFlags).toEqual([]);
    expect("languageTrack" in p).toBe(false);
  });
});

describe("buildSchoolBlockProposal — person-/klasseoppløsning", () => {
  it("matched child → personId, classCode, 'matched'", () => {
    const ctx: PortalImportContext = { knownPersons: [], children: makeChildren() };
    const p = build(makeSchoolBlockWeekResult(), ctx);
    expect(p.personMatchStatus).toBe("matched");
    expect(p.personId).toBe("child-2stc");
    expect(p.classCode).toBe("2STC");
  });

  it("ambiguous → null, null, 'child_unresolved'", () => {
    const result = makeMinimalAnalysisResult({ targetGroup: "2STC og 10B" });
    const ctx: PortalImportContext = { knownPersons: [], children: makeChildren() };
    const p = build(result, ctx);
    expect(p.personMatchStatus).toBe("child_unresolved");
    expect(p.personId).toBeNull();
    expect(p.classCode).toBeNull();
    expect(p.structureStatus).toBe("complete"); // ambiguous alene → fortsatt complete
  });

  it("no_signal → null, null, 'child_unresolved'", () => {
    const result = makeMinimalAnalysisResult({ targetGroup: null, title: "", description: "" });
    const ctx: PortalImportContext = { knownPersons: [], children: makeChildren() };
    const p = build(result, ctx);
    expect(p.personMatchStatus).toBe("child_unresolved");
    expect(p.personId).toBeNull();
    expect(p.classCode).toBeNull();
    expect(p.structureStatus).toBe("complete"); // no_signal alene → fortsatt complete
  });

  it("legacy relevanceContext → null, classCode, 'not_specified'", () => {
    const ctx: PortalImportContext = { knownPersons: [], relevanceContext: { classCode: "  2STC " } };
    const p = build(makeMinimalAnalysisResult(), ctx);
    expect(p.personMatchStatus).toBe("not_specified");
    expect(p.personId).toBeNull();
    expect(p.classCode).toBe("2STC");
  });

  it("ingen kontekst → null, null, 'not_specified'", () => {
    const p = build(makeMinimalAnalysisResult(), EMPTY_CTX);
    expect(p.personMatchStatus).toBe("not_specified");
    expect(p.personId).toBeNull();
    expect(p.classCode).toBeNull();
  });
});

describe("buildSchoolBlockProposal — dagfrø, sammenslåing og dato", () => {
  it("norsk skrevet dato og ISO-dato slås sammen til én dag", () => {
    const p = build(makeSchoolBlockWeekResult());
    const monday = p.days.filter((d) => d.date === "2026-06-15");
    expect(monday).toHaveLength(1);
    expect(monday[0]!.weekdayIndex).toBe("0");
    expect(monday[0]!.dayLabel).toBe("Mandag");
  });

  it("dato normaliseres til ISO og bestemmer weekdayIndex + kanonisk label", () => {
    const p = build(makeSchoolBlockWeekResult());
    const wed = p.days.find((d) => d.date === "2026-06-17");
    expect(wed?.weekdayIndex).toBe("2");
    expect(wed?.dayLabel).toBe("Onsdag");
  });

  it("samme dato gir samme dayId uansett label/casing/feil ukedagsord", () => {
    const a = build(makeMinimalAnalysisResult({ scheduleByDay: [{ dayLabel: "Mandag", date: "2026-06-15", time: null, details: null, highlights: [], rememberItems: [], deadlines: [], notes: [] }] }));
    const b = build(makeMinimalAnalysisResult({ scheduleByDay: [{ dayLabel: "FREDAG", date: "mandag 15. juni 2026", time: null, details: null, highlights: [], rememberItems: [], deadlines: [], notes: [] }] }));
    expect(a.days[0]!.dayId).toBe(b.days[0]!.dayId);
    expect(a.days[0]!.dayLabel).toBe("Mandag");
    expect(b.days[0]!.dayLabel).toBe("Mandag"); // dato er kilde til ukedag, ikke det feil «FREDAG»-ordet
  });

  it("samme dato med og uten label → samme dayId, weekdayIndex '0', kanonisk 'Mandag'", () => {
    const a = build(oneDayResult("2026-06-15", "Mandag"));
    const b = build(oneDayResult("2026-06-15", null));
    expect(a.days[0]!.dayId).toBe(b.days[0]!.dayId);
    expect(a.days[0]!.weekdayIndex).toBe("0");
    expect(b.days[0]!.weekdayIndex).toBe("0");
    expect(a.days[0]!.dayLabel).toBe("Mandag");
    expect(b.days[0]!.dayLabel).toBe("Mandag"); // dato bestemmer kanonisk label
  });

  it("dato-identitet ≠ weekday-only-identitet (samme weekdayIndex, ulik dayId)", () => {
    const dated = build(oneDayResult("2026-06-15", "Mandag"));
    const weekdayOnly = build(oneDayResult(null, "Mandag"));
    expect(dated.days[0]!.weekdayIndex).toBe("0");
    expect(weekdayOnly.days[0]!.weekdayIndex).toBe("0");
    // Ulike ID-er: weekday-only slås ikke sammen med en bestemt uke.
    expect(dated.days[0]!.dayId).not.toBe(weekdayOnly.days[0]!.dayId);
    expect(dated.days[0]!.date).toBe("2026-06-15"); // date:2026-06-15
    expect(weekdayOnly.days[0]!.date).toBeNull(); // weekday:0
  });

  it("weekday-only norske og engelske varianter gir samme dayId", () => {
    const nb = build(makeMinimalAnalysisResult({ scheduleByDay: [{ dayLabel: "tirsdag", date: null, time: null, details: "x", highlights: [], rememberItems: [], deadlines: [], notes: [] }] }));
    const en = build(makeMinimalAnalysisResult({ scheduleByDay: [{ dayLabel: "tuesday", date: null, time: null, details: "x", highlights: [], rememberItems: [], deadlines: [], notes: [] }] }));
    expect(nb.days).toHaveLength(1);
    expect(nb.days[0]!.dayId).toBe(en.days[0]!.dayId);
    expect(nb.days[0]!.weekdayIndex).toBe("1");
  });

  it("weekday-only og datofestet dag slås ikke sammen", () => {
    const p = build(makeMinimalAnalysisResult({ scheduleByDay: [
      { dayLabel: "mandag", date: "2026-06-15", time: null, details: null, highlights: [], rememberItems: [], deadlines: [], notes: [] },
      { dayLabel: "mandag", date: null, time: null, details: "x", highlights: [], rememberItems: [], deadlines: [], notes: [] },
    ] }));
    expect(p.days).toHaveLength(2);
    expect(p.days.some((d) => d.date === "2026-06-15")).toBe(true);
    expect(p.days.some((d) => d.date === null && d.weekdayIndex === "0")).toBe(true);
  });

  it("usikker rad uten dato eller gjenkjennelig ukedag droppes", () => {
    const p = build(makeMinimalAnalysisResult({ scheduleByDay: [
      { dayLabel: "Generell info", date: null, time: null, details: "tekst", highlights: [], rememberItems: [], deadlines: [], notes: [] },
    ] }));
    expect(p.days).toEqual([]);
  });

  it("full uke: fem dager, riktig antall (drop-rad utelatt)", () => {
    const p = build(makeSchoolBlockWeekResult());
    // man(15) + ons(17) + tor(18, fra classScheduleEntries) + fre(19) + tir(weekday-only)
    expect(p.days).toHaveLength(5);
  });
});

describe("buildSchoolBlockProposal — sortering og determinisme", () => {
  it("dagene sorteres deterministisk (datofestede stigende, så udaterte)", () => {
    const p = build(makeSchoolBlockWeekResult());
    const dated = p.days.filter((d) => d.date !== null).map((d) => d.date);
    expect(dated).toEqual(["2026-06-15", "2026-06-17", "2026-06-18", "2026-06-19"]);
    expect(p.days[p.days.length - 1]!.date).toBeNull(); // udatert tirsdag sist
  });

  it("ulik inputrekkefølge gir identisk days", () => {
    const base = makeSchoolBlockWeekResult();
    const reordered = makeSchoolBlockWeekResult();
    reordered.scheduleByDay.reverse();
    reordered.classScheduleEntries!.reverse();
    expect(build(reordered).days).toEqual(build(base).days);
  });

  it("gjentatte kall gir identisk output", () => {
    const ctx: PortalImportContext = { knownPersons: [], children: makeChildren() };
    expect(build(makeSchoolBlockWeekResult(), ctx)).toEqual(build(makeSchoolBlockWeekResult(), ctx));
  });

  it("ingen dayId inneholder tilfeldige/array-baserte komponenter (kun djb2-hex-hale)", () => {
    const p = build(makeSchoolBlockWeekResult());
    for (const d of p.days) {
      expect(d.dayId).toMatch(/^school-day-h[0-9a-f]{8}$/);
    }
  });
});

describe("buildSchoolBlockProposal — renhet og dagsskall", () => {
  it("muterer ikke result", () => {
    const result = makeSchoolBlockWeekResult();
    const snapshot = JSON.stringify(result);
    build(result, { knownPersons: [], children: makeChildren() });
    expect(JSON.stringify(result)).toBe(snapshot);
  });

  it("muterer ikke context", () => {
    const ctx: PortalImportContext = { knownPersons: [], children: makeChildren() };
    const snapshot = JSON.stringify(ctx);
    build(makeSchoolBlockWeekResult(), ctx);
    expect(JSON.stringify(ctx)).toBe(snapshot);
  });

  it("dagsskall: tomme contentItems, none, enrich_only, tomme reviewFlags", () => {
    const p = build(makeSchoolBlockWeekResult());
    for (const d of p.days) {
      expect(d.contentItems).toEqual([]);
      expect(d.dayOperation).toEqual({ op: "none" });
      expect(d.dayResolution).toBe("enrich_only");
      expect(d.reviewFlags).toEqual([]);
      expect(d.blockTitle).toBeNull();
      expect(d.evidence).toBeNull();
    }
  });

  it("begge dagkilder tomme gir days: [] og complete uten oppdiktet dag", () => {
    const p = build(makeMinimalAnalysisResult());
    expect(p.days).toEqual([]);
    expect(p.structureStatus).toBe("complete");
    expect(p.reviewFlags).toEqual([]);
  });
});
