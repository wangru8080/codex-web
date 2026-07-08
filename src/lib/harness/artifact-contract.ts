/**
 * Harness Artifact Contract — Phase 5d Phase 4 (2026-05-17).
 *
 * Phase 1 gave us a capability catalog
 * (`src/lib/harness/capability-contract.ts`): WHAT the model can do.
 *
 * Phase 4 is the rendering counterpart: WHAT the model emits +
 * HOW the UI consumes it. The two halves are intentionally separate
 * because not every artifact maps 1:1 to a capability:
 *
 *   - `widget` + `malformed_widget` both originate from the `widget`
 *     capability but render via two different components (the
 *     happy path and the error block).
 *   - `media` originates from `image_generation` OR `media_import`
 *     (two distinct capabilities feeding the same renderer).
 *   - `file_diff_summary` originates from the `file_changed` SSE
 *     event but renders into the chat message as a summary card; the
 *     standalone unified-diff viewer surface is `inline_diff`. Both
 *     are capability-independent — the runtime emits them as a side
 *     effect of tool execution, not as a declared capability.
 *   - `markdown` / `html` / `inline_diff` / `inline_jsx` / `json` /
 *     `table` / `error` are NOT capability-driven at all — they are
 *     side-channel entry points (a code-block "Preview" button, a
 *     setPreviewSource call from the agent SDK, an ErrorBanner from
 *     a failure path). Capabilities don't own them; the rendering
 *     surface does.
 *
 * ── What this module IS ────────────────────────────────────────────
 *
 * A declarative registry naming, for every artifact the chat can
 * surface:
 *
 *   - `source`: where it ENTERS the UI (fence / SSE event / a
 *     PreviewSource handed to PreviewPanel).
 *   - `sourceDescriptor`: the literal label used at that entry —
 *     e.g. `fenceLanguage: 'show-widget'`, `previewKind: 'inline-json'`,
 *     `eventType: 'tool_result.media'`. Drift tests source-grep these
 *     so a future rename in the parser surface fails contract before
 *     it fails smoke.
 *   - `parser`: the function/module that turns the raw input into a
 *     structured value the renderer consumes.
 *   - `renderer`: the component that paints the structured value into
 *     the chat / preview panel.
 *   - `canonicalExample`: a copy/paste-safe sample the contract test
 *     can feed back into the parser to confirm the round-trip works.
 *
 * ── What this module IS NOT ────────────────────────────────────────
 *
 *   - It does NOT replace the actual parsers / renderers. They stay
 *     in their existing files (MessageItem.tsx parseAllShowWidgets,
 *     MediaPreview component, etc.). The contract documents what
 *     they must satisfy; drift tests in
 *     `harness-artifact-contract.test.ts` enforce alignment.
 *   - It is NOT a new feature surface. No new UI is shipped from
 *     Phase 4. The goal is to lock down the existing implicit
 *     contract so a future runtime cannot ship artifacts that don't
 *     have a documented parser/renderer pair.
 *
 * ── Phase 5 hand-off ──────────────────────────────────────────────
 *
 * A new agent runtime (Hermes / Gemini / OpenClaw / etc.) onboarding
 * through the Phase 5 playbook MUST:
 *
 *   1. Map each capability it exposes through `capability-contract.ts`.
 *   2. Map each artifact it emits through THIS file.
 *   3. Pass the contract test for both before any live-credential
 *      smoke run.
 *
 * That's the "no live-smoke-driven patching" guardrail the user
 * pinned in `feedback_no_live_smoke_driven_patching`. The artifact
 * contract is half of how it's enforced (capability contract is the
 * other half).
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type ArtifactSourceKind =
  /** The model emits a code fence in a chat message; the chat
   *  message renderer parses it inline. */
  | 'fence'
  /** Backend → frontend SSE event carries a structured payload. */
  | 'sse_event'
  /** Caller code in the UI (chat tools, file tree click, etc.)
   *  invokes `setPreviewSource(...)`; PreviewPanel discriminates
   *  on the `kind` field. */
  | 'preview_source';

export type ArtifactSourceDescriptor =
  | { readonly kind: 'fence'; readonly fenceLanguage: string }
  | { readonly kind: 'sse_event'; readonly eventType: string }
  | { readonly kind: 'preview_source'; readonly previewKind: string };

export interface ArtifactSymbol {
  /** Repo-relative module path the symbol is exported from. Drift
   *  test confirms the file exists; for `.tsx` files it also greps
   *  for the export. */
  readonly module: string;
  /** Exported name. `'<inline>'` is allowed for things that are
   *  defined inline in a larger component (e.g. the malformed_widget
   *  notice JSX inside MessageItem); the drift test will then skip
   *  the export grep but still confirm the module file exists. */
  readonly export: string;
}

export interface ArtifactContract {
  /** Stable id. Tests + handover docs reference this. */
  readonly id: string;
  readonly displayName: string;
  readonly source: ArtifactSourceKind;
  readonly sourceDescriptor: ArtifactSourceDescriptor;
  /** What turns the raw artifact into a structured value the
   *  renderer consumes. For fence artifacts this is the chat
   *  message-parser fn (e.g. `parseAllShowWidgets`). For SSE event
   *  artifacts it's the event handler that surfaces the payload to
   *  React state. For PreviewSource artifacts it's the discriminator
   *  inside PreviewPanel.tsx that selects the renderer arm. */
  readonly parser: ArtifactSymbol;
  /** The actual UI component that paints the artifact. */
  readonly renderer: ArtifactSymbol;
  /** Copy/paste-safe example the contract test can feed back through
   *  the parser. Omitted when the artifact carries opaque binary
   *  data (e.g. `media` MediaBlock with a base64 payload) — the
   *  contract test then only pins source-level shape. */
  readonly canonicalExample?: string;
  /** Optional one-line note explaining edge cases the contract test
   *  doesn't fully cover. */
  readonly notes?: string;
  /** Cross-links to `HARNESS_CAPABILITIES` entries when the artifact
   *  is capability-driven. Empty array for capability-independent
   *  artifacts (markdown / html / inline_diff / json / table / error).
   *  Multiple entries are allowed when one artifact is produced by
   *  several capabilities — e.g. `media` is emitted by both
   *  `image_generation` and `media_import`. `artifactsForCapability`
   *  uses `includes(capabilityId)` so each capability still resolves
   *  to the same shared artifact. */
  readonly relatedCapabilities: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────
// Catalog
// ─────────────────────────────────────────────────────────────────────

const widget: ArtifactContract = {
  id: 'widget',
  displayName: 'Interactive widget (show-widget fence)',
  source: 'fence',
  sourceDescriptor: { kind: 'fence', fenceLanguage: 'show-widget' },
  parser: {
    module: 'src/components/chat/MessageItem.tsx',
    export: 'parseAllShowWidgets',
  },
  renderer: {
    module: 'src/components/chat/WidgetRenderer.tsx',
    export: 'WidgetRenderer',
  },
  // Pin the canonical example to the same string the capability
  // contract holds. Drift tests cross-check identity so changing
  // the example in one file is forced to update the other.
  canonicalExample:
    '```show-widget\n{"title":"Hello","widget_code":"<div style=\'padding:8px;font:14px var(--font-sans)\'>Hello world</div>"}\n```',
  relatedCapabilities: ['widget'],
};

const malformedWidget: ArtifactContract = {
  id: 'malformed_widget',
  displayName: 'Malformed widget block (parser fallback)',
  source: 'fence',
  sourceDescriptor: { kind: 'fence', fenceLanguage: 'show-widget' },
  // Same parser as `widget`; it returns segments whose `type` is
  // either `'widget'` or `'malformed_widget'`. Renderer differs.
  parser: {
    module: 'src/components/chat/MessageItem.tsx',
    export: 'parseAllShowWidgets',
  },
  renderer: {
    module: 'src/components/chat/MessageItem.tsx',
    export: 'MalformedWidgetNotice',
  },
  // Pre-Phase-5d slice 6, the model would sometimes emit a
  // `show-widget` fence containing raw HTML. The renderer surfaces
  // this as a visible diagnostic instead of silently swallowing the
  // text. Contract test for this artifact pins ONE such malformed
  // string and asserts the parser returns `type === 'malformed_widget'`.
  canonicalExample: '```show-widget\n<div>this is not JSON</div>\n```',
  notes:
    'Tied to the `widget` capability — the same parser owns both segments. Renderer is a notice block inside MessageItem.tsx.',
  relatedCapabilities: ['widget'],
};

const media: ArtifactContract = {
  id: 'media',
  displayName: 'Image / video / audio media block',
  source: 'sse_event',
  // SSE shape: { type: 'tool_result', media: MediaBlock[] }. The
  // descriptor labels the discriminator field path for the contract
  // test source-grep.
  sourceDescriptor: { kind: 'sse_event', eventType: 'tool_result.media' },
  parser: {
    module: 'src/hooks/useSSEStream.ts',
    // The tool_result handler inside useSSEStream extracts the
    // `media` field and surfaces it on the stream snapshot. There
    // is no exported function for this — it's an inline switch arm.
    // The drift test treats `'<inline>'` as "module must exist".
    export: '<inline>',
  },
  renderer: {
    module: 'src/components/chat/MediaPreview.tsx',
    export: 'MediaPreview',
  },
  notes:
    'No canonicalExample — MediaBlock carries opaque `localPath` or `data` (base64) the contract test cannot synthesise. Source-grep pins the field path `tool_result.media`. Both `image_generation` (image gen MCP / bridge) and `media_import` (file import MCP / bridge) feed this artifact; relatedCapabilities lists both so `artifactsForCapability("media_import")` also resolves it.',
  relatedCapabilities: ['image_generation', 'media_import'],
};

const fileDiffSummary: ArtifactContract = {
  id: 'file_diff_summary',
  displayName: 'File change diff summary card (file_changed event → DiffSummary)',
  source: 'sse_event',
  sourceDescriptor: { kind: 'sse_event', eventType: 'file_changed' },
  parser: {
    // SSE side: `case 'file_changed':` arm in useSSEStream.ts. No
    // exported function — the dispatch is inline.
    module: 'src/hooks/useSSEStream.ts',
    export: '<inline>',
  },
  renderer: {
    module: 'src/components/chat/DiffSummary.tsx',
    export: 'DiffSummary',
  },
  notes:
    'After the SSE arm fires, `file-changed-event.ts` re-dispatches a frontend CustomEvent so PreviewPanel can hot-reload. This contract entry covers the SUMMARY CARDS inside MessageItem.tsx; the standalone unified-diff viewer is covered by `inline_diff`.',
  relatedCapabilities: [],
};

const inlineDiff: ArtifactContract = {
  id: 'inline_diff',
  displayName: 'Unified diff viewer (inline-diff PreviewSource)',
  source: 'preview_source',
  sourceDescriptor: { kind: 'preview_source', previewKind: 'inline-diff' },
  parser: {
    module: 'src/hooks/usePanel.ts',
    export: 'PreviewSource',
  },
  renderer: {
    // Standalone viewer dynamically imported by PreviewPanel's
    // `inline-diff` arm. The renderer file owns the +/- prefix
    // colour coding and hunk parser.
    module: 'src/components/editor/DiffViewer.tsx',
    export: 'DiffViewer',
  },
  canonicalExample:
    '--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@\n-const x = 1;\n+const x = 2;\n const y = 3;',
  notes:
    'Triggered by ```diff / ```patch fence Preview button (code-block.tsx) — distinct from `file_diff_summary` which surfaces SSE-driven cards inside chat messages.',
  relatedCapabilities: [],
};

const inlineJsx: ArtifactContract = {
  id: 'inline_jsx',
  displayName: 'JSX/TSX live preview (inline-jsx PreviewSource)',
  source: 'preview_source',
  sourceDescriptor: { kind: 'preview_source', previewKind: 'inline-jsx' },
  parser: {
    module: 'src/hooks/usePanel.ts',
    export: 'PreviewSource',
  },
  renderer: {
    // PreviewPanel mounts this through a dynamic import inside its
    // `inline-jsx` arm. SandpackPreview owns the Sandpack runtime,
    // iframe bootstrap, and React bundler integration.
    module: 'src/components/editor/SandpackPreview.tsx',
    export: 'SandpackPreview',
  },
  canonicalExample:
    'export default function Hello() { return <div>hello</div>; }',
  notes:
    'Triggered by ```jsx / ```tsx fence Preview button (code-block.tsx → PreviewPanel inline-jsx arm). Sandpack bundles the snippet client-side; no server-side renderer.',
  relatedCapabilities: [],
};

const markdown: ArtifactContract = {
  id: 'markdown',
  displayName: 'Inline Markdown preview (inline-markdown PreviewSource)',
  source: 'preview_source',
  sourceDescriptor: { kind: 'preview_source', previewKind: 'inline-markdown' },
  parser: {
    module: 'src/hooks/usePanel.ts',
    // PreviewSource discriminator — defined in the union type. The
    // contract test confirms the kind appears in usePanel.ts.
    export: 'PreviewSource',
  },
  renderer: {
    module: 'src/components/layout/panels/PreviewPanel.tsx',
    export: 'PreviewPanel',
  },
  canonicalExample: '# Heading\n\nA paragraph.',
  notes:
    'PreviewPanel branches on previewSource.kind. For file-backed markdown (kind:"file" with .md extension) the same renderer is invoked through a different arm.',
  relatedCapabilities: [],
};

const html: ArtifactContract = {
  id: 'html',
  displayName: 'Inline HTML artifact (inline-html PreviewSource)',
  source: 'preview_source',
  sourceDescriptor: { kind: 'preview_source', previewKind: 'inline-html' },
  parser: {
    module: 'src/hooks/usePanel.ts',
    export: 'PreviewSource',
  },
  renderer: {
    module: 'src/components/layout/panels/PreviewPanel.tsx',
    export: 'PreviewPanel',
  },
  canonicalExample:
    '<html><body><h1>Hello</h1></body></html>',
  notes:
    'Sandbox / CSP injected by `injectInlineHtmlCsp` (src/lib/inline-html-csp.ts). cspMode "strict" by default; "navigate" reserved for the localhost-artifact redirector.',
  relatedCapabilities: [],
};

const json: ArtifactContract = {
  id: 'json',
  displayName: 'JSON tree viewer (inline-json PreviewSource)',
  source: 'preview_source',
  sourceDescriptor: { kind: 'preview_source', previewKind: 'inline-json' },
  parser: {
    module: 'src/hooks/usePanel.ts',
    export: 'PreviewSource',
  },
  renderer: {
    module: 'src/components/editor/JsonTreeViewer.tsx',
    export: 'JsonTreeViewer',
  },
  canonicalExample: '{"hello": "world", "count": 42}',
  relatedCapabilities: [],
};

const table: ArtifactContract = {
  id: 'table',
  displayName: 'Tabular data preview (inline-datatable PreviewSource)',
  source: 'preview_source',
  sourceDescriptor: { kind: 'preview_source', previewKind: 'inline-datatable' },
  parser: {
    module: 'src/hooks/usePanel.ts',
    export: 'PreviewSource',
  },
  renderer: {
    module: 'src/components/layout/panels/PreviewPanel.tsx',
    export: 'PreviewPanel',
  },
  notes:
    'Renderer is the inline-datatable arm of PreviewPanel. No standalone canonicalExample — rows + header are structured input the parser test constructs literally.',
  relatedCapabilities: [],
};

const errorBlock: ArtifactContract = {
  id: 'error',
  displayName: 'Error banner (recoverable / user-visible)',
  source: 'preview_source',
  // No PreviewSource for errors today — they surface via the
  // ErrorBanner component invoked by the consumer that detected the
  // failure (rate limit, auth, validation, etc.). Mark `source` as
  // preview_source for catalog ordering but pin renderer; the
  // contract test allows `<inline>` source descriptors.
  sourceDescriptor: { kind: 'preview_source', previewKind: '<component>' },
  parser: {
    module: 'src/components/ui/error-banner.tsx',
    export: '<inline>',
  },
  renderer: {
    module: 'src/components/ui/error-banner.tsx',
    export: 'ErrorBanner',
  },
  notes:
    'Component-driven, not data-driven. Listed for completeness so a future runtime that wants to surface a structured error has a documented end-state.',
  relatedCapabilities: [],
};

export const ARTIFACT_CONTRACTS: readonly ArtifactContract[] = [
  widget,
  malformedWidget,
  media,
  fileDiffSummary,
  inlineDiff,
  inlineJsx,
  markdown,
  html,
  json,
  table,
  errorBlock,
];

// ─────────────────────────────────────────────────────────────────────
// Accessors
// ─────────────────────────────────────────────────────────────────────

export function getArtifact(id: string): ArtifactContract | undefined {
  return ARTIFACT_CONTRACTS.find((a) => a.id === id);
}

export function artifactsBySource(
  source: ArtifactSourceKind,
): readonly ArtifactContract[] {
  return ARTIFACT_CONTRACTS.filter((a) => a.source === source);
}

export function artifactsForCapability(
  capabilityId: string,
): readonly ArtifactContract[] {
  return ARTIFACT_CONTRACTS.filter((a) =>
    a.relatedCapabilities.includes(capabilityId),
  );
}
