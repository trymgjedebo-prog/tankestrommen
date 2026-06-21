/**
 * Eval-/fixture-dekning for beregning av start- og sluttid fra programlogikk.
 *
 * Denne PR-en FIKSER IKKE produksjonslogikken — den dokumenterer ønsket oppførsel.
 * `it(...)` = invariant som holder i dag. `it.fails(...)` = ønsket fasit som IKKE støttes
 * ennå (produksjonsgap). Når en neste produksjons-PR fikser logikken, vil de relevante
 * `it.fails`-testene begynne å feile (fordi de da passerer) — det er signalet om å flippe
 * dem til `it(...)`.
 *
 * Fasit-verdiene ligger i fixtures/tankestrom/expected/schedule_compute_*.expected.json.
 */
import { describe, expect, it } from "vitest";
import {
  loadTankestromExpected,
  resolveExpectedPath,
  type DayKey,
} from "@/evals/tankestrom-expected";
import {
  runTankestromFixture,
  type RegressionPortalBundle,
} from "@/lib/tankestrom-regression-fixture-runner";

function run(id: string): RegressionPortalBundle {
  return runTankestromFixture(`fixtures/tankestrom/${id}.txt`, { category: "cup" });
}
function fasit(id: string) {
  return loadTankestromExpected(resolveExpectedPath(process.cwd(), id));
}
function childByDay(b: RegressionPortalBundle, day: DayKey) {
  return b.children.find((c) => c.day === day);
}
function highlightsJoined(b: RegressionPortalBundle, day: DayKey): string {
  return (childByDay(b, day)?.highlights ?? []).join(" | ");
}

describe("schedule time computation — gjeldende oppførsel (grønt i dag)", () => {
  it("F1 tekst: ekte kamptider blir program-highlights", () => {
    const b = run("schedule_compute_text_oneday");
    expect(b.children).toHaveLength(1);
    expect(highlightsJoined(b, "lørdag")).toContain("09:20");
    expect(highlightsJoined(b, "lørdag")).toContain("10:50");
  });

  it("F2 tabell: tabellrader (Tid | Aktivitet | Sted) blir kamptider", () => {
    const b = run("schedule_compute_table_oneday");
    expect(b.children).toHaveLength(1);
    expect(highlightsJoined(b, "lørdag")).toContain("09:20");
    expect(highlightsJoined(b, "lørdag")).toContain("10:50");
  });

  it("F3 to dager: streng day scoping — ingen tid lekker mellom dager", () => {
    const b = run("schedule_compute_two_days");
    expect(b.children.map((c) => c.day)).toEqual(["fredag", "lørdag"]);
    // Fredagstider kun på fredag.
    expect(highlightsJoined(b, "fredag")).toContain("16:40");
    expect(highlightsJoined(b, "fredag")).not.toContain("08:30");
    expect(highlightsJoined(b, "fredag")).not.toContain("10:00");
    // Lørdagstider kun på lørdag.
    expect(highlightsJoined(b, "lørdag")).toContain("08:30");
    expect(highlightsJoined(b, "lørdag")).toContain("10:00");
    expect(highlightsJoined(b, "lørdag")).not.toContain("16:40");
  });

  it("F3: start = første kamp per dag (uten oppmøte-offset er dette korrekt i dag)", () => {
    const b = run("schedule_compute_two_days");
    const exp = fasit("schedule_compute_two_days");
    expect(childByDay(b, "fredag")?.start).toBe(exp.startByDay?.fredag); // 16:40
    expect(childByDay(b, "lørdag")?.start).toBe(exp.startByDay?.lørdag); // 08:30
  });

  it("F4: en Spond-oppgave opprettes, og ekte kamptider er highlights", () => {
    const b = run("schedule_compute_deadline_separation");
    expect(b.tasks.some((t) => /spond/i.test(t.title))).toBe(true);
    expect(highlightsJoined(b, "lørdag")).toContain("09:20");
    expect(highlightsJoined(b, "lørdag")).toContain("10:50");
  });
});

describe("schedule time computation — ØNSKET fasit (feiler i dag = produksjonsgap)", () => {
  // GAP A — oppmøte-offset «50 minutter før første kamp» gir ikke beregnet starttid.
  it.fails("F1: start beregnes fra oppmøte-offset (08:30 = 09:20 − 50 min)", () => {
    const b = run("schedule_compute_text_oneday");
    const exp = fasit("schedule_compute_text_oneday");
    expect(childByDay(b, "lørdag")?.start).toBe(exp.startByDay?.lørdag); // 08:30
  });

  // GAP B — kampvarighet «Kampene varer 40 minutter» parses ikke (kun «N x M min» i dag).
  it.fails("F1: activityDurationMinutes = 40", () => {
    const b = run("schedule_compute_text_oneday");
    const exp = fasit("schedule_compute_text_oneday");
    expect(childByDay(b, "lørdag")?.durationMinutes).toBe(exp.durationMinutesByDay?.lørdag); // 40
  });

  // GAP C — sluttid = siste kamp + varighet + etterbuffer.
  it.fails("F1: end = 12:00 (10:50 + 40 min kamp + 30 min buffer)", () => {
    const b = run("schedule_compute_text_oneday");
    const exp = fasit("schedule_compute_text_oneday");
    expect(childByDay(b, "lørdag")?.end).toBe(exp.inferredEndByDay?.lørdag); // 12:00
  });

  it.fails("F2 tabell: end = 12:00 fra samme beregningsprinsipp", () => {
    const b = run("schedule_compute_table_oneday");
    const exp = fasit("schedule_compute_table_oneday");
    expect(childByDay(b, "lørdag")?.end).toBe(exp.inferredEndByDay?.lørdag); // 12:00
  });

  it.fails("F3 fredag: end = 17:55 (16:40 + 45 + 30)", () => {
    const b = run("schedule_compute_two_days");
    const exp = fasit("schedule_compute_two_days");
    expect(childByDay(b, "fredag")?.end).toBe(exp.inferredEndByDay?.fredag); // 17:55
  });

  it.fails("F3 lørdag: end = 11:15 (10:00 + 45 + 30)", () => {
    const b = run("schedule_compute_two_days");
    const exp = fasit("schedule_compute_two_days");
    expect(childByDay(b, "lørdag")?.end).toBe(exp.inferredEndByDay?.lørdag); // 11:15
  });

  // GAP D — frist «Svar i Spond innen tirsdag kl. 20:00»: 20:00 lekker inn i programmet,
  // og task-dueTime fanger feil tid (første kamp i stedet for 20:00).
  it.fails("F4: frist-tid 20:00 skal IKKE være program-highlight", () => {
    const b = run("schedule_compute_deadline_separation");
    expect(highlightsJoined(b, "lørdag")).not.toContain("20:00");
  });

  it.fails("F4: Spond-task dueTime = 20:00 (ikke første kamptid)", () => {
    const b = run("schedule_compute_deadline_separation");
    const exp = fasit("schedule_compute_deadline_separation");
    const spond = b.tasks.find((t) => /spond/i.test(t.title));
    expect(spond?.dueTime).toBe(exp.requiredTasks[0]?.dueTime); // 20:00
  });
});
