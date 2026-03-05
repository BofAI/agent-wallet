import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, saveConfig, type WalletsTopology } from "../src/storage/config.js";

let secretsDir: string;

beforeEach(() => {
  secretsDir = mkdtempSync(join(tmpdir(), "agent-wallet-test-"));
});

afterEach(() => {
  rmSync(secretsDir, { recursive: true, force: true });
});

describe("WalletConfig", () => {
  it("should accept valid evm config", () => {
    const config: WalletsTopology = {
      wallets: {
        test: { type: "evm_local", identity_file: "id_test", chain_id: "eip155:1" },
      },
    };
    expect(config.wallets["test"].type).toBe("evm_local");
  });

  it("should accept valid tron config", () => {
    const config: WalletsTopology = {
      wallets: {
        test: {
          type: "tron_local",
          identity_file: "id_tron",
          cred_file: "cred_trongrid",
          chain_id: "tron:mainnet",
        },
      },
    };
    expect(config.wallets["test"].cred_file).toBe("cred_trongrid");
  });

  it("should reject invalid wallet type", () => {
    expect(() => {
      const data = { wallets: { bad: { type: "solana_local" } } };
      // Use loadConfig which validates via Zod
      saveConfig(secretsDir, data as unknown as WalletsTopology);
      loadConfig(secretsDir);
    }).toThrow();
  });
});

describe("loadConfig / saveConfig", () => {
  it("should roundtrip config", () => {
    const config: WalletsTopology = {
      wallets: {
        eth_deployer: {
          type: "evm_local",
          identity_file: "id_eth",
          chain_id: "eip155:1",
        },
        tron_manager: {
          type: "tron_local",
          identity_file: "id_tron",
          cred_file: "cred_trongrid",
          chain_id: "tron:mainnet",
        },
      },
    };

    saveConfig(secretsDir, config);
    const loaded = loadConfig(secretsDir);

    expect(Object.keys(loaded.wallets)).toHaveLength(2);
    expect(loaded.wallets["eth_deployer"].type).toBe("evm_local");
    expect(loaded.wallets["tron_manager"].type).toBe("tron_local");
    expect(loaded.wallets["tron_manager"].cred_file).toBe("cred_trongrid");
  });

  it("should throw on missing file", () => {
    expect(() => loadConfig(secretsDir)).toThrow();
  });

  it("should throw on invalid json", () => {
    writeFileSync(join(secretsDir, "wallets_config.json"), "not json", "utf-8");
    expect(() => loadConfig(secretsDir)).toThrow();
  });
});
