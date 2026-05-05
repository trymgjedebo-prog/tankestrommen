import { describe, expect, it } from "vitest";
import { dedupePortalFlightDepartureArrivalEvents } from "./portal-flight-dedupe";

describe("dedupePortalFlightDepartureArrivalEvents", () => {
  it("slår sammen avreise- og ankomst-kandidat til én flyreise med riktig tittel og start/slutt", () => {
    const travelMeta = {
      type: "flight" as const,
      origin: "JFK",
      originCity: "New York",
      destination: "LHR",
      destinationCity: "London",
      flightNumber: "F2567" as string | null,
      passengerName: "John Doe" as string | null,
      departureTime: "08:30" as string | null,
      arrivalTime: null as string | null,
    };
    const items = [
      {
        kind: "event" as const,
        proposalId: "a",
        event: {
          date: "2025-06-10",
          title: "Flyreise New York–London – Avreise",
          start: "08:30",
          end: "08:30",
          metadata: { travel: { ...travelMeta } },
        },
      },
      {
        kind: "event" as const,
        proposalId: "b",
        event: {
          date: "2025-06-10",
          title: "Flyreise New York–London – Ankomst",
          start: "11:30",
          end: "12:30",
          metadata: {
            travel: {
              ...travelMeta,
              departureTime: null,
              arrivalTime: "11:30",
            },
          },
        },
      },
    ];

    const out = dedupePortalFlightDepartureArrivalEvents(items);
    expect(out).toHaveLength(1);
    expect(out[0]!.event.title).toBe("Flyreise New York–London");
    expect(out[0]!.event.start).toBe("08:30");
    expect(out[0]!.event.end).toBe("11:30");
    expect(out[0]!.event.metadata?.travel?.departureTime).toBe("08:30");
    expect(out[0]!.event.metadata?.travel?.arrivalTime).toBe("11:30");
  });

  it("bevarer ulike etapper med ulike ruter", () => {
    const a = {
      kind: "event" as const,
      proposalId: "1",
      event: {
        date: "2025-06-10",
        title: "Flyreise New York–London",
        start: "08:30",
        end: "11:30",
        metadata: {
          travel: {
            type: "flight" as const,
            origin: "JFK",
            originCity: "New York",
            destination: "LHR",
            destinationCity: "London",
            flightNumber: "F1" as string | null,
            passengerName: "P" as string | null,
            departureTime: "08:30",
            arrivalTime: "11:30",
          },
        },
      },
    };
    const b = {
      kind: "event" as const,
      proposalId: "2",
      event: {
        date: "2025-06-10",
        title: "Flyreise London–Oslo",
        start: "14:00",
        end: "17:00",
        metadata: {
          travel: {
            type: "flight" as const,
            origin: "LHR",
            originCity: "London",
            destination: "OSL",
            destinationCity: "Oslo",
            flightNumber: "F2" as string | null,
            passengerName: "P" as string | null,
            departureTime: "14:00",
            arrivalTime: "17:00",
          },
        },
      },
    };
    const out = dedupePortalFlightDepartureArrivalEvents([a, b]);
    expect(out).toHaveLength(2);
  });
});
