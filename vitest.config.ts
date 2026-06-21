import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.mjs", "tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90
      },
      // Docker-backed proof scripts are verified by explicit npm proof commands, not unit coverage.
      include: [
        "scripts/verify-docs.mjs",
        "packages/agent-adapters/src/**/*.mjs",
        "packages/installer/src/**/*.mjs",
        "apps/web/app/audit/**/*.ts",
        "apps/web/app/approvals/**/*.ts",
        "apps/web/app/api/approvals/**/*.ts",
        "apps/web/app/api/relay/**/*.ts",
        "apps/web/app/policies/**/*.ts",
        "apps/web/app/routes/**/*.ts",
        "apps/web/app/sessions/**/*.ts"
      ]
    }
  }
});
