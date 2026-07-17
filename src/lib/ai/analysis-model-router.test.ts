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
    const pick = (
      documentKind: AnalysisDocumentKind | undefined,
      sourceRoute: "image" | "text" | "pdf" | "docx" = "text",
    ) => selectInitialAnalysisModel({ documentKind, sourceRoute });

    // Ulike modeller for image vs. strong, så «image ≠ strong»-bevisene er meningsfulle.
    function setDistinctModels() {
      process.env.OPENAI_ANALYSIS_MODEL_IMAGE = "test-image-model";
      process.env.OPENAI_ANALYSIS_MODEL_STRONG = "test-strong-model";
      process.env.OPENAI_ANALYSIS_MODEL_LIGHT = "test-light-model";
    }

    describe("modality-first: ALLE bildekilder → image-initial, ingen strong-eskalering", () => {
      const kinds: Array<[AnalysisDocumentKind | undefined, string]> = [
        ["school", "source:image+document_kind:school→image_initial"],
        ["activity_plan", "source:image+document_kind:activity_plan→image_initial"],
        ["timetable", "source:image+document_kind:timetable→image_initial"],
        ["event_doc", "source:image+document_kind:event_doc→image_initial"],
        ["text", "source:image+document_kind:text→image_initial"],
        ["auto", "source:image+document_kind:auto→image_initial"],
        [undefined, "source:image+document_kind:auto→image_initial"],
      ];
      for (const [kind, reason] of kinds) {
        it(`${kind ?? "manglende"} + image → image_initial (tier light, escalationModel null)`, () => {
          setDistinctModels();
          const out = pick(kind, "image");
          expect(out.model).toBe(getImageInitialAnalysisModel());
          expect(out.model).not.toBe(getStrongAnalysisModel()); // aldri strong for bilde
          expect(out.tier).toBe("light");
          expect(out.escalationModel).toBeNull();
          expect(out.reason).toBe(reason);
        });
      }
    });

    it("school + text/pdf/docx → strong, ingen eskalering", () => {
      for (const route of ["text", "pdf", "docx"] as const) {
        expect(pick("school", route)).toEqual({
          model: getStrongAnalysisModel(),
          tier: "strong",
          reason: "document_kind:school→strong",
          escalationModel: null,
        });
      }
    });

    it("UENDRET: timetable og activity_plan (ikke-bilde) → strong, escalationModel null", () => {
      expect(pick("timetable")).toEqual({
        model: getStrongAnalysisModel(),
        tier: "strong",
        reason: "document_kind:timetable→strong",
        escalationModel: null,
      });
      expect(pick("activity_plan", "pdf")).toEqual({
        model: getStrongAnalysisModel(),
        tier: "strong",
        reason: "document_kind:activity_plan→strong",
        escalationModel: null,
      });
    });

    it("UENDRET: event_doc og text → light med strong som eskaleringsmål", () => {
      expect(pick("event_doc")).toEqual({
        model: getLightAnalysisModel(),
        tier: "light",
        reason: "document_kind:event_doc→light",
        escalationModel: getStrongAnalysisModel(),
      });
      expect(pick("text")).toEqual({
        model: getLightAnalysisModel(),
        tier: "light",
        reason: "document_kind:text→light",
        escalationModel: getStrongAnalysisModel(),
      });
    });

    it("UENDRET: auto/manglende (ikke-bilde) → light med strong som eskaleringsmål", () => {
      expect(pick("auto", "text")).toEqual({
        model: getLightAnalysisModel(),
        tier: "light",
        reason: "auto:source:text→light",
        escalationModel: getStrongAnalysisModel(),
      });
      expect(pick(undefined, "pdf")).toEqual({
        model: getLightAnalysisModel(),
        tier: "light",
        reason: "auto:source:pdf→light",
        escalationModel: getStrongAnalysisModel(),
      });
    });

    it("school + image bruker den konfigurerte image-modellen (ikke strong, ikke hardkodet navn)", () => {
      setDistinctModels();
      expect(pick("school", "image").model).toBe("test-image-model");
      expect(pick("school", "image").model).toBe(getImageInitialAnalysisModel());
      expect(pick("school", "text").model).toBe("test-strong-model"); // tekst beholder strong
    });
  });
});
