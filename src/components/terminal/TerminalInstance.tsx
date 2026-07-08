"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Ansi from "ansi-to-react";
import type { useTerminal } from "@/hooks/useTerminal";

interface TerminalInstanceProps {
  terminal: ReturnType<typeof useTerminal>;
}

/**
 * TerminalInstance — renders terminal output with ANSI color support.
 *
 * Uses ansi-to-react for ANSI escape code rendering.
 * xterm.js integration can be added later for full terminal emulation.
 */
/** Hard cap on terminal output characters (~500 KB). Oldest output is discarded. */
const MAX_OUTPUT_CHARS = 500_000;

function truncateOutput(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? text.slice(-MAX_OUTPUT_CHARS) : text;
}

export function TerminalInstance({ terminal }: TerminalInstanceProps) {
  const { isElectron, connected, exited, create, write, setOnData } = terminal;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [output, setOutput] = useState("");
  const bufferRef = useRef("");
  const rafRef = useRef<number | null>(null);

  // Flush buffered output via rAF to avoid excessive re-renders
  const flush = useCallback(() => {
    rafRef.current = null;
    bufferRef.current = truncateOutput(bufferRef.current);
    setOutput(bufferRef.current);
  }, []);

  // Subscribe to PTY output
  useEffect(() => {
    setOnData((data: string) => {
      bufferRef.current += data;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    });
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [setOnData, flush]);

  // Auto-scroll on new output
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  // Create terminal on mount
  useEffect(() => {
    if (isElectron && !connected && !exited) {
      create(120, 30);
    }
  }, [isElectron, connected, exited, create]);

  // Focus input when terminal connects
  useEffect(() => {
    inputRef.current?.focus();
  }, [connected]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const value = inputRef.current?.value || '';
      write(value + '\n');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleContainerClick = () => {
    inputRef.current?.focus();
  };

  return (
    <div
      className="flex flex-col h-full bg-[#1a1a1a] text-[#d4d4d4] font-mono text-xs"
      onClick={handleContainerClick}
    >
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto p-2 whitespace-pre-wrap break-all"
      >
        <Ansi>{output}</Ansi>
      </div>
      <div className="flex items-center border-t border-[#333] px-2">
        <span className="text-green-400 mr-1">$</span>
        <input
          ref={inputRef}
          type="text"
          className="flex-1 bg-transparent border-none outline-none text-xs py-1.5 text-[#d4d4d4] caret-[#d4d4d4]"
          onKeyDown={handleKeyDown}
          autoFocus
          spellCheck={false}
        />
      </div>
    </div>
  );
}
