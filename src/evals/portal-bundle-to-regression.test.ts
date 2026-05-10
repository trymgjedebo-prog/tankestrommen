import { describe, expect, it } from "vitest";
import {
  parseStructuredPortalEventNotes,
  portalBundleToRegressionBundle,
} from "@/evals/portal-bundle-to-regression";

describe("portalBundleToRegressionBundle", () => {
  it("parser Dagens innhold og Husk fra portal-notater", () => {
    const notes = `Noe detaljtekst

Dagens innhold
- 17:45 Oppmøte
- 18:30 Trening

Husk / ta med
- drikkeflaske
- leggskinner`;
    const p = parseStructuredPortalEventNotes(notes);
    expect(p.highlights).toEqual(["17:45 Oppmøte", "18:30 Trening"]);
    expect(p.bringItems).toEqual(["drikkeflaske", "leggskinner"]);
  });

  it("mapper enkelt event uten embeddedSchedule til ett barn (fredag)", () => {
    const bundle = {
      items: [
        {
          kind: "event",
          event: {
            title: "Guttelaget – beskjed uke 42 – fredag",
            date: "2026-11-07",
            start: "2026-11-07T17:45:00",
            notes:
              "Dagens innhold\n- 17:45 Oppmøte\n- 18:30 Trening\n\nHusk / ta med\n- drikkeflaske\n- leggskinner",
            metadata: {
              arrangementCoreTitle: "Guttelaget – beskjed uke 42",
              timePrecision: "start_only" as const,
            },
          },
        },
        {
          kind: "task",
          task: {
            title: "Svar i Spond om deltakelse i Guttelaget – beskjed uke 42",
            date: "2026-11-06",
            dueTime: null,
          },
        },
      ],
    };

    const r = portalBundleToRegressionBundle(bundle);
    expect(r.parentTitle).toBe("Guttelaget – beskjed uke 42");
    expect(r.children).toHaveLength(1);
    expect(r.children[0]!.day).toBe("fredag");
    expect(r.children[0]!.highlights).toContain("17:45 Oppmøte");
    expect(r.children[0]!.bringItems.join(" ")).toMatch(/drikkeflaske/);
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0]!.date).toBe("2026-11-06");
  });

  it("mapper embeddedSchedule til tre barnedager", () => {
    const bundle = {
      items: [
        {
          kind: "event",
          event: {
            title: "Vårcupen 2026",
            date: "2026-06-12",
            start: null,
            metadata: {
              isArrangementParent: true,
              arrangementCoreTitle: "Vårcupen",
              embeddedSchedule: [
                {
                  date: "2026-06-12",
                  title: "Vårcupen – fredag",
                  start: "17:45",
                  timePrecision: "start_only" as const,
                  isConditional: false,
                  dayContent: {
                    highlights: ["17:45 Oppmøte", "18:40 Første kamp"],
                    bringItems: [],
                    generalNotes: [],
                    logisticsNotes: [],
                  },
                },
                {
                  date: "2026-06-13",
                  title: "Vårcupen – lørdag",
                  start: "09:20",
                  timePrecision: "start_only" as const,
                  isConditional: false,
                  dayContent: { highlights: ["09:20 Kamp"], bringItems: [] },
                },
                {
                  date: "2026-06-14",
                  title: "Vårcupen – søndag",
                  start: null,
                  timePrecision: "date_only" as const,
                  isConditional: true,
                  dayContent: { highlights: [], bringItems: [] },
                },
              ],
            },
          },
        },
      ],
    };

    const r = portalBundleToRegressionBundle(bundle);
    expect(r.parentTitle).toBe("Vårcupen");
    expect(r.children).toHaveLength(3);
    expect(r.children.map((c) => c.day)).toEqual(["fredag", "lørdag", "søndag"]);
    expect(r.children[0]!.highlights).toContain("17:45 Oppmøte");
    expect(r.children[2]!.tentative).toBe(true);
  });
});
