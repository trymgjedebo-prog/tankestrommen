import { describe, expect, it } from "vitest";
import { resolveNonFlightEventTimes, textHasActivityClockWindowCue } from "./event-time-resolve";

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
    expect(r.timePrecision).toBe("exact");
  });

  it("mellom kl. … og … → time_window (ikke eksakt intervall-semantikk)", () => {
    const text = "Dugnad mellom kl. 10:00 og 12:00.";
    const r = resolveNonFlightEventTimes({ timeField: null, contextBlob: text });
    expect(r.start).toBe("10:00");
    expect(r.end).toBe("12:00");
    expect(r.timePrecision).toBe("time_window");
    expect(r.startTimeSource).toBe("explicit");
    expect(r.endTimeSource).toBe("explicit");
  });

  it("mellom kl. 10 og 12 (uten minutter) → time_window", () => {
    const r = resolveNonFlightEventTimes({
      timeField: "10:00",
      contextBlob: "Dugnad mellom kl. 10 og 12.",
    });
    expect(r.start).toBe("10:00");
    expect(r.end).toBe("12:00");
    expect(r.timePrecision).toBe("time_window");
  });

  it("«mellom … og …» fordelt på to linjer → time_window (kollapset blob)", () => {
    const blob = "Lørdag dugnad på klubbhuset.\nmellom kl. 10:00 og\n12:00 — ta med hansker.";
    const r = resolveNonFlightEventTimes({
      timeField: "10:00",
      contextBlob: blob,
      scheduleDayLabel: "lørdag",
    });
    expect(r.end).toBe("12:00");
    expect(r.timePrecision).toBe("time_window");
  });

  it("dugnad: start i timefelt + «ferdig kl.» slutt → exact blir time_window (dugnad-semantikk)", () => {
    const r = resolveNonFlightEventTimes({
      timeField: "10:00",
      contextBlob: "Lørdag: Dugnad på klubbhuset. Vi er ferdige kl. 12:00.",
      scheduleDayLabel: "lørdag",
    });
    expect(r.end).toBe("12:00");
    expect(r.timePrecision).toBe("time_window");
  });

  it("klubbhus + bidra (uten «dugnad») + ferdig kl. → time_window", () => {
    const r = resolveNonFlightEventTimes({
      timeField: "10:00",
      contextBlob: "Lørdag på klubbhuset. Oppfordring til å bidra. Vi er ferdige kl. 12:00.",
      scheduleDayLabel: "lørdag",
    });
    expect(r.end).toBe("12:00");
    expect(r.timePrecision).toBe("time_window");
  });

  it("kl. 10:00–12:00 i fri tekst → time_window", () => {
    const r = resolveNonFlightEventTimes({
      timeField: null,
      contextBlob: "Møt opp ca. kl. 10:00–12:00.",
    });
    expect(r.start).toBe("10:00");
    expect(r.end).toBe("12:00");
    expect(r.timePrecision).toBe("time_window");
  });

  it("10:00 til 12:00 (uten mellom/fra) → time_window", () => {
    const r = resolveNonFlightEventTimes({
      timeField: null,
      contextBlob: "Dugnad kl. 10:00 til 12:00 på klubbhuset.",
    });
    expect(r.start).toBe("10:00");
    expect(r.end).toBe("12:00");
    expect(r.timePrecision).toBe("time_window");
  });

  it("valgfritt møte med minutter på samme linje → ingen beregnet slutt", () => {
    const r = resolveNonFlightEventTimes({
      timeField: "19:00",
      contextBlob: "Valgfritt foreldremøte (45 minutter).",
    });
    expect(r.start).toBe("19:00");
    expect(r.end).toBeNull();
    expect(r.timePrecision).toBe("start_only");
  });

  it("foreldremøte med «ca.» foran varighet → ikke beregnet slutt (start_only)", () => {
    const r = resolveNonFlightEventTimes({
      timeField: "19:00",
      contextBlob:
        "Fredag 13. juni 2026 kl. 19:00: Valgfritt foreldremøte om vaktliste (ca. 45 minutter).",
    });
    expect(r.start).toBe("19:00");
    expect(r.end).toBeNull();
    expect(r.timePrecision).toBe("start_only");
  });

  it("kun én oppgitt klokkeslett → start_only", () => {
    const r = resolveNonFlightEventTimes({
      timeField: null,
      contextBlob: "Trening starter kl. 18:30.",
    });
    expect(r.start).toBe("18:30");
    expect(r.end).toBeNull();
    expect(r.timePrecision).toBe("start_only");
  });

  it("flere dager i samme blob: varighet fra forrige dag skal ikke gi sluttid for neste dags start", () => {
    const blob = `Fredag 13. juni 2026 kl. 19:00: Møte (ca. 45 minutter).
Lørdag 14. juni 2026: Dugnad på klubbhuset. Oppfordring til alle.`;
    const r = resolveNonFlightEventTimes({ timeField: "10:00", contextBlob: blob });
    expect(r.start).toBe("10:00");
    expect(r.end).toBeNull();
    expect(r.endTimeSource).toBe("missing_or_unreadable");
    expect(r.timePrecision).toBe("start_only");
  });

  it("samme blob som over, men med mellom-linje → time_window (vindu overstyrer enkelt startfelt)", () => {
    const blob = `Fredag 13. juni 2026 kl. 19:00: Møte (ca. 45 minutter).
Lørdag 14. juni 2026: Dugnad på klubbhuset mellom kl. 10:00 og 12:00.`;
    const r = resolveNonFlightEventTimes({ timeField: "10:00", contextBlob: blob });
    expect(r.start).toBe("10:00");
    expect(r.end).toBe("12:00");
    expect(r.timePrecision).toBe("time_window");
  });

  it("schedule.time med «til» mellom klokkeslett → time_window", () => {
    const r = resolveNonFlightEventTimes({
      timeField: "10:00 til 12:00",
      contextBlob: "",
    });
    expect(r.start).toBe("10:00");
    expect(r.end).toBe("12:00");
    expect(r.timePrecision).toBe("time_window");
  });

  it("schedule.time med em dash (—) eller unicode-minus (−) → time_window", () => {
    const em = resolveNonFlightEventTimes({ timeField: "10:00—12:00", contextBlob: "" });
    expect(em.timePrecision).toBe("time_window");
    expect(em.start).toBe("10:00");
    expect(em.end).toBe("12:00");
    const uni = resolveNonFlightEventTimes({ timeField: "10:00\u221212:00", contextBlob: "" });
    expect(uni.timePrecision).toBe("time_window");
    expect(uni.end).toBe("12:00");
  });

  it("flerdagers blob: vindu på annen ukedag overstyrer ikke dagens tid uten scheduleDayLabel-match", () => {
    const blob = `Fredag 13. juni kl. 19:00 Valgfritt møte.
Lørdag 14. juni mellom kl. 10:00 og 12:00 dugnad.`;
    const fredag = resolveNonFlightEventTimes({
      timeField: "19:00",
      contextBlob: blob,
      scheduleDayLabel: "fredag",
    });
    expect(fredag.start).toBe("19:00");
    expect(fredag.end).toBeNull();
    expect(fredag.timePrecision).toBe("start_only");
    const lordag = resolveNonFlightEventTimes({
      timeField: "10:00",
      contextBlob: blob,
      scheduleDayLabel: "lørdag",
    });
    expect(lordag.start).toBe("10:00");
    expect(lordag.end).toBe("12:00");
    expect(lordag.timePrecision).toBe("time_window");
  });

  it("énn linje med både fredag og lørdag: lørdag plukker mellom-vindu; fredag arver ikke", () => {
    const blob =
      "Fredag 13. juni kl. 19:00 valgfritt møte. Lørdag 14. juni dugnad mellom kl. 10:00 og 12:00.";
    const fredag = resolveNonFlightEventTimes({
      timeField: "19:00",
      contextBlob: blob,
      scheduleDayLabel: "fredag",
    });
    expect(fredag.start).toBe("19:00");
    expect(fredag.end).toBeNull();
    expect(fredag.timePrecision).toBe("start_only");
    const lordag = resolveNonFlightEventTimes({
      timeField: "10:00",
      contextBlob: blob,
      scheduleDayLabel: "lørdag",
    });
    expect(lordag.start).toBe("10:00");
    expect(lordag.end).toBe("12:00");
    expect(lordag.timePrecision).toBe("time_window");
  });
});

describe("textHasActivityClockWindowCue", () => {
  it("gjenkjenner mellom kl. … og …", () => {
    expect(textHasActivityClockWindowCue("dugnad mellom kl. 10:00 og 12:00")).toBe(true);
  });
  it("gjenkjenner klokke-intervall med tankestrek", () => {
    expect(textHasActivityClockWindowCue("møte kl. 10:00–12:00")).toBe(true);
  });
  it("gjenkjenner til-form", () => {
    expect(textHasActivityClockWindowCue("fra 10:00 til 12:00")).toBe(true);
  });
  it("«mellom» uten klokkeslett-vindu → false", () => {
    expect(textHasActivityClockWindowCue("Gi beskjed mellom venner")).toBe(false);
  });
});
