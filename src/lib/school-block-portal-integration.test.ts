/**
 * Portalintegrasjon for `schoolBlockProposal`: additiv toppnivånøkkel som KUN emitteres ved
 * `documentKind: "school"`, bygget fra det portal-normaliserte, men UFILTRERTE analyseresultatet.
 * Hovedregresjonen er at builderen ikke får det klassefiltrerte objektet — da ville torsdagens
 * pulje-rad kollapset fra ["2STA","2STC","2STE"] til bare ["2STC"].
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route"; // side-effect: registerPortalBundleRuntime
import { toPortalBundle } from "@/lib/portal-bundle";
import {
  makeChildren,
  makeSchoolBlockWeekResult,
  makeSchoolBlockWeekResultWithDayOperations,
} from "@/lib/fixtures/school-block-week.fixture";
import type { PortalImportContext } from "@/lib/portal-import-person";
import type { AIAnalysisResult, SchoolBlockProposal } from "@/lib/types";

type Bundle = {
  items: Array<{ kind: string }>;
  schoolBlockProposal?: SchoolBlockProposal;
  schoolWeekOverlayProposal?: unknown;
};

/** Samme UUID-regel som Synka (v1–v5). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MATCHED_CTX = (): PortalImportContext => ({
  knownPersons: [],
  children: makeChildren(),
});

type DocKind = "school" | "activity_plan" | "event_doc" | "timetable" | "text" | "auto";

async function bundleOf(
  result: AIAnalysisResult,
  documentKind?: DocKind,
  portalImport: PortalImportContext = MATCHED_CTX(),
): Promise<Bundle> {
  return (await toPortalBundle(result, "text", documentKind, false, portalImport)) as Bundle;
}

async function schoolBundle(portalImport?: PortalImportContext): Promise<Bundle> {
  return bundleOf(makeSchoolBlockWeekResult(), "school", portalImport ?? MATCHED_CTX());
}

/** Utelat KUN proposalId (per-kjøring instans-ID) — resten skal være deterministisk. */
function withoutProposalId(p: SchoolBlockProposal): Omit<SchoolBlockProposal, "proposalId"> {
  const { proposalId: _ignored, ...rest } = p;
  return rest;
}

describe("schoolBlockProposal — portalintegrasjon", () => {
  it("documentKind 'school' emitterer proposalet som toppnivånøkkel", async () => {
    const bundle = await schoolBundle();
    expect("schoolBlockProposal" in bundle).toBe(true);

    const p = bundle.schoolBlockProposal!;
    expect(p.kind).toBe("school_block");
    expect(p.schemaVersion).toBe("1.0.0");
    expect(p.originalSourceType).toBe("text"); // sourceType-param, ikke documentKind
    expect(p.sourceTitle).toBe(makeSchoolBlockWeekResult().title);
    expect(p.personMatchStatus).toBe("matched");
    expect(p.personId).toBe("child-2stc");
    expect(p.classCode).toBe("2STC");
    expect(p.structureStatus).toBe("complete");
    expect(p.reviewFlags).toEqual([]);
  });

  it("proposalId er en gyldig, ikke-blank UUID", async () => {
    const p = (await schoolBundle()).schoolBlockProposal!;
    expect(typeof p.proposalId).toBe("string");
    expect(p.proposalId.trim()).not.toBe("");
    expect(p.proposalId).toMatch(UUID_RE);
  });

  it("HOVEDREGRESJON: bygget fra UFILTRERT resultat — pulje beholder alle tre klassekoder", async () => {
    // Konteksten har classCode 2STC, så filterAnalysisContentByClass ville filtrert innhold.
    const p = (await schoolBundle()).schoolBlockProposal!;
    const thu = p.days.find((d) => d.date === "2026-06-18")!;

    const pulje = thu.contentItems.find(
      (i) => i.audienceEntries[0]?.classCodes.length === 3,
    )!;
    expect(pulje.audienceEntries[0]!.classCodes).toEqual(["2STA", "2STC", "2STE"]);
    expect(pulje.audienceEntries[0]!.classCodes).not.toEqual(["2STC"]);

    const own = thu.contentItems.find(
      (i) => i.audienceEntries[0]?.classCodes.length === 1,
    )!;
    expect(own.audienceEntries[0]!.classCodes).toEqual(["2STC"]);
    expect(own.audienceEntries[0]!.start).toBe("11:15");
    expect(own.audienceEntries[0]!.end).toBe("12:15");
    expect(own.audienceEntries[0]!.room).toBe("332-50");
    expect(own.audienceEntries[0]!.teacher).toBe("Lærer C");
  });

  it("eksempeluka: fem dager med forventet innhold gjennom portalen", async () => {
    const p = (await schoolBundle()).schoolBlockProposal!;
    expect(p.days).toHaveLength(5);

    const mon = p.days.find((d) => d.date === "2026-06-15")!;
    const tue = p.days.find((d) => d.date === null && d.weekdayIndex === "1")!;
    const wed = p.days.find((d) => d.date === "2026-06-17")!;
    const thu = p.days.find((d) => d.date === "2026-06-18")!;
    const fri = p.days.find((d) => d.date === "2026-06-19")!;

    // Mandag: tidsfestet per_audience bokinnlevering + eget common details-item.
    const monClass = mon.contentItems[0]!;
    expect(monClass.audienceScope).toBe("per_audience");
    expect(monClass.audienceEntries[0]!.classCodes).toEqual(["2STC"]);
    expect(monClass.audienceEntries[0]!.start).toBe("10:30");
    expect(monClass.audienceEntries[0]!.end).toBe("11:00");
    expect(mon.contentItems.some((i) => i.audienceScope === "common")).toBe(true);

    // Tirsdag: ett common-item, ingen review fra common.
    expect(tue.contentItems).toHaveLength(1);
    expect(tue.contentItems[0]!.audienceScope).toBe("common");
    expect(tue.contentItems[0]!.sourceText).toBe("Klasseavslutning for 2STC (tid avtales med lærer).");
    expect(tue.contentItems[0]!.reviewFlags).toEqual([]);

    // Onsdag: oppmøtetekst som common — ingen adjust_start, ingen commonSchedule.
    expect(wed.contentItems).toHaveLength(1);
    expect(wed.contentItems[0]!.commonSchedule).toBeNull();
    expect(wed.dayOperation).toEqual({ op: "none" });

    // Torsdag: to per_audience-items (pulje + egen 2STC-rad).
    expect(thu.contentItems).toHaveLength(2);
    expect(thu.contentItems.every((i) => i.audienceScope === "per_audience")).toBe(true);

    // Fredag: ett samlet common-item, ingen replace_day/alternative_program.
    expect(fri.contentItems).toHaveLength(1);
    expect(fri.contentItems[0]!.sourceText).toBe("Siste skoledag. Opplegg 09.00-12.00.");
    expect(fri.contentItems[0]!.contentType).not.toBe("alternative_program");
    expect(fri.contentItems[0]!.commonSchedule).toBeNull();

    for (const d of p.days) {
      expect(d.dayOperation).toEqual({ op: "none" });
      expect(d.dayResolution).toBe("enrich_only");
      expect(d.blockTitle).toBeNull();
    }
  });

  it("uoppløst child-kontekst gir review_required + child_class_unresolved", async () => {
    const p = (await schoolBundle({ knownPersons: [] })).schoolBlockProposal!;
    expect(p.personId).toBeNull();
    expect(p.classCode).toBeNull();
    expect(p.structureStatus).toBe("review_required");
    expect(p.reviewFlags.some((f) => f.code === "child_class_unresolved")).toBe(true);

    // Common-items produserer fortsatt ingen egne review-flagg.
    const commons = p.days.flatMap((d) => d.contentItems).filter((i) => i.audienceScope === "common");
    expect(commons.length).toBeGreaterThan(0);
    for (const c of commons) expect(c.reviewFlags).toEqual([]);
  });

  it("documentKind-gating: ingen andre typer emitterer nøkkelen (heller ikke i JSON)", async () => {
    const kinds: Array<DocKind | undefined> = [
      undefined,
      "auto",
      "activity_plan",
      "event_doc",
      "timetable",
      "text",
    ];
    for (const kind of kinds) {
      const bundle = await bundleOf(makeSchoolBlockWeekResult(), kind);
      expect("schoolBlockProposal" in bundle, `kind=${kind}`).toBe(false);
      expect(JSON.stringify(bundle), `kind=${kind}`).not.toContain("schoolBlockProposal");
    }
  });

  it("toppnivåplassering: ikke i items, og intet item har kind 'school_block'", async () => {
    const bundle = await schoolBundle();
    expect(bundle.schoolBlockProposal).toBeTruthy();
    expect(bundle.items.some((i) => i.kind === "school_block")).toBe(false);
    expect(JSON.stringify(bundle.items)).not.toContain("school_block");
  });

  it("to kall: ulike UUID-er, men identisk semantisk proposal ellers", async () => {
    const a = (await schoolBundle()).schoolBlockProposal!;
    const b = (await schoolBundle()).schoolBlockProposal!;
    expect(a.proposalId).toMatch(UUID_RE);
    expect(b.proposalId).toMatch(UUID_RE);
    expect(b.proposalId).not.toBe(a.proposalId); // per-kjøring instans-ID
    expect(withoutProposalId(b)).toEqual(withoutProposalId(a)); // resten er deterministisk
  });

  it("renhet: verken resultIn eller portalImport muteres", async () => {
    const result = makeSchoolBlockWeekResult();
    const ctx = MATCHED_CTX();
    const resultSnapshot = JSON.stringify(result);
    const ctxSnapshot = JSON.stringify(ctx);

    const bundle = await bundleOf(result, "school", ctx);

    expect(JSON.stringify(result)).toBe(resultSnapshot);
    expect(JSON.stringify(ctx)).toBe(ctxSnapshot);
    // Eksisterende klassefiltrerte konsumenter bygger fortsatt sin output.
    expect(Array.isArray(bundle.items)).toBe(true);
    expect(bundle.schoolBlockProposal).toBeTruthy();
  });
});

describe("schoolBlockProposal — dagsoperasjoner gjennom portalen", () => {
  async function opsBundle(): Promise<Bundle> {
    return bundleOf(makeSchoolBlockWeekResultWithDayOperations(), "school", MATCHED_CTX());
  }

  it("onsdag → adjust_start 10:30 (hours_adjusted); fredag → replace_day/activity_day 09:00–12:00 (full_replace)", async () => {
    const p = (await opsBundle()).schoolBlockProposal!;

    const wed = p.days.find((d) => d.date === "2026-06-17")!;
    expect(wed.dayOperation).toMatchObject({ op: "adjust_start", effectiveStart: "10:30" });
    expect(wed.dayResolution).toBe("hours_adjusted");

    const fri = p.days.find((d) => d.date === "2026-06-19")!;
    expect(fri.dayOperation).toMatchObject({
      op: "replace_day",
      activityKind: "activity_day",
      effectiveStart: "09:00",
      effectiveEnd: "12:00",
    });
    expect(fri.dayResolution).toBe("full_replace");
  });

  it("mandag/tirsdag/torsdag beholder none/enrich_only (ingen signaler)", async () => {
    const p = (await opsBundle()).schoolBlockProposal!;
    const mon = p.days.find((d) => d.date === "2026-06-15")!;
    const tue = p.days.find((d) => d.date === null && d.weekdayIndex === "1")!;
    const thu = p.days.find((d) => d.date === "2026-06-18")!;
    for (const d of [mon, tue, thu]) {
      expect(d.dayOperation).toEqual({ op: "none" });
      expect(d.dayResolution).toBe("enrich_only");
    }
  });

  it("eksisterende content-items og classScheduleEntries-audience er UENDRET av signalene", async () => {
    const withOps = (await opsBundle()).schoolBlockProposal!;
    const without = (await bundleOf(makeSchoolBlockWeekResult(), "school", MATCHED_CTX()))
      .schoolBlockProposal!;

    // Torsdagens pulje beholder alle tre klassekoder + egen 2STC-rad uendret.
    const thu = withOps.days.find((d) => d.date === "2026-06-18")!;
    const pulje = thu.contentItems.find((i) => i.audienceEntries[0]?.classCodes.length === 3)!;
    expect(pulje.audienceEntries[0]!.classCodes).toEqual(["2STA", "2STC", "2STE"]);

    // contentItems er identiske med/uten signaler (signaler rører kun dayOperation/dayResolution).
    for (const d of withOps.days) {
      const match = without.days.find((x) => x.dayId === d.dayId)!;
      expect(d.contentItems).toEqual(match.contentItems);
    }
  });

  it("ingen tid/operasjon lekker mellom dager (kun de to signaldagene endres)", async () => {
    const p = (await opsBundle()).schoolBlockProposal!;
    const changed = p.days.filter((d) => d.dayOperation.op !== "none").map((d) => d.date);
    expect(new Set(changed)).toEqual(new Set(["2026-06-17", "2026-06-19"]));
  });

  it("andre documentKinds emitterer ikke schoolBlockProposal pga. dette feltet", async () => {
    for (const kind of ["auto", "activity_plan", "event_doc", "timetable", "text"] as const) {
      const bundle = await bundleOf(makeSchoolBlockWeekResultWithDayOperations(), kind);
      expect("schoolBlockProposal" in bundle, `kind=${kind}`).toBe(false);
    }
  });
});
