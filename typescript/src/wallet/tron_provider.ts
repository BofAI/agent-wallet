import { TronWeb } from "tronweb";
import * as dotenv from "dotenv";
import { BaseProvider } from "./base_provider";
import type { AccountInfo, SignedTxResult } from "./types";
import type { KeystoreOptions, KeystoreBase } from "../keystore";

dotenv.config();

const DEFAULT_TRON_RPC_URL = "https://api.trongrid.io";

export interface TronProviderOptions {
  privateKey?: string;
  /** Keystore options or a custom keystore implementation. */
  keystore?: KeystoreOptions | KeystoreBase;
}

export class TronProvider extends BaseProvider {
  protected tronWeb: any;
  protected address: string | null = null;
  private _privateKey: string;
  private _fullNode: string;
  private _solidityNode: string;
  private _eventServer: string;

  /**
   * Initialize TronProvider.
   * After construction, call `init()` to load credentials from keystore.
   * Or use `TronProvider.create(opts)` for one-step setup.
   */
  constructor(opts: TronProviderOptions = {}) {
    super(opts.keystore);

    // RPC URL is fixed for TronProvider (not configurable).
    this._fullNode = DEFAULT_TRON_RPC_URL;
    this._solidityNode = DEFAULT_TRON_RPC_URL;
    this._eventServer = DEFAULT_TRON_RPC_URL;
    // privateKey comes from keystore (or explicit opts), not from env.
    this._privateKey = opts.privateKey || "";

    // Load missing credentials from keystore in constructor (best-effort).
    // Works synchronously for the default file-based keystore.
    if (typeof (this.keystore as any).getSync === "function") {
      const ksPrivateKey = (this.keystore as any).getSync("privateKey") as
        | string
        | undefined;

      if (!this._privateKey && ksPrivateKey) this._privateKey = ksPrivateKey;
    }

    this._buildTronWeb();
  }

  /** Build / rebuild TronWeb instance from current credentials. */
  private _buildTronWeb(): void {
    const options: any = {
      fullHost: this._fullNode,
      solidityNode: this._solidityNode,
      eventServer: this._eventServer,
      privateKey: this._privateKey || undefined,
    };

    this.tronWeb = new TronWeb(options);

    if (this._privateKey) {
      this.address = this.tronWeb.address.fromPrivateKey(this._privateKey);
    }
  }

  /**
   * Compatibility no-op.
   */
  async init(): Promise<this> {
    // Compatibility: constructor already loads credentials from keystore when possible.
    // Still read again to support custom keystore implementations.
    await super.init();
    return this;
  }

  /**
   * Factory: create and init a TronProvider in one step.
   */
  static async create(opts: TronProviderOptions = {}): Promise<TronProvider> {
    const provider = new TronProvider(opts);
    await provider.init();
    return provider;
  }

  async getAccountInfo(): Promise<AccountInfo> {
    if (!this.address)
      throw new Error("Address not available (no private key or wallet id)");
    return { address: this.address };
  }

  async signTx(unsignedTx: unknown): Promise<SignedTxResult> {
    const signed = await this.sign(unsignedTx as any);
    const sig = (signed as any)?.signature?.[0];
    return {
      signedTx: signed,
      signature: typeof sig === "string" ? sig : undefined,
    };
  }

  async signMessage(message: Uint8Array): Promise<string> {
    if (!this._privateKey) throw new Error("Private key not provided for signing");

    // tronweb's signMessageV2 accepts string | Uint8Array | number[]
    const fn =
      (this.tronWeb?.trx as any)?.signMessageV2 ??
      (this.tronWeb?.trx as any)?.signMessage;

    if (typeof fn !== "function") {
      throw new Error(
        "TronWeb does not support message signing (missing trx.signMessageV2/signMessage)",
      );
    }

    const sig = await Promise.resolve(fn.call(this.tronWeb.trx, message, this._privateKey));
    if (typeof sig !== "string" || !sig) {
      throw new Error("Message signing failed: empty signature");
    }
    return sig;
  }

  async getBalance(address?: string): Promise<number> {
    const addr = address || this.address;
    if (!addr) throw new Error("Address not provided");
    return await this.tronWeb.trx.getBalance(addr);
  }

  async getTrc20Balance(
    walletAddress: string,
    contractAddress: string,
  ): Promise<string> {
    const contract = await this.tronWeb.contract().at(contractAddress);
    const balance = await contract.balanceOf(walletAddress).call();
    return balance.toString();
  }

  async sendTransaction(toAddress: string, amount: number): Promise<any> {
    if (!this.address) throw new Error("Private key not provided for signing");
    const tradeobj = await this.tronWeb.transactionBuilder.sendTrx(
      toAddress,
      amount,
      this.address,
    );
    const signedtxn = await this.sign(tradeobj);
    const receipt = await this.tronWeb.trx.sendRawTransaction(signedtxn);
    return receipt;
  }

  async sign(transaction: any): Promise<any> {
    if (!this.address) throw new Error("Private key not provided for signing");
    return await this.tronWeb.trx.sign(transaction);
  }

  async broadcast(signedTransaction: any): Promise<any> {
    return await this.tronWeb.trx.sendRawTransaction(signedTransaction);
  }
}
