import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/codex/**/*.test.ts", "src/codex-web/**/*.test.ts", "server/**/*.test.ts"],
    exclude: ["src/__tests__/**", "node_modules/**", ".next/**", "dist/**"],
  },
});
