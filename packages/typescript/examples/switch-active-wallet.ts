/**
 * Demo: Switch active wallet via the agent-wallet SDK.
 *
 * This example shows how to use the active wallet feature programmatically:
 *   1. Resolve a ConfigWalletProvider
 *   2. List all wallets and show which one is active
 *   3. Switch the active wallet
 *   4. Sign a message using the active wallet (no wallet ID needed)
 *
 * Prerequisites:
 *   - agent-wallet start raw_secret
 *   - agent-wallet add raw_secret  (add at least two wallets)
 *
 * Usage:
 *   AGENT_WALLET_DIR=/path/to/config npx tsx examples/switch-active-wallet.ts
 */

import { ConfigWalletProvider, resolveWalletProvider } from '../src/index.js'
import { reportExampleError, requireEip712Wallet } from './example-utils.js'

// --- Configuration ---

const SECRETS_DIR = process.env.AGENT_WALLET_DIR ?? `${process.env.HOME}/.agent-wallet`
const NETWORK = process.env.AGENT_WALLET_NETWORK ?? 'eip155:1'

const MESSAGE_TYPED_DATA = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
    ],
    Message: [{ name: 'contents', type: 'string' }],
  },
  primaryType: 'Message',
  domain: { name: 'AgentWallet', version: '1', chainId: 1 },
  message: { contents: 'hello' },
}

async function main() {
  // ----------------------------------------------------------------
  // Step 1: Create provider (decrypts all keys, then discards password)
  // ----------------------------------------------------------------
  const provider = resolveWalletProvider({ dir: SECRETS_DIR, network: NETWORK })
  if (!(provider instanceof ConfigWalletProvider)) {
    throw new Error('switch-active-wallet.ts requires a config-backed wallet directory.')
  }

  // ----------------------------------------------------------------
  // Step 2: List wallets and show current active wallet
  // ----------------------------------------------------------------
  const wallets = await provider.listWallets()
  const activeId = provider.getActiveId()

  console.log('Available wallets:')
  for (const [walletId, conf, isActive] of wallets) {
    const marker = isActive ? ' *' : ''
    console.log(`  - ${walletId} (${conf.type})${marker}`)
  }
  console.log(`\nActive wallet: ${activeId ?? '(none)'}`)
  console.log()

  // ----------------------------------------------------------------
  // Step 3: Sign a message using the active wallet (no ID needed)
  // ----------------------------------------------------------------
  if (activeId) {
    const wallet = requireEip712Wallet(await provider.getActiveWallet())
    const address = await wallet.getAddress()
    const sig = await wallet.signTypedData(MESSAGE_TYPED_DATA)
    console.log(`Signed with active wallet '${activeId}':`)
    console.log(`  Address:   ${address}`)
    console.log(`  Signature: ${sig}`)
    console.log()
  }

  // ----------------------------------------------------------------
  // Step 4: Switch active wallet
  // ----------------------------------------------------------------
  if (wallets.length < 2) {
    console.log('Add at least 2 wallets to demo switching.')
    return
  }

  // Pick a wallet that is NOT the current active one
  const newActive = wallets.find(([walletId]) => walletId !== activeId)![0]
  provider.setActive(newActive)
  console.log(`Switched active wallet to '${newActive}'`)
  console.log()

  // ----------------------------------------------------------------
  // Step 5: Sign again with the new active wallet
  // ----------------------------------------------------------------
  const wallet = requireEip712Wallet(await provider.getActiveWallet())
  const address = await wallet.getAddress()
  const sig = await wallet.signTypedData(MESSAGE_TYPED_DATA)
  console.log(`Signed with new active wallet '${newActive}':`)
  console.log(`  Address:   ${address}`)
  console.log(`  Signature: ${sig}`)
}

main().catch(reportExampleError)
