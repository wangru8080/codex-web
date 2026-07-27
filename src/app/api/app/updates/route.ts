import { NextResponse } from "next/server";

import { APP_VERSION } from "@/lib/app-version";
import { compareSemver } from "@/lib/compare-semver";

export const dynamic = "force-dynamic";

const PACKAGE_NAME = "@wangru8080/codex-web";
const REGISTRY_URL = "https://registry.npmjs.org/@wangru8080%2Fcodex-web/latest";
const RELEASE_URL = `https://www.npmjs.com/package/${PACKAGE_NAME}`;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

type FetchRegistry = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function readUpdateStatus(
  fetchRegistry: FetchRegistry = fetch,
  currentVersion = APP_VERSION,
) {
  const response = await fetchRegistry(REGISTRY_URL, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`npm registry 返回 ${response.status}`);

  const metadata: unknown = await response.json();
  const latestVersion = metadata && typeof metadata === "object" && "version" in metadata
    ? (metadata as { version?: unknown }).version
    : null;
  if (typeof latestVersion !== "string" || !VERSION_PATTERN.test(latestVersion)) {
    throw new Error("npm registry 未返回有效版本");
  }

  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareSemver(latestVersion, currentVersion) > 0,
    releaseUrl: RELEASE_URL,
    source: "npm.registry/@wangru8080/codex-web/latest" as const,
  };
}

export async function GET() {
  try {
    return NextResponse.json(await readUpdateStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.warn("[app/updates] npm 更新检查失败：", error);
    return NextResponse.json(
      { error: "无法从 npm registry 获取最新版本" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
