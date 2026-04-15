import { NextRequest, NextResponse } from "next/server";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://olivedrab-ant-122520.hostingersite.com",
  "http://127.0.0.1:5173",
];

function allowedOrigins(): Set<string> {
  const fromEnv =
    process.env.CORS_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...fromEnv]);
}

function applyCors(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins().has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

export function middleware(request: NextRequest) {
  if (request.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    return applyCors(request, res);
  }
  return applyCors(request, NextResponse.next());
}

export const config = {
  matcher: "/api/analyze",
};
