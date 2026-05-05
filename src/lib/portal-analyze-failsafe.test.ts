import { describe, expect, it } from "vitest";
import { asNullableString } from "./analysis-null-safety";
import { inferTravelFlightFromBlob } from "./travel-document-infer";
import {
  normalizePortalProposalEventItem,
  resolvePortalEventPersonMatch,
} from "./portal-import-person";

describe("portal analyze failsafe (500 / null-safety)", () => {
  it("resolvePortalEventPersonMatch tolerates non-string document name from model JSON", () => {
    expect(() =>
      resolvePortalEventPersonMatch({
        documentExtractedName: 12345 as unknown as string,
        knownPersons: [],
      }),
    ).not.toThrow();
    const r = resolvePortalEventPersonMatch({
      documentExtractedName: 12345 as unknown as string,
      knownPersons: [],
    });
    expect(r.personMatchStatus).toBe("not_specified");
  });

  it("normalizePortalProposalEventItem accepts null start/end and null travel times", () => {
    expect(() =>
      normalizePortalProposalEventItem({
        kind: "event",
        proposalId: "p",
        sourceId: "s",
        originalSourceType: "image",
        confidence: 0.9,
        event: {
          date: "2025-06-10",
          title: "Flyreise",
          start: null,
          end: null,
          metadata: {
            travel: {
              type: "flight",
              origin: "JFK",
              destination: "LHR",
              departureTime: null,
              arrivalTime: null,
            },
          },
        },
      }),
    ).not.toThrow();
    const item = normalizePortalProposalEventItem({
      kind: "event",
      proposalId: "p",
      sourceId: "s",
      originalSourceType: "image",
      confidence: 0.9,
      event: {
        date: "2025-06-10",
        title: "Flyreise",
        start: null,
        end: null,
        metadata: {
          travel: {
            type: "flight",
            origin: "JFK",
            destination: "LHR",
            departureTime: null,
            arrivalTime: null,
          },
        },
      },
    });
    expect(item.event.start).toBeNull();
    expect(item.event.end).toBeNull();
  });

  it("asNullableString never calls trim on non-string (boarding passenger edge case)", () => {
    expect(asNullableString(999)).toBeNull();
    expect(asNullableString(" Jane ")).toBe("Jane");
  });

  it("boarding pass with explicit departure/arrival: inference + normalize does not throw", () => {
    const blob = `
Boardingpass:
- JFK New York
- LHR London
departure 08:30
arrival 11:30
passenger Jane Doe
`;
    expect(() => inferTravelFlightFromBlob(blob)).not.toThrow();
    const tf = inferTravelFlightFromBlob(blob);
    expect(tf?.departureTime).toBe("08:30");
    expect(tf?.endTime).toBe("11:30");
    expect(() =>
      normalizePortalProposalEventItem({
        kind: "event",
        proposalId: "p",
        sourceId: "s",
        originalSourceType: "image",
        confidence: 0.9,
        event: {
          date: "2025-06-10",
          title: tf!.proposedTitle,
          start: tf!.departureTime,
          end: tf!.endTime,
          metadata: {},
        },
      }),
    ).not.toThrow();
  });

  it("boarding pass missing arrival: normalize does not throw", () => {
    const tf = inferTravelFlightFromBlob(`
Boarding pass
JFK New York
LHR London
departure 10:00
flight SK1234
`);
    expect(tf).not.toBeNull();
    expect(() =>
      normalizePortalProposalEventItem({
        kind: "event",
        proposalId: "p",
        sourceId: "s",
        originalSourceType: "pdf",
        confidence: 0.9,
        event: {
          date: "2025-06-10",
          title: tf!.proposedTitle,
          start: tf!.departureTime,
          end: tf!.endTime,
          metadata: { requiresManualTimeReview: true },
        },
      }),
    ).not.toThrow();
    const item = normalizePortalProposalEventItem({
      kind: "event",
      proposalId: "p",
      sourceId: "s",
      originalSourceType: "pdf",
      confidence: 0.9,
      event: {
        date: "2025-06-10",
        title: tf!.proposedTitle,
        start: tf!.departureTime,
        end: tf!.endTime,
        metadata: { requiresManualTimeReview: true },
      },
    });
    expect(item.event.end).toBeNull();
  });
});
