import { randomBytes } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { keccak256 } from 'viem'
import { secp256k1 } from '@noble/curves/secp256k1'
import bs58check from 'bs58check'
import { TronSigner } from '../src/core/adapters/tron.js'
import { EvmSigner } from '../src/core/adapters/evm.js'

const TEST_KEY = Buffer.from(
  '4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b',
  'hex',
)

// Derive expected Tron address the same way tronpy does: 0x41 + ethAddress
const TEST_ETH_ACCOUNT = privateKeyToAccount(`0x${TEST_KEY.toString('hex')}`)
const TEST_ETH_ADDR_BYTES = Buffer.from(TEST_ETH_ACCOUNT.address.slice(2), 'hex')
const TEST_ADDRESS = bs58check.encode(Buffer.concat([Buffer.from([0x41]), TEST_ETH_ADDR_BYTES]))

function makeWallet(key?: Uint8Array, network?: string): TronSigner {
  return new TronSigner(key ?? TEST_KEY, network)
}

/** Manual ECDSA sign matching tronpy PrivateKey.sign_msg */
function tronpySign(data: Uint8Array, key: Uint8Array): string {
  const hash = keccak256(data)
  const hashBytes = Buffer.from(hash.slice(2), 'hex')
  const sig = secp256k1.sign(hashBytes, key)
  const r = sig.r.toString(16).padStart(64, '0')
  const s = sig.s.toString(16).padStart(64, '0')
  const v = (sig.recovery + 27).toString(16).padStart(2, '0')
  return r + s + v
}

const EIP712_DATA = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Transfer: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
    ],
  },
  primaryType: 'Transfer',
  domain: {
    name: 'TestProtocol',
    version: '1',
    chainId: 728126428, // Tron chainId
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: {
    to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    amount: 1000000,
    nonce: 0,
  },
}

const EIP712_NO_VERSION = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    PaymentPermitDetails: [
      { name: 'buyer', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
    ],
  },
  primaryType: 'PaymentPermitDetails',
  domain: {
    name: 'x402PaymentPermit',
    chainId: 728126428,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: {
    buyer: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    amount: 1000000,
    nonce: 0,
  },
}

// --- Address ---

describe('Address', () => {
  it('should return correct address', async () => {
    const wallet = makeWallet()
    const addr = await wallet.getAddress()
    expect(addr).toBe(TEST_ADDRESS)
  })

  it('should be base58 starting with T', async () => {
    const key = randomBytes(32)
    const wallet = new TronSigner(key)
    const addr = await wallet.getAddress()
    expect(addr.startsWith('T')).toBe(true)
    expect(addr.length).toBe(34)
  })

  it('should match manual derivation', async () => {
    const key = randomBytes(32)
    const wallet = new TronSigner(key)
    const account = privateKeyToAccount(`0x${key.toString('hex')}`)
    const ethAddrBytes = Buffer.from(account.address.slice(2), 'hex')
    const expected = bs58check.encode(Buffer.concat([Buffer.from([0x41]), ethAddrBytes]))
    expect(await wallet.getAddress()).toBe(expected)
  })
})

// --- signMessage ---

describe('signMessage', () => {
  it('should be deterministic', async () => {
    const wallet = makeWallet()
    const sig1 = await wallet.signMessage(Buffer.from('test message'))
    const sig2 = await wallet.signMessage(Buffer.from('test message'))
    expect(sig1).toBe(sig2)
  })

  it('should differ for different messages', async () => {
    const wallet = makeWallet()
    const sig1 = await wallet.signMessage(Buffer.from('message A'))
    const sig2 = await wallet.signMessage(Buffer.from('message B'))
    expect(sig1).not.toBe(sig2)
  })

  it('should match tronpy sign_msg', async () => {
    const key = randomBytes(32)
    const wallet = new TronSigner(key)
    const msg = Buffer.from('verify this tron message')
    const ourSig = await wallet.signMessage(msg)
    const expected = tronpySign(msg, key)
    expect(ourSig).toBe(expected)
  })

  it('should produce 65-byte signature', async () => {
    const wallet = makeWallet()
    const sigHex = await wallet.signMessage(Buffer.from('check length'))
    expect(Buffer.from(sigHex, 'hex').length).toBe(65)
  })
})

// --- signRaw ---

describe('signRaw', () => {
  it('should be deterministic', async () => {
    const wallet = makeWallet()
    const raw = randomBytes(64)
    const sig1 = await wallet.signRaw(raw)
    const sig2 = await wallet.signRaw(raw)
    expect(sig1).toBe(sig2)
  })

  it('should match tronpy sign_msg', async () => {
    const key = randomBytes(32)
    const wallet = new TronSigner(key)
    const rawData = randomBytes(32)
    const ourSig = await wallet.signRaw(rawData)
    const expected = tronpySign(rawData, key)
    expect(ourSig).toBe(expected)
  })
})

describe('signTransaction validation', () => {
  it('rejects non-hex txID', async () => {
    const wallet = makeWallet()
    await expect(wallet.signTransaction({ txID: 'not-hex', raw_data_hex: 'abcd' })).rejects.toThrow(
      /txID must be a 32-byte hex string/,
    )
  })

  it('rejects short txID', async () => {
    const wallet = makeWallet()
    await expect(wallet.signTransaction({ txID: 'abcd', raw_data_hex: 'abcd' })).rejects.toThrow(
      /txID must be a 32-byte hex string/,
    )
  })
})

// --- signTypedData (EIP-712) ---

describe('signTypedData', () => {
  it('should produce recoverable signature', async () => {
    const key = randomBytes(32)
    const wallet = new TronSigner(key)
    const sigHex = await wallet.signTypedData(EIP712_DATA)
    // Verify it's a valid 65-byte signature
    expect(sigHex.length).toBe(130)
  })

  it('should match viem direct signing', async () => {
    const key = randomBytes(32)
    const wallet = new TronSigner(key)
    const account = privateKeyToAccount(`0x${key.toString('hex')}`)

    const ourSig = await wallet.signTypedData(EIP712_DATA)
    const { EIP712Domain, ...msgTypes } = EIP712_DATA.types
    const viemSig = await account.signTypedData({
      domain: EIP712_DATA.domain as any,
      types: msgTypes as any,
      primaryType: EIP712_DATA.primaryType,
      message: EIP712_DATA.message as any,
    })
    expect(ourSig).toBe(viemSig.slice(2))
  })

  it('should be deterministic', async () => {
    const wallet = makeWallet()
    const sig1 = await wallet.signTypedData(EIP712_DATA)
    const sig2 = await wallet.signTypedData(EIP712_DATA)
    expect(sig1).toBe(sig2)
  })
})

// --- x402 behavioral compatibility ---

describe('x402 compatibility', () => {
  it('should match x402 signing without version', async () => {
    const key = randomBytes(32)
    const wallet = new TronSigner(key)
    const account = privateKeyToAccount(`0x${key.toString('hex')}`)

    const ourSig = await wallet.signTypedData(EIP712_NO_VERSION)
    const viemSig = await account.signTypedData({
      domain: EIP712_NO_VERSION.domain as any,
      types: {
        PaymentPermitDetails: EIP712_NO_VERSION.types.PaymentPermitDetails,
      } as any,
      primaryType: 'PaymentPermitDetails',
      message: EIP712_NO_VERSION.message as any,
    })
    expect(ourSig).toBe(viemSig.slice(2))
  })

  it('should match x402 signing with version', async () => {
    const key = randomBytes(32)
    const wallet = new TronSigner(key)
    const account = privateKeyToAccount(`0x${key.toString('hex')}`)

    const ourSig = await wallet.signTypedData(EIP712_DATA)
    const viemSig = await account.signTypedData({
      domain: EIP712_DATA.domain as any,
      types: { Transfer: EIP712_DATA.types.Transfer } as any,
      primaryType: 'Transfer',
      message: EIP712_DATA.message as any,
    })
    expect(ourSig).toBe(viemSig.slice(2))
  })

  it('should produce recoverable signature without version', async () => {
    const key = randomBytes(32)
    const wallet = new TronSigner(key)
    const sigHex = await wallet.signTypedData(EIP712_NO_VERSION)
    expect(sigHex.length).toBe(130)
  })

  it('should match EVM wallet for no-version domain', async () => {
    const key = randomBytes(32)
    const evmWallet = new EvmSigner(key)
    const tronWallet = new TronSigner(key)

    const evmSig = await evmWallet.signTypedData(EIP712_NO_VERSION)
    const tronSig = await tronWallet.signTypedData(EIP712_NO_VERSION)
    expect(evmSig).toBe(tronSig)
  })
})

// --- Cross-key isolation ---

describe('Cross-key isolation', () => {
  it('should produce different signatures for different keys', async () => {
    const walletA = new TronSigner(randomBytes(32))
    const walletB = new TronSigner(randomBytes(32))

    const msg = Buffer.from('same message')
    const sigA = await walletA.signMessage(msg)
    const sigB = await walletB.signMessage(msg)
    expect(sigA).not.toBe(sigB)
  })
})

// --- EVM/Tron consistency ---

describe('EVM/Tron typed data consistency', () => {
  it('should produce identical signatures for same key', async () => {
    const key = randomBytes(32)
    const evmWallet = new EvmSigner(key)
    const tronWallet = new TronSigner(key)

    const evmSig = await evmWallet.signTypedData(EIP712_DATA)
    const tronSig = await tronWallet.signTypedData(EIP712_DATA)
    expect(evmSig).toBe(tronSig)
  })
})

// --- Cross-language test vectors (must match Python) ---

describe('Cross-language test vectors', () => {
  // Fixed key used by both TS and Python test suites
  // Signatures are deterministic — if Python produces different values, implementations diverge.

  it('should match hardcoded Transfer signature', async () => {
    const wallet = makeWallet()
    const sig = await wallet.signTypedData(EIP712_DATA)
    expect(sig).toBe(
      '22008ffd588b4b370146bfd2e23426a53f945e32f32e1d8d2443769b69272b9a5f7f0b85b3f447ed0c5bb3d683e8fc92f8180aeb74071198b5e9bec5dbe34e0e1c',
    )
  })

  it('should match hardcoded PermitSingle signature', async () => {
    const wallet = makeWallet()
    const sig = await wallet.signTypedData({
      domain: {
        name: 'Permit2',
        chainId: 728126428,
        verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        PermitDetails: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint160' },
          { name: 'expiration', type: 'uint48' },
          { name: 'nonce', type: 'uint48' },
        ],
        PermitSingle: [
          { name: 'details', type: 'PermitDetails' },
          { name: 'spender', type: 'address' },
          { name: 'sigDeadline', type: 'uint256' },
        ],
      },
      primaryType: 'PermitSingle',
      message: {
        details: {
          token: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          amount: '1000000',
          expiration: '1700000000',
          nonce: '0',
        },
        spender: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        sigDeadline: '1700000000',
      },
    })
    expect(sig).toBe(
      'b2d374f840a447528ec3b9cedf394ded8000bcb79e3e1b9715859126db7350a53b05e7dca620819143e68f3038726b539f674bbfeb50aad6db746f6d1e8083221c',
    )
  })

  it('should match hardcoded x402 PaymentPermit signature', async () => {
    const wallet = makeWallet()
    const sig = await wallet.signTypedData(EIP712_NO_VERSION)
    expect(sig).toBe(
      '790cdd6f8f4e827bd3619c627994922cbcb70e52f828f204ddc51a733de72ded1c6cd40aedbc3c4a522f920da060c6a97a08005d0db7ca5a69f4da585beaefdc1c',
    )
  })
})

// --- TronWeb cross-validation ---

describe('TronWeb signTypedData cross-validation', () => {
  // Permit2 PermitSingle — real-world EIP-712 structure from sun-protocol/permit2-sdk
  const PERMIT2_TYPES = {
    PermitDetails: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
    PermitSingle: [
      { name: 'details', type: 'PermitDetails' },
      { name: 'spender', type: 'address' },
      { name: 'sigDeadline', type: 'uint256' },
    ],
  }

  const PERMIT2_DOMAIN = {
    name: 'Permit2',
    chainId: 728126428,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as `0x${string}`,
  }

  const PERMIT_SINGLE_VALUE = {
    details: {
      token: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amount: '1000000',
      expiration: '1700000000',
      nonce: '0',
    },
    spender: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    sigDeadline: '1700000000',
  }

  it('should match TronWeb _signTypedData for PermitSingle', async () => {
    const { TronWeb } = await import('tronweb')
    const keyHex = TEST_KEY.toString('hex')
    const wallet = makeWallet()

    // TronWeb sign — auto-deduces primaryType
    const tw = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      privateKey: keyHex,
    })
    const tronWebSig = await tw.trx._signTypedData(
      PERMIT2_DOMAIN,
      PERMIT2_TYPES,
      PERMIT_SINGLE_VALUE,
    )

    // Our sign — explicit primaryType
    const ourSig = await wallet.signTypedData({
      domain: PERMIT2_DOMAIN,
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        ...PERMIT2_TYPES,
      },
      primaryType: 'PermitSingle',
      message: PERMIT_SINGLE_VALUE,
    })

    // TronWeb returns 0x-prefixed, ours is raw hex
    expect(ourSig).toBe(tronWebSig.replace(/^0x/, ''))
  })

  it('should match TronWeb for simple Transfer type', async () => {
    const { TronWeb } = await import('tronweb')
    const keyHex = TEST_KEY.toString('hex')
    const wallet = makeWallet()

    const tw = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      privateKey: keyHex,
    })

    const simpleTypes = {
      Transfer: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
      ],
    }
    const domain = {
      name: 'TestProtocol',
      version: '1',
      chainId: 728126428,
      verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as `0x${string}`,
    }
    const message = {
      to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amount: 1000000,
      nonce: 0,
    }

    const tronWebSig = await tw.trx._signTypedData(domain, simpleTypes, message)
    const ourSig = await wallet.signTypedData(EIP712_DATA)

    expect(ourSig).toBe(tronWebSig.replace(/^0x/, ''))
  })

  it('should match TronWeb for PermitBatch type', async () => {
    const { TronWeb } = await import('tronweb')
    const keyHex = TEST_KEY.toString('hex')
    const wallet = makeWallet()

    const tw = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      privateKey: keyHex,
    })

    const batchTypes = {
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
      PermitBatch: [
        { name: 'details', type: 'PermitDetails[]' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
    }

    const batchValue = {
      details: [
        {
          token: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          amount: '500000',
          expiration: '1700000000',
          nonce: '0',
        },
        {
          token: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
          amount: '300000',
          expiration: '1700000000',
          nonce: '1',
        },
      ],
      spender: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      sigDeadline: '1700000000',
    }

    const tronWebSig = await tw.trx._signTypedData(PERMIT2_DOMAIN, batchTypes, batchValue)

    const ourSig = await wallet.signTypedData({
      domain: PERMIT2_DOMAIN,
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        ...batchTypes,
      },
      primaryType: 'PermitBatch',
      message: batchValue,
    })

    expect(ourSig).toBe(tronWebSig.replace(/^0x/, ''))
  })
})
