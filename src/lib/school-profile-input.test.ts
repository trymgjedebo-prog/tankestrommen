/**
 * Oppgave 9, steg 1 (server-mottak): validering av klient-sendt timeplan + at en MOTTATT
 * classCode faktisk filtrerer ukeplan-innhold gjennom toPortalBundle.
 *
 * Avgrensning: dette steget MOTTAR + validerer + tråder profilen. Ingen fag↔time-matching her.
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route";
import { validateClientSchoolWeeklyProfile } from "@/lib/ai/analyze-image";
import { parseRelevanceContextFromBody } from "@/lib/portal-import-person";
import { toPortalBundle } from "@/lib/portal-bundle";
import type { AIAnalysisResult, DayScheduleEntry } from "@/lib/types";

// Klientens ChildSchoolProfile-råform (Foreldre-Appen): weekdays nøklet "0".."4" = mandag..fredag.
const CLIENT_PROFILE = {
  gradeBand: "vg2",
  weekdays: {
    "0": {
      useSimpleDay: false,
      lessons: [
        { subjectKey: "matematikk", customLabel: "Matte R1", start: "08:30", end: "10:00", room: "A1", teacher: "NN" },
        { subjectKey: "norsk", customLabel: null, start: "10:15", end: "11:45" },
      ],
    },
    "4": { useSimpleDay: true, schoolStart: "08:30", schoolEnd: "13:00" },
  },
};

describe("validateClientSchoolWeeklyProfile (utrygg klient-input)", () => {
  it("godtar klientens ChildSchoolProfile-råform (0–4 nøkler + lessons)", () => {
    const p = validateClientSchoolWeeklyProfile(CLIENT_PROFILE);
    expect(p).not.toBeNull();
    expect(p!.weekdays["0"]).toBeDefined(); // mandag
    expect(p!.weekdays["4"]).toBeDefined(); // fredag
  });

  it("avviser ugyldig/utrygg input → null", () => {
    expect(validateClientSchoolWeeklyProfile(null)).toBeNull();
    expect(validateClientSchoolWeeklyProfile("ikke et objekt")).toBeNull();
    expect(validateClientSchoolWeeklyProfile(42)).toBeNull();
    expect(validateClientSchoolWeeklyProfile({})).toBeNull();
    expect(validateClientSchoolWeeklyProfile({ weekdays: {} })).toBeNull();
    // kun helg-nøkler → alle dager droppes → tom profil → null
    expect(
      validateClientSchoolWeeklyProfile({
        gradeBand: "vg2",
        weekdays: { lørdag: { useSimpleDay: true, schoolStart: "09:00", schoolEnd: "14:00" } },
      }),
    ).toBeNull();
  });

  it("end-to-end: parseRelevanceContextFromBody med EKTE validator", () => {
    const out = parseRelevanceContextFromBody(
      { classCode: "2STC", schoolProfile: CLIENT_PROFILE },
      validateClientSchoolWeeklyProfile,
    );
    expect(out?.classCode).toBe("2STC");
    expect(out?.schoolProfile?.weekdays["0"]).toBeDefined();
  });
});

function day(p: Partial<DayScheduleEntry> & Pick<DayScheduleEntry, "dayLabel">): DayScheduleEntry {
  return {
    dayLabel: p.dayLabel,
    date: p.date ?? null,
    time: p.time ?? null,
    details: p.details ?? null,
    highlights: p.highlights ?? [],
    rememberItems: p.rememberItems ?? [],
    deadlines: p.deadlines ?? [],
    notes: p.notes ?? [],
  };
}

function multiClassResult(): AIAnalysisResult {
  return {
    title: "Ukeplan uke 25",
    schedule: [],
    scheduleByDay: [
      day({
        dayLabel: "mandag",
        date: "15. juni 2026",
        highlights: ["Fellesmøte i auditoriet", "2STA: Matteprøve", "2STC: Gym"],
      }),
    ],
    location: null,
    description: "Ukeplan for klassen", // bevisst uten klassekoder, så differensialen er ren
    category: "beskjed" as AIAnalysisResult["category"],
    targetGroup: null,
    organizer: null,
    contactPerson: null,
    sourceUrl: null,
    confidence: 0.8,
    extractedText: { raw: "Ukeplan uke 25", language: "no", confidence: 0.8 },
  };
}

async function bundleBlob(relevanceContext?: { classCode?: string }): Promise<string> {
  const bundle = (await toPortalBundle(multiClassResult(), "text", undefined, false, {
    knownPersons: [],
    ...(relevanceContext ? { relevanceContext } : {}),
  })) as { items: unknown[] };
  return JSON.stringify(bundle.items);
}

describe("classCode-filtrering virker med MOTTATT kode (toPortalBundle)", () => {
  it("uten kode: andre-klasse-innhold er med; med mottatt 2STC: filtrert bort", async () => {
    const without = await bundleBlob();
    const withCode = await bundleBlob({ classCode: "2STC" });
    // Uten kode beholdes alt (tekst-gjetting filtrerer ikke innhold).
    expect(without).toContain("Matteprøve");
    // Med mottatt classCode droppes annen klasses innhold.
    expect(withCode).not.toContain("Matteprøve");
    expect(withCode).not.toContain("2STA");
  });
});
