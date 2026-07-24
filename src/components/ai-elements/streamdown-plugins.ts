"use client";

import { useEffect, useMemo, useState } from "react";
import { cjk } from "@streamdown/cjk";
import type { PluginConfig } from "streamdown";

export type MarkdownCapabilities = {
  code: boolean;
  math: boolean;
  mermaid: boolean;
};

const EMPTY_CAPABILITIES: MarkdownCapabilities = {
  code: false,
  math: false,
  mermaid: false,
};

export function detectMarkdownCapabilities(markdown: string): MarkdownCapabilities {
  if (!markdown) return EMPTY_CAPABILITIES;

  let code = false;
  let mermaid = false;
  const proseLines: string[] = [];
  let openFence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of markdown.split("\n")) {
    if (openFence) {
      const closing = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
      if (
        closing &&
        closing[1][0] === openFence.marker &&
        closing[1].length >= openFence.length
      ) {
        openFence = null;
      }
      continue;
    }

    const opening = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\s`~]*)/);
    if (!opening) {
      proseLines.push(line);
      continue;
    }

    const language = opening[2].toLowerCase();
    if (language === "mermaid") mermaid = true;
    else code = true;
    openFence = {
      marker: opening[1][0] as "`" | "~",
      length: opening[1].length,
    };
  }

  const prose = proseLines.join("\n").replace(/(`+)[^\n]*?\1/g, "");
  return {
    code,
    mermaid,
    math: hasMathSyntax(prose),
  };
}

function hasMathSyntax(text: string): boolean {
  return hasDelimiterPair(text, "$$", "$$")
    || hasDelimiterPair(text, "\\(", "\\)")
    || hasDelimiterPair(text, "\\[", "\\]")
    || hasInlineDollarMath(text);
}

function hasDelimiterPair(text: string, opening: string, closing: string): boolean {
  let openingIndex = nextUnescapedIndex(text, opening, 0);
  while (openingIndex >= 0) {
    const closingIndex = nextUnescapedIndex(text, closing, openingIndex + opening.length);
    if (closingIndex >= 0 && text.slice(openingIndex + opening.length, closingIndex).trim()) {
      return true;
    }
    openingIndex = nextUnescapedIndex(text, opening, openingIndex + opening.length);
  }
  return false;
}

function hasInlineDollarMath(text: string): boolean {
  let openingIndex = nextSingleDollar(text, 0);
  while (openingIndex >= 0) {
    const closingIndex = nextSingleDollar(text, openingIndex + 1);
    if (closingIndex < 0) return false;
    const content = text.slice(openingIndex + 1, closingIndex);
    if (
      content.trim() &&
      content[0] === content[0].trimStart() &&
      content.at(-1) === content.at(-1)?.trimEnd()
    ) {
      return true;
    }
    openingIndex = nextSingleDollar(text, closingIndex + 1);
  }
  return false;
}

function nextSingleDollar(text: string, fromIndex: number): number {
  let index = nextUnescapedIndex(text, "$", fromIndex);
  while (index >= 0) {
    if (text[index - 1] !== "$" && text[index + 1] !== "$") return index;
    index = nextUnescapedIndex(text, "$", index + 1);
  }
  return -1;
}

function nextUnescapedIndex(text: string, token: string, fromIndex: number): number {
  let index = text.indexOf(token, fromIndex);
  while (index >= 0) {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0) return index;
    index = text.indexOf(token, index + token.length);
  }
  return -1;
}

let codePluginPromise: Promise<NonNullable<PluginConfig["code"]>> | null = null;
let mathPluginPromise: Promise<NonNullable<PluginConfig["math"]>> | null = null;
let mermaidPluginPromise: Promise<NonNullable<PluginConfig["mermaid"]>> | null = null;

export async function loadStreamdownPlugins(
  capabilities: MarkdownCapabilities,
): Promise<Partial<PluginConfig>> {
  const [code, math, mermaid] = await Promise.all([
    capabilities.code ? loadCodePlugin() : undefined,
    capabilities.math ? loadMathPlugin() : undefined,
    capabilities.mermaid ? loadMermaidPlugin() : undefined,
  ]);
  return {
    ...(code ? { code } : {}),
    ...(math ? { math } : {}),
    ...(mermaid ? { mermaid } : {}),
  };
}

export function useStreamdownPlugins(markdown: string): PluginConfig {
  const capabilities = useMemo(() => detectMarkdownCapabilities(markdown), [markdown]);
  const capabilityKey = `${Number(capabilities.code)}${Number(capabilities.math)}${Number(capabilities.mermaid)}`;
  const [loaded, setLoaded] = useState<Partial<PluginConfig>>({});

  useEffect(() => {
    if (capabilityKey === "000") return;
    let active = true;
    loadStreamdownPlugins(capabilities).then((plugins) => {
      if (active) setLoaded(plugins);
    }).catch(() => {
      if (active) setLoaded({});
    });
    return () => {
      active = false;
    };
  }, [capabilityKey]);

  return useMemo(() => ({
    cjk,
    ...(capabilities.code && loaded.code ? { code: loaded.code } : {}),
    ...(capabilities.math && loaded.math ? { math: loaded.math } : {}),
    ...(capabilities.mermaid && loaded.mermaid ? { mermaid: loaded.mermaid } : {}),
  }), [capabilities.code, capabilities.math, capabilities.mermaid, loaded]);
}

function loadCodePlugin(): Promise<NonNullable<PluginConfig["code"]>> {
  if (!codePluginPromise) {
    codePluginPromise = import("./code-block")
      .then((module) => {
        markOptionalPluginLoaded("code");
        return module.createSharedCodePlugin();
      })
      .catch((error) => {
        codePluginPromise = null;
        throw error;
      });
  }
  return codePluginPromise;
}

function loadMathPlugin(): Promise<NonNullable<PluginConfig["math"]>> {
  if (!mathPluginPromise) {
    mathPluginPromise = import("@streamdown/math")
      .then((module) => {
        markOptionalPluginLoaded("math");
        return module.math;
      })
      .catch((error) => {
        mathPluginPromise = null;
        throw error;
      });
  }
  return mathPluginPromise;
}

function loadMermaidPlugin(): Promise<NonNullable<PluginConfig["mermaid"]>> {
  if (!mermaidPluginPromise) {
    mermaidPluginPromise = import("@streamdown/mermaid")
      .then((module) => {
        markOptionalPluginLoaded("mermaid");
        return module.mermaid;
      })
      .catch((error) => {
        mermaidPluginPromise = null;
        throw error;
      });
  }
  return mermaidPluginPromise;
}

function markOptionalPluginLoaded(name: "code" | "math" | "mermaid"): void {
  if (typeof window === "undefined") return;
  const performanceWindow = window as typeof window & { __CODEX_WEB_PERFORMANCE__?: unknown };
  if (performanceWindow.__CODEX_WEB_PERFORMANCE__) {
    performance.mark(`codex.optional-plugin.${name}.loaded`);
  }
}
