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
      "src/**/tests/**/*.test.ts",
      "src/**/tests/**/*.test.tsx",
      "server/tests/**/*.test.ts",
      "scripts/tests/**/*.test.ts",
    ],
    exclude: ["src/__tests__/**", "node_modules/**", ".next/**", "dist/**"],
  },
});
