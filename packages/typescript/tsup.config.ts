import { defineConfig } from "tsup";

export default defineConfig([
  // SDK: dual ESM + CJS
  {
    entry: {
      index: "src/index.ts",
      "integrations/wallet-cli": "src/integrations/wallet-cli/index.ts",
    },
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
