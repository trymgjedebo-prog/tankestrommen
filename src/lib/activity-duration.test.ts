import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractDayBlobFromCorpus } from "@/lib/cup-day-source-blob";
import {
  buildDurationEndFact,
  parseInheritedMatchDuration,
  parsePostEventBufferMinutes,
  parseScopedAttendanceOffsetMinutes,
  parseStructuredMatchDuration,
  resolveMatchDurationMinutes,
} from "./activity-duration";

const fixture = () =>
  readFileSync(
    join(process.cwd(), "fixtures", "tankestrom", "hostcup_duration_endtime_rich.txt"),
    "utf8",
  );

describe("activity-duration", () => {
  it("parser 2 x 20 min + pause", () => {
    const d = parseStructuredMatchDuration("Kampen varer 2 x 20 minutter med 5 minutter pause.");
    expect(d?.totalMinutes).toBe(45);
    expect(d?.periodCount).toBe(2);
    expect(d?.periodMinutes).toBe(20);
    expect(d?.breakMinutes).toBe(5);
  });

  it("parser 2 x 20 min, og 5 minutter pause (komma)", () => {
    const d = parseStructuredMatchDuration("Kampen varer 2 x 20 minutter, og 5 minutter pause.");
    expect(d?.totalMinutes).toBe(45);
    expect(d?.breakMinutes).toBe(5);
  });

  it("parser 2x20 min og halvtime etter kampslutt", () => {
    expect(parseStructuredMatchDuration("2x20 min + 5 min pause")?.totalMinutes).toBe(45);
    const buf = parsePostEventBufferMinutes(
      "Regn med å være ute av hallen omtrent en halvtime etter kampslutt.",
    );
    expect(buf?.minutes).toBe(30);
    expect(buf?.estimated).toBe(true);
  });

  it("arver varighet fra fredag", () => {
    const corpus = fixture();
    const lordag = extractDayBlobFromCorpus(corpus, "lørdag");
    const inherited = parseInheritedMatchDuration(lordag, corpus);
    expect(inherited?.totalMinutes).toBe(45);
    expect(inherited?.validation).toBe("inherited");
  });

  it("scoped oppmøte-offset: 50 før kampstart vs 45 før hver kamp", () => {
    const corpus = fixture();
    const fri = extractDayBlobFromCorpus(corpus, "fredag");
    const lor = extractDayBlobFromCorpus(corpus, "lørdag");
    expect(parseScopedAttendanceOffsetMinutes(fri)?.minutes).toBe(50);
    expect(parseScopedAttendanceOffsetMinutes(lor)?.perMatch).toBe(true);
    expect(parseScopedAttendanceOffsetMinutes(lor)?.minutes).toBe(45);
  });

  it("Høstcup rich: fredag inferred end 18:45", () => {
    const corpus = fixture();
    const fri = extractDayBlobFromCorpus(corpus, "fredag");
    const fact = buildDurationEndFact({
      dayLabel: "fredag",
      dayBlob: fri,
      corpus,
      lastMatchTime: "17:30",
    });
    expect(fact.activityDurationMinutes).toBe(45);
    expect(fact.afterBufferMinutes).toBe(30);
    expect(fact.inferredEndTime).toBe("18:45");
    expect(fact.endTimeSource).toBe("computed_from_duration_and_aftertime");
  });

  it("Høstcup rich: lørdag inferred end ca 15:55", () => {
    const corpus = fixture();
    const lor = extractDayBlobFromCorpus(corpus, "lørdag");
    const duration = resolveMatchDurationMinutes(lor, corpus);
    expect(duration?.totalMinutes).toBe(45);
    const fact = buildDurationEndFact({
      dayLabel: "lørdag",
      dayBlob: lor,
      corpus,
      lastMatchTime: "14:40",
    });
    expect(fact.inferredEndTime).toBe("15:55");
  });

  it("vague etter siste kamp gir estimert buffer", () => {
    expect(
      parsePostEventBufferMinutes("Beregn litt tid etter siste kamp før dere drar hjem.")?.estimated,
    ).toBe(true);
  });
});
