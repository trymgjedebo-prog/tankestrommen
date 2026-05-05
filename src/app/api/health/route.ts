import { NextResponse } from "next/server";
import {
  applyTankestromAnalyzeHeaders,
  getTankestromApiVersion,
  TANKESTROM_ANALYZE_WRAPPER,
} from "@/lib/tankestrom-api-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health — enkel JSON for Foreldre-app / drift (samme versjon som /api/analyze-headers). */
export async function GET() {
  const res = NextResponse.json({
    ok: true,
    service: "tankestrommen",
    version: getTankestromApiVersion(),
    analyzeWrapper: TANKESTROM_ANALYZE_WRAPPER,
    runtime: "nodejs",
  });
  applyTankestromAnalyzeHeaders(res);
  return res;
}
