import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getImageInitialAnalysisModel,
  getLightAnalysisModel,
  getStrongAnalysisModel,
  parseDocumentKind,
  selectInitialAnalysisModel,
  type AnalysisDocumentKind,
} from "@/lib/ai/analysis-model-router";

/**
 * Låser `documentKind`-parsing og modellruting. `"school"` er en ny, bred skoledokumenttype som
 * SKAL ha eksplisitt sterk ruting (aldri light-fallthrough), mens alle eksisterende typer er
 * uendret. Modellverdier sammenlignes mot de eksporterte helperne — ikke hardkodede navn.
 */
describe("analysis-model-router", () => {
  // Samme env-mønster som tankestrom-eval-model-override.test.ts: snapshot → tøm → gjenopprett.
  // NODE_ENV utelatt bevisst: den er readonly-typet, og testene her trenger den ikke (å tømme
  // EVAL_TANKESTROM_MODEL er nok til å deaktivere eval-overstyret).
  const keys = [
    "EVAL_TANKESTROM_MODEL",
    "ALLOW_EVAL_MODEL_OVERRIDE",
    "OPENAI_ANALYSIS_MODEL_LIGHT",
    "OPENAI_ANALYSIS_MODEL_STRONG",
    "OPENAI_ANALYSIS_MODEL_IMAGE",
    "TANKESTROM_LIGHT_MODEL",
    "TANKESTROM_DEFAULT_MODEL",
    "TANKESTROM_HEAVY_MODEL",
    "TANKESTROM_IMAGE_MODEL",
  ] as const;
  const snapshot: Partial<Record<(typeof keys)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of keys) snapshot[k] = process.env[k];
    for (const k of keys) delete process.env[k];
  });

  afterEach(() => {
    for (const k of keys) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  describe("parseDocumentKind", () => {
    it("aksepterer den nye typen 'school' med eksisterende normalisering", () => {
      expect(parseDocumentKind("school")).toBe("school");
      expect(parseDocumentKind(" School ")).toBe("school");
      expect(parseDocumentKind("SCHOOL")).toBe("school");
    });

    it("aksepterer IKKE school-varianter som ikke er avtalt", () => {
      expect(parseDocumentKind("school-")).toBeUndefined(); // → "school_" etter normalisering
      expect(parseDocumentKind("school_")).toBeUndefined();
      expect(parseDocumentKind("school plan")).toBeUndefined();
      expect(parseDocumentKind("schools")).toBeUndefined();
    });

    it("parser alle fem eksisterende typene som før", () => {
      expect(parseDocumentKind("timetable")).toBe("timetable");
      expect(parseDocumentKind("activity_plan")).toBe("activity_plan");
      expect(parseDocumentKind("event_doc")).toBe("event_doc");
      expect(parseDocumentKind("text")).toBe("text");
      expect(parseDocumentKind("auto")).toBe("auto");
    });

    it("bindestrek-alias er uendret", () => {
      expect(parseDocumentKind("activity-plan")).toBe("activity_plan");
      expect(parseDocumentKind("event-doc")).toBe("event_doc");
    });

    it("ukjent, manglende og ikke-streng gir undefined (uendret fallback)", () => {
      expect(parseDocumentKind("bogus")).toBeUndefined();
      expect(parseDocumentKind("")).toBeUndefined();
      expect(parseDocumentKind(undefined)).toBeUndefined();
      expect(parseDocumentKind(null)).toBeUndefined();
      expect(parseDocumentKind(42)).toBeUndefined();
      expect(parseDocumentKind({ documentKind: "school" })).toBeUndefined();
    });
  });

  describe("selectInitialAnalysisModel", () => {
    const pick = (documentKind: AnalysisDocumentKind | undefined, sourceRoute: "image" | "text" = "text") =>
      selectInitialAnalysisModel({ documentKind, sourceRoute });

    it("NY: school → strong med eksplisitt reason (aldri light-fallthrough)", () => {
      const out = pick("school");
      expect(out.tier).toBe("strong");
      expect(out.model).toBe(getStrongAnalysisModel());
      expect(out.reason).toBe("document_kind:school→strong");
    });

    it("school → strong også for bildekilde (ikke image-initial/light)", () => {
      const out = pick("school", "image");
      expect(out.tier).toBe("strong");
      expect(out.model).toBe(getStrongAnalysisModel());
      expect(out.reason).toBe("document_kind:school→strong");
    });

    it("UENDRET: timetable og activity_plan → strong", () => {
      expect(pick("timetable")).toEqual({
        model: getStrongAnalysisModel(),
        tier: "strong",
        reason: "document_kind:timetable→strong",
      });
      expect(pick("activity_plan")).toEqual({
        model: getStrongAnalysisModel(),
        tier: "strong",
        reason: "document_kind:activity_plan→strong",
      });
    });

    it("UENDRET: event_doc og text → light", () => {
      expect(pick("event_doc")).toEqual({
        model: getLightAnalysisModel(),
        tier: "light",
        reason: "document_kind:event_doc→light",
      });
      expect(pick("text")).toEqual({
        model: getLightAnalysisModel(),
        tier: "light",
        reason: "document_kind:text→light",
      });
    });

    it("UENDRET: auto/manglende følger kildeavhengig light-/image-initial-adferd", () => {
      expect(pick("auto", "text")).toEqual({
        model: getLightAnalysisModel(),
        tier: "light",
        reason: "auto:source:text→light",
      });
      expect(pick(undefined, "text")).toEqual({
        model: getLightAnalysisModel(),
        tier: "light",
        reason: "auto:source:text→light",
      });
      const img = pick("auto", "image");
      expect(img.tier).toBe("light");
      expect(img.model).toBe(getImageInitialAnalysisModel());
      expect(img.reason).toBe("auto:source:image→light_then_maybe_escalate");
    });

    it("school bruker den konfigurerte sterke modellen (ikke et hardkodet navn)", () => {
      process.env.OPENAI_ANALYSIS_MODEL_STRONG = "test-strong-model";
      expect(pick("school").model).toBe("test-strong-model");
      expect(pick("school").model).toBe(getStrongAnalysisModel());
    });
  });
});
