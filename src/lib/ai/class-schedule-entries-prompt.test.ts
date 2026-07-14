/**
 * Deterministiske kontrakttester for den delte classScheduleEntries-promptseksjonen.
 * Ingen live-LLM: låser at (a) den delte seksjonen inneholder feltnavn + kjerneregler, og
 * (b) BÅDE bilde- og tekstprompten bruker NØYAKTIG samme delte kontrakt.
 */
import { describe, expect, it } from "vitest";
import { CLASS_SCHEDULE_ENTRIES_PROMPT_SECTION } from "@/lib/ai/class-schedule-entries-prompt";
import { SYSTEM_PROMPT, TEXT_SYSTEM_PROMPT } from "@/lib/ai/analyze-image";

const S = CLASS_SCHEDULE_ENTRIES_PROMPT_SECTION;

describe("classScheduleEntries delt promptkontrakt", () => {
  it("1. nevner feltet classScheduleEntries", () => {
    expect(S).toContain("classScheduleEntries");
  });

  it("2. inneholder alle 11 feltnavnene", () => {
    for (const field of [
      "date",
      "dayLabel",
      "activityTitle",
      "classCodes",
      "groupLabel",
      "start",
      "end",
      "room",
      "teacher",
      "sourceText",
      "confidence",
    ]) {
      expect(S).toContain(`"${field}"`);
    }
  });

  it("3. krever separate entries ved forskjellige tider", () => {
    expect(S).toContain("DIFFERENT TIMES PER CLASS → SEPARATE ENTRIES");
  });

  it("4. felles pulje → én entry med flere classCodes (array-eksempel)", () => {
    expect(S).toContain("SHARED PULJE/GROUP → ONE ENTRY");
    expect(S).toContain('["2STA", "2STC", "2STE"]');
  });

  it("5. manglende sluttid → null", () => {
    expect(S).toContain("Missing end → null");
    expect(S).toContain("set end to null");
  });

  it("6. forbyr å kopiere én klasses tid til en annen", () => {
    expect(S).toContain("Never use the first class's time for the other classes");
    expect(S).toContain("never copy a room or teacher from one class to another");
  });

  it("7. forbyr gjetting av sluttid, rom og lærer", () => {
    expect(S).toContain("Do NOT compute an end time from a duration");
    expect(S).toContain("do NOT guess a time from usual school hours");
    expect(S).toContain("a missing or uncertain value must be null");
  });

  it("8. konflikter beholdes, løses ikke", () => {
    expect(S).toContain("KEEP BOTH as separate entries");
    expect(S).toContain("do NOT pick a winner");
  });

  it("9. utelates ved vanlig fellesinformasjon", () => {
    expect(S).toContain("gym clothes");
    expect(S).toContain("is NOT a classScheduleEntry");
    expect(S).toContain("OMIT the field entirely");
    expect(S).toContain("do NOT return an empty array");
  });

  it("10. eksisterende fritekst skal fortsatt bevares", () => {
    expect(S).toContain("It never replaces existing fields");
    expect(S).toContain('keep all normal free text in "scheduleByDay"');
  });

  it("11. bilde- og tekstprompt bruker NØYAKTIG samme delte kontrakt", () => {
    expect(SYSTEM_PROMPT).toContain(S);
    expect(TEXT_SYSTEM_PROMPT).toContain(S);
  });

  it("12. classCodes-eksempel er en array av separate koder, ikke kombinert fritekst", () => {
    expect(S).toContain('["2STA", "2STC"]');
    expect(S).toContain('["2STA, 2STC og 2STE"]'); // nevnt som det som IKKE skal returneres
    expect(S).toContain("Never return a combined free-text value in one element");
  });

  it("13. konkret puljerad m/ tid er gyldig selv med activityTitle=null; navngitt tittel ikke obligatorisk; globale lister forbys", () => {
    // activityTitle ikke obligatorisk
    expect(S).toContain('A named "activityTitle" is NOT required');
    // pulje/tid-rad uten tittel → activityTitle null
    expect(S).toContain('set "activityTitle": null when the source only shows a concrete pulje/time row without a title');
    // eksplisitt puljerad m/ koder+tid er tilstrekkelig scoped (ingen oppfunnet tittel)
    expect(S).toContain("is already sufficiently scoped");
    expect(S).toContain("Puljeaktivitet"); // nevnt som tittel som IKKE skal finnes opp
    // globale, ukoblede klasselister forbys fortsatt
    expect(S).toContain("Never build a single global, unlinked list of classes");
    expect(S).toContain("must NOT become classScheduleEntries");
    // pulje-eksemplet viser eksplisitt activityTitle: null som gyldig entry
    expect(S).toContain('"activityTitle": null');
  });

  it("classCodes: forbys-eksempelet står som negativt (ikke som forventet output)", () => {
    // Det kombinerte eksempelet skal stå etter «Never return ...» — negativ kontekst.
    const neg = S.indexOf("Never return a combined free-text value");
    const combined = S.indexOf('["2STA, 2STC og 2STE"]');
    expect(neg).toBeGreaterThanOrEqual(0);
    expect(combined).toBeGreaterThan(neg);
  });
});
