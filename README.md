<p align="center">
  <h1 align="center">agent-wallet</h1>
  <p align="center">Universal multi-chain secure signing SDK for AI agents</p>
</p>

<p align="center">
  <a href="https://github.com/BofAI/agent-wallet/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/python-≥3.10-blue.svg" alt="Python">
  <img src="https://img.shields.io/badge/node-≥18-blue.svg" alt="Node">
</p>

---

**agent-wallet** is a signing-only SDK that lets AI agents (MCP servers, autonomous workflows, etc.) manage and use blockchain keys securely. It handles key storage and transaction/message signing — the caller is responsible for building transactions and broadcasting them.

Available in both **Python** and **TypeScript** with identical interfaces and cross-compatible outputs (same key produces same signatures in both languages).

## Features

- **Multi-chain** — EVM (Ethereum, BSC, Polygon, Base, Arbitrum) and TRON via unified `BaseWallet` interface
- **Signing-only** — Pure local signing; no network calls, no RPC dependencies
- **Keystore V3 encryption** — Private keys encrypted at rest with scrypt + AES-128-CTR
- **Password strength enforcement** — Master password requires 8+ chars, uppercase, lowercase, digit, and special character
- **Active wallet** — Set a default wallet with `agent-wallet use <id>` to skip `--wallet` on every command
- **Env-driven wallet selection** — `resolveWalletProvider()` can resolve local, EVM, or TRON wallets directly from environment variables
- **EIP-712 typed data** — Full support for structured data signing (x402, Permit2, etc.)
- **Dual language** — Python and TypeScript SDKs with identical API and cross-compatible keystore format
- **CLI included** — Key management and signing from the command line (Python & TypeScript)

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Delivery Layer                      │
│         CLI  ·  MCP Server  ·  SDK Embed         │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│              Wallet Core Layer                   │
│   resolveWalletProvider → LocalWalletProvider    │
│                 → StaticWalletProvider           │
│   BaseWallet: sign_message · sign_transaction    │
│               sign_raw · sign_typed_data         │
│   Adapters:  EvmWallet · TronWallet              │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│           Local Infrastructure (local/)          │
│   SecureKVStore — Keystore V3 encrypt/decrypt    │
│   scrypt (N=262144) + AES-128-CTR + keccak MAC   │
│   wallets_config.json · id_*.json · cred_*.json  │
│   master.json (password sentinel)                │
└─────────────────────────────────────────────────┘
```

## Packages

| Package | Path | Language | Status |
|---|---|---|---|
| [agent-wallet (Python)](./packages/python/) | `packages/python/` | Python ≥ 3.10 | ✅ SDK + CLI |
| [@bankofai/agent-wallet (TypeScript)](./packages/typescript/) | `packages/typescript/` | Node.js ≥ 18 | ✅ SDK + CLI |

## Quick Start

### TypeScript

```bash
$ npm install @bankofai/agent-wallet
$ export AGENT_WALLET_PRIVATE_KEY=YOUR_PRIVATE_KEY
```

```typescript
import { resolveWalletProvider } from "@bankofai/agent-wallet";

const provider = resolveWalletProvider({ network: "eip155:1" });
const wallet = await provider.getActiveWallet();

const address = await wallet.getAddress();
const signature = await wallet.signMessage(new TextEncoder().encode("Hello!"));
```

### SDK Environment

Available environment variables:

| Variable | Required | Description |
|---|---|---|
| `AGENT_WALLET_PASSWORD` | local mode | Enables local wallet mode |
| `AGENT_WALLET_DIR` | optional | Secrets directory, default `~/.agent-wallet` |
| `AGENT_WALLET_PRIVATE_KEY` | static mode | Single-wallet private key |
| `AGENT_WALLET_MNEMONIC` | static mode | Single-wallet mnemonic |

Configuration modes:

| Mode | Required configuration | Optional configuration |
|---|---|---|
| `local` | `AGENT_WALLET_PASSWORD` | `AGENT_WALLET_DIR` |
| `tron static` | `network="tron"` or `network="tron:..."` and exactly one of `AGENT_WALLET_PRIVATE_KEY` / `AGENT_WALLET_MNEMONIC` | none |
| `evm static` | `network="eip155"` or `network="eip155:..."` and exactly one of `AGENT_WALLET_PRIVATE_KEY` / `AGENT_WALLET_MNEMONIC` | none |

Resolution rules:

- `AGENT_WALLET_PASSWORD` takes precedence over `AGENT_WALLET_PRIVATE_KEY` / `AGENT_WALLET_MNEMONIC`
- `AGENT_WALLET_PRIVATE_KEY` and `AGENT_WALLET_MNEMONIC` cannot both be set
- `network` is required for single-wallet mode
- `network: "tron"` and `network: "tron:..."` use the TRON adapter
- `network: "eip155"` and `network: "eip155:..."` use the EVM adapter
- TRON mnemonic derivation uses `m/44'/195'/0'/0/0`

### CLI

One command to get started:

```bash
# TypeScript
$ npm install -g @bankofai/agent-wallet
```

```bash
$ agent-wallet start -p YOUR_PASSWORD -i WALLET_TYPE
```

For Example:

```bash
$ agent-wallet start -p Abc12345! -i tron
```

```
🔐 Wallet initialized!
✔ Paste private key (hex)

🪙 Imported wallet:
┌──────────────────────┬─────────────────┬──────────────────────────────────────────────┐
│ Wallet ID            │ Type            │ Address                                      │
├──────────────────────┼─────────────────┼──────────────────────────────────────────────┤
│ default_tron         │ tron_local      │ TNmoJ3Be59WFEq5dsW6eCkZjveiL3G8HVB           │
└──────────────────────┴─────────────────┴──────────────────────────────────────────────┘

⭐ Active wallet: default_tron

💡 Quick guide:
   agent-wallet list              — View your wallets
   agent-wallet sign tx '{...}'   — Sign a transaction
   agent-wallet start -h          — See all options
```

Now you can sign:

```bash
$ agent-wallet sign msg "Hello" -p Abc12345!
$ agent-wallet sign tx '{"txID":"..."}' -p Abc12345!
```

Or use an environment variable to skip the password prompt:

```bash
$ export AGENT_WALLET_PASSWORD="Abc12345!"
$ agent-wallet sign msg "Hello"
```

For the full CLI reference, see [Getting Started](./doc/getting-started.md).

## Signing-Only Design

agent-wallet deliberately does **not** build or broadcast transactions. This separation means:

1. **SDK signs** — `wallet.sign_transaction(unsigned_tx)` takes a pre-built transaction and returns the signature
2. **Caller builds & broadcasts** — Use TronGrid, Infura, Alchemy, or any RPC to construct and send transactions

```python
# Example: TRON transaction flow
# 1. Caller builds unsigned tx via TronGrid REST API
unsigned_tx = await build_trx_transfer(trongrid_url, from_addr, to_addr, amount)

# 2. SDK signs (pure local, no network)
signed_tx_json = await wallet.sign_transaction(unsigned_tx)

# 3. Caller broadcasts
txid = await broadcast_transaction(signed_tx, trongrid_url)
```

This design keeps the SDK lightweight, auditable, and free of RPC provider lock-in.

## Cross-Language Compatibility

Both Python and TypeScript implementations produce identical outputs:

- **Same keystore format** — Files created by Python can be read by TypeScript and vice versa
- **Same signatures** — Same private key + same data = same signature, regardless of language
- **Same addresses** — Identical key derivation for both EVM and TRON chains

## Security

- Private keys are encrypted at rest using **Keystore V3** (scrypt + AES-128-CTR)
- Master password is verified via a sentinel value — never stored in plaintext
- **Password strength enforced** — Minimum 8 characters with uppercase, lowercase, digit, and special character
- Password is discarded from memory after local provider initialization
- No private keys are ever sent over the network

## Examples

| Example | Python | TypeScript |
|---|---|---|
| Sign & broadcast TRON tx | [tron_sign_and_broadcast.py](./packages/python/examples/tron_sign_and_broadcast.py) | [tron-sign-and-broadcast.ts](./packages/typescript/examples/tron-sign-and-broadcast.ts) |
| Sign & broadcast BSC tx | [bsc_sign_and_broadcast.py](./packages/python/examples/bsc_sign_and_broadcast.py) | [bsc-sign-and-broadcast.ts](./packages/typescript/examples/bsc-sign-and-broadcast.ts) |
| TRON x402 typed data | [tron_x402_sign_typed_data.py](./packages/python/examples/tron_x402_sign_typed_data.py) | [tron-x402-sign-typed-data.ts](./packages/typescript/examples/tron-x402-sign-typed-data.ts) |
| BSC x402 typed data | [bsc_x402_sign_typed_data.py](./packages/python/examples/bsc_x402_sign_typed_data.py) | [bsc-x402-sign-typed-data.ts](./packages/typescript/examples/bsc-x402-sign-typed-data.ts) |
| Switch active wallet (SDK) | [switch_active_wallet.py](./packages/python/examples/switch_active_wallet.py) | [switch-active-wallet.ts](./packages/typescript/examples/switch-active-wallet.ts) |

## Contributing

```bash
# Python
$ cd packages/python
$ pip install -e ".[all]"
$ pytest

# TypeScript
$ cd packages/typescript
$ pnpm install
$ pnpm test
```

## License

[MIT](./LICENSE) — BankOfAI
