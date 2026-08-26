import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveWalletAddresses } from '../src/core/address-resolution.js'
import type { WalletCliClient } from '../src/core/clients/wallet-cli.js'
import { saveConfig, type WalletConfig } from '../src/core/config.js'
import { ConfigWalletProvider } from '../src/core/providers/config-provider.js'
import { resolveWallet, resolveWalletProvider } from '../src/core/resolver.js'
import type { SecretProvider } from '../src/core/secret-provider.js'

const TRON_ADDRESS = 'TMSgJxtPw29AFEHMXsjGo4kWV7UwbCToHJ'
const EVM_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function success<T>(command: string, data: T) {
  return {
    schema: 'wallet-cli.result.v1' as const,
    success: true as const,
    command,
    data,
    meta: { durationMs: 1, warnings: [] },
  }
}

function client(): WalletCliClient {
  return {
    ensureCompatible: vi.fn().mockResolvedValue({
      version: '4.12.0',
      catalog: { tool: 'wallet-cli', version: '4.12.0', globalFlags: [], commands: [] },
      networks: [],
      network: { id: 'tron:nile', family: 'tron', chainId: 'nile' },
    }),
    currentAccount: vi.fn().mockResolvedValue(
      success('current', {
        accountId: 'wlt_fixture.0',
        type: 'seed',
        index: 0,
        active: true,
        addresses: { evm: EVM_ADDRESS, tron: TRON_ADDRESS },
      }),
    ),
  } as unknown as WalletCliClient
}

const conf: WalletConfig = {
  type: 'wallet_cli',
  params: { account: 'fixture', password: { exec: '/not-executed' } },
}

describe('wallet-cli standard resolver dependencies', () => {
  it('passes the injected client and secret factories through resolveWallet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-wallet-cli-resolver-'))
    dirs.push(dir)
    saveConfig(dir, { active_wallet: 'cli', wallets: { cli: conf } })
    const injectedClient = client()
    const secretProvider = { acquire: vi.fn() } as unknown as SecretProvider
    const clientFactory = vi.fn(() => injectedClient)
    const secretProviderFactory = vi.fn(() => secretProvider)

    const wallet = await resolveWallet({
      dir,
      walletId: 'cli',
      network: 'tron:nile',
      dependencies: { walletCli: { clientFactory, secretProviderFactory } },
    })

    await expect(wallet.getAddress()).resolves.toBe(TRON_ADDRESS)
    expect(clientFactory).toHaveBeenCalledWith({ network: 'tron:nile', purpose: 'signing' })
    expect(secretProviderFactory).toHaveBeenCalledWith(conf.params.password, {
      label: 'wallet-cli password',
    })
    expect(secretProvider.acquire).not.toHaveBeenCalled()
  })

  it('resolves both addresses directly without constructing a signing adapter or secret provider', async () => {
    const injectedClient = client()
    const secretProviderFactory = vi.fn()
    const result = await resolveWalletAddresses(conf, {
      dependencies: {
        walletCli: { clientFactory: () => injectedClient, secretProviderFactory },
      },
    })

    expect(result).toEqual({
      mode: 'whitelist',
      entries: [
        { format: 'eip155', label: 'EVM', address: EVM_ADDRESS },
        { format: 'tron', label: 'TRON', address: TRON_ADDRESS },
      ],
    })
    expect(injectedClient.currentAccount).toHaveBeenCalledWith('fixture')
    expect(secretProviderFactory).not.toHaveBeenCalled()
  })

  it('does not reuse adapters across providers with different dependency snapshots', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-wallet-cli-isolation-'))
    dirs.push(dir)
    saveConfig(dir, { active_wallet: 'cli', wallets: { cli: conf } })
    const firstClient = client()
    const secondClient = client()
    ;(secondClient.currentAccount as ReturnType<typeof vi.fn>).mockResolvedValue(
      success('current', {
        accountId: 'wlt_second.0',
        type: 'seed',
        index: 0,
        active: true,
        addresses: { tron: 'TSecondAddress' },
      }),
    )
    const secretProvider = { acquire: vi.fn() } as unknown as SecretProvider

    const first = await resolveWallet({
      dir,
      network: 'tron:nile',
      dependencies: {
        walletCli: {
          clientFactory: () => firstClient,
          secretProviderFactory: () => secretProvider,
        },
      },
    })
    const second = await resolveWallet({
      dir,
      network: 'tron:nile',
      dependencies: {
        walletCli: {
          clientFactory: () => secondClient,
          secretProviderFactory: () => secretProvider,
        },
      },
    })

    await expect(first.getAddress()).resolves.toBe(TRON_ADDRESS)
    await expect(second.getAddress()).resolves.toBe('TSecondAddress')
  })

  it('captures an immutable dependency snapshot when the provider is constructed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-wallet-cli-snapshot-'))
    dirs.push(dir)
    saveConfig(dir, { active_wallet: 'cli', wallets: { cli: conf } })
    const firstClient = client()
    const secondClient = client()
    ;(secondClient.currentAccount as ReturnType<typeof vi.fn>).mockResolvedValue(
      success('current', {
        accountId: 'wlt_mutated.0',
        type: 'seed',
        index: 0,
        active: true,
        addresses: { tron: 'TMutatedAddress' },
      }),
    )
    const secretProvider = { acquire: vi.fn() } as unknown as SecretProvider
    const dependencies = {
      walletCli: {
        clientFactory: () => firstClient,
        secretProviderFactory: () => secretProvider,
      },
    }
    const provider = resolveWalletProvider({ dir, network: 'tron:nile', dependencies })

    dependencies.walletCli.clientFactory = () => secondClient
    const wallet = await provider.getActiveWallet('tron:nile')

    await expect(wallet.getAddress()).resolves.toBe(TRON_ADDRESS)
    expect(firstClient.currentAccount).toHaveBeenCalledTimes(1)
    expect(secondClient.currentAccount).not.toHaveBeenCalled()
  })

  it('recreates wallet-cli dependencies after removing and re-adding the same wallet id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-wallet-cli-recreate-'))
    dirs.push(dir)
    const oldPassword = { exec: '/old-password' }
    const newPassword = { exec: '/new-password' }
    saveConfig(dir, {
      active_wallet: 'cli',
      wallets: {
        cli: { type: 'wallet_cli', params: { account: 'old-account', password: oldPassword } },
      },
    })
    const secretProvider = { acquire: vi.fn() } as unknown as SecretProvider
    const secretProviderFactory = vi.fn(() => secretProvider)
    const provider = new ConfigWalletProvider(dir, {
      dependencies: {
        walletCli: { clientFactory: () => client(), secretProviderFactory },
      },
    })

    const first = await provider.getWallet('cli', 'tron:nile')
    provider.removeWallet('cli')
    provider.addWallet('cli', {
      type: 'wallet_cli',
      params: { account: 'new-account', password: newPassword },
    })
    const recreated = await provider.getWallet('cli', 'tron:nile')

    expect(recreated).not.toBe(first)
    expect(secretProviderFactory).toHaveBeenNthCalledWith(1, oldPassword, {
      label: 'wallet-cli password',
    })
    expect(secretProviderFactory).toHaveBeenNthCalledWith(2, newPassword, {
      label: 'wallet-cli password',
    })
  })
})
