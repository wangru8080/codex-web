"use client";

/**
 * Settings → Health — read-only daily health overview.
 *
 * Phase 2C.5. Health is the *日常问题定位* page, not a wizard. It does
 * not run probes on its own and does not write anything; instead it
 * reuses the data the rest of Settings already pulls (`useOverviewData`,
 * `useClaudeStatus`, the runtime resolver) and surfaces five concerns
 * in one place:
 *
 *   1. Provider connectivity
 *   2. 执行引擎 / CLI
 *   3. Default model validity
 *   4. Models exposure
 *   5. Assistant workspace / local environment
 *
 * Each row shows status + 原因 + 影响 + a single primary CTA. Live
 * probes / repair flows stay with Setup Center; Provider Doctor stays
 * with Providers. Health is the index — it points the user at the
 * right specialist surface, it doesn't try to be one.
 */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/hooks/useTranslation";
import { useClaudeStatus } from "@/hooks/useClaudeStatus";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  Warning,
  XCircle,
  Plug,
  UserCircle,
  CaretRight,
  Info,
} from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { cn } from "@/lib/utils";
import { useOverviewData } from "./useOverviewData";
import type { TranslationKey } from "@/i18n";

type Severity = "ok" | "warn" | "error";

interface HealthRow {
  id: string;
  icon: React.ReactNode;
  title: string;
  severity: Severity;
  reason: string;
  impact?: string;
  ctaLabel: string;
  ctaOnClick: () => void;
}

const SEVERITY_DOT: Record<Severity, string> = {
  ok: "bg-status-success-foreground",
  warn: "bg-status-warning-foreground",
  error: "bg-destructive",
};

const SEVERITY_ICON: Record<Severity, React.ReactNode> = {
  ok: <CheckCircle size={14} weight="fill" className="text-status-success-foreground shrink-0" />,
  warn: <Warning size={14} weight="fill" className="text-status-warning-foreground shrink-0" />,
  error: <XCircle size={14} weight="fill" className="text-destructive shrink-0" />,
};

export function HealthSection() {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "对话";
  const state = useOverviewData();
  const { status: claudeStatus } = useClaudeStatus();
  // Settings is route-level split — cross-section CTAs must router.push
  // a route path; otherwise clicking a Health row only mutates the URL
  // hash without switching pages. See `settings-link-migration.test.ts`.
  const router = useRouter();
  const navToSection = useCallback((section: string) => {
    router.push(`/settings/${section}`);
  }, [router]);

  // While `useOverviewData` is still hydrating its first fetch, every
  // counter sits at the initial-state default (0). Rendering health
  // rows on those zeros would falsely report "no providers / no
  // models" for ~200ms after mount; show a loading shell until the
  // first fetch resolves.
  if (state.loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {t("settings.health" as TranslationKey)}
          </h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t("settings.healthDesc" as TranslationKey)}
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-border/50 bg-card/50 p-10 text-center">
          <p className="text-xs text-muted-foreground">{isZh ? "加载中…" : "Loading…"}</p>
        </div>
      </div>
    );
  }

  const rows: HealthRow[] = [];

  // ── 1. Provider connectivity ─────────────────────────────────
  rows.push((() => {
    const count = state.providersConfigured;
    if (count === 0) {
      return {
        id: "providers",
        icon: <Plug size={16} />,
        title: isZh ? "服务商连接" : "Provider connectivity",
        severity: "error",
        reason: isZh ? "尚未配置任何 provider" : "No providers configured",
        impact: isZh
          ? "chat 无法发送 — 需要至少添加一个 provider"
          : "Chat cannot start without a connected provider",
        ctaLabel: isZh ? "去 Providers" : "Open Providers",
        ctaOnClick: () => navToSection("providers"),
      };
    }
    return {
      id: "providers",
      icon: <Plug size={16} />,
      title: isZh ? "服务商连接" : "Provider connectivity",
      severity: "ok",
      reason: isZh
        ? `已配置 ${count} 个 provider`
        : `${count} provider${count === 1 ? "" : "s"} configured`,
      // Phase 2C.6 follow-up: the CTA was "运行诊断" but it just
      // navigated to #providers (Provider Doctor lives behind a
      // separate button there). Renaming to match the actual destination
      // — the doctor flow is no longer the headline action since
      // health/issue-filing is now log-driven, not auto-diagnose-driven.
      ctaLabel: isZh ? "查看 Providers" : "Open Providers",
      ctaOnClick: () => navToSection("providers"),
    };
  })());

  // ── 2. 执行引擎 / CLI ─────────────────────────────────────────
  rows.push((() => {
    const cliConnected = !!claudeStatus?.connected;
    const cliEnabled = state.cliEnabled;
    const warnCount = claudeStatus?.warnings?.length ?? 0;

    if (state.agentRuntime === "claude-code-sdk" && !cliEnabled) {
      return {
        id: "runtime",
        icon: <CodexWebIcon name="runtime" size="md" />,
        title: isZh ? "执行引擎 / CLI" : "执行引擎 / CLI",
        severity: "warn",
        reason: isZh
          ? "Claude Code CLI 已禁用，运行时已降级到 CodexWeb"
          : "Claude Code CLI disabled — runtime fell back to CodexWeb",
        impact: isZh
          ? "仅 CodexWeb 兼容的服务商/模型可执行"
          : "Only CodexWeb-compatible providers/models will run",
        ctaLabel: isZh ? "去执行引擎" : "Open Runtime",
        ctaOnClick: () => navToSection("runtime"),
      };
    }
    if (state.agentRuntime === "claude-code-sdk" && !cliConnected) {
      return {
        id: "runtime",
        icon: <CodexWebIcon name="runtime" size="md" />,
        title: isZh ? "执行引擎 / CLI" : "执行引擎 / CLI",
        severity: "error",
        reason: isZh
          ? "Claude Code CLI 未检测到，运行时已降级"
          : "Claude Code CLI not detected — runtime fell back",
        impact: isZh
          ? "新会话使用 CodexWeb，但 Claude Code 专属能力不可用"
          : "New chats use CodexWeb; Claude Code-only features are unavailable",
        ctaLabel: isZh ? "去执行引擎" : "Open Runtime",
        ctaOnClick: () => navToSection("runtime"),
      };
    }
    if (warnCount > 0) {
      return {
        id: "runtime",
        icon: <CodexWebIcon name="runtime" size="md" />,
        title: isZh ? "执行引擎 / CLI" : "执行引擎 / CLI",
        severity: "warn",
        reason: isZh
          ? `Claude Code 报告 ${warnCount} 条兼容性提示`
          : `Claude Code reports ${warnCount} compatibility warning${warnCount === 1 ? "" : "s"}`,
        ctaLabel: isZh ? "去执行引擎" : "Open Runtime",
        ctaOnClick: () => navToSection("runtime"),
      };
    }
    return {
      id: "runtime",
      icon: <CodexWebIcon name="runtime" size="md" strokeWidth={2} />,
      title: isZh ? "执行引擎 / CLI" : "执行引擎 / CLI",
      severity: "ok",
      reason: state.agentRuntime === "claude-code-sdk"
        ? (isZh ? "Claude Code 已就绪" : "Claude Code ready")
        : (isZh ? "CodexWeb 已就绪" : "CodexWeb ready"),
      ctaLabel: isZh ? "去执行引擎" : "Open Runtime",
      ctaOnClick: () => navToSection("runtime"),
    };
  })());

  // ── 3. Default model validity ────────────────────────────────
  rows.push((() => {
    if (state.noCompatibleProvider) {
      return {
        id: "default-model",
        icon: <CodexWebIcon name="model" size="md" />,
        title: isZh ? "默认模型有效性" : "Default model validity",
        severity: "error",
        reason: isZh
          ? "当前执行引擎 下没有可用 provider/model"
          : "No compatible provider under current Runtime",
        impact: isZh
          ? "新会话进入'无兼容服务'状态，无法发送"
          : "New chats land in the 'no compatible provider' state",
        ctaLabel: isZh ? "去执行引擎" : "Open Runtime",
        ctaOnClick: () => navToSection("runtime"),
      };
    }
    if (state.defaultInvalid) {
      const provDisplay = state.defaultProviderName ?? "?";
      const modelDisplay = state.defaultModelLabel ?? "?";
      // #27: pin-incomplete = 固定信息半截（缺 provider 绑定），模型本身可用，
      // 不是 Runtime 兼容问题。其余（provider/model-missing）才是固定目标不在
      // 当前引擎可达范围。两者都是**非阻断**（chat 会自动 fallback），统一降为
      // warning，不再说"阻断"——与 RuntimePanel banner 口径一致。
      if (state.defaultInvalidReason === "pin-incomplete") {
        return {
          id: "default-model",
          icon: <CodexWebIcon name="model" size="md" />,
          title: isZh ? "默认模型有效性" : "Default model validity",
          severity: "warn",
          reason: isZh
            ? "默认模型固定信息不完整（缺 provider 绑定）"
            : "Pinned default is incomplete (missing provider binding)",
          impact: isZh
            ? "新会话会自动使用当前环境下的可用模型；到「模型」页重新固定即可"
            : "New chats auto-use an available model; re-pin in Models to fix",
          ctaLabel: isZh ? "去 Models" : "Open Models",
          ctaOnClick: () => navToSection("models"),
        };
      }
      return {
        id: "default-model",
        icon: <CodexWebIcon name="model" size="md" />,
        title: isZh ? "默认模型有效性" : "Default model validity",
        severity: "warn",
        reason: isZh
          ? `已固定 ${provDisplay} / ${modelDisplay} — 不在当前执行引擎的兼容范围内`
          : `Pinned ${provDisplay} / ${modelDisplay} — not compatible with the current Runtime`,
        impact: isZh
          ? "新会话会自动使用当前环境下的可用模型；可去「模型」页改默认或切回 Auto"
          : "New chats fall back to an available model; change the default in Models or revert to Auto",
        ctaLabel: isZh ? "去 Models" : "Open Models",
        ctaOnClick: () => navToSection("models"),
      };
    }
    if (state.defaultMode === "pinned") {
      return {
        id: "default-model",
        icon: <CodexWebIcon name="model" size="md" />,
        title: isZh ? "默认模型有效性" : "Default model validity",
        severity: "ok",
        reason: isZh
          ? `已固定 ${state.defaultProviderName ?? "?"} / ${state.defaultModelLabel ?? "?"}`
          : `Pinned ${state.defaultProviderName ?? "?"} / ${state.defaultModelLabel ?? "?"}`,
        ctaLabel: isZh ? "去 Models" : "Open Models",
        ctaOnClick: () => navToSection("models"),
      };
    }
    return {
      id: "default-model",
      icon: <CodexWebIcon name="model" size="md" />,
      title: isZh ? "默认模型有效性" : "Default model validity",
      severity: "ok",
      reason: isZh
        ? `Auto — 当前解析到 ${state.defaultProviderName ?? "?"} / ${state.defaultModelLabel ?? "?"}`
        : `Auto — currently resolves to ${state.defaultProviderName ?? "?"} / ${state.defaultModelLabel ?? "?"}`,
      ctaLabel: isZh ? "去 Models" : "Open Models",
      ctaOnClick: () => navToSection("models"),
    };
  })());

  // ── 4. Models exposure ───────────────────────────────────────
  rows.push((() => {
    if (state.providersConfigured === 0) {
      return {
        id: "models-exposure",
        icon: <CodexWebIcon name="model" size="md" />,
        title: isZh ? "模型暴露" : "Models exposure",
        severity: "ok",
        reason: isZh
          ? "尚未配置 provider — 详见上方"
          : "No providers configured yet — see above",
        ctaLabel: isZh ? "去 Models" : "Open Models",
        ctaOnClick: () => navToSection("models"),
      };
    }
    if (state.modelsEnabled === 0) {
      return {
        id: "models-exposure",
        icon: <CodexWebIcon name="model" size="md" />,
        title: isZh ? "模型暴露" : "Models exposure",
        severity: "error",
        reason: isZh
          ? "已接入 provider，但没有任何模型对 picker 可见"
          : "Providers connected, but no models visible to the picker",
        impact: isZh
          ? "chat picker 为空，无法选择模型"
          : "Chat picker is empty",
        ctaLabel: isZh ? "去 Models" : "Open Models",
        ctaOnClick: () => navToSection("models"),
      };
    }
    const manualNote = (state.modelsManualEnabled > 0 || state.modelsManualHidden > 0)
      ? (isZh
          ? `（手动启用 ${state.modelsManualEnabled} · 手动隐藏 ${state.modelsManualHidden}）`
          : ` (${state.modelsManualEnabled} manual on · ${state.modelsManualHidden} manual off)`)
      : "";
    return {
      id: "models-exposure",
      icon: <CodexWebIcon name="model" size="md" />,
      title: isZh ? "模型暴露" : "Models exposure",
      severity: "ok",
      reason: isZh
        ? `${state.modelsEnabled} / ${state.modelsTotal} 个模型已对 picker 暴露${manualNote}`
        : `${state.modelsEnabled} of ${state.modelsTotal} models exposed to picker${manualNote}`,
      ctaLabel: isZh ? "去 Models" : "Open Models",
      ctaOnClick: () => navToSection("models"),
    };
  })());

  // ── 5. Assistant workspace / local environment ───────────────
  rows.push((() => {
    if (state.workspaceConfigured) {
      return {
        id: "workspace",
        icon: <UserCircle size={16} />,
        title: isZh ? "助理工作空间" : "Assistant workspace",
        severity: "ok",
        reason: state.workspaceName
          ? (isZh ? `已配置：${state.workspaceName}` : `Configured: ${state.workspaceName}`)
          : (isZh ? "已配置工作空间" : "Workspace configured"),
        ctaLabel: isZh ? "去助理" : "Open Assistant",
        ctaOnClick: () => navToSection("assistant"),
      };
    }
    return {
      id: "workspace",
      icon: <UserCircle size={16} />,
      title: isZh ? "助理工作空间" : "Assistant workspace",
      severity: "warn",
      reason: isZh ? "尚未配置助理工作空间" : "Assistant workspace not configured",
      impact: isZh
        ? "助理无法在本地目录上协作"
        : "Assistant cannot collaborate on local files",
      ctaLabel: isZh ? "去助理" : "Open Assistant",
      ctaOnClick: () => navToSection("assistant"),
    };
  })());

  // Overall severity = max across rows.
  const overallSeverity: Severity = rows.reduce<Severity>((acc, r) => {
    if (r.severity === "error") return "error";
    if (r.severity === "warn" && acc === "ok") return "warn";
    return acc;
  }, "ok");

  const overallTone =
    overallSeverity === "ok"
      ? (isZh ? "一切正常" : "All systems healthy")
      : overallSeverity === "warn"
        ? (isZh ? "存在 1 项以上提示" : "One or more warnings")
        : (isZh ? "存在阻塞问题" : "Blocking issues detected");

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">
            {t("settings.health" as TranslationKey)}
          </h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t("settings.healthDesc" as TranslationKey)}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[overallSeverity])} />
          <span className="text-[11px] text-muted-foreground">{overallTone}</span>
        </div>
      </div>

      {/* 5 rows of health checks */}
      <div className="rounded-lg border border-border/50 bg-card divide-y divide-border/50 overflow-hidden">
        {rows.map((row) => (
          <HealthRowItem key={row.id} row={row} />
        ))}
      </div>

      {/* "Need to investigate further?" — Phase 2C.6 reframing. The
          previous wording ("深度诊断与修复") promised auto-detection of
          root causes and an auto-repair path; in practice the doctor
          can't always identify the root cause and "repair" sometimes
          misleads. Honest framing: Health gives status; if status
          doesn't explain it, grab a diagnostic bundle and inspect /
          share. Setup Center stays an entry on the About page (as the
          install / wizard flow), not the headline action here. */}
      <div className="rounded-lg border border-border/50 bg-card p-5 flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-3">
        <div className="min-w-0 flex items-start gap-3">
          <Info size={16} className="text-foreground/60 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium">
              {isZh ? "需要进一步排查？" : "Need to investigate further?"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              {isZh
                ? "如果上方状态没有解释你遇到的问题，去 关于 页面导出诊断包，里面包含运行日志、provider 解析链与连接探测结果，便于本地排查或随 issue 一起反馈。"
                : "If the rows above don't explain what you're seeing, head to About to export a diagnostic bundle — it includes runtime logs, the provider-resolution chain, and probe results for local investigation or issue filing."}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => navToSection("about")}
        >
          {isZh ? "去 About" : "Open About"}
          <CaretRight size={12} weight="bold" />
        </Button>
      </div>
    </div>
  );
}

function HealthRowItem({ row }: { row: HealthRow }) {
  return (
    <div className="px-4 py-3.5 flex items-start gap-3">
      <span className="shrink-0 mt-1 text-foreground/60">{row.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {SEVERITY_ICON[row.severity]}
          <h3 className="text-sm font-medium leading-tight">{row.title}</h3>
        </div>
        <p className="text-xs text-foreground/85 mt-1 leading-relaxed">{row.reason}</p>
        {row.impact && (
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            {row.impact}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={row.ctaOnClick}
      >
        {row.ctaLabel}
        <CaretRight size={12} weight="bold" />
      </Button>
    </div>
  );
}
