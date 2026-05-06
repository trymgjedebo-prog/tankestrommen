import { describe, expect, it } from "vitest";
import {
  buildCalendarFlightTitle,
  inferTravelFlightFromBlob,
  inferTravelFlightsFromBlob,
} from "./travel-document-infer";

describe("buildCalendarFlightTitle", () => {
  it("never uses month/weekday pseudo-IATA as route (JUN–JUN → Flyreise)", () => {
    expect(buildCalendarFlightTitle(null, null, "JUN", "JUN")).toBe("Flyreise");
    expect(buildCalendarFlightTitle(null, null, "MON", "TUE")).toBe("Flyreise");
  });

  it("uses real IATA when codes are safe", () => {
    expect(buildCalendarFlightTitle(null, null, "JFK", "LHR")).toBe("Flyreise JFK–LHR");
  });

  it("same city both sides → Flyreise", () => {
    expect(buildCalendarFlightTitle("London", "London", "LHR", "LHR")).toBe("Flyreise");
  });

  it("prefers cities over IATA when both usable", () => {
    expect(buildCalendarFlightTitle("New York", "London", "JFK", "LHR")).toBe(
      "Flyreise New York–London",
    );
  });
});

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
    expect(r!.durationMinutes).toBeNull();
  });

  it("computes end from explicit duration when arrival is missing", () => {
    const blob = `
Boarding pass
- OSL Oslo
- LHR London
departure 05:00
flight time 3:30
`;
    const r = inferTravelFlightFromBlob(blob);
    expect(r).not.toBeNull();
    expect(r!.departureTime).toBe("05:00");
    expect(r!.arrivalTime).toBeNull();
    expect(r!.durationMinutes).toBe(210);
    expect(r!.endTime).toBe("08:30");
    expect(r!.endTimeSource).toBe("computed_from_duration");
    expect(r!.requiresManualTimeReview).toBe(false);
  });

  it("computed duration can pass midnight", () => {
    const blob = `
Boarding pass
- OSL Oslo
- AMS Amsterdam
departure 22:45
varighet 2 timer
`;
    const r = inferTravelFlightFromBlob(blob);
    expect(r).not.toBeNull();
    expect(r!.departureTime).toBe("22:45");
    expect(r!.durationMinutes).toBe(120);
    expect(r!.endTime).toBe("00:45");
    expect(r!.endNextDay).toBe(true);
    expect(r!.endTimeSource).toBe("computed_from_duration");
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

  it("ignores pseudo-IATA month tokens in glob — ikke Flyreise JUN–JUN", () => {
    const blob = `
Boarding pass
e-ticket
JUN JUN
departure 08:30
arrival 11:30
flight F100
`;
    const legs = inferTravelFlightsFromBlob(blob);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.proposedTitle).toBe("Flyreise");
    expect(legs[0]!.proposedTitle).not.toMatch(/JUN/i);
  });

  it("saniterer byfelt: London – Ankomst til LHR → tittel med London", () => {
    const blob = `
Boarding pass
- JFK New York
- LHR London – Ankomst til LHR
departure 09:00
arrival 12:00
`;
    const r = inferTravelFlightFromBlob(blob);
    expect(r).not.toBeNull();
    expect(r!.proposedTitle).toBe("Flyreise New York–London");
    expect(r!.proposedTitle).not.toMatch(/ankomst|billett|boarding/i);
  });
});
