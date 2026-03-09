import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SecureKVStore } from "../src/local/kv-store.js";
import { saveConfig } from "../src/local/config.js";
import type { WalletsTopology } from "../src/local/config.js";
import {
  WalletProvider,
  LocalWalletProvider,
  RemoteWalletProvider,
  WalletFactory,
} from "../src/core/provider.js";
import { WalletNotFoundError, DecryptionError } from "../src/core/errors.js";
import { RemoteWallet } from "../src/core/adapters/remote.js";

let secretsDir: string;
let password: string;

function setupEvmSecrets(): void {
  secretsDir = mkdtempSync(join(tmpdir(), "agent-wallet-registry-test-"));
  password = "test-registry-pw";
  const kv = new SecureKVStore(secretsDir, password);
  kv.initMaster();
  const key = randomBytes(32);
  kv.savePrivateKey("id_eth_test", key);

  const config: WalletsTopology = {
    wallets: {
      eth_test: {
        type: "evm_local",
        identity_file: "id_eth_test",
      },
    },
  };
  saveConfig(secretsDir, config);
}

afterEach(() => {
  if (secretsDir) {
    rmSync(secretsDir, { recursive: true, force: true });
  }
});

// --- LocalWalletProvider ---

describe("LocalWalletProvider", () => {
  beforeEach(() => setupEvmSecrets());

  it("should init and list wallets", async () => {
    const provider = new LocalWalletProvider(secretsDir, password);
    expect(provider).toBeInstanceOf(WalletProvider);
    const wallets = await provider.listWallets();
    expect(wallets.length).toBe(1);
    expect(wallets[0].id).toBe("eth_test");
    expect(wallets[0].type).toBe("evm_local");
  });

  it("should get wallet", async () => {
    const provider = new LocalWalletProvider(secretsDir, password);
    const wallet = await provider.getWallet("eth_test");
    expect(wallet).not.toBeNull();
  });

  it("should throw on wallet not found", async () => {
    const provider = new LocalWalletProvider(secretsDir, password);
    await expect(provider.getWallet("nonexistent")).rejects.toThrow(
      WalletNotFoundError,
    );
  });

  it("should throw on wrong password", () => {
    expect(() => new LocalWalletProvider(secretsDir, "wrong-password")).toThrow(
      DecryptionError,
    );
  });
});

// --- RemoteWalletProvider ---

describe("RemoteWalletProvider", () => {
  it("should init", () => {
    const provider = new RemoteWalletProvider("http://localhost:8080");
    expect(provider).toBeInstanceOf(WalletProvider);
  });

  it("should return remote wallet", async () => {
    const provider = new RemoteWalletProvider(
      "http://localhost:8080",
      "test-token",
    );
    const wallet = await provider.getWallet("my_wallet");
    expect(wallet).toBeInstanceOf(RemoteWallet);
  });

  it("should throw on list wallets (not implemented)", async () => {
    const provider = new RemoteWalletProvider("http://localhost:8080");
    await expect(provider.listWallets()).rejects.toThrow();
  });
});

// --- WalletFactory ---

describe("WalletFactory", () => {
  beforeEach(() => setupEvmSecrets());

  it("should create local provider", () => {
    const provider = WalletFactory({
      secretsDir,
      password,
    });
    expect(provider).toBeInstanceOf(LocalWalletProvider);
  });

  it("should create remote provider", () => {
    const provider = WalletFactory({
      remoteUrl: "http://localhost:8080",
    });
    expect(provider).toBeInstanceOf(RemoteWalletProvider);
  });

  it("should throw on missing args", () => {
    expect(() => WalletFactory({})).toThrow(/Either/);
  });

  it("should throw on missing password", () => {
    expect(() => WalletFactory({ secretsDir: "/tmp/fake" })).toThrow(
      /password/,
    );
  });
});

// --- End-to-end ---

describe("End-to-end", () => {
  beforeEach(() => setupEvmSecrets());

  it("should sign message via provider", async () => {
    const provider = new LocalWalletProvider(secretsDir, password);
    const wallet = await provider.getWallet("eth_test");
    const addr = await wallet.getAddress();
    expect(addr.startsWith("0x")).toBe(true);
    const sig = await wallet.signMessage(Buffer.from("hello from provider"));
    expect(sig.length).toBeGreaterThan(0);
  });
});
