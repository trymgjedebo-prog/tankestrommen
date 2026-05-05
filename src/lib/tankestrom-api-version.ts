import type { NextResponse } from "next/server";
import { getDeployFingerprint } from "@/lib/deploy-fingerprint";

/** Synlig i JSON + `X-Tankestrom-Analyze-Wrapper` — endres når POST/dedupe-kontrakt endres. */
export const TANKESTROM_ANALYZE_WRAPPER = "outer-post-json-v2";

/**
 * Versjon for health/analyze-headers: git-SHA fra Vercel når tilgjengelig,
 * ellers `packageVersion@ISO-timestamp` (stabil nok til å se at ny kode kjører).
 */
export function getTankestromApiVersion(): string {
  const fp = getDeployFingerprint();
  if (fp.gitCommitSha) return fp.gitCommitSha;
  return `${fp.packageVersion}@${fp.generatedAt}`;
}

export function applyTankestromAnalyzeHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Tankestrom-Service", "tankestrommen");
  response.headers.set("X-Tankestrom-Version", getTankestromApiVersion());
  response.headers.set("X-Tankestrom-Analyze-Wrapper", TANKESTROM_ANALYZE_WRAPPER);
  return response;
}
