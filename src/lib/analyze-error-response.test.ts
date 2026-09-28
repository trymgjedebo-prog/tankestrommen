/**
 * Produksjonsfeilsvar fra /api/analyze skal aldri eksponere serverens stack trace. Testes både på
 * den rene helperen og gjennom den faktiske POST-handleren (bildegrenen, der modellkallet er mocket
 * til å kaste — ingen nettverk, ingen OpenAI).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clientDebugMessageForError, PRODUCTION_CLIENT_DEBUG_MESSAGE } from "@/lib/analyze-error-response";

const SECRET_MARKER = "hemmelig-intern-detalj";

vi.mock("@/lib/ai/analyze-image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/analyze-image")>();
  return {
    ...actual,
    analyzeImageWithRouting: vi.fn(async () => {
      throw new Error(`modellkall feilet: ${SECRET_MARKER}`);
    }),
  };
});

function makeError(): Error {
  const err = new Error(`boom ${SECRET_MARKER}`);
  err.stack = `Error: boom ${SECRET_MARKER}\n    at interntFunksjonsnavn (/var/task/.next/server/app/api/analyze/route.js:1:1)`;
  return err;
}

describe("clientDebugMessageForError", () => {
  it("production: stabil generisk tekst — verken stack eller exception-melding", () => {
    const msg = clientDebugMessageForError(makeError(), "production");
    expect(msg).toBe(PRODUCTION_CLIENT_DEBUG_MESSAGE);
    expect(msg).not.toContain(SECRET_MARKER);
    expect(msg).not.toContain("    at ");
  });

  it("development/test: dagens interne diagnostikk (stack) bevares", () => {
    expect(clientDebugMessageForError(makeError(), "development")).toContain("    at interntFunksjonsnavn");
    expect(clientDebugMessageForError(makeError(), "test")).toContain("    at interntFunksjonsnavn");
  });

  it("ikke-Error-verdier gir fortsatt en streng", () => {
    expect(clientDebugMessageForError("tekstfeil", "test")).toBe("tekstfeil");
    expect(clientDebugMessageForError("tekstfeil", "production")).toBe(PRODUCTION_CLIENT_DEBUG_MESSAGE);
  });
});

describe("POST /api/analyze — faktisk feilsvar", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-ikke-ekte");
    vi.stubEnv("BRAINTRUST_API_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function postImage() {
    const { POST } = await import("@/app/api/analyze/route");
    const request = new NextRequest("http://localhost/api/analyze?format=portal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: "data:image/png;base64,iVBORw0KGgo=" }),
    });
    const res = await POST(request);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("production: HTTP 500 + stabil feilkode + generell melding, uten stack eller intern detalj", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { status, body } = await postImage();
    expect(status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("IMAGE_ANALYZE_FAILED");
    expect(body.message).toBe("Kunne ikke analysere bildet.");
    expect(body.debugMessage).toBe(PRODUCTION_CLIENT_DEBUG_MESSAGE);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SECRET_MARKER);
    expect(serialized).not.toContain("    at ");
  });

  it("test-miljø: samme status/feilkode, intern diagnostikk bevart (dagens mønster)", async () => {
    const { status, body } = await postImage();
    expect(status).toBe(500);
    expect(body.errorCode).toBe("IMAGE_ANALYZE_FAILED");
    expect(String(body.debugMessage)).toContain(SECRET_MARKER);
  });
});
