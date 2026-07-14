/**
 * Delt promptseksjon for det valgfrie rå-feltet `classScheduleEntries`. Brukes IDENTISK av
 * både bilde- (SYSTEM_PROMPT) og tekst-prompten (TEXT_SYSTEM_PROMPT) i analyze-image.ts, slik
 * at klasse-/puljereglene aldri divergerer mellom flytene. Additivt: erstatter ingen
 * eksisterende felt. Rå modelloutput normaliseres uansett av normalizeClassScheduleEntriesRaw
 * (siste sikkerhetslag) — men prompten skal likevel be om korrekt struktur.
 */
export const CLASS_SCHEDULE_ENTRIES_PROMPT_SECTION = `=== OPTIONAL FIELD: classScheduleEntries ===
This is an ADDITIVE, OPTIONAL field. It never replaces existing fields — keep all normal free text in "scheduleByDay", "deadlines", "notes", "description", "classLocations", "schoolWeeklyProfile" and "generalImportantInfo" exactly as before, even when you also emit classScheduleEntries.

WHEN TO USE: use "classScheduleEntries" ONLY when the source EXPLICITLY ties one or more class codes, or a named pulje/group, to ONE concrete source entry — a specific activity, table row, session, or other clearly delimited row/line — AND provides at least one of: a date, a weekday, a time, a room, a teacher, or an explicit pulje/group label. There must be a real class/pulje relation bound to that concrete row in the source. Do NOT create an entry for general information that has no explicit class code — for example "all pupils must remember gym clothes" is common information and is NOT a classScheduleEntry; keep such general information in the existing fields. If the document has no explicit class/pulje binding to a concrete row, OMIT the field entirely; do NOT return an empty array.

ACTIVITY SCOPING: each entry describes ONE concrete source entry — one activity, one table row, or one session. Never build a single global, unlinked list of classes that could later be attached to every activity; such a global list must NOT become classScheduleEntries (a plain global class→room/teacher relation may still use "classLocations"). A named "activityTitle" is NOT required: fill "activityTitle" with a short source-based title when the source actually gives one, and set "activityTitle": null when the source only shows a concrete pulje/time row without a title. An explicit pulje row with class codes and a time (e.g. "Pulje 1: 2STA, 2STC og 2STE – 10:00–11:00") is already sufficiently scoped — do not invent a title such as "Puljeaktivitet". Do not invent a technical or random activity id.

SHAPE (all keys present per entry; use null where unknown):
{
  "date": "2026-06-18",
  "dayLabel": "torsdag",
  "activityTitle": "Bokinnlevering",
  "classCodes": ["2STC"],
  "groupLabel": null,
  "start": "10:30",
  "end": "11:00",
  "room": "332-50",
  "teacher": "Marte Hermanrud",
  "sourceText": "2STC: 10.30–11.00, rom 332-50",
  "confidence": 0.9
}

CLASSCODES: "classCodes" is ALWAYS a JSON array of SEPARATE class codes, e.g. ["2STA", "2STC"]. Never return a combined free-text value in one element such as ["2STA, 2STC og 2STE"]. Do not put a pulje name, a grade/trinn name, a room, or free text into "classCodes". Keep each class code as written in the source.

DIFFERENT TIMES PER CLASS → SEPARATE ENTRIES. For a source like:
  2STA: 09:00–10:00, rom 301
  2STC: 10:30–11:00, rom 332-50
  2STE: 13:10–14:00, rom 410
emit ONE entry per class, each with its own "classCodes", "start"/"end" and "room". Never use the first class's time for the other classes, never merge different times into one, never pick one class as representative for several, and never copy a room or teacher from one class to another.

SHARED PULJE/GROUP → ONE ENTRY. When several classes EXPLICITLY share the same pulje and time, put them together in ONE entry with multiple classCodes; "activityTitle" may be null. Example:
  Pulje 1: 2STA, 2STC og 2STE – 10:00–11:00  →  "classCodes": ["2STA", "2STC", "2STE"], "groupLabel": "Pulje 1", "start": "10:00", "end": "11:00", "activityTitle": null.
Do not invent a pulje/group name when the source has none.

MULTIPLE ACTIVITIES SAME DAY → SEPARATE ENTRIES with different "activityTitle". For example 2STC "Bokinnlevering" at 10:30 and 2STC "Matteeksamen" at 12:00 are two separate entries; never merge them just because the class and date are the same.

TIME: use "HH:MM" when the time is explicit ("10.30" in the source may be returned as "10:30"). Missing start → null. Missing end → null. Start-only in the source → keep the start and set end to null. Do NOT compute an end time from a duration, do NOT assume a single school lesson length, do NOT use the next clock time as the end, do NOT copy a time from another class or pulje, and do NOT guess a time from usual school hours.

DATE AND WEEKDAY: use "date" only when it is explicitly known, or safely derived from the document's explicit date context; never guess the year or the date from a weekday alone. If only the weekday is known, set "date": null and fill "dayLabel".

ROOM AND TEACHER: keep only the room and teacher that explicitly belong to THIS entry; a missing or uncertain value must be null. Never copy a room or teacher between classes, puljer, activities or days.

SOURCETEXT: "sourceText" holds the shortest verbatim or near-verbatim source line that binds together the activity, class/pulje, time, room and teacher. Do not write a new explanatory sentence when the original line can be preserved. "sourceText" is evidence and must not contain your reasoning.

CONFIDENCE: "confidence" is a number between 0 and 1. Lower it for unclear table structure, an uncertain class binding, an unclear activity title, or a possible-but-not-certain link between a time and a class. Prefer null over a guessed value for an uncertain field.

CONFLICTS: if the source actually shows two conflicting times for the same class and activity, KEEP BOTH as separate entries with different "sourceText" and lower confidence; do NOT pick a winner. Conflict resolution happens later, not in this step.`;
