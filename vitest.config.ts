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
    include: ["src/codex/**/*.test.ts", "src/codex-web/**/*.test.ts", "src/lib/**/*.test.ts", "server/**/*.test.ts"],
    exclude: ["src/__tests__/**", "node_modules/**", ".next/**", "dist/**"],
  },
});
