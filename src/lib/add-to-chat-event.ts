/**
 * `codepilot:add-to-chat` window event channel — Phase 4 Markdown data layer.
 *
 * Selection-to-chat affordance: when the user selects text in a
 * Markdown preview and clicks "Add to chat", the preview surface
 * dispatches this event with the selected text plus source metadata
 * (file path + estimated line range + heading). ChatView listens and
 * prefills the composer with a quote chip carrying that metadata, so
 * the AI sees both the quote and the provenance.
 *
 * Why a window event vs a React context: the producer (PreviewPanel)
 * and the consumer (ChatView) are siblings under AppShell rather than
 * a parent/child relationship. A context would force one to live
 * above the other or force a hoisted state. The event channel keeps
 * the two surfaces decoupled and trivially testable.
 */

export const ADD_TO_CHAT_EVENT = "codepilot:add-to-chat";

export interface AddToChatDetail {
  /** The text the user selected, verbatim — including formatting. */
  text: string;
  /** Absolute path to the source file. */
  sourcePath: string;
  /** Optional anchor in the standardized form parsed by
   *  `parseAnchor()`: `#L12`, `:12`, `:12:5`, or `#heading-slug`. */
  sourceAnchor?: string;
  /** Optional human label — typically the closest heading text — that
   *  the chip can display alongside the path basename. */
  sourceLabel?: string;
}

export function dispatchAddToChat(detail: AddToChatDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AddToChatDetail>(ADD_TO_CHAT_EVENT, { detail }));
}

export function isAddToChatDetail(value: unknown): value is AddToChatDetail {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<AddToChatDetail>;
  if (typeof v.text !== "string") return false;
  if (typeof v.sourcePath !== "string") return false;
  return true;
}
