import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CliExit,
  type CliIO,
  cmdAdd,
  cmdInspect,
  cmdList,
  cmdRemove,
  cmdResolveAddress,
  cmdReset,
  cmdStart,
  cmdSignTypedData,
  cmdUse,
  expandTilde,
  main,
} from '../src/delivery/cli.js'
import { saveConfig } from '../src/core/config.js'
import { ConfigWalletProvider } from '../src/core/providers/config-provider.js'

const TEST_PRIVATE_KEY = '4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b'
const TEST_MNEMONIC = 'test test test test test test test test test test test junk'

function mockIO(answers: string[] = [], interactive = true): CliIO & { output: string[] } {
  const queue = [...answers]
  const output: string[] = []
  return {
    interactive,
    output,
    print(msg: string) {
      output.push(msg)
    },
    async prompt(_question: string, opts?: { defaultValue?: string }) {
      const answer = queue.shift()
      return answer && answer.length > 0 ? answer : (opts?.defaultValue ?? '')
    },
    async confirm(_question: string, defaultValue = false) {
      const answer = queue.shift()
      if (!answer) return defaultValue
      return ['y', 'yes'].includes(answer.toLowerCase())
    },
    async select(_promptText: string, choices: string[]) {
      const answer = queue.shift()
      if (!answer) return choices[0] ?? null
      return choices.includes(answer) ? answer : null
    },
  }
}

function out(io: ReturnType<typeof mockIO>): string {
  return io.output.join('\n')
}

function readConfig(dir: string): Record<string, any> {
  return JSON.parse(readFileSync(join(dir, 'wallets_config.json'), 'utf-8'))
}

let secretsDir: string
let initializedTemplateDir: string
let listTemplateDir: string
let signerTemplateDir: string

beforeEach(() => {
  secretsDir = mkdtempSync(join(tmpdir(), 'agent-wallet-cli-test-'))
  delete process.env.AGENT_WALLET_DIR
  delete process.env.AGENT_WALLET_PRIVATE_KEY
  delete process.env.AGENT_WALLET_MNEMONIC
  delete process.env.AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

afterEach(() => {
  rmSync(secretsDir, { recursive: true, force: true })
})

async function createTemplateDir(
  prefix: string,
  setup: (dir: string) => Promise<void>,
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  await setup(dir)
  return dir
}

function cloneDir(src: string, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cpSync(src, dir, { recursive: true })
  return dir
}

beforeAll(async () => {
  initializedTemplateDir = await createTemplateDir(
    'agent-wallet-cli-init-template-',
    async (dir) => {
      const provider = new ConfigWalletProvider(dir)
      provider.ensureStorage()
    },
  )

  listTemplateDir = await createTemplateDir('agent-wallet-cli-list-template-', async (dir) => {
    await cmdAdd(dir, mockIO(), {
      walletType: 'raw_secret',
      walletId: 'raw-one',
      privateKey: TEST_PRIVATE_KEY,
    })
    await cmdAdd(dir, mockIO(), {
      walletType: 'raw_secret',
      walletId: 'hot',
      privateKey: TEST_PRIVATE_KEY,
    })
  })

  signerTemplateDir = await createTemplateDir('agent-wallet-cli-signer-template-', async (dir) => {
    await cmdAdd(dir, mockIO(), {
      walletType: 'raw_secret',
      walletId: 'signer',
      privateKey: TEST_PRIVATE_KEY,
    })
  })
})

afterAll(() => {
  for (const dir of [initializedTemplateDir, listTemplateDir, signerTemplateDir]) {
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('cmdStart', () => {
  it('shows grouped help for start and mode-specific help for start raw_secret', async () => {
    const io1 = mockIO()
    const code1 = await main(['start', '--help'], io1)
    expect(code1).toBe(0)
    expect(out(io1)).toContain('raw_secret')

    const io2 = mockIO()
    const code2 = await main(['start', 'raw_secret', '--help'], io2)
    expect(code2).toBe(0)
    expect(out(io2)).toContain('Usage: agent-wallet start raw_secret [options]')
  })

  it('starts raw_secret with private key', async () => {
    const io = mockIO()
    await cmdStart(secretsDir, io, {
      walletType: 'raw_secret',
      walletId: 'hot',
      privateKey: TEST_PRIVATE_KEY,
    })

    const config = readConfig(secretsDir)
    expect(config.wallets.hot.type).toBe('raw_secret')
    expect(config.wallets.hot.params.source).toBe('private_key')
    expect(config.active_wallet).toBe('hot')
  })

  it('re-prompts for invalid interactive private key input', async () => {
    const io = mockIO(['private_key', 'not-hex', TEST_PRIVATE_KEY])
    await cmdStart(secretsDir, io, {
      walletType: 'raw_secret',
      walletId: 'hot',
    })

    expect(out(io)).toContain('Private key must be 32 bytes')
    const config = readConfig(secretsDir)
    expect(config.wallets.hot.params.source).toBe('private_key')
  })

  it('main parses -mi for mnemonic start', async () => {
    const io = mockIO()
    const code = await main(
      ['start', 'raw_secret', '-w', 'seed', '-m', TEST_MNEMONIC, '-mi', '2', '-d', secretsDir],
      io,
    )

    expect(code).toBe(0)
    const config = readConfig(secretsDir)
    expect(config.wallets.seed.params.account_index).toBe(2)
  })

  it('prompts for wallet type when start is called without one', async () => {
    const io = mockIO(['raw_secret', ''])
    await cmdStart(secretsDir, io, {
      walletType: undefined,
      privateKey: TEST_PRIVATE_KEY,
    })

    const config = readConfig(secretsDir)
    expect(config.wallets.default_raw.type).toBe('raw_secret')
    expect(config.active_wallet).toBe('default_raw')
  })

  it('prompts for wallet id when start is called without one', async () => {
    const io = mockIO(['custom-wallet'])
    await cmdStart(secretsDir, io, {
      walletType: 'raw_secret',
      privateKey: TEST_PRIVATE_KEY,
    })

    const config = readConfig(secretsDir)
    expect(config.wallets['custom-wallet'].type).toBe('raw_secret')
    expect(config.active_wallet).toBe('custom-wallet')
  })

  it('uses the default wallet id when prompted wallet id is empty', async () => {
    const io = mockIO([''])
    await cmdStart(secretsDir, io, {
      walletType: 'raw_secret',
      privateKey: TEST_PRIVATE_KEY,
    })

    const config = readConfig(secretsDir)
    expect(config.wallets.default_raw.type).toBe('raw_secret')
    expect(config.active_wallet).toBe('default_raw')
  })

  it('prompts for mnemonic material in raw_secret start when no source flags are provided', async () => {
    const io = mockIO(['custom-wallet', 'mnemonic', TEST_MNEMONIC, '2', 'tron'])
    await cmdStart(secretsDir, io, {
      walletType: 'raw_secret',
    })

    const config = readConfig(secretsDir)
    expect(config.wallets['custom-wallet'].params.source).toBe('mnemonic')
    expect(config.wallets['custom-wallet'].params.account_index).toBe(2)
  })

  it('supports deriveAs flag for raw_secret mnemonic start', async () => {
    const io = mockIO(['custom-wallet'])
    await cmdStart(secretsDir, io, {
      walletType: 'raw_secret',
      walletId: 'seed',
      mnemonic: TEST_MNEMONIC,
      mnemonicIndex: 2,
      deriveAs: 'tron',
    })

    const config = readConfig(secretsDir)
    expect(config.wallets.seed.params.source).toBe('mnemonic')
    expect(config.wallets.seed.params.account_index).toBe(2)
  })

  it('re-prompts for invalid mnemonic account index', async () => {
    const io = mockIO(['mnemonic', TEST_MNEMONIC, 'nope', TEST_MNEMONIC, '2', 'tron'])
    await cmdStart(secretsDir, io, {
      walletType: 'raw_secret',
      walletId: 'seed',
    })

    expect(out(io)).toContain('Invalid account index.')
    const config = readConfig(secretsDir)
    expect(config.wallets.seed.params.account_index).toBe(2)
  })

  it('re-prompts for empty Privy required fields', async () => {
    const io = mockIO(['', 'app-id', '', '', 'app-secret', '', 'wallet-id'])
    await cmdStart(secretsDir, io, {
      walletType: 'privy',
      walletId: 'privy1',
    })

    expect(out(io)).toContain('Privy app id is required.')
    expect(out(io)).toContain('Privy app secret is required.')
    expect(out(io)).toContain('Privy wallet id is required.')
    const config = readConfig(secretsDir)
    expect(config.wallets.privy1.type).toBe('privy')
  })

  it('accepts explicit Privy flags in start privy', async () => {
    const io = mockIO()
    const code = await main(
      [
        'start',
        'privy',
        '--wallet-id',
        'privy1',
        '--app-id',
        'app-id',
        '--app-secret',
        'app-secret',
        '--privy-wallet-id',
        'wallet-1',
        '-d',
        secretsDir,
      ],
      io,
    )

    expect(code).toBe(0)
    const config = readConfig(secretsDir)
    expect(config.wallets.privy1.params.app_id).toBe('app-id')
    expect(config.wallets.privy1.params.app_secret).toBe('app-secret')
    expect(config.wallets.privy1.params.wallet_id).toBe('wallet-1')
  })
})

describe('cmdStart override behavior', () => {
  it('accepts explicit flags in start wallet_cli', async () => {
    const io = mockIO()
    const code = await main(
      [
        'start',
        'wallet_cli',
        '--wallet-id',
        'cli1',
        '--account',
        'main-1',
        '--cli-password',
        'KsPass123!',
        '-d',
        secretsDir,
      ],
      io,
    )

    expect(code).toBe(0)
    const config = readConfig(secretsDir)
    expect(config.active_wallet).toBe('cli1')
    expect(config.wallets.cli1.type).toBe('wallet_cli')
    expect(config.wallets.cli1.params.account).toBe('main-1')
    expect(config.wallets.cli1.params.password).toBe('KsPass123!')
  })

  it('prompts for missing wallet_cli password in start wallet_cli', async () => {
    const io = mockIO(['', '', '', 'KsPass123!'])
    await cmdStart(secretsDir, io, {
      walletType: 'wallet_cli',
      walletId: 'cli2',
    })

    expect(out(io)).toContain('is required.')
    const config = readConfig(secretsDir)
    expect(config.wallets.cli2.type).toBe('wallet_cli')
    expect(config.wallets.cli2.params.password).toBe('KsPass123!')
    expect(config.wallets.cli2.params.account).toBeUndefined()
  })

  it('exits when wallets exist and user selects exit', async () => {
    // First start — create a wallet
    const io1 = mockIO([TEST_PRIVATE_KEY])
    await cmdStart(secretsDir, io1, {
      walletType: 'raw_secret',
      walletId: 'w1',
      privateKey: TEST_PRIVATE_KEY,
    })

    // Second start — should prompt and exit
    const io2 = mockIO(['exit'])
    await expect(cmdStart(secretsDir, io2, {})).rejects.toThrow(CliExit)
    expect(io2.output.some((l) => l.includes('Already initialized'))).toBe(true)
  })

  it('continues when wallets exist and --override is set', async () => {
    const io1 = mockIO([TEST_PRIVATE_KEY])
    await cmdStart(secretsDir, io1, {
      walletType: 'raw_secret',
      walletId: 'w1',
      privateKey: TEST_PRIVATE_KEY,
    })

    // Second start with override — no prompt, creates w2
    const io2 = mockIO([TEST_PRIVATE_KEY])
    await cmdStart(secretsDir, io2, {
      walletType: 'raw_secret',
      walletId: 'w2',
      privateKey: TEST_PRIVATE_KEY,
      override: true,
    })
    expect(io2.output.some((l) => l.includes('Already initialized'))).toBe(false)
    const config = JSON.parse(readFileSync(join(secretsDir, 'wallets_config.json'), 'utf-8'))
    expect(config.wallets.w2).toBeDefined()
  })

  it('does not prompt on fresh directory', async () => {
    const io = mockIO([TEST_PRIVATE_KEY])
    await cmdStart(secretsDir, io, {
      walletType: 'raw_secret',
      walletId: 'w1',
      privateKey: TEST_PRIVATE_KEY,
    })
    expect(io.output.some((l) => l.includes('Already initialized'))).toBe(false)
  })
})

describe('duplicate wallet ID handling', () => {
  it('start --walletId with duplicate errors immediately', async () => {
    const io1 = mockIO()
    await cmdStart(secretsDir, io1, {
      walletType: 'raw_secret',
      walletId: 'w1',
      privateKey: TEST_PRIVATE_KEY,
    })

    const io2 = mockIO()
    await expect(
      cmdStart(secretsDir, io2, {
        walletType: 'raw_secret',
        walletId: 'w1',
        override: true,
        privateKey: TEST_PRIVATE_KEY,
      }),
    ).rejects.toThrow(CliExit)
    expect(io2.output.some((l) => l.includes('already exists'))).toBe(true)
  })

  it('add --walletId with duplicate errors immediately', async () => {
    const io1 = mockIO()
    await cmdAdd(secretsDir, io1, {
      walletType: 'raw_secret',
      walletId: 'w1',
      privateKey: TEST_PRIVATE_KEY,
    })

    const io2 = mockIO()
    await expect(
      cmdAdd(secretsDir, io2, {
        walletType: 'raw_secret',
        walletId: 'w1',
        privateKey: TEST_PRIVATE_KEY,
      }),
    ).rejects.toThrow(CliExit)
    expect(io2.output.some((l) => l.includes('already exists'))).toBe(true)
  })
})

describe('non-interactive prompt guards', () => {
  it('fails immediately for missing Privy required fields in non-interactive mode', async () => {
    const io = mockIO([], false)
    await expect(
      cmdStart(secretsDir, io, {
        walletType: 'privy',
        walletId: 'privy1',
      }),
    ).rejects.toThrow(CliExit)
    expect(out(io)).toContain('Cannot prompt for privy app id')
  })
})

describe('cmdAdd / active wallet', () => {
  it('shows grouped help for add and mode-specific help for add privy', async () => {
    const io1 = mockIO()
    const code1 = await main(['add', '--help'], io1)
    expect(code1).toBe(0)
    expect(out(io1)).toContain('Usage: agent-wallet add [options]')
    expect(out(io1)).toContain('privy')

    const io2 = mockIO()
    const code2 = await main(['add', 'privy', '--help'], io2)
    expect(code2).toBe(0)
    expect(out(io2)).toContain('Usage: agent-wallet add privy [options]')
    expect(out(io2)).toContain('--app-id')
    expect(out(io2)).toContain('--privy-wallet-id')
  })

  it('shows mode-specific help for add wallet_cli', async () => {
    const io = mockIO()
    const code = await main(['add', 'wallet_cli', '--help'], io)
    expect(code).toBe(0)
    expect(out(io)).toContain('Usage: agent-wallet add wallet_cli [options]')
    expect(out(io)).toContain('--account')
    expect(out(io)).toContain('--cli-password')
  })

  it('adds wallet_cli wallet from explicit flags', async () => {
    const io = mockIO()
    await cmdAdd(secretsDir, io, {
      walletType: 'wallet_cli',
      walletId: 'cli-add',
      cliAccount: 'main-1',
      cliPassword: 'KsPass123!',
    })

    const config = readConfig(secretsDir)
    expect(config.wallets['cli-add'].type).toBe('wallet_cli')
    expect(config.wallets['cli-add'].params.account).toBe('main-1')
    expect(config.wallets['cli-add'].params.password).toBe('KsPass123!')
  })

  it('adds wallet_cli wallet prompting for password when omitted', async () => {
    const io = mockIO(['', '', 'Prompted123!'])
    await cmdAdd(secretsDir, io, {
      walletType: 'wallet_cli',
      walletId: 'cli-prompt',
    })

    const config = readConfig(secretsDir)
    expect(config.wallets['cli-prompt'].type).toBe('wallet_cli')
    expect(config.wallets['cli-prompt'].params.password).toBe('Prompted123!')
    expect(config.wallets['cli-prompt'].params.account).toBeUndefined()
  })

  it('accepts wallet_cli via main with --cli-password and no account', async () => {
    const io = mockIO()
    const code = await main(
      [
        'add',
        'wallet_cli',
        '--wallet-id',
        'cli-main',
        '--cli-password',
        'Main123!',
        '-d',
        secretsDir,
      ],
      io,
    )

    expect(code).toBe(0)
    const config = readConfig(secretsDir)
    expect(config.wallets['cli-main'].type).toBe('wallet_cli')
    expect(config.wallets['cli-main'].params.password).toBe('Main123!')
    expect(config.wallets['cli-main'].params.account).toBeUndefined()
  })

  it('adds raw_secret wallet from mnemonic', async () => {
    const io = mockIO()
    await cmdAdd(secretsDir, io, {
      walletType: 'raw_secret',
      walletId: 'seed',
      mnemonic: TEST_MNEMONIC,
      mnemonicIndex: 1,
    })
    const config = readConfig(secretsDir)
    expect(config.wallets.seed.type).toBe('raw_secret')
    expect(config.wallets.seed.params.source).toBe('mnemonic')
    expect(config.wallets.seed.params.account_index).toBe(1)
  })

  it('prompts for wallet type when add is called without one', async () => {
    const io = mockIO(['raw_secret', 'hot'])
    await cmdAdd(secretsDir, io, {
      privateKey: TEST_PRIVATE_KEY,
    })

    const config = readConfig(secretsDir)
    expect(config.wallets.hot.type).toBe('raw_secret')
  })

  it('prompts for wallet id when add is called without one', async () => {
    const io = mockIO(['wallet'])
    await cmdAdd(secretsDir, io, {
      walletType: 'raw_secret',
      privateKey: TEST_PRIVATE_KEY,
    })

    const config = readConfig(secretsDir)
    expect(config.wallets.wallet.type).toBe('raw_secret')
  })

  it('uses the wallet-type default id when add wallet id prompt is empty', async () => {
    const io = mockIO([''])
    await cmdAdd(secretsDir, io, {
      walletType: 'raw_secret',
      privateKey: TEST_PRIVATE_KEY,
    })

    const config = readConfig(secretsDir)
    expect(config.wallets.default_raw.type).toBe('raw_secret')
  })

  it('prompts for mnemonic material in add raw_secret when no source flags are provided', async () => {
    const io = mockIO(['mnemonic', TEST_MNEMONIC, '3', 'tron'])
    await cmdAdd(secretsDir, io, {
      walletType: 'raw_secret',
      walletId: 'interactive-raw',
    })

    const config = readConfig(secretsDir)
    expect(config.wallets['interactive-raw'].params.source).toBe('mnemonic')
    expect(config.wallets['interactive-raw'].params.account_index).toBe(3)
  })

  it('reuses existing privy app credentials when requested', async () => {
    const io1 = mockIO(['', 'app-id', '', 'app-secret', 'wallet-1'])
    await cmdAdd(secretsDir, io1, {
      walletType: 'privy',
    })

    const io2 = mockIO(['privy_2', 'default_privy', 'wallet-2'])
    await cmdAdd(secretsDir, io2, {
      walletType: 'privy',
    })

    const config = readConfig(secretsDir)
    expect(config.wallets.privy_2.params.app_id).toBe('app-id')
    expect(config.wallets.privy_2.params.app_secret).toBe('app-secret')
    expect(config.wallets.privy_2.params.wallet_id).toBe('wallet-2')
  })

  it('accepts explicit Privy flags in add privy', async () => {
    const io = mockIO()
    const code = await main(
      [
        'add',
        'privy',
        '--wallet-id',
        'privy_a',
        '--app-id',
        'app-id',
        '--app-secret',
        'app-secret',
        '--privy-wallet-id',
        'wallet-1',
        '-d',
        secretsDir,
      ],
      io,
    )

    expect(code).toBe(0)
    const config = readConfig(secretsDir)
    expect(config.wallets.privy_a.params.app_id).toBe('app-id')
    expect(config.wallets.privy_a.params.app_secret).toBe('app-secret')
    expect(config.wallets.privy_a.params.wallet_id).toBe('wallet-1')
  })

  it('use command sets active wallet', async () => {
    await cmdAdd(secretsDir, mockIO(), {
      walletType: 'raw_secret',
      walletId: 'w1',
      privateKey: TEST_PRIVATE_KEY,
    })
    await cmdAdd(secretsDir, mockIO(), {
      walletType: 'raw_secret',
      walletId: 'w2',
      privateKey: TEST_PRIVATE_KEY,
    })

    const io = mockIO()
    await cmdUse('w2', secretsDir, io)
    expect(readConfig(secretsDir).active_wallet).toBe('w2')
  })

  it('use command prompts to select wallet when id is omitted', async () => {
    await cmdAdd(secretsDir, mockIO(), {
      walletType: 'raw_secret',
      walletId: 'w1',
      privateKey: TEST_PRIVATE_KEY,
    })
    await cmdAdd(secretsDir, mockIO(), {
      walletType: 'raw_secret',
      walletId: 'w2',
      privateKey: TEST_PRIVATE_KEY,
    })

    const io = mockIO(['w2'])
    await cmdUse('' as unknown as string, secretsDir, io)
    expect(readConfig(secretsDir).active_wallet).toBe('w2')
  })
})

describe('cmdList / cmdInspect / cmdRemove', () => {
  beforeEach(() => {
    rmSync(secretsDir, { recursive: true, force: true })
    secretsDir = cloneDir(listTemplateDir, 'agent-wallet-cli-test-')
  })

  it('list shows wallet id and type', async () => {
    const io = mockIO()
    await cmdList(secretsDir, io)
    expect(out(io)).toContain('raw-one')
    expect(out(io)).toContain('raw_secret')
  })

  it('inspect shows raw_secret details', async () => {
    const io = mockIO()
    await cmdInspect('hot', secretsDir, io)
    expect(out(io)).toContain('Type')
    expect(out(io)).toContain('raw_secret')
    expect(out(io)).toContain('Source Type')
    expect(out(io)).toContain('private_key')
  })

  it('inspect shows wallet_cli details with account', async () => {
    const provider = new ConfigWalletProvider(secretsDir)
    provider.addWallet('cli-inspect', {
      type: 'wallet_cli',
      params: { account: 'main-1', password: 'Secret123!' },
    })
    const io = mockIO()
    await cmdInspect('cli-inspect', secretsDir, io)
    expect(out(io)).toContain('wallet_cli')
    expect(out(io)).toContain('main-1')
    expect(out(io)).toContain('[redacted]')
  })

  it('inspect shows wallet_cli details with (active) when no account', async () => {
    const provider = new ConfigWalletProvider(secretsDir)
    provider.addWallet('cli-noacct', {
      type: 'wallet_cli',
      params: { password: 'Secret123!' },
    })
    const io = mockIO()
    await cmdInspect('cli-noacct', secretsDir, io)
    expect(out(io)).toContain('wallet_cli')
    expect(out(io)).toContain('(active)')
    expect(out(io)).toContain('[redacted]')
  })

  it('resolve-address shows whitelist output for raw_secret wallets', async () => {
    const io = mockIO()
    await cmdResolveAddress('hot', secretsDir, io)
    expect(out(io)).toContain('Addresses')
    expect(out(io)).toMatch(/EVM\s+0x/i)
    expect(out(io)).toMatch(/TRON\s+T/i)
  })

  it('resolve-address prompts to select wallet when id is omitted', async () => {
    const io = mockIO(['hot'])
    await cmdResolveAddress(undefined, secretsDir, io)
    expect(out(io)).toContain('Wallet')
    expect(out(io)).toContain('hot')
  })

  it('resolve-address without wallets fails cleanly', async () => {
    rmSync(secretsDir, { recursive: true, force: true })
    secretsDir = cloneDir(initializedTemplateDir, 'agent-wallet-cli-test-')
    const io = mockIO()
    await expect(cmdResolveAddress(undefined, secretsDir, io)).rejects.toThrow(CliExit)
    expect(out(io)).toContain('No wallets configured.')
  })

  it('resolve-address shows a single address for privy wallets', async () => {
    await cmdAdd(secretsDir, mockIO(['app-id', '', 'app-secret', 'wallet-1']), {
      walletType: 'privy',
      walletId: 'privy-one',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { address: '0xabc', chain_type: 'ethereum' } }),
      })) as typeof fetch,
    )

    const io = mockIO()
    await cmdResolveAddress('privy-one', secretsDir, io)
    expect(out(io)).toContain('Address')
    expect(out(io)).toContain('0xabc')
    expect(out(io)).not.toContain('Addresses')
  })

  it('remove prompts to select wallet when id is omitted', async () => {
    const io = mockIO(['hot', 'y'])
    await cmdRemove(undefined, secretsDir, false, io)
    expect(readConfig(secretsDir).wallets.hot).toBeUndefined()
    expect(out(io)).toContain("Wallet 'hot' removed.")
  })

  it('remove prompts for confirmation and cancels when declined', async () => {
    const io = mockIO(['n'])
    await expect(cmdRemove('raw-one', secretsDir, false, io)).rejects.toThrow(CliExit)
    expect(readConfig(secretsDir).wallets['raw-one']).toBeDefined()
    expect(out(io)).toContain('Cancelled.')
  })

  it('remove can prompt for a new active wallet after deleting the active wallet', async () => {
    await cmdUse('raw-one', secretsDir, mockIO())
    const io = mockIO(['y', 'hot'])
    await cmdRemove('raw-one', secretsDir, false, io)
    expect(readConfig(secretsDir).active_wallet).toBe('hot')
    expect(out(io)).toContain('Active wallet: hot')
  })

  it('remove can leave active wallet unset after deleting the active wallet', async () => {
    await cmdUse('raw-one', secretsDir, mockIO())
    const io = mockIO(['y', 'no'])
    await cmdRemove('raw-one', secretsDir, false, io)
    expect(readConfig(secretsDir).active_wallet).toBeUndefined()
  })

  it('remove without wallets fails cleanly', async () => {
    rmSync(secretsDir, { recursive: true, force: true })
    secretsDir = cloneDir(initializedTemplateDir, 'agent-wallet-cli-test-')
    const io = mockIO()
    await expect(cmdRemove(undefined, secretsDir, true, io)).rejects.toThrow(CliExit)
    expect(out(io)).toContain('No wallets configured.')
  })
})

describe('sign commands', () => {
  beforeEach(() => {
    rmSync(secretsDir, { recursive: true, force: true })
    secretsDir = cloneDir(signerTemplateDir, 'agent-wallet-cli-test-')
  })

  it('requires network', async () => {
    const io = mockIO()
    await expect(
      cmdSignTypedData(
        'signer',
        '{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"}],"Mail":[{"name":"from","type":"string"},{"name":"contents","type":"string"}]},"primaryType":"Mail","domain":{"name":"Test","version":"1","chainId":1},"message":{"from":"0x","contents":"hello"}}',
        undefined,
        secretsDir,
        io,
      ),
    ).rejects.toThrow(CliExit)
    expect(out(io)).toContain('Error: network is required')
  })

  it('allows privy signing without network', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/v1/wallets/wallet-1') && !url.includes('/rpc')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { address: '0xabc', chain_type: 'ethereum' } }), {
            status: 200,
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data: { signature: '0xabc' } }), { status: 200 }),
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const provider = new ConfigWalletProvider(secretsDir)
    provider.addWallet('privy_wallet', {
      type: 'privy',
      params: {
        app_id: 'app',
        app_secret: 'secret',
        wallet_id: 'wallet-1',
      },
    })
    provider.setActive('privy_wallet')

    const io = mockIO()
    await cmdSignTypedData(
      'privy_wallet',
      '{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"}],"Mail":[{"name":"from","type":"string"},{"name":"contents","type":"string"}]},"primaryType":"Mail","domain":{"name":"Test","version":"1","chainId":1},"message":{"from":"0x","contents":"hello"}}',
      undefined,
      secretsDir,
      io,
    )
    expect(out(io)).toContain('Signature:')

    globalThis.fetch = originalFetch
  })

  it('uses active wallet when wallet id omitted', async () => {
    const io = mockIO()
    await cmdSignTypedData(
      undefined,
      '{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"}],"Mail":[{"name":"from","type":"string"},{"name":"contents","type":"string"}]},"primaryType":"Mail","domain":{"name":"Test","version":"1","chainId":1},"message":{"from":"0x","contents":"hello"}}',
      'eip155:1',
      secretsDir,
      io,
    )
    expect(out(io)).toContain('Signature:')
  })

  it('main parses --wallet-id for sign commands', async () => {
    const io = mockIO()
    const code = await main(
      [
        'sign',
        'typed-data',
        '{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"}],"Mail":[{"name":"from","type":"string"},{"name":"contents","type":"string"}]},"primaryType":"Mail","domain":{"name":"Test","version":"1","chainId":1},"message":{"from":"0x","contents":"hello"}}',
        '--wallet-id',
        'signer',
        '--network',
        'eip155:1',
        '-d',
        secretsDir,
      ],
      io,
    )
    expect(code).toBe(0)
    expect(out(io)).toContain('Signature:')
  })
})

describe('invalid config handling', () => {
  it('fails with friendly error when start sees invalid wallets_config.json', async () => {
    writeFileSync(
      join(secretsDir, 'wallets_config.json'),
      JSON.stringify({
        active_wallet: 'legacy',
        wallets: {
          legacy: {
            type: 'evm_local',
            identity_file: 'legacy',
          },
        },
      }),
      'utf-8',
    )

    const io = mockIO()
    const code = await main(['start', 'raw_secret', '-d', secretsDir], io)
    expect(code).toBe(1)
    expect(out(io)).toContain('Invalid wallet config in')
  })
})

describe('exec script flags', () => {
  it('start wallet_cli accepts --cli-password-exec', async () => {
    const scriptPath = join(secretsDir, 'fetch-pw.sh')
    writeFileSync(scriptPath, '#!/bin/sh\necho KsPass123!\n', { mode: 0o755 })

    const io = mockIO()
    const code = await main(
      [
        'start',
        'wallet_cli',
        '--wallet-id',
        'cli-exec',
        '--account',
        'main-1',
        '--cli-password-exec',
        scriptPath,
        '-d',
        secretsDir,
      ],
      io,
    )

    expect(code).toBe(0)
    const config = readConfig(secretsDir)
    expect(config.wallets['cli-exec'].type).toBe('wallet_cli')
    expect(config.wallets['cli-exec'].params.password).toEqual({ exec: scriptPath })
  })

  it('add wallet_cli accepts --cli-password-exec', async () => {
    const scriptPath = join(secretsDir, 'fetch-pw-add.sh')
    writeFileSync(scriptPath, '#!/bin/sh\necho KsPass123!\n', { mode: 0o755 })

    const io = mockIO()
    await cmdAdd(secretsDir, io, {
      walletType: 'wallet_cli',
      walletId: 'cli-add-exec',
      cliAccount: 'main-1',
      cliPasswordExec: scriptPath,
    })

    const config = readConfig(secretsDir)
    expect(config.wallets['cli-add-exec'].params.password).toEqual({ exec: scriptPath })
  })

  it('start privy accepts --app-secret-exec', async () => {
    const scriptPath = join(secretsDir, 'fetch-secret.sh')
    writeFileSync(scriptPath, '#!/bin/sh\necho my-app-secret\n', { mode: 0o755 })

    const io = mockIO()
    const code = await main(
      [
        'start',
        'privy',
        '--wallet-id',
        'privy-exec',
        '--app-id',
        'app-id',
        '--app-secret-exec',
        scriptPath,
        '--privy-wallet-id',
        'wallet-1',
        '-d',
        secretsDir,
      ],
      io,
    )

    expect(code).toBe(0)
    const config = readConfig(secretsDir)
    expect(config.wallets['privy-exec'].params.app_secret).toEqual({ exec: scriptPath })
  })

  it('add privy accepts --app-secret-exec', async () => {
    const scriptPath = join(secretsDir, 'fetch-secret-add.sh')
    writeFileSync(scriptPath, '#!/bin/sh\necho my-app-secret\n', { mode: 0o755 })

    const io = mockIO()
    await cmdAdd(secretsDir, io, {
      walletType: 'privy',
      walletId: 'privy-add-exec',
      appId: 'app-id',
      appSecretExec: scriptPath,
      privyWalletId: 'wallet-1',
    })

    const config = readConfig(secretsDir)
    expect(config.wallets['privy-add-exec'].params.app_secret).toEqual({ exec: scriptPath })
  })
})

describe('expandTilde', () => {
  it('expands ~ alone to homedir', () => {
    expect(expandTilde('~')).toBe(require('node:os').homedir())
  })

  it('expands ~/ prefix', () => {
    const home = require('node:os').homedir()
    expect(expandTilde('~/foo')).toBe(join(home, 'foo'))
  })

  it('expands ~\\ prefix (Windows backslash)', () => {
    const home = require('node:os').homedir()
    expect(expandTilde('~\\foo')).toBe(join(home, 'foo'))
  })

  it('leaves non-tilde paths unchanged', () => {
    expect(expandTilde('/usr/local')).toBe('/usr/local')
    expect(expandTilde('relative/path')).toBe('relative/path')
  })
})
