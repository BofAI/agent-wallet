import type { BaseWallet } from "./base.js";
import { WalletNotFoundError } from "./errors.js";
import { SecureKVStore } from "../secret/kv-store.js";
import { EvmWallet } from "./adapters/evm.js";
import { TronWallet } from "./adapters/tron.js";
import {
  loadConfig,
  saveConfig,
  type WalletConfig,
  type WalletInfo,
  type WalletsTopology,
} from "../storage/config.js";

export abstract class WalletProvider {
  abstract listWallets(): Promise<WalletInfo[]>;
  abstract getWallet(walletId: string): Promise<BaseWallet>;
}

export class LocalWalletProvider extends WalletProvider {
  private secretsDir: string;
  private config: WalletsTopology;
  private wallets: Map<string, BaseWallet> = new Map();

  constructor(secretsDir: string, password: string) {
    super();
    this.secretsDir = secretsDir;
    const kvStore = new SecureKVStore(secretsDir, password);
    kvStore.verifyPassword();
    this.config = loadConfig(secretsDir);
    for (const [wid, conf] of Object.entries(this.config.wallets)) {
      this.wallets.set(wid, createWallet(conf, kvStore));
    }
  }

  async listWallets(): Promise<WalletInfo[]> {
    return Object.entries(this.config.wallets).map(([wid, conf]) => ({
      id: wid,
      type: conf.type,
    }));
  }

  async getWallet(walletId: string): Promise<BaseWallet> {
    const wallet = this.wallets.get(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(`Wallet '${walletId}' not found`);
    }
    return wallet;
  }

  getActiveId(): string | null {
    return this.config.active_wallet ?? null;
  }

  async getActive(): Promise<BaseWallet> {
    const activeId = this.getActiveId();
    if (!activeId) {
      throw new WalletNotFoundError("No active wallet set. Use 'agent-wallet use <id>' to set one.");
    }
    return this.getWallet(activeId);
  }

  setActive(walletId: string): void {
    if (!this.wallets.has(walletId)) {
      throw new WalletNotFoundError(`Wallet '${walletId}' not found`);
    }
    this.config.active_wallet = walletId;
    saveConfig(this.secretsDir, this.config);
  }
}

export class RemoteWalletProvider extends WalletProvider {
  private remoteUrl: string;
  private token?: string;

  constructor(remoteUrl: string, token?: string) {
    super();
    this.remoteUrl = remoteUrl.replace(/\/+$/, "");
    this.token = token;
  }

  async listWallets(): Promise<WalletInfo[]> {
    throw new Error("Remote listWallets not yet implemented");
  }

  async getWallet(walletId: string): Promise<BaseWallet> {
    const { RemoteWallet } = await import("./adapters/remote.js");
    return new RemoteWallet(this.remoteUrl, walletId, this.token);
  }
}

export function WalletFactory(options: {
  secretsDir?: string;
  password?: string;
  remoteUrl?: string;
  token?: string;
}): WalletProvider {
  if (options.remoteUrl) {
    return new RemoteWalletProvider(options.remoteUrl, options.token);
  }
  if (options.secretsDir) {
    if (!options.password) {
      throw new ValueError("password is required for Local mode");
    }
    return new LocalWalletProvider(options.secretsDir, options.password);
  }
  throw new ValueError(
    "Either secretsDir+password or remoteUrl is required",
  );
}

/** @deprecated Use WalletFactory instead */
export const createProvider = WalletFactory;

class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

function createWallet(conf: WalletConfig, kvStore: SecureKVStore): BaseWallet {
  switch (conf.type) {
    case "evm_local": {
      const privateKey = kvStore.loadPrivateKey(conf.identity_file!);
      return new EvmWallet(privateKey);
    }
    case "tron_local": {
      const privateKey = kvStore.loadPrivateKey(conf.identity_file!);
      return new TronWallet(privateKey);
    }
    default:
      throw new Error(`Unknown wallet type: ${conf.type}`);
  }
}
