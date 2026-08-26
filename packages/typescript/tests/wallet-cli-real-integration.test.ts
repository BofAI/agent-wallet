import { describe, expect, it } from 'vitest'

import { WalletCliAdapter } from '../src/core/adapters/wallet-cli.js'
import { WalletCliClient } from '../src/core/clients/wallet-cli.js'
import { StaticSecretProvider } from '../src/core/secret-provider.js'

const cliPath = process.env.AGENT_WALLET_TEST_WALLET_CLI_PATH
const account = process.env.AGENT_WALLET_TEST_WALLET_CLI_ACCOUNT
const network = process.env.AGENT_WALLET_TEST_WALLET_CLI_NETWORK

describe.skipIf(!cliPath)('agent-wallet external wallet-cli boundary (opt-in)', () => {
  it('accepts an explicitly selected compatible executable', async () => {
    const client = new WalletCliClient({ binary: cliPath })
    const compatibility = await client.ensureCompatible()

    expect(compatibility.version).toMatch(/^4\.(?:1[3-9]|[2-9]\d)\./)
    expect(compatibility.catalog.tool).toBe('wallet-cli')
    expect(compatibility.networks.length).toBeGreaterThan(0)
  })

  it.skipIf(!account || !network)(
    'resolves the selected account address through WalletCliAdapter',
    async () => {
      const client = new WalletCliClient({ binary: cliPath })
      const adapter = new WalletCliAdapter(
        { account, password: 'unused-address-probe' },
        client,
        new StaticSecretProvider('unused-address-probe'),
        network,
      )

      expect(await adapter.getAddress()).toBeTruthy()
    },
  )
})
