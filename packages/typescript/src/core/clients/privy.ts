import { PrivyAuthError, PrivyRateLimitError, PrivyRequestError } from '../errors.js'

export type PrivyClientConfig = {
  appId: string
  appSecret: string
  retries?: number
  sleep?: (ms: number) => Promise<void>
}

export type PrivyRpcMethod =
  | 'personal_sign'
  | 'eth_signTransaction'
  | 'eth_signTypedData_v4'
  | 'raw_sign'

export type PrivyRpcParams = Record<string, unknown>

export type PrivyRpcResponse = {
  data: {
    signature?: string
    signed_transaction?: string
  }
}

export type PrivyRawSignParams = {
  hash?: string
  bytes?: string
  encoding?: string
  hash_function?: string
}

export class PrivyClient {
  private readonly appId: string
  private readonly appSecret: string
  private readonly baseUrl: string
  private readonly retries: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(config: PrivyClientConfig) {
    this.appId = config.appId
    this.appSecret = config.appSecret
    this.baseUrl = 'https://api.privy.io'
    this.retries = config.retries ?? 2
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async getWallet(walletId: string): Promise<{ address: string; chainType: string }> {
    const result = await this.request('GET', `/v1/wallets/${walletId}`)
    const data = readDataObject(result)
    if (!data?.address) {
      throw new PrivyRequestError('Privy wallet response missing address')
    }
    return { address: data.address, chainType: data.chain_type ?? '' }
  }

  async rpc(
    walletId: string,
    method: PrivyRpcMethod,
    params: PrivyRpcParams,
    options?: PrivyRequestOptions,
  ): Promise<PrivyRpcResponse> {
    return this.request(
      'POST',
      `/v1/wallets/${walletId}/rpc`,
      {
      method,
      params,
      },
      options,
    ) as Promise<PrivyRpcResponse>
  }

  async rawSign(
    walletId: string,
    params: PrivyRawSignParams,
    options?: PrivyRequestOptions,
  ): Promise<PrivyRpcResponse> {
    return this.request(
      'POST',
      `/v1/wallets/${walletId}/raw_sign`,
      {
        params,
      },
      options,
    ) as Promise<PrivyRpcResponse>
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    options?: PrivyRequestOptions,
  ): Promise<unknown> {
    let attempt = 0
    while (true) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.buildHeaders(options),
        body: body ? JSON.stringify(body) : undefined,
      })

      if (response.status === 429) {
        if (attempt >= this.retries) {
          throw new PrivyRateLimitError('Privy rate limit exceeded')
        }
        attempt += 1
        await this.sleep(backoffMs(attempt))
        continue
      }

      const payload = await readJson(response)
      if (!response.ok) {
        const message =
          extractErrorMessage(payload) ?? `Privy request failed with status ${response.status}`
        if (response.status === 401 || response.status === 403) {
          throw new PrivyAuthError(message)
        }
        throw new PrivyRequestError(message)
      }

      return payload
    }
  }

  private buildHeaders(options?: PrivyRequestOptions): Record<string, string> {
    const auth = Buffer.from(`${this.appId}:${this.appSecret}`).toString('base64')
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Basic ${auth}`,
      'privy-app-id': this.appId,
    }
    if (options?.authorizationSignature) {
      headers['privy-authorization-signature'] = options.authorizationSignature
    }
    return headers
  }
}

export type PrivyRequestOptions = {
  authorizationSignature?: string
}

function backoffMs(attempt: number): number {
  return Math.min(1000, 200 * attempt)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function readDataObject(payload: unknown): { address?: string; chain_type?: string } | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.data && typeof record.data === 'object') {
    return record.data as { address?: string; chain_type?: string }
  }
  if ('address' in record || 'chain_type' in record) {
    return record as { address?: string; chain_type?: string }
  }
  return null
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  if (record.error && typeof record.error === 'object') {
    const error = record.error as Record<string, unknown>
    if (typeof error.message === 'string') return error.message
  }
  if (typeof record.message === 'string') return record.message
  return undefined
}
