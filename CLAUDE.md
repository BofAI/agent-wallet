# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent-Wallet is a universal multi-chain secure signing SDK for AI agents. It provides wallet signing for TRON and EVM chains with a "sign-only" philosophy — transaction building and broadcasting are handled separately. Distributed as both a Python package (`bankofai-agent-wallet`) and TypeScript package (`@bankofai/agent-wallet`).

## Build & Test Commands

### TypeScript (`packages/typescript/`)
```bash
pnpm build              # Build with tsup (dual ESM/CJS)
pnpm test               # Run tests (vitest)
pnpm test:coverage      # Tests with v8 coverage (60% threshold)
pnpm lint               # tsc --noEmit && eslint src/
```

### Python (`packages/python/`)
```bash
pytest tests                              # Run all tests
pytest tests/test_evm_wallet.py -v        # Run a single test file
pytest tests -k "test_sign"              # Run tests matching pattern
ruff check src tests examples             # Lint
python -m build --no-isolation            # Build package
```

### Pre-commit
```bash
pre-commit run --all-files    # Run all hooks (ruff, prettier, trailing whitespace)
```

## Architecture

```
Provider Resolution → Signer → Signing
```

### Provider Resolution (`core/resolver.ts|py`)
Two providers, tried in order:
1. **ConfigWalletProvider** — file-backed encrypted wallets in `~/.agent-wallet/` (or `AGENT_WALLET_DIR`). Uses Keystore V3 encryption (scrypt + AES-128-CTR). Activated when password is available or `wallets_config.json` exists.
2. **EnvWalletProvider** — fallback to `AGENT_WALLET_PRIVATE_KEY` or `AGENT_WALLET_MNEMONIC` env vars.

### Network Signers (`core/adapters/`)
- **EvmSigner** — uses `viem` (TS) / `eth-account` (Python). Derivation: `m/44'/60'/0'/0/{index}`
- **TronSigner** — uses `@noble/curves` + `viem` (TS) / `tronpy` (Python). Derivation: `m/44'/195'/0'/0/{index}`

Both implement `Wallet` interface: `getAddress()`, `signRaw()`, `signTransaction()`, `signMessage()`, plus `Eip712Capable` mixin for typed data.

### Signer Hierarchy (`core/adapters/`)
- **LocalSigner** — base class: holds private key + network, delegates signing to `EvmSigner`/`TronSigner`
- **LocalSecureSigner** — decrypts from Keystore V3 via `secretLoader`, extends `LocalSigner`
- **RawSecretSigner** — resolves from plaintext private key or mnemonic, extends `LocalSigner`

### Key Interfaces (`core/base.ts|py`)
- `Network`: `"evm" | "tron"`
- `WalletType`: `"local_secure" | "raw_secret"`
- `Wallet`: signing interface
- `WalletProvider`: provides active wallet by network

### Storage (`local/kv-store.ts|py`)
Keystore V3 compatible encryption for wallet secrets. Encrypted files stored as `secret_<id>.json`.

### CLI (`delivery/cli.ts|py`)
TypeScript: custom readline + `@inquirer/prompts`. Python: Typer + Rich + questionary.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `AGENT_WALLET_DIR` | Wallet config directory (default: `~/.agent-wallet`) |
| `AGENT_WALLET_PASSWORD` | Master password for encrypted wallets |
| `AGENT_WALLET_PRIVATE_KEY` | Fallback private key (hex) |
| `AGENT_WALLET_MNEMONIC` | Fallback mnemonic phrase |
| `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX` | Derivation index (default: 0) |

## Dual-Language Implementation

Python and TypeScript implementations mirror each other structurally. When modifying core logic, changes should typically be applied to both languages. The Python CLI (`delivery/cli.py`) is significantly larger (~1000 lines) than the TypeScript equivalent.

## Validation

- TypeScript uses **Zod** for schema validation
- Python uses **Pydantic** for data models and validation

## CI

GitHub Actions (`.github/workflows/ci.yml`): Python 3.11 + Node 20/pnpm 9. Runs lint → test → build for both packages.
