/**
 * Vei 1, lag 2: children-liste-kontrakt + utvalg + personId-tilordning.
 * VIKTIGST: bakoverkompat — gammel ett-barns-form (uten children) skal være UENDRET (prod kjører den).
 */
import { describe, expect, it } from "vitest";
import { validateClientSchoolWeeklyProfile } from "@/lib/ai/analyze-image";
import {
  applyChildSelectionToItems,
  selectChildForDocument,
} from "@/lib/child-selection";
import {
  parseRelevanceChildrenFromBody,
  type PortalImportContext,
  type PortalRelevanceChild,
} from "@/lib/portal-import-person";
import type { AIAnalysisResult } from "@/lib/types";

function result(raw: string): AIAnalysisResult {
  return {
    title: "",
    schedule: [],
    scheduleByDay: [],
    location: null,
    description: "",
    category: "beskjed",
    targetGroup: null,
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.8,
    extractedText: { raw, language: "no", confidence: 0.8 },
  };
}

const STELLAN: PortalRelevanceChild = { personId: "p-stellan", classCode: "2STC" };
const IDA: PortalRelevanceChild = {
  personId: "p-ida",
  classCode: "10B",
  schoolProfile: { gradeBand: "8-10", weekdays: {} },
};

describe("parseRelevanceChildrenFromBody (ny form-deteksjon)", () => {
  it("parser children-liste (objekt) → personId + classCode (+ valgfri profil)", () => {
    expect(
      parseRelevanceChildrenFromBody(
        { children: [{ personId: "p1", classCode: "2STC" }, { personId: "p2", classCode: "10B" }] },
        validateClientSchoolWeeklyProfile,
      ),
    ).toEqual([
      { personId: "p1", classCode: "2STC" },
      { personId: "p2", classCode: "10B" },
    ]);
  });

  it("parser children fra JSON-streng (multipart)", () => {
    expect(
      parseRelevanceChildrenFromBody(JSON.stringify({ children: [{ personId: "p1", classCode: "2STC" }] })),
    ).toEqual([{ personId: "p1", classCode: "2STC" }]);
  });

  it("GAMMEL form (uten children) → undefined → kalleren faller til ett-barns-parser", () => {
    expect(parseRelevanceChildrenFromBody({ classCode: "2STC" })).toBeUndefined();
    expect(parseRelevanceChildrenFromBody(undefined)).toBeUndefined();
    expect(parseRelevanceChildrenFromBody("ikke json")).toBeUndefined();
  });

  it("filtrerer ugyldige barn (mangler personId/classCode); tom liste → undefined", () => {
    expect(
      parseRelevanceChildrenFromBody({
        children: [{ personId: "p1", classCode: "2STC" }, { classCode: "10B" }, { personId: "p3" }],
      }),
    ).toEqual([{ personId: "p1", classCode: "2STC" }]);
    expect(parseRelevanceChildrenFromBody({ children: [] })).toBeUndefined();
  });
});

describe("selectChildForDocument", () => {
  it("BAKOVERKOMPAT: ingen children → relevanceContext UENDRET (samme referanse) + match null", () => {
    const portalImport: PortalImportContext = {
      knownPersons: [],
      relevanceContext: { classCode: "2STC", schoolProfile: { gradeBand: "vg2", weekdays: {} } },
    };
    const out = selectChildForDocument(result("Info til 2STA om noe"), portalImport);
    expect(out.match).toBeNull();
    expect(out.relevanceContext).toBe(portalImport.relevanceContext); // SAMME referanse → pass-through
  });

  it("children + dok med literal 2STC → matched, reduserer til Stellans classCode", () => {
    const out = selectChildForDocument(result("Muntlig eksamen for 2STC mandag"), {
      knownPersons: [],
      children: [STELLAN, IDA],
    });
    expect(out.match).toEqual({ personId: "p-stellan", status: "matched" });
    expect(out.relevanceContext).toEqual({ classCode: "2STC" });
  });

  it("children + range «2STA–2STF» → matched Stellan (trinn vg2), relevanceContext = 2STC", () => {
    const out = selectChildForDocument(result("Eksamen og avslutning for 2STA–2STF i uke 25"), {
      knownPersons: [],
      children: [STELLAN, IDA],
    });
    expect(out.match?.personId).toBe("p-stellan");
    expect(out.match?.status).toBe("matched");
    expect(out.relevanceContext).toEqual({ classCode: "2STC" });
  });

  it("children + uklart dok → no_signal, ingen klasse-filtrering (relevanceContext undefined)", () => {
    const out = selectChildForDocument(result("Skolen er stengt fredag pga. planleggingsdag"), {
      knownPersons: [],
      children: [STELLAN, IDA],
    });
    expect(out.match).toEqual({ personId: null, status: "no_signal" });
    expect(out.relevanceContext).toBeUndefined();
  });
});

type TestItem = {
  kind: string;
  event?: { personId: unknown; personMatchStatus?: unknown };
  task?: { personId: unknown };
};

function sampleItems(): TestItem[] {
  return [
    { kind: "event", event: { personId: "pending", personMatchStatus: "not_specified" } },
    { kind: "task", task: { personId: "pending" } },
    { kind: "event", event: { personId: "real-flight-id", personMatchStatus: "matched" } }, // ekte → urørt
  ];
}

describe("applyChildSelectionToItems", () => {
  it("matched → setter valgt personId + status, rører ikke ekte personId (fly-match)", () => {
    const its = sampleItems();
    applyChildSelectionToItems(its, { personId: "p-stellan", status: "matched" });
    expect(its[0]!.event!.personId).toBe("p-stellan");
    expect(its[0]!.event!.personMatchStatus).toBe("matched");
    expect(its[1]!.task!.personId).toBe("p-stellan");
    expect(its[2]!.event!.personId).toBe("real-flight-id"); // urørt
  });

  it("no_signal/ambiguous → event-status child_unresolved, personId uendret", () => {
    const its = sampleItems();
    applyChildSelectionToItems(its, { personId: null, status: "no_signal" });
    expect(its[0]!.event!.personMatchStatus).toBe("child_unresolved");
    expect(its[0]!.event!.personId).toBe("pending");
    expect(its[1]!.task!.personId).toBe("pending"); // task uten status urørt
  });

  it("match null (gammel form / cup) → no-op", () => {
    const its = sampleItems();
    applyChildSelectionToItems(its, null);
    expect(its[0]!.event!.personMatchStatus).toBe("not_specified");
    expect(its[0]!.event!.personId).toBe("pending");
  });
});
