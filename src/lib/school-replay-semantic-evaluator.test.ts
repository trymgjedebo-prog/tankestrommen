/**
 * Tester for den rene semantiske evaluatoren: én bestått + én feilende check per kategori,
 * KLASSIFISERINGSKONTROLL (fem separate manipulerte replay-resultater gir nøyaktig hver sin
 * kategori — aldri en generell SEMANTIC_ERROR), kant-tilfeller (manglende dag/draft/fact),
 * valideringsfeil, determinisme, immutabilitet og bevart check-rekkefølge.
 * Ingen route-import; replay bygges via den rene runneren.
 */
import { describe, expect, it } from "vitest";
import {
  runSchoolCanonicalReplayFromModelResponse,
  type SchoolCanonicalReplayResult,
} from "@/lib/school-canonical-replay";
import { evaluateSchoolReplaySemantics } from "@/lib/school-replay-semantic-evaluator";
import {
  validateSchoolReplayExpectations,
  type SchoolReplayExpectations,
  type SchoolReplaySemanticCheck,
} from "@/lib/school-replay-expectations";
import type { PortalImportContext } from "@/lib/portal-import-person";

/* ── Inline replay-grunnlag (samme form som smoke) ─────────────────────────── */

const NOW = new Date("2026-04-01T10:00:00.000Z");
const CTX = (): PortalImportContext => ({
  knownPersons: [],
  relevanceContext: {
    classCode: "2STC",
    schoolProfile: {
      gradeBand: "vg2",
      weekdays: { "0": { useSimpleDay: false, lessons: [
        { subjectKey: "norsk", customLabel: null, start: "08:00", end: "09:00" },
        { subjectKey: "tysk", customLabel: null, start: "09:00", end: "10:00" },
      ] } },
    },
  },
});
function rawModelContent(): string {
  return JSON.stringify({
    title: "Ukeplan uke 14 – 2STC",
    category: "beskjed",
    schedule: [],
    scheduleByDay: [
      { dayLabel: "Mandag", date: "2026-03-30", time: null, details: "Norsk i timen: Les kapittel 2.\nTysk i timen: Beskriv bildet på side 41.", highlights: [], rememberItems: [], deadlines: [], notes: [] },
      { dayLabel: "Tirsdag", date: "2026-03-31", time: null, details: "Spansk: Gloser kapittel 3.", highlights: [], rememberItems: ["Husk oppladet PC."], deadlines: [], notes: [] },
    ],
    schoolDayOperationSignals: [
      { operation: "adjust_start", date: "2026-03-31", weekdayIndex: "1", dayLabel: "tirsdag", effectiveStart: "10:30", reason: "Elevsamtaler", sourceText: "Starter 10.30.", confidence: 0.9 },
    ],
    extractedText: { raw: "Ukeplan uke 14 for 2STC.", language: "no", confidence: 0.92 },
    confidence: 0.95,
  });
}
function makeReplay(): SchoolCanonicalReplayResult {
  return runSchoolCanonicalReplayFromModelResponse({
    rawModelContent: rawModelContent(),
    sourceText: "Ukeplan uke 14 for 2STC.",
    now: NOW,
    sourceType: "text",
    personContext: CTX(),
    languageTrack: { resolvedTrack: "tysk", confidence: 0.8, reason: "single_track_detected" },
    proposalId: "sem-p-1",
  });
}
function expectationsOf(checks: SchoolReplaySemanticCheck[]): SchoolReplayExpectations {
  return { schemaVersion: "1.0.0", fixtureId: "inline", checks };
}
const DAY_OP_CHECK: SchoolReplaySemanticCheck = { id: "c-dayop", description: "tirsdag 10:30", kind: "day_operation", date: "2026-03-31", expected: { op: "adjust_start", effectiveStart: "10:30" } };
const SUBJ_CHECK: SchoolReplaySemanticCheck = { id: "c-subj", description: "norsk på mandag", kind: "subject_placement", date: "2026-03-30", subjectKey: "norsk", textContains: "Les kapittel 2", minMatches: 1, maxMatches: 1 };
const LANG_CHECK: SchoolReplaySemanticCheck = { id: "c-lang", description: "ingen spansk", kind: "language_exclusion", textContains: "Spansk", scope: "canonical_draft", maxMatches: 0 };
const DUP_CHECK: SchoolReplaySemanticCheck = { id: "c-dup", description: "PC én gang", kind: "max_occurrences", textContains: "Husk oppladet PC", scope: "canonical_draft", maxMatches: 1 };
const COV_CHECK: SchoolReplaySemanticCheck = { id: "c-cov", description: "norsk full coverage", kind: "source_coverage", subjectKey: "norsk", textContains: "Les kapittel 2", expectedCoverage: "full", minMatches: 1 };
const ALL_CHECKS = [DAY_OP_CHECK, SUBJ_CHECK, LANG_CHECK, DUP_CHECK, COV_CHECK];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("én bestått + én feilende check per kategori", () => {
  const replay = makeReplay();

  it("DAY_OPERATION: pass på korrekt op/start; fail ved feil op og ved feil effectiveStart", () => {
    const ok = evaluateSchoolReplaySemantics(replay, expectationsOf([DAY_OP_CHECK]));
    expect(ok.checks[0]!).toMatchObject({ status: "pass", category: "DAY_OPERATION" });
    const wrongOp = evaluateSchoolReplaySemantics(replay, expectationsOf([{ ...DAY_OP_CHECK, expected: { op: "replace_day" } }]));
    expect(wrongOp.checks[0]!).toMatchObject({ status: "fail", category: "DAY_OPERATION" });
    const wrongStart = evaluateSchoolReplaySemantics(replay, expectationsOf([{ ...DAY_OP_CHECK, expected: { op: "adjust_start", effectiveStart: "09:00" } }]));
    expect(wrongStart.checks[0]!).toMatchObject({ status: "fail", category: "DAY_OPERATION" });
  });

  it("SUBJECT_PLACEMENT: pass under riktig fag; fail når teksten finnes på dagen men under FEIL subjectKey", () => {
    const ok = evaluateSchoolReplaySemantics(replay, expectationsOf([SUBJ_CHECK]));
    expect(ok.checks[0]!).toMatchObject({ status: "pass", category: "SUBJECT_PLACEMENT" });
    // Teksten «Les kapittel 2» ligger under norsk — å forvente den under tysk skal feile SOM
    // SUBJECT_PLACEMENT (ikke som generell manglende tekst).
    const wrongSubject = evaluateSchoolReplaySemantics(replay, expectationsOf([{ ...SUBJ_CHECK, subjectKey: "tysk" }]));
    expect(wrongSubject.checks[0]!).toMatchObject({ status: "fail", category: "SUBJECT_PLACEMENT" });
    expect(wrongSubject.checks[0]!.evidence.subjectKeysOnDay).toContain("norsk");
  });

  it("LANGUAGE_TRACK: pass når spansk er filtrert; fail når et spansk-fragment finnes i canonical draft", () => {
    const ok = evaluateSchoolReplaySemantics(replay, expectationsOf([LANG_CHECK]));
    expect(ok.checks[0]!).toMatchObject({ status: "pass", category: "LANGUAGE_TRACK" });
    const leaked = clone(replay);
    leaked.outputs.canonicalSchoolContentDraft!.days[1]!.generalDayMessages.push({
      ...clone(replay.outputs.canonicalSchoolContentDraft!.days[1]!.generalDayMessages[0]!),
      itemId: "leak-1",
      sourceText: "Spansk: Gloser kapittel 3.",
      sections: {},
    });
    const fail = evaluateSchoolReplaySemantics(leaked, expectationsOf([LANG_CHECK]));
    expect(fail.checks[0]!).toMatchObject({ status: "fail", category: "LANGUAGE_TRACK" });
    expect(fail.checks[0]!.evidence.matchedItemIds).toEqual(["leak-1"]);
  });

  it("DUPLICATION: pass ved ett logisk item; fail når samme innhold finnes i flere items enn maxMatches", () => {
    const ok = evaluateSchoolReplaySemantics(replay, expectationsOf([DUP_CHECK]));
    expect(ok.checks[0]!).toMatchObject({ status: "pass", category: "DUPLICATION" });
    // Samme tekst i FLERE FELT på samme item skal fortsatt telle som ETT logisk item.
    const multiField = clone(replay);
    const day = multiField.outputs.canonicalSchoolContentDraft!.days[1]!;
    const pcItem = day.generalDayMessages.find((i) => (i.sourceText ?? "").includes("oppladet PC"))!;
    pcItem.sections = { ...pcItem.sections, descriptionLines: ["Husk oppladet PC."] };
    expect(evaluateSchoolReplaySemantics(multiField, expectationsOf([DUP_CHECK])).checks[0]!.status).toBe("pass");
    // Duplisert LOGISK item → fail.
    const dup = clone(replay);
    const dupDay = dup.outputs.canonicalSchoolContentDraft!.days[1]!;
    dupDay.generalDayMessages.push({ ...clone(pcItem), itemId: "dup-1" });
    const fail = evaluateSchoolReplaySemantics(dup, expectationsOf([DUP_CHECK]));
    expect(fail.checks[0]!).toMatchObject({ status: "fail", category: "DUPLICATION" });
    expect(fail.checks[0]!.actual).toEqual({ matchCount: 2 });
  });

  it("SOURCE_COVERAGE: pass ved full; fail når matchende fact finnes men coverage er feil", () => {
    const ok = evaluateSchoolReplaySemantics(replay, expectationsOf([COV_CHECK]));
    expect(ok.checks[0]!).toMatchObject({ status: "pass", category: "SOURCE_COVERAGE" });
    const wrongCov = clone(replay);
    for (const f of wrongCov.outputs.normalizedSchoolContentFacts) {
      if (f.subjectKey === "norsk") f.sourceCoverage = "partial";
    }
    const fail = evaluateSchoolReplaySemantics(wrongCov, expectationsOf([COV_CHECK]));
    expect(fail.checks[0]!).toMatchObject({ status: "fail", category: "SOURCE_COVERAGE" });
    expect(fail.checks[0]!.evidence.candidateCount).toBeGreaterThan(0); // fact finnes, coverage feil
  });
});

describe("KLASSIFISERINGSKONTROLL: fem manipulerte replays gir nøyaktig hver sin kategori", () => {
  const base = makeReplay();
  const expectations = expectationsOf(ALL_CHECKS);
  const failingCategories = (r: SchoolCanonicalReplayResult) =>
    evaluateSchoolReplaySemantics(r, expectations).checks.filter((c) => c.status === "fail").map((c) => c.category);

  it("baseline: alle fem består", () => {
    expect(failingCategories(base)).toEqual([]);
  });
  it("manipulert dayOperation → nøyaktig [DAY_OPERATION]", () => {
    const r = clone(base);
    r.outputs.canonicalSchoolContentDraft!.days[1]!.dayOperation = { op: "none" };
    expect(failingCategories(r)).toEqual(["DAY_OPERATION"]);
  });
  it("manipulert subjectKey → nøyaktig [SUBJECT_PLACEMENT]", () => {
    const r = clone(base);
    const norsk = r.outputs.canonicalSchoolContentDraft!.days[0]!.subjectItems.find((i) => i.subjectKey === "norsk")!;
    norsk.subjectKey = "matematikk";
    expect(failingCategories(r)).toEqual(["SUBJECT_PLACEMENT"]);
  });
  it("manipulert språklekkasje → nøyaktig [LANGUAGE_TRACK]", () => {
    const r = clone(base);
    const d = r.outputs.canonicalSchoolContentDraft!.days[1]!;
    d.generalDayMessages.push({ ...clone(r.outputs.canonicalSchoolContentDraft!.days[1]!.generalDayMessages[0]!), itemId: "leak-2", sourceText: "Spansk gloser.", sections: {} });
    expect(failingCategories(r)).toEqual(["LANGUAGE_TRACK"]);
  });
  it("manipulert duplikat → nøyaktig [DUPLICATION]", () => {
    const r = clone(base);
    const d = r.outputs.canonicalSchoolContentDraft!.days[1]!;
    const pc = d.generalDayMessages.find((i) => (i.sourceText ?? "").includes("oppladet PC"))!;
    d.generalDayMessages.push({ ...clone(pc), itemId: "dup-2" });
    expect(failingCategories(r)).toEqual(["DUPLICATION"]);
  });
  it("manipulert coverage → nøyaktig [SOURCE_COVERAGE]", () => {
    const r = clone(base);
    for (const f of r.outputs.normalizedSchoolContentFacts) if (f.subjectKey === "norsk") f.sourceCoverage = "partial";
    expect(failingCategories(r)).toEqual(["SOURCE_COVERAGE"]);
  });
});

describe("kant-tilfeller", () => {
  const replay = makeReplay();
  it("manglende dag → fail (day_operation og subject_placement)", () => {
    const r = evaluateSchoolReplaySemantics(replay, expectationsOf([
      { ...DAY_OP_CHECK, id: "d1", date: "2026-06-01" },
      { ...SUBJ_CHECK, id: "d2", date: "2026-06-01" },
    ]));
    expect(r.checks.map((c) => c.status)).toEqual(["fail", "fail"]);
    expect(r.checks[0]!.evidence.dayFound).toBe(false);
  });
  it("manglende canonical draft → dag-checks feiler, exclusion med max 0 består (ingen items)", () => {
    const noDraft = clone(replay);
    noDraft.outputs.canonicalSchoolContentDraft = null;
    const r = evaluateSchoolReplaySemantics(noDraft, expectationsOf([DAY_OP_CHECK, LANG_CHECK]));
    expect(r.checks[0]!.status).toBe("fail");
    expect(r.checks[1]!.status).toBe("pass");
    expect(r.checks[1]!.evidence.draftPresent).toBe(false);
  });
  it("manglende fact → source_coverage feiler med candidateCount 0", () => {
    const r = evaluateSchoolReplaySemantics(replay, expectationsOf([{ ...COV_CHECK, textContains: "finnes ikke" }]));
    expect(r.checks[0]!).toMatchObject({ status: "fail" });
    expect(r.checks[0]!.evidence.candidateCount).toBe(0);
  });
  it("tom expectations-liste → passed true, total 0, alle kategorier til stede med 0", () => {
    const r = evaluateSchoolReplaySemantics(replay, expectationsOf([]));
    expect(r.passed).toBe(true);
    expect(r.summary).toMatchObject({ total: 0, passed: 0, failed: 0 });
    expect(Object.keys(r.summary.byCategory).sort()).toEqual(["DAY_OPERATION", "DUPLICATION", "LANGUAGE_TRACK", "SOURCE_COVERAGE", "SUBJECT_PLACEMENT"]);
  });
});

describe("expectations-validering", () => {
  const validRaw = () => JSON.parse(JSON.stringify(expectationsOf(ALL_CHECKS))) as Record<string, unknown>;
  it("gyldig fil validerer", () => {
    expect(validateSchoolReplayExpectations(validRaw()).checks).toHaveLength(5);
  });
  it("duplisert check-id → presis feil", () => {
    const raw = validRaw();
    (raw.checks as Array<{ id: string }>)[1]!.id = "c-dayop";
    expect(() => validateSchoolReplayExpectations(raw)).toThrow('checks[1] (id "c-dayop"): duplisert check-id');
  });
  it("ugyldig kind → presis feil", () => {
    const raw = validRaw();
    (raw.checks as Array<{ kind: string }>)[0]!.kind = "magic";
    expect(() => validateSchoolReplayExpectations(raw)).toThrow("'kind' må være en av");
  });
  it("ugyldig min/max (min > max) → presis feil", () => {
    const raw = validRaw();
    (raw.checks as Array<Record<string, unknown>>)[1]!.minMatches = 3;
    (raw.checks as Array<Record<string, unknown>>)[1]!.maxMatches = 1;
    expect(() => validateSchoolReplayExpectations(raw)).toThrow("minMatches kan ikke være større enn maxMatches");
  });
  it("negativt maxMatches → presis feil", () => {
    const raw = validRaw();
    (raw.checks as Array<Record<string, unknown>>)[3]!.maxMatches = -1;
    expect(() => validateSchoolReplayExpectations(raw)).toThrow("ikke-negativt heltall");
  });
  it("ugyldig ISO-dato → presis feil", () => {
    const raw = validRaw();
    (raw.checks as Array<Record<string, unknown>>)[0]!.date = "31.03.2026";
    expect(() => validateSchoolReplayExpectations(raw)).toThrow("gyldig ISO-dato");
  });
  it("category i JSON er forbudt (kan aldri overstyre kind-mappingen)", () => {
    const raw = validRaw();
    (raw.checks as Array<Record<string, unknown>>)[0]!.category = "LANGUAGE_TRACK";
    expect(() => validateSchoolReplayExpectations(raw)).toThrow("'category' er ikke tillatt");
  });
  it("ukjent scope og ukjent coverage → presise feil", () => {
    const raw1 = validRaw();
    (raw1.checks as Array<Record<string, unknown>>)[2]!.scope = "everything";
    expect(() => validateSchoolReplayExpectations(raw1)).toThrow("'scope' må være en av");
    const raw2 = validRaw();
    (raw2.checks as Array<Record<string, unknown>>)[4]!.expectedCoverage = "total";
    expect(() => validateSchoolReplayExpectations(raw2)).toThrow("'expectedCoverage' må være en av");
  });
});

describe("determinisme, immutabilitet og rekkefølge", () => {
  it("to evalueringer er dypt identiske; input muteres ikke", () => {
    const replay = makeReplay();
    const expectations = expectationsOf(ALL_CHECKS);
    const rSnap = JSON.stringify(replay);
    const eSnap = JSON.stringify(expectations);
    const a = evaluateSchoolReplaySemantics(replay, expectations);
    const b = evaluateSchoolReplaySemantics(replay, expectations);
    expect(a).toEqual(b);
    expect(JSON.stringify(replay)).toBe(rSnap);
    expect(JSON.stringify(expectations)).toBe(eSnap);
  });
  it("check-rekkefølgen i rapporten følger expectations-rekkefølgen", () => {
    const replay = makeReplay();
    const reversed = expectationsOf([...ALL_CHECKS].reverse());
    const r = evaluateSchoolReplaySemantics(replay, reversed);
    expect(r.checks.map((c) => c.id)).toEqual([...ALL_CHECKS].reverse().map((c) => c.id));
  });
});
