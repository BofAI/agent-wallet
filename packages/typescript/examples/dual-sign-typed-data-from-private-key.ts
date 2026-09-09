/**
 * Demo: Resolve both TRON and EVM signers from one external input.
 *
 * This example maps one of these external environment variables into the SDK's
 * expected env vars:
 *
 *   - `PRIVATE_KEY`
 *   - `MNEMONIC`
 *   - `MNEMONIC_ACCOUNT_INDEX` (optional, mnemonic mode only)
 *
 * Then it resolves two wallet providers:
 *
 *   - TRON via `resolveWalletProvider({ network: "tron:728126428" })`
 *   - EVM via `resolveWalletProvider({ network: "eip155:1" })`
 *
 * Usage:
 *   PRIVATE_KEY=<hex> npx tsx examples/dual-sign-typed-data-from-private-key.ts
 *   MNEMONIC="word1 word2 ..." npx tsx examples/dual-sign-typed-data-from-private-key.ts
 *   MNEMONIC="word1 word2 ..." MNEMONIC_ACCOUNT_INDEX=1 npx tsx examples/dual-sign-typed-data-from-private-key.ts
 */

import { resolveWalletProvider } from '../src/index.js'
import {
  configureEnvWalletSource,
  reportExampleError,
  requireEip712Wallet,
} from './example-utils.js'

const PAYMENT_PERMIT = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    PaymentPermitDetails: [
      { name: 'buyer', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
    ],
  },
  primaryType: 'PaymentPermitDetails',
  domain: {
    name: 'x402PaymentPermit',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: {
    buyer: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    amount: 1000000,
    nonce: 0,
  },
}

async function main() {
  configureEnvWalletSource()

  const tronProvider = resolveWalletProvider({ network: 'tron:728126428' })
  const tronWallet = requireEip712Wallet(await tronProvider.getActiveWallet())
  const tronAddress = await tronWallet.getAddress()
  const tronSignature = await tronWallet.signTypedData(PAYMENT_PERMIT)

  const evmProvider = resolveWalletProvider({ network: 'eip155:1' })
  const evmWallet = requireEip712Wallet(await evmProvider.getActiveWallet())
  const evmAddress = await evmWallet.getAddress()
  const evmSignature = await evmWallet.signTypedData(PAYMENT_PERMIT)

  console.log('=== TRON ===')
  console.log(`Address:    ${tronAddress}`)
  console.log(`Signature:  ${tronSignature}`)
  console.log()

  console.log('=== EVM ===')
  console.log(`Address:    ${evmAddress}`)
  console.log(`Signature:  ${evmSignature}`)
}

main().catch(reportExampleError)
