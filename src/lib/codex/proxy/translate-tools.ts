/**
 * Phase 5b — Responses tools[] → ai-sdk ToolSet.
 *
 * The adapter passes tool DEFINITIONS to ai-sdk so the model knows
 * what it can call; ai-sdk emits `tool-call` stream events for the
 * model's requests. We do NOT supply `execute` because Codex
 * executes the tool itself and supplies the result via a subsequent
 * `function_call_output` item in the next request's input. ai-sdk
 * supports definition-only tools — when `execute` is absent the
 * SDK stops at the tool-call boundary instead of fanning out.
 *
 * The translator preserves tool names verbatim so Codex's reader
 * can correlate function_call events back to its declared tools.
 *
 * Phase 5b smoke round 3 (2026-05-16) — AI SDK v6 schema contract.
 * ai-sdk v6 (the version this project depends on) requires the
 * tool's `inputSchema` to be a **schema wrapper object** built via
 * `jsonSchema(...)` / `zodSchema(...)` / `tool(...)`. Passing a raw
 * JSON Schema object trips a "schema is not a function" runtime
 * error inside ai-sdk's `asSchema()` helper, because the wrapper
 * carries a `validate` method ai-sdk calls. The pre-fix code force-
 * cast a plain object via `as unknown as ReturnType<typeof tool>`,
 * which compiled but blew up at streamText time. We now go through
 * the canonical `tool({ inputSchema: jsonSchema(...) })` constructor
 * so the wrapper invariants ai-sdk relies on hold.
 */

import { tool, jsonSchema, type Tool } from 'ai';
import type { JSONSchema7 } from '@ai-sdk/provider';
import type { ResponsesTool } from './types';

/** ai-sdk ToolSet without execute — definition-only. The `never`
 *  output parameter matches what `tool({ inputSchema })` (no execute,
 *  no outputSchema) returns; ai-sdk's `ToolSet` union accepts it. */
export type ResponsesProxyToolSet = Record<string, Tool<unknown, never>>;

/**
 * Translate Responses tools[] into ai-sdk ToolSet keyed by tool name.
 *
 * Returns `undefined` when the input is empty so callers can omit
 * the `tools` field on streamText (ai-sdk treats `tools: undefined`
 * and `tools: {}` differently in some places — undefined is safer).
 *
 * Built-in Codex tools (`shell`, `apply_patch`) are NOT supported
 * yet; they require CodexWeb to inject its own tool implementation
 * matching Codex's expected schema. This translator drops them
 * with a thrown error so the adapter can surface
 * `unsupported_tool_kind` cleanly instead of silently shipping a
 * broken tool list. The Codex proxy parser silently filters
 * non-function tools BEFORE they reach this layer (see
 * `parse-request.ts`), so the throw below is purely defensive.
 */
export function translateResponsesTools(
  tools: ResponsesTool[] | undefined,
): ResponsesProxyToolSet | undefined {
  if (!tools || tools.length === 0) return undefined;

  const out: ResponsesProxyToolSet = {};
  for (const t of tools) {
    if (t.type !== 'function') {
      // We filter at parse time (parse-request.ts drops non-function
      // tools silently for chat parity); this throw catches a future
      // Codex schema extension that reaches this layer through a
      // different code path.
      throw new Error(
        `Unsupported tool kind "${(t as { type: string }).type}". The Codex proxy currently translates only function-typed tools; built-in tools (shell, apply_patch) need a CodexWeb-side implementation.`,
      );
    }
    // ai-sdk's `tool()` helper requires a JSON schema for input. If
    // the request omits parameters we synthesise an empty-object
    // schema so the SDK doesn't reject the tool declaration.
    const rawSchema: JSONSchema7 =
      (t.parameters as JSONSchema7 | undefined) ??
      ({ type: 'object', properties: {}, additionalProperties: false } as JSONSchema7);
    out[t.name] = tool({
      description: t.description ?? '',
      inputSchema: jsonSchema(rawSchema),
      // Forward `strict` when Codex declared it. ai-sdk plumbs the
      // flag down to provider-format `LanguageModelV3FunctionTool.strict`
      // so providers that honour strict mode (OpenAI, etc.) receive
      // it. Pre-fix the parser preserved the field but the translator
      // dropped it silently — Codex's request shape uses strict on
      // structured-output tools and the lost flag changed model
      // behaviour without telling the user.
      ...(t.strict !== undefined ? { strict: t.strict } : {}),
      // Intentionally NO `execute` — ai-sdk stops at the tool-call
      // boundary and emits tool-call events the translator forwards
      // to Codex. Codex runs the tool and sends back
      // function_call_output in the next turn.
    });
  }
  return out;
}
