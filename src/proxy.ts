import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { mockApiResponse } from "@/frontend-preview/mock-api";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/codex/bridge-url") {
    return NextResponse.next();
  }

  if (process.env.CODEX_WEB_DEMO === "1") {
    return mockApiResponse(request) ?? NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"]
};
