import { homedir } from "node:os";
import { join } from "node:path";

import { mnemonicToAccount } from "viem/accounts";

import type { BaseWallet } from "../base.js";
import { EvmWallet } from "../adapters/evm.js";
import { TronWallet } from "../adapters/tron.js";
import { LocalWalletProvider } from "./local.js";
import { WalletProvider } from "./base.js";
import { StaticWalletProvider } from "./static.js";

function expandTilde(p: string): string {
  if (p === "~" || p.startsWith("~/")) return join(homedir(), p.slice(1));
  return p;
}

const DEFAULT_SECRETS_DIR = join(homedir(), ".agent-wallet");
const ENV_AGENT_WALLET_PASSWORD = "AGENT_WALLET_PASSWORD";
const ENV_AGENT_WALLET_DIR = "AGENT_WALLET_DIR";
const ENV_AGENT_WALLET_PRIVATE_KEY = "AGENT_WALLET_PRIVATE_KEY";
const ENV_AGENT_WALLET_MNEMONIC = "AGENT_WALLET_MNEMONIC";
const TRON_MNEMONIC_PATH = "m/44'/195'/0'/0/0" as const;

type NetworkFamily = "tron" | "eip155";

export interface ResolveWalletProviderOptions {
  network?: string;
}

export function resolveWalletProvider(options: ResolveWalletProviderOptions = {}): WalletProvider {
  return resolveWalletProviderFromEnv(process.env, options);
}

function resolveWalletProviderFromEnv(
  env: NodeJS.ProcessEnv,
  options: ResolveWalletProviderOptions = {},
): WalletProvider {
  const password = cleanEnvValue(env[ENV_AGENT_WALLET_PASSWORD]);
  if (password) {
    const secretsDir = cleanEnvValue(env[ENV_AGENT_WALLET_DIR]);
    return new LocalWalletProvider(expandTilde(secretsDir ?? DEFAULT_SECRETS_DIR), password);
  }

  return new StaticWalletProvider(createWalletFromEnv(env, options.network));
}
class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

function createWalletFromEnv(env: NodeJS.ProcessEnv, network: string | undefined): BaseWallet {
  const privateKey = cleanEnvValue(env[ENV_AGENT_WALLET_PRIVATE_KEY]);
  const mnemonic = cleanEnvValue(env[ENV_AGENT_WALLET_MNEMONIC]);

  assertSingleWalletSource({ privateKey, mnemonic });

  if (!privateKey && !mnemonic) {
    throw new ValueError(
      "resolveWalletProvider requires one of: AGENT_WALLET_PASSWORD, AGENT_WALLET_PRIVATE_KEY, or AGENT_WALLET_MNEMONIC",
    );
  }

  const family = parseNetworkFamily(network);

  if (privateKey) {
    return family === "tron"
      ? createTronWalletFromPrivateKey(privateKey)
      : createEvmWalletFromPrivateKey(privateKey);
  }

  return family === "tron"
    ? createTronWalletFromMnemonic(mnemonic!)
    : createEvmWalletFromMnemonic(mnemonic!);
}

function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function assertSingleWalletSource({
  privateKey,
  mnemonic,
}: {
  privateKey?: string;
  mnemonic?: string;
}): void {
  if (privateKey && mnemonic) {
    throw new ValueError(
      "Provide only one of AGENT_WALLET_PRIVATE_KEY or AGENT_WALLET_MNEMONIC",
    );
  }
}

function parseNetworkFamily(network: string | undefined): NetworkFamily {
  const normalized = cleanEnvValue(network)?.toLowerCase();
  if (!normalized) {
    throw new ValueError(
      "resolveWalletProvider requires options.network when using AGENT_WALLET_PRIVATE_KEY or AGENT_WALLET_MNEMONIC",
    );
  }
  if (normalized === "tron" || normalized.startsWith("tron:")) return "tron";
  if (normalized === "eip155" || normalized.startsWith("eip155:")) return "eip155";
  throw new ValueError("options.network must start with 'tron' or 'eip155'");
}

function createEvmWalletFromPrivateKey(privateKey: string): BaseWallet {
  return new EvmWallet(decodePrivateKey(privateKey));
}

function createEvmWalletFromMnemonic(mnemonic: string): BaseWallet {
  const account = mnemonicToAccount(mnemonic);
  const privateKey = account.getHdKey().privateKey;
  if (!privateKey)
    throw new ValueError(
      "Failed to derive private key from AGENT_WALLET_MNEMONIC for eip155",
    );
  return new EvmWallet(privateKey);
}

function createTronWalletFromPrivateKey(privateKey: string): BaseWallet {
  return new TronWallet(decodePrivateKey(privateKey));
}

function createTronWalletFromMnemonic(mnemonic: string): BaseWallet {
  const account = mnemonicToAccount(mnemonic, {
    path: TRON_MNEMONIC_PATH as unknown as `m/44'/60'/${string}`,
  });
  const privateKey = account.getHdKey().privateKey;
  if (!privateKey) {
    throw new ValueError(
      "Failed to derive private key from AGENT_WALLET_MNEMONIC for tron",
    );
  }
  return new TronWallet(privateKey);
}

function decodePrivateKey(privateKey: string): Uint8Array {
  const normalized = privateKey.trim().replace(/^0x/, "");
  if (normalized.length !== 64) {
    throw new ValueError("Private key must be 32 bytes (64 hex characters)");
  }
  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new ValueError("Private key must be a valid hex string");
  }
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}
