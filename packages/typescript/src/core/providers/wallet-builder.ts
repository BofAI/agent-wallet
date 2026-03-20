/**
 * Shared wallet construction helpers for providers.
 */

import { type Wallet } from "../base.js";
import type { WalletConfig } from "../config.js";
import { WalletType } from "../base.js";
import { LocalSecureSigner } from "../adapters/local-secure.js";
import type { SecretLoaderFn } from "../adapters/local-secure.js";
import { RawSecretSigner } from "../adapters/raw-secret.js";
import type { RawSecretPrivateKeyParams, RawSecretMnemonicParams } from "../config.js";

export function createAdapter(
  conf: WalletConfig,
  configDir: string,
  password: string | undefined,
  network: string,
  secretLoader: SecretLoaderFn | undefined,
): Wallet {
  if (conf.type === WalletType.LOCAL_SECURE) {
    return new LocalSecureSigner(
      conf.params as { secret_ref: string },
      configDir,
      password,
      network,
      secretLoader,
    );
  }
  if (conf.type === WalletType.RAW_SECRET) {
    return new RawSecretSigner(
      conf.params as RawSecretPrivateKeyParams | RawSecretMnemonicParams,
      network,
    );
  }
  throw new Error(`Unknown wallet config type: ${conf.type}`);
}
