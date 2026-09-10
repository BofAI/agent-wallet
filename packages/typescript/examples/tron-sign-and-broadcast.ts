/**
 * Demo: Sign a TRON transaction and broadcast it using agent-wallet SDK.
 *
 * This example shows how mcp-server-tron (or any other integration) can use
 * the agent-wallet SDK to:
 *   1. Resolve a config-backed or env-backed wallet provider
 *   2. Get the active wallet
 *   3. Sign a message (pure local, no network)
 *   4. Build an unsigned tx via TronGrid, sign it with the SDK, and broadcast
 *
 * The SDK is signing-only. The caller is responsible for building transactions
 * (via TronGrid / TronWeb) and broadcasting them.
 *
 * Prerequisites:
 *   - Either configure a wallet via the CLI:
 *       agent-wallet start raw_secret --wallet-id wallet-b
 *       agent-wallet start raw_secret --wallet-id wallet-b --mnemonic "..."
 *   - Or provide env fallback:
 *       AGENT_WALLET_PRIVATE_KEY=<hex>
 *   - The wallet address must be activated (have received TRX at least once)
 *
 * Usage:
 *   AGENT_WALLET_PRIVATE_KEY=<hex> npx tsx examples/tron-sign-and-broadcast.ts
 */

import { resolveWalletProvider } from '../src/index.js'
import { reportExampleError, requireEip712Wallet } from './example-utils.js'

// Transfer parameters
const TO_ADDRESS = 'TUJ1C4ybdcueXbi8Wmrqscteux5eGvrCh6'
const AMOUNT_SUN = 1_000_000 // 1 TRX = 1,000,000 SUN

// TronGrid endpoints by network
const TRONGRID_URLS: Record<string, string> = {
  mainnet: 'https://api.trongrid.io',
  nile: 'https://nile.trongrid.io',
  shasta: 'https://api.shasta.trongrid.io',
}

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
  domain: { name: 'AgentWallet', version: '1', chainId: 728126428 },
  message: { contents: 'hello' },
}

async function main() {
  // ----------------------------------------------------------------
  // Step 1: Resolve provider and active wallet
  // ----------------------------------------------------------------
  const provider = resolveWalletProvider({ network: 'tron:3448148188', dir: '/tmp/test-wallet' })

  // ----------------------------------------------------------------
  // Step 2: Get wallet instance
  // ----------------------------------------------------------------
  const wallet = requireEip712Wallet(await provider.getActiveWallet())
  const address = await wallet.getAddress()
  console.log(`Address:      ${address}`)
  console.log()

  // ----------------------------------------------------------------
  // Step 3: Sign a message (pure local, no network)
  // ----------------------------------------------------------------
  const msgSig = await wallet.signTypedData(MESSAGE_TYPED_DATA)
  console.log(`Typed-data signature: ${msgSig}`)
  console.log()

  // ----------------------------------------------------------------
  // Step 4: Build unsigned tx via TronGrid, then sign with SDK
  //
  // The caller builds the transaction using TronGrid's REST API.
  // The SDK only signs: it takes the unsigned tx { txID, raw_data_hex }
  // and returns a signed tx JSON with the signature attached.
  // ----------------------------------------------------------------
  const network: string = 'nile'
  const baseUrl = TRONGRID_URLS[network] ?? TRONGRID_URLS['nile']

  console.log(`Signing TRX transfer: ${AMOUNT_SUN} SUN -> ${TO_ADDRESS}`)
  console.log(`Network: ${network} (${baseUrl})`)

  // 5a. Caller builds unsigned tx via TronGrid
  const unsignedTx = await buildTrxTransfer(baseUrl, address, TO_ADDRESS, AMOUNT_SUN)
  console.log(`TX ID:     ${unsignedTx.txID}`)
  console.log(`Unsigned TX: ${JSON.stringify(unsignedTx)}`)

  // 5b. SDK signs the unsigned tx
  const signed = await wallet.signTransaction(unsignedTx)
  if (signed.family !== 'tron') throw new Error('Expected a TRON signed transaction')
  const signedTx = signed.transaction
  console.log(`Signature: ${(signedTx.signature as string[])[0]}`)
  console.log(`Raw SignedTx: ${JSON.stringify(signedTx)}`)

  // ----------------------------------------------------------------
  // Step 5: Caller broadcasts the signed tx
  // ----------------------------------------------------------------
  console.log('Broadcasting...')
  const txid = await broadcastTransaction(signedTx, baseUrl)
  console.log(`Broadcasted! txid: ${txid}`)

  const explorerBase =
    network === 'mainnet' ? 'https://tronscan.org' : `https://${network}.tronscan.org`
  console.log(`Explorer:   ${explorerBase}/#/transaction/${txid}`)
}

// --- Helper functions (caller's responsibility, NOT part of SDK) ---

async function buildTrxTransfer(
  baseUrl: string,
  from: string,
  to: string,
  amountSun: number,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/wallet/createtransaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner_address: from,
      to_address: to,
      amount: amountSun,
      visible: true,
    }),
  })
  const tx = (await res.json()) as Record<string, unknown>
  if (!tx.txID) {
    throw new Error(`Failed to build transaction: ${JSON.stringify(tx)}`)
  }
  return tx
}

async function broadcastTransaction(
  signedTx: Record<string, unknown>,
  baseUrl: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/wallet/broadcasttransaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signedTx),
  })
  const result = (await res.json()) as Record<string, unknown>
  if (result.result) {
    return (result.txid as string) ?? (signedTx.txID as string) ?? ''
  }
  throw new Error(`Broadcast rejected: ${JSON.stringify(result)}`)
}

main().catch(reportExampleError)
