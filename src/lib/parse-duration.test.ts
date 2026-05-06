import { describe, expect, it } from "vitest";
import { isUncertainDurationContext, parseDurationMinutes } from "./parse-duration";

describe("parseDurationMinutes", () => {
  it("parser vanlige norsk/engelske varianter", () => {
    expect(parseDurationMinutes("varer 45 minutter")).toBe(45);
    expect(parseDurationMinutes("45 min på økta")).toBeNull();
    expect(parseDurationMinutes("økta varer 45 min")).toBe(45);
    expect(parseDurationMinutes("flytid 1 time")).toBe(60);
    expect(parseDurationMinutes("varighet 1 t")).toBe(60);
    expect(parseDurationMinutes("kampen varer 1 time og 30 minutter")).toBe(90);
    expect(parseDurationMinutes("flytid 3h 30m")).toBe(210);
    expect(parseDurationMinutes("duration 3:30 for flight")).toBe(210);
    expect(parseDurationMinutes("varer 3,5 timer")).toBe(210);
    expect(parseDurationMinutes("duration 3.5 hours")).toBe(210);
    expect(parseDurationMinutes("en halv time med oppvarming")).toBe(30);
    expect(parseDurationMinutes("økta er halvannen time")).toBe(90);
    expect(parseDurationMinutes("tre og en halv time")).toBe(210);
  });

  it("returnerer null ved utydelig varighet", () => {
    expect(parseDurationMinutes("det kan ta litt tid")).toBeNull();
    expect(isUncertainDurationContext("det kan ta litt tid")).toBe(true);
  });
});
