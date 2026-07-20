"use client";

/**
 * /settings 根路由只做客户端兼容跳转，不导入任何设置区块。
 * 旧 provider/model/runtime 等 hash 统一收敛到 Codex 设置页。
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const SECTION_HASH_TO_PATH: Record<string, string> = {
  overview: "/settings/codex",
  codex: "/settings/codex",
  general: "/settings/general",
  appearance: "/settings/appearance",
  providers: "/settings/codex",
  models: "/settings/codex",
  runtime: "/settings/codex",
  health: "/settings/codex",
  usage: "/settings/codex",
  assistant: "/settings/codex",
  tasks: "/settings/codex",
  archived: "/settings/archived",
  bridge: "/settings/general",
  about: "/settings/about",
};

export default function SettingsRootRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace("#", "");
    const target = SECTION_HASH_TO_PATH[hash] ?? "/settings/codex";
    router.replace(target);
  }, [router]);

  return null;
}
