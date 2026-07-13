/**
 * Unit-tester for normalizeClassScheduleEntriesRaw (rå klasse-/puljeplan). Deterministisk,
 * ingen live-LLM. Låser: klassekode-normalisering/sortering/dedup, dato/tid/rom/tekst/confidence,
 * behold-regel (≥1 klassekode + ≥1 payload), dedup av identiske, og at motstridende tider beholdes.
 */
import { describe, expect, it } from "vitest";
import { normalizeClassScheduleEntriesRaw } from "@/lib/class-schedule-normalize";

describe("normalizeClassScheduleEntriesRaw", () => {
  it("1. én klasse med komplett struktur → full normalisert oppføring", () => {
    const out = normalizeClassScheduleEntriesRaw([
      {
        classCodes: ["2STC"],
        date: "2026-06-18",
        dayLabel: "Torsdag",
        activityTitle: "Bokinnlevering",
        start: "10:30",
        end: "11:00",
        room: "rom 332-50",
        teacher: "Marte Hermanrud",
        sourceText: "2STC 10.30-11.00, rom 332-50",
        confidence: 0.9,
      },
    ]);
    expect(out).toEqual([
      {
        date: "2026-06-18",
        dayLabel: "Torsdag",
        activityTitle: "Bokinnlevering",
        classCodes: ["2STC"],
        groupLabel: null,
        start: "10:30",
        end: "11:00",
        room: "332-50", // «rom »-prefiks strippet
        teacher: "Marte Hermanrud",
        sourceText: "2STC 10.30-11.00, rom 332-50",
        confidence: 0.9,
      },
    ]);
  });

  it("2. flere klasser i samme pulje → sorterte, dedupliserte koder, én oppføring", () => {
    const out = normalizeClassScheduleEntriesRaw([
      {
        classCodes: ["2STE", "2STA", "2STC", "2sta"], // usortert + duplikat (2sta≡2STA)
        groupLabel: "Pulje 1",
        start: "10:00",
        end: "11:00",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out![0].classCodes).toEqual(["2STA", "2STC", "2STE"]);
    expect(out![0].groupLabel).toBe("Pulje 1");
  });

  it("3. flere klasser med ulike tider → alle bevares separat", () => {
    const out = normalizeClassScheduleEntriesRaw([
      { classCodes: ["2STA"], activityTitle: "Bokinnlevering", start: "13:10", end: "13:40" },
      { classCodes: ["2STC"], activityTitle: "Bokinnlevering", start: "10:30", end: "11:00" },
      { classCodes: ["2STE"], activityTitle: "Bokinnlevering", start: "09:15", end: "09:45" },
    ]);
    expect(out).toHaveLength(3);
    expect(out!.map((e) => e.classCodes[0])).toEqual(["2STA", "2STC", "2STE"]);
  });

  it("4. samme klasse med to aktiviteter samme dag → to separate oppføringer", () => {
    const out = normalizeClassScheduleEntriesRaw([
      { classCodes: ["2STC"], date: "2026-06-18", activityTitle: "Bokinnlevering", start: "10:30" },
      { classCodes: ["2STC"], date: "2026-06-18", activityTitle: "Matteeksamen", start: "12:00", end: "14:00" },
    ]);
    expect(out).toHaveLength(2);
    expect(out!.map((e) => e.activityTitle)).toEqual(["Bokinnlevering", "Matteeksamen"]);
  });

  it("5. manglende sluttid → start beholdes, end null, oppføring beholdes", () => {
    const out = normalizeClassScheduleEntriesRaw([
      { classCodes: ["2STC"], activityTitle: "Oppmøte", start: "10:30" },
    ]);
    expect(out).toHaveLength(1);
    expect(out![0].start).toBe("10:30");
    expect(out![0].end).toBeNull();
  });

  it("6. ugyldig klokkeslett → feltet null, annen gyldig struktur beholdes", () => {
    const out = normalizeClassScheduleEntriesRaw([
      { classCodes: ["2STC"], activityTitle: "Prøve", start: "25:99", end: "11:00" },
    ]);
    expect(out).toHaveLength(1);
    expect(out![0].start).toBeNull();
    expect(out![0].end).toBe("11:00");
    expect(out![0].activityTitle).toBe("Prøve");
  });

  it("7. ugyldige og dupliserte klassekoder → droppes/normaliseres/sorteres/dedupliseres", () => {
    const out = normalizeClassScheduleEntriesRaw([
      {
        classCodes: ["Pulje 1", "hei", "2STB", "2STA", "2stb", "", "2STA og 2STB"],
        start: "09:00",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out![0].classCodes).toEqual(["2STA", "2STB"]); // søppel/pulje/flerkode/tom droppet
  });

  it("8. ingen gyldig klassekode → oppføringen droppes", () => {
    expect(
      normalizeClassScheduleEntriesRaw([{ classCodes: ["Pulje 1", "auditoriet"], start: "09:00" }]),
    ).toBeUndefined();
  });

  it("9. kun klassekode, ingen meningsfull payload → oppføringen droppes", () => {
    expect(
      normalizeClassScheduleEntriesRaw([{ classCodes: ["2STC"], confidence: 0.9 }]),
    ).toBeUndefined();
  });

  it("10. identiske duplikater → én normalisert oppføring", () => {
    const row = { classCodes: ["2STC"], activityTitle: "Bokinnlevering", start: "10:30", end: "11:00" };
    const out = normalizeClassScheduleEntriesRaw([row, { ...row }]);
    expect(out).toHaveLength(1);
  });

  it("11. motstridende tider (samme dag/aktivitet/klasse) → begge bevares", () => {
    const out = normalizeClassScheduleEntriesRaw([
      { classCodes: ["2STC"], date: "2026-06-18", activityTitle: "Bokinnlevering", start: "10:30", end: "11:00" },
      { classCodes: ["2STC"], date: "2026-06-18", activityTitle: "Bokinnlevering", start: "12:00", end: "12:30" },
    ]);
    expect(out).toHaveLength(2);
    expect(out!.map((e) => e.start)).toEqual(["10:30", "12:00"]);
  });

  it("12. confidence: >1 → 1, <0 → 0, ugyldig/manglende → 0", () => {
    const hi = normalizeClassScheduleEntriesRaw([{ classCodes: ["2STA"], start: "09:00", confidence: 1.5 }]);
    const lo = normalizeClassScheduleEntriesRaw([{ classCodes: ["2STA"], start: "09:00", confidence: -0.5 }]);
    const bad = normalizeClassScheduleEntriesRaw([{ classCodes: ["2STA"], start: "09:00", confidence: "abc" }]);
    const missing = normalizeClassScheduleEntriesRaw([{ classCodes: ["2STA"], start: "09:00" }]);
    expect(hi![0].confidence).toBe(1);
    expect(lo![0].confidence).toBe(0);
    expect(bad![0].confidence).toBe(0);
    expect(missing![0].confidence).toBe(0);
  });

  it("13. originaltekst: innhold og tegnsetting bevart etter trimming", () => {
    const out = normalizeClassScheduleEntriesRaw([
      {
        classCodes: ["2STC"],
        activityTitle: "  Bokinnlevering  ",
        sourceText: "  2STC: 10.30–11.00, rom 332-50 (m/ lærer)  ",
      },
    ]);
    expect(out![0].activityTitle).toBe("Bokinnlevering");
    expect(out![0].sourceText).toBe("2STC: 10.30–11.00, rom 332-50 (m/ lærer)");
  });

  it("rekkefølge-uavhengig: ulike inputrekkefølger → identisk normalisert resultat", () => {
    const a = {
      classCodes: ["2STC"],
      date: "2026-06-18",
      activityTitle: "Matteeksamen",
      start: "10:00",
      end: "12:00",
      room: "Aud",
    };
    const b = {
      classCodes: ["2STE", "2STA", "2sta"], // pulje, usortert + duplikat
      date: "2026-06-18",
      activityTitle: "Bokinnlevering",
      groupLabel: "Pulje 1",
      start: "09:00",
      end: "09:30",
    };
    const c = {
      classCodes: ["2STB"],
      date: "2026-06-19", // annen dag
      activityTitle: "Utflukt",
      sourceText: "2STB heldags utflukt",
    };
    const abc = normalizeClassScheduleEntriesRaw([a, b, c]);
    const cab = normalizeClassScheduleEntriesRaw([c, a, b]);
    const bca = normalizeClassScheduleEntriesRaw([b, c, a]);
    expect(abc).toEqual(cab);
    expect(abc).toEqual(bca);
    expect(abc).toHaveLength(3); // tre reelt forskjellige aktiviteter, stabil unik plassering
  });

  it("rekkefølge-uavhengig OG motstridende tider bevares begge uansett rekkefølge", () => {
    const x = { classCodes: ["2STC"], date: "2026-06-18", activityTitle: "Bokinnlevering", start: "10:30", end: "11:00" };
    const y = { classCodes: ["2STC"], date: "2026-06-18", activityTitle: "Bokinnlevering", start: "12:00", end: "12:30" };
    const xy = normalizeClassScheduleEntriesRaw([x, y]);
    const yx = normalizeClassScheduleEntriesRaw([y, x]);
    expect(xy).toEqual(yx); // rekkefølge-uavhengig
    expect(xy).toHaveLength(2); // begge motstridende tider beholdt
    expect(xy!.map((e) => e.start)).toEqual(["10:30", "12:00"]);
  });

  it("ugyldig dato (30. feb) → null; ikke-ISO → null", () => {
    const out = normalizeClassScheduleEntriesRaw([
      { classCodes: ["2STC"], date: "2026-02-30", activityTitle: "X" },
      { classCodes: ["2STA"], date: "18. juni 2026", activityTitle: "Y" },
    ]);
    expect(out![0].date).toBeNull();
    expect(out![1].date).toBeNull();
  });

  it("ikke-array / tom / kun-ugyldige → undefined", () => {
    expect(normalizeClassScheduleEntriesRaw(undefined)).toBeUndefined();
    expect(normalizeClassScheduleEntriesRaw(null)).toBeUndefined();
    expect(normalizeClassScheduleEntriesRaw([])).toBeUndefined();
    expect(normalizeClassScheduleEntriesRaw("2STC")).toBeUndefined();
    expect(normalizeClassScheduleEntriesRaw([{ classCodes: [] }, 42, "x"])).toBeUndefined();
  });
});
