import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'
import { parseTransaction } from 'viem'
import { z } from 'zod'

import { WalletCliAdapter } from '../src/core/adapters/wallet-cli.js'
import type { Eip712Capable } from '../src/core/base.js'
import { WalletCliClient } from '../src/core/clients/wallet-cli.js'
import { WalletCliExecutionError, WalletCliUsageError } from '../src/core/errors.js'
import { ConfigWalletProvider } from '../src/core/providers/config-provider.js'
import { StaticSecretProvider, type SecretProvider } from '../src/core/secret-provider.js'
import { parseWalletCliNetwork } from '../src/core/wallet-cli-network.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/wallet-cli-fixture.mjs', import.meta.url))
const EVM_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const TRON_ADDRESS = 'TMSgJxtPw29AFEHMXsjGo4kWV7UwbCToHJ'
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function fixtureClient(mode = 'ok', extraEnv: NodeJS.ProcessEnv = {}): WalletCliClient {
  return new WalletCliClient({
    launchTarget: { command: process.execPath, argsPrefix: [FIXTURE] },
    env: { ...process.env, WALLET_CLI_FIXTURE_MODE: mode, ...extraEnv },
    timeoutMs: 2_000,
  })
}

describe('wallet-cli deterministic process integration', () => {
  it('reloads a persisted direct password and uses it for signing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-wallet-cli-direct-password-'))
    temporaryDirectories.push(dir)

    const writer = new ConfigWalletProvider(dir)
    writer.addWallet('fixture-cli', {
      type: 'wallet_cli',
      params: { account: 'wlt_fixture.0', password: 'fixture-password' },
    })

    const configPath = join(dir, 'wallets_config.json')
    const stored = JSON.parse(readFileSync(configPath, 'utf8')) as {
      wallets: { 'fixture-cli': { params: { password: string } } }
    }
    expect(stored.wallets['fixture-cli'].params.password).toBe('fixture-password')
    if (process.platform !== 'win32') {
      expect(statSync(configPath).mode & 0o777).toBe(0o600)
    }

    // A new provider models a new agent-wallet process and must rebuild the
    // StaticSecretProvider from the direct password loaded from disk.
    const reader = new ConfigWalletProvider(dir, {
      dependencies: { walletCli: { clientFactory: () => fixtureClient() } },
    })
    const wallet = await reader.getWallet('fixture-cli', 'eip155:1')
    expect('signTypedData' in wallet).toBe(true)
    await expect(
      (wallet as typeof wallet & Eip712Capable).signTypedData({
        domain: { chainId: 1 },
        types: { Message: [{ name: 'value', type: 'string' }] },
        primaryType: 'Message',
        message: { value: 'persisted direct password' },
      }),
    ).resolves.toBe('33'.repeat(65))
  })

  it('reloads a persisted exec password and executes it for every signing process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-wallet-cli-exec-password-'))
    temporaryDirectories.push(dir)
    const counter = join(dir, 'secret-calls.txt')
    const secretScript = join(dir, 'get-password.mjs')
    writeFileSync(
      secretScript,
      [
        '#!/usr/bin/env node',
        "import { appendFileSync } from 'node:fs'",
        `appendFileSync(${JSON.stringify(counter)}, 'call\\n')`,
        "process.stdout.write('fixture-password\\n')",
      ].join('\n'),
      { mode: 0o700 },
    )
    const secretExec = process.platform === 'win32' ? join(dir, 'get-password.cmd') : secretScript
    if (process.platform === 'win32') {
      writeFileSync(secretExec, `@echo off\r\n"${process.execPath}" "%~dp0get-password.mjs"\r\n`)
    }

    const writer = new ConfigWalletProvider(dir)
    writer.addWallet('fixture-cli', {
      type: 'wallet_cli',
      params: {
        account: 'wlt_fixture.0',
        password: { exec: secretExec, timeout: 2_000 },
      },
    })

    const stored = JSON.parse(readFileSync(join(dir, 'wallets_config.json'), 'utf8')) as {
      wallets: {
        'fixture-cli': { params: { password: { exec: string; timeout: number } } }
      }
    }
    expect(stored.wallets['fixture-cli'].params.password).toEqual({
      exec: secretExec,
      timeout: 2_000,
    })

    // Recreate the provider to prove the exec reference survives a process
    // restart and is resolved by the production SecretProvider factory.
    const reader = new ConfigWalletProvider(dir, {
      dependencies: { walletCli: { clientFactory: () => fixtureClient() } },
    })
    const wallet = await reader.getWallet('fixture-cli', 'eip155:1')
    expect('signTypedData' in wallet).toBe(true)
    const signer = wallet as typeof wallet & Eip712Capable
    const typedData = {
      domain: { chainId: 1 },
      types: { Message: [{ name: 'value', type: 'string' }] },
      primaryType: 'Message',
      message: { value: 'persisted exec password' },
    }

    await expect(signer.signTypedData(typedData)).resolves.toBe('33'.repeat(65))
    await expect(signer.signTypedData(typedData)).resolves.toBe('33'.repeat(65))
    expect(readFileSync(counter, 'utf8').trim().split('\n')).toHaveLength(2)
  })

  it('shares one version/catalog/networks handshake across concurrent callers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-wallet-cli-counter-'))
    temporaryDirectories.push(dir)
    const counter = join(dir, 'calls.txt')
    const client = fixtureClient('ok', { WALLET_CLI_FIXTURE_COUNTER: counter })
    const target = parseWalletCliNetwork('eip155:1')

    const [first, second, third] = await Promise.all([
      client.ensureCompatible(target),
      client.ensureCompatible(target),
      client.ensureCompatible(target),
    ])

    expect(first.version).toBe('4.13.0')
    expect(second.network?.id).toBe('eip155:1')
    expect(third.catalog.commands.some((command) => command.id === 'typed-data.sign')).toBe(true)
    expect(readFileSync(counter, 'utf8').trim().split('\n')).toEqual([
      'version',
      'catalog',
      'networks',
    ])
  })

  it('serializes startup migration and lets the same client retry after completion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-wallet-cli-migration-'))
    temporaryDirectories.push(dir)
    const counter = join(dir, 'calls.txt')
    const migrationState = join(dir, 'migration-complete')
    const client = fixtureClient('migration-once', {
      WALLET_CLI_FIXTURE_COUNTER: counter,
      WALLET_CLI_FIXTURE_MIGRATION_STATE: migrationState,
    })

    await expect(client.ensureCompatible()).rejects.toMatchObject({
      code: 'migration_completed',
    } satisfies Partial<WalletCliExecutionError>)
    expect(readFileSync(counter, 'utf8').trim().split('\n')).toEqual(['version'])

    await expect(client.ensureCompatible()).resolves.toMatchObject({ version: '4.13.0' })
    expect(readFileSync(counter, 'utf8').trim().split('\n')).toEqual([
      'version',
      'version',
      'catalog',
      'networks',
    ])
  })

  it('preserves migration_required and does not pin it on the client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-wallet-cli-migration-required-'))
    temporaryDirectories.push(dir)
    const counter = join(dir, 'calls.txt')
    const client = fixtureClient('migration-required', {
      WALLET_CLI_FIXTURE_COUNTER: counter,
    })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const error = await client.ensureCompatible().catch((cause: unknown) => cause)
      expect(error).toBeInstanceOf(WalletCliUsageError)
      expect(error).toMatchObject({ code: 'migration_required' })
    }
    expect(readFileSync(counter, 'utf8').trim().split('\n')).toEqual(['version', 'version'])
  })

  it('preserves an interactive migration cancellation and lets the client retry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-wallet-cli-migration-cancelled-'))
    temporaryDirectories.push(dir)
    const counter = join(dir, 'calls.txt')
    const client = fixtureClient('migration-cancelled', {
      WALLET_CLI_FIXTURE_COUNTER: counter,
    })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(client.ensureCompatible()).rejects.toMatchObject({
        code: 'migration_cancelled',
      } satisfies Partial<WalletCliExecutionError>)
    }
    expect(readFileSync(counter, 'utf8').trim().split('\n')).toEqual(['version', 'version'])
  })

  it('returns the canonical dual-family account descriptor without acquiring a secret', async () => {
    const result = await fixtureClient().currentAccount('fixture')
    expect(result.data.accountId).toBe('wlt_fixture.0')
    expect(result.data.addresses).toEqual({ tron: TRON_ADDRESS, evm: EVM_ADDRESS })
    expect(result.chain).toEqual({
      family: 'tron',
      network: 'tron:728126428',
      chainId: '728126428',
    })
  })

  it('pins current to the requested signing network and requires its 4.13 chain context', async () => {
    const target = parseWalletCliNetwork('eip155:1')
    const result = await fixtureClient().currentAccount('fixture', target)
    expect(result.chain).toEqual({ family: 'evm', network: 'eip155:1', chainId: '1' })

    await expect(
      fixtureClient('missing-current-chain').currentAccount('fixture', target),
    ).rejects.toMatchObject({ code: 'network_mismatch' })
  })

  it('signs a TRON transaction and preserves the complete JSON artifact', async () => {
    const adapter = new WalletCliAdapter(
      { account: 'fixture', password: 'fixture-password' },
      fixtureClient(),
      new StaticSecretProvider('fixture-password'),
      'tron:3448148188',
    )
    const unsigned = { txID: 'abc', raw_data: { contract: [] }, raw_data_hex: 'deadbeef' }
    const signed = await adapter.signTransaction(unsigned)
    expect(signed.family).toBe('tron')
    if (signed.family !== 'tron') throw new Error('Expected TRON artifact')
    expect(signed.transaction).toMatchObject(unsigned)
    expect(signed.transaction.signature).toEqual(['fixture-signature'])
  })

  it.each([
    {
      name: 'legacy',
      transaction: {
        chainId: 1,
        nonce: 0,
        gas: 21_000n,
        gasPrice: 1_000_000_000n,
        to: EVM_ADDRESS,
        value: 1n,
      },
    },
    {
      name: 'EIP-2930',
      transaction: {
        type: 'eip2930',
        chainId: 1,
        nonce: 1,
        gas: 21_000n,
        gasPrice: 1_000_000_000n,
        accessList: [],
        to: EVM_ADDRESS,
        value: 1n,
      },
    },
    {
      name: 'EIP-1559',
      transaction: {
        type: 'eip1559',
        chainId: 1,
        nonce: 2,
        gas: 21_000n,
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        to: EVM_ADDRESS,
        value: 1n,
      },
    },
  ])('signs a $name EVM transaction and returns raw hex without 0x', async ({ transaction }) => {
    const adapter = new WalletCliAdapter(
      { account: 'fixture', password: 'fixture-password' },
      fixtureClient(),
      new StaticSecretProvider('fixture-password'),
      'eip155:1',
    )
    const signed = await adapter.signTransaction(transaction)
    expect(signed.family).toBe('evm')
    if (signed.family !== 'evm') throw new Error('Expected EVM artifact')
    expect(signed.rawTransaction).not.toMatch(/^0x/)
    expect(parseTransaction(`0x${signed.rawTransaction}`)).toMatchObject({ chainId: 1 })
  })

  it('signs typed data for both families', async () => {
    for (const network of ['tron:3448148188', 'eip155:1']) {
      const adapter = new WalletCliAdapter(
        { account: 'fixture', password: 'fixture-password' },
        fixtureClient(),
        new StaticSecretProvider('fixture-password'),
        network,
      )
      await expect(
        adapter.signTypedData({
          domain: network.startsWith('eip155') ? { chainId: 1 } : { chainId: 728126428 },
          types: { Message: [{ name: 'value', type: 'string' }] },
          primaryType: 'Message',
          message: { value: 'hello' },
        }),
      ).resolves.toMatch(/^[0-9a-f]+$/)
    }
  })

  it('acquires a fresh one-shot secret lease for every signing process', async () => {
    const staticProvider = new StaticSecretProvider('fixture-password')
    let acquisitions = 0
    const provider: SecretProvider = {
      acquire: async (context) => {
        acquisitions += 1
        return staticProvider.acquire(context)
      },
    }
    const adapter = new WalletCliAdapter(
      { account: 'fixture', password: 'fixture-password' },
      fixtureClient(),
      provider,
      'tron:3448148188',
    )

    await adapter.signTypedData({
      domain: { chainId: 728126428 },
      types: { Message: [{ name: 'value', type: 'string' }] },
      primaryType: 'Message',
      message: { value: 'first' },
    })
    await adapter.signTypedData({
      domain: { chainId: 728126428 },
      types: { Message: [{ name: 'value', type: 'string' }] },
      primaryType: 'Message',
      message: { value: 'second' },
    })

    expect(acquisitions).toBe(2)
  })

  it('fails capability drift even when the version is compatible', async () => {
    const client = fixtureClient('missing-evm-capability')
    await expect(client.ensureCompatible(parseWalletCliNetwork('eip155:1'))).rejects.toMatchObject({
      code: 'capability_missing',
    } satisfies Partial<WalletCliExecutionError>)
  })

  it('enforces stable >=4.13.0 <5.0.0 versions and catalog agreement', async () => {
    await expect(
      fixtureClient('ok', { WALLET_CLI_FIXTURE_VERSION: '4.13.1' }).ensureCompatible(),
    ).resolves.toMatchObject({ version: '4.13.1' })
    for (const version of ['4.12.0', '5.0.0']) {
      await expect(
        fixtureClient('ok', { WALLET_CLI_FIXTURE_VERSION: version }).ensureCompatible(),
      ).rejects.toMatchObject({ code: 'unsupported_version' })
    }
    await expect(fixtureClient('prerelease').ensureCompatible()).rejects.toMatchObject({
      code: 'unsupported_version',
    })
    await expect(
      fixtureClient('catalog-version-mismatch').ensureCompatible(),
    ).rejects.toMatchObject({ code: 'contract_mismatch' })
  })

  it('pins a failed handshake on the client instead of retrying subprocesses implicitly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-wallet-cli-failed-counter-'))
    temporaryDirectories.push(dir)
    const counter = join(dir, 'calls.txt')
    const client = fixtureClient('ok', {
      WALLET_CLI_FIXTURE_COUNTER: counter,
      WALLET_CLI_FIXTURE_VERSION: '4.12.0',
    })

    await expect(client.ensureCompatible()).rejects.toMatchObject({ code: 'unsupported_version' })
    await expect(client.ensureCompatible()).rejects.toMatchObject({ code: 'unsupported_version' })
    expect(readFileSync(counter, 'utf8').trim().split('\n')).toEqual(['version'])
  })

  it('classifies timeout, output limits and malformed envelopes without exposing output', async () => {
    await expect(fixtureClient('hang').ensureCompatible()).rejects.toMatchObject({
      code: 'timeout',
    })
    await expect(
      new WalletCliClient({
        launchTarget: { command: process.execPath, argsPrefix: [FIXTURE] },
        env: { ...process.env, WALLET_CLI_FIXTURE_MODE: 'stdout-limit' },
        maxStdoutBytes: 1024,
      }).ensureCompatible(),
    ).rejects.toMatchObject({ code: 'output_limit' })
    await expect(fixtureClient('malformed').ensureCompatible()).rejects.toMatchObject({
      code: 'contract_mismatch',
    })
  })

  it('preserves structured warnings and classifies fixture exit 1/2 envelopes', async () => {
    const warningResult = await fixtureClient('structured-warning').currentAccount('fixture')
    expect(warningResult.meta.warnings).toEqual([
      { code: 'fixture_warning', message: 'fixture notice' },
    ])

    const client = fixtureClient()
    const target = parseWalletCliNetwork('tron:3448148188')
    const identity = await client.currentAccount('fixture')
    const wrongLease = await new StaticSecretProvider('wrong-password').acquire({
      label: 'wallet-cli password',
      accountId: identity.data.accountId,
      network: target.cliNetwork,
    })
    try {
      await expect(
        client.signTypedData(
          JSON.stringify({
            domain: { chainId: 728126428 },
            types: { Message: [{ name: 'value', type: 'string' }] },
            primaryType: 'Message',
            message: { value: 'hello' },
          }),
          wrongLease,
          { accountId: identity.data.accountId },
          target,
        ),
      ).rejects.toMatchObject({ code: 'auth_failed' })
    } finally {
      await wrongLease.dispose()
    }

    await expect(
      fixtureClient().run(['unknown'], {
        command: 'unknown',
        dataSchema: z.unknown(),
        chain: 'none',
      }),
    ).rejects.toMatchObject({ code: 'invalid_value' })
  })
})
