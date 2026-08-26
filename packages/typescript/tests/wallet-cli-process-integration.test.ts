import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'
import { parseTransaction } from 'viem'
import { z } from 'zod'

import { WalletCliAdapter } from '../src/core/adapters/wallet-cli.js'
import { WalletCliClient } from '../src/core/clients/wallet-cli.js'
import { WalletCliExecutionError } from '../src/core/errors.js'
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

    expect(first.version).toBe('4.12.0')
    expect(second.network?.id).toBe('evm:1')
    expect(third.catalog.commands.some((command) => command.id === 'typed-data.sign')).toBe(true)
    expect(readFileSync(counter, 'utf8').trim().split('\n')).toHaveLength(3)
  })

  it('returns the canonical dual-family account descriptor without acquiring a secret', async () => {
    const result = await fixtureClient().currentAccount('fixture')
    expect(result.data.accountId).toBe('wlt_fixture.0')
    expect(result.data.addresses).toEqual({ tron: TRON_ADDRESS, evm: EVM_ADDRESS })
  })

  it('signs a TRON transaction and preserves the complete JSON artifact', async () => {
    const adapter = new WalletCliAdapter(
      { account: 'fixture', password: 'fixture-password' },
      fixtureClient(),
      new StaticSecretProvider('fixture-password'),
      'tron:nile',
    )
    const unsigned = { txID: 'abc', raw_data: { contract: [] }, raw_data_hex: 'deadbeef' }
    const signed = JSON.parse(await adapter.signTransaction(unsigned))
    expect(signed).toMatchObject(unsigned)
    expect(signed.signature).toEqual(['fixture-signature'])
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
    expect(signed).not.toMatch(/^0x/)
    expect(parseTransaction(`0x${signed}`)).toMatchObject({ chainId: 1 })
  })

  it('signs UTF-8 messages and typed data for both families', async () => {
    for (const network of ['tron:nile', 'eip155:1']) {
      const adapter = new WalletCliAdapter(
        { account: 'fixture', password: 'fixture-password' },
        fixtureClient(),
        new StaticSecretProvider('fixture-password'),
        network,
      )
      await expect(adapter.signMessage(new TextEncoder().encode('hello 世界'))).resolves.toMatch(
        /^[0-9a-f]+$/,
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
      'tron:nile',
    )

    await adapter.signMessage(new TextEncoder().encode('first'))
    await adapter.signMessage(new TextEncoder().encode('second'))

    expect(acquisitions).toBe(2)
  })

  it('fails capability drift even when the version is compatible', async () => {
    const client = fixtureClient('missing-evm-capability')
    await expect(client.ensureCompatible(parseWalletCliNetwork('eip155:1'))).rejects.toMatchObject({
      code: 'capability_missing',
    } satisfies Partial<WalletCliExecutionError>)
  })

  it('enforces stable >=4.12.0 <5.0.0 versions and catalog agreement', async () => {
    await expect(
      fixtureClient('ok', { WALLET_CLI_FIXTURE_VERSION: '4.13.1' }).ensureCompatible(),
    ).resolves.toMatchObject({ version: '4.13.1' })
    for (const version of ['4.11.9', '5.0.0']) {
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
      WALLET_CLI_FIXTURE_VERSION: '4.11.9',
    })

    await expect(client.ensureCompatible()).rejects.toMatchObject({ code: 'unsupported_version' })
    await expect(client.ensureCompatible()).rejects.toMatchObject({ code: 'unsupported_version' })
    expect(readFileSync(counter, 'utf8').trim().split('\n')).toHaveLength(2)
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
    const target = parseWalletCliNetwork('tron:nile')
    const identity = await client.currentAccount('fixture')
    const wrongLease = await new StaticSecretProvider('wrong-password').acquire({
      label: 'wallet-cli password',
      accountId: identity.data.accountId,
      network: target.cliNetwork,
    })
    try {
      await expect(
        client.signMessage('hello', wrongLease, { accountId: identity.data.accountId }, target),
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
