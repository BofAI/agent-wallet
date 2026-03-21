import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DecryptionError } from '../src/core/errors.js'
import { SecureKVStore, decryptBytes, encryptBytes } from '../src/local/kv-store.js'

let secretsDir: string

beforeEach(() => {
  secretsDir = mkdtempSync(join(tmpdir(), 'agent-wallet-kv-test-'))
})

afterEach(() => {
  rmSync(secretsDir, { recursive: true, force: true })
})

function createStore(password = 'test-password-123'): SecureKVStore {
  const store = new SecureKVStore(secretsDir, password)
  store.initMaster()
  return store
}

describe('master password', () => {
  it('initializes and verifies', () => {
    const store = createStore()
    expect(store.verifyPassword()).toBe(true)
  })

  it('rejects wrong password', () => {
    createStore('correct-password')
    const wrongStore = new SecureKVStore(secretsDir, 'wrong-password')
    expect(() => wrongStore.verifyPassword()).toThrow(DecryptionError)
  })
})

describe('secret storage', () => {
  it('saves and loads secret roundtrip', () => {
    const store = createStore()
    const secret = randomBytes(32)
    store.saveSecret('wallet-a', secret)
    const loaded = store.loadSecret('wallet-a')
    expect(Buffer.from(loaded).equals(secret)).toBe(true)
  })

  it('uses secret_ file naming', () => {
    const store = createStore()
    store.saveSecret('wallet-a', randomBytes(16))
    expect(existsSync(join(secretsDir, 'secret_wallet-a.json'))).toBe(true)
  })

  it('accepts arbitrary secret length', () => {
    const store = createStore()
    const secret = Buffer.from('short-secret')
    store.saveSecret('shorty', secret)
    const loaded = store.loadSecret('shorty')
    expect(Buffer.from(loaded).toString('utf-8')).toBe('short-secret')
  })

  it('generates secret with default length 32', () => {
    const store = createStore()
    const secret = store.generateSecret('generated')
    expect(secret.length).toBe(32)
    expect(Buffer.from(store.loadSecret('generated')).equals(secret)).toBe(true)
  })

  it('generates secret with custom length', () => {
    const store = createStore()
    const secret = store.generateSecret('generated-8', { length: 8 })
    expect(secret.length).toBe(8)
  })
})

describe('credential storage', () => {
  it('roundtrips string credentials', () => {
    const store = createStore()
    store.saveCredential('api_key', 'my-secret-api-key')
    expect(store.loadCredential('api_key')).toBe('my-secret-api-key')
  })

  it('roundtrips object credentials', () => {
    const store = createStore()
    const cred = { api_key: 'abc123', api_secret: 'xyz789', extra: true }
    store.saveCredential('complex', cred)
    expect(store.loadCredential('complex')).toEqual(cred)
  })
})

describe('encrypt/decrypt helpers', () => {
  it('encrypts and decrypts roundtrip', () => {
    const plaintext = Buffer.from('hello world')
    const keystore = encryptBytes(plaintext, 'password')
    const decrypted = decryptBytes(keystore, 'password')
    expect(Buffer.compare(Buffer.from(decrypted), plaintext)).toBe(0)
  })

  it('rejects wrong password on decrypt', () => {
    const plaintext = Buffer.from('secret')
    const keystore = encryptBytes(plaintext, 'correct')
    expect(() => decryptBytes(keystore, 'wrong')).toThrow(DecryptionError)
  })

  it('produces keystore v3 structure', () => {
    const keystore = encryptBytes(Buffer.from('test'), 'pw')
    expect(keystore.version).toBe(3)
    expect(keystore.crypto.cipher).toBe('aes-128-ctr')
    expect(keystore.crypto.kdf).toBe('scrypt')
  })
})
