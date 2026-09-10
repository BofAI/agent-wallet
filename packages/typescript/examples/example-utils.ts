import type { Eip712Capable, Wallet } from '../src/index.js'

export interface EnvWalletSource {
  mode: 'privateKey' | 'mnemonic'
  accountIndex?: number
}

export function configureEnvWalletSource(): EnvWalletSource {
  const privateKey = process.env.PRIVATE_KEY?.trim()
  const mnemonic = process.env.MNEMONIC?.trim()

  if (privateKey && mnemonic) {
    throw new Error('Set only one of PRIVATE_KEY or MNEMONIC.')
  }
  if (privateKey) {
    process.env.AGENT_WALLET_PRIVATE_KEY = privateKey
    return { mode: 'privateKey' }
  }
  if (mnemonic) {
    const accountIndex = Number(process.env.MNEMONIC_ACCOUNT_INDEX?.trim() ?? '0')
    if (!Number.isInteger(accountIndex) || accountIndex < 0) {
      throw new Error('MNEMONIC_ACCOUNT_INDEX must be a non-negative integer.')
    }
    process.env.AGENT_WALLET_MNEMONIC = mnemonic
    process.env.AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX = String(accountIndex)
    return { mode: 'mnemonic', accountIndex }
  }
  throw new Error('Set PRIVATE_KEY or MNEMONIC before running this example.')
}

export function requireEip712Wallet(wallet: Wallet): Wallet & Eip712Capable {
  if (!('signTypedData' in wallet) || typeof wallet.signTypedData !== 'function') {
    throw new Error('The selected wallet does not support EIP-712 typed-data signing.')
  }
  return wallet as Wallet & Eip712Capable
}

export function reportExampleError(error: unknown): void {
  console.error(error)
  process.exitCode = 1
}
