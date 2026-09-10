import { describe, it, expect } from 'vitest'

import { ExternalSignerConfigResolver } from '../src/core/providers/external-signer-config.js'
import {
  WalletError,
  PrivyConfigError,
  PrivyRequestError,
  PrivyAuthError,
  PrivyRateLimitError,
  ExternalSignerError,
  ExternalSignerConfigError,
  ExternalSignerExecutionError,
} from '../src/core/errors.js'
import { WalletCliConfigError } from '../src/core/errors.js'

describe('ExternalSignerConfigResolver base', () => {
  it('normalizeValue trims and returns undefined for empty', () => {
    class TestResolver extends ExternalSignerConfigResolver<{ key: string }, { key?: string }> {
      resolve() {
        return { key: this.normalizeValue(this.source?.key) ?? '' }
      }
      testNormalize(v?: string) {
        return this.normalizeValue(v)
      }
    }
    const r = new TestResolver({ source: { key: '  hello  ' } })
    expect(r.testNormalize('  hello  ')).toBe('hello')
    expect(r.testNormalize('   ')).toBeUndefined()
    expect(r.testNormalize(undefined)).toBeUndefined()
  })

  it('requireFields detects missing required fields', () => {
    class TestResolver extends ExternalSignerConfigResolver<unknown, Record<string, unknown>> {
      resolve() {
        return {}
      }
      testRequire(merged: Record<string, unknown>, required: string[]) {
        return this.requireFields(merged, required)
      }
    }
    const r = new TestResolver({})
    expect(r.testRequire({ a: '1', b: undefined }, ['a', 'b', 'c'])).toEqual(['b', 'c'])
    expect(r.testRequire({ a: '1', b: '2' }, ['a', 'b'])).toEqual([])
  })
})

describe('Error hierarchy — Privy retrofit backward compatibility', () => {
  it('PrivyConfigError is instanceof ExternalSignerConfigError and WalletError', () => {
    const err = new PrivyConfigError('test')
    expect(err).toBeInstanceOf(ExternalSignerConfigError)
    expect(err).toBeInstanceOf(ExternalSignerError)
    expect(err).toBeInstanceOf(WalletError)
    expect(err.name).toBe('PrivyConfigError')
  })

  it('PrivyRequestError is instanceof ExternalSignerExecutionError and WalletError', () => {
    const err = new PrivyRequestError('test')
    expect(err).toBeInstanceOf(ExternalSignerExecutionError)
    expect(err).toBeInstanceOf(ExternalSignerError)
    expect(err).toBeInstanceOf(WalletError)
    expect(err.name).toBe('PrivyRequestError')
  })

  it('PrivyAuthError is instanceof ExternalSignerExecutionError', () => {
    const err = new PrivyAuthError('test')
    expect(err).toBeInstanceOf(ExternalSignerExecutionError)
    expect(err).toBeInstanceOf(WalletError)
  })

  it('PrivyRateLimitError is instanceof ExternalSignerExecutionError', () => {
    const err = new PrivyRateLimitError('test')
    expect(err).toBeInstanceOf(ExternalSignerExecutionError)
    expect(err).toBeInstanceOf(WalletError)
  })

  it('WalletCliConfigError is instanceof ExternalSignerConfigError', () => {
    const err = new WalletCliConfigError('test')
    expect(err).toBeInstanceOf(ExternalSignerConfigError)
    expect(err).toBeInstanceOf(ExternalSignerError)
    expect(err).toBeInstanceOf(WalletError)
  })

  it('ExternalSignerExecutionError has default code when omitted', () => {
    const err = new ExternalSignerExecutionError('test')
    expect(err.code).toBe('execution_error')
  })

  it('ExternalSignerExecutionError has explicit code when provided', () => {
    const err = new ExternalSignerExecutionError('test', 'rpc_error')
    expect(err.code).toBe('rpc_error')
  })
})
