/**
 * Compare sign input/output consistency across default_secure (EVM/TRON)
 * and privy wallets (privy_evm / privy_tron_2).
 *
 * Usage:
 *   AGENT_WALLET_DIR=/tmp/test-wallet \
 *   AGENT_WALLET_PASSWORD='Abc12345!@' \
 *   npx tsx examples/compare-sign-consistency.ts
 */

import { ConfigWalletProvider, type Eip712Capable, resolveWalletProvider } from '../src/index.js'

const DIR = process.env.AGENT_WALLET_DIR ?? '/tmp/test-wallet'
const PASSWORD = process.env.AGENT_WALLET_PASSWORD ?? ''
const DEFAULT_SECURE_ID = process.env.DEFAULT_SECURE_WALLET_ID ?? 'default_secure'
const PRIVY_EVM_ID = process.env.PRIVY_EVM_WALLET_ID ?? 'privy_evm'
const PRIVY_TRON_ID = process.env.PRIVY_TRON_WALLET_ID ?? 'privy_tron_2'
const EVM_NETWORK = process.env.EVM_NETWORK ?? 'eip155:1'
const TRON_NETWORK = process.env.TRON_NETWORK ?? 'tron'

if (!PASSWORD) {
  throw new Error('AGENT_WALLET_PASSWORD is required for default_secure testing.')
}

const provider = resolveWalletProvider({ dir: DIR })
if (!(provider instanceof ConfigWalletProvider)) {
  throw new Error('Expected a config-backed provider. Check AGENT_WALLET_DIR.')
}

const evmTxPayload = {
  to: '0x0000000000000000000000000000000000000001',
  chainId: 1,
  gas: 21000,
  nonce: 0,
  maxFeePerGas: 1000000000,
  maxPriorityFeePerGas: 1000000,
  value: 0,
}

const tronTxPayload = {
  raw_data_hex: 'abcd',
}

const typedDataTemplate = {
  domain: {
    name: 'AgentWallet',
    version: '1',
    chainId: 1,
  },
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
    ],
    Message: [{ name: 'contents', type: 'string' }],
  },
  primaryType: 'Message',
  message: {
    contents: 'Hello',
  },
}

function cloneTypedData() {
  return JSON.parse(JSON.stringify(typedDataTemplate))
}

type SignOutput =
  | { kind: 'json'; parsed: Record<string, unknown> }
  | { kind: 'hex'; has0x: boolean; length: number; sample: string }

function describeOutput(value: string): SignOutput {
  const trimmed = value.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      return { kind: 'json', parsed }
    } catch {
      // fall through
    }
  }
  const has0x = trimmed.startsWith('0x')
  const hex = has0x ? trimmed.slice(2) : trimmed
  return {
    kind: 'hex',
    has0x,
    length: hex.length,
    sample: `${trimmed.slice(0, 10)}...${trimmed.slice(-10)}`,
  }
}

function compareHex(a: SignOutput, b: SignOutput) {
  return a.kind === 'hex' && b.kind === 'hex' && a.has0x === b.has0x
}

function compareJson(a: SignOutput, b: SignOutput) {
  if (a.kind !== 'json' || b.kind !== 'json') return false
  const keys = (obj: Record<string, unknown>) => Object.keys(obj).sort().join(',')
  return keys(a.parsed) === keys(b.parsed)
}

async function signAll() {
  const defaultSecureEvm = await provider.getWallet(DEFAULT_SECURE_ID, EVM_NETWORK)
  const defaultSecureTron = await provider.getWallet(DEFAULT_SECURE_ID, TRON_NETWORK)
  const privyEvm = await provider.getWallet(PRIVY_EVM_ID)
  const privyTron = await provider.getWallet(PRIVY_TRON_ID)

  console.log('== Input shapes ==')
  console.log('EVM tx payload (both):', JSON.stringify(evmTxPayload))
  console.log('TRON tx payload (both):', JSON.stringify(tronTxPayload))
  console.log()

  console.log('== sign msg ==')
  const msg = Buffer.from('hello', 'utf-8')
  const msgDefaultEvm = describeOutput(await defaultSecureEvm.signMessage(msg))
  const msgPrivyEvm = describeOutput(await privyEvm.signMessage(msg))
  const msgDefaultTron = describeOutput(await defaultSecureTron.signMessage(msg))
  const msgPrivyTron = describeOutput(await privyTron.signMessage(msg))
  console.log('EVM default_secure:', msgDefaultEvm)
  console.log('EVM privy:', msgPrivyEvm)
  console.log('TRON default_secure:', msgDefaultTron)
  console.log('TRON privy:', msgPrivyTron)
  console.log('EVM consistent:', compareHex(msgDefaultEvm, msgPrivyEvm))
  console.log('TRON consistent:', compareHex(msgDefaultTron, msgPrivyTron))
  console.log()

  console.log('== sign tx ==')
  const txDefaultEvm = describeOutput(await defaultSecureEvm.signTransaction(evmTxPayload))
  const txPrivyEvm = describeOutput(await privyEvm.signTransaction(evmTxPayload))
  const txDefaultTron = describeOutput(await defaultSecureTron.signTransaction(tronTxPayload))
  const txPrivyTron = describeOutput(await privyTron.signTransaction(tronTxPayload))
  console.log('EVM default_secure:', txDefaultEvm)
  console.log('EVM privy:', txPrivyEvm)
  console.log('TRON default_secure:', txDefaultTron)
  console.log('TRON privy:', txPrivyTron)
  console.log('EVM consistent:', compareHex(txDefaultEvm, txPrivyEvm))
  console.log('TRON consistent:', compareJson(txDefaultTron, txPrivyTron))
  console.log()

  console.log('== sign typed-data ==')
  const tdDefaultEvm = describeOutput(
    await (defaultSecureEvm as unknown as Eip712Capable).signTypedData(cloneTypedData()),
  )
  const tdPrivyEvm = describeOutput(
    await (privyEvm as unknown as Eip712Capable).signTypedData(cloneTypedData()),
  )
  const tdDefaultTron = describeOutput(
    await (defaultSecureTron as unknown as Eip712Capable).signTypedData(cloneTypedData()),
  )
  const tdPrivyTron = describeOutput(
    await (privyTron as unknown as Eip712Capable).signTypedData(cloneTypedData()),
  )
  console.log('EVM default_secure:', tdDefaultEvm)
  console.log('EVM privy:', tdPrivyEvm)
  console.log('TRON default_secure:', tdDefaultTron)
  console.log('TRON privy:', tdPrivyTron)
  console.log('EVM consistent:', compareHex(tdDefaultEvm, tdPrivyEvm))
  console.log('TRON consistent:', compareHex(tdDefaultTron, tdPrivyTron))
  console.log()
}

signAll().catch((err) => {
  console.error(err)
  process.exit(1)
})
