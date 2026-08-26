/**
 * Demo: Sign through a configured wallet_cli wallet.
 *
 * Prerequisites:
 *   agent-wallet add wallet_cli --wallet-id cli-wallet --account <account>
 *
 * Usage:
 *   AGENT_WALLET_DIR=~/.agent-wallet \
 *   WALLET_ID=cli-wallet \
 *   NETWORK=tron:nile \
 *   npx tsx examples/wallet-cli-sign.ts
 */

import {
  ConfigWalletProvider,
  resolveWalletProvider,
  type MessageSigningCapable,
} from '../src/index.js'
import { reportExampleError, requireEip712Wallet } from './example-utils.js'

const NETWORK = process.env.NETWORK ?? 'tron:nile'
const WALLET_ID = process.env.WALLET_ID

async function main() {
  const provider = resolveWalletProvider({
    network: NETWORK,
    dir: process.env.AGENT_WALLET_DIR,
  })
  if (!(provider instanceof ConfigWalletProvider)) {
    throw new Error('wallet-cli example requires a configured wallet_cli wallet')
  }

  const walletId = WALLET_ID ?? provider.getActiveId()
  if (!walletId) throw new Error('Set WALLET_ID or configure an active wallet')
  const config = provider.getWalletConfig(walletId)
  if (config.type !== 'wallet_cli') {
    throw new Error(`Wallet '${walletId}' is '${config.type}', expected 'wallet_cli'`)
  }

  const wallet = await provider.getWallet(walletId, NETWORK)
  console.log(`Address: ${await wallet.getAddress()}`)

  const typedSignature = await requireEip712Wallet(wallet).signTypedData({
    domain: { name: 'AgentWallet', version: '1', chainId: 1 },
    types: { Message: [{ name: 'contents', type: 'string' }] },
    primaryType: 'Message',
    message: { contents: 'signed by wallet-cli' },
  })
  console.log(`Typed-data signature: ${typedSignature}`)

  if (!('signMessage' in wallet)) {
    throw new Error('Configured wallet does not expose UTF-8 message signing')
  }
  const messageSignature = await (wallet as MessageSigningCapable).signMessage(
    new TextEncoder().encode('hello from agent-wallet'),
  )
  console.log(`Message signature: ${messageSignature}`)
}

main().catch(reportExampleError)
