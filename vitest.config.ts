import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/codex/**/*.test.ts",
      "src/codex-web/**/*.test.ts",
      "src/lib/**/*.test.ts",
      "src/components/chat/ContextCompactionRow.test.tsx",
      "src/components/chat/message-list-virtualization.test.ts",
      "src/components/chat/streaming-process-groups.test.ts",
      "src/components/ui/semantic-icon.test.tsx",
      "src/hooks/useAnimationFrameValue.test.ts",
      "src/codex-web/new-chat-project-selector.test.tsx",
      "server/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    exclude: ["src/__tests__/**", "node_modules/**", ".next/**", "dist/**"],
  },
});
