import type { BaseWallet } from '../base.js'
import { WalletProvider } from './base.js'

export class StaticWalletProvider extends WalletProvider {
  constructor(private readonly wallet: BaseWallet) {
    super()
  }

  async getActiveWallet(): Promise<BaseWallet> {
    return this.wallet
  }
}
