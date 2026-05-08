import { describe, it } from "vitest";
import {
  createRegressionAsserts,
  runTankestromFixture,
} from "@/lib/tankestrom-regression-harness";

describe("Tankestrømmen regression harness", () => {
  it("Vårcupen fixture holder parent/child struktur og highlights", () => {
    const bundle = runTankestromFixture("fixtures/tankestrom/vaacup_original.txt");
    const t = createRegressionAsserts(bundle);
    t.expectParentCount(1);
    t.expectChildCount(3);
    t.expectChildTitles(["Vårcupen – fredag", "Vårcupen – lørdag", "Vårcupen – søndag"]);
    t.expectDayHighlights("fredag", ["17:45 Oppmøte", "18:40 Første kamp"]);
    t.expectNoDayHighlightAt("fredag", "16:50");
    t.expectNoDayHighlightContaining("fredag", "18:40 Oppmøte");
    t.expectNoDayHighlightAt("fredag", "20:00");
    t.expectNoDayHighlightContaining("fredag", "Spond");
    t.expectNoDayHighlightContaining("fredag", "barnet kan delta");
    t.expectNoDayHighlightContaining("fredag", "hvilke kamper dere ikke rekker");
    t.expectDayHighlights("lørdag", [
      "08:35 Oppmøte før første kamp",
      "09:20 Første kamp",
      "14:25 Oppmøte før andre kamp",
      "15:10 Andre kamp",
    ]);
    t.expectNoDayHighlightAt("lørdag", "19:15");
    t.expectNoDayHighlightAt("lørdag", "20:00");
    t.expectNoDayHighlightContaining("lørdag", "Spond");
    t.expectNoDayHighlightContaining("lørdag", "barnet kan delta");
    t.expectNoDayHighlightContaining("lørdag", "svarfrist");
    t.expectNoDeadlineHighlightInProgramDays();
    t.expectTaskDeadline({
      titleIncludes: "Svar i Spond",
      date: "2026-06-08",
      dueTime: "20:00",
    });
    t.expectTimePrecision("søndag", "date_only");
    t.expectTentativeOnlyForDay("søndag");
    t.expectNoEventTitleAsHighlight();
    t.expectNoStructureFallbackInNotes();
    t.expectNoDateTokensInChildTitles();
    t.expectNoDuplicateDays();
  });

  it("Høstcupen fixture holder struktur, dedupe og rene notes", () => {
    const bundle = runTankestromFixture("fixtures/tankestrom/hostcup_handball.txt");
    const t = createRegressionAsserts(bundle);
    t.expectParentCount(1);
    t.expectChildCount(3);
    t.expectChildTitles(["Høstcupen – fredag", "Høstcupen – lørdag", "Høstcupen – søndag"]);
    t.expectNoDuplicateDays();
    t.expectNoDateTokensInChildTitles();
    t.expectNoEventTitleAsHighlight();
    t.expectNoStructureFallbackInNotes();
  });
});
