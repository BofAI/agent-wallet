# agent-wallet (TypeScript)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
![Node](https://img.shields.io/badge/node-≥18-blue.svg)

Universal multi-chain signing SDK for AI agents — TypeScript implementation.

## Install

```bash
npm install @bankofai/agent-wallet
# or
pnpm add @bankofai/agent-wallet
```

Includes CLI (`agent-wallet`), EVM and TRON support.

## Quick Start

```ts
import { resolveWallet } from "@bankofai/agent-wallet";

const wallet = await resolveWallet({ network: "tron:nile" });
const signature = await wallet.signMessage(new TextEncoder().encode("hello"));
```

`resolveWallet` automatically finds your wallet config in `~/.agent-wallet` (or `AGENT_WALLET_DIR`).

## Public API

```ts
import {
  resolveWallet,          // → Wallet (one-shot)
  resolveWalletProvider,  // → ConfigWalletProvider | EnvWalletProvider
  ConfigWalletProvider,   // file-backed provider (local_secure / raw_secret)
  EnvWalletProvider,      // env-var-backed provider (AGENT_WALLET_PRIVATE_KEY)
} from "@bankofai/agent-wallet";
```

### resolveWallet

Returns a ready-to-sign `Wallet` for the given network:

```ts
const wallet = await resolveWallet({ network: "eip155:1" });
const sig = await wallet.signTransaction({ to: "0x...", value: 0 });
```

### resolveWalletProvider

Returns either `ConfigWalletProvider` or `EnvWalletProvider` based on what's available:

```ts
const provider = resolveWalletProvider({ network: "eip155:1" });

// Get the active wallet
const wallet = await provider.getActiveWallet();

// Or a specific wallet (ConfigWalletProvider only)
const wallet2 = await provider.getWallet("my_wallet", "tron:nile");
```

### Provider resolution order

1. Password available (from `runtime_secrets.json` or `AGENT_WALLET_PASSWORD`) → `ConfigWalletProvider`
2. `wallets_config.json` exists with wallets → `ConfigWalletProvider`
3. Otherwise → `EnvWalletProvider` (reads `AGENT_WALLET_PRIVATE_KEY` / `AGENT_WALLET_MNEMONIC`)

## Wallet Interface

```ts
interface Wallet {
  getAddress(): Promise<string>;
  signRaw(rawTx: Uint8Array): Promise<string>;
  signTransaction(payload: Record<string, unknown>): Promise<string>;
  signMessage(msg: Uint8Array): Promise<string>;
}

interface Eip712Capable {
  signTypedData(data: Record<string, unknown>): Promise<string>;
}
```

Both EVM and TRON network-specific signers implement `Wallet` + `Eip712Capable`.

## Network Routing

| Network string | Adapter | Mnemonic derivation |
|---|---|---|
| `eip155` or `eip155:<chainId>` | EVM | `m/44'/60'/0'/0/{index}` |
| `tron` or `tron:<chain>` | TRON | `m/44'/195'/0'/0/{index}` |

## Environment Variables

| Variable | Description |
|---|---|
| `AGENT_WALLET_DIR` | Wallet directory (default `~/.agent-wallet`) |
| `AGENT_WALLET_PASSWORD` | Password for `local_secure` wallets |
| `AGENT_WALLET_PRIVATE_KEY` | Env fallback private key (hex) |
| `AGENT_WALLET_MNEMONIC` | Env fallback mnemonic phrase |
| `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX` | Mnemonic account index (default `0`) |

## Examples

- [tron-sign-and-broadcast.ts](./examples/tron-sign-and-broadcast.ts)
- [bsc-sign-and-broadcast.ts](./examples/bsc-sign-and-broadcast.ts)
- [tron-x402-sign-typed-data.ts](./examples/tron-x402-sign-typed-data.ts)
- [bsc-x402-sign-typed-data.ts](./examples/bsc-x402-sign-typed-data.ts)
- [dual-sign-typed-data-from-private-key.ts](./examples/dual-sign-typed-data-from-private-key.ts)
- [switch-active-wallet.ts](./examples/switch-active-wallet.ts)

## Development

```bash
pnpm install
pnpm test
```

## License

[MIT](../../LICENSE) — BankOfAI
