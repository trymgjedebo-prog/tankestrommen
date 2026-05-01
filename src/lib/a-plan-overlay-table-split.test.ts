import { describe, expect, it } from "vitest";
import {
  expandEmbeddedSubjectHeadersInDetails,
  splitDetailsIntoTableSubjectRowsWithMeta,
} from "./a-plan-overlay-table-split";

describe("splitDetailsIntoTableSubjectRowsWithMeta", () => {
  it("splitter samfunnsfag og tysk på egne rader (flere linjer)", () => {
    const details = [
      "Fravær skal meldes til kontaktlærer.",
      "- Samfunnsfag:",
      "I timen: mars-bad!",
      "Husk: badetøy, håndkle og mat.",
      "Vi skal være tilbake til språktimen 12.25.",
      "- Tysk:",
      "I timen: Skriftlig tyskprøve.",
      "Ha med blyant og viskelær.",
    ].join("\n");

    const m = splitDetailsIntoTableSubjectRowsWithMeta(details);
    expect(m).not.toBeNull();
    expect(m!.rows).toHaveLength(2);
    expect(m!.rows[0].label).toMatch(/samfunnsfag/i);
    expect(m!.rows[0].body).toContain("mars-bad");
    expect(m!.rows[0].body).toContain("språktimen");
    expect(m!.rows[1].label).toMatch(/tysk/i);
    expect(m!.rows[1].body).toContain("tyskprøve");
    expect(m!.preamble.some((l) => l.includes("Fravær"))).toBe(true);
  });

  it("splitter innebygd «… Tysk:» på samme linje (DOCX-celle)", () => {
    const details =
      "Samfunnsfag: I timen: mars-bad! Husk: badetøy. Tysk: I timen: Skriftlig tyskprøve.";
    const expanded = expandEmbeddedSubjectHeadersInDetails(details)!;
    expect(expanded.split("\n").length).toBeGreaterThanOrEqual(2);
    const m = splitDetailsIntoTableSubjectRowsWithMeta(details);
    expect(m).not.toBeNull();
    expect(m!.rows.length).toBeGreaterThanOrEqual(2);
    expect(m!.rows.some((r) => /tysk/i.test(r.label))).toBe(true);
  });

  it("én tabellrad med fagoverskrift gir én rad", () => {
    const details = "- Samfunnsfag:\nI timen: tur til museet.";
    const m = splitDetailsIntoTableSubjectRowsWithMeta(details);
    expect(m).not.toBeNull();
    expect(m!.rows).toHaveLength(1);
    expect(m!.rows[0].label.toLowerCase()).toContain("samf");
  });

  it("uten fagoverskrift → null (monolittisk fallback i route)", () => {
    const details = "Bare noe generelt uten fagkolonner.\nNeste linje.";
    expect(splitDetailsIntoTableSubjectRowsWithMeta(details)).toBeNull();
  });
});
