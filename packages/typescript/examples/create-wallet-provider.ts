/**
 * Demo: Resolve wallet providers using `resolveWalletProvider`.
 *
 * This example shows three resolution paths:
 *
 *   1. Raw private key env fallback
 *   2. Raw mnemonic env fallback
 *   3. Config-backed wallet mode
 *
 * Usage:
 *   PRIVATE_KEY=<hex> npx tsx examples/create-wallet-provider.ts
 *   MNEMONIC="word1 word2 ..." npx tsx examples/create-wallet-provider.ts
 *   MNEMONIC="word1 word2 ..." MNEMONIC_ACCOUNT_INDEX=1 npx tsx examples/create-wallet-provider.ts
 *   AGENT_WALLET_DIR=/path/to/config npx tsx examples/create-wallet-provider.ts
 */

import { resolveWalletProvider } from '../src/index.js'
import { configureEnvWalletSource, reportExampleError } from './example-utils.js'

async function main() {
  // --- Build providers via env/config resolution ---

  if (process.env.PRIVATE_KEY || process.env.MNEMONIC) {
    const source = configureEnvWalletSource()
    console.log(
      source.mode === 'privateKey'
        ? 'Mode: privateKey\n'
        : `Mode: mnemonic (accountIndex=${source.accountIndex})\n`,
    )

    const tronProvider = resolveWalletProvider({ network: 'tron:mainnet' })
    const evmProvider = resolveWalletProvider({ network: 'eip155:1' })

    await printWallet('TRON', tronProvider)
    await printWallet('EVM', evmProvider)
  } else {
    console.log('Mode: config-backed\n')
    const provider = resolveWalletProvider({
      network: 'eip155:1',
      dir: process.env.AGENT_WALLET_DIR,
    })

    await printWallet('Local', provider)
  }
}

async function printWallet(label: string, provider: ReturnType<typeof resolveWalletProvider>) {
  const wallet = await provider.getActiveWallet()
  const address = await wallet.getAddress()

  console.log(`=== ${label} ===`)
  console.log(`Address: ${address}`)
  console.log()
}

main().catch(reportExampleError)
