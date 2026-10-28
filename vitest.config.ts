import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Mientras no existan tests, no fallar (se quitara en el Paso 6)
    passWithNoTests: true,
    clearMocks: true,
    restoreMocks: true,
  },
});
