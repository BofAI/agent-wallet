import { unlinkSync } from 'node:fs'
import { join } from 'node:path'

import { type Eip712Capable, type MessageSigningCapable } from '../core/base.js'
import type { WalletConfig } from '../core/config.js'
import { WalletError } from '../core/errors.js'
import { getProvider, managedJsonFiles } from './cli.js'
import { CliExit, confirmInput, selectInput, type CliIO } from './cli-io.js'
import { printDetailRows } from './cli-output.js'

export async function cmdList(dir: string, io: CliIO): Promise<void> {
  const provider = getProvider(dir)
  const rows = provider.listWallets()

  if (rows.length === 0) {
    io.print('No wallets configured.')
    return
  }

  const cm = 1 // marker column
  const c1 = Math.max('Wallet ID'.length, ...rows.map(([wid]) => wid.length))
  const c2 = Math.max('Type'.length, ...rows.map(([, conf]) => conf.type.length))
  const hr = (l: string, m1: string, m2: string, r: string) =>
    `${l}${'─'.repeat(cm + 2)}${m1}${'─'.repeat(c1 + 2)}${m2}${'─'.repeat(c2 + 2)}${r}`
  io.print('Wallets:')
  io.print(hr('┌', '┬', '┬', '┐'))
  io.print(`│ ${' '.padEnd(cm)} │ ${'Wallet ID'.padEnd(c1)} │ ${'Type'.padEnd(c2)} │`)
  io.print(hr('├', '┼', '┼', '┤'))

  for (const [wid, conf, isActive] of rows) {
    const marker = isActive ? '*' : ' '
    io.print(`│ ${marker.padEnd(cm)} │ ${wid.padEnd(c1)} │ ${conf.type.padEnd(c2)} │`)
  }
  io.print(hr('└', '┴', '┴', '┘'))
}

export async function cmdInspect(walletId: string, dir: string, io: CliIO): Promise<void> {
  const provider = getProvider(dir)
  let conf: WalletConfig
  try {
    conf = provider.getWalletConfig(walletId)
  } catch {
    io.print(`Wallet '${walletId}' not found.`)
    throw new CliExit(1)
  }

  const rows: [string, string][] = [
    ['Wallet', walletId],
    ['Type', conf.type],
  ]
  if (conf.type === 'raw_secret') {
    const params = conf.params
    rows.push(['Source Type', params.source])
    if (params.source === 'private_key') {
      rows.push(['Private Key', '[redacted]'])
    } else if (params.source === 'mnemonic') {
      rows.push(['Mnemonic', '[redacted]'])
      rows.push(['Account Index', String(params.account_index)])
    }
  } else if (conf.type === 'privy') {
    rows.push(['Privy App ID', '[redacted]'])
    rows.push(['Privy App Secret', '[redacted]'])
    rows.push(['Privy Wallet ID', '[redacted]'])
  } else if (conf.type === 'wallet_cli') {
    const params = conf.params
    rows.push(['Account', params.account ?? '(active)'])
    rows.push(['Keystore Password', '[redacted]'])
  }
  printDetailRows(io, rows)
}

export async function cmdResolveAddress(
  walletId: string | undefined,
  dir: string,
  io: CliIO,
): Promise<void> {
  const { resolveWalletAddresses } = await import('../core/address-resolution.js')
  const provider = getProvider(dir)
  let targetId = walletId
  if (!targetId) {
    const rows = provider.listWallets()
    if (rows.length === 0) {
      io.print('No wallets configured.')
      throw new CliExit(1)
    }
    const choices = rows.map(([wid]) => wid)
    const descriptions = Object.fromEntries(
      rows.map(([wid, conf, isActive]) => [wid, `${conf.type}${isActive ? ' (active)' : ''}`]),
    )
    targetId = await selectInput(
      io,
      'Select wallet to resolve',
      choices,
      descriptions,
      choices[0],
      'wallet selection',
    )
  }
  let conf: WalletConfig
  try {
    conf = provider.getWalletConfig(targetId)
  } catch {
    io.print(`Wallet '${targetId}' not found.`)
    throw new CliExit(1)
  }

  const result = await resolveWalletAddresses(conf)

  const rows: [string, string][] = [
    ['Wallet', targetId],
    ['Type', conf.type],
  ]
  if (result.mode === 'single') {
    rows.push([result.entries[0].label, result.entries[0].address])
    printDetailRows(io, rows)
    return
  }

  printDetailRows(io, rows)
  io.print('')
  io.print('Addresses')
  printDetailRows(
    io,
    result.entries.map((entry) => [entry.label, entry.address]),
  )
}

export async function cmdRemove(
  walletId: string | undefined,
  dir: string,
  yes: boolean,
  io: CliIO,
): Promise<void> {
  const provider = getProvider(dir)
  const activeBefore = provider.getActiveId()
  let targetId = walletId
  if (!targetId) {
    const rows = provider.listWallets()
    if (rows.length === 0) {
      io.print('No wallets configured.')
      throw new CliExit(1)
    }
    const choices = rows.map(([wid]) => wid)
    const descriptions = Object.fromEntries(
      rows.map(([wid, conf, isActive]) => [wid, `${conf.type}${isActive ? ' (active)' : ''}`]),
    )
    targetId = await selectInput(
      io,
      'Select wallet to remove',
      choices,
      descriptions,
      choices[0],
      'wallet removal selection',
    )
  }
  try {
    provider.getWalletConfig(targetId)
  } catch {
    io.print(`Wallet '${targetId}' not found.`)
    throw new CliExit(1)
  }

  if (!yes) {
    const confirmed = await confirmInput(
      io,
      `PERMANENTLY delete wallet '${targetId}'? This cannot be undone and the wallet configuration will be removed immediately.`,
      false,
      'wallet removal confirmation',
    )
    if (!confirmed) {
      io.print('Cancelled.')
      throw new CliExit(0)
    }
  }

  provider.removeWallet(targetId)
  io.print(`Wallet '${targetId}' removed.`)

  if (activeBefore === targetId) {
    const rows = provider.listWallets()
    if (rows.length > 0 && io.interactive !== false) {
      const reassign = await selectInput(
        io,
        'Removed the active wallet. Select a new active wallet now?',
        ['yes', 'no'],
        {
          yes: 'Choose a replacement active wallet',
          no: 'Leave active wallet unset',
        },
        'yes',
        'active wallet reassignment',
      )
      if (reassign === 'yes') {
        const choices = rows.map(([wid]) => wid)
        const descriptions = Object.fromEntries(
          rows.map(([wid, walletConf]) => [wid, walletConf.type]),
        )
        const newActive = await selectInput(
          io,
          'Select new active wallet',
          choices,
          descriptions,
          choices[0],
          'new active wallet selection',
        )
        provider.setActive(newActive)
        io.print(`Active wallet: ${newActive}`)
      }
    }
  }
}

export async function cmdUse(walletId: string, dir: string, io: CliIO): Promise<void> {
  const provider = getProvider(dir)
  let targetId = walletId
  if (!targetId) {
    const rows = provider.listWallets()
    if (rows.length === 0) {
      io.print('No wallets configured.')
      throw new CliExit(1)
    }
    const choices = rows.map(([wid]) => wid)
    const descriptions = Object.fromEntries(
      rows.map(([wid, conf, isActive]) => [wid, `${conf.type}${isActive ? ' (active)' : ''}`]),
    )
    const selected = await selectInput(
      io,
      'Select wallet',
      choices,
      descriptions,
      choices[0],
      'wallet selection',
    )
    targetId = selected
  }
  try {
    const conf = provider.setActive(targetId)
    io.print(`Active wallet: ${targetId} (${conf.type})`)
  } catch {
    io.print(`Wallet '${targetId}' not found.`)
    throw new CliExit(1)
  }
}

function resolveWalletId(explicit: string | undefined, dir: string, io: CliIO): string {
  if (explicit) return explicit
  const provider = getProvider(dir)
  if (!provider.isInitialized()) {
    io.print("Wallet config not initialized. Run 'agent-wallet start' first.")
    throw new CliExit(1)
  }
  const activeId = provider.getActiveId()
  if (activeId) return activeId
  io.print(
    "No wallet specified and no active wallet set. Use '--wallet-id <id>' or 'agent-wallet use [id]'.",
  )
  throw new CliExit(1)
}

// --- Sign subcommands ---

export async function cmdSignTx(
  wallet: string | undefined,
  payload: string,
  network: string | undefined,
  dir: string,
  io: CliIO,
): Promise<void> {
  const walletId = resolveWalletId(wallet, dir, io)
  const provider = getProvider(dir)

  try {
    const txData = JSON.parse(payload)
    const w = await provider.getWallet(walletId, network)
    const signed = await w.signTransaction(txData)
    if (signed.family === 'tron') {
      io.print('Signed tx:')
      io.print(JSON.stringify(signed.transaction, null, 2))
    } else {
      io.print(`Signed tx: ${signed.rawTransaction}`)
    }
  } catch (e) {
    if (e instanceof WalletError || e instanceof SyntaxError) {
      io.print((e as Error).message)
      throw new CliExit(1)
    }
    if (e instanceof Error) {
      io.print(e.message)
      throw new CliExit(1)
    }
    throw e
  }
}

export async function cmdSignTypedData(
  wallet: string | undefined,
  data: string,
  network: string | undefined,
  dir: string,
  io: CliIO,
): Promise<void> {
  const walletId = resolveWalletId(wallet, dir, io)
  const provider = getProvider(dir)

  try {
    const w = await provider.getWallet(walletId, network)
    if (!('signTypedData' in w)) {
      io.print('This wallet does not support EIP-712 signing.')
      throw new CliExit(1)
    }
    const typedData = JSON.parse(data)
    const signature = await (w as unknown as Eip712Capable).signTypedData(typedData)
    io.print(`Signature: ${signature}`)
  } catch (e) {
    if (e instanceof WalletError || e instanceof SyntaxError) {
      io.print((e as Error).message)
      throw new CliExit(1)
    }
    if (e instanceof Error) {
      io.print(e.message)
      throw new CliExit(1)
    }
    throw e
  }
}

export async function cmdSignMessage(
  wallet: string | undefined,
  message: string,
  network: string | undefined,
  dir: string,
  io: CliIO,
): Promise<void> {
  const walletId = resolveWalletId(wallet, dir, io)
  const provider = getProvider(dir)

  try {
    const w = await provider.getWallet(walletId, network)
    if (!('signMessage' in w)) {
      io.print('This wallet does not support message signing.')
      throw new CliExit(1)
    }
    const signature = await (w as unknown as MessageSigningCapable).signMessage(
      new TextEncoder().encode(message),
    )
    io.print(`Signature: ${signature}`)
  } catch (e) {
    if (e instanceof WalletError) {
      io.print(e.message)
      throw new CliExit(1)
    }
    if (e instanceof Error) {
      io.print(e.message)
      throw new CliExit(1)
    }
    throw e
  }
}

// --- Reset Command ---

export async function cmdReset(dir: string, yes: boolean, io: CliIO): Promise<void> {
  const files = managedJsonFiles(dir)
  if (files.length === 0) {
    io.print('No wallet data found in: ' + dir)
    throw new CliExit(1)
  }

  io.print(`This will delete ALL wallet data in: ${dir}`)
  io.print(`   ${files.length} file(s): ${files.join(', ')}`)
  io.print('')

  if (!yes) {
    const confirmed = await confirmInput(
      io,
      'Are you sure you want to reset? This cannot be undone.',
      false,
      'wallet reset confirmation',
    )
    if (!confirmed) {
      io.print('Cancelled.')
      throw new CliExit(0)
    }
    const confirmed2 = await confirmInput(
      io,
      'Really delete everything? Last chance!',
      false,
      'wallet reset confirmation',
    )
    if (!confirmed2) {
      io.print('Cancelled.')
      throw new CliExit(0)
    }
  }

  for (const f of files) {
    unlinkSync(join(dir, f))
    io.print(`  Deleted: ${f}`)
  }
  io.print('')
  io.print('Wallet data reset complete.')
}
