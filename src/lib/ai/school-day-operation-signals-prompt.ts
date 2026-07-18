/**
 * Delt promptseksjon for det valgfrie rå-feltet `schoolDayOperationSignals`. Brukes IDENTISK av
 * både bilde- (SYSTEM_PROMPT) og tekst-prompten (TEXT_SYSTEM_PROMPT) i analyze-image.ts, slik at
 * dagsoperasjonsreglene aldri divergerer mellom flytene. Additivt: erstatter ingen eksisterende
 * felt. Rå modelloutput normaliseres uansett av normalizeSchoolDayOperationSignalsRaw (siste
 * sikkerhetslag) — men prompten skal likevel be om korrekt, konservativ struktur.
 *
 * Semantikk: et signal beskriver at HELE elevens skoledag påvirkes. `buildSchoolBlockProposal`
 * leser KUN dette strukturerte feltet — aldri fritekst. De norske eksemplene forklarer bare
 * semantikken til modellen; de er IKKE klassifiseringsregler i produksjonskoden.
 */
export const SCHOOL_DAY_OPERATION_SIGNALS_PROMPT_SECTION = `=== OPTIONAL FIELD: schoolDayOperationSignals ===
This is an ADDITIVE, OPTIONAL field. It never replaces existing fields — keep all normal free text in "scheduleByDay", "deadlines", "notes", "description", "classScheduleEntries" and "generalImportantInfo" exactly as before, even when you also emit a schoolDayOperationSignals entry.

WHAT IT IS: a schoolDayOperationSignals entry marks that the ENTIRE school day for the pupil is changed — a later school start, an earlier school end, or a full-day special program that replaces ordinary lessons. It is NOT for a single lesson, a single exam for some pupils, a book handover, or one activity in the middle of an otherwise ordinary day.

WHEN TO EMIT (all must hold):
- The document EXPLICITLY states that the whole school day is affected, not just one class hour or activity.
- The change is unconditional for the pupil's day. If it only applies to a subgroup and the pupil's branch is not clearly resolved, OMIT the entry.
- Return AT MOST ONE operation signal per day. If the document gives conflicting or unclear day-level actions, OMIT the entry rather than produce false certain structure.
- If ordinary teaching still applies that day, return NO entry.
- Do NOT use a single text phrase as the only classification rule; rely on the actual meaning that the whole day is affected.

If no day is affected as a whole, OMIT the field entirely; do NOT return an empty array.

OPERATIONS: "operation" is one of "adjust_start", "adjust_end", "replace_day".
- "adjust_start": the whole school day / the pupil's attendance starts at this time. Fill "effectiveStart"; do NOT set an end time. Use ONLY when the document says the pupil's overall school start that day is later.
- "adjust_end": the whole school day ends at this time. Fill "effectiveEnd"; do NOT set a start time. Use ONLY when the document says the pupil's overall school day ends earlier.
- "replace_day": ordinary teaching is replaced by a full-day special program. Set "activityKind" to one of "exam_day", "trip_day", "activity_day", "free_day", "other". A special program with an explicit overall start and end may fill "effectiveStart"/"effectiveEnd"; keep them null when no overall time is explicit.

SHAPE (all keys present per entry; use null where unknown; do NOT invent values):
{
  "operation": "replace_day",
  "date": "2026-06-19",
  "weekdayIndex": "4",
  "dayLabel": "fredag",
  "activityKind": "activity_day",
  "effectiveStart": "09:00",
  "effectiveEnd": "12:00",
  "reason": "Siste skoledag – felles avslutningsopplegg",
  "sourceText": "Siste skoledag. Opplegg fra kl. 09.00–12.00.",
  "confidence": 0.9
}
For "adjust_start"/"adjust_end", omit the activityKind concept: set "operation" accordingly, fill only the single relevant time ("effectiveStart" for adjust_start, "effectiveEnd" for adjust_end), and leave the other time out.

DAY SCOPE: give at least one of "date", "weekdayIndex" ("0"=Monday … "4"=Friday), or "dayLabel". Use "date" only when it is explicit or safely derived from the document's explicit date context; never guess the year or the date from a weekday alone. If date and weekdayIndex are both given they MUST describe the same weekday.

TIME: use "HH:MM" when explicit ("10.30" may be returned as "10:30"). Do NOT guess a missing time, do NOT assume usual school hours, and do NOT compute a time from a duration. A missing time is null (and for adjust_start/adjust_end, if the one required time is not explicit, OMIT the entry rather than guess).

ACTIVITYKIND: only for "replace_day", and only when the document clearly indicates the kind of full-day program (a full-day exam → "exam_day", a trip → "trip_day", an activity/closing day → "activity_day", a day off → "free_day", otherwise "other"). Do NOT guess the activityKind; if it is unclear, OMIT the entry.

REASON AND SOURCETEXT: "reason" is a short source-based explanation or null. "sourceText" is the shortest verbatim or near-verbatim supporting source line; it is evidence and must not contain your reasoning.

CONFIDENCE: "confidence" is a number between 0 and 1. Lower it when the day-level scope is uncertain.

SEMANTIC EXAMPLES (illustrate meaning only — do NOT match these exact phrases as a rule):
- SHOULD emit adjust_start — "Elevens oppmøte er kl. 10.30." ONLY when this describes the pupil's overall school start that day → {"operation":"adjust_start","effectiveStart":"10:30", ...}.
- SHOULD emit replace_day/activity_day — "Siste skoledag. Opplegg fra kl. 09.00–12.00: 09.00–10.00 opplegg i klasserommet, 10.00–10.45 felles avslutning, 11.00–12.00 avslutning i klasserommet." This is a full-day special program that replaces the ordinary timetable → {"operation":"replace_day","activityKind":"activity_day","effectiveStart":"09:00","effectiveEnd":"12:00", ...}.
- SHOULD NOT emit any day operation — "Forberedelse til eksamen for noen. Vanlig undervisning for resten. Bokinnlevering for 2STC kl. 10.30–11.00." Ordinary teaching still applies and the book handover is a single activity, not a day-level change.
- SHOULD NOT emit a certain replace_day — "Eksamen for noen elever. Klasseavslutning for resten, avtales med lærer." This is conditional and the pupil's branch may be unresolved → OMIT.`;
