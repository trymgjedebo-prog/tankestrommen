/**
 * Vei 1, lag 1: isolert matcher (klassekode primært, trinn sekundært, trygg fallback).
 * VGS-først — ungdomsskole («10B») matcher ikke regexen ennå, men Ida velges korrekt BORT på
 * VGS-dokumenter via trinn.
 */
import { describe, expect, it } from "vitest";
import {
  matchDocumentToChild,
  type MatchChild,
} from "@/lib/match-document-to-child";
import { countDistinctClassCodes, extractClassCodes } from "@/lib/school-class-schedule";
import type { SchoolProfileGradeBand } from "@/lib/types";

function child(personId: string, classCode: string, gradeBand?: SchoolProfileGradeBand): MatchChild {
  return {
    personId,
    classCode,
    schoolProfile: gradeBand ? { gradeBand, weekdays: {} } : null,
  };
}

const STELLAN = child("p-stellan", "2STC", "vg2"); // VGS
const IDA = child("p-ida", "10B", "8-10"); // ungdomsskole

describe("extractClassCodes / countDistinctClassCodes (ingen count-regresjon)", () => {
  it("countDistinctClassCodes = extractClassCodes(...).length (uendret tall)", () => {
    const text = "Tid | 2STA | 2STB | 2STC: prøve, og 2sta igjen";
    expect(extractClassCodes(text)).toEqual(["2sta", "2stb", "2stc"]);
    expect(countDistinctClassCodes(text)).toBe(3); // distinkt: 2STA/2STB/2STC (2sta gjentatt teller ikke)
  });
  it("normaliserer koder (casing/whitespace) likt på begge sider", () => {
    expect(extractClassCodes(" 2stc og 2 STC ")).toEqual(["2stc"]);
  });
});

describe("matchDocumentToChild", () => {
  it("1) dokument med literal 2STC → matched Stellan (primær)", () => {
    expect(matchDocumentToChild("Info til 2STC om muntlig eksamen", [STELLAN, IDA])).toEqual({
      personId: "p-stellan",
      status: "matched",
    });
  });

  it("2) eksamensplan «2STA–2STF» (range, ingen literal 2STC) → matched Stellan (sekundær: trinn vg2)", () => {
    expect(
      matchDocumentToChild("Eksamen og avslutning for 2STA–2STF i uke 25", [STELLAN, IDA]),
    ).toEqual({ personId: "p-stellan", status: "matched" });
  });

  it("3) to VGS-søsken begge literalt i dokumentet → ambiguous (primær ≥2)", () => {
    const p1 = child("p1", "2STC", "vg2");
    const p2 = child("p2", "1IMB", "vg1");
    expect(matchDocumentToChild("Felles møte for 2STC og 1IMB", [p1, p2])).toEqual({
      personId: null,
      status: "ambiguous",
    });
  });

  it("4) dokument uten klassekode → no_signal", () => {
    expect(matchDocumentToChild("Skolen er stengt fredag pga. planleggingsdag", [STELLAN, IDA])).toEqual({
      personId: null,
      status: "no_signal",
    });
  });

  it("5) klasse ingen barn har (3PBA, vg3) → no_signal", () => {
    expect(matchDocumentToChild("Tur for 3PBA torsdag", [STELLAN, IDA])).toEqual({
      personId: null,
      status: "no_signal",
    });
  });

  it("6a) tomt children-liste → no_signal", () => {
    expect(matchDocumentToChild("Info til 2STC", [])).toEqual({
      personId: null,
      status: "no_signal",
    });
  });

  it("6b) ett barn, dokument nevner barnets klasse → matched", () => {
    expect(matchDocumentToChild("Prøve for 2STC mandag", [STELLAN])).toEqual({
      personId: "p-stellan",
      status: "matched",
    });
  });

  it("6c) ett barn, dokument tydelig annen klasse/trinn → no_signal (ikke tilordne fremmed dok)", () => {
    expect(matchDocumentToChild("Tur for 3PBA torsdag", [STELLAN])).toEqual({
      personId: null,
      status: "no_signal",
    });
  });

  it("7) normalisering konsistent: barn «2STC», dokument « 2stc » → matched", () => {
    expect(matchDocumentToChild("har  2stc  møte", [child("p", "2STC")])).toEqual({
      personId: "p",
      status: "matched",
    });
    // og omvendt casing: barn lowercase, dokument uppercase
    expect(matchDocumentToChild("Info 2STC", [child("p", "2stc")])).toEqual({
      personId: "p",
      status: "matched",
    });
  });

  it("VGS-utelukkelse: Ida (10B) velges aldri på et VGS-dokument", () => {
    const r = matchDocumentToChild("Eksamen for 2STA–2STF", [STELLAN, IDA]);
    expect(r.personId).not.toBe("p-ida");
  });

  it("ignorerer barn med tom/ugyldig classCode", () => {
    const bad = child("p-bad", "   ");
    expect(matchDocumentToChild("Info til 2STC", [bad, STELLAN])).toEqual({
      personId: "p-stellan",
      status: "matched",
    });
  });
});
