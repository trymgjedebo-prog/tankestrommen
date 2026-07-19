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

/**
 * Låser at feltet nå er SYNLIG i det primære JSON-skjelettet i BÅDE image- og text-prompten
 * (ikke bare i den vedlagte detaljseksjonen), slik at den lettere bildemodellen ikke lenger
 * ledes til å utelate additive top-level-felt. Regresjon for produksjonsfeilen der image-route
 * emitterte null schoolDayOperationSignals.
 */
describe("schoolDayOperationSignals i primært JSON-skjelett", () => {
  const DETAIL_MARKER = "=== OPTIONAL FIELD: schoolDayOperationSignals ===";
  const SKELETON_KEY = '"schoolDayOperationSignals": []';

  it("image-skjelettet nevner feltet FØR den detaljerte seksjonen", () => {
    const key = SYSTEM_PROMPT.indexOf(SKELETON_KEY);
    const detail = SYSTEM_PROMPT.indexOf(DETAIL_MARKER);
    expect(key).toBeGreaterThanOrEqual(0);
    expect(detail).toBeGreaterThan(0);
    expect(key).toBeLessThan(detail);
  });

  it("text-skjelettet nevner feltet FØR den detaljerte seksjonen", () => {
    const key = TEXT_SYSTEM_PROMPT.indexOf(SKELETON_KEY);
    const detail = TEXT_SYSTEM_PROMPT.indexOf(DETAIL_MARKER);
    expect(key).toBeGreaterThanOrEqual(0);
    expect(detail).toBeGreaterThan(0);
    expect(key).toBeLessThan(detail);
  });

  it("begge prompts bruker samme top-level-feltnavn i skjelettet", () => {
    expect(SYSTEM_PROMPT).toContain(SKELETON_KEY);
    expect(TEXT_SYSTEM_PROMPT).toContain(SKELETON_KEY);
  });

  it("begge prompts sier at feltet utelates uten et sikkert signal", () => {
    expect(SYSTEM_PROMPT).toContain("UTELAT feltet helt når ingen sikker dagsoperasjon finnes");
    expect(TEXT_SYSTEM_PROMPT).toContain(
      'Omit "schoolDayOperationSignals" entirely when there is no certain whole-day operation',
    );
  });

  it("image-prompten sier ikke lenger at bare et skjelett uten feltet er tillatt", () => {
    expect(SYSTEM_PROMPT).not.toContain("nøyaktig disse nøklene");
    expect(SYSTEM_PROMPT).toContain(
      "de eksplisitt definerte valgfrie top-level-feltene",
    );
  });

  it("vilkårlige ukjente felter er fortsatt ikke tillatt", () => {
    expect(SYSTEM_PROMPT).toContain("Ikke finn opp andre felter");
  });

  it("den detaljerte konservative kontrakten er fortsatt inkludert ordrett i begge prompts", () => {
    expect(SYSTEM_PROMPT).toContain(S);
    expect(TEXT_SYSTEM_PROMPT).toContain(S);
  });
});

/**
 * Låser adjust_start-presiseringen: et eksplisitt oppmøte-/dagsstart-tidspunkt gir fortsatt
 * adjust_start selv om samme dagsavsnitt også inneholder en separat beskjed (bokinnlevering,
 * påminnelse). Regresjon for produksjonsfeilen der onsdag «Elevens oppmøte kl. 10.30.
 * Bokinnlevering …» ble tolket som none. Konservative grenser (bokinnlevering/eksamen-for-noen/
 * enkelttime) bevares som negative kontraster.
 */
describe("adjust_start-presisering (oppmøte vs. andre beskjeder)", () => {
  it("sier at et eksplisitt oppmøte-/dagsstart-tidspunkt kan gi adjust_start", () => {
    expect(S).toContain("ADJUST_START — ATTENDANCE VS. OTHER SAME-DAY MESSAGES");
    expect(S).toContain(
      "when the pupil should MEET, or when the pupil's overall school day BEGINS, still yields \"adjust_start\"",
    );
  });

  it("sier at separate beskjeder samme dag ikke automatisk opphever signalet", () => {
    expect(S).toContain(
      "even when the same day paragraph ALSO contains other separate messages",
    );
    expect(S).toContain("do NOT withhold the signal merely because the paragraph has several sentences");
  });

  it("klassifiseringen er fortsatt semantisk (hele elevens dagsstart), ikke frasebasert", () => {
    expect(S).toContain("does this time mark when the pupil's overall school day begins?");
  });

  it("inneholder det produksjonsnære positive eksempelet (oppmøte 10.30 + bokinnlevering → adjust_start 10:30)", () => {
    expect(S).toContain(
      'SHOULD emit adjust_start (attendance time stands despite a separate message) — "Elevens oppmøte kl. 10.30. Bokinnlevering for alle som har hatt eksamen."',
    );
    expect(S).toContain("the book handover is a separate message and does NOT override the start-time signal");
    expect(S).toContain('{"operation":"adjust_start","effectiveStart":"10:30", ...}');
  });

  it("har negativt bokinnleveringseksempel (tiden gjelder bokinnleveringen)", () => {
    expect(S).toContain(
      'SHOULD NOT emit adjust_start (time belongs to the book handover) — "Bokinnlevering for 2STC kl. 10.30–11.00."',
    );
  });

  it("har negativt eksamen-for-noen-eksempel (betinget undergruppe)", () => {
    expect(S).toContain(
      'SHOULD NOT emit adjust_start (conditional subgroup, ordinary teaching continues) — "Muntlig eksamen for noen elever kl. 10.30. Vanlig undervisning for resten."',
    );
  });

  it("har negativt enkelttime-eksempel", () => {
    expect(S).toContain(
      'SHOULD NOT emit adjust_start (a single lesson, not the pupil\'s overall start) — "Naturfag kl. 10.30."',
    );
  });

  it("bevarer konservative grenser (subgruppe/uklart dagsscope/ingen gjetting)", () => {
    expect(S).toContain("when it applies to some pupils but not to the pupil's overall day");
    expect(S).toContain("when there is no clear day-level scope");
    // Gjetteforbudet for tid er uendret.
    expect(S).toContain("Do NOT guess a missing time");
  });

  it("presiseringen er en del av den delte seksjonen brukt identisk av image og text", () => {
    expect(SYSTEM_PROMPT).toContain("ADJUST_START — ATTENDANCE VS. OTHER SAME-DAY MESSAGES");
    expect(TEXT_SYSTEM_PROMPT).toContain("ADJUST_START — ATTENDANCE VS. OTHER SAME-DAY MESSAGES");
  });
});
