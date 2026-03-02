import { TronProvider, type TronProviderOptions } from './tron_provider';
import { TronWeb } from 'tronweb';

export interface FlashProviderOptions extends TronProviderOptions {
  flashNode?: string;
  /** Optional full node override for FlashProvider only */
  fullNode?: string;
  privyAppId?: string;
  privyAppSecret?: string;
  walletId?: string;
}

export class FlashProvider extends TronProvider {
  protected flashTronWeb: any;
  protected privyAppId: string;
  protected privyAppSecret: string;
  protected walletId: string;

  constructor(opts: FlashProviderOptions = {}) {
    super(opts);

    // privyAppId/privyAppSecret/walletId come from keystore (or explicit opts), not from env.
    this.privyAppId = opts.privyAppId || '';
    this.privyAppSecret = opts.privyAppSecret || '';
    this.walletId = opts.walletId || '';

    // Load missing Privy credentials from keystore in constructor (best-effort).
    if (typeof (this.keystore as any).getSync === 'function') {
      const ksPrivyAppId = (this.keystore as any).getSync('privyAppId') as string | undefined;
      const ksPrivyAppSecret = (this.keystore as any).getSync('privyAppSecret') as string | undefined;
      const ksWalletId = (this.keystore as any).getSync('walletId') as string | undefined;
      if (!this.privyAppId && ksPrivyAppId) this.privyAppId = ksPrivyAppId;
      if (!this.privyAppSecret && ksPrivyAppSecret) this.privyAppSecret = ksPrivyAppSecret;
      if (!this.walletId && ksWalletId) this.walletId = ksWalletId;
    }

    if (this.walletId) {
      this.address = this.walletId;
    }

    const flashNode = opts.flashNode || process.env.TRON_FLASH_RPC_URL || opts.fullNode || 'https://api.trongrid.io';
    const fullNode = opts.fullNode || 'https://api.trongrid.io';

    if (flashNode !== fullNode) {
      const ksPrivateKey =
        typeof (this.keystore as any).getSync === 'function'
          ? ((this.keystore as any).getSync('privateKey') as string | undefined)
          : undefined;
      const tronOpts: any = {
        fullHost: flashNode,
        privateKey: opts.privateKey || ksPrivateKey || undefined,
      };
      this.flashTronWeb = new TronWeb(tronOpts);
    } else {
      this.flashTronWeb = this.tronWeb;
    }
  }

  /**
   * Load additional Privy credentials from keystore.
   * Keystore keys: privyAppId, privyAppSecret, walletId
   */
  async init(): Promise<this> {
    // Compatibility: constructor already loads credentials from keystore when possible.
    // Still read again to support custom keystore implementations.
    await super.init();
    return this;
  }

  /**
   * Factory: create and init a FlashProvider in one step.
   */
  static async create(opts: FlashProviderOptions = {}): Promise<FlashProvider> {
    const provider = new FlashProvider(opts);
    await provider.init();
    return provider;
  }

  override async signMessage(message: Uint8Array): Promise<string> {
    // If Privy not configured, fall back to local signing (TronProvider)
    if (!this.privyAppId || !this.privyAppSecret || !this.walletId) {
      return super.signMessage(message);
    }

    const msgHex = Buffer.from(message).toString("hex");
    const url = `https://auth.privy.io/api/v1/wallets/${encodeURIComponent(this.walletId)}/sign`;
    const auth = btoa(`${this.privyAppId}:${this.privyAppSecret}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        "privy-app-id": this.privyAppId,
      },
      body: JSON.stringify({
        method: "raw_sign",
        params: {
          message: msgHex,
          encoding: "hex",
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(
        `Privy signing failed (${response.status}): ${errBody || response.statusText}`,
      );
    }

    const data = await response.json();
    const signature = data.signature;
    if (!signature) {
      throw new Error("Privy signing response did not contain a signature");
    }
    return signature;
  }

  async sign(transaction: any): Promise<any> {
    if (!this.privyAppId || !this.privyAppSecret || !this.walletId) {
      return super.sign(transaction);
    }

    const txID = transaction.txID;

    const url = `https://auth.privy.io/api/v1/wallets/${encodeURIComponent(this.walletId)}/sign`;
    const auth = btoa(`${this.privyAppId}:${this.privyAppSecret}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'privy-app-id': this.privyAppId
      },
      body: JSON.stringify({
        method: 'raw_sign',
        params: {
          message: txID,
          encoding: 'hex'
        }
      })
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Privy signing failed (${response.status}): ${errBody || response.statusText}`);
    }

    const data = await response.json();
    const signature = data.signature;

    if (!signature) {
      throw new Error('Privy signing response did not contain a signature');
    }

    const signedTx = JSON.parse(JSON.stringify(transaction));
    if (!signedTx.signature) {
      signedTx.signature = [];
    }
    signedTx.signature.push(signature);

    return signedTx;
  }

  async sendTransaction(toAddress: string, amount: number): Promise<any> {
    if (!this.address) throw new Error("Address not available for signing");
    try {
      const tradeobj = await this.flashTronWeb.transactionBuilder.sendTrx(toAddress, amount, this.address);
      const signedtxn = await this.sign(tradeobj);
      const receipt = await this.flashTronWeb.trx.sendRawTransaction(signedtxn);
      return receipt;
    } catch (error) {
      console.warn("Flash transaction failed", error);
      throw error;
    }
  }
}
