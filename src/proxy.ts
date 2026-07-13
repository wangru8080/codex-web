import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { mockApiResponse } from "@/frontend-preview/mock-api";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/codex/bridge-url") {
    return NextResponse.next();
  }

  return mockApiResponse(request);
}

export const config = {
  matcher: ["/api/:path*"]
};
