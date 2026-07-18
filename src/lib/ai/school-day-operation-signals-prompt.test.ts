/**
 * Deterministiske kontrakttester for den delte schoolDayOperationSignals-promptseksjonen.
 * Ingen live-LLM: låser at (a) seksjonen inneholder feltnavn, alle tre operasjonene, kravet om
 * at HELE skoledagen må påvirkes, kravet om å utelate usikre/betingede signaler og ikke gjette
 * tider, replace_day-aktivitetstypene og de konservative eksemplene, og (b) BÅDE bilde- og
 * tekstprompten bruker NØYAKTIG samme delte kontrakt.
 */
import { describe, expect, it } from "vitest";
import { SCHOOL_DAY_OPERATION_SIGNALS_PROMPT_SECTION } from "@/lib/ai/school-day-operation-signals-prompt";
import { SYSTEM_PROMPT, TEXT_SYSTEM_PROMPT } from "@/lib/ai/analyze-image";

const S = SCHOOL_DAY_OPERATION_SIGNALS_PROMPT_SECTION;

describe("schoolDayOperationSignals delt promptkontrakt", () => {
  it("1. nevner feltet schoolDayOperationSignals", () => {
    expect(S).toContain("schoolDayOperationSignals");
  });

  it("2. inneholder alle tre operasjonsverdiene", () => {
    expect(S).toContain('"adjust_start"');
    expect(S).toContain('"adjust_end"');
    expect(S).toContain('"replace_day"');
  });

  it("3. krever at HELE skoledagen påvirkes", () => {
    expect(S).toContain("ENTIRE school day");
    expect(S).toContain("whole school day is affected");
  });

  it("4. krever å utelate usikre og betingede signaler", () => {
    expect(S).toContain("If ordinary teaching still applies that day, return NO entry");
    expect(S).toContain("the pupil's branch is not clearly resolved, OMIT");
    expect(S).toContain("OMIT the field entirely");
    expect(S).toContain("do NOT return an empty array");
  });

  it("5. krever å IKKE gjette tider", () => {
    expect(S).toContain("Do NOT guess a missing time");
    expect(S).toContain("do NOT assume usual school hours");
    expect(S).toContain("do NOT compute a time from a duration");
  });

  it("6. lister replace_day activity kinds", () => {
    for (const kind of ['"exam_day"', '"trip_day"', '"activity_day"', '"free_day"', '"other"']) {
      expect(S).toContain(kind);
    }
  });

  it("7. maks ett operasjonssignal per dag; konflikt/usikkerhet → utelat", () => {
    expect(S).toContain("AT MOST ONE operation signal per day");
    expect(S).toContain("rather than produce false certain structure");
  });

  it("8. forbyr én tekststreng som eneste klassifiseringsregel", () => {
    expect(S).toContain("Do NOT use a single text phrase as the only classification rule");
  });

  it("9. adjust_start/adjust_end setter kun sin ene tid", () => {
    expect(S).toContain("Fill \"effectiveStart\"; do NOT set an end time");
    expect(S).toContain("Fill \"effectiveEnd\"; do NOT set a start time");
  });

  it("10. inneholder de konservative positiv-/negativ-eksemplene", () => {
    expect(S).toContain("SHOULD emit adjust_start");
    expect(S).toContain("SHOULD emit replace_day/activity_day");
    expect(S).toContain("SHOULD NOT emit any day operation");
    expect(S).toContain("SHOULD NOT emit a certain replace_day");
  });

  it("11. bilde- og tekstprompt bruker NØYAKTIG samme delte kontrakt", () => {
    expect(SYSTEM_PROMPT).toContain(S);
    expect(TEXT_SYSTEM_PROMPT).toContain(S);
  });

  it("12. eksemplene står som semantiske illustrasjoner, ikke frase-regler", () => {
    expect(S).toContain("illustrate meaning only — do NOT match these exact phrases as a rule");
  });
});
