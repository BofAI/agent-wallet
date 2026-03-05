import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CURRENT_CONFIG_VERSION,
  loadConfig,
  migrateConfig,
  saveConfig,
  type WalletsTopology,
} from "../src/storage/config.js";

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
      config_version: CURRENT_CONFIG_VERSION,
      wallets: {
        test: { type: "evm_local", identity_file: "id_test", chain_id: "eip155:1" },
      },
    };
    expect(config.wallets["test"].type).toBe("evm_local");
  });

  it("should accept valid tron config", () => {
    const config: WalletsTopology = {
      config_version: CURRENT_CONFIG_VERSION,
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
      saveConfig(secretsDir, data as unknown as WalletsTopology);
      loadConfig(secretsDir);
    }).toThrow();
  });
});

describe("loadConfig / saveConfig", () => {
  it("should roundtrip config", () => {
    const config: WalletsTopology = {
      config_version: CURRENT_CONFIG_VERSION,
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

  it("should stamp current version on save", () => {
    const config: WalletsTopology = {
      config_version: CURRENT_CONFIG_VERSION,
      wallets: {},
    };
    saveConfig(secretsDir, config);
    const raw = JSON.parse(
      readFileSync(join(secretsDir, "wallets_config.json"), "utf-8"),
    );
    expect(raw.config_version).toBe(CURRENT_CONFIG_VERSION);
  });
});

describe("migration", () => {
  it("should add config_version to v0 config", () => {
    const data: Record<string, unknown> = {
      wallets: { w1: { type: "evm_local" } },
    };
    const result = migrateConfig(data);
    expect(result.config_version).toBe(CURRENT_CONFIG_VERSION);
  });

  it("should preserve wallet entries during migration", () => {
    const data: Record<string, unknown> = {
      wallets: {
        eth: {
          type: "evm_local",
          address: "0xABC",
          identity_file: "eth",
          chain_id: "eip155:1",
        },
        tron: {
          type: "tron_local",
          identity_file: "tron",
          cred_file: "tron",
        },
      },
    };
    const result = migrateConfig(data);
    const wallets = result.wallets as Record<string, Record<string, string>>;
    expect(wallets["eth"]["address"]).toBe("0xABC");
    expect(wallets["tron"]["cred_file"]).toBe("tron");
  });

  it("should be a no-op for current version", () => {
    const data: Record<string, unknown> = {
      config_version: CURRENT_CONFIG_VERSION,
      wallets: {},
    };
    const result = migrateConfig(data);
    expect(result).toBe(data); // same reference
  });

  it("should throw for future version", () => {
    const data: Record<string, unknown> = {
      config_version: CURRENT_CONFIG_VERSION + 1,
      wallets: {},
    };
    expect(() => migrateConfig(data)).toThrow("newer than supported");
  });

  it("should auto-migrate v0 file on load", () => {
    const v0 = {
      wallets: {
        my_wallet: {
          type: "evm_local",
          address: "0x123",
          identity_file: "my_wallet",
        },
      },
    };
    writeFileSync(
      join(secretsDir, "wallets_config.json"),
      JSON.stringify(v0),
      "utf-8",
    );

    const loaded = loadConfig(secretsDir);
    expect(loaded.config_version).toBe(CURRENT_CONFIG_VERSION);
    expect(loaded.wallets["my_wallet"].address).toBe("0x123");

    // File on disk should be updated
    const raw = JSON.parse(
      readFileSync(join(secretsDir, "wallets_config.json"), "utf-8"),
    );
    expect(raw.config_version).toBe(CURRENT_CONFIG_VERSION);
  });

  it("should not rewrite file that is already current", () => {
    const config: WalletsTopology = {
      config_version: CURRENT_CONFIG_VERSION,
      wallets: {},
    };
    saveConfig(secretsDir, config);

    const path = join(secretsDir, "wallets_config.json");
    const contentBefore = readFileSync(path, "utf-8");

    loadConfig(secretsDir);
    const contentAfter = readFileSync(path, "utf-8");
    expect(contentBefore).toBe(contentAfter);
  });
});
