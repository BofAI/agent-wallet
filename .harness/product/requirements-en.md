# Agent Wallet — Product Requirements Document

**Product:** Agent Wallet (bankofai-agent-wallet / @bankofai/agent-wallet)
**Version:** 2.3.0
**Organization:** BankOfAI
**License:** MIT
**Last Updated:** 2026-03-20

---

## 1. Product Overview

### 1.1 Purpose

Agent Wallet is a universal, multi-chain secure signing SDK for AI agents and applications. It serves as an adapter layer for agent wallets, capable of integrating with various agent wallet providers such as Privy. Currently supported providers:
  - Local wallet private key management Provider (Keystore V3)
  - Private key configuration wallet Provider

### 1.2 Core Philosophy

- **Sign-only** — the SDK signs transactions and messages; transaction building and broadcasting are the caller's responsibility.
- **Local-first** — all cryptographic operations happen on the client; no key material leaves the machine.
- **Minimal surface** — only essential crypto libraries are included to reduce dependency risk.

### 1.3 Target Users

- AI agent developers who need programmatic wallet signing
- MCP (Model Context Protocol) server builders who need a signing backend
- DeFi/Web3 developers building multi-chain automation

### 1.4 Distribution

| Platform | Package Name | Install Command |
|----------|-------------|-----------------|
| Python (PyPI) | `bankofai-agent-wallet` | `pip install bankofai-agent-wallet` |
| npm | `@bankofai/agent-wallet` | `npm install @bankofai/agent-wallet` |

---

## 2. Supported Networks

### 2.1 Network Families

| Network | Identifier Format | Examples | HD Derivation Path |
|---------|------------------|----------|-------------------|
| EVM | `eip155` or `eip155:<chainId>` | `eip155`, `eip155:1` (Ethereum), `eip155:56` (BSC), `eip155:97` (BSC testnet) | `m/44'/60'/0'/0/{index}` |
| TRON | `tron` or `tron:<network>` | `tron`, `tron:mainnet`, `tron:nile`, `tron:shasta` | `m/44'/195'/0'/0/{index}` |

### 2.2 Key Derivation

- **Source:** BIP-39 compliant mnemonic phrases (12, 15, 18, 21, or 24 words)
- **Method:** Hierarchical Deterministic (HD) wallet derivation
- **Account Index:** Configurable (default: 0)

---

## 3. Wallet Types & Storage

### 3.1 Local Secure (`local_secure`)

**Use case:** Production / long-term key management

- Private keys encrypted on disk using Keystore V3 format
- Encryption: scrypt (N=262144, r=8, p=1, dklen=32) + AES-128-CTR + Keccak256 MAC
- Storage location: `~/.agent-wallet/` (configurable via `AGENT_WALLET_DIR`)
- Requires master password for all signing operations

**Generated files:**

| File | Purpose |
|------|---------|
| `master.json` | Encrypted sentinel for password verification |
| `wallets_config.json` | Wallet registry (unencrypted metadata) |
| `secret_<id>.json` | Encrypted private key per wallet |
| `runtime_secrets.json` | (Optional) Plaintext password for convenience |

**Password requirements:**
- Minimum 8 characters
- At least 1 uppercase letter, 1 lowercase letter, 1 digit, 1 special character
- Auto-generated passwords: 16 random characters

### 3.2 Raw Secret (`raw_secret`)

**Use case:** Development / testing only

- Private key or mnemonic stored in plaintext in `wallets_config.json`
- No encryption applied
- Not suitable for production environments

### 3.3 Environment Variable Fallback (`EnvWalletProvider`)

**Use case:** CI/CD, containerized agents, quick testing

- No persistent storage; secrets provided at runtime via environment variables
- Falls back automatically when no config file is found

---

## 4. Signing Operations

### 4.1 Core Interface

All wallet adapters implement the `Wallet` interface:

| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `getAddress()` | — | Address string | Returns wallet public address (EVM: EIP-55 checksummed; TRON: Base58check) |
| `signMessage(msg)` | Byte array | Hex signature | Signs arbitrary message (EVM: EIP-191 wrapped; TRON: Keccak256 + ECDSA) |
| `signTransaction(payload)` | Transaction dict/object | Signed tx hex or JSON | Signs a transaction payload |
| `signRaw(rawTx)` | Byte array | Hex signature | Signs pre-serialized/pre-hashed bytes |

### 4.2 EIP-712 Typed Data Signing

All adapters also implement `Eip712Capable`:

| Method | Input | Output |
|--------|-------|--------|
| `signTypedData(data)` | EIP-712 structured data object | Hex signature |

**Input structure:**
```json
{
  "types": { "EIP712Domain": [...], "PrimaryType": [...] },
  "primaryType": "PrimaryType",
  "domain": { "name": "...", "chainId": ..., "verifyingContract": "0x..." },
  "message": { ... }
}
```

**Compatibility:** x402 PaymentPermit (EIP-712 domain without "version" field) is fully supported.

### 4.3 EVM Signing Details

- **Message signing:** EIP-191 personal sign
- **Transaction types:** Legacy (type 0), EIP-2930 (type 1), EIP-1559 (type 2)
- **Transaction output:** Raw signed hex, ready for `eth_sendRawTransaction`
- **Libraries:** viem (TypeScript), eth-account (Python)

### 4.4 TRON Signing Details

- **Message signing:** Keccak256 hash + secp256k1 ECDSA
- **Transaction input:** Unsigned tx from TronGrid API (`txID`, `raw_data_hex`, `raw_data`)
- **Transaction output:** JSON string with `signature` array appended
- **Libraries:** @noble/curves + viem (TypeScript), tronpy (Python)

### 4.5 Cross-Chain Signature Consistency

Same private key + same message = identical signature across EVM and TRON adapters. This enables cross-chain verification scenarios.

---

## 5. Provider Resolution

### 5.1 Resolution Order

When `resolveWallet()` or `resolveWalletProvider()` is called:

1. **ConfigWalletProvider** — activated if:
   - Password is available (env var or `runtime_secrets.json`), OR
   - `wallets_config.json` exists in the config directory
2. **EnvWalletProvider** — fallback if:
   - `AGENT_WALLET_PRIVATE_KEY` or `AGENT_WALLET_MNEMONIC` is set

### 5.2 Password Resolution Order (for `local_secure`)

1. `runtime_secrets.json` file (if present)
2. `AGENT_WALLET_PASSWORD` environment variable
3. Interactive prompt (CLI only)

---

## 6. SDK API

### 6.1 Primary Entry Points

**Python:**
```python
from agent_wallet import resolve_wallet, resolve_wallet_provider
from agent_wallet import ConfigWalletProvider, EnvWalletProvider
```

**TypeScript:**
```typescript
import { resolveWallet, resolveWalletProvider } from "@bankofai/agent-wallet";
import { ConfigWalletProvider, EnvWalletProvider } from "@bankofai/agent-wallet";
```

### 6.2 `resolveWallet(network)` → `Wallet`

Resolves and returns a ready-to-use wallet for the specified network. Async.

### 6.3 `resolveWalletProvider(network)` → `WalletProvider`

Returns a provider that can manage and retrieve multiple wallets.

### 6.4 ConfigWalletProvider Methods

| Method | Description |
|--------|-------------|
| `isInitialized()` | Check if `wallets_config.json` exists |
| `ensureStorage()` | Create config directory and files if missing |
| `listWallets()` | List all wallets with active status |
| `getWalletConfig(walletId)` | Get wallet configuration |
| `getActiveId()` | Get active wallet ID |
| `getActiveWallet(network?)` | Get active wallet instance (async) |
| `getWallet(walletId, network?)` | Get specific wallet instance (async) |
| `addWallet(walletId, config)` | Add a new wallet |
| `setActive(walletId)` | Set wallet as active |
| `removeWallet(walletId)` | Remove wallet and secret file |
| `hasSecretFile(walletId)` | Check if encrypted secret exists |
| `hasRuntimeSecrets()` | Check if `runtime_secrets.json` exists |
| `loadRuntimeSecretsPassword()` | Load password from `runtime_secrets.json` |
| `saveRuntimeSecrets(password)` | Persist password to `runtime_secrets.json` |

---

## 7. CLI Commands

Entry point: `agent-wallet` (both pip and npm installations)

### 7.1 Setup & Initialization

| Command | Description |
|---------|-------------|
| `start [wallet_type]` | Quick setup wizard: init + create default wallet |
| `init` | Initialize config directory and set master password (no wallet) |
| `add <wallet_type>` | Add wallet to existing initialized directory |

**Common options for setup commands:**

| Option | Description |
|--------|-------------|
| `--wallet-id, -w` | Wallet name |
| `--generate, -g` | Generate new private key |
| `--private-key, -k` | Import hex private key |
| `--mnemonic, -m` | Import BIP-39 mnemonic |
| `--mnemonic-index, -mi` | Account derivation index (default: 0) |
| `--derive-as` | `eip155` or `tron` (mnemonic mode) |
| `--password, -p` | Master password |
| `--save-runtime-secrets` | Persist password to `runtime_secrets.json` |
| `--dir, -d` | Override config directory |

### 7.2 Wallet Management

| Command | Description |
|---------|-------------|
| `list` | Display all wallets with active marker |
| `use <wallet_id>` | Set wallet as active |
| `inspect <wallet_id>` | Show wallet details |
| `remove <wallet_id>` | Delete wallet and secret file (prompts for confirmation) |

### 7.3 Signing Operations

| Command | Description |
|---------|-------------|
| `sign msg <message> -n NETWORK` | Sign a plain message |
| `sign tx '<json>' -n NETWORK` | Sign a transaction payload |
| `sign typed-data '<json>' -n NETWORK` | Sign EIP-712 typed data |

**Required option:** `-n, --network` (e.g., `eip155:1`, `tron:nile`)

**Optional options:** `--wallet-id`, `--password`, `--dir`, `--save-runtime-secrets`

### 7.4 Security Management

| Command | Description |
|---------|-------------|
| `change-password` | Change master password; re-encrypts all secrets |
| `reset` | Delete ALL wallet files (requires double confirmation) |

---

## 8. Environment Variables

| Variable | Type | Purpose | Default |
|----------|------|---------|---------|
| `AGENT_WALLET_DIR` | string | Config directory path | `~/.agent-wallet` |
| `AGENT_WALLET_PASSWORD` | string | Master password for encrypted wallets | — |
| `AGENT_WALLET_PRIVATE_KEY` | string | Private key for EnvWalletProvider | — |
| `AGENT_WALLET_MNEMONIC` | string | BIP-39 mnemonic for EnvWalletProvider | — |
| `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX` | int | Derivation index for mnemonic | `0` |

---

## 9. Configuration File Formats

### 9.1 wallets_config.json

```json
{
  "active_wallet": "wallet-id",
  "wallets": {
    "wallet-id": {
      "type": "local_secure",
      "params": {
        "secret_ref": "wallet-id"
      }
    },
    "raw-wallet": {
      "type": "raw_secret",
      "params": {
        "source": "private_key",
        "private_key": "0x..."
      }
    }
  }
}
```

### 9.2 secret_<id>.json (Keystore V3)

Encrypted JSON file containing private key material. Requires master password to decrypt.

### 9.3 runtime_secrets.json

```json
{
  "password": "..."
}
```

Optional convenience file. Created by `--save-runtime-secrets`. Auto-detected on next run.

---

## 10. Error Handling

| Error Class | Cause |
|-------------|-------|
| `WalletError` | Base error for all wallet operations |
| `WalletNotFoundError` | Wallet ID not found in configuration |
| `DecryptionError` | Incorrect password for encrypted wallet |
| `SigningError` | Signing failed (invalid payload, key issue) |
| `NetworkError` | Invalid or unsupported network identifier |
| `UnsupportedOperationError` | Operation not available for wallet type |

---

## 11. Security Requirements

### 11.1 Encryption

- Keystore V3 standard encryption for `local_secure` wallets
- scrypt key derivation (N=262144, r=8, p=1)
- AES-128-CTR cipher with Keccak256 MAC verification

### 11.2 Network Security

- SDK makes zero network calls
- No private key material transmitted over any network
- All signing operations are purely local

### 11.3 Password Enforcement

- Minimum complexity requirements enforced for master password
- Password verified against `master.json` sentinel before any decryption

### 11.4 Threat Model

| Protected Against | Not Protected Against |
|-------------------|----------------------|
| Disk theft / backup compromise | Keylogger / malware on machine |
| Unauthorized file access | Process memory inspection |
| Accidental key exposure | Compromised runtime environment |

---

## 12. Cross-Language Compatibility

### 12.1 Requirements

| Requirement | Status |
|-------------|--------|
| Same keystore format readable by both languages | Required |
| Identical signatures for same key + message | Required |
| Same network identifier format | Required |
| Same CLI command structure | Required |
| Same environment variable names | Required |

### 12.2 Platform Requirements

| Platform | Minimum Version |
|----------|----------------|
| Python | 3.10 |
| Node.js | 18.0 |

---

## 13. Testing Requirements

### 13.1 Coverage Thresholds

| Platform | Minimum Coverage |
|----------|-----------------|
| Python | 80% |
| TypeScript | 60% |

### 13.2 Required Test Categories

1. **Signing verification** — sign + recover roundtrip for all adapters and networks
2. **Deterministic signatures** — same input always produces same output
3. **Cross-library compatibility** — signatures verifiable across Python and TypeScript
4. **Encryption roundtrip** — encrypt → decrypt yields original key material
5. **Password validation** — strength requirements enforced
6. **Config management** — wallet add/remove/switch/list operations
7. **CLI integration** — all commands produce expected output
8. **Error handling** — correct error types raised for invalid inputs

---

## 14. CI/CD Requirements

### 14.1 Pipeline

| Stage | Python | TypeScript |
|-------|--------|------------|
| Lint | ruff check (E,W,F,I,B,UP,RUF) | tsc --noEmit + eslint |
| Test | pytest with coverage | vitest with v8 coverage |
| Build | python -m build | tsup (ESM + CJS) |

### 14.2 Triggers

- Push to `main` branch
- Pull requests
- Manual dispatch

---

## 15. Non-Goals

The following are explicitly out of scope:

- Hardware wallet support (HSM, Ledger, Trezor)
- Transaction building or RPC interaction
- Transaction broadcasting
- Wallet recovery or backup management
- Cloud/network-based key storage
- Multi-signature wallet coordination
- Gas estimation or fee calculation
