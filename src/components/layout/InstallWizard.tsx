"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Check,
  X,
  Minus,
  SpinnerGap,
  Circle,
  Copy,
  DownloadSimple,
  Warning,
} from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";

interface InstallProgress {
  status: "idle" | "running" | "success" | "failed" | "cancelled";
  currentStep: string | null;
  steps: Array<{
    id: string;
    label: string;
    status: "pending" | "running" | "success" | "failed" | "skipped";
    error?: string;
  }>;
  logs: string[];
}

interface ClaudeInstallDetection {
  path: string;
  version: string | null;
  type: "native" | "homebrew" | "npm" | "bun" | "unknown";
}

interface InstallWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstallComplete?: () => void;
}

type WizardPhase =
  | "checking"
  | "confirm"
  | "needs-git"
  | "already-installed"
  | "installing"
  | "success"
  | "failed";

interface PrereqResult {
  hasClaude: boolean;
  claudeVersion?: string;
  claudePath?: string;
  claudeInstallType?: string;
  otherInstalls?: ClaudeInstallDetection[];
  hasGit?: boolean;
  platform?: string;
}

function getInstallAPI() {
  if (typeof window !== "undefined") {
    return window.electronAPI?.install;
  }
  return undefined;
}

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <Check size={16} className="text-status-success-foreground" />;
    case "running":
      return <SpinnerGap size={16} className="text-primary animate-spin" />;
    case "failed":
      return <X size={16} className="text-status-error-foreground" />;
    case "skipped":
      return <Minus size={16} className="text-muted-foreground" />;
    default:
      return <Circle size={14} className="text-muted-foreground/40" />;
  }
}

const INSTALL_TYPE_LABELS: Record<string, string> = {
  native: "Native",
  homebrew: "Homebrew",
  npm: "npm (deprecated)",
  bun: "bun",
  unknown: "Unknown",
};

function getUninstallAdvice(type: string): string | null {
  switch (type) {
    case 'npm': return 'npm uninstall -g @anthropic-ai/claude-code';
    case 'bun': return 'bun remove -g @anthropic-ai/claude-code';
    case 'homebrew': return 'brew uninstall --cask claude-code';
    default: return null;
  }
}

export function InstallWizard({
  open,
  onOpenChange,
  onInstallComplete,
}: InstallWizardProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<WizardPhase>("checking");
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [prereqs, setPrereqs] = useState<PrereqResult | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const scrollToBottom = useCallback(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  // Cancel backend install and clean up listener
  const cancelInstall = useCallback(async () => {
    const api = getInstallAPI();
    if (!api) return;
    try {
      await api.cancel();
    } catch {
      // ignore cancel errors
    }
  }, []);

  const startInstall = useCallback(async () => {
    const api = getInstallAPI();
    if (!api) return;

    setPhase("installing");

    // Subscribe to progress updates
    if (cleanupRef.current) cleanupRef.current();
    cleanupRef.current = api.onProgress((p) => {
      setProgress(p);
      setLogs(p.logs);

      if (p.status === "success") {
        setPhase("success");
      } else if (p.status === "failed" || p.status === "cancelled") {
        setPhase("failed");
      }
    });

    try {
      await api.start();
    } catch (err: unknown) {
      setPhase("failed");
      const msg = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [...prev, `Installation error: ${msg}`]);
    }
  }, []);

  const checkPrereqs = useCallback(async () => {
    const api = getInstallAPI();
    if (!api) return;

    setPhase("checking");
    setLogs(["Checking environment..."]);
    setProgress(null);
    setPrereqs(null);

    try {
      const result = await api.checkPrerequisites();
      setPrereqs(result);

      // Windows requires Git for Windows — check FIRST, even if Claude is already installed,
      // because Claude Code won't actually work without Git Bash on Windows.
      if (result.platform === "win32" && result.hasGit === false) {
        setLogs((prev) => [
          ...prev,
          ...(result.hasClaude
            ? [`Claude Code ${result.claudeVersion} found, but Git for Windows is missing.`]
            : ["Claude Code CLI not detected."]),
          "Git for Windows is required for Claude Code to work on Windows.",
        ]);
        setPhase("needs-git");
        return;
      }

      if (result.hasClaude) {
        const typeLabel = INSTALL_TYPE_LABELS[result.claudeInstallType || "unknown"];
        setLogs((prev) => [
          ...prev,
          `Claude Code ${result.claudeVersion} found (${typeLabel}).`,
          `Path: ${result.claudePath}`,
        ]);
        setPhase("already-installed");
        return;
      }

      setLogs((prev) => [
        ...prev,
        "Claude Code CLI not detected.",
      ]);
      setPhase("confirm");
    } catch (err: unknown) {
      setPhase("failed");
      const msg = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [...prev, `Error checking prerequisites: ${msg}`]);
    }
  }, []);

  const handleCopyLogs = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(logs.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }, [logs]);

  const handleDone = useCallback(() => {
    onOpenChange(false);
    onInstallComplete?.();
  }, [onOpenChange, onInstallComplete]);

  // Close dialog: cancel if installing, invalidate caches if install succeeded
  const handleOpenChange = useCallback(
    async (nextOpen: boolean) => {
      if (!nextOpen) {
        if (phase === "installing") {
          await cancelInstall();
        }
        // If install succeeded, always invalidate caches regardless of how the dialog was closed
        if (phase === "success") {
          onInstallComplete?.();
        }
      }
      onOpenChange(nextOpen);
    },
    [phase, cancelInstall, onOpenChange, onInstallComplete]
  );

  // Auto-check when dialog opens
  useEffect(() => {
    if (open) {
      setPhase("checking"); // eslint-disable-line react-hooks/set-state-in-effect -- reset state before async check
      setLogs([]);
      setProgress(null);
      setCopied(false);
      setPrereqs(null);
      checkPrereqs();
    }
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [open, checkPrereqs]);

  const steps = progress?.steps ?? [];
  const hasConflicts = (prereqs?.otherInstalls?.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('install.title')}</DialogTitle>
          <DialogDescription>
            {phase === "confirm"
              ? t('install.nativeDescription')
              : t('install.autoDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Step list (only during/after install) */}
          {steps.length > 0 && (
            <div className="space-y-2">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className="flex items-center gap-2.5 text-sm"
                >
                  <StepIcon status={step.status} />
                  <span
                    className={cn(
                      step.status === "pending" && "text-muted-foreground",
                      step.status === "running" && "text-foreground font-medium",
                      step.status === "success" && "text-status-success-foreground",
                      step.status === "failed" && "text-status-error-foreground",
                      step.status === "skipped" && "text-muted-foreground"
                    )}
                  >
                    {step.label}
                  </span>
                  {step.error && (
                    <span className="text-xs text-status-error-foreground ml-auto truncate max-w-[200px]">
                      {step.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Phase: checking */}
          {phase === "checking" && steps.length === 0 && (
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <SpinnerGap size={16} className="animate-spin" />
              <span>{t('install.checkingPrereqs')}</span>
            </div>
          )}

          {/* Phase: needs-git — Windows requires Git for Windows */}
          {phase === "needs-git" && (
            <div className="space-y-3">
              <div className="rounded-lg bg-status-warning-muted px-4 py-3 text-sm space-y-1.5">
                <div className="flex items-center gap-2">
                  <Warning size={16} className="text-status-warning-foreground shrink-0" />
                  <p className="text-status-warning-foreground font-medium">
                    {t('install.gitRequired')}
                  </p>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t('install.gitDescription')}
                </p>
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>{t('install.gitSteps')}</p>
                <ol className="list-decimal list-inside space-y-0.5 text-xs">
                  <li>{t('install.gitStep1')}</li>
                  <li>{t('install.gitStep2')}</li>
                  <li>{t('install.gitStep3')}</li>
                </ol>
              </div>
            </div>
          )}

          {/* Phase: confirm — ask user before installing */}
          {phase === "confirm" && (
            <div className="space-y-3">
              <div className="rounded-lg bg-status-warning-muted px-4 py-3 text-sm space-y-1.5">
                <p className="text-status-warning-foreground">
                  Claude Code CLI — {t('install.notDetected')}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('install.nativeExplain')}
              </p>
            </div>
          )}

          {/* Phase: already-installed */}
          {phase === "already-installed" && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg bg-status-success-muted px-4 py-3">
                <Check size={20} className="text-status-success-foreground shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-status-success-foreground">
                    {t('install.alreadyInstalled')}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {prereqs?.claudeVersion} ({INSTALL_TYPE_LABELS[prereqs?.claudeInstallType || "unknown"]})
                  </p>
                </div>
              </div>

              {/* Conflict warning: multiple installations detected */}
              {hasConflicts && (
                <div className="rounded-lg bg-status-warning-muted px-4 py-3 text-sm space-y-2">
                  <div className="flex items-center gap-2">
                    <Warning size={16} className="text-status-warning-foreground shrink-0" />
                    <p className="font-medium text-status-warning-foreground">
                      {t('install.conflictTitle')}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>{t('install.conflictUsing')}: <code className="bg-muted px-1 rounded">{prereqs?.claudePath}</code></p>
                    {prereqs?.otherInstalls?.map((inst, i) => {
                      const advice = getUninstallAdvice(inst.type);
                      return (
                        <div key={i} className="space-y-0.5">
                          <p>
                            {t('install.conflictAlso')}: <code className="bg-muted px-1 rounded">{inst.path}</code> ({INSTALL_TYPE_LABELS[inst.type]} {inst.version})
                          </p>
                          {advice && (
                            <p>{t('install.conflictRemove')}: <code className="bg-muted px-1 rounded">{advice}</code></p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Phase: success */}
          {phase === "success" && (
            <div className="flex items-center gap-3 rounded-lg bg-status-success-muted px-4 py-3">
              <Check size={20} className="text-status-success-foreground shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-status-success-foreground">
                  {t('install.complete')}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t('install.nativeCompleteDesc')}
                </p>
              </div>
            </div>
          )}

          {/* Log output */}
          {logs.length > 0 && (
            <div className="rounded-md bg-zinc-950 dark:bg-zinc-900 border border-zinc-800 max-h-48 overflow-y-auto">
              <div className="p-3 font-mono text-xs text-zinc-300 space-y-0.5">
                {logs.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    {line}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {logs.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyLogs}
            >
              <Copy size={16} />
              {copied ? t('install.copied') : t('install.copyLogs')}
            </Button>
          )}

          {/* Needs Git: "Recheck" button */}
          {phase === "needs-git" && (
            <Button size="sm" onClick={checkPrereqs}>
              {t('install.recheck')}
            </Button>
          )}

          {/* Confirm phase: "Install" button */}
          {phase === "confirm" && (
            <Button size="sm" onClick={startInstall}>
              <DownloadSimple size={16} />
              {t('install.install')}
            </Button>
          )}

          {/* Installing: cancel button */}
          {phase === "installing" && (
            <Button variant="destructive" size="sm" onClick={cancelInstall}>
              {t('install.cancel')}
            </Button>
          )}

          {/* Failed: retry */}
          {phase === "failed" && (
            <Button size="sm" onClick={checkPrereqs}>
              {t('install.retry')}
            </Button>
          )}

          {/* Success / already-installed: done */}
          {(phase === "success" || phase === "already-installed") && (
            <Button size="sm" onClick={handleDone}>
              {t('install.done')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
