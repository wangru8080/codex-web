import type { InitializeCapabilities } from "@/codex/protocol/generated/InitializeCapabilities";

export function appServerInitializeCapabilities(): InitializeCapabilities {
  return {
    experimentalApi: true,
    requestAttestation: false,
    mcpServerOpenaiFormElicitation: false,
  };
}
