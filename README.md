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
- **EIP-712 typed data** — Full support for structured data signing (x402, Permit2, etc.)
- **Local / Remote modes** — Same interface whether keys are local or proxied via HTTP
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
│   WalletFactory → LocalProvider / RemoteProvider │
│   BaseWallet: sign_message · sign_transaction    │
│               sign_raw · sign_typed_data         │
│   Adapters:  EvmWallet · TronWallet · Remote     │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│              Secret Layer                        │
│   SecureKVStore — Keystore V3 encrypt/decrypt    │
│   scrypt (N=262144) + AES-128-CTR + keccak MAC   │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│              Storage Layer                       │
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

### Python

```bash
pip install agent-wallet[tron]
```

```python
from agent_wallet import WalletFactory

provider = WalletFactory(secrets_dir="~/.agent-wallet", password="my-password")
wallet = await provider.get_wallet("my-tron-wallet")

address = await wallet.get_address()
signature = await wallet.sign_message(b"Hello from agent-wallet!")
```

### TypeScript

```bash
npm install @bankofai/agent-wallet
```

```typescript
import { WalletFactory } from "@bankofai/agent-wallet";

const provider = WalletFactory({
  secretsDir: "~/.agent-wallet",
  password: "my-password",
});
const wallet = await provider.getWallet("my-evm-wallet");

const address = await wallet.getAddress();
const signature = await wallet.signMessage(new TextEncoder().encode("Hello!"));
```

### CLI

Both Python and TypeScript packages include a CLI with the same commands.

**TypeScript (npm)**

```bash
npm install -g @bankofai/agent-wallet

agent-wallet init
agent-wallet add
agent-wallet list
agent-wallet use my-wallet          # set active wallet
agent-wallet sign msg --message "Hello"   # signs with active wallet
agent-wallet sign msg --wallet other --message "Hello"  # override active
```

**Python (pip)**

```bash
pip install agent-wallet[cli]

agent-wallet init
agent-wallet add
agent-wallet list
agent-wallet use my-wallet          # set active wallet
agent-wallet sign msg --message "Hello"   # signs with active wallet
agent-wallet sign msg --wallet other --message "Hello"  # override active
```

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
- Password is discarded from memory after provider initialization
- No private keys are ever sent over the network (in Local mode)

## Examples

| Example | Python | TypeScript |
|---|---|---|
| Sign & broadcast TRON tx | [tron_sign_and_broadcast.py](./packages/python/examples/tron_sign_and_broadcast.py) | [tron-sign-and-broadcast.ts](./packages/typescript/examples/tron-sign-and-broadcast.ts) |
| Sign & broadcast BSC tx | [bsc_sign_and_broadcast.py](./packages/python/examples/bsc_sign_and_broadcast.py) | [bsc-sign-and-broadcast.ts](./packages/typescript/examples/bsc-sign-and-broadcast.ts) |
| EIP-712 typed data (x402) | [x402_sign_typed_data.py](./packages/python/examples/x402_sign_typed_data.py) | [x402-sign-typed-data.ts](./packages/typescript/examples/x402-sign-typed-data.ts) |
| Switch active wallet (SDK) | [switch_active_wallet.py](./packages/python/examples/switch_active_wallet.py) | [switch-active-wallet.ts](./packages/typescript/examples/switch-active-wallet.ts) |

## Contributing

```bash
# Python
cd packages/python
pip install -e ".[all]"
pytest

# TypeScript
cd packages/typescript
pnpm install
pnpm test
```

## License

[MIT](./LICENSE) — BankOfAI
