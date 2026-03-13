import type { BaseWallet } from '../base.js'

export abstract class WalletProvider {
  abstract getActiveWallet(): Promise<BaseWallet>
}
