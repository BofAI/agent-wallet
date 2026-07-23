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

> TRON-focused (BSC planned): the `wallet_cli` wallet type delegates TRON signing to the
> external [`@tron-walletcli/wallet-cli`](https://www.npmjs.com/package/@tron-walletcli/wallet-cli)
> binary. EVM and Privy are unaffected.

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
  resolveWallet,           // → Wallet (one-shot)
  resolveWalletProvider,   // → ConfigWalletProvider | EnvWalletProvider
  ConfigWalletProvider,    // file-backed provider (local_secure / raw_secret / privy / wallet_cli)
  EnvWalletProvider,       // env-var-backed provider (AGENT_WALLET_PRIVATE_KEY)
  WalletCliAdapter,         // TRON signing via wallet-cli subprocess
  WalletCliClient,         // raw wallet-cli transport (run/build/broadcast)
  ExternalSignerConfigResolver, // base class for external signer config resolvers
} from "@bankofai/agent-wallet";
```

wallet-cli chain-ops orchestration is exported from a subpath:

```ts
import {
  signAndBroadcast,
  buildTransfer,
  broadcast,
  getTxStatus,
} from "@bankofai/agent-wallet/integrations/wallet-cli";
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

## Wallet Types

| Type | Networks | Key source | Needs agent-wallet password |
|---|---|---|---|
| `local_secure` | EVM + TRON | Encrypted `secret_<id>.json` on disk | Yes |
| `raw_secret` | EVM + TRON | Plaintext key/mnemonic in config or env | No |
| `privy` | EVM + TRON | Privy WaaS (app credentials + wallet ID) | No |
| `wallet_cli` | TRON (BSC planned) | wallet-cli keystore (subprocess delegation) | No |

The `wallet_cli` password is a **wallet-cli keystore credential** stored in
`wallets_config.json` params — it is not the agent-wallet master password.
Configure via CLI (`agent-wallet add wallet_cli`) or directly in config.

## Network Routing

| Network string | Adapter | Mnemonic derivation |
|---|---|---|
| `eip155` or `eip155:<chainId>` | EVM | `m/44'/60'/0'/0/{index}` |
| `tron` or `tron:<chain>` | TRON (local_secure / raw_secret) | `m/44'/195'/0'/0/{index}` |

> `wallet_cli` wallets currently sign TRON via the wallet-cli binary,
> not via local key derivation — they are not affected by mnemonic routing.

## Environment Variables

| Variable | Description |
|---|---|
| `AGENT_WALLET_DIR` | Wallet directory (default `~/.agent-wallet`) |
| `AGENT_WALLET_PASSWORD` | Password for `local_secure` wallets |
| `AGENT_WALLET_WALLET_CLI_PATH` | Override wallet-cli binary path (default: auto-resolve from PATH) |
| `AGENT_WALLET_PRIVATE_KEY` | Env fallback private key (hex) |
| `AGENT_WALLET_MNEMONIC` | Env fallback mnemonic phrase |
| `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX` | Mnemonic account index (default `0`) |

`@tron-walletcli/wallet-cli` is an **optional peer dependency**. Install it
only when using `wallet_cli` wallets:

```bash
npm install @tron-walletcli/wallet-cli
```

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
