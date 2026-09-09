import { describe, expect, it } from 'vitest'

describe('module load smoke', () => {
  it('loads local signer modules and public exports without circular init issues', async () => {
    const advanced = await import('../src/advanced.js')
    const { LocalSigner } = await import('../src/core/adapters/local.js')
    const { RawSecretSigner } = await import('../src/core/adapters/raw-secret.js')

    expect(advanced.LocalSigner).toBe(LocalSigner)
    expect(advanced.RawSecretSigner).toBe(RawSecretSigner)

    const raw = new RawSecretSigner(
      {
        source: 'private_key',
        private_key: '0x' + '11'.repeat(32),
      },
      'tron:728126428',
    )

    expect(raw).toBeInstanceOf(LocalSigner)
    await expect(raw.getAddress()).resolves.toMatch(/^T/)
  })
})
