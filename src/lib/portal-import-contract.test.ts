import { describe, expect, it } from "vitest";
import { inferTravelFlightFromBlob } from "./travel-document-infer";
import {
  normalizePortalProposalEventItem,
  portalEventDateTimeIso,
  resolvePortalEventPersonMatch,
  travelFlightMetadataFromInference,
} from "./portal-import-person";

const BOARDING_SAMPLE = `
Boardingpass:
- JFK New York
- LHR London
- departure 08:30
- arrival 11:30
- passenger John Doe
- flight F2567
`;

describe("portal import event contract (boarding pass)", () => {
  it("personId null, personMatchStatus, sourceKind, requiresPerson, travel.arrivalTime, end uses arrival", () => {
    const tf = inferTravelFlightFromBlob(BOARDING_SAMPLE);
    expect(tf).not.toBeNull();

    const date = "2025-06-10";
    const personResolution = resolvePortalEventPersonMatch({
      documentExtractedName: tf!.passengerName,
      knownPersons: [],
    });

    expect(personResolution.personId).toBeNull();
    expect(personResolution.personMatchStatus).toBe("unmatched_document_name");

    const travel = travelFlightMetadataFromInference(tf!);
    expect(travel.arrivalTime).toBe("11:30");

    const item = normalizePortalProposalEventItem({
      kind: "event",
      proposalId: "test-prop",
      sourceId: "test-src",
      originalSourceType: "pdf",
      confidence: 0.9,
      event: {
        date,
        personId: personResolution.personId,
        personMatchStatus: personResolution.personMatchStatus,
        sourceKind: "document_import",
        requiresPerson: false,
        documentExtractedPersonName: personResolution.documentExtractedPersonName,
        title: tf!.proposedTitle,
        start: tf!.departureTime,
        end: tf!.endTime,
        metadata: {
          inferredEndTime: tf!.inferredEndTime,
          endTimeSource: tf!.endTimeSource,
          travel,
          documentExtractedPersonName: personResolution.documentExtractedPersonName!,
          passengerName: tf!.passengerName!,
        },
      },
    });

    expect(item.event.personId).toBeNull();
    expect(item.event.personMatchStatus).toBe("unmatched_document_name");
    expect(item.event.requiresPerson).toBe(false);
    expect(item.event.sourceKind).toBe("document_import");
    expect(item.event.metadata?.travel?.arrivalTime).toBe("11:30");
    expect(item.event.end).toBe(portalEventDateTimeIso(date, "11:30"));
    expect(item.event.end).not.toBe(portalEventDateTimeIso(date, "09:30"));
  });

  it("matches known person when name equals displayName", () => {
    const r = resolvePortalEventPersonMatch({
      documentExtractedName: "John Doe",
      knownPersons: [{ personId: "child-1", displayName: "John Doe" }],
    });
    expect(r.personId).toBe("child-1");
    expect(r.personMatchStatus).toBe("matched");
  });
});
