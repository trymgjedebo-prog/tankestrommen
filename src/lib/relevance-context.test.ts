import { describe, expect, it } from "vitest";
import {
  parseRelevanceContextFromBody,
  relevanceOverlayOverride,
} from "./portal-import-person";

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
