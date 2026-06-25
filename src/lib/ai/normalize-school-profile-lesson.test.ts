import { describe, expect, it } from "vitest";
import { normalizeSchoolProfileLesson } from "./analyze-image";

describe("normalizeSchoolProfileLesson – rom/lærer/spor", () => {
  it("bevarer room, teacher og lessonSubcategory 1:1", () => {
    const res = normalizeSchoolProfileLesson({
      subjectKey: "engelsk",
      start: "08:30",
      end: "09:15",
      room: "203",
      teacher: "T. Larsen",
      lessonSubcategory: "Tysk",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.reason);
    expect(res.lesson.room).toBe("203");
    expect(res.lesson.teacher).toBe("T. Larsen");
    expect(res.lesson.lessonSubcategory).toBe("Tysk");
  });

  it("utelater feltene når modellen ikke sender dem", () => {
    const res = normalizeSchoolProfileLesson({
      subjectKey: "naturfag",
      start: "09:00",
      end: "09:45",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.reason);
    expect(res.lesson.room).toBeUndefined();
    expect(res.lesson.teacher).toBeUndefined();
    expect(res.lesson.lessonSubcategory).toBeUndefined();
  });

  it("trimmer whitespace og utelater tomme strenger", () => {
    const res = normalizeSchoolProfileLesson({
      subjectKey: "musikk",
      start: "10:00",
      end: "10:45",
      room: "  A12  ",
      teacher: "   ",
      lessonSubcategory: "",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.reason);
    expect(res.lesson.room).toBe("A12");
    expect(res.lesson.teacher).toBeUndefined();
    expect(res.lesson.lessonSubcategory).toBeUndefined();
  });
});
