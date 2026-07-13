/**
 * Kontrakt-smoketest for schoolBlockProposal wire-typene (schemaVersion "1.0.0").
 * Denne commiten definerer KUN typene — ingen produsent/ruting/innkobling ennå.
 *
 * Hovedbeviset er kompilering: to komplette, representative proposals deklareres med
 * `satisfies SchoolBlockProposal` (validerer literalene mot kontrakten UTEN å utvide
 * literaltypene). Proposal 1 låser at tidsløs fellesinformasjon er gyldig; Proposal 2
 * låser per-klasse-data med tri-state barnematch + strukturerte review-flagg.
 */
import { describe, expect, it } from "vitest";
import type { SchoolBlockDayOperation, SchoolBlockProposal } from "@/lib/types";

/* ── Proposal 1 – komplett tidsløs fellesinformasjon ─────────────────────────
 * enrich_only-dag, ett common-element uten klokkeslett, ingen review-flagg. */
const proposalCommonUntimed = {
  proposalId: "p-common",
  kind: "school_block",
  schemaVersion: "1.0.0",
  sourceTitle: "Beskjed til 9. trinn",
  originalSourceType: "text",
  confidence: 0.9,
  personId: "child-1",
  personMatchStatus: "matched",
  classCode: "9B",
  days: [
    {
      dayId: "d-fri",
      date: "2026-05-15",
      weekdayIndex: "4",
      dayLabel: "fredag",
      blockTitle: null,
      dayOperation: { op: "none" },
      dayResolution: "enrich_only",
      contentItems: [
        {
          itemId: "i-gym",
          title: "Husk gymtøy",
          contentType: "reminder",
          action: "enrich",
          subject: null,
          subjectKey: null,
          customLabel: null,
          audienceScope: "common",
          commonSchedule: null,
          audienceEntries: [],
          resolvedChildAudience: null,
          sections: { husk: ["Gymtøy"] },
          activityKind: null,
          evidence: null,
          sourceText: "Hugs gymtøy fredag.",
          confidence: 0.9,
          reviewFlags: [],
        },
      ],
      confidence: 0.9,
      evidence: null,
      reviewFlags: [],
    },
  ],
  structureStatus: "complete",
  reviewFlags: [],
} satisfies SchoolBlockProposal;

/* ── Proposal 2 – per-klasse-data med review ─────────────────────────────────
 * per_audience-element, tre audiences (true/false/null), resolvedChildAudience
 * peker på den sikre 2STC-oppføringen, og ett strukturert review-flagg peker på
 * dayId + itemId + den tvetydige audienceEntryId. */
const proposalPerClassReview = {
  proposalId: "p-perclass",
  kind: "school_block",
  schemaVersion: "1.0.0",
  sourceTitle: "Bokinnlevering 2ST",
  originalSourceType: "image",
  confidence: 0.82,
  personId: "child-2",
  personMatchStatus: "matched",
  classCode: "2STC",
  weekNumber: 25,
  days: [
    {
      dayId: "d-thu18",
      date: "2026-06-18",
      weekdayIndex: "3",
      dayLabel: "torsdag",
      blockTitle: null,
      dayOperation: { op: "none" },
      dayResolution: "enrich_only",
      contentItems: [
        {
          itemId: "i-bok",
          title: "Bokinnlevering",
          contentType: "homework",
          action: "enrich",
          subject: null,
          subjectKey: null,
          customLabel: "Bokinnlevering",
          audienceScope: "per_audience",
          commonSchedule: null,
          audienceEntries: [
            {
              audienceEntryId: "a-2sta",
              classCodes: ["2STA"],
              pulje: null,
              start: "13:10",
              end: "13:40",
              room: null,
              teacher: null,
              isChildAudience: false,
            },
            {
              audienceEntryId: "a-2stc",
              classCodes: ["2STC"],
              pulje: null,
              start: "10:30",
              end: "11:00",
              room: null,
              teacher: null,
              isChildAudience: true,
            },
            {
              audienceEntryId: "a-2stx",
              classCodes: ["2STX"],
              pulje: "Pulje 2",
              start: null,
              end: null,
              room: null,
              teacher: null,
              isChildAudience: null,
            },
          ],
          resolvedChildAudience: {
            audienceEntryId: "a-2stc",
            start: "10:30",
            end: "11:00",
            room: null,
            teacher: null,
          },
          sections: {},
          activityKind: null,
          evidence: "Bokinnlevering per klasse",
          sourceText: "Bokinnlevering: 2STA 13.10-13.40, 2STC 10.30-11.00, 2STX (tid mangler).",
          confidence: 0.8,
          reviewFlags: [
            {
              code: "child_class_unresolved",
              message: "2STX mangler tid og kan ikke tidsplasseres.",
              scope: { dayId: "d-thu18", itemId: "i-bok", audienceEntryId: "a-2stx" },
            },
          ],
        },
      ],
      confidence: 0.8,
      evidence: null,
      reviewFlags: [
        {
          code: "child_class_unresolved",
          message: "Én audience uten sikker klassekobling.",
          scope: { dayId: "d-thu18", itemId: "i-bok", audienceEntryId: "a-2stx" },
        },
      ],
    },
  ],
  structureStatus: "review_required",
  reviewFlags: [
    {
      code: "child_class_unresolved",
      message: "Forslaget har en uavklart audience.",
      scope: { dayId: "d-thu18", itemId: "i-bok", audienceEntryId: "a-2stx" },
    },
  ],
} satisfies SchoolBlockProposal;

/** Alle fire dayOperation-variantene må type-sjekke (diskriminert union). */
const dayOperations: SchoolBlockDayOperation[] = [
  { op: "none" },
  {
    op: "replace_day",
    activityKind: "trip_day",
    effectiveStart: "08:00",
    effectiveEnd: "15:00",
    reason: "Utflukt til Oslo",
    confidence: 0.8,
  },
  { op: "adjust_start", effectiveStart: "10:00", reason: "Senere oppstart", confidence: 0.7 },
  { op: "adjust_end", effectiveEnd: "12:00", reason: "Tidligere slutt", confidence: 0.7 },
];

describe("schoolBlockProposal wire-kontrakt (1.0.0)", () => {
  it("Proposal 1: tidsløs fellesinfo er gyldig (common + commonSchedule=null + enrich, ingen flagg)", () => {
    expect(proposalCommonUntimed.kind).toBe("school_block");
    expect(proposalCommonUntimed.schemaVersion).toBe("1.0.0");
    expect(proposalCommonUntimed.structureStatus).toBe("complete");
    const item = proposalCommonUntimed.days[0].contentItems[0];
    expect(item.audienceScope).toBe("common");
    expect(item.commonSchedule).toBeNull();
    expect(item.audienceEntries).toEqual([]);
    expect(item.resolvedChildAudience).toBeNull();
    expect(proposalCommonUntimed.reviewFlags).toEqual([]);
    expect(proposalCommonUntimed.days[0].reviewFlags).toEqual([]);
    expect(item.reviewFlags).toEqual([]);
  });

  it("Proposal 2: per-klasse tri-state + resolvedChildAudience peker på isChildAudience=true", () => {
    expect(proposalPerClassReview.structureStatus).toBe("review_required");
    const item = proposalPerClassReview.days[0].contentItems[0];
    expect(item.audienceScope).toBe("per_audience");
    expect(item.audienceEntries).toHaveLength(3);

    const child = item.audienceEntries.find((e) => e.isChildAudience === true);
    const other = item.audienceEntries.find((e) => e.isChildAudience === false);
    const unknown = item.audienceEntries.find((e) => e.isChildAudience === null);
    expect(child?.start).toBe("10:30");
    expect(other?.start).toBe("13:10");
    expect(unknown?.audienceEntryId).toBe("a-2stx");

    // resolvedChildAudience peker på den faktiske true-oppføringen
    expect(item.resolvedChildAudience?.audienceEntryId).toBe(child?.audienceEntryId);
    expect(item.resolvedChildAudience?.audienceEntryId).toBe("a-2stc");
  });

  it("Proposal 2: strukturert review-flagg peker på dayId + itemId + audienceEntryId", () => {
    const flag = proposalPerClassReview.days[0].contentItems[0].reviewFlags[0];
    expect(flag.scope.dayId).toBe("d-thu18");
    expect(flag.scope.itemId).toBe("i-bok");
    expect(flag.scope.audienceEntryId).toBe("a-2stx");
  });

  it("alle fire dayOperation-variantene er dekket (diskriminert union)", () => {
    expect(dayOperations.map((o) => o.op)).toEqual([
      "none",
      "replace_day",
      "adjust_start",
      "adjust_end",
    ]);
  });
});
