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

  it("onsdag-lik celle: prose med flere fag er ikke ny overskrift; tomme fag-rader beholdes; mars-bad inn i samfunnsfag", () => {
    const details = [
      "Fravær skal meldes til kontaktlærer.",
      "I timen: mars-bad!",
      "Husk: badetøy, håndkle og mat.",
      "Vi skal være tilbake til språktimen 12.25.",
      "- Naturfag:",
      "Vi jobber med egenarbeid.",
      "Naturfag, norsk og samfunnsfag er også i timen.",
      "- Norsk:",
      "- Samfunnsfag:",
      "- Tysk:",
      "I timen: Skriftlig tyskprøve.",
      "Ha med blyant og viskelær.",
    ].join("\n");

    const m = splitDetailsIntoTableSubjectRowsWithMeta(details);
    expect(m).not.toBeNull();
    const labels = m!.rows.map((r) => r.label);
    expect(labels.some((l) => /naturfag/i.test(l))).toBe(true);
    expect(labels.some((l) => /^norsk$/i.test(l.trim()))).toBe(true);
    expect(labels.some((l) => /samfunnsfag/i.test(l))).toBe(true);
    expect(labels.some((l) => /^tysk$/i.test(l.trim()))).toBe(true);

    const nat = m!.rows.find((r) => /naturfag/i.test(r.label))!;
    expect(nat.body).toContain("egenarbeid");
    expect(nat.body).toContain("Naturfag, norsk og samfunnsfag er også i timen");

    const samf = m!.rows.find((r) => /samfunnsfag/i.test(r.label))!;
    expect(samf.body).toContain("mars-bad");

    const tysk = m!.rows.find((r) => /^tysk$/i.test(r.label.trim()))!;
    expect(tysk.body).toContain("tyskprøve");
    expect(tysk.body).toContain("blyant");

    expect(m!.preamble.some((l) => /Fravær|kontaktlærer/i.test(l))).toBe(true);
    expect(m!.preamble.some((l) => /mars-bad/i.test(l))).toBe(false);
  });

  it("mars-bad i preamble havner på Samfunnsfag selv om Spansk er første fagrad", () => {
    const details = [
      "I timen: mars-bad!",
      "Husk: badetøy.",
      "- Spansk:",
      "Les kapittel 2.",
      "- Samfunnsfag:",
      "Vanlig undervisning.",
    ].join("\n");
    const m = splitDetailsIntoTableSubjectRowsWithMeta(details);
    expect(m).not.toBeNull();
    const spansk = m!.rows.find((r) => /^spansk$/i.test(r.label.trim()))!;
    const samf = m!.rows.find((r) => /samfunnsfag/i.test(r.label))!;
    expect(spansk.body).not.toContain("mars-bad");
    expect(samf.body).toContain("mars-bad");
    expect(samf.body).toContain("badetøy");
  });
});
