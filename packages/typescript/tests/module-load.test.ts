import { describe, expect, it } from 'vitest'

describe('module load smoke', () => {
  it('loads local signer modules and public exports without circular init issues', async () => {
    const sdk = await import('../src/index.js')
    const { LocalSigner } = await import('../src/core/adapters/local.js')
    const { LocalSecureSigner } = await import('../src/core/adapters/local-secure.js')
    const { RawSecretSigner } = await import('../src/core/adapters/raw-secret.js')

    expect(sdk.LocalSigner).toBe(LocalSigner)
    expect(sdk.LocalSecureSigner).toBe(LocalSecureSigner)
    expect(sdk.RawSecretSigner).toBe(RawSecretSigner)

    const secure = new LocalSecureSigner({ secret_ref: 'secure' }, '.', 'pw', 'eip155:1', () =>
      Uint8Array.from(Buffer.from('11'.repeat(32), 'hex')),
    )
    const raw = new RawSecretSigner(
      {
        source: 'private_key',
        private_key: '0x' + '11'.repeat(32),
      },
      'tron',
    )

    expect(secure).toBeInstanceOf(LocalSigner)
    expect(raw).toBeInstanceOf(LocalSigner)
    await expect(secure.getAddress()).resolves.toMatch(/^0x/i)
    await expect(raw.getAddress()).resolves.toMatch(/^T/)
  })
})
