import { describe, expect, it } from "vitest";
import {
  parseRelevanceContextFromBody,
  relevanceOverlayOverride,
} from "./portal-import-person";
import type { SchoolWeeklyProfile } from "./types";

describe("parseRelevanceContextFromBody", () => {
  it("parser objekt med classCode (JSON-body)", () => {
    expect(parseRelevanceContextFromBody({ classCode: "2STC" })).toEqual({
      classCode: "2STC",
    });
  });

  it("parser JSON-streng (multipart-felt)", () => {
    expect(parseRelevanceContextFromBody('{"classCode":"2STC"}')).toEqual({
      classCode: "2STC",
    });
  });

  it("trimmer classCode", () => {
    expect(parseRelevanceContextFromBody({ classCode: "  2STC  " })).toEqual({
      classCode: "2STC",
    });
  });

  it("returnerer undefined for tomt/ugyldig", () => {
    expect(parseRelevanceContextFromBody(undefined)).toBeUndefined();
    expect(parseRelevanceContextFromBody({})).toBeUndefined();
    expect(parseRelevanceContextFromBody({ classCode: "" })).toBeUndefined();
    expect(parseRelevanceContextFromBody("ikke json")).toBeUndefined();
    expect(parseRelevanceContextFromBody([1, 2])).toBeUndefined();
  });
});

describe("parseRelevanceContextFromBody — schoolProfile (oppgave 9 steg 1)", () => {
  const fakeProfile = {
    gradeBand: "vg2",
    weekdays: { "0": { useSimpleDay: true, schoolStart: "08:30", schoolEnd: "14:00" } },
  } as unknown as SchoolWeeklyProfile;
  // Stub-validator (DI): bekrefter at en injisert validator KALLES og at resultatet bæres videre.
  const validate = (raw: unknown): SchoolWeeklyProfile | null =>
    raw && typeof raw === "object" ? fakeProfile : null;

  it("parser classCode + validert schoolProfile fra objekt", () => {
    expect(
      parseRelevanceContextFromBody(
        { classCode: "2STC", schoolProfile: { weekdays: {} } },
        validate,
      ),
    ).toEqual({ classCode: "2STC", schoolProfile: fakeProfile });
  });

  it("parser schoolProfile fra JSON-streng (multipart-felt)", () => {
    expect(
      parseRelevanceContextFromBody(
        JSON.stringify({ classCode: "2STC", schoolProfile: { weekdays: {} } }),
        validate,
      ),
    ).toEqual({ classCode: "2STC", schoolProfile: fakeProfile });
  });

  it("beholder konteksten når KUN schoolProfile finnes (uten classCode)", () => {
    expect(
      parseRelevanceContextFromBody({ schoolProfile: { weekdays: {} } }, validate),
    ).toEqual({ schoolProfile: fakeProfile });
  });

  it("ugyldig schoolProfile (validator → null) droppes; classCode beholdes", () => {
    const out = parseRelevanceContextFromBody(
      { classCode: "2STC", schoolProfile: "tull" },
      () => null,
    );
    expect(out).toEqual({ classCode: "2STC" });
    expect(out).not.toHaveProperty("schoolProfile");
  });

  it("uten injisert validator ignoreres schoolProfile (bakoverkompatibel)", () => {
    expect(
      parseRelevanceContextFromBody({
        classCode: "2STC",
        schoolProfile: { weekdays: {} },
      }),
    ).toEqual({ classCode: "2STC" });
  });

  it("verken classCode eller gyldig schoolProfile → undefined", () => {
    expect(
      parseRelevanceContextFromBody({ schoolProfile: "tull" }, () => null),
    ).toBeUndefined();
  });
});

describe("relevanceOverlayOverride", () => {
  it("gir klassepresis classLabel + sourceTitle når classCode finnes", () => {
    expect(relevanceOverlayOverride({ classCode: "2STC" })).toEqual({
      classLabel: "2STC",
      sourceTitle: "Ukeplan for 2STC",
    });
  });

  it("returnerer null uten classCode", () => {
    expect(relevanceOverlayOverride(undefined)).toBeNull();
    expect(relevanceOverlayOverride({})).toBeNull();
    expect(relevanceOverlayOverride({ classCode: "   " })).toBeNull();
  });
});
