# agent-wallet (TypeScript)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
![Node](https://img.shields.io/badge/node-≥18-blue.svg)

Universal multi-chain secure signing SDK for AI agents — TypeScript implementation.

Signing-only by design: handles key storage and signing locally, with no RPC or network dependencies. The caller builds and broadcasts transactions.

## Install

```bash
npm install @bankofai/agent-wallet
# or
pnpm add @bankofai/agent-wallet
```

**Requires Node.js ≥ 18**

## Quick Start

```typescript
import { WalletFactory } from "@bankofai/agent-wallet";

// Initialize provider (decrypts keys, then discards password)
const provider = WalletFactory({
  secretsDir: "~/.agent-wallet",
  password: "my-password",
});

// List available wallets
const wallets = await provider.listWallets();
for (const w of wallets) {
  console.log(`${w.id} (${w.type})`);
}

// Get a wallet and sign
const wallet = await provider.getWallet("my-wallet");
const address = await wallet.getAddress();
const signature = await wallet.signMessage(
  new TextEncoder().encode("Hello from agent-wallet!"),
);
```

## API Reference

### WalletFactory

```typescript
import { WalletFactory } from "@bankofai/agent-wallet";

// Local mode — keys stored on disk, encrypted with Keystore V3
const provider = WalletFactory({
  secretsDir: "/path/to/secrets",
  password: "master-pw",
});

// Remote mode — proxy signing to a remote agent-wallet server
const provider = WalletFactory({
  remoteUrl: "https://signer.example.com",
  token: "bearer-token",
});
```

### BaseWallet

All wallet adapters (EVM, TRON) implement the same interface:

```typescript
interface BaseWallet {
  getAddress(): Promise<string>;
  signRaw(rawTx: Uint8Array): Promise<string>;
  signTransaction(payload: Record<string, unknown>): Promise<string>;
  signMessage(msg: Uint8Array): Promise<string>;
}

interface Eip712Capable {
  signTypedData(data: Record<string, unknown>): Promise<string>;
}
```

All signing methods return hex-encoded signature strings (no `0x` prefix).

### EVM Signing

```typescript
const wallet = await provider.getWallet("my-evm-wallet");

// Sign arbitrary message (EIP-191 personal sign)
const sig = await wallet.signMessage(new TextEncoder().encode("Hello"));

// Sign EIP-712 typed data
const sig = await wallet.signTypedData({
  types: {
    EIP712Domain: [{ name: "name", type: "string" }, /* ... */],
    Transfer: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  primaryType: "Transfer",
  domain: { name: "MyDApp", version: "1", chainId: 1 },
  message: { to: "0x...", amount: 1000000 },
});

// Sign a pre-built transaction object
const sig = await wallet.signTransaction({
  to: "0x...",
  value: 0n,
  gas: 21000n,
  maxFeePerGas: 20000000000n,
  // ...
});
```

### TRON Signing

```typescript
const wallet = await provider.getWallet("my-tron-wallet");

// Sign message (keccak256 + secp256k1, no Ethereum prefix)
const sig = await wallet.signMessage(new TextEncoder().encode("Hello"));

// Sign a pre-built unsigned transaction from TronGrid
// The caller builds the tx via TronGrid API, SDK only signs
const signedJson = await wallet.signTransaction({
  txID: "abc123...",
  raw_data_hex: "0a02...",
  raw_data: { /* ... */ },
});

// Sign EIP-712 typed data (same secp256k1 curve as EVM)
const sig = await wallet.signTypedData({ /* ... */ });
```

### Direct Adapter Usage

You can also use wallet adapters directly without the provider layer:

```typescript
import { EvmWallet, TronWallet } from "@bankofai/agent-wallet";

// EVM wallet from raw private key
const evmWallet = new EvmWallet(privateKeyBytes);
const sig = await evmWallet.signMessage(data);

// TRON wallet from raw private key
const tronWallet = new TronWallet(privateKeyBytes);
const address = await tronWallet.getAddress(); // Returns T... base58 address
```

### Error Handling

```typescript
import {
  WalletNotFoundError,
  SigningError,
  DecryptionError,
} from "@bankofai/agent-wallet";

try {
  const wallet = await provider.getWallet("nonexistent");
} catch (e) {
  if (e instanceof WalletNotFoundError) {
    console.log("Wallet not found");
  }
}
```

Error hierarchy:

```
WalletError
├── WalletNotFoundError
├── DecryptionError
├── SigningError
├── NetworkError
├── InsufficientBalanceError
└── UnsupportedOperationError
```

## Supported Wallet Types

| Type | Chains | Signing Library |
|---|---|---|
| `evm_local` | Ethereum, BSC, Polygon, Base, Arbitrum, any EVM | viem |
| `tron_local` | TRON Mainnet, Nile, Shasta | @noble/curves + bs58check |

## Dependencies

| Package | Purpose |
|---|---|
| [viem](https://viem.sh/) | EVM signing, EIP-712, keccak256 |
| [@noble/curves](https://github.com/paulmillr/noble-curves) | secp256k1 ECDSA for TRON signing |
| [bs58check](https://github.com/bitcoinjs/bs58check) | TRON base58check address encoding |
| [zod](https://zod.dev/) | Runtime schema validation |

## Examples

- [tron-sign-and-broadcast.ts](./examples/tron-sign-and-broadcast.ts) — Build tx via TronGrid, sign with SDK, broadcast
- [bsc-sign-and-broadcast.ts](./examples/bsc-sign-and-broadcast.ts) — Build BSC testnet tx, sign with SDK, broadcast
- [x402-sign-typed-data.ts](./examples/x402-sign-typed-data.ts) — EIP-712 typed data signing for x402 PaymentPermit

## Security

- **Keystore V3** — scrypt (N=262144, r=8, p=1) + AES-128-CTR + keccak256 MAC
- **Password not retained** — Discarded after provider initialization
- **No network calls** — All signing is pure local computation
- **Sentinel verification** — Master password correctness verified before key decryption

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Type check
pnpm lint

# Build
pnpm build
```

## Cross-Language Compatibility

This TypeScript SDK is fully compatible with the [Python implementation](../python/):
- Same keystore file format (files are interchangeable)
- Same signatures for same key + data
- Same address derivation

## License

[MIT](../../LICENSE) — BankOfAI
