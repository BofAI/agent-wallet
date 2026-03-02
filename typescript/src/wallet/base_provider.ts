import type { AccountInfo, SignedTxResult } from './types';
import { Keystore, KeystoreBase, type KeystoreOptions } from '../keystore';
import { logger } from '../logger';

/**
 * Abstract base provider: compatible getAccountInfo/signTx/signMessage.
 * Subclasses (TronProvider, FlashProvider) implement chain-specific logic.
 *
 * Keystore initialization (file creation) is handled by CLI.
 * Providers read keystore data in the constructor.
 */
export abstract class BaseProvider {
  /** Keystore instance for reading/writing account credentials. */
  public keystore: KeystoreBase;

  constructor(keystore?: KeystoreBase | KeystoreOptions) {
    // Allow injecting a custom keystore implementation.
    if (
      keystore &&
      typeof (keystore as any).read === 'function' &&
      typeof (keystore as any).write === 'function'
    ) {
      this.keystore = keystore as KeystoreBase;
    } else {
      this.keystore = new Keystore(keystore as KeystoreOptions | undefined);
    }

    // Read keystore immediately. For the default file keystore this is effectively
    // synchronous (no awaits), so providers can access credentials in constructors.
    void this.keystore.read();
  }

  /**
   * Load credentials from keystore. Subclasses override to populate
   * chain-specific fields (privateKey, etc.) from keystore data.
   * Must be called after construction (constructors cannot be async).
   */
  async init(): Promise<this> {
    // Compatibility: kept for older call sites.
    // Re-reading is safe and supports custom keystore implementations.
    logger.debug({ keystorePath: this.keystore.getPath() }, 'provider init: reading keystore');
    await this.keystore.read();
    return this;
  }

  /** Get account info; must include wallet address. */
  abstract getAccountInfo(): Promise<AccountInfo>;

  /** Sign an arbitrary message (bytes) and return signature string. */
  abstract signMessage(message: Uint8Array): Promise<string>;

  /**
   * Sign an unsigned transaction and return the signed result.
   * @param unsignedTx - Chain-specific unsigned payload
   */
  abstract signTx(unsignedTx: unknown): Promise<SignedTxResult>;
}

