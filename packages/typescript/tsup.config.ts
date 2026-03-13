import { defineConfig } from "tsup";

export default defineConfig([
  // SDK: dual ESM + CJS
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
  },
  // CLI binary: ESM only
  {
    entry: { "delivery/bin": "src/delivery/bin.ts" },
    format: ["esm"],
    sourcemap: true,
  },
]);
