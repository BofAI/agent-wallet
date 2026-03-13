import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 70,
        functions: 80,
        branches: 70,
        statements: 70,
      },
      exclude: [
        "dist/**",
        "examples/**",
        "tests/**",
        "src/delivery/bin.ts",
        "src/index.ts",
      ],
    },
  },
});
