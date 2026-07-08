import type { NextRequest } from "next/server";
import { mockApiResponse } from "@/frontend-preview/mock-api";

export function proxy(request: NextRequest) {
  return mockApiResponse(request);
}

export const config = {
  matcher: ["/api/:path*"]
};
