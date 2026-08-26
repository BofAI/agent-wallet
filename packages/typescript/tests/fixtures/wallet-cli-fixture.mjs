#!/usr/bin/env node

import { appendFileSync } from 'node:fs'
import { keccak256, parseTransaction } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const VERSION = '4.13.0'
const emittedVersion = process.env.WALLET_CLI_FIXTURE_VERSION ?? VERSION
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const account = privateKeyToAccount(PRIVATE_KEY)
const TRON_ADDRESS = 'TMSgJxtPw29AFEHMXsjGo4kWV7UwbCToHJ'
const ACCOUNT_ID = 'wlt_fixture.0'
const args = process.argv.slice(2)
const mode = process.env.WALLET_CLI_FIXTURE_MODE ?? 'ok'

if (process.env.WALLET_CLI_FIXTURE_COUNTER) {
  appendFileSync(process.env.WALLET_CLI_FIXTURE_COUNTER, `${commandId(args)}\n`)
}

if (mode === 'hang') {
  setInterval(() => {}, 1_000)
} else if (mode === 'stdout-limit') {
  process.stdout.write('x'.repeat(128 * 1024))
} else if (mode === 'stderr-limit') {
  process.stderr.write('sensitive-stderr'.repeat(16 * 1024))
} else if (mode === 'malformed' && !args.includes('--version') && !args.includes('--json-schema')) {
  process.stdout.write('{not-json')
} else if (args.length === 1 && args[0] === '--version') {
  process.stdout.write(mode === 'prerelease' ? '4.13.0-beta.1\n' : `${emittedVersion}\n`)
} else if (args.length === 1 && args[0] === '--json-schema') {
  const commands = [
    { id: 'current', kind: 'neutral', path: ['current'] },
    { id: 'tx.sign', kind: 'chain', families: ['tron', 'evm'], path: ['tx', 'sign'] },
    {
      id: 'message.sign',
      kind: 'chain',
      families: ['tron', 'evm'],
      path: ['message', 'sign'],
    },
    {
      id: 'typed-data.sign',
      kind: 'chain',
      families: mode === 'missing-evm-capability' ? ['tron'] : ['tron', 'evm'],
      path: ['typed-data', 'sign'],
    },
  ]
  process.stdout.write(
    JSON.stringify({
      tool: 'wallet-cli',
      version: mode === 'catalog-version-mismatch' ? '4.14.0' : emittedVersion,
      globalFlags: [],
      commands,
    }),
  )
} else {
  await runOperational()
}

async function runOperational() {
  const id = commandId(args)
  if (id === 'networks') {
    success('networks', [
      { id: 'tron:nile', alias: 'nile', family: 'tron', chainId: 'nile' },
      { id: 'tron:mainnet', alias: 'mainnet', family: 'tron', chainId: 'mainnet' },
      { id: 'evm:1', alias: 'ethereum', family: 'evm', chainId: '1' },
      { id: 'evm:56', alias: 'bsc', family: 'evm', chainId: '56' },
    ])
    return
  }
  if (id === 'current') {
    const chain = chainFor(valueOf('--network') ?? 'tron:mainnet')
    success(
      'current',
      {
        accountId: ACCOUNT_ID,
        label: 'fixture',
        type: 'seed',
        index: 0,
        active: true,
        addresses: { tron: TRON_ADDRESS, evm: account.address },
        seedId: 'wlt_fixture',
      },
      mode === 'missing-current-chain' ? undefined : chain,
    )
    return
  }

  const network = valueOf('--network')
  const chain = chainFor(network)
  if (!chain) return failure(id, 'invalid_value', 'unknown network', 2)
  const password = (await readStdin()).trim()
  if (password !== 'fixture-password') return failure(id, 'auth_failed', 'bad password', 1, chain)
  const signer =
    mode === 'signer-mismatch'
      ? '0x0000000000000000000000000000000000000001'
      : chain.family === 'evm'
        ? account.address
        : TRON_ADDRESS

  if (id === 'tx.sign') {
    if (chain.family === 'evm') {
      const unsigned = valueOf('--hex')
      if (!unsigned) return failure(id, 'missing_option', 'missing hex', 2, chain)
      const transaction = parseTransaction(unsigned)
      const raw = await account.signTransaction(transaction)
      success(
        id,
        {
          kind: 'sign',
          mode: 'sign-only',
          address: signer,
          txId: keccak256(raw),
          signed: { raw, hash: keccak256(raw) },
        },
        chain,
      )
      return
    }
    const transaction = JSON.parse(valueOf('--transaction') ?? '{}')
    success(
      id,
      {
        kind: 'sign',
        mode: 'sign-only',
        address: signer,
        txId: transaction.txID,
        signed: { ...transaction, signature: ['fixture-signature'] },
      },
      chain,
    )
    return
  }
  if (id === 'message.sign') {
    success(
      id,
      { address: signer, message: valueOf('--message'), signature: `0x${'11'.repeat(65)}` },
      chain,
    )
    return
  }
  if (id === 'typed-data.sign') {
    const typed = JSON.parse(valueOf('--typed-data') ?? '{}')
    success(
      id,
      {
        address: signer,
        primaryType: typed.primaryType ?? 'Message',
        digest: `0x${'22'.repeat(32)}`,
        signature: `0x${'33'.repeat(65)}`,
      },
      chain,
    )
    return
  }
  failure(id, 'usage_error', 'unsupported fixture command', 2, chain)
}

function commandId(argv) {
  const words = argv.filter((arg) => !arg.startsWith('-'))
  if (argv[0] === 'tx') return `tx.${argv[1]}`
  if (argv[0] === 'message') return 'message.sign'
  if (argv[0] === 'typed-data') return 'typed-data.sign'
  return words[0] ?? 'meta'
}

function valueOf(flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function chainFor(network) {
  if (network === 'tron:nile') return { family: 'tron', network, chainId: 'nile' }
  if (network === 'tron:mainnet') return { family: 'tron', network, chainId: 'mainnet' }
  if (network === 'evm:1') return { family: 'evm', network, chainId: '1' }
  if (network === 'evm:56') return { family: 'evm', network, chainId: '56' }
  return undefined
}

function success(command, data, chain) {
  process.stdout.write(
    JSON.stringify({
      schema: 'wallet-cli.result.v1',
      success: true,
      command,
      data,
      ...(chain ? { chain } : {}),
      meta: {
        durationMs: 1,
        warnings:
          mode === 'structured-warning'
            ? [{ code: 'fixture_warning', message: 'fixture notice' }]
            : [],
      },
    }),
  )
}

function failure(command, code, message, exitCode, chain) {
  process.stdout.write(
    JSON.stringify({
      schema: 'wallet-cli.result.v1',
      success: false,
      command,
      error: { code, message },
      ...(chain ? { chain } : {}),
      meta: { durationMs: 1, warnings: [] },
    }),
  )
  process.exitCode = exitCode
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}
