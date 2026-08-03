import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { mockApiResponse } from "@/frontend-preview/mock-api";
import { authenticateWebRequest } from "../server/web-auth";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const publicPath = isPublicWebAuthPath(pathname);
  const authenticated = await authenticateWebRequest(request);

  if (pathname === "/login" && authenticated) {
    return NextResponse.redirect(new URL("/chat", request.url));
  }
  if (!publicPath && !authenticated) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "登录已失效" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/api/codex/bridge-url" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  if (process.env.CODEX_WEB_DEMO === "1") {
    return mockApiResponse(request) ?? NextResponse.next();
  }

  return NextResponse.next();
}

export function isPublicWebAuthPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/icon.svg" || pathname === "/api/auth/config" || pathname === "/api/auth/login";
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
