import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90
      },
      include: ["scripts/**/*.mjs"]
    }
  }
});

