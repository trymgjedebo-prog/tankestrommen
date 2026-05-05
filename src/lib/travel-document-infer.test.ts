import { describe, expect, it } from "vitest";
import {
  inferTravelFlightFromBlob,
  inferTravelFlightsFromBlob,
} from "./travel-document-infer";

describe("inferTravelFlightsFromBlob / inferTravelFlightFromBlob", () => {
  it("Test 1: én etappe — én hendelse, by–by-tittel, avgang→ankomst som start/slutt", () => {
    const blob = `
Boardingpass:
- JFK New York
- LHR London
- departure 08:30
- arrival 11:30
- passenger John Doe
- flight F2567
`;
    const legs = inferTravelFlightsFromBlob(blob);
    expect(legs).toHaveLength(1);
    const r = legs[0]!;
    expect(r.proposedTitle).toBe("Flyreise New York–London");
    expect(r.proposedTitle).not.toMatch(/avreise|ankomst|analyse|flybillett/i);
    expect(r.departureTime).toBe("08:30");
    expect(r.endTime).toBe("11:30");
    expect(r.inferredEndTime).toBe(false);
    expect(r.endTimeSource).toBe("explicit_arrival_time");
    expect(r.origin).toBe("JFK");
    expect(r.destination).toBe("LHR");
    expect(r.passengerName).toBe("John Doe");
    expect(r.flightNumber).toBe("F2567");

    const one = inferTravelFlightFromBlob(blob);
    expect(one).toEqual(r);
  });

  it("Test 2: dato/avgang/ankomst OK, ingen lesbar rute — «Flyreise», ikke «10–10» eller flybillett-språk", () => {
    const blob = `
Boarding pass
e-ticket
Dato: 10. juni 2025
departure 08:30
arrival 11:30
`;
    const legs = inferTravelFlightsFromBlob(blob);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.proposedTitle).toBe("Flyreise");
    expect(legs[0]!.proposedTitle).not.toMatch(/fra\s+10|til\s+10|flybillett/i);
    expect(legs[0]!.origin).toBe("Ukjent");
    expect(legs[0]!.destination).toBe("Ukjent");
  });

  it("Test 3: to flyetapper — to leg-inferenser (ikke fire)", () => {
    const blob = `
Boarding pass
- JFK New York
- LHR London
- LHR London
- OSL Oslo
flight SK99
passenger Jane Doe
departure 08:30
arrival 11:30
departure 14:00
arrival 17:00
`;
    const legs = inferTravelFlightsFromBlob(blob);
    expect(legs).toHaveLength(2);
    expect(legs[0]!.proposedTitle).toBe("Flyreise New York–London");
    expect(legs[1]!.proposedTitle).toBe("Flyreise London–Oslo");
    expect(legs[0]!.departureTime).toBe("08:30");
    expect(legs[0]!.endTime).toBe("11:30");
    expect(legs[1]!.departureTime).toBe("14:00");
    expect(legs[1]!.endTime).toBe("17:00");
  });

  it("does not invent end time when arrival missing — manual review", () => {
    const blob = `
Boarding pass
JFK Oslo
LHR London
departure 10:00
gate A12
flight SK1234
`;
    const r = inferTravelFlightFromBlob(blob);
    expect(r).not.toBeNull();
    expect(r!.departureTime).toBe("10:00");
    expect(r!.inferredEndTime).toBe(false);
    expect(r!.endTimeSource).toBe("missing_or_unreadable");
    expect(r!.startTimeSource).toBe("explicit");
    expect(r!.requiresManualTimeReview).toBe(true);
    expect(r!.arrivalTime).toBeNull();
    expect(r!.endTime).toBeNull();
  });

  it("still returns inference when departure time missing but flight is clear", () => {
    const blob = `
Boarding pass
- JFK New York
- LHR London
flight F2567
gate B12
`;
    const r = inferTravelFlightFromBlob(blob);
    expect(r).not.toBeNull();
    expect(r!.departureTime).toBeNull();
    expect(r!.endTime).toBeNull();
    expect(r!.startTimeSource).toBe("missing_or_unreadable");
    expect(r!.endTimeSource).toBe("missing_or_unreadable");
    expect(r!.requiresManualTimeReview).toBe(true);
  });

  it("does not treat boarding time as arrival", () => {
    const blob = `
Boarding pass
JFK New York
LHR London
departure 08:30
boarding 08:00
arrival 11:30
`;
    const r = inferTravelFlightFromBlob(blob);
    expect(r).not.toBeNull();
    expect(r!.endTime).toBe("11:30");
    expect(r!.inferredEndTime).toBe(false);
  });
});
