import type { BaseWallet } from "../base.js";
import { NetworkError, SigningError } from "../errors.js";

export class RemoteWallet implements BaseWallet {
  private baseUrl: string;
  private walletId: string;
  private token?: string;

  constructor(remoteUrl: string, walletId = "", token?: string) {
    this.baseUrl = remoteUrl.replace(/\/+$/, "");
    this.walletId = walletId;
    this.token = token;
  }

  async getAddress(): Promise<string> {
    throw new Error("RemoteWallet not yet implemented");
  }

  async signRaw(rawTx: Uint8Array): Promise<string> {
    throw new Error("RemoteWallet not yet implemented");
  }

  async signTransaction(payload: Record<string, unknown>): Promise<string> {
    throw new Error("RemoteWallet not yet implemented");
  }

  async signMessage(msg: Uint8Array): Promise<string> {
    throw new Error("RemoteWallet not yet implemented");
  }
}
