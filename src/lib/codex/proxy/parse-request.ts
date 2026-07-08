/**
 * Phase 5b — Codex Responses proxy: incoming request parser.
 *
 * Codex sends a JSON POST to `/api/codex/proxy/v1/responses` shaped
 * like OpenAI's Responses-API. The parser does shape validation only
 * — semantic checks (does the targeted provider exist, do we have
 * credentials etc.) happen later in the adapter so a structured
 * error can name the actual cause.
 *
 * Validation philosophy: lenient on optional fields, strict on the
 * three load-bearing ones (`model`, `input`, item shape). Anything
 * missing surfaces as `invalid_request` with a sentence naming the
 * field — Codex's reader displays the message verbatim.
 */

import type {
  ClassifiedNonFunctionTool,
  ResponsesContentBlock,
  ResponsesInputItem,
  ResponsesRequestBody,
  ResponsesTool,
} from './types';

/**
 * Phase 5c slice 5 (2026-05-16, post-smoke) — known non-function tool
 * `type` strings we preserve in `passthroughTools` rather than
 * treating as a request error.
 *
 * Source of truth: `资料/codex/codex-rs/tools/src/tool_spec.rs`
 * `ToolSpec` enum with `#[serde(tag = "type")]`. Codex serialises
 * every tool descriptor through that enum, so any `type` string
 * Codex's app-server sends on the wire is one of these seven:
 *
 *   - `function`         — handled by the main `tools` array path
 *   - `namespace`        — plugin / Skill bundle, contains nested
 *                          function tools
 *   - `tool_search`      — Codex's tool-discovery surface
 *   - `local_shell`      — Codex's shell tool
 *   - `image_generation` — OpenAI Responses built-in
 *   - `web_search`       — OpenAI Responses built-in
 *   - `custom`           — Codex's freeform (apply_patch, etc.)
 *
 * Slice 1 (pre-smoke) included `plugin` / `file_search` /
 * `code_interpreter` / `web_search_preview` speculatively, but
 * grepping the Rust source confirms none of those discriminants are
 * actually emitted by Codex — listing them just hides a real future
 * schema extension behind a permissive default. Slice 5 trims to
 * the seven from the source enum.
 *
 * The smoke failure that drove this trim:
 *   GLM-5 Turbo + Codex Runtime + image task →
 *   "tools[17] has unsupported type \"namespace\""
 * Codex's plugin/Skill namespace descriptor reached the proxy and
 * we 400'd before the bridge could mount. Now `namespace` lands on
 * `passthroughTools` and the request continues.
 *
 * NOT widened to "accept everything" — unknown types still trip
 * `unsupported_tool_kind` so a future Codex schema extension we
 * haven't snapshot'd surfaces as a clear contract gap rather than
 * silently disappearing.
 */
const KNOWN_NON_FUNCTION_TYPES = new Set<string>([
  'custom',
  'namespace',
  'tool_search',
  'local_shell',
  'web_search',
  'image_generation',
]);

export type ParseResult =
  | { ok: true; body: ResponsesRequestBody }
  | { ok: false; message: string; field?: string };

export function parseResponsesRequest(raw: unknown): ParseResult {
  if (!isObject(raw)) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }

  const model = raw.model;
  if (typeof model !== 'string' || model.length === 0) {
    return { ok: false, field: 'model', message: 'Request must include a non-empty `model` string.' };
  }

  const input = raw.input;
  if (!Array.isArray(input)) {
    return { ok: false, field: 'input', message: 'Request must include `input` as an array of items.' };
  }

  const parsedInput: ResponsesInputItem[] = [];
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (!isObject(item)) {
      return { ok: false, field: `input[${i}]`, message: `Input item ${i} must be a JSON object.` };
    }
    const itemType = item.type;
    if (itemType === 'message') {
      const role = item.role;
      if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'developer') {
        return { ok: false, field: `input[${i}].role`, message: `Item ${i} role must be user / assistant / system / developer.` };
      }
      const content = item.content;
      if (!Array.isArray(content)) {
        return { ok: false, field: `input[${i}].content`, message: `Item ${i} content must be an array.` };
      }
      const blocks: ResponsesContentBlock[] = [];
      for (let j = 0; j < content.length; j++) {
        const block = content[j];
        if (!isObject(block)) {
          return { ok: false, field: `input[${i}].content[${j}]`, message: `Content block ${j} must be a JSON object.` };
        }
        const blockType = block.type;
        if (blockType === 'input_text' || blockType === 'output_text') {
          if (typeof block.text !== 'string') {
            return { ok: false, field: `input[${i}].content[${j}].text`, message: `Content block ${j} must include text:string.` };
          }
          blocks.push({ type: blockType, text: block.text });
        } else if (blockType === 'input_image') {
          if (typeof block.image_url !== 'string') {
            return { ok: false, field: `input[${i}].content[${j}].image_url`, message: `Content block ${j} (input_image) must include image_url:string.` };
          }
          blocks.push({ type: 'input_image', image_url: block.image_url });
        } else {
          return { ok: false, field: `input[${i}].content[${j}].type`, message: `Content block ${j} has unsupported type "${String(blockType)}".` };
        }
      }
      parsedInput.push({ type: 'message', role, content: blocks });
    } else if (itemType === 'function_call') {
      if (typeof item.call_id !== 'string') {
        return { ok: false, field: `input[${i}].call_id`, message: `function_call item ${i} must include call_id:string.` };
      }
      if (typeof item.name !== 'string') {
        return { ok: false, field: `input[${i}].name`, message: `function_call item ${i} must include name:string.` };
      }
      if (typeof item.arguments !== 'string') {
        return { ok: false, field: `input[${i}].arguments`, message: `function_call item ${i} arguments must be a JSON-encoded string.` };
      }
      parsedInput.push({ type: 'function_call', call_id: item.call_id, name: item.name, arguments: item.arguments });
    } else if (itemType === 'function_call_output') {
      if (typeof item.call_id !== 'string') {
        return { ok: false, field: `input[${i}].call_id`, message: `function_call_output item ${i} must include call_id:string.` };
      }
      if (typeof item.output !== 'string') {
        return { ok: false, field: `input[${i}].output`, message: `function_call_output item ${i} output must be a string.` };
      }
      parsedInput.push({ type: 'function_call_output', call_id: item.call_id, output: item.output });
    } else {
      return { ok: false, field: `input[${i}].type`, message: `Input item ${i} has unsupported type "${String(itemType)}".` };
    }
  }

  // Phase 5c (2026-05-16) — classify Codex's `tools[]` into:
  //   1. function tools (forwarded to ai-sdk via `translateResponsesTools`)
  //   2. known non-function tools (preserved on
  //      `passthroughTools` for the bridge layer to log / inspect)
  //   3. unknown tool types → structured `unsupported_tool_kind`
  //      so a future Codex schema extension doesn't disappear into
  //      the void.
  //
  // Pre-5c we silently dropped (2) and (3) — the smoke evidence was
  // GLM/Kimi reading `imagegen` Skill text and trying to call a
  // tool that wasn't in their function list, then falling back to
  // CLI / auth.json / npm install. Surfacing both kinds means the
  // bridge can either route them through CodexWeb's tool set or
  // tell the user clearly that this type isn't bridged yet.
  let tools: ResponsesTool[] | undefined;
  let passthroughTools: ClassifiedNonFunctionTool[] | undefined;
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) {
      return { ok: false, field: 'tools', message: 'tools must be an array.' };
    }
    tools = [];
    passthroughTools = [];
    for (let i = 0; i < raw.tools.length; i++) {
      const tool = raw.tools[i];
      if (!isObject(tool)) {
        return { ok: false, field: `tools[${i}]`, message: `tools[${i}] must be a JSON object.` };
      }
      const toolType = tool.type;
      if (toolType === 'function') {
        if (typeof tool.name !== 'string') {
          return { ok: false, field: `tools[${i}].name`, message: `tools[${i}].name must be a string.` };
        }
        const parameters = isObject(tool.parameters) ? tool.parameters : undefined;
        tools.push({
          type: 'function',
          name: tool.name,
          description: typeof tool.description === 'string' ? tool.description : undefined,
          parameters,
          strict: typeof tool.strict === 'boolean' ? tool.strict : undefined,
        });
        continue;
      }
      if (typeof toolType !== 'string') {
        return {
          ok: false,
          field: `tools[${i}].type`,
          message: `tools[${i}].type must be a string ("function" or a known non-function type).`,
        };
      }
      if (!KNOWN_NON_FUNCTION_TYPES.has(toolType)) {
        // Unknown tool kind. Surface as a structured request error
        // rather than dropping — Codex's reader prints this verbatim
        // and the bridge layer doesn't have to guess.
        return {
          ok: false,
          field: `tools[${i}].type`,
          message: `tools[${i}] has unsupported type "${toolType}". Known non-function types: ${[...KNOWN_NON_FUNCTION_TYPES].join(', ')}.`,
        };
      }
      passthroughTools.push({
        rawType: toolType,
        name: typeof tool.name === 'string' ? tool.name : undefined,
        // Preserve the whole entry so a diagnostic log can dump it
        // without the parser having to know every variant's shape.
        // We clone via spread so callers can't mutate raw input.
        payload: { ...tool },
      });
    }
    if (tools.length === 0) tools = undefined;
    if (passthroughTools.length === 0) passthroughTools = undefined;
  }

  const stream = raw.stream === undefined ? true : !!raw.stream;
  const instructions = typeof raw.instructions === 'string' ? raw.instructions : undefined;
  const metadata = isObject(raw.metadata) ? raw.metadata : undefined;
  const reasoning = isObject(raw.reasoning)
    ? { effort: typeof raw.reasoning.effort === 'string' ? (raw.reasoning.effort as ResponsesRequestBody['reasoning'] extends infer R ? R extends { effort?: infer E } ? E : never : never) : undefined }
    : undefined;
  // Phase 5b smoke fix (2026-05-15) — OpenAI OAuth (Codex API)
  // requires `store: false` on outbound /responses calls. Codex
  // itself sends `store: false` in its request body; we MUST preserve
  // that and forward it via providerOptions.openai.store. Pre-fix
  // we dropped the field on parse, so even when Codex (or a manual
  // smoke) explicitly sent store:false the upstream still rejected
  // with "Store must be set to false". Accept a boolean and let the
  // adapter decide what to do with it.
  const store = typeof raw.store === 'boolean' ? raw.store : undefined;

  return {
    ok: true,
    body: {
      model,
      input: parsedInput,
      ...(tools ? { tools } : {}),
      ...(passthroughTools ? { passthroughTools } : {}),
      stream,
      ...(instructions ? { instructions } : {}),
      ...(metadata ? { metadata } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(store !== undefined ? { store } : {}),
    },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
