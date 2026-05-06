import { describe, expect, it } from "vitest";
import { resolveNonFlightEventTimes } from "./event-time-resolve";

describe("resolveNonFlightEventTimes", () => {
  it("flyavgang + flytid → beregnet slutt (Test 1)", () => {
    const text = "Flyet går 06:05. Flytid 3 timer 30 minutter.";
    const r = resolveNonFlightEventTimes({ timeField: null, contextBlob: text });
    expect(r.start).toBe("06:05");
    expect(r.end).toBe("09:35");
    expect(r.durationMinutes).toBe(210);
    expect(r.endTimeSource).toBe("computed_from_duration");
    expect(r.timeComputation?.formula).toBe("start + duration = end");
    expect(r.requiresManualTimeReview).toBe(false);
  });

  it("kampstart + varighet → slutt (Test 2)", () => {
    const text = "Kampen starter kl. 18:40 og varer 45 minutter.";
    const r = resolveNonFlightEventTimes({ timeField: null, contextBlob: text });
    expect(r.start).toBe("18:40");
    expect(r.end).toBe("19:25");
    expect(r.requiresManualTimeReview).toBe(false);
  });

  it("ferdig kl + varighet → beregnet start (Test 3)", () => {
    const text = "Vi er ferdige kl. 16:00. Økten varer 2 timer.";
    const r = resolveNonFlightEventTimes({ timeField: null, contextBlob: text });
    expect(r.end).toBe("16:00");
    expect(r.start).toBe("14:00");
    expect(r.startTimeSource).toBe("computed_from_duration");
    expect(r.durationMinutes).toBe(120);
    expect(r.requiresManualTimeReview).toBe(false);
  });

  it("sen kveld + varighet → slutt neste dag (Test 4)", () => {
    const text = "Avreise 22:45. Flytid 2 timer.";
    const r = resolveNonFlightEventTimes({ timeField: null, contextBlob: text });
    expect(r.start).toBe("22:45");
    expect(r.end).toBe("00:45");
    expect(r.endNextDay).toBe(true);
    expect(r.durationMinutes).toBe(120);
    expect(r.requiresManualTimeReview).toBe(false);
  });

  it("kun start, ingen varighet → slutt null, ikke +1t (Test 5)", () => {
    const text = "Start kl. 06:05";
    const r = resolveNonFlightEventTimes({ timeField: null, contextBlob: text });
    expect(r.start).toBe("06:05");
    expect(r.end).toBeNull();
    expect(r.endTimeSource).toBe("missing_or_unreadable");
    expect(r.requiresManualTimeReview).toBe(true);
  });

  it("start + slutt over midnatt → varighet og endNextDay", () => {
    const r = resolveNonFlightEventTimes({
      timeField: "22:45–00:45",
      contextBlob: "",
    });
    expect(r.start).toBe("22:45");
    expect(r.end).toBe("00:45");
    expect(r.endNextDay).toBe(true);
    expect(r.durationMinutes).toBe(120);
  });
});
