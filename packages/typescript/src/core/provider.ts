import type { BaseWallet } from "./base.js";
import { WalletNotFoundError } from "./errors.js";
import { SecureKVStore } from "../secret/kv-store.js";
import { EvmWallet } from "./adapters/evm.js";
import { TronWallet } from "./adapters/tron.js";
import {
  loadConfig,
  type WalletConfig,
  type WalletInfo,
  type WalletsTopology,
} from "../storage/config.js";

export abstract class WalletProvider {
  abstract listWallets(): Promise<WalletInfo[]>;
  abstract getWallet(walletId: string): Promise<BaseWallet>;
}

export class LocalWalletProvider extends WalletProvider {
  private config: WalletsTopology;
  private wallets: Map<string, BaseWallet> = new Map();

  constructor(secretsDir: string, password: string) {
    super();
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
      chain_id: conf.chain_id,
    }));
  }

  async getWallet(walletId: string): Promise<BaseWallet> {
    const wallet = this.wallets.get(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(`Wallet '${walletId}' not found`);
    }
    return wallet;
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
      return new EvmWallet(privateKey, conf.chain_id);
    }
    case "tron_local": {
      const privateKey = kvStore.loadPrivateKey(conf.identity_file!);
      let apiKey: string | undefined;
      if (conf.cred_file) {
        apiKey = kvStore.loadCredential(conf.cred_file) as string;
      }
      return new TronWallet(privateKey, apiKey, conf.chain_id);
    }
    default:
      throw new Error(`Unknown wallet type: ${conf.type}`);
  }
}
