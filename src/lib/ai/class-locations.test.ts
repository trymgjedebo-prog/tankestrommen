/**
 * classLocations (per-klasse-lokasjon), unit-laget: normalizeClassLocationsRaw + whitelist-
 * innkoblingen i normalizeAIAnalysisResult. Kontrakt: classCode SOM-SKREVET på wire; rad
 * krever minst ett av room/teacher; dedup første-vinner; tomt → undefined (feltet utelates).
 */
import { describe, expect, it } from "vitest";
import {
  normalizeAIAnalysisResult,
  normalizeClassLocationsRaw,
} from "@/lib/ai/analyze-image";

describe("normalizeClassLocationsRaw", () => {
  it("gyldige rader beholdes med casing SOM-SKREVET (2STA, 10B, 10 B)", () => {
    expect(
      normalizeClassLocationsRaw([
        { classCode: "2STA", room: "332-40", teacher: "Andreas Vågen" },
        { classCode: "10B", room: "Gymsal" },
        { classCode: "10 B", teacher: "Kari" }, // dupliserer 10B normalisert → droppes (første vinner)
      ]),
    ).toEqual([
      { classCode: "2STA", room: "332-40", teacher: "Andreas Vågen" },
      { classCode: "10B", room: "Gymsal" },
    ]);
  });

  it("room-only og teacher-only beholdes; feltet som mangler UTELATES (ikke null)", () => {
    const rows = normalizeClassLocationsRaw([
      { classCode: "2STA", room: "332-40" },
      { classCode: "2STC", teacher: "Marte Hermanrud", room: null },
    ]);
    expect(rows).toEqual([
      { classCode: "2STA", room: "332-40" },
      { classCode: "2STC", teacher: "Marte Hermanrud" },
    ]);
    expect(rows![0]).not.toHaveProperty("teacher");
    expect(rows![1]).not.toHaveProperty("room");
  });

  it("rad uten både rom og lærer droppes; whitespace-verdier regnes som tomme", () => {
    expect(
      normalizeClassLocationsRaw([
        { classCode: "2STB" },
        { classCode: "2STD", room: "  ", teacher: "" },
        { classCode: "2STA", room: "A1" },
      ]),
    ).toEqual([{ classCode: "2STA", room: "A1" }]);
  });

  it("søppel-classCode droppes («hei», «rom 12», «Pulje 1», flere koder i én)", () => {
    expect(
      normalizeClassLocationsRaw([
        { classCode: "hei", room: "A" },
        { classCode: "rom 12", room: "A" },
        { classCode: "Pulje 1", room: "Auditoriet" },
        { classCode: "2STA og 2STB", room: "A" }, // to koder → ikke én rad per klasse
      ]),
    ).toBeUndefined();
  });

  it("dedup på normalisert kode — FØRSTE rad vinner", () => {
    expect(
      normalizeClassLocationsRaw([
        { classCode: "2STA", room: "Første" },
        { classCode: "2sta", room: "Andre" },
      ]),
    ).toEqual([{ classCode: "2STA", room: "Første" }]);
  });

  it("«rom »/«klasserom »-prefiks strippes fra room (konsistent bar kode); teacher urørt", () => {
    expect(
      normalizeClassLocationsRaw([
        { classCode: "2STA", room: "rom 332-40" },
        { classCode: "2STB", room: "klasserom A1" },
        { classCode: "2STC", room: "332-40" }, // uten prefiks → uendret
        { classCode: "2STD", room: "Rom 12" }, // case-insensitivt
      ]),
    ).toEqual([
      { classCode: "2STA", room: "332-40" },
      { classCode: "2STB", room: "A1" },
      { classCode: "2STC", room: "332-40" },
      { classCode: "2STD", room: "12" },
    ]);
  });

  it("room som BARE er «rom» → tomt etter strip → droppes (raden med, uten teacher)", () => {
    expect(
      normalizeClassLocationsRaw([
        { classCode: "2STA", room: "rom" }, // verken rom eller lærer igjen → raden droppes
        { classCode: "2STB", room: "rom", teacher: "Kari" }, // room droppes, teacher beholder raden
      ]),
    ).toEqual([{ classCode: "2STB", teacher: "Kari" }]);
  });

  it("ikke-array / tom / kun-ugyldige → undefined", () => {
    expect(normalizeClassLocationsRaw(undefined)).toBeUndefined();
    expect(normalizeClassLocationsRaw(null)).toBeUndefined();
    expect(normalizeClassLocationsRaw("2STA: rom 332-40")).toBeUndefined();
    expect(normalizeClassLocationsRaw([])).toBeUndefined();
    expect(normalizeClassLocationsRaw([{ room: "A" }, "tull", 42])).toBeUndefined();
  });
});

describe("normalizeAIAnalysisResult: classLocations-whitelist", () => {
  it("rå JSON MED classLocations → normalisert på resultatet (casing bevart)", () => {
    const r = normalizeAIAnalysisResult({
      title: "Rådgiveropplegg",
      classLocations: [
        { classCode: "2STA", room: "332-40", teacher: "Andreas Vågen" },
        { classCode: "ugyldig", room: "X" },
      ],
    });
    expect(r.classLocations).toEqual([
      { classCode: "2STA", room: "332-40", teacher: "Andreas Vågen" },
    ]);
  });

  it("rå JSON UTEN classLocations → feltet finnes IKKE på resultatet (null drift)", () => {
    const r = normalizeAIAnalysisResult({ title: "Vanlig beskjed" });
    expect(r.classLocations).toBeUndefined();
    expect(r).not.toHaveProperty("classLocations");
  });
});
