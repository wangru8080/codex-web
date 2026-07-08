"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { UpdateInfo, UpdateContextValue } from "@/hooks/useUpdate";

const CHECK_INTERVAL = 8 * 60 * 60 * 1000; // 8 hours
const DISMISSED_VERSION_KEY = "codepilot_dismissed_update_version";
// Per-session dismiss: clicking "稍后" in this run shouldn't make the
// dialog re-appear on every page navigation. Stored in sessionStorage
// so a fresh tab / app restart will still nudge the user once.
const SESSION_DISMISSED_VERSION_KEY = "codepilot_session_dismissed_update_version";

function isVersionDismissed(version: string | undefined | null): boolean {
  if (!version || typeof window === "undefined") return false;
  if (localStorage.getItem(DISMISSED_VERSION_KEY) === version) return true;
  if (sessionStorage.getItem(SESSION_DISMISSED_VERSION_KEY) === version) return true;
  return false;
}

/**
 * Encapsulates all update-checking logic (native Electron updater + browser fallback).
 * Returns a memoised context value suitable for UpdateContext.Provider.
 */
export function useUpdateChecker(): UpdateContextValue {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  // Runtime detection: native updater available when running in Electron with updater bridge
  const isNativeUpdater = typeof window !== "undefined" && !!window.electronAPI?.updater;

  // --- Native updater status listener ---
  useEffect(() => {
    if (!isNativeUpdater) return;
    const cleanup = window.electronAPI!.updater!.onStatus((event) => {
      switch (event.status) {
        case 'available':
          setUpdateInfo((prev) => ({
            updateAvailable: true,
            latestVersion: event.info?.version ?? prev?.latestVersion ?? '',
            currentVersion: prev?.currentVersion ?? '',
            releaseName: event.info?.releaseName ?? prev?.releaseName ?? '',
            releaseNotes: typeof event.info?.releaseNotes === 'string' ? event.info.releaseNotes : prev?.releaseNotes ?? '',
            releaseUrl: prev?.releaseUrl ?? '',
            publishedAt: event.info?.releaseDate ?? prev?.publishedAt ?? '',
            downloadProgress: null,
            readyToInstall: false,
            isNativeUpdate: true,
            lastError: null,
          }));
          {
            const ver = event.info?.version;
            if (ver && !isVersionDismissed(ver)) {
              setShowDialog(true);
            }
          }
          break;
        case 'not-available':
          setUpdateInfo((prev) => prev ? { ...prev, updateAvailable: false, isNativeUpdate: true, lastError: null } : prev);
          break;
        case 'downloading':
          setUpdateInfo((prev) => prev ? {
            ...prev,
            downloadProgress: event.progress?.percent ?? prev.downloadProgress,
            isNativeUpdate: true,
            lastError: null,
          } : prev);
          break;
        case 'downloaded':
          setUpdateInfo((prev) => prev ? {
            ...prev,
            readyToInstall: true,
            downloadProgress: 100,
            isNativeUpdate: true,
            lastError: null,
          } : prev);
          break;
        case 'error':
          setUpdateInfo((prev) => prev ? {
            ...prev,
            lastError: event.error ?? 'Unknown error',
            isNativeUpdate: true,
          } : prev);
          break;
      }
      if (event.status === 'checking') {
        setChecking(true);
      } else {
        setChecking(false);
      }
    });
    return cleanup;
  }, [isNativeUpdater]);

  // --- Browser-mode update check (fallback for non-Electron) ---
  const checkForUpdatesBrowser = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/app/updates");
      if (!res.ok) return;
      const data = await res.json();
      const info: UpdateInfo = {
        ...data,
        downloadProgress: null,
        readyToInstall: false,
        isNativeUpdate: false,
        lastError: null,
      };
      setUpdateInfo(info);

      if (info.updateAvailable && !isVersionDismissed(info.latestVersion)) {
        setShowDialog(true);
      }
    } catch {
      // silently ignore network errors
    } finally {
      setChecking(false);
    }
  }, []);

  // --- Unified check: native first, browser fallback ---
  const checkForUpdates = useCallback(async () => {
    if (isNativeUpdater) {
      try {
        await window.electronAPI!.updater!.checkForUpdates();
        return;
      } catch {
        // native check failed, fall through to browser mode
      }
    }
    await checkForUpdatesBrowser();
  }, [isNativeUpdater, checkForUpdatesBrowser]);

  // Browser mode: periodic check (non-Electron or as fallback)
  useEffect(() => {
    if (isNativeUpdater) return; // native updater handles its own initial check
    checkForUpdatesBrowser();
    const id = setInterval(checkForUpdatesBrowser, CHECK_INTERVAL);
    return () => clearInterval(id);
  }, [isNativeUpdater, checkForUpdatesBrowser]);

  const dismissUpdate = useCallback(() => {
    setShowDialog(false);
    // Mark this version as dismissed for the current session so later
    // page navigations / hot reloads / chat-page mounts don't re-trigger
    // the "有新版本可用" dialog. localStorage value (set elsewhere if
    // the user has a permanent-dismiss path in the future) takes
    // precedence; sessionStorage is the per-tab fallback.
    if (typeof window !== "undefined") {
      const ver = updateInfo?.latestVersion;
      if (ver) {
        try {
          sessionStorage.setItem(SESSION_DISMISSED_VERSION_KEY, ver);
        } catch { /* private browsing / quota — silently degrade */ }
      }
    }
  }, [updateInfo]);

  const downloadUpdate = useCallback(async () => {
    if (isNativeUpdater) {
      await window.electronAPI!.updater!.downloadUpdate();
    }
  }, [isNativeUpdater]);

  const quitAndInstall = useCallback(() => {
    if (isNativeUpdater) {
      window.electronAPI!.updater!.quitAndInstall();
    }
  }, [isNativeUpdater]);

  return useMemo(
    () => ({
      updateInfo,
      checking,
      checkForUpdates,
      downloadUpdate,
      dismissUpdate,
      showDialog,
      setShowDialog,
      quitAndInstall,
    }),
    [updateInfo, checking, checkForUpdates, downloadUpdate, dismissUpdate, showDialog, quitAndInstall]
  );
}
