/**
 * Generelle tester for den kanoniske skoleinnholdsmodellen + normalisereren. Bruker eksplisitte,
 * generelle fixtures (IKKE den konkrete uka 15.–19. juni) og dekker de tre nivåene (dag/fag/
 * audience), konservativ degradering, deterministisk sourceId/itemId, deduplisering, sortering og
 * robusthet. Ingen produksjonsflyt konsumerer kontrakten ennå.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeCanonicalSchoolContentDraft,
  type RawCanonicalSchoolContentInput,
  type RawCanonicalSchoolDay,
  type RawCanonicalSchoolItem,
} from "@/lib/school-content-canonical";
import type { SchoolBlockDayOperation } from "@/lib/types";

/** Cast-helper for runtime-ugyldig dagsoperasjon (fremtidig ukjent input). */
const op = (o: unknown): SchoolBlockDayOperation => o as unknown as SchoolBlockDayOperation;

function draft(days: RawCanonicalSchoolDay[], overrides: Partial<RawCanonicalSchoolContentInput> = {}) {
  return normalizeCanonicalSchoolContentDraft({ originalSourceType: "text", days, ...overrides });
}
function day(partial: RawCanonicalSchoolDay): RawCanonicalSchoolDay {
  return { ...partial, items: partial.items ?? [] };
}
function item(partial: Partial<RawCanonicalSchoolItem> = {}): RawCanonicalSchoolItem {
  return { ...partial, placement: partial.placement ?? "day" };
}

describe("kanonisk kontrakt — toppnivå", () => {
  it("tomt/mangler days gir tom draft, complete", () => {
    expect(normalizeCanonicalSchoolContentDraft({ originalSourceType: "text" }).days).toEqual([]);
    const d = draft([]);
    expect(d.days).toEqual([]);
    expect(d.structureStatus).toBe("complete");
    expect(d.schemaVersion).toBe("1.0.0");
  });

  it("defaulter personMatchStatus, sourceTitle, originalSourceType", () => {
    const d = draft([]);
    expect(d.personMatchStatus).toBe("not_specified");
    expect(d.sourceTitle).toBe("Skoleinformasjon");
    expect(d.originalSourceType).toBe("text");
  });
});

describe("A — dagsnivå", () => {
  it("generell dagsmelding uten fag havner i generalDayMessages", () => {
    const d = draft([day({ date: "2026-03-02", items: [item({ sourceText: "Husk gymtøy" })] })]);
    const day0 = d.days[0]!;
    expect(day0.subjectItems).toEqual([]);
    expect(day0.audienceItems).toEqual([]);
    expect(day0.generalDayMessages).toHaveLength(1);
    expect(day0.generalDayMessages[0]!.subjectKey).toBeNull();
    expect(day0.generalDayMessages[0]!.sourceText).toBe("Husk gymtøy");
  });

  it("senere skolestart → dayOperation adjust_start, dayResolution hours_adjusted", () => {
    const d = draft([
      day({
        date: "2026-03-02",
        dayOperation: { op: "adjust_start", effectiveStart: "10:30", reason: null, confidence: 0.9 },
      }),
    ]);
    expect(d.days[0]!.dayOperation).toMatchObject({ op: "adjust_start", effectiveStart: "10:30" });
    expect(d.days[0]!.dayResolution).toBe("hours_adjusted");
  });

  it("hele dagen erstattet → full_replace", () => {
    const d = draft([
      day({
        date: "2026-03-06",
        dayOperation: {
          op: "replace_day",
          activityKind: "activity_day",
          effectiveStart: "09:00",
          effectiveEnd: "12:00",
          reason: null,
          confidence: 0.9,
        },
      }),
    ]);
    expect(d.days[0]!.dayResolution).toBe("full_replace");
  });

  it("samme melding på to ulike dager får ULIK sourceId", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ sourceText: "Fri i dag" })] }),
      day({ date: "2026-03-03", items: [item({ sourceText: "Fri i dag" })] }),
    ]);
    const a = d.days.find((x) => x.date === "2026-03-02")!.generalDayMessages[0]!;
    const b = d.days.find((x) => x.date === "2026-03-03")!.generalDayMessages[0]!;
    expect(a.sourceId).not.toBe(b.sourceId);
  });
});

describe("B — fag-/øktnivå", () => {
  it("eksplisitt subjectKey 'matematikk' beholdes som subject-item", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ placement: "subject", subjectKey: "matematikk", contentType: "homework", sourceText: "Les s. 40" })] }),
    ]);
    const si = d.days[0]!.subjectItems;
    expect(si).toHaveLength(1);
    expect(si[0]!.subjectKey).toBe("matematikk");
    expect(si[0]!.contentType).toBe("homework");
  });

  it("eksplisitt fagnavn «Matte» normaliseres til matematikk", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ placement: "subject", subject: "Matte", sourceText: "Prøve" })] }),
    ]);
    const si = d.days[0]!.subjectItems[0]!;
    expect(si.subjectKey).toBe("matematikk");
    expect(si.subject).toBe("Matematikk");
  });

  it("lekse og prøve kan representeres som ulike contentTypes (begge beholdt)", () => {
    const d = draft([
      day({
        date: "2026-03-02",
        items: [
          item({ placement: "subject", subjectKey: "norsk", contentType: "homework", sourceText: "Les kap 3" }),
          item({ placement: "subject", subjectKey: "norsk", contentType: "assessment", sourceText: "Prøve fredag" }),
        ],
      }),
    ]);
    const types = d.days[0]!.subjectItems.map((i) => i.contentType).sort();
    expect(types).toEqual(["assessment", "homework"]);
  });

  it("flere elementer under samme fag beholdes som separate fakta", () => {
    const d = draft([
      day({
        date: "2026-03-02",
        items: [
          item({ placement: "subject", subjectKey: "engelsk", contentType: "homework", sourceText: "Glossary" }),
          item({ placement: "subject", subjectKey: "engelsk", contentType: "homework", sourceText: "Read chapter 2" }),
        ],
      }),
    ]);
    expect(d.days[0]!.subjectItems).toHaveLength(2);
  });

  it("subject-item uten sikker fagidentitet degraderes til dagsinformasjon + ambiguous_subject", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ placement: "subject", subject: "Ukjentfag", sourceText: "Noe skjer" })] }),
    ]);
    const day0 = d.days[0]!;
    expect(day0.subjectItems).toEqual([]);
    expect(day0.generalDayMessages).toHaveLength(1);
    expect(day0.generalDayMessages[0]!.subjectKey).toBeNull();
    expect(day0.generalDayMessages[0]!.sourceText).toBe("Noe skjer"); // sourceText bevart
    expect(day0.reviewFlags.some((f) => f.code === "ambiguous_subject")).toBe(true);
    expect(d.structureStatus).toBe("review_required");
  });

  it("ukjent fag kobles ikke til en tilfeldig time (subjectKey forblir null)", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ placement: "subject", subject: "Blæ", start: "10:00", sourceText: "x" })] }),
    ]);
    const deg = d.days[0]!.generalDayMessages[0]!;
    expect(deg.subjectKey).toBeNull();
    expect(deg.subject).toBeNull();
  });
});

describe("C — audience-/gruppenivå", () => {
  it("klasse/pulje med gyldig tid og rom beholdes i audienceItems", () => {
    const d = draft([
      day({
        date: "2026-03-02",
        items: [
          item({
            placement: "audience",
            audienceEntries: [{ classCodes: ["2STC"], pulje: "Pulje 1", start: "10:00", end: "11:00", room: "A1" }],
            sourceText: "Pulje 1",
          }),
        ],
      }),
    ]);
    const ai = d.days[0]!.audienceItems;
    expect(ai).toHaveLength(1);
    expect(ai[0]!.audienceEntries[0]!.classCodes).toEqual(["2STC"]);
    expect(ai[0]!.audienceEntries[0]!.start).toBe("10:00");
    expect(ai[0]!.audienceEntries[0]!.room).toBe("A1");
  });

  it("flere audience entries beholdes", () => {
    const d = draft([
      day({
        date: "2026-03-02",
        items: [
          item({
            placement: "audience",
            audienceEntries: [
              { classCodes: ["2STA"], start: "09:00", end: "10:00" },
              { classCodes: ["2STC"], start: "10:30", end: "11:30" },
            ],
          }),
        ],
      }),
    ]);
    expect(d.days[0]!.audienceItems[0]!.audienceEntries).toHaveLength(2);
  });

  it("audience-item uten gyldige entries degraderes sikkert (ikke droppet)", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ placement: "audience", audienceEntries: [{ classCodes: [] }], sourceText: "Uklart" })] }),
    ]);
    const day0 = d.days[0]!;
    expect(day0.audienceItems).toEqual([]);
    expect(day0.generalDayMessages).toHaveLength(1);
    expect(day0.generalDayMessages[0]!.sourceText).toBe("Uklart");
    expect(day0.reviewFlags.some((f) => f.code === "low_confidence")).toBe(true);
  });
});

describe("deduplisering", () => {
  it("identisk source fact på samme dag dedupliseres", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ sourceText: "Fri" }), item({ sourceText: "Fri" })] }),
    ]);
    expect(d.days[0]!.generalDayMessages).toHaveLength(1);
  });

  it("samme tekst med FORSKJELLIG contentType dedupliseres IKKE", () => {
    const d = draft([
      day({
        date: "2026-03-02",
        items: [
          item({ placement: "subject", subjectKey: "norsk", contentType: "homework", sourceText: "Kap 4" }),
          item({ placement: "subject", subjectKey: "norsk", contentType: "assessment", sourceText: "Kap 4" }),
        ],
      }),
    ]);
    expect(d.days[0]!.subjectItems).toHaveLength(2);
  });

  it("samme tekst på ULIKE dager dedupliseres ikke på tvers", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ sourceText: "Fri" })] }),
      day({ date: "2026-03-03", items: [item({ sourceText: "Fri" })] }),
    ]);
    expect(d.days.flatMap((x) => x.generalDayMessages)).toHaveLength(2);
  });

  it("ulik inputrekkefølge gir identisk output", () => {
    const a = item({ placement: "subject", subjectKey: "matematikk", contentType: "homework", sourceText: "A" });
    const b = item({ placement: "subject", subjectKey: "norsk", contentType: "assessment", sourceText: "B" });
    const d1 = draft([day({ date: "2026-03-02", items: [a, b] })]);
    const d2 = draft([day({ date: "2026-03-02", items: [b, a] })]);
    expect(d1).toEqual(d2);
  });
});

describe("robusthet", () => {
  it("null/undefined/tomme arrays håndteres uten kast", () => {
    expect(() => draft([day({ date: "2026-03-02", items: undefined })])).not.toThrow();
    const d = draft([day({ date: "2026-03-02" })]);
    expect(d.days[0]!.subjectItems).toEqual([]);
  });

  it("ugyldig weekdayIndex faller tilbake til dayLabel-avledet ukedag", () => {
    const d = draft([day({ weekdayIndex: "9", dayLabel: "Onsdag", items: [item({ sourceText: "x" })] })]);
    expect(d.days[0]!.weekdayIndex).toBe("2");
    expect(d.days[0]!.dayLabel).toBe("Onsdag");
  });

  it("dag uten noe dagsscope hoppes over (ingen oppdiktet dag)", () => {
    const d = draft([day({ weekdayIndex: "9", items: [item({ sourceText: "x" })] })]);
    expect(d.days).toEqual([]);
  });

  it("motstridende dato og weekdayIndex: datoen vinner + low_confidence review", () => {
    // 2026-06-17 er onsdag ("2"); weekdayIndex "0" (mandag) er inkonsistent.
    const d = draft([day({ date: "2026-06-17", weekdayIndex: "0", items: [item({ sourceText: "x" })] })]);
    expect(d.days[0]!.weekdayIndex).toBe("2");
    expect(d.days[0]!.reviewFlags.some((f) => f.code === "low_confidence")).toBe(true);
    expect(d.structureStatus).toBe("review_required");
  });

  it("ugyldig klokkeslett settes til null (konstrueres aldri)", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ placement: "subject", subjectKey: "norsk", start: "99:99", end: "tull", sourceText: "x" })] }),
    ]);
    const si = d.days[0]!.subjectItems[0]!;
    expect(si.start).toBeNull();
    expect(si.end).toBeNull();
  });

  it("muterer ikke input", () => {
    const input: RawCanonicalSchoolContentInput = {
      originalSourceType: "text",
      days: [day({ date: "2026-03-02", items: [item({ placement: "subject", subject: "Matte", sourceText: "x" })] })],
    };
    const snapshot = JSON.stringify(input);
    normalizeCanonicalSchoolContentDraft(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("deterministiske IDs: to kjøringer gir identisk output", () => {
    const build = () =>
      draft([
        day({
          date: "2026-03-02",
          items: [
            item({ placement: "subject", subjectKey: "matematikk", contentType: "homework", sourceText: "Les s. 40" }),
            item({ placement: "audience", audienceEntries: [{ classCodes: ["2STC"], start: "10:00", end: "11:00" }] }),
          ],
        }),
      ]);
    expect(build()).toEqual(build());
  });

  it("stabil sortering: kjent tid før null; dager datofestet før udaterte", () => {
    const d = draft([
      day({ dayLabel: "Fredag", weekdayIndex: "4", items: [item({ sourceText: "u1" })] }),
      day({ date: "2026-03-02", items: [item({ sourceText: "d1" })] }),
    ]);
    expect(d.days[0]!.date).toBe("2026-03-02"); // datofestet først
    expect(d.days[1]!.date).toBeNull();
  });
});

describe("sourceId-invarianten (kilde-fakta uavhengig av klassifisering)", () => {
  it("samme tekst+dag som day og som subject → samme sourceId, ulik itemId", () => {
    const asDay = draft([day({ date: "2026-03-02", items: [item({ placement: "day", sourceText: "Prøve i morgen" })] })]);
    const asSubject = draft([
      day({ date: "2026-03-02", items: [item({ placement: "subject", subjectKey: "norsk", sourceText: "Prøve i morgen" })] }),
    ]);
    const g = asDay.days[0]!.generalDayMessages[0]!;
    const s = asSubject.days[0]!.subjectItems[0]!;
    expect(g.sourceId).toBe(s.sourceId);
    expect(g.itemId).not.toBe(s.itemId);
  });

  it("samme tekst+dag, én med løst subjectKey og én uten → samme sourceId", () => {
    const d = draft([
      day({
        date: "2026-03-02",
        items: [
          item({ placement: "subject", subjectKey: "matematikk", contentType: "homework", sourceText: "Les s. 40" }),
          item({ placement: "day", contentType: "message", sourceText: "Les s. 40" }),
        ],
      }),
    ]);
    const s = d.days[0]!.subjectItems[0]!;
    const g = d.days[0]!.generalDayMessages[0]!;
    expect(s.sourceId).toBe(g.sourceId);
    expect(s.itemId).not.toBe(g.itemId);
  });

  it("samme tekst på to forskjellige dager → ulik sourceId", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ sourceText: "Fri" })] }),
      day({ date: "2026-03-03", items: [item({ sourceText: "Fri" })] }),
    ]);
    const a = d.days.find((x) => x.date === "2026-03-02")!.generalDayMessages[0]!;
    const b = d.days.find((x) => x.date === "2026-03-03")!.generalDayMessages[0]!;
    expect(a.sourceId).not.toBe(b.sourceId);
  });

  it("samme dag+tekst, ulik eksplisitt sourceRef → ulik sourceId", () => {
    const d = draft([
      day({
        date: "2026-03-02",
        items: [
          item({ placement: "day", sourceText: "Møte", sourceRef: "ref-a" }),
          item({ placement: "day", sourceText: "Møte", sourceRef: "ref-b" }),
        ],
      }),
    ]);
    const msgs = d.days[0]!.generalDayMessages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.sourceId).not.toBe(msgs[1]!.sourceId);
  });

  it("sourceRef prioriteres, evidence før sourceText som kildegrunnlag", () => {
    // sourceRef satt → sourceId uavhengig av sourceText.
    const withRef = draft([day({ date: "2026-03-02", items: [item({ placement: "day", sourceText: "T1", sourceRef: "R" })] })]);
    const withRefOtherText = draft([day({ date: "2026-03-02", items: [item({ placement: "day", sourceText: "T2", sourceRef: "R" })] })]);
    expect(withRef.days[0]!.generalDayMessages[0]!.sourceId).toBe(
      withRefOtherText.days[0]!.generalDayMessages[0]!.sourceId,
    );
  });
});

describe("bevaring ved konservativ degradering", () => {
  it("unresolved subject beholder contentType + sections + evidence + tid + eksisterende flagg; nytt ambiguous_subject med dayId+itemId", () => {
    const d = draft([
      day({
        date: "2026-03-02",
        items: [
          item({
            placement: "subject",
            contentType: "homework",
            subject: "Ukjentfag",
            sourceText: "Les noe",
            evidence: "kilde-linje",
            sections: { lekse: ["L1"] },
            start: "10:00",
            confidence: 0.7,
            reviewFlags: [{ code: "child_class_unresolved", message: "eksisterende", scope: {} }],
          }),
        ],
      }),
    ]);
    const g = d.days[0]!.generalDayMessages[0]!;
    expect(g.placement).toBe("day");
    expect(g.contentType).toBe("homework"); // IKKE degradert til message
    expect(g.subjectKey).toBeNull();
    expect(g.subject).toBeNull();
    expect(g.customLabel).toBe("Ukjentfag"); // uløst fagtekst bevart som label
    expect(g.sourceText).toBe("Les noe");
    expect(g.evidence).toBe("kilde-linje");
    expect(g.sections).toEqual({ lekse: ["L1"] });
    expect(g.start).toBe("10:00");
    expect(g.confidence).toBe(0.7);
    // eksisterende flagg beholdt + nytt uten duplikat
    expect(g.reviewFlags.some((f) => f.code === "child_class_unresolved")).toBe(true);
    const amb = g.reviewFlags.find((f) => f.code === "ambiguous_subject")!;
    expect(amb).toBeTruthy();
    expect(amb.scope.dayId).toBe(d.days[0]!.dayId);
    expect(amb.scope.itemId).toBe(g.itemId);
  });

  it("unresolved assessment beholder contentType assessment", () => {
    const d = draft([day({ date: "2026-03-02", items: [item({ placement: "subject", contentType: "assessment", subject: "Blæ", sourceText: "x" })] })]);
    expect(d.days[0]!.generalDayMessages[0]!.contentType).toBe("assessment");
  });

  it("unresolved audience beholder opprinnelig contentType + sourceText + low_confidence", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ placement: "audience", contentType: "reminder", audienceEntries: [{ classCodes: [] }], sourceText: "Uklart" })] }),
    ]);
    const g = d.days[0]!.generalDayMessages[0]!;
    expect(g.contentType).toBe("reminder");
    expect(g.sourceText).toBe("Uklart");
    expect(g.reviewFlags.some((f) => f.code === "low_confidence")).toBe(true);
  });

  it("evidence bevares på item og dag (ikke alltid null)", () => {
    const d = draft([day({ date: "2026-03-02", evidence: "dag-kilde", items: [item({ placement: "day", sourceText: "x", evidence: "item-kilde" })] })]);
    expect(d.days[0]!.evidence).toBe("dag-kilde");
    expect(d.days[0]!.generalDayMessages[0]!.evidence).toBe("item-kilde");
  });
});

describe("sammenslåing av dager med samme scope", () => {
  it("to raw days med samme dato → én kanonisk dag med items fra begge", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ sourceText: "A" })] }),
      day({ date: "2026-03-02", items: [item({ sourceText: "B" })] }),
    ]);
    expect(d.days).toHaveLength(1);
    expect(d.days[0]!.generalDayMessages.map((i) => i.sourceText).sort()).toEqual(["A", "B"]);
  });

  it("identiske items på tvers av de to dagene dedupliseres", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ sourceText: "A" })] }),
      day({ date: "2026-03-02", items: [item({ sourceText: "A" })] }),
    ]);
    expect(d.days[0]!.generalDayMessages).toHaveLength(1);
  });

  it("inputrekkefølge påvirker ikke sammenslått output", () => {
    const a = day({ date: "2026-03-02", items: [item({ sourceText: "A" })] });
    const b = day({ date: "2026-03-02", items: [item({ sourceText: "B" })] });
    expect(draft([a, b])).toEqual(draft([b, a]));
  });

  it("none + adjust_start gir adjust_start", () => {
    const d = draft([
      day({ date: "2026-03-02", dayOperation: { op: "none" } }),
      day({ date: "2026-03-02", dayOperation: { op: "adjust_start", effectiveStart: "10:30", reason: null, confidence: 0.9 } }),
    ]);
    expect(d.days[0]!.dayOperation).toMatchObject({ op: "adjust_start", effectiveStart: "10:30" });
  });

  it("identiske adjust_start gir én (ingen konflikt)", () => {
    const same: SchoolBlockDayOperation = { op: "adjust_start", effectiveStart: "10:30", reason: null, confidence: 0.9 };
    const d = draft([
      day({ date: "2026-03-02", dayOperation: same }),
      day({ date: "2026-03-02", dayOperation: { ...same } }),
    ]);
    expect(d.days[0]!.dayOperation).toMatchObject({ op: "adjust_start", effectiveStart: "10:30" });
    expect(d.days[0]!.reviewFlags.some((f) => f.code === "conflicting_actions")).toBe(false);
  });

  it("motstridende adjust_start og replace_day → none + conflicting_actions + review_required", () => {
    const d = draft([
      day({ date: "2026-03-02", dayOperation: { op: "adjust_start", effectiveStart: "10:30", reason: null, confidence: 0.9 } }),
      day({
        date: "2026-03-02",
        dayOperation: { op: "replace_day", activityKind: "activity_day", effectiveStart: "09:00", effectiveEnd: "12:00", reason: null, confidence: 0.9 },
      }),
    ]);
    expect(d.days[0]!.dayOperation).toEqual({ op: "none" });
    expect(d.days[0]!.reviewFlags.some((f) => f.code === "conflicting_actions")).toBe(true);
    expect(d.structureStatus).toBe("review_required");
  });

  it("kombinerer evidence deterministisk (unikt, sortert)", () => {
    const d = draft([
      day({ date: "2026-03-02", evidence: "ev-b" }),
      day({ date: "2026-03-02", evidence: "ev-a" }),
    ]);
    expect(d.days[0]!.evidence).toBe("ev-a\nev-b");
  });
});

describe("dayOperation-normalisering", () => {
  it("gyldig adjust_start normaliseres (10.30 → 10:30, reason trimmet, hours_adjusted)", () => {
    const d = draft([day({ date: "2026-03-02", dayOperation: { op: "adjust_start", effectiveStart: "10.30", reason: "  møt  ", confidence: 0.8 } })]);
    expect(d.days[0]!.dayOperation).toEqual({ op: "adjust_start", effectiveStart: "10:30", reason: "møt", confidence: 0.8 });
    expect(d.days[0]!.dayResolution).toBe("hours_adjusted");
  });

  it("ugyldig adjust_start-tid degraderes til none + missing_time", () => {
    const d = draft([day({ date: "2026-03-02", dayOperation: { op: "adjust_start", effectiveStart: "99:99", reason: null, confidence: 0.5 } })]);
    expect(d.days[0]!.dayOperation).toEqual({ op: "none" });
    expect(d.days[0]!.reviewFlags.some((f) => f.code === "missing_time")).toBe(true);
    expect(d.structureStatus).toBe("review_required");
  });

  it("ugyldig adjust_end-tid degraderes til none + missing_time", () => {
    const d = draft([day({ date: "2026-03-02", dayOperation: { op: "adjust_end", effectiveEnd: "tull", reason: null, confidence: 0.5 } })]);
    expect(d.days[0]!.dayOperation).toEqual({ op: "none" });
    expect(d.days[0]!.reviewFlags.some((f) => f.code === "missing_time")).toBe(true);
  });

  it("confidence clampes til 0–1", () => {
    const d = draft([day({ date: "2026-03-02", dayOperation: { op: "adjust_start", effectiveStart: "08:00", reason: null, confidence: 5 } })]);
    const o = d.days[0]!.dayOperation;
    expect(o.op === "adjust_start" && o.confidence).toBe(1);
  });

  it("ukjent activityKind → other + unrecognized_activity, fortsatt full_replace", () => {
    const d = draft([
      day({ date: "2026-03-02", dayOperation: op({ op: "replace_day", activityKind: "party_day", effectiveStart: null, effectiveEnd: null, reason: null, confidence: 0.9 }) }),
    ]);
    const o = d.days[0]!.dayOperation;
    expect(o.op === "replace_day" && o.activityKind).toBe("other");
    expect(d.days[0]!.reviewFlags.some((f) => f.code === "unrecognized_activity")).toBe(true);
    expect(d.days[0]!.dayResolution).toBe("full_replace");
  });

  it("runtime-ugyldig op degraderes til none (via cast)", () => {
    const d = draft([day({ date: "2026-03-02", dayOperation: op({ op: "bogus" }) })]);
    expect(d.days[0]!.dayOperation).toEqual({ op: "none" });
    expect(d.days[0]!.dayResolution).toBe("enrich_only");
  });
});

describe("runtime-enum-validering (fremtidig ukjent input via cast)", () => {
  it("ugyldig placement → 'day'", () => {
    const d = draft([day({ date: "2026-03-02", items: [{ placement: "weird", sourceText: "x" } as unknown as RawCanonicalSchoolItem] })]);
    expect(d.days[0]!.generalDayMessages).toHaveLength(1);
  });

  it("ugyldig contentType → 'message'", () => {
    const d = draft([day({ date: "2026-03-02", items: [{ placement: "day", contentType: "weird", sourceText: "x" } as unknown as RawCanonicalSchoolItem] })]);
    expect(d.days[0]!.generalDayMessages[0]!.contentType).toBe("message");
  });

  it("ugyldig action → 'enrich'", () => {
    const d = draft([day({ date: "2026-03-02", items: [{ placement: "day", action: "weird", sourceText: "x" } as unknown as RawCanonicalSchoolItem] })]);
    expect(d.days[0]!.generalDayMessages[0]!.action).toBe("enrich");
  });

  it("ugyldig personMatchStatus → 'not_specified'", () => {
    const d = normalizeCanonicalSchoolContentDraft({
      originalSourceType: "text",
      personMatchStatus: "weird" as unknown as RawCanonicalSchoolContentInput["personMatchStatus"],
      days: [],
    });
    expect(d.personMatchStatus).toBe("not_specified");
  });

  it("ugyldig isChildAudience → null", () => {
    const d = draft([
      day({ date: "2026-03-02", items: [item({ placement: "audience", audienceEntries: [{ classCodes: ["2STC"], isChildAudience: "yes" as unknown as boolean }] })] }),
    ]);
    expect(d.days[0]!.audienceItems[0]!.audienceEntries[0]!.isChildAudience).toBeNull();
  });

  it("ugyldig review-kode droppes (lekker ikke ut i kontrakten)", () => {
    const d = draft([
      day({
        date: "2026-03-02",
        reviewFlags: [{ code: "weird", message: "m", scope: {} } as unknown as import("@/lib/types").SchoolBlockReviewFlag],
        items: [item({ sourceText: "x" })],
      }),
    ]);
    expect(d.days[0]!.reviewFlags.some((f) => (f.code as string) === "weird")).toBe(false);
  });
});

describe("rekkefølgeuavhengighet (determinisme)", () => {
  it("audience entries A–B vs B–A → deep-equal draft, uendret audienceEntryId/itemId", () => {
    const entA = { classCodes: ["2STA"], start: "09:00", end: "10:00", room: "A1" };
    const entB = { classCodes: ["2STC"], start: "10:30", end: "11:30", room: "B2" };
    const ab = draft([day({ date: "2026-03-02", items: [item({ placement: "audience", audienceEntries: [entA, entB] })] })]);
    const ba = draft([day({ date: "2026-03-02", items: [item({ placement: "audience", audienceEntries: [entB, entA] })] })]);
    expect(ab).toEqual(ba);
    // itemId er uendret av rekkefølge (audience-materialet sorteres i ID-en).
    expect(ab.days[0]!.audienceItems[0]!.itemId).toBe(ba.days[0]!.audienceItems[0]!.itemId);
  });

  it("klassekodevarianter ['2stc','2STC'] og ['2STC','2stc'] → identisk output", () => {
    const a = draft([day({ date: "2026-03-02", items: [item({ placement: "audience", audienceEntries: [{ classCodes: ["2stc", "2STC"] }] })] })]);
    const b = draft([day({ date: "2026-03-02", items: [item({ placement: "audience", audienceEntries: [{ classCodes: ["2STC", "2stc"] }] })] })]);
    expect(a).toEqual(b);
    expect(a.days[0]!.audienceItems[0]!.audienceEntries[0]!.classCodes).toEqual(["2STC"]);
  });

  it("duplikate items (samme itemId, ulik metadata) merges deterministisk i begge rekkefølger", () => {
    const A = item({
      placement: "subject",
      subjectKey: "matematikk",
      sourceRef: "R",
      confidence: 0.5,
      evidence: "ev-a",
      sections: { lekse: ["L1"] },
      subjectCandidates: [{ subjectKey: "matematikk", subject: "Matematikk", weight: 2 }],
      reviewFlags: [{ code: "low_confidence", message: "a", scope: {} }],
      sourceText: "TA",
    });
    const B = item({
      placement: "subject",
      subjectKey: "matematikk",
      sourceRef: "R",
      confidence: 0.9,
      evidence: "ev-b",
      sections: { lekse: ["L2"], husk: ["H"] },
      subjectCandidates: [{ subjectKey: "norsk", subject: "Norsk", weight: 1 }],
      reviewFlags: [{ code: "child_class_unresolved", message: "b", scope: {} }],
      sourceText: "TB",
    });
    const ab = draft([day({ date: "2026-03-02", items: [A, B] })]);
    const ba = draft([day({ date: "2026-03-02", items: [B, A] })]);
    expect(ab).toEqual(ba); // hovedkravet: normalize([A,B]) === normalize([B,A])

    const merged = ab.days[0]!.subjectItems;
    expect(merged).toHaveLength(1); // bare ett kanonisk item
    const m = merged[0]!;
    expect(m.confidence).toBe(0.9); // høyeste
    expect(m.evidence).toBe("ev-a\nev-b"); // fra begge, unikt+sortert
    expect(m.sections.lekse).toEqual(["L1", "L2"]); // fra begge, unikt+sortert
    expect(m.sections.husk).toEqual(["H"]);
    expect(m.reviewFlags.some((f) => f.code === "low_confidence")).toBe(true);
    expect(m.reviewFlags.some((f) => f.code === "child_class_unresolved")).toBe(true);
    // candidates fra begge, dedup + sortert (weight desc)
    expect(m.subjectCandidates!.map((c) => c.subjectKey)).toEqual(["matematikk", "norsk"]);
  });
});

describe("fravær av mutable inputreferanser", () => {
  it("Variant A: mutasjon av input etter normalisering endrer ikke output", () => {
    const sectionsArr = ["L1"];
    const candidates = [{ subjectKey: "matematikk", subject: "Matematikk", weight: 1 }];
    const classCodes = ["2STC"];
    const input: RawCanonicalSchoolContentInput = {
      originalSourceType: "text",
      days: [
        day({
          date: "2026-03-02",
          items: [
            item({ placement: "subject", subjectKey: "matematikk", sections: { lekse: sectionsArr }, subjectCandidates: candidates, sourceText: "x" }),
            item({ placement: "audience", audienceEntries: [{ classCodes }] }),
          ],
        }),
      ],
    };
    const out = normalizeCanonicalSchoolContentDraft(input);
    const snapshot = JSON.stringify(out);
    // Muter rå input.
    sectionsArr.push("MUTERT");
    candidates.push({ subjectKey: "norsk", subject: "Norsk", weight: 9 });
    candidates[0]!.weight = 999;
    classCodes.push("9ZZ");
    expect(JSON.stringify(out)).toBe(snapshot); // output uendret
  });

  it("Variant B: mutasjon av output endrer ikke input", () => {
    const input: RawCanonicalSchoolContentInput = {
      originalSourceType: "text",
      days: [
        day({
          date: "2026-03-02",
          reviewFlags: [{ code: "low_confidence", message: "m", scope: { dayId: "orig" } }],
          items: [item({ placement: "audience", audienceEntries: [{ classCodes: ["2STC"] }], reviewFlags: [{ code: "low_confidence", message: "im", scope: {} }] })],
        }),
      ],
    };
    const inputSnapshot = JSON.stringify(input);
    const out = normalizeCanonicalSchoolContentDraft(input);
    // Muter output-strukturer.
    out.days[0]!.audienceItems[0]!.audienceEntries[0]!.classCodes.push("MUT");
    out.days[0]!.reviewFlags.push({ code: "missing_time", message: "mut", scope: {} });
    if (out.days[0]!.reviewFlags[0]) out.days[0]!.reviewFlags[0]!.scope.dayId = "MUT";
    expect(JSON.stringify(input)).toBe(inputSnapshot); // input uendret
  });
});
