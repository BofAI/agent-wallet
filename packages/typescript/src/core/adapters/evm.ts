import { privateKeyToAccount } from "viem/accounts";
import { type Account, type Chain, type Transport } from "viem";
import type { BaseWallet, Eip712Capable } from "../base.js";
import { SigningError } from "../errors.js";

export class EvmWallet implements BaseWallet, Eip712Capable {
  private account: ReturnType<typeof privateKeyToAccount>;

  constructor(privateKey: Uint8Array) {
    const hex = `0x${Buffer.from(privateKey).toString("hex")}` as `0x${string}`;
    this.account = privateKeyToAccount(hex);
  }

  async getAddress(): Promise<string> {
    return this.account.address;
  }

  async signRaw(rawTx: Uint8Array): Promise<string> {
    try {
      const sig = await this.account.signTransaction(
        rawTx as unknown as Parameters<typeof this.account.signTransaction>[0],
      );
      return sig.slice(2);
    } catch (e) {
      throw new SigningError(`EVM sign_raw failed: ${e}`);
    }
  }

  async signTransaction(payload: Record<string, unknown>): Promise<string> {
    try {
      const sig = await this.account.signTransaction(
        payload as Parameters<typeof this.account.signTransaction>[0],
      );
      return sig.slice(2);
    } catch (e) {
      throw new SigningError(`EVM sign_transaction failed: ${e}`);
    }
  }

  async signMessage(msg: Uint8Array): Promise<string> {
    try {
      const sig = await this.account.signMessage({
        message: { raw: msg },
      });
      return sig.slice(2);
    } catch (e) {
      throw new SigningError(`EVM sign_message failed: ${e}`);
    }
  }

  async signTypedData(data: Record<string, unknown>): Promise<string> {
    try {
      const { domain, types, primaryType, message } = data as {
        domain: Record<string, unknown>;
        types: Record<string, Array<{ name: string; type: string }>>;
        primaryType: string;
        message: Record<string, unknown>;
      };

      // Remove EIP712Domain from types — viem adds it automatically
      const { EIP712Domain, ...messageTypes } = types;

      const sig = await this.account.signTypedData({
        domain: domain as any,
        types: messageTypes as any,
        primaryType,
        message: message as any,
      });
      return sig.slice(2);
    } catch (e) {
      throw new SigningError(`EVM sign_typed_data failed: ${e}`);
    }
  }
}
