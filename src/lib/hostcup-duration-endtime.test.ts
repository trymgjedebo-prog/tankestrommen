import { describe, expect, it } from "vitest";
import { loadTankestromExpected, resolveExpectedPath } from "@/evals/tankestrom-expected";
import { runAllTankestromScorers } from "@/evals/tankestrom-scorers";
import { runTankestromFixture } from "@/lib/tankestrom-regression-fixture-runner";

describe("hostcup_duration_endtime_rich", () => {
  const fixturePath = "fixtures/tankestrom/hostcup_duration_endtime_rich.txt";
  const expected = loadTankestromExpected(
    resolveExpectedPath(process.cwd(), "hostcup_duration_endtime_rich"),
  );

  it("regresjon + duration/end eval scorer grønt", () => {
    const bundle = runTankestromFixture(fixturePath, { category: "cup" });
    const { scores, failures, average } = runAllTankestromScorers(bundle, expected);
    expect(failures).toEqual([]);
    expect(average).toBe(1);
    expect(scores.inferredEndCorrect).toBe(1);
    expect(scores.durationMinutesCorrect).toBe(1);
    expect(bundle.children.find((c) => c.day === "fredag")?.end).toBe("18:45");
    expect(bundle.children.find((c) => c.day === "lørdag")?.end).toBe("15:55");
    expect(bundle.tasks.some((t) => t.dueTime === "21:00")).toBe(true);
  });
});
