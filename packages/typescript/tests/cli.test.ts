import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import {
  CliExit,
  type CliIO,
  cmdAdd,
  cmdChangePassword,
  cmdInit,
  cmdInspect,
  cmdList,
  cmdRemove,
  cmdReset,
  cmdSignMsg,
  cmdStart,
  cmdUse,
  main,
} from '../src/delivery/cli.js'
import { saveConfig } from '../src/core/config.js'
import { ConfigWalletProvider } from '../src/core/providers/config-provider.js'
import { loadLocalSecret } from '../src/local/secret-loader.js'

const TEST_PASSWORD = 'Test-password-123!'
const TEST_PRIVATE_KEY = '4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b'
const TEST_MNEMONIC = 'test test test test test test test test test test test junk'

function mockIO(answers: string[] = []): CliIO & { output: string[] } {
  const queue = [...answers]
  const output: string[] = []
  return {
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

beforeEach(() => {
  secretsDir = mkdtempSync(join(tmpdir(), 'agent-wallet-cli-test-'))
  delete process.env.AGENT_WALLET_PASSWORD
  delete process.env.AGENT_WALLET_DIR
  delete process.env.AGENT_WALLET_PRIVATE_KEY
  delete process.env.AGENT_WALLET_MNEMONIC
  delete process.env.AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX
  vi.restoreAllMocks()
})

afterEach(() => {
  rmSync(secretsDir, { recursive: true, force: true })
})

async function initDir(dir: string): Promise<void> {
  const io = mockIO([TEST_PASSWORD, TEST_PASSWORD])
  await cmdInit(dir, io)
}

describe('cmdInit', () => {
  it('creates master.json and wallets_config.json', async () => {
    const io = mockIO([TEST_PASSWORD, TEST_PASSWORD])
    await cmdInit(secretsDir, io)
    expect(out(io)).toContain('Initialized')
    expect(existsSync(join(secretsDir, 'master.json'))).toBe(true)
    expect(existsSync(join(secretsDir, 'wallets_config.json'))).toBe(true)
  })

  it('uses prompted passwords when no explicit password is provided', async () => {
    const io = mockIO([TEST_PASSWORD, TEST_PASSWORD])
    await cmdInit(secretsDir, io)

    const provider = new ConfigWalletProvider(secretsDir, TEST_PASSWORD)
    expect(provider.isInitialized()).toBe(true)
  })
})

describe('cmdStart', () => {
  it('starts local_secure with generate shortcut', async () => {
    const io = mockIO()
    await cmdStart(secretsDir, io, {
      walletType: 'local_secure',
      walletId: 'default',
      password: TEST_PASSWORD,
      generate: true,
    })

    const config = readConfig(secretsDir)
    expect(config.wallets.default.type).toBe('local_secure')
    expect(config.wallets.default.params.secret_ref).toBe('default')
    expect(config.active_wallet).toBe('default')
    expect(existsSync(join(secretsDir, 'secret_default.json'))).toBe(true)
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

  it('starts local_secure with mnemonic deriveAs', async () => {
    const io = mockIO()
    await cmdStart(secretsDir, io, {
      walletType: 'local_secure',
      walletId: 'seed',
      password: TEST_PASSWORD,
      mnemonic: TEST_MNEMONIC,
      mnemonicIndex: 1,
      deriveAs: 'eip155',
    })

    expect(existsSync(join(secretsDir, 'secret_seed.json'))).toBe(true)
    expect(readConfig(secretsDir).active_wallet).toBe('seed')
  })

  it('main parses -mi for mnemonic start', async () => {
    const io = mockIO()
    const code = await main(
      [
        'start',
        'raw_secret',
        '-w',
        'seed',
        '-m',
        TEST_MNEMONIC,
        '-mi',
        '2',
        '-d',
        secretsDir,
      ],
      io,
    )

    expect(code).toBe(0)
    const config = readConfig(secretsDir)
    expect(config.wallets.seed.params.account_index).toBe(2)
  })

  it('prompts for wallet type when start is called without one', async () => {
    const io = mockIO(['local_secure', ''])
    await cmdStart(secretsDir, io, {
      password: TEST_PASSWORD,
      generate: true,
    })

    const config = readConfig(secretsDir)
    expect(config.wallets.default.type).toBe('local_secure')
    expect(config.active_wallet).toBe('default')
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
    expect(config.wallets.raw_wallet.type).toBe('raw_secret')
    expect(config.active_wallet).toBe('raw_wallet')
  })

  it('prompts for import source in local_secure start when no source flags are provided', async () => {
    const io = mockIO(['generate'])
    await cmdStart(secretsDir, io, {
      walletType: 'local_secure',
      walletId: 'seed',
      password: TEST_PASSWORD,
    })

    expect(existsSync(join(secretsDir, 'secret_seed.json'))).toBe(true)
    expect(readConfig(secretsDir).active_wallet).toBe('seed')
  })

  it('prompts for derivation profile in local_secure start mnemonic flow', async () => {
    const io = mockIO(['mnemonic', 'tron'])
    await cmdStart(secretsDir, io, {
      walletType: 'local_secure',
      walletId: 'seed',
      password: TEST_PASSWORD,
      mnemonic: TEST_MNEMONIC,
    })

    expect(existsSync(join(secretsDir, 'secret_seed.json'))).toBe(true)
    expect(readConfig(secretsDir).wallets.seed.type).toBe('local_secure')
  })

  it('prompts for mnemonic material in raw_secret start when no source flags are provided', async () => {
    const io = mockIO(['custom-wallet', 'mnemonic', TEST_MNEMONIC, '2'])
    await cmdStart(secretsDir, io, {
      walletType: 'raw_secret',
    })

    const config = readConfig(secretsDir)
    expect(config.wallets['custom-wallet'].params.source).toBe('mnemonic')
    expect(config.wallets['custom-wallet'].params.account_index).toBe(2)
  })

  it('prompts for private key material in local_secure start when selected interactively', async () => {
    const io = mockIO(['private_key', TEST_PRIVATE_KEY])
    await cmdStart(secretsDir, io, {
      walletType: 'local_secure',
      walletId: 'hot',
      password: TEST_PASSWORD,
    })

    expect(existsSync(join(secretsDir, 'secret_hot.json'))).toBe(true)
  })
})

describe('cmdStart override behavior', () => {
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
    await initDir(secretsDir)
    process.env.AGENT_WALLET_PASSWORD = TEST_PASSWORD
    const io1 = mockIO()
    await cmdAdd(secretsDir, io1, {
      walletType: 'local_secure',
      walletId: 'w1',
      generate: true,
    })

    const io2 = mockIO()
    await expect(
      cmdAdd(secretsDir, io2, {
        walletType: 'local_secure',
        walletId: 'w1',
        generate: true,
      }),
    ).rejects.toThrow(CliExit)
    expect(io2.output.some((l) => l.includes('already exists'))).toBe(true)
    delete process.env.AGENT_WALLET_PASSWORD
  })
})

describe('password retry behavior', () => {
  it('retries interactively on wrong password', async () => {
    // Create wallet with known password
    const io1 = mockIO()
    await cmdStart(secretsDir, io1, {
      walletType: 'local_secure',
      walletId: 'default',
      password: TEST_PASSWORD,
      generate: true,
    })

    // Second start: wrong password first, then correct
    const io2 = mockIO(['wrong_password', TEST_PASSWORD])
    await cmdStart(secretsDir, io2, {
      walletType: 'local_secure',
      walletId: 'w2',
      generate: true,
      override: true,
    })
    expect(io2.output.some((l) => l.includes('Wrong password'))).toBe(true)
  })

  it('exits immediately on wrong explicit -p password', async () => {
    const io1 = mockIO()
    await cmdStart(secretsDir, io1, {
      walletType: 'local_secure',
      walletId: 'default',
      password: TEST_PASSWORD,
      generate: true,
    })

    const io2 = mockIO()
    await expect(
      cmdStart(secretsDir, io2, {
        walletType: 'local_secure',
        walletId: 'w2',
        password: 'wrong_password',
        generate: true,
        override: true,
      }),
    ).rejects.toThrow(CliExit)
    expect(io2.output.some((l) => l.includes('Wrong password'))).toBe(true)
  })
})

describe('cmdAdd / active wallet', () => {
  beforeEach(async () => {
    await initDir(secretsDir)
  })

  it('adds local_secure wallet from generate shortcut', async () => {
    const io = mockIO()
    process.env.AGENT_WALLET_PASSWORD = TEST_PASSWORD
    await cmdAdd(secretsDir, io, {
      walletType: 'local_secure',
      walletId: 'my_key',
      generate: true,
    })

    expect(readConfig(secretsDir).wallets.my_key.type).toBe('local_secure')
    expect(existsSync(join(secretsDir, 'secret_my_key.json'))).toBe(true)
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

  it('errors when wallet type is missing for add', async () => {
    const io = mockIO()
    await expect(
      cmdAdd(secretsDir, io, {
        walletId: 'hot',
        privateKey: TEST_PRIVATE_KEY,
      }),
    ).rejects.toThrow(CliExit)
    expect(out(io)).toContain('Wallet type required')
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

  it('prompts for import source in add local_secure when no source flags are provided', async () => {
    process.env.AGENT_WALLET_PASSWORD = TEST_PASSWORD
    const io = mockIO(['generate'])
    await cmdAdd(secretsDir, io, {
      walletType: 'local_secure',
      walletId: 'interactive-local',
    })

    expect(existsSync(join(secretsDir, 'secret_interactive-local.json'))).toBe(true)
  })

  it('prompts for mnemonic material in add raw_secret when no source flags are provided', async () => {
    const io = mockIO(['mnemonic', TEST_MNEMONIC, '3'])
    await cmdAdd(secretsDir, io, {
      walletType: 'raw_secret',
      walletId: 'interactive-raw',
    })

    const config = readConfig(secretsDir)
    expect(config.wallets['interactive-raw'].params.source).toBe('mnemonic')
    expect(config.wallets['interactive-raw'].params.account_index).toBe(3)
  })

  it('use command sets active wallet', async () => {
    process.env.AGENT_WALLET_PASSWORD = TEST_PASSWORD
    await cmdAdd(secretsDir, mockIO(), {
      walletType: 'local_secure',
      walletId: 'w1',
      generate: true,
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
})

describe('cmdList / cmdInspect / cmdRemove', () => {
  beforeEach(async () => {
    await initDir(secretsDir)
    process.env.AGENT_WALLET_PASSWORD = TEST_PASSWORD
    await cmdAdd(secretsDir, mockIO(), {
      walletType: 'local_secure',
      walletId: 'local-one',
      generate: true,
    })
    await cmdAdd(secretsDir, mockIO(), {
      walletType: 'raw_secret',
      walletId: 'hot',
      privateKey: TEST_PRIVATE_KEY,
    })
  })

  it('list shows wallet id and type', async () => {
    const io = mockIO()
    await cmdList(secretsDir, io)
    expect(out(io)).toContain('local-one')
    expect(out(io)).toContain('raw_secret')
  })

  it('inspect shows local_secure details', async () => {
    const io = mockIO()
    await cmdInspect('local-one', secretsDir, io)
    expect(out(io)).toContain('Type        local_secure')
    expect(out(io)).toContain('secret_local-one.json')
  })

  it('inspect shows raw_secret details', async () => {
    const io = mockIO()
    await cmdInspect('hot', secretsDir, io)
    expect(out(io)).toContain('Type        raw_secret')
    expect(out(io)).toContain('Source Type private_key')
  })

  it('remove deletes local secure secret file', async () => {
    const io = mockIO()
    await cmdRemove('local-one', secretsDir, true, io)
    expect(existsSync(join(secretsDir, 'secret_local-one.json'))).toBe(false)
    expect(readConfig(secretsDir).wallets['local-one']).toBeUndefined()
  })

  it('remove prompts for confirmation and cancels when declined', async () => {
    const io = mockIO(['n'])
    await expect(cmdRemove('local-one', secretsDir, false, io)).rejects.toThrow(CliExit)
    expect(existsSync(join(secretsDir, 'secret_local-one.json'))).toBe(true)
    expect(out(io)).toContain('Cancelled.')
  })
})

describe('sign commands', () => {
  beforeEach(async () => {
    await initDir(secretsDir)
    process.env.AGENT_WALLET_PASSWORD = TEST_PASSWORD
    await cmdAdd(secretsDir, mockIO(), {
      walletType: 'local_secure',
      walletId: 'signer',
      generate: true,
    })
  })

  it('signs a message', async () => {
    const io = mockIO()
    await cmdSignMsg('signer', 'hello world', 'eip155:1', secretsDir, io)
    expect(out(io)).toContain('Signature:')
  })

  it('requires network', async () => {
    const io = mockIO()
    await expect(cmdSignMsg('signer', 'hello', undefined, secretsDir, io)).rejects.toThrow(CliExit)
    expect(out(io)).toContain('--network is required')
  })

  it('uses active wallet when wallet id omitted', async () => {
    const io = mockIO()
    await cmdSignMsg(undefined, 'hello', 'eip155:1', secretsDir, io)
    expect(out(io)).toContain('Signature:')
  })

  it('main parses --wallet-id for sign commands', async () => {
    const io = mockIO()
    const code = await main(
      ['sign', 'msg', 'hello world', '--wallet-id', 'signer', '--network', 'eip155:1', '-d', secretsDir],
      io,
    )
    expect(code).toBe(0)
    expect(out(io)).toContain('Signature:')
  })

  it('fails with friendly error for invalid runtime secrets', async () => {
    writeFileSync(join(secretsDir, 'runtime_secrets.json'), JSON.stringify(['bad']), 'utf-8')
    const io = mockIO()
    const code = await main(
      ['sign', 'msg', 'hello world', '--wallet-id', 'signer', '--network', 'eip155:1', '-d', secretsDir],
      io,
    )
    expect(code).toBe(1)
    expect(out(io)).toContain('Invalid runtime secrets:')
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
    const code = await main(['start', 'local_secure', '-d', secretsDir], io)
    expect(code).toBe(1)
    expect(out(io)).toContain('Invalid wallet config in')
  })
})

describe('change-password / reset', () => {
  beforeEach(async () => {
    await initDir(secretsDir)
    process.env.AGENT_WALLET_PASSWORD = TEST_PASSWORD
    await cmdAdd(secretsDir, mockIO(), {
      walletType: 'local_secure',
      walletId: 'signer',
      generate: true,
    })
  })

  it('change-password updates existing runtime secrets', async () => {
    const provider = new ConfigWalletProvider(secretsDir)
    provider.saveRuntimeSecrets(TEST_PASSWORD)

    const io = mockIO(['New-password-456!', 'New-password-456!'])
    await cmdChangePassword(secretsDir, io)

    const runtimeSecrets = JSON.parse(readFileSync(join(secretsDir, 'runtime_secrets.json'), 'utf-8'))
    expect(runtimeSecrets.password).toBe('New-password-456!')
  })

  it('change-password prompts for current password when no env or runtime secret exists', async () => {
    delete process.env.AGENT_WALLET_PASSWORD
    const io = mockIO([TEST_PASSWORD, 'New-password-456!', 'New-password-456!'])
    await cmdChangePassword(secretsDir, io)

    const provider = new ConfigWalletProvider(secretsDir, 'New-password-456!', {
      secretLoader: loadLocalSecret,
    })
    const wallet = await provider.getWallet('signer', 'eip155:1')
    expect(await wallet.getAddress()).toBeTruthy()
  })

  it('reset only deletes managed files', async () => {
    writeFileSync(join(secretsDir, 'custom.json'), '{}\n', 'utf-8')
    const io = mockIO()
    await cmdReset(secretsDir, true, io)

    expect(existsSync(join(secretsDir, 'master.json'))).toBe(false)
    expect(existsSync(join(secretsDir, 'wallets_config.json'))).toBe(false)
    expect(existsSync(join(secretsDir, 'custom.json'))).toBe(true)
  })

  it('reset prompts twice and cancels on the first rejection', async () => {
    const io = mockIO(['n'])
    await expect(cmdReset(secretsDir, false, io)).rejects.toThrow(CliExit)
    expect(existsSync(join(secretsDir, 'master.json'))).toBe(true)
    expect(out(io)).toContain('Cancelled.')
  })

  it('reset prompts twice and proceeds only after both confirmations', async () => {
    const io = mockIO(['y', 'y'])
    await cmdReset(secretsDir, false, io)
    expect(existsSync(join(secretsDir, 'master.json'))).toBe(false)
    expect(existsSync(join(secretsDir, 'wallets_config.json'))).toBe(false)
  })

  it('reset works for a raw_secret-only directory without master.json', async () => {
    for (const filename of ['master.json', 'secret_signer.json']) {
      const path = join(secretsDir, filename)
      if (existsSync(path)) unlinkSync(path)
    }

    saveConfig(secretsDir, {
      active_wallet: 'raw_wallet',
      wallets: {
        raw_wallet: {
          type: 'raw_secret',
          params: {
            source: 'private_key',
            private_key: TEST_PRIVATE_KEY,
          },
        },
      },
    })

    expect(existsSync(join(secretsDir, 'master.json'))).toBe(false)
    expect(existsSync(join(secretsDir, 'wallets_config.json'))).toBe(true)

    const ioReset = mockIO()
    await cmdReset(secretsDir, true, ioReset)

    expect(existsSync(join(secretsDir, 'wallets_config.json'))).toBe(false)
  })
})
