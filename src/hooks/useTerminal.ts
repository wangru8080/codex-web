"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { usePanel } from "./usePanel";

export function useTerminal() {
  const { workingDirectory, sessionId, terminalOpen } = usePanel();
  const [isElectron] = useState(
    () => typeof window !== "undefined" && !!window.electronAPI?.terminal
  );
  const [connected, setConnected] = useState(false);
  const [exited, setExited] = useState(false);
  const terminalIdRef = useRef<string>("");
  const unsubDataRef = useRef<(() => void) | null>(null);
  const unsubExitRef = useRef<(() => void) | null>(null);
  const onDataCallbackRef = useRef<((data: string) => void) | null>(null);

  const create = useCallback(async (cols: number, rows: number) => {
    const api = window.electronAPI?.terminal;
    if (!api || !workingDirectory) return;

    // Kill previous terminal for this session
    if (terminalIdRef.current) {
      try {
        await api.kill(terminalIdRef.current);
      } catch {
        // ignore
      }
    }

    const id = `term-${sessionId || 'default'}-${Date.now()}`;
    terminalIdRef.current = id;
    setExited(false);

    // Subscribe to events
    unsubDataRef.current?.();
    unsubExitRef.current?.();

    unsubDataRef.current = api.onData((data) => {
      if (data.id === id) {
        onDataCallbackRef.current?.(data.data);
      }
    });

    unsubExitRef.current = api.onExit((data) => {
      if (data.id === id) {
        setConnected(false);
        setExited(true);
      }
    });

    await api.create({ id, cwd: workingDirectory, cols, rows });
    setConnected(true);
  }, [workingDirectory, sessionId]);

  const write = useCallback((data: string) => {
    const api = window.electronAPI?.terminal;
    if (!api || !terminalIdRef.current) return;
    api.write(terminalIdRef.current, data);
  }, []);

  const resize = useCallback(async (cols: number, rows: number) => {
    const api = window.electronAPI?.terminal;
    if (!api || !terminalIdRef.current) return;
    await api.resize(terminalIdRef.current, cols, rows);
  }, []);

  const kill = useCallback(async () => {
    const api = window.electronAPI?.terminal;
    if (!api || !terminalIdRef.current) return;
    try {
      await api.kill(terminalIdRef.current);
    } catch {
      // ignore
    }
    terminalIdRef.current = "";
    setConnected(false);
  }, []);

  const setOnData = useCallback((callback: (data: string) => void) => {
    onDataCallbackRef.current = callback;
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      unsubDataRef.current?.();
      unsubExitRef.current?.();
      if (terminalIdRef.current && window.electronAPI?.terminal) {
        window.electronAPI.terminal.kill(terminalIdRef.current).catch(() => {});
      }
    };
  }, []);

  return {
    isElectron,
    connected,
    exited,
    terminalOpen,
    create,
    write,
    resize,
    kill,
    setOnData,
  };
}
