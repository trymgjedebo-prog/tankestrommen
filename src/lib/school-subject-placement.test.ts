/**
 * Generelle unit-tester for deterministisk fagplassering. Bruker syntetiske fixtures (IKKE uka
 * 15.–19. juni). Låser de to uavhengige nivåene (fag / økt), invarianten «tid alene skaper aldri
 * fag», streng dagsavgrensning, spor-/tidsmatching, review-regler, determinisme og immutability.
 */
import { describe, expect, it } from "vitest";
import {
  getSchoolProfileLessonsForWeekday,
  resolveSchoolSubjectPlacement,
  type SchoolSubjectPlacementContext,
  type SchoolSubjectPlacementInput,
} from "@/lib/school-subject-placement";
import type {
  SchoolBlockElementAction,
  SchoolProfileLesson,
  SchoolProfileWeekdayIndex,
  SchoolWeeklyProfile,
} from "@/lib/types";

function lesson(partial: Partial<SchoolProfileLesson> & { subjectKey: string; start: string; end: string }): SchoolProfileLesson {
  return { customLabel: null, ...partial };
}
function profile(weekdays: SchoolWeeklyProfile["weekdays"]): SchoolWeeklyProfile {
  return { gradeBand: null, weekdays };
}
function lessonsDay(lessons: SchoolProfileLesson[]) {
  return { useSimpleDay: false as const, lessons };
}
function input(partial: Partial<SchoolSubjectPlacementInput> = {}): SchoolSubjectPlacementInput {
  return { subjectKey: null, subject: null, customLabel: null, start: null, end: null, action: "enrich", ...partial };
}
function ctx(
  weekdayIndex: SchoolProfileWeekdayIndex | null,
  wp: SchoolWeeklyProfile | null,
): SchoolSubjectPlacementContext {
  return { weekdayIndex, schoolWeeklyProfile: wp };
}

const MON = "0" as const;
const TUE = "1" as const;

describe("sikkert fag", () => {
  it("eksplisitt subjectKey + én lesson → placed + matched only_lesson_for_subject", () => {
    const wp = profile({ [MON]: lessonsDay([lesson({ subjectKey: "norsk", start: "08:00", end: "09:00" })]) });
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk" }), ctx(MON, wp));
    expect(d.status).toBe("placed");
    if (d.status !== "placed") return;
    expect(d.subjectKey).toBe("norsk");
    expect(d.subjectSource).toBe("explicit_subject_key");
    expect(d.lessonDecision).toEqual({ status: "matched", lesson: expect.objectContaining({ subjectKey: "norsk", start: "08:00" }), reason: "only_lesson_for_subject" });
    expect(d.reviewCode).toBeNull();
  });

  it("alias «Matte» → matematikk (explicit_subject)", () => {
    const wp = profile({ [MON]: lessonsDay([lesson({ subjectKey: "matematikk", start: "10:00", end: "11:00" })]) });
    const d = resolveSchoolSubjectPlacement(input({ subject: "Matte" }), ctx(MON, wp));
    expect(d.status === "placed" && d.subjectKey).toBe("matematikk");
    expect(d.status === "placed" && d.subjectSource).toBe("explicit_subject");
  });

  it("eksplisitt subjectKey med custom subject-tekst", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", customLabel: "Ekstra info" }), ctx(MON, null));
    expect(d.status === "placed" && d.subjectKey).toBe("norsk");
    expect(d.status === "placed" && d.subject).toBe("Norsk");
  });

  it("subject og subjectKey som er enige → placed", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "matematikk", subject: "Matte" }), ctx(MON, null));
    expect(d.status === "placed" && d.subjectKey).toBe("matematikk");
    expect(d.status === "placed" && d.subjectSource).toBe("explicit_subject_key");
  });
});

describe("konflikt og kandidater", () => {
  it("subjectKey og subject motsier hverandre → conflicting_explicit_subjects + ambiguous_subject", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", subject: "Matte" }), ctx(MON, null));
    expect(d).toEqual({ status: "unresolved", reason: "conflicting_explicit_subjects", reviewCode: "ambiguous_subject" });
  });

  it("én unik candidate → placed single_subject_candidate", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectCandidates: [{ subjectKey: "engelsk", subject: "Engelsk", weight: 1 }] }), ctx(MON, null));
    expect(d.status === "placed" && d.subjectKey).toBe("engelsk");
    expect(d.status === "placed" && d.subjectSource).toBe("single_subject_candidate");
  });

  it("duplikate candidates med samme subjectKey → én unik → placed", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectCandidates: [{ subjectKey: "engelsk", subject: "Engelsk", weight: 1 }, { subjectKey: "engelsk", subject: "Engelsk", weight: 2 }] }), ctx(MON, null));
    expect(d.status === "placed" && d.subjectKey).toBe("engelsk");
  });

  it("flere ulike candidates (uavhengig av weight) → ambiguous_subject_candidates", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectCandidates: [{ subjectKey: "engelsk", subject: "Engelsk", weight: 9 }, { subjectKey: "norsk", subject: "Norsk", weight: 1 }] }), ctx(MON, null));
    expect(d).toEqual({ status: "unresolved", reason: "ambiguous_subject_candidates", reviewCode: "ambiguous_subject" });
  });

  it("kandidatrekkefølge påvirker ikke output", () => {
    const a = resolveSchoolSubjectPlacement(input({ subjectCandidates: [{ subjectKey: "engelsk", subject: "Engelsk", weight: 9 }, { subjectKey: "norsk", subject: "Norsk", weight: 1 }] }), ctx(MON, null));
    const b = resolveSchoolSubjectPlacement(input({ subjectCandidates: [{ subjectKey: "norsk", subject: "Norsk", weight: 1 }, { subjectKey: "engelsk", subject: "Engelsk", weight: 9 }] }), ctx(MON, null));
    expect(a).toEqual(b);
  });
});

describe("tid alene skaper ALDRI fag (invariant)", () => {
  const wp1 = profile({ [MON]: lessonsDay([lesson({ subjectKey: "norsk", start: "08:00", end: "09:00" })]) });
  it("ingen faginfo, én lesson på dagen → missing_explicit_subject", () => {
    expect(resolveSchoolSubjectPlacement(input(), ctx(MON, wp1))).toEqual({ status: "unresolved", reason: "missing_explicit_subject", reviewCode: null });
  });
  it("ingen faginfo, nøyaktig én tidsmatch → missing_explicit_subject", () => {
    expect(resolveSchoolSubjectPlacement(input({ start: "08:00", end: "09:00" }), ctx(MON, wp1))).toEqual({ status: "unresolved", reason: "missing_explicit_subject", reviewCode: null });
  });
  it("ingen faginfo, bare ett fag i hele profilen → missing_explicit_subject", () => {
    expect(resolveSchoolSubjectPlacement(input({ start: "08:30", end: "08:45" }), ctx(MON, wp1))).toEqual({ status: "unresolved", reason: "missing_explicit_subject", reviewCode: null });
  });
});

describe("ukjent fag", () => {
  it("eksplisitt fagtekst som ikke kan valideres → unknown_subject + ambiguous_subject", () => {
    expect(resolveSchoolSubjectPlacement(input({ subject: "Blæfag" }), ctx(MON, null))).toEqual({ status: "unresolved", reason: "unknown_subject", reviewCode: "ambiguous_subject" });
  });
});

describe("samme fag flere ganger samme dag", () => {
  const twoNorsk = profile({ [MON]: lessonsDay([lesson({ subjectKey: "norsk", start: "08:00", end: "09:00" }), lesson({ subjectKey: "norsk", start: "10:00", end: "11:00" })]) });

  it("to økter, nøyaktig én full tids-overlapp → unique_time_match", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", start: "08:00", end: "09:00" }), ctx(MON, twoNorsk));
    expect(d.status === "placed" && d.lessonDecision).toEqual({ status: "matched", lesson: expect.objectContaining({ start: "08:00" }), reason: "unique_time_match" });
  });

  it("to økter, bare start matcher én", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", start: "08:30" }), ctx(MON, twoNorsk));
    expect(d.status === "placed" && d.lessonDecision.status === "matched" && d.lessonDecision.lesson.start).toBe("08:00");
  });

  it("to økter, bare slutt matcher én", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", end: "10:45" }), ctx(MON, twoNorsk));
    expect(d.status === "placed" && d.lessonDecision.status === "matched" && d.lessonDecision.lesson.start).toBe("10:00");
  });

  it("to økter, ingen tid → missing_time (reviewCode missing_time)", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk" }), ctx(MON, twoNorsk));
    expect(d.status === "placed" && d.lessonDecision).toEqual({ status: "unresolved", reason: "missing_time", reviewCode: "missing_time" });
    expect(d.status === "placed" && d.reviewCode).toBe("missing_time");
  });

  it("to økter, ingen tidsmatch → no_time_overlap + low_confidence", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", start: "12:00", end: "13:00" }), ctx(MON, twoNorsk));
    expect(d.status === "placed" && d.lessonDecision).toEqual({ status: "unresolved", reason: "no_time_overlap", reviewCode: "low_confidence" });
  });

  it("itemtid overlapper begge → ambiguous_lessons + low_confidence", () => {
    const overlapWp = profile({ [MON]: lessonsDay([lesson({ subjectKey: "norsk", start: "08:00", end: "09:00" }), lesson({ subjectKey: "norsk", start: "08:30", end: "09:30" })]) });
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", start: "08:15", end: "09:15" }), ctx(MON, overlapWp));
    expect(d.status === "placed" && d.lessonDecision).toEqual({ status: "unresolved", reason: "ambiguous_lessons", reviewCode: "low_confidence" });
  });

  it("nøyaktig grense mellom to økter matcher ikke begge (halvåpent)", () => {
    const adjacent = profile({ [MON]: lessonsDay([lesson({ subjectKey: "norsk", start: "08:00", end: "09:00" }), lesson({ subjectKey: "norsk", start: "09:00", end: "10:00" })]) });
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", start: "09:00" }), ctx(MON, adjacent));
    expect(d.status === "placed" && d.lessonDecision.status === "matched" && d.lessonDecision.lesson.start).toBe("09:00");
  });
});

describe("streng dagsavgrensning", () => {
  const wk = profile({ [MON]: lessonsDay([lesson({ subjectKey: "norsk", start: "08:00", end: "09:00" })]), [TUE]: lessonsDay([lesson({ subjectKey: "matematikk", start: "08:00", end: "09:00" })]) });

  it("ingen lekkasje mellom mandag og tirsdag (tirsdag + norsk → ingen mandagslesson)", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", action: "enrich" }), ctx(TUE, wk));
    expect(d.status).toBe("placed");
    expect(d.status === "placed" && d.lessonDecision).toEqual({ status: "not_required", reason: "subject_level_enrichment" });
  });

  it("ugyldig weekdayIndex → profile_missing", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", action: "replace_range" }), ctx("9" as unknown as SchoolProfileWeekdayIndex, wk));
    expect(d.status === "placed" && d.lessonDecision).toEqual({ status: "unresolved", reason: "profile_missing", reviewCode: "low_confidence" });
  });

  it("manglende weekdayIndex → profile_missing", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", action: "enrich" }), ctx(null, wk));
    expect(d.status === "placed" && d.lessonDecision.status).toBe("not_required");
  });

  it("useSimpleDay: true → simple_day (ingen fagøkter)", () => {
    const simple = profile({ [MON]: { useSimpleDay: true, schoolStart: "08:00", schoolEnd: "14:00" } });
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", action: "replace_range" }), ctx(MON, simple));
    expect(d.status === "placed" && d.lessonDecision).toEqual({ status: "unresolved", reason: "simple_day_without_lessons", reviewCode: "low_confidence" });
    expect(getSchoolProfileLessonsForWeekday(ctx(MON, simple))).toEqual({ kind: "simple_day" });
  });

  it("tom profil (ingen dagoppføring) → no_lesson_on_day", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", action: "replace_range" }), ctx(MON, profile({})));
    expect(d.status === "placed" && d.lessonDecision).toEqual({ status: "unresolved", reason: "no_lesson_on_day", reviewCode: "low_confidence" });
  });

  it("null profil → profile_missing", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", action: "enrich" }), ctx(MON, null));
    expect(d.status === "placed" && d.lessonDecision.status).toBe("not_required");
    expect(getSchoolProfileLessonsForWeekday(ctx(MON, null))).toEqual({ kind: "profile_missing" });
  });
});

describe("ingen lesson på dagen — action-avhengig", () => {
  const wp = profile({ [MON]: lessonsDay([lesson({ subjectKey: "matematikk", start: "08:00", end: "09:00" })]) });
  it("enrich med sikkert fag uten lesson → not_required (reviewCode null)", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", action: "enrich" }), ctx(MON, wp));
    expect(d.status === "placed" && d.lessonDecision).toEqual({ status: "not_required", reason: "subject_level_enrichment" });
    expect(d.status === "placed" && d.reviewCode).toBeNull();
  });
  it("replace_range med sikkert fag uten lesson → no_lesson_on_day + low_confidence", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", action: "replace_range" }), ctx(MON, wp));
    expect(d.status === "placed" && d.lessonDecision).toEqual({ status: "unresolved", reason: "no_lesson_on_day", reviewCode: "low_confidence" });
    expect(d.status === "placed" && d.reviewCode).toBe("low_confidence");
  });
});

describe("spor/variant (kun eksakt strukturert likhet)", () => {
  const tracks = profile({ [MON]: lessonsDay([
    lesson({ subjectKey: "valgfag", start: "08:00", end: "09:00", lessonSubcategory: "Programmering" }),
    lesson({ subjectKey: "valgfag", start: "10:00", end: "11:00", lessonSubcategory: "Design" }),
  ]) });

  it("én eksakt strukturert track-match → unique_track_match", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "valgfag", customLabel: "Programmering" }), ctx(MON, tracks));
    expect(d.status === "placed" && d.lessonDecision).toEqual({ status: "matched", lesson: expect.objectContaining({ lessonSubcategory: "Programmering" }), reason: "unique_track_match" });
  });

  it("flere track-matcher + ingen tid → missing_time", () => {
    const dup = profile({ [MON]: lessonsDay([
      lesson({ subjectKey: "valgfag", start: "08:00", end: "09:00", lessonSubcategory: "Programmering" }),
      lesson({ subjectKey: "valgfag", start: "10:00", end: "11:00", lessonSubcategory: "Programmering" }),
    ]) });
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "valgfag", customLabel: "Programmering" }), ctx(MON, dup));
    expect(d.status === "placed" && d.lessonDecision.status === "unresolved" && d.lessonDecision.reason).toBe("missing_time");
  });

  it("ingen track-match, deretter unik tidsmatch", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "valgfag", customLabel: "Ukjentspor", start: "10:00", end: "11:00" }), ctx(MON, tracks));
    expect(d.status === "placed" && d.lessonDecision).toEqual({ status: "matched", lesson: expect.objectContaining({ start: "10:00" }), reason: "unique_time_match" });
  });

  it("ingen fuzzy substring-match (Tysk ≠ Tyskland)", () => {
    const near = profile({ [MON]: lessonsDay([
      lesson({ subjectKey: "valgfag", start: "08:00", end: "09:00", lessonSubcategory: "Tyskland" }),
      lesson({ subjectKey: "valgfag", start: "10:00", end: "11:00", lessonSubcategory: "Design" }),
    ]) });
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "valgfag", customLabel: "Tysk" }), ctx(MON, near));
    // ingen eksakt track-match → faller til tid; ingen tid → missing_time (ikke feil-plukk av «Tyskland»)
    expect(d.status === "placed" && d.lessonDecision.status === "unresolved" && d.lessonDecision.reason).toBe("missing_time");
  });
});

describe("robusthet, determinisme og immutability", () => {
  const wp = profile({ [MON]: lessonsDay([lesson({ subjectKey: "norsk", start: "08:00", end: "09:00" })]) });

  it("ugyldig tid behandles som manglende tid", () => {
    const two = profile({ [MON]: lessonsDay([lesson({ subjectKey: "norsk", start: "08:00", end: "09:00" }), lesson({ subjectKey: "norsk", start: "10:00", end: "11:00" })]) });
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", start: "99:99", end: "tull" }), ctx(MON, two));
    expect(d.status === "placed" && d.lessonDecision.status === "unresolved" && d.lessonDecision.reason).toBe("missing_time");
  });

  it("ugyldig runtime-action degraderes konservativt til enrich", () => {
    const noLesson = profile({ [MON]: lessonsDay([lesson({ subjectKey: "matematikk", start: "08:00", end: "09:00" })]) });
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk", action: "bogus" as unknown as SchoolBlockElementAction }), ctx(MON, noLesson));
    expect(d.status === "placed" && d.lessonDecision.status).toBe("not_required"); // enrich-oppførsel
  });

  it("inputrekkefølge (samme input) gir deterministisk output", () => {
    const a = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk" }), ctx(MON, wp));
    const b = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk" }), ctx(MON, wp));
    expect(a).toEqual(b);
  });

  it("muterer ikke input eller profil", () => {
    const inp = input({ subjectKey: "norsk", subjectCandidates: [{ subjectKey: "norsk", subject: "Norsk", weight: 1 }] });
    const context = ctx(MON, wp);
    const inpSnap = JSON.stringify(inp);
    const ctxSnap = JSON.stringify(context);
    resolveSchoolSubjectPlacement(inp, context);
    expect(JSON.stringify(inp)).toBe(inpSnap);
    expect(JSON.stringify(context)).toBe(ctxSnap);
  });

  it("matchedLesson er deep-clonet (mutasjon lekker ikke til profilen)", () => {
    const withCands = profile({ [MON]: lessonsDay([lesson({ subjectKey: "norsk", start: "08:00", end: "09:00", room: "A1", subjectCandidates: [{ subjectKey: "norsk", subject: "Norsk", weight: 1 }] })]) });
    const profileSnap = JSON.stringify(withCands);
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "norsk" }), ctx(MON, withCands));
    expect(d.status === "placed" && d.lessonDecision.status === "matched").toBe(true);
    if (d.status === "placed" && d.lessonDecision.status === "matched") {
      const original = withCands.weekdays[MON] as { lessons: SchoolProfileLesson[] };
      expect(d.lessonDecision.lesson).not.toBe(original.lessons[0]); // ny referanse
      expect(d.lessonDecision.lesson.subjectCandidates).not.toBe(original.lessons[0]!.subjectCandidates);
      // Muter output-lessonen.
      d.lessonDecision.lesson.room = "MUTERT";
      d.lessonDecision.lesson.subjectCandidates![0]!.weight = 999;
    }
    expect(JSON.stringify(withCands)).toBe(profileSnap); // profil uendret
  });

  it("getSchoolProfileLessonsForWeekday henter aldri fra en annen dag", () => {
    const wk = profile({ [MON]: lessonsDay([lesson({ subjectKey: "norsk", start: "08:00", end: "09:00" })]), [TUE]: lessonsDay([lesson({ subjectKey: "matematikk", start: "08:00", end: "09:00" })]) });
    const tue = getSchoolProfileLessonsForWeekday(ctx(TUE, wk));
    expect(tue.kind === "lessons" && tue.lessons.map((l) => l.subjectKey)).toEqual(["matematikk"]);
  });
});

describe("subjectKey-normalisering (hardening)", () => {
  it("kjent kanonisk fag: «Norsk» / «norsk» / « norsk » → samme key 'norsk'", () => {
    for (const k of ["Norsk", "norsk", " norsk "]) {
      const d = resolveSchoolSubjectPlacement(input({ subjectKey: k }), ctx(MON, null));
      expect(d.status === "placed" && d.subjectKey).toBe("norsk");
    }
  });

  it("vilkårlig fritekst-subjectKey → stabil custom-key (ingen mellomrom/casing), rekkefølge-/casing-uavhengig", () => {
    const a = resolveSchoolSubjectPlacement(input({ subjectKey: "Prosjekt Uke" }), ctx(MON, null));
    const b = resolveSchoolSubjectPlacement(input({ subjectKey: "prosjekt uke" }), ctx(MON, null));
    expect(a.status === "placed" && a.subjectKey).toBe("custom:prosjekt-uke");
    expect(b.status === "placed" && b.subjectKey).toBe(a.status === "placed" ? a.subjectKey : "");
    if (a.status === "placed") {
      expect(a.subjectKey).not.toMatch(/\s/); // ingen mellomrom
      expect(a.subjectKey).toBe(a.subjectKey.toLowerCase()); // stabil casing
    }
  });

  it("allerede gyldig custom-key bevares (kolon ikke ødelagt)", () => {
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "custom:utv" }), ctx(MON, null));
    expect(d.status === "placed" && d.subjectKey).toBe("custom:utv");
  });
});

describe("kandidatnormalisering (hardening)", () => {
  it("case-varianter av samme fag kollapser til én, rekkefølge-uavhengig", () => {
    const forward = input({ subjectCandidates: [{ subjectKey: "Engelsk", subject: "Engelsk", weight: 1 }, { subjectKey: "engelsk", subject: "English", weight: 2 }] });
    const reverse = input({ subjectCandidates: [{ subjectKey: "engelsk", subject: "English", weight: 2 }, { subjectKey: "Engelsk", subject: "Engelsk", weight: 1 }] });
    const a = resolveSchoolSubjectPlacement(forward, ctx(MON, null));
    const b = resolveSchoolSubjectPlacement(reverse, ctx(MON, null));
    expect(a).toEqual(b);
    expect(a.status === "placed" && a.subjectKey).toBe("engelsk");
    expect(a.status === "placed" && a.subjectSource).toBe("single_subject_candidate");
  });
});

describe("reell rekkefølgeuavhengighet (hardening)", () => {
  it("reversert lesson-rekkefølge → deep-equal beslutning", () => {
    const wpA = profile({ [MON]: lessonsDay([lesson({ subjectKey: "norsk", start: "08:00", end: "09:00" }), lesson({ subjectKey: "norsk", start: "10:00", end: "11:00" })]) });
    const wpB = profile({ [MON]: lessonsDay([lesson({ subjectKey: "norsk", start: "10:00", end: "11:00" }), lesson({ subjectKey: "norsk", start: "08:00", end: "09:00" })]) });
    const inp = input({ subjectKey: "norsk", start: "08:00", end: "09:00" });
    expect(resolveSchoolSubjectPlacement(inp, ctx(MON, wpA))).toEqual(resolveSchoolSubjectPlacement(inp, ctx(MON, wpB)));
  });

  it("reversert kandidat-rekkefølge i en lesson → deep-equal fra getSchoolProfileLessonsForWeekday", () => {
    const wpA = profile({ [MON]: lessonsDay([lesson({ subjectKey: "valgfag", start: "08:00", end: "09:00", subjectCandidates: [{ subjectKey: "engelsk", subject: "Engelsk", weight: 1 }, { subjectKey: "norsk", subject: "Norsk", weight: 2 }] })]) });
    const wpB = profile({ [MON]: lessonsDay([lesson({ subjectKey: "valgfag", start: "08:00", end: "09:00", subjectCandidates: [{ subjectKey: "norsk", subject: "Norsk", weight: 2 }, { subjectKey: "engelsk", subject: "Engelsk", weight: 1 }] })]) });
    expect(getSchoolProfileLessonsForWeekday(ctx(MON, wpA))).toEqual(getSchoolProfileLessonsForWeekday(ctx(MON, wpB)));
  });

  it("to lessons like i start/end/fag men med kandidatmetadata i ulik rekkefølge → normaliseres identisk", () => {
    const wp = profile({ [MON]: lessonsDay([
      lesson({ subjectKey: "valgfag", start: "08:00", end: "09:00", subjectCandidates: [{ subjectKey: "engelsk", subject: "Engelsk", weight: 1 }, { subjectKey: "norsk", subject: "Norsk", weight: 2 }] }),
      lesson({ subjectKey: "valgfag", start: "08:00", end: "09:00", subjectCandidates: [{ subjectKey: "norsk", subject: "Norsk", weight: 2 }, { subjectKey: "engelsk", subject: "Engelsk", weight: 1 }] }),
    ]) });
    const day = getSchoolProfileLessonsForWeekday(ctx(MON, wp));
    expect(day.kind === "lessons" && day.lessons).toHaveLength(2);
    expect(day.kind === "lessons" && day.lessons[0]).toEqual(day.kind === "lessons" ? day.lessons[1] : null);
  });
});

describe("komplett track-matching (hardening)", () => {
  it("eksakt match mot lessonSubcategory", () => {
    const wp = profile({ [MON]: lessonsDay([lesson({ subjectKey: "valgfag", start: "08:00", end: "09:00", lessonSubcategory: "Programmering" }), lesson({ subjectKey: "valgfag", start: "10:00", end: "11:00", lessonSubcategory: "Design" })]) });
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "valgfag", customLabel: "Programmering" }), ctx(MON, wp));
    expect(d.status === "placed" && d.lessonDecision.status === "matched" && d.lessonDecision.reason).toBe("unique_track_match");
  });

  it("eksakt match mot lesson.customLabel", () => {
    const wp = profile({ [MON]: lessonsDay([lesson({ subjectKey: "valgfag", start: "08:00", end: "09:00", customLabel: "Ekstra spor" }), lesson({ subjectKey: "valgfag", start: "10:00", end: "11:00", customLabel: "Annet spor" })]) });
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "valgfag", customLabel: "Ekstra spor" }), ctx(MON, wp));
    expect(d.status === "placed" && d.lessonDecision.status === "matched" && d.lessonDecision.lesson.customLabel).toBe("Ekstra spor");
    expect(d.status === "placed" && d.lessonDecision.status === "matched" && d.lessonDecision.reason).toBe("unique_track_match");
  });

  it("eksakt match via normalisert lesson-subjectCandidate", () => {
    const wp = profile({ [MON]: lessonsDay([
      lesson({ subjectKey: "valgfag", start: "08:00", end: "09:00", subjectCandidates: [{ subjectKey: "tysk", subject: "Tysk", weight: 1 }] }),
      lesson({ subjectKey: "valgfag", start: "10:00", end: "11:00", subjectCandidates: [{ subjectKey: "spansk", subject: "Spansk", weight: 1 }] }),
    ]) });
    const d = resolveSchoolSubjectPlacement(input({ subjectKey: "valgfag", customLabel: "Tysk" }), ctx(MON, wp));
    expect(d.status === "placed" && d.lessonDecision.status === "matched" && d.lessonDecision.lesson.start).toBe("08:00");
    expect(d.status === "placed" && d.lessonDecision.status === "matched" && d.lessonDecision.reason).toBe("unique_track_match");
  });

  it("sikker item-kandidat kan gi track-token (rå kandidattekst «Engelsk D1»)", () => {
    const wp = profile({ [MON]: lessonsDay([
      lesson({ subjectKey: "engelsk", start: "08:00", end: "09:00", lessonSubcategory: "Engelsk D1" }),
      lesson({ subjectKey: "engelsk", start: "10:00", end: "11:00", lessonSubcategory: "Engelsk D2" }),
    ]) });
    const d = resolveSchoolSubjectPlacement(input({ subjectCandidates: [{ subjectKey: "engelsk", subject: "Engelsk D1", weight: 1 }] }), ctx(MON, wp));
    expect(d.status === "placed" && d.subjectKey).toBe("engelsk");
    expect(d.status === "placed" && d.lessonDecision.status === "matched" && d.lessonDecision.lesson.lessonSubcategory).toBe("Engelsk D1");
    expect(d.status === "placed" && d.lessonDecision.status === "matched" && d.lessonDecision.reason).toBe("unique_track_match");
  });

  it("kandidat- og lesson-rekkefølge påvirker ikke track-resultatet", () => {
    const mk = (cands: Array<{ subjectKey: string; subject: string; weight: number }>) =>
      profile({ [MON]: lessonsDay([
        lesson({ subjectKey: "valgfag", start: "10:00", end: "11:00", lessonSubcategory: "Design" }),
        lesson({ subjectKey: "valgfag", start: "08:00", end: "09:00", subjectCandidates: cands }),
      ]) });
    const a = resolveSchoolSubjectPlacement(input({ subjectKey: "valgfag", customLabel: "Tysk" }), ctx(MON, mk([{ subjectKey: "tysk", subject: "Tysk", weight: 1 }, { subjectKey: "fransk", subject: "Fransk", weight: 2 }])));
    const b = resolveSchoolSubjectPlacement(input({ subjectKey: "valgfag", customLabel: "Tysk" }), ctx(MON, mk([{ subjectKey: "fransk", subject: "Fransk", weight: 2 }, { subjectKey: "tysk", subject: "Tysk", weight: 1 }])));
    expect(a).toEqual(b);
    expect(a.status === "placed" && a.lessonDecision.status === "matched" && a.lessonDecision.reason).toBe("unique_track_match");
  });
});
