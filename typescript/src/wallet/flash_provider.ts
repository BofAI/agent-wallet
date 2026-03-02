import { TronProvider } from './tron_provider';
import { TronWeb } from 'tronweb';

export class FlashProvider extends TronProvider {
  protected flashTronWeb: any;
  protected privyAppId: string;
  protected privyAppSecret: string;
  protected walletId: string;

  /**
   * Initialize FlashProvider
   * @param fullNode Standard full node URL
   * @param flashNode High-speed/Private node URL for flash transactions
   * @param privateKey Private key (optional if using Privy)
   * @param apiKey TronGrid API Key (optional)
   * @param privyAppId Privy App ID (optional, defaults to env)
   * @param privyAppSecret Privy App Secret (optional, defaults to env)
   * @param walletId Privy Wallet ID / Address (optional, defaults to env)
   */
  constructor(
    fullNode: string = process.env.TRON_RPC_URL || 'https://api.trongrid.io',
    flashNode: string = process.env.TRON_FLASH_RPC_URL || fullNode,
    privateKey: string = process.env.TRON_PRIVATE_KEY || '',
    apiKey: string = process.env.TRON_GRID_API_KEY || '',
    privyAppId: string = process.env.PRIVY_APP_ID || '',
    privyAppSecret: string = process.env.PRIVY_APP_SECRET || '',
    walletId: string = process.env.PRIVY_WALLET_ID || ''
  ) {
    super(fullNode, fullNode, fullNode, privateKey, apiKey);

    this.privyAppId = privyAppId;
    this.privyAppSecret = privyAppSecret;
    this.walletId = walletId;

    // If walletId provided, use it as address
    if (this.walletId) {
      this.address = this.walletId;
    }

    if (flashNode !== fullNode) {
      const options: any = {
        fullHost: flashNode,
        privateKey: privateKey || undefined
      };
      if (apiKey) {
        options.headers = { "TRON-PRO-API-KEY": apiKey };
      }
      this.flashTronWeb = new TronWeb(options);
    } else {
      this.flashTronWeb = this.tronWeb;
    }
  }

  /**
   * Sign transaction using Privy API
   * @param transaction Transaction object
   */
  async sign(transaction: any): Promise<any> {
    if (!this.privyAppId || !this.privyAppSecret || !this.walletId) {
      return super.sign(transaction);
    }

    const txID = transaction.txID;

    // Prepare Privy API call
    const url = `https://auth.privy.io/api/v1/wallets/${this.walletId}/sign`;
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
      throw new Error(`Privy signing failed: ${response.statusText}`);
    }

    const data = await response.json();
    const signature = data.signature;

    // Add signature to transaction
    if (signature) {
      // TronWeb transaction structure usually has signature array
      if (!transaction.signature) {
        transaction.signature = [];
      }
      transaction.signature.push(signature);
    }

    return transaction;
  }

  /**
   * Send a flash transaction with higher fee limit or via private node
   * @param toAddress Recipient
   * @param amount Amount in SUN
   * @param priorityFee Additional fee limit in SUN
   */
  async sendTransaction(toAddress: string, amount: number, priorityFee: number = 1000): Promise<any> {
    // Use flashTronWeb for broadcasting
    try {
      // Build transaction
      const tradeobj = await this.flashTronWeb.transactionBuilder.sendTrx(
        toAddress,
        amount,
        this.address
      );

      // Sign with Privy
      const signedtxn = await this.sign(tradeobj);

      // Broadcast
      const receipt = await this.flashTronWeb.trx.sendRawTransaction(signedtxn);
      return receipt;
    } catch (error) {
      console.warn("Flash transaction failed", error);
      throw error;
    }
  }
}
