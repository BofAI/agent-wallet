# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent-Wallet is a universal multi-chain secure signing SDK for AI agents. It provides wallet signing for TRON and EVM chains with a "sign-only" philosophy — transaction building and broadcasting are handled separately. Distributed as a TypeScript package (`@bankofai/agent-wallet`).

## Build & Test Commands

### TypeScript (`packages/typescript/`)
```bash
pnpm build              # Build with tsup (dual ESM/CJS)
pnpm test               # Run tests (vitest)
pnpm test:coverage      # Tests with v8 coverage (60% threshold)
pnpm lint               # tsc --noEmit && eslint src/
```

### Pre-commit
```bash
pre-commit run --all-files    # Run all hooks (prettier, trailing whitespace)
```

## Architecture

```
Provider Resolution → Signer → Signing
```

### Provider Resolution (`core/resolver.ts`)
Two providers, tried in order:
1. **ConfigWalletProvider** — file-backed encrypted wallets in `~/.agent-wallet/` (or `AGENT_WALLET_DIR`). Uses Keystore V3 encryption (scrypt + AES-128-CTR). Activated when password is available or `wallets_config.json` exists.
2. **EnvWalletProvider** — fallback to `AGENT_WALLET_PRIVATE_KEY` or `AGENT_WALLET_MNEMONIC` env vars.

### Network Signers (`core/adapters/`)
- **EvmSigner** — uses `viem`. Derivation: `m/44'/60'/0'/0/{index}`
- **TronSigner** — uses `@noble/curves` + `viem`. Derivation: `m/44'/195'/0'/0/{index}`

Both implement `Wallet` interface: `getAddress()`, `signRaw()`, `signTransaction()`, `signMessage()`, plus `Eip712Capable` mixin for typed data.

### Signer Hierarchy (`core/adapters/`)
- **LocalSigner** — base class: holds private key + network, delegates signing to `EvmSigner`/`TronSigner`
- **LocalSecureSigner** — decrypts from Keystore V3 via `secretLoader`, extends `LocalSigner`
- **RawSecretSigner** — resolves from plaintext private key or mnemonic, extends `LocalSigner`

### Key Interfaces (`core/base.ts`)
- `Network`: `"evm" | "tron"`
- `WalletType`: `"local_secure" | "raw_secret"`
- `Wallet`: signing interface
- `WalletProvider`: provides active wallet by network

### Storage (`local/kv-store.ts`)
Keystore V3 compatible encryption for wallet secrets. Encrypted files stored as `secret_<id>.json`.

### CLI (`delivery/cli.ts`)
TypeScript: custom readline + `@inquirer/prompts`.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `AGENT_WALLET_DIR` | Wallet config directory (default: `~/.agent-wallet`) |
| `AGENT_WALLET_PASSWORD` | Master password for encrypted wallets |
| `AGENT_WALLET_PRIVATE_KEY` | Fallback private key (hex) |
| `AGENT_WALLET_MNEMONIC` | Fallback mnemonic phrase |
| `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX` | Derivation index (default: 0) |

## Validation

- TypeScript uses **Zod** for schema validation

## CI

GitHub Actions (`.github/workflows/ci.yml`): Node 20/pnpm 9. Runs lint → test → build for the TypeScript package.
