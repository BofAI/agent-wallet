import { describe, expect, it, vi } from 'vitest'

import { PrivyClient } from '../src/core/clients/privy.js'
import { PrivyRateLimitError, PrivyRequestError } from '../src/core/errors.js'

function mockResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('PrivyClient', () => {
  it('includes required auth headers', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, { data: { signature: '0xabc' } }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new PrivyClient({
      appId: 'app-id',
      appSecret: 'app-secret',
    })

    await client.rpc('wallet-1', 'personal_sign', { message: '0x01' })

    const [, init] = fetchMock.mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers['privy-app-id']).toBe('app-id')
    expect(headers['authorization']).toMatch(/^Basic /)

    globalThis.fetch = originalFetch
  })

  it('calls raw_sign endpoint', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, { data: { signature: '0xabc' } }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new PrivyClient({
      appId: 'app-id',
      appSecret: 'app-secret',
    })

    await client.rawSign('wallet-1', { hash: '0x01' })
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/v1/wallets/wallet-1/raw_sign')

    globalThis.fetch = originalFetch
  })

  it('retries on 429 responses and returns on success', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(429, { error: { message: 'rate limit' } }))
      .mockResolvedValueOnce(mockResponse(200, { data: { signature: '0xabc' } }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new PrivyClient({
      appId: 'app-id',
      appSecret: 'app-secret',
      retries: 1,
      sleep: async () => {},
    })

    const res = await client.rpc('wallet-1', 'personal_sign', { message: '0x01' })
    expect(res.data.signature).toBe('0xabc')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    globalThis.fetch = originalFetch
  })

  it('throws on non-retryable errors', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(500, { error: { message: 'oops' } }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new PrivyClient({
      appId: 'app-id',
      appSecret: 'app-secret',
      retries: 0,
      sleep: async () => {},
    })

    await expect(
      client.rpc('wallet-1', 'personal_sign', { message: '0x01' }),
    ).rejects.toBeInstanceOf(PrivyRequestError)

    globalThis.fetch = originalFetch
  })

  it('throws a rate limit error when retries are exhausted', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(429, { error: { message: 'rate limit' } }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new PrivyClient({
      appId: 'app-id',
      appSecret: 'app-secret',
      retries: 0,
      sleep: async () => {},
    })

    await expect(
      client.rpc('wallet-1', 'personal_sign', { message: '0x01' }),
    ).rejects.toBeInstanceOf(PrivyRateLimitError)

    globalThis.fetch = originalFetch
  })
})
