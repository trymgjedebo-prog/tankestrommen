/**
 * PR 1 (relevansprofil): skole-/klasseplaner skal ikke få cup-/kamp-labels.
 * Tester den deterministiske klassifisereren + at runneren bruker nøytrale labels for skoleplan,
 * mens ekte cup fortsatt får kamp-labels.
 */
import { describe, expect, it } from "vitest";
import {
  classifyTankestromDocumentKind,
  hasStrongSchoolEvidence,
  looksLikeSchoolClassSchedule,
} from "@/lib/school-class-schedule";
import { runTankestromFixture } from "@/lib/tankestrom-regression-fixture-runner";

describe("looksLikeSchoolClassSchedule / classifyTankestromDocumentKind", () => {
  it("skole-/klasseplan (klassekoder + skoleord, ingen sport) → true / school_class_schedule", () => {
    const text =
      "Skoleplan uke 25\nTid | 2STA | 2STB | 2STC | 2STD\n08:30 | Bokinnlevering | Rådgiveropplegg | Tur til Sognsvann | Forberedelse";
    expect(looksLikeSchoolClassSchedule(text)).toBe(true);
    expect(classifyTankestromDocumentKind(text)).toBe("school_class_schedule");
  });

  it("klassekoder alene (≥2) uten «skoleplan»-ord → true", () => {
    expect(looksLikeSchoolClassSchedule("2STA og 2STB har bokinnlevering 08:30")).toBe(true);
  });

  it("skoleord (auditorium/rådgiver/eksamen) uten sport → true", () => {
    expect(looksLikeSchoolClassSchedule("Rådgiveropplegg og eksamen i auditoriet kl. 10:00")).toBe(
      true,
    );
  });

  it("ekte cup/sport → false / cup_or_sport", () => {
    expect(looksLikeSchoolClassSchedule("Lørdagscup: Første kamp kl. 09:20, håndball, bane 2")).toBe(
      false,
    );
    expect(looksLikeSchoolClassSchedule("Turnering, pulje A, fotball")).toBe(false);
    expect(classifyTankestromDocumentKind("Cup med kamp kl. 09:20")).toBe("cup_or_sport");
  });

  it("konservativ: skole-tekst med tydelig sportssignal → false (ikke skole)", () => {
    expect(looksLikeSchoolClassSchedule("2STA spiller fotballkamp mot 2STB på bane 1")).toBe(false);
  });

  it("eksamensplan med «puljer» + 2STA–2STF + skoleord → true (sterk skole slår svak sport)", () => {
    const text =
      "Eksamensoppsett 2ST uke 24\n2STA, 2STB, 2STC, 2STD, 2STE, 2STF\nMandag: skriftlig eksamen, pulje 1 kl. 09:00 i auditoriet, pulje 2 på rom 214\nTirsdag: bokinnlevering 08:30";
    expect(looksLikeSchoolClassSchedule(text)).toBe(true);
    expect(hasStrongSchoolEvidence(text)).toBe(true);
    expect(classifyTankestromDocumentKind(text)).toBe("school_class_schedule");
  });

  it("hasStrongSchoolEvidence krever BÅDE ≥2 klassekoder OG skoleord", () => {
    expect(hasStrongSchoolEvidence("2STA og 2STB har eksamen i auditoriet")).toBe(true);
    // klassekoder, men ingen skoleord (og «bane» gir ikke skolebevis):
    expect(hasStrongSchoolEvidence("2STA og 2STB møtes på bane 1")).toBe(false);
    // skoleord, men < 2 klassekoder:
    expect(hasStrongSchoolEvidence("eksamen i auditoriet kl. 10:00")).toBe(false);
  });
});

describe("runner: skole-/klasseplan får ikke kamp-labels", () => {
  it("skole-fixture (selv med category=cup) → ingen kamp-labels, tider bevart", () => {
    const b = runTankestromFixture("fixtures/tankestrom/school_class_schedule.txt", {
      category: "cup",
    });
    const hl = b.children.flatMap((c) => c.highlights).join(" | ");
    expect(hl.toLowerCase()).not.toContain("kamp");
    expect(hl).not.toContain("Første kamp");
    expect(hl).not.toContain("Andre kamp");
    expect(hl).not.toContain("Tredje kamp");
    // Reelle tider skal fortsatt kunne hentes ut.
    expect(hl).toContain("08:30");
  });

  it("regresjon: ekte cup-fixture beholder kamp-labels", () => {
    const b = runTankestromFixture("fixtures/tankestrom/schedule_compute_text_oneday.txt", {
      category: "cup",
    });
    const hl = b.children.flatMap((c) => c.highlights).join(" | ");
    expect(hl).toMatch(/kamp/i);
  });

  it("eksamensplan med «puljer» (selv med category=cup) → ingen kamp-labels, reelle tider bevart", () => {
    const b = runTankestromFixture("fixtures/tankestrom/school_activity_plan_exam.txt", {
      category: "cup",
    });
    const hl = b.children.flatMap((c) => c.highlights).join(" | ");
    expect(hl.toLowerCase()).not.toContain("kamp");
    expect(hl).not.toMatch(/første kamp|andre kamp|tredje kamp/i);
    expect(hl).toMatch(/\d{2}:\d{2}/); // nøytral stil: reelle tider hentes fortsatt ut
  });
});
