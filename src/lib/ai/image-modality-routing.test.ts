import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regresjon for produksjonsfeilen `400 Invalid content type. image_url is only supported by
 * certain models`. Beviser at bildeanalyse ALDRI sender `image_url` videre til den generiske
 * strong-modellen — verken i første kall eller ved svakhets-/feil-eskalering — mens ikke-bilde-
 * kall beholder dagens light→strong-eskalering. Observerer hvilke modeller `create` kalles med
 * (samme OpenAI-mock som analyze-image.truncation.test.ts).
 */
const createMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

import { analyzeImageWithRouting, analyzeTextWithRouting } from "@/lib/ai/analyze-image";

const IMG = "img-model";
const STRONG = "strong-model";
const LIGHT = "light-model";

function completion(content: string, finishReason: "stop" | "length" = "stop") {
  return {
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

/** Gyldig, men SVAKT resultat (confidence < 0.42) → utløser eskaleringsvurderingen. */
const WEAK_JSON = JSON.stringify({ title: "T", description: "D", confidence: 0.1 });
const OK_JSON = JSON.stringify({ title: "Ukeplan", description: "Info", confidence: 0.9 });

const modelsCalled = () => createMock.mock.calls.map((c) => (c[0] as { model: string }).model);

beforeEach(() => {
  createMock.mockReset();
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.BRAINTRUST_API_KEY;
  delete process.env.EVAL_TANKESTROM_MODEL;
  process.env.OPENAI_ANALYSIS_MODEL_IMAGE = IMG;
  process.env.OPENAI_ANALYSIS_MODEL_STRONG = STRONG;
  process.env.OPENAI_ANALYSIS_MODEL_LIGHT = LIGHT;
  delete process.env.TANKESTROM_IMAGE_MODEL;
  delete process.env.TANKESTROM_DEFAULT_MODEL;
  delete process.env.TANKESTROM_HEAVY_MODEL;
  delete process.env.TANKESTROM_LIGHT_MODEL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("modality-safe bilde-eskalering", () => {
  it("svakt bilderesultat: ETT kall (image-modell), aldri strong, skip-reason i trace", async () => {
    createMock.mockResolvedValue(completion(WEAK_JSON));

    const { result, modelTrace } = await analyzeImageWithRouting("Zm9v", {
      documentKind: "school",
      sourceRoute: "image",
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(modelsCalled()).toEqual([IMG]);
    expect(modelsCalled()).not.toContain(STRONG); // aldri strong for bilde
    expect(result.title).toBe("T"); // første gyldige resultat returneres
    expect(modelTrace.escalated).toBe(false);
    expect(modelTrace.finalModel).toBe(IMG);
    expect(
      modelTrace.reasons.some((r) => r === "escalation:skipped:no_safe_image_escalation_model"),
    ).toBe(true);
  });

  it("400 image_url-feil i bildekallet: ETT kall, aldri strong, opprinnelig feil rethrows", async () => {
    const err = new Error("400 Invalid content type. image_url is only supported by certain models.");
    createMock.mockRejectedValue(err);

    await expect(
      analyzeImageWithRouting("Zm9v", { documentKind: "school", sourceRoute: "image" }),
    ).rejects.toThrow(/image_url is only supported by certain models/);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(modelsCalled()).toEqual([IMG]);
    expect(modelsCalled()).not.toContain(STRONG); // ingen skjult fallback til strong
  });

  it("alle bilde-documentKinds bruker image-modellen (aldri strong) i første kall", async () => {
    for (const kind of ["school", "activity_plan", "timetable", "event_doc", "text", "auto"] as const) {
      createMock.mockReset();
      createMock.mockResolvedValue(completion(OK_JSON));
      await analyzeImageWithRouting("Zm9v", { documentKind: kind, sourceRoute: "image" });
      expect(modelsCalled(), `kind=${kind}`).toEqual([IMG]);
    }
  });
});

describe("ikke-bilde-eskalering er uendret (light → strong)", () => {
  it("svakt tekstresultat eskalerer fortsatt til strong", async () => {
    createMock.mockResolvedValue(completion(WEAK_JSON));

    const { modelTrace } = await analyzeTextWithRouting("noe tekst", {
      documentKind: "text",
      sourceRoute: "text",
    });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(modelsCalled()).toEqual([LIGHT, STRONG]); // light først, deretter strong-eskalering
    expect(modelTrace.escalated).toBe(true);
    expect(modelTrace.finalModel).toBe(STRONG);
  });

  it("feil i tekst-light-kallet eskalerer fortsatt til strong", async () => {
    createMock
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(completion(OK_JSON));

    const { modelTrace } = await analyzeTextWithRouting("noe tekst", {
      documentKind: "text",
      sourceRoute: "text",
    });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(modelsCalled()).toEqual([LIGHT, STRONG]);
    expect(modelTrace.escalated).toBe(true);
    expect(modelTrace.finalModel).toBe(STRONG);
  });
});
