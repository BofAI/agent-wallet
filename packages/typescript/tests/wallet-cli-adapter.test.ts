import { describe, it, expect, vi } from 'vitest'
import { WalletCliAdapter } from '../src/core/adapters/wallet-cli.js'
import { UnsupportedOperationError, WalletError } from '../src/core/errors.js'
import type { WalletCliClient } from '../src/core/clients/wallet-cli.js'

function mockClient(): WalletCliClient {
  return {
    currentAccount: vi.fn(),
    signTransaction: vi.fn(),
    signMessage: vi.fn(),
    signTypedData: vi.fn(),
    run: vi.fn(),
  } as unknown as WalletCliClient
}

const CONFIG = { account: 'main-1', password: 'Abc12345!@' }
const TRON_ADDRESS = 'TMSgJxtPw29AFEHMXsjGo4kWV7UwbCToHJ'

describe('WalletCliAdapter', () => {
  describe('getAddress', () => {
    it('returns the TRON address from currentAccount', async () => {
      const client = mockClient()
      ;(client.currentAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        command: 'current',
        data: {
          accountId: 'wlt_1.0',
          label: 'main-1',
          type: 'seed',
          index: 0,
          active: true,
          addresses: { tron: TRON_ADDRESS },
        },
      })

      const signer = new WalletCliAdapter(CONFIG, client)
      const addr = await signer.getAddress()
      expect(addr).toBe(TRON_ADDRESS)
      expect(client.currentAccount).toHaveBeenCalledWith('main-1')
    })

    it('caches the address on repeated calls', async () => {
      const client = mockClient()
      ;(client.currentAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        command: 'current',
        data: {
          accountId: 'wlt_1.0',
          label: 'main-1',
          type: 'seed',
          index: 0,
          active: true,
          addresses: { tron: TRON_ADDRESS },
        },
      })

      const signer = new WalletCliAdapter(CONFIG, client)
      await signer.getAddress()
      await signer.getAddress()
      expect(client.currentAccount).toHaveBeenCalledTimes(1)
    })

    it('defaults to TRON when no network is given', async () => {
      const client = mockClient()
      ;(client.currentAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        command: 'current',
        data: {
          accountId: 'wlt_1.0',
          label: 'main-1',
          type: 'seed',
          index: 0,
          active: true,
          addresses: { tron: TRON_ADDRESS },
        },
      })

      const signer = new WalletCliAdapter(CONFIG, client)
      const addr = await signer.getAddress()
      expect(addr).toBe(TRON_ADDRESS)
    })

    it('selects TRON address for tron network', async () => {
      const client = mockClient()
      ;(client.currentAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        command: 'current',
        data: {
          accountId: 'wlt_1.0',
          label: 'main-1',
          type: 'seed',
          index: 0,
          active: true,
          addresses: { tron: TRON_ADDRESS, evm: '0xabc' },
        },
      })

      const signer = new WalletCliAdapter(CONFIG, client, 'tron:nile')
      const addr = await signer.getAddress()
      expect(addr).toBe(TRON_ADDRESS)
    })

    it('throws WalletError for EVM address not yet supported', async () => {
      const client = mockClient()
      ;(client.currentAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        command: 'current',
        data: {
          accountId: 'wlt_1.0',
          label: 'main-1',
          type: 'seed',
          index: 0,
          active: true,
          addresses: { tron: TRON_ADDRESS },
        },
      })

      const signer = new WalletCliAdapter(CONFIG, client, 'eip155:56')
      await expect(signer.getAddress()).rejects.toThrow(WalletError)
      await expect(signer.getAddress()).rejects.toThrow('EVM')
    })
  })

  describe('signTransaction', () => {
    it('returns JSON string of the signed tx', async () => {
      const client = mockClient()
      const signedTx = { txID: 'abc', raw_data_hex: 'deadbeef', signature: ['rsv123'] }
      ;(client.signTransaction as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        command: 'tx.sign',
        data: {
          kind: 'sign',
          mode: 'sign-only',
          address: TRON_ADDRESS,
          txId: 'abc',
          signed: signedTx,
        },
      })

      const signer = new WalletCliAdapter(CONFIG, client)
      const result = await signer.signTransaction({ raw_data_hex: 'deadbeef' })
      expect(JSON.parse(result)).toEqual(signedTx)
      expect(client.signTransaction).toHaveBeenCalledWith(
        JSON.stringify({ raw_data_hex: 'deadbeef' }),
        'Abc12345!@',
        'main-1',
      )
    })
  })

  describe('signMessage', () => {
    it('strips 0x prefix from signature', async () => {
      const client = mockClient()
      ;(client.signMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        command: 'message.sign',
        data: { address: TRON_ADDRESS, message: 'hello', signature: '0x9f3cabcd' },
      })

      const signer = new WalletCliAdapter(CONFIG, client)
      const sig = await signer.signMessage(Buffer.from('hello'))
      expect(sig).toBe('9f3cabcd')
      expect(sig).not.toMatch(/^0x/)
    })

    it('converts Uint8Array to UTF-8 text', async () => {
      const client = mockClient()
      ;(client.signMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        command: 'message.sign',
        data: { address: TRON_ADDRESS, message: 'hello', signature: '0x9f3c' },
      })

      const signer = new WalletCliAdapter(CONFIG, client)
      await signer.signMessage(new Uint8Array([104, 101, 108, 108, 111]))
      expect(client.signMessage).toHaveBeenCalledWith('hello', 'Abc12345!@', 'main-1')
    })
  })

  describe('signTypedData', () => {
    it('strips 0x prefix from signature', async () => {
      const client = mockClient()
      ;(client.signTypedData as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        command: 'typed-data.sign',
        data: {
          address: TRON_ADDRESS,
          primaryType: 'Order',
          digest: '0x0a8d',
          signature: '0x8cba1234',
        },
      })

      const signer = new WalletCliAdapter(CONFIG, client)
      const sig = await signer.signTypedData({
        domain: {},
        types: {},
        primaryType: 'Order',
        message: {},
      })
      expect(sig).toBe('8cba1234')
      expect(sig).not.toMatch(/^0x/)
    })
  })

  describe('signRaw', () => {
    it('throws UnsupportedOperationError', async () => {
      const client = mockClient()
      const signer = new WalletCliAdapter(CONFIG, client)
      await expect(signer.signRaw(new Uint8Array([1, 2, 3]))).rejects.toThrow(
        UnsupportedOperationError,
      )
    })
  })
})
