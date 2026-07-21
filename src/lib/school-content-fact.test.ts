/**
 * Enhetstester for den delte, pre-projeksjons fag/kategori-raden (`school-content-fact`). Beviser at
 * KILDECONTAINER-identitet (`sourceContainerId`) og ENKELT-FAKTUM-identitet (`sourceFactId`) er
 * atskilte, at synlig `text` er radens kropp (ikke hele containeren), at `customLabel` ikke inneholder
 * seksjonsord, at default-kategori er konservativ (message), og at containerdekning (full/partial)
 * beregnes korrekt. Ingen fuzzy matching, ingen dokument-spesifikke fraser.
 */
import { describe, expect, it } from "vitest";
import {
  buildNormalizedSchoolContentFacts,
  moreSpecificContentType,
  sectionKeyToContentType,
} from "@/lib/school-content-fact";
import type { DayScheduleEntry } from "@/lib/types";

function day(o: Partial<DayScheduleEntry>): DayScheduleEntry {
  return { dayLabel: null, date: null, time: null, details: null, highlights: [], rememberItems: [], deadlines: [], notes: [], ...o };
}

describe("container- vs. faktum-identitet", () => {
  it("to rader fra samme details-container deler sourceContainerId, men har ulik sourceFactId", () => {
    const facts = buildNormalizedSchoolContentFacts([
      day({ date: "2026-03-16", details: "Norsk i timen: Les kapittel 2.\nNorsk i timen: Skriv sammendrag." }),
    ]);
    expect(facts).toHaveLength(2);
    expect(facts[0]!.sourceContainerId).toBe(facts[1]!.sourceContainerId); // samme container
    expect(facts[0]!.sourceFactId).not.toBe(facts[1]!.sourceFactId); // ulike faktum
    expect(facts.map((f) => f.text).sort()).toEqual(["Les kapittel 2.", "Skriv sammendrag."]);
  });

  it("samme tekst under ulikt fag → ulik sourceFactId (ikke slått sammen)", () => {
    const facts = buildNormalizedSchoolContentFacts([
      day({ date: "2026-03-16", details: "Norsk: Prosjekt.\nTysk: Prosjekt." }),
    ]);
    expect(facts.map((f) => f.subjectKey).sort()).toEqual(["norsk", "tysk"]);
    expect(facts[0]!.sourceFactId).not.toBe(facts[1]!.sourceFactId);
    expect(facts[0]!.sourceContainerId).toBe(facts[1]!.sourceContainerId);
  });

  it("sourceField settes fra kildefeltet; atomiske felt er egne containere", () => {
    const facts = buildNormalizedSchoolContentFacts([
      day({ date: "2026-03-16", details: "Norsk: Les.", highlights: ["Matematikk: Oppgave 5."] }),
    ]);
    expect(facts.find((f) => f.subjectKey === "norsk")!.sourceField).toBe("details");
    expect(facts.find((f) => f.subjectKey === "matematikk")!.sourceField).toBe("highlights");
    expect(facts[0]!.sourceContainerId).not.toBe(facts[1]!.sourceContainerId);
  });
});

describe("synlig text vs. original evidens", () => {
  it("text er radens kropp, originalSourceText er hele containeren (blob)", () => {
    const facts = buildNormalizedSchoolContentFacts([
      day({ date: "2026-03-16", details: "Norsk i timen: Les kapittel 2.\nTysk i timen: Beskriv bildet." }),
    ]);
    const norsk = facts.find((f) => f.subjectKey === "norsk")!;
    expect(norsk.text).toBe("Les kapittel 2."); // radens body
    expect(norsk.originalSourceText).toBe("Norsk i timen: Les kapittel 2. Tysk i timen: Beskriv bildet."); // hele bloben
  });
});

describe("customLabel-regelen (§6)", () => {
  it("kanonisk fag → customLabel null; seksjonsord aldri med", () => {
    for (const src of ["Norsk i timen: Les.", "Spansk lekse: Skriv.", "Engelsk prøve: Kap 4."]) {
      const [f] = buildNormalizedSchoolContentFacts([day({ date: "2026-03-16", details: src })]);
      expect(f!.customLabel).toBeNull();
    }
  });

  it("seksjonsordet er aldri del av fag-identiteten (subject «Norsk», ikke «Norsk i timen»)", () => {
    const [f] = buildNormalizedSchoolContentFacts([day({ date: "2026-03-16", details: "Norsk i timen: Les." })]);
    expect(f!.subjectKey).toBe("norsk");
    expect(f!.subject).toBe("Norsk");
    expect(f!.subject).not.toMatch(/i timen/i);
  });
});

describe("konservativ contentType (§9)", () => {
  it("bare «Fag: body» uten eksplisitt seksjon → message (ikke lesson)", () => {
    const [f] = buildNormalizedSchoolContentFacts([day({ date: "2026-03-16", details: "Matematikk: Ta med kalkulator." })]);
    expect(f!.sectionKey).toBe("ekstraBeskjed");
    expect(sectionKeyToContentType(f!.sectionKey)).toBe("message");
  });

  it("highlights uten «i timen» → message (ikke lesson bare fordi det kom fra highlights)", () => {
    const [f] = buildNormalizedSchoolContentFacts([day({ date: "2026-03-16", highlights: ["Matematikk: informasjon"] })]);
    expect(sectionKeyToContentType(f!.sectionKey)).toBe("message");
  });

  it("eksplisitt seksjonsord hever: «i timen» → lesson, «lekse» → homework, «prøve» → assessment", () => {
    const facts = buildNormalizedSchoolContentFacts([
      day({ date: "2026-03-16", details: "Norsk i timen: Les." }),
      day({ date: "2026-03-17", details: "Spansk lekse: Skriv." }),
      day({ date: "2026-03-18", details: "Engelsk prøve: Kap 4." }),
    ]);
    expect(sectionKeyToContentType(facts.find((f) => f.subjectKey === "norsk")!.sectionKey)).toBe("lesson");
    expect(sectionKeyToContentType(facts.find((f) => f.subjectKey === "spansk")!.sectionKey)).toBe("homework");
    expect(sectionKeyToContentType(facts.find((f) => f.subjectKey === "engelsk")!.sectionKey)).toBe("assessment");
  });
});

describe("containerdekning (§7)", () => {
  it("full details-container (kun fag-rader, ingen preamble) → coverage full", () => {
    const facts = buildNormalizedSchoolContentFacts([
      day({ date: "2026-03-16", details: "Norsk i timen: Les.\nTysk i timen: Beskriv." }),
    ]);
    expect(facts.every((f) => f.sourceCoverage === "full")).toBe(true);
  });

  it("details med ledende preamble → coverage partial", () => {
    const facts = buildNormalizedSchoolContentFacts([
      day({ date: "2026-03-16", details: "Husk oppladet PC.\nNorsk i timen: Les kapittel 2." }),
    ]);
    expect(facts.every((f) => f.sourceCoverage === "partial")).toBe(true);
  });

  it("atomisk felt tolket som ett eksplisitt fagfaktum → full", () => {
    const [f] = buildNormalizedSchoolContentFacts([day({ date: "2026-03-16", highlights: ["Norsk i timen: Les."] })]);
    expect(f!.sourceCoverage).toBe("full");
  });

  it("linje uten eksplisitt fag-prefiks → ingen fact (forblir dagsnivå)", () => {
    expect(buildNormalizedSchoolContentFacts([day({ date: "2026-03-16", notes: ["Vanlig beskjed uten fag"] })])).toEqual([]);
  });
});

describe("determinisme og immutability", () => {
  it("stabil sourceContainerId/sourceFactId; ulik dag → ulik ID selv med samme tekst", () => {
    const input = [day({ date: "2026-03-16", details: "Norsk: Les." }), day({ date: "2026-03-17", details: "Matte: Regn." })];
    expect(buildNormalizedSchoolContentFacts(input).map((f) => f.sourceFactId)).toEqual(buildNormalizedSchoolContentFacts(input).map((f) => f.sourceFactId));
    const same = buildNormalizedSchoolContentFacts([day({ date: "2026-03-16", details: "Norsk: Les." }), day({ date: "2026-03-17", details: "Norsk: Les." })]);
    expect(same[0]!.sourceContainerId).not.toBe(same[1]!.sourceContainerId);
    expect(same[0]!.sourceFactId).not.toBe(same[1]!.sourceFactId);
  });

  it("muterer ikke input", () => {
    const input = [day({ date: "2026-03-16", details: "Norsk: Les." })];
    const snap = JSON.stringify(input);
    buildNormalizedSchoolContentFacts(input);
    expect(JSON.stringify(input)).toBe(snap);
  });
});

describe("kategori-mapping og -prioritet", () => {
  it("seksjon → kategori (kontrakt)", () => {
    expect(sectionKeyToContentType("iTimen")).toBe("lesson");
    expect(sectionKeyToContentType("lekse")).toBe("homework");
    expect(sectionKeyToContentType("husk")).toBe("reminder");
    expect(sectionKeyToContentType("proveVurdering")).toBe("assessment");
    expect(sectionKeyToContentType("ressurser")).toBe("resource");
    expect(sectionKeyToContentType("ekstraBeskjed")).toBe("message");
    expect(sectionKeyToContentType("descriptionLines")).toBe("message");
  });

  it("mer spesifikk kategori vinner over message", () => {
    expect(moreSpecificContentType("message", "lesson")).toBe("lesson");
    expect(moreSpecificContentType("lesson", "message")).toBe("lesson");
    expect(moreSpecificContentType("lesson", "assessment")).toBe("assessment");
    expect(moreSpecificContentType("homework", "assessment")).toBe("assessment");
  });
});
