import { createRequire } from 'node:module'
import { EventEmitter, once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { PassThrough, type Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'

interface WsSocket extends EventEmitter {
  send(data: string): void
  close(code: number, reason: string): void
  terminate(): void
}

interface WsModule {
  Receiver: new (options: { maxFragments?: number; maxBufferedChunks?: number }) => Writable
  Sender: new (socket: PassThrough) => {
    close(code: number, reason: unknown, mask: boolean): void
  }
  WebSocket: new (url: string) => WsSocket
  WebSocketServer: new (options: { host: string; port: number }) => EventEmitter & {
    clients: Set<WsSocket>
    address(): AddressInfo
    close(callback: () => void): void
  }
}

// Resolve the implementations actually shipped through each dependency chain.
const require = createRequire(import.meta.url)
const viemRequire = createRequire(require.resolve('viem'))
const tronwebRequire = createRequire(require.resolve('tronweb'))
const ethersRequire = createRequire(tronwebRequire.resolve('ethers'))

async function receive(receiver: Writable, chunks: Buffer[]): Promise<Error | null | undefined> {
  receiver.on('error', () => {})
  try {
    for (const chunk of chunks) {
      const error = await new Promise<Error | null | undefined>((resolve) => {
        receiver.write(chunk, resolve)
      })
      if (error) return error
    }
  } finally {
    receiver.destroy()
  }
}

describe.each([
  { path: 'viem → ws', ws: viemRequire('ws') as WsModule },
  { path: 'tronweb → ethers → ws', ws: ethersRequire('ws') as WsModule },
])('$path security regressions', ({ ws }) => {
  it('bounds tiny fragments independently of payload size', async () => {
    const error = await receive(new ws.Receiver({ maxFragments: 2 }), [
      Buffer.from([0x01, 0x01, 0x61]),
      Buffer.from([0x00, 0x01, 0x62]),
      Buffer.from([0x80, 0x01, 0x63]),
    ])
    expect(error).toMatchObject({ code: 'WS_ERR_TOO_MANY_BUFFERED_PARTS' })
  })

  it('bounds tiny chunks inside an incomplete frame', async () => {
    const error = await receive(new ws.Receiver({ maxBufferedChunks: 2 }), [
      Buffer.from([0x82, 0x05]),
      Buffer.from('a'),
      Buffer.from('b'),
      Buffer.from('c'),
    ])
    expect(error).toMatchObject({ code: 'WS_ERR_TOO_MANY_BUFFERED_PARTS' })
  })

  it('preserves fragmented messages within the configured limit', async () => {
    const receiver = new ws.Receiver({ maxFragments: 2, maxBufferedChunks: 2 })
    const messages: string[] = []
    receiver.on('message', (data: Buffer) => messages.push(data.toString()))
    const error = await receive(receiver, [
      Buffer.from([0x01, 0x01, 0x61]),
      Buffer.from([0x80, 0x01, 0x62]),
      Buffer.from([0x01, 0x01, 0x63]),
      Buffer.from([0x80, 0x01, 0x64]),
    ])
    expect(error).toBeUndefined()
    expect(messages).toEqual(['ab', 'cd'])
  })

  it('preserves real local WebSocket message and close handshakes', async () => {
    const server = new ws.WebSocketServer({ host: '127.0.0.1', port: 0 })
    let client: WsSocket | undefined
    try {
      await once(server, 'listening')
      server.on('connection', (socket: WsSocket) => {
        socket.on('message', (data: Buffer) => socket.send(data.toString()))
      })
      client = new ws.WebSocket(`ws://127.0.0.1:${server.address().port}`)
      await once(client, 'open')
      const message = once(client, 'message')
      client.send('wallet-rpc-control')
      expect((await message)[0].toString()).toBe('wallet-rpc-control')
      const closed = once(client, 'close')
      client.close(1000, 'ok')
      const [code, reason] = await closed
      expect(code).toBe(1000)
      expect(reason.toString()).toBe('ok')
    } finally {
      client?.terminate()
      for (const socket of server.clients) socket.terminate()
      await new Promise<void>((resolve) => server.close(resolve))
    }
  })

  it('rejects a Float32Array close reason before sending bytes', () => {
    const socket = new PassThrough()
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    try {
      expect(() => new ws.Sender(socket).close(1000, new Float32Array(20), false)).toThrow(
        TypeError,
      )
      expect(chunks).toEqual([])
    } finally {
      socket.destroy()
    }
  })

  it.each(['ok', new Uint8Array([0x6f, 0x6b])])(
    'preserves supported string and Uint8Array close reasons: %s',
    (reason) => {
      const socket = new PassThrough()
      const chunks: Buffer[] = []
      socket.on('data', (chunk: Buffer) => chunks.push(chunk))
      try {
        new ws.Sender(socket).close(1000, reason, false)
        expect(Buffer.concat(chunks)).toEqual(Buffer.from([0x88, 0x04, 0x03, 0xe8, 0x6f, 0x6b]))
      } finally {
        socket.destroy()
      }
    },
  )
})
