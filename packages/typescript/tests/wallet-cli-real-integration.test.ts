import { describe, expect, it } from 'vitest'

import { WalletCliClient } from '../src/core/clients/wallet-cli.js'
import { ExecSecretProvider } from '../src/core/secret-provider.js'
import { parseWalletCliNetwork } from '../src/core/wallet-cli-network.js'

const cliPath = process.env.AGENT_WALLET_TEST_WALLET_CLI_PATH
const account = process.env.AGENT_WALLET_TEST_WALLET_CLI_ACCOUNT
const network = process.env.AGENT_WALLET_TEST_WALLET_CLI_NETWORK
const passwordExec = process.env.AGENT_WALLET_TEST_WALLET_CLI_PASSWORD_EXEC

describe.skipIf(!cliPath)('wallet-cli real integration (opt-in)', () => {
  it('probes the explicitly selected executable contract', async () => {
    const client = new WalletCliClient({ binary: cliPath })
    const compatibility = await client.ensureCompatible()

    expect(compatibility.version).toMatch(/^4\.(?:1[3-9]|[2-9]\d)\./)
    expect(compatibility.catalog.tool).toBe('wallet-cli')
    expect(compatibility.networks.length).toBeGreaterThan(0)
  })

  it.skipIf(!account)('resolves an explicitly selected account', async () => {
    const client = new WalletCliClient({ binary: cliPath })
    const target = network ? parseWalletCliNetwork(network) : undefined
    const current = await client.currentAccount(account, target)
    expect(current.data.accountId).toBeTruthy()
    expect(current.chain).toBeTruthy()
  })

  it.skipIf(!account || !network || !passwordExec)(
    'signs only when account, network and password exec are all explicitly supplied',
    async () => {
      const client = new WalletCliClient({ binary: cliPath })
      const target = parseWalletCliNetwork(network)
      const identity = await client.currentAccount(account)
      const lease = await new ExecSecretProvider(
        { exec: passwordExec! },
        'wallet-cli integration password',
      ).acquire({
        label: 'wallet-cli integration password',
        accountId: identity.data.accountId,
        network: target.cliNetwork,
      })
      try {
        const result = await client.signMessage(
          'agent-wallet integration probe',
          lease,
          { accountId: identity.data.accountId },
          target,
        )
        expect(result.data.address).toBeTruthy()
        expect(result.data.signature).toMatch(/^0x/)
      } finally {
        await lease.dispose()
      }
    },
  )
})
