import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, saveConfig, type WalletsTopology } from '@bankofai/agent-wallet'
import { WalletCliClient, type WalletCliRunContract } from '@bankofai/agent-wallet/advanced'
import { buildTransfer } from '@bankofai/agent-wallet/integrations/wallet-cli'
import { z } from 'zod'

function clientFor(data: unknown): WalletCliClient {
  const stdout = JSON.stringify({
    schema: 'wallet-cli.result.v1',
    success: true,
    command: 'current',
    data,
    meta: { durationMs: 1, warnings: [] },
  })
  return new WalletCliClient({
    launchTarget: {
      command: process.execPath,
      argsPrefix: ['-e', `process.stdout.write(${JSON.stringify(stdout)})`, '--'],
    },
  })
}

async function main(): Promise<void> {
  const dataSchema = z.object({ count: z.string().transform(Number) })
  const contract: WalletCliRunContract<{ count: number }> = {
    command: 'current',
    chain: 'none',
    dataSchema,
  }
  const result = await clientFor({ count: '42' }).run(['current'], contract)
  const count: number = result.data.count
  // @ts-expect-error Transformed results must retain their output type.
  const invalidCount: string = result.data.count
  void invalidCount
  assert.equal(count, 42)
  assert.equal(typeof buildTransfer, 'function')

  let visited = 0
  await assert.rejects(
    clientFor(Array(32).fill('item')).run(['current'], {
      command: 'current',
      chain: 'none',
      dataSchema: z
        .array(
          z.string().superRefine(() => {
            visited++
          }),
        )
        .max(2),
    }),
    { code: 'contract_mismatch' },
  )
  assert.equal(visited, 0)

  const directory = mkdtempSync(join(tmpdir(), 'agent-wallet-config-consumer-'))
  try {
    const config: WalletsTopology = {
      active_wallet: null,
      wallets: {
        fixture: {
          type: 'raw_secret',
          params: { source: 'mnemonic', mnemonic: 'fixture', account_index: 0 },
        },
      },
    }
    saveConfig(directory, config)
    assert.deepEqual(loadConfig(directory), config)

    writeFileSync(
      join(directory, 'wallets_config.json'),
      JSON.stringify({
        wallets: {
          fixture: { type: 'raw_secret', params: { source: 'mnemonic', mnemonic: 'fixture' } },
        },
      }),
    )
    assert.deepEqual(loadConfig(directory), config)

    writeFileSync(join(directory, 'wallets_config.json'), '{"wallets": []}')
    assert.throws(() => loadConfig(directory), z.ZodError)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
