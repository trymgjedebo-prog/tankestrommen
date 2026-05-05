import { describe, expect, it } from "vitest";
import { inferTravelFlightFromBlob } from "./travel-document-infer";

describe("inferTravelFlightFromBlob", () => {
  it("boarding pass: departure, arrival, IATA, passenger, flight number", () => {
    const blob = `
Boardingpass:
- JFK New York
- LHR London
- departure 08:30
- arrival 11:30
- passenger John Doe
- flight F2567
`;
    const r = inferTravelFlightFromBlob(blob);
    expect(r).not.toBeNull();
    expect(r!.proposedTitle).toBe("Flybillett fra New York til London – Avreise");
    expect(r!.departureTime).toBe("08:30");
    expect(r!.endTime).toBe("11:30");
    expect(r!.inferredEndTime).toBe(false);
    expect(r!.endTimeSource).toBe("explicit_arrival_time");
    expect(r!.origin).toBe("JFK");
    expect(r!.destination).toBe("LHR");
    expect(r!.passengerName).toBe("John Doe");
    expect(r!.flightNumber).toBe("F2567");
  });

  it("uses fallback end when arrival missing", () => {
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
    expect(r!.inferredEndTime).toBe(true);
    expect(r!.endTimeSource).toBe("fallback_duration");
    expect(r!.arrivalTime).toBeNull();
    expect(r!.endTime).toBe("11:30");
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
