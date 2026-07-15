import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regresjonsdekning for produksjonsfeilen «Klarte ikke tolke JSON fra modellen»,
 * som dukket opp etter at den delte `classScheduleEntries`-prompten ble deployet.
 *
 * `finish_reason === "length"` er en eksplisitt, identifiserbar årsak til ufullstendig
 * JSON (svaret ble avkortet ved token-taket), og er den best støttede hypotesen for den
 * observerte regresjonen — vi har ikke observert den faktiske produksjonsresponsen eller
 * dens finish_reason. Det ekstra classScheduleEntries-feltet gjør rike timeplaner større,
 * som øker sjansen for avkorting.
 *
 * Rettelsen: KUN når API-et rapporterer `"length"` gjøres ETT målrettet nytt forsøk med
 * høyere token-tak; er svaret fortsatt avkortet kastes en tydelig, diagnostiserbar feil.
 * Ugyldig JSON med andre finish reasons (f.eks. `"stop"`) retryes IKKE, og går gjennom den
 * eksisterende parsefeilen «Kunne ikke tolke JSON fra modellen».
 */

const createMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

import { analyzeImageWithRouting, analyzeTextWithRouting } from "@/lib/ai/analyze-image";

type FinishReason = "stop" | "length";

type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

const DEFAULT_USAGE: Usage = {
  prompt_tokens: 10,
  completion_tokens: 20,
  total_tokens: 30,
};

function completion(
  content: string,
  finishReason: FinishReason,
  usage: Usage | null = DEFAULT_USAGE,
) {
  return {
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage,
  };
}

// Gyldig JSON med høy confidence + tittel ≥ 4 tegn, så light-tier ikke eskalerer på
// «svakt» resultat (det ville gitt ekstra, uskriptede create-kall).
const VALID_JSON = JSON.stringify({
  title: "Ukeplan uke 24",
  description: "Viktig info til foreldre denne uken.",
  confidence: 0.9,
});

function maxTokensOf(callIndex: number): unknown {
  return (createMock.mock.calls[callIndex]?.[0] as { max_tokens?: number })
    ?.max_tokens;
}

beforeEach(() => {
  createMock.mockReset();
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.BRAINTRUST_API_KEY;
  delete process.env.EVAL_TANKESTROM_MODEL;
  delete process.env.OPENAI_ANALYSIS_MODEL_LIGHT;
  delete process.env.OPENAI_ANALYSIS_MODEL_STRONG;
  delete process.env.OPENAI_ANALYSIS_MODEL_IMAGE;
  delete process.env.TANKESTROM_LIGHT_MODEL;
  delete process.env.TANKESTROM_DEFAULT_MODEL;
  delete process.env.TANKESTROM_IMAGE_MODEL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("analyse: avkorting (finish_reason=length) → målrettet nytt forsøk", () => {
  it("gjør ingen ekstra forsøk når første tekst-svar er komplett", async () => {
    createMock.mockResolvedValue(completion(VALID_JSON, "stop"));

    const { result } = await analyzeTextWithRouting("noe tekst", {
      sourceRoute: "text",
      documentKind: "text",
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.title).toBe("Ukeplan uke 24");
    expect(maxTokensOf(0)).toBe(4000);
  });

  it("prøver tekst på nytt med doblet tak ved avkorting og lykkes", async () => {
    createMock
      .mockResolvedValueOnce(completion('{"title":"Ukeplan uk', "length"))
      .mockResolvedValueOnce(completion(VALID_JSON, "stop"));

    const { result } = await analyzeTextWithRouting("noe tekst", {
      sourceRoute: "text",
      documentKind: "text",
    });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result.title).toBe("Ukeplan uke 24");
    // Basetak → doblet retry-tak (tekst).
    expect(maxTokensOf(0)).toBe(4000);
    expect(maxTokensOf(1)).toBe(8000);
  });

  it("prøver bilde på nytt med doblet tak ved avkorting og lykkes", async () => {
    createMock
      .mockResolvedValueOnce(completion('{"title":"Ukepl', "length"))
      .mockResolvedValueOnce(completion(VALID_JSON, "stop"));

    const { result } = await analyzeImageWithRouting("ZmFrZS1iaWxkZQ==", {
      sourceRoute: "image",
    });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result.title).toBe("Ukeplan uke 24");
    // Basetak → doblet retry-tak (bilde).
    expect(maxTokensOf(0)).toBe(2800);
    expect(maxTokensOf(1)).toBe(5600);
  });

  it("kaster tydelig avkortingsfeil (ikke generisk JSON-feil) når svaret fortsatt er avkortet", async () => {
    // timetable → strong-tier uten light-eskalering: nøyaktig ett basekall + ett retry.
    createMock.mockResolvedValue(completion('{"title":"avkut', "length"));

    await expect(
      analyzeTextWithRouting("noe tekst", {
        sourceRoute: "text",
        documentKind: "timetable",
      }),
    ).rejects.toThrow(/avkortet.*finish_reason=length/i);

    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("kaster IKKE den generiske «Kunne ikke tolke JSON»-feilen ved avkorting", async () => {
    createMock.mockResolvedValue(completion('{"title":"avkut', "length"));

    await expect(
      analyzeTextWithRouting("noe tekst", {
        sourceRoute: "text",
        documentKind: "timetable",
      }),
    ).rejects.not.toThrow(/Kunne ikke tolke JSON/i);
  });

  it("bevarer HTTP-mapping: avkortingsmeldingen inneholder ikke ordet «token»", async () => {
    createMock.mockResolvedValue(completion('{"title":"avkut', "length"));

    let message = "";
    try {
      await analyzeTextWithRouting("noe tekst", {
        sourceRoute: "text",
        documentKind: "timetable",
      });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }

    // Bekreft at det faktisk ble kastet en avkortingsfeil ...
    expect(message).toMatch(/avkortet/i);
    // ... og at meldingen ikke inneholder «token»: mapAnalyzeTextError nøkkel-matcher
    // på «token» → ville gitt 422 i stedet for dagens 502.
    expect(message.toLowerCase()).not.toContain("token");
  });

  it("ugyldig JSON med finish_reason=stop: eksisterende parsefeil, ingen retry, intet doblet tak", async () => {
    // finish_reason=stop → IKKE avkorting. Skal gå gjennom den eksisterende parsefeilen,
    // ikke retry-stien. Strong/timetable-ruten unngår light→strong-eskalering, så
    // kall-antallet er ikke forstyrret.
    createMock.mockResolvedValue(completion('{"title": ugyldig json', "stop"));

    let message = "";
    try {
      await analyzeTextWithRouting("noe tekst", {
        sourceRoute: "text",
        documentKind: "timetable",
      });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }

    // Eksakt den eksisterende, generiske parsefeilen.
    expect(message).toBe("Kunne ikke tolke JSON fra modellen");
    // Ikke klassifisert som avkorting.
    expect(message).not.toMatch(/avkortet/i);
    // Intet nytt kall (ingen truncation-retry).
    expect(createMock).toHaveBeenCalledTimes(1);
    // Kun basetaket brukt — det doblede retry-taket (8000) ble aldri tatt i bruk.
    expect(maxTokensOf(0)).toBe(4000);
    expect(maxTokensOf(1)).toBeUndefined();
  });

  it("uten retry: usage fra første kall videreføres uendret til modelTrace", async () => {
    createMock.mockResolvedValue(
      completion(VALID_JSON, "stop", {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      }),
    );

    const { modelTrace } = await analyzeTextWithRouting("noe tekst", {
      sourceRoute: "text",
      documentKind: "text",
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(modelTrace.tokenUsageCalls).toEqual([
      {
        model: "gpt-4o-mini",
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    ]);
  });

  it("med retry: usage summeres fra det avkortede kallet + retry-kallet", async () => {
    createMock
      .mockResolvedValueOnce(
        completion('{"title":"Ukeplan uk', "length", {
          prompt_tokens: 10,
          completion_tokens: 100,
          total_tokens: 110,
        }),
      )
      .mockResolvedValueOnce(
        completion(VALID_JSON, "stop", {
          prompt_tokens: 10,
          completion_tokens: 40,
          total_tokens: 50,
        }),
      );

    const { modelTrace } = await analyzeTextWithRouting("noe tekst", {
      sourceRoute: "text",
      documentKind: "text",
    });

    expect(createMock).toHaveBeenCalledTimes(2);
    // Aggregert usage: 10+10, 100+40, 110+50.
    expect(modelTrace.tokenUsageCalls).toEqual([
      {
        model: "gpt-4o-mini",
        prompt_tokens: 20,
        completion_tokens: 140,
        total_tokens: 160,
      },
    ]);
  });
});
