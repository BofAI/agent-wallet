# Agent Wallet — Technical Architecture

**Version:** 2.3.0
**Last Updated:** 2026-03-20

---

## 1. System Overview

Agent Wallet is an adapter layer for agent wallets, providing a unified signing interface across multiple blockchain networks. The SDK is implemented in both TypeScript and Python with full API surface parity and file format compatibility.

```
┌──────────────────────────────────────────────────────────────┐
│                      Consumer Applications                    │
│              (AI Agents, MCP Servers, DeFi Bots)              │
├──────────────┬───────────────────────────────┬────────────────┤
│     CLI      │          SDK API              │   Future       │
│  (agent-     │  resolveWallet()              │   Integrations │
│   wallet)    │  resolveWalletProvider()      │   (Privy, ...) │
├──────────────┴───────────────────────────────┴────────────────┤
│                     Resolver Layer                             │
│              Provider selection & wallet resolution            │
├───────────────────────┬──────────────────────────────┬────────┤
│  ConfigWalletProvider │    EnvWalletProvider         │ Future │
│  (file-backed,        │    (env var-backed,          │ Provid-│
│   multi-wallet)       │     single wallet)           │ ers    │
├───────────────────────┴──────────────────────────────┴────────┤
│                      Adapter Layer                             │
│              Network-specific signing logic                    │
├─────────────────────────┬────────────────────────────┬────────┤
│       EvmAdapter        │       TronAdapter          │ Future │
│  (viem / eth-account)   │  (tronweb / tronpy)        │ Chains │
├─────────────────────────┴────────────────────────────┴────────┤
│                    Local Storage Layer                          │
│              SecureKVStore (Keystore V3 encryption)            │
└───────────────────────────────────────────────────────────────┘
```

---

## 2. Layer Architecture

### 2.1 Layer Stack

| Layer | Responsibility | Key Components |
|-------|---------------|----------------|
| **Delivery** | User interaction (CLI, SDK entry points) | `cli.ts/py`, `bin.ts`, `index.ts`, `__init__.py` |
| **Resolver** | Provider selection strategy | `resolver.ts/py` |
| **Provider** | Wallet lifecycle management | `ConfigWalletProvider`, `EnvWalletProvider` |
| **Adapter** | Network-specific signing | `EvmAdapter`, `TronAdapter` |
| **Config** | Schema validation & persistence | Zod schemas (TS), Pydantic models (Python) |
| **Storage** | Encrypted key storage | `SecureKVStore`, `secret-loader` |

### 2.2 Dependency Direction

```
Delivery → Resolver → Provider → Adapter
                         ↓
                      Config ← Storage
```

All dependencies flow top-down. Lower layers have no knowledge of upper layers.

---

## 3. Core Abstractions

### 3.1 Interfaces

```
┌─────────────────────┐     ┌─────────────────────┐
│     <<interface>>    │     │     <<interface>>    │
│       Wallet         │     │    Eip712Capable     │
├─────────────────────┤     ├─────────────────────┤
│ getAddress()         │     │ signTypedData(data)  │
│ signRaw(rawTx)       │     └─────────────────────┘
│ signTransaction(tx)  │               ▲
│ signMessage(msg)     │               │
└─────────────────────┘               │
          ▲                            │
          │          ┌─────────────────┤
          ├──────────┤                 │
          │          │                 │
  ┌───────┴───┐  ┌──┴────────┐       │
  │EvmAdapter │  │TronAdapter│───────┘
  │           │──┘           │
  └───────────┘  └───────────┘

┌─────────────────────┐
│     <<interface>>    │
│   WalletProvider     │
├─────────────────────┤
│ getActiveWallet()    │
└─────────────────────┘
          ▲
          │
  ┌───────┴──────────┐
  │                  │
┌─┴──────────────┐ ┌─┴──────────────┐
│ConfigWallet    │ │EnvWallet       │
│Provider        │ │Provider        │
└────────────────┘ └────────────────┘
```

### 3.2 Enums

| Enum | Values | Usage |
|------|--------|-------|
| `Network` | `evm`, `tron` | Network family identification |
| `WalletType` | `local_secure`, `raw_secret` | Wallet storage strategy |

### 3.3 Error Hierarchy

```
WalletError (base)
├── WalletNotFoundError      # Wallet ID not in config
├── DecryptionError          # Wrong password / corrupt keystore
├── SigningError             # Signing operation failed
├── InsufficientBalanceError # Balance check failed
├── NetworkError             # Invalid network identifier
└── UnsupportedOperationError # Feature not available
```

---

## 4. Provider Resolution

### 4.1 Resolution Flow

```
resolveWalletProvider(network?, dir?)
│
├─ 1. Determine secrets directory
│     dir parameter > AGENT_WALLET_DIR env > ~/.agent-wallet
│
├─ 2. Check runtime_secrets.json
│     └─ exists? → ConfigWalletProvider(dir, password=loaded)
│
├─ 3. Check wallets_config.json
│     └─ exists & has wallets? → ConfigWalletProvider(dir)
│
└─ 4. Check environment variables
      └─ PRIVATE_KEY or MNEMONIC set? → EnvWalletProvider
         └─ neither? → throw WalletError
```

### 4.2 Password Resolution (for `local_secure`)

```
1. runtime_secrets.json   (auto-detected file)
2. AGENT_WALLET_PASSWORD  (environment variable)
3. Interactive prompt     (CLI only)
```

---

## 5. ConfigWalletProvider

### 5.1 Responsibilities

- Multi-wallet CRUD operations (add, remove, list, inspect)
- Active wallet tracking
- Wallet instance caching
- Config file persistence
- Runtime secrets management

### 5.2 Wallet Resolution

```
getActiveWallet(network?)
│
├─ active_wallet set? → load that wallet
│
├─ iterate wallets → find first raw_secret → use it
│
├─ any local_secure exists but no password?
│  └─ throw "Password required"
│
└─ no wallets? → throw "No active wallet"
```

### 5.3 Wallet Instantiation

```
getWallet(walletId, network?)
│
├─ check cache[walletId:network] → hit? return cached
│
├─ load WalletConfig for walletId
│
├─ type == local_secure?
│  └─ secretLoader(dir, password, secretRef) → privateKey bytes
│     └─ createAdapter(network, privateKey) → cache & return
│
└─ type == raw_secret?
   ├─ source == private_key?
   │  └─ decodePrivateKey(hex) → createAdapter(network, key)
   └─ source == mnemonic?
      └─ deriveKeyFromMnemonic(phrase, index, network) → createAdapter
```

### 5.4 Caching Strategy

- **Key:** `{walletId}:{resolvedNetwork}`
- **Lifetime:** provider instance scope
- **Invalidation:** wallet removal clears its cache entry

---

## 6. EnvWalletProvider

### 6.1 Source Priority

```
1. AGENT_WALLET_PRIVATE_KEY  → decodePrivateKey(hex)
2. AGENT_WALLET_MNEMONIC     → deriveKeyFromMnemonic(phrase, index, network)
   + AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX (default: 0)
```

Exactly one source must be provided. No multi-wallet support.

---

## 7. Adapter Layer

### 7.1 Network Routing

```
parseNetworkFamily(networkString)
│
├─ "tron" | "tron:*"    → Network.TRON
├─ "eip155" | "eip155:*" → Network.EVM
└─ other                 → throw NetworkError
```

### 7.2 EvmAdapter

| Operation | Implementation |
|-----------|---------------|
| `getAddress()` | Derive from private key → EIP-55 checksummed hex |
| `signMessage(msg)` | EIP-191 personal sign → 65-byte signature hex |
| `signTransaction(payload)` | viem/eth-account sign → raw tx hex (broadcast-ready) |
| `signRaw(rawTx)` | Parse serialized tx → strip sig → re-sign |
| `signTypedData(data)` | EIP-712 standard → 65-byte signature hex |

**Transaction types:** Legacy (type 0), EIP-2930 (type 1), EIP-1559 (type 2)

**Libraries:** viem (TypeScript), eth-account (Python)

### 7.3 TronAdapter

| Operation | Implementation |
|-----------|---------------|
| `getAddress()` | `0x41` + ETH address → Base58check encode |
| `signMessage(msg)` | Keccak256 hash → secp256k1 ECDSA → 65-byte hex |
| `signTransaction(payload)` | Sign txID digest → append signature array to tx JSON |
| `signRaw(rawTx)` | Keccak256 hash → secp256k1 ECDSA → 65-byte hex |
| `signTypedData(data)` | EIP-712 hash construction → secp256k1 sign |

**Transaction input:** Unsigned tx from TronGrid API (`txID`, `raw_data_hex`, `raw_data`)
**Transaction output:** JSON string with `"signature": ["hex"]` appended

**Libraries:** tronweb + @noble/curves (TypeScript), tronpy (Python)

### 7.4 Key Derivation Paths (BIP-44)

| Network | Path |
|---------|------|
| EVM | `m/44'/60'/0'/0/{accountIndex}` |
| TRON | `m/44'/195'/0'/0/{accountIndex}` |

### 7.5 Cross-Chain Signature Consistency

Same private key + same message = identical signature on both EVM and TRON adapters. Both use secp256k1 ECDSA on the same curve, producing interoperable 65-byte (r, s, v) signatures.

---

## 8. Storage Layer

### 8.1 Keystore V3 Encryption

```
Encrypt:                              Decrypt:
plaintext                             KeystoreV3 JSON
  │                                     │
  ├─ salt = random(32)                  ├─ extract salt, IV, ciphertext, mac
  ├─ iv = random(16)                    ├─ derivedKey = scrypt(password, salt)
  ├─ derivedKey = scrypt(pwd, salt)     ├─ macKey = derivedKey[16:32]
  │   (N=262144, r=8, p=1, dk=32)      ├─ verify: keccak256(macKey+ct) == mac?
  ├─ encKey = derivedKey[0:16]          │   └─ mismatch → DecryptionError
  ├─ macKey = derivedKey[16:32]         ├─ encKey = derivedKey[0:16]
  ├─ ct = AES-128-CTR(encKey, iv, pt)   ├─ plaintext = AES-128-CTR(encKey, iv, ct)
  ├─ mac = keccak256(macKey + ct)       └─ return plaintext
  └─ return KeystoreV3 JSON
```

### 8.2 SecureKVStore

| Method | Purpose |
|--------|---------|
| `initMaster()` | Create `master.json` sentinel (encrypted "agent-wallet") |
| `verifyPassword()` | Decrypt master.json → compare sentinel value |
| `saveSecret(name, bytes)` | Encrypt & save `secret_<name>.json` |
| `loadSecret(name)` | Load & decrypt `secret_<name>.json` → bytes |
| `generateSecret(name, len)` | Generate random bytes, encrypt & save |
| `saveCredential(name, data)` | Save structured credential (JSON-serializable) |
| `loadCredential(name)` | Load structured credential |

### 8.3 File Layout

```
~/.agent-wallet/                    (AGENT_WALLET_DIR)
├── wallets_config.json             Wallet registry (unencrypted metadata)
├── master.json                     Password verification sentinel (encrypted)
├── runtime_secrets.json            (Optional) Plaintext password
├── secret_<walletId>.json          Encrypted private key (one per local_secure wallet)
└── secret_<walletId>.json          ...
```

All files created with `chmod 0o600` (owner read/write only).

---

## 9. Configuration Schema

### 9.1 WalletsTopology

```json
{
  "active_wallet": "string | null",
  "wallets": {
    "<walletId>": WalletConfig
  }
}
```

### 9.2 WalletConfig (Discriminated Union on `type`)

```
WalletConfig
├─ LocalSecureWalletConfig
│  { type: "local_secure", secret_ref: string }
│
└─ RawSecretWalletConfig
   { type: "raw_secret", material: RawSecretMaterial }

RawSecretMaterial (Discriminated Union on `source`)
├─ { source: "private_key", private_key: string }
└─ { source: "mnemonic", mnemonic: string, account_index: number }
```

### 9.3 Validation

- **TypeScript:** Zod with `z.discriminatedUnion()` on `type` and `source` fields
- **Python:** Pydantic with `Annotated[..., Discriminator("field")]`
- JSON keys use **snake_case** for cross-language compatibility

---

## 10. Data Flow Diagrams

### 10.1 Sign Transaction (End-to-End)

```
Consumer App
  │
  │  await resolveWallet({ network: "eip155:97" })
  ▼
Resolver
  │  determines provider (Config or Env)
  ▼
Provider
  │  loads wallet config
  │  decrypts private key (if local_secure)
  │  creates adapter instance
  ▼
Adapter (EvmAdapter)
  │
  │  await wallet.signTransaction({ to, value, gas, ... })
  │
  │  ┌─────────────────────────────┐
  │  │ viem/eth-account:           │
  │  │ 1. Serialize tx fields      │
  │  │ 2. RLP encode               │
  │  │ 3. Keccak256 hash           │
  │  │ 4. secp256k1 ECDSA sign     │
  │  │ 5. Append v, r, s           │
  │  │ 6. Return signed raw hex    │
  │  └─────────────────────────────┘
  │
  ▼
Consumer App
  │  broadcasts via RPC (eth_sendRawTransaction)
```

### 10.2 Sign Transaction (TRON)

```
Consumer App
  │
  │  1. Build unsigned tx via TronGrid API
  │  2. await wallet.signTransaction({ txID, raw_data_hex, raw_data })
  ▼
TronAdapter
  │  1. Extract txID (32-byte SHA256 digest)
  │  2. secp256k1 ECDSA sign(txID)
  │  3. Produce r || s || v (65 bytes hex)
  │  4. Append to tx as signature array
  │  5. Return JSON string
  ▼
Consumer App
  │  broadcasts via TronGrid API
```

### 10.3 Wallet Initialization Flow

```
CLI: agent-wallet start local_secure
  │
  ├─ 1. Resolve/create secrets directory
  ├─ 2. Validate or generate password
  ├─ 3. SecureKVStore.initMaster()  → master.json
  ├─ 4. Generate or import private key
  ├─ 5. SecureKVStore.saveSecret()  → secret_<id>.json
  ├─ 6. Save wallets_config.json with new wallet entry
  └─ 7. (Optional) Save runtime_secrets.json
```

---

## 11. CLI Architecture

### 11.1 Command Tree

```
agent-wallet
├── start [wallet_type]         # Quick setup wizard
├── init                        # Initialize directory only
├── add <wallet_type>           # Add wallet to existing config
├── list                        # List all wallets
├── use <wallet_id>             # Set active wallet
├── inspect <wallet_id>         # Show wallet details
├── remove <wallet_id>          # Delete wallet
├── sign
│   ├── msg <message>           # Sign message
│   ├── tx '<json>'             # Sign transaction
│   └── typed-data '<json>'     # Sign EIP-712 typed data
├── change-password             # Re-encrypt all secrets
└── reset                       # Delete all wallet data
```

### 11.2 Implementation

| Platform | Framework | Interactive Prompts | Output Formatting |
|----------|-----------|--------------------|--------------------|
| TypeScript | Custom readline parser | `@inquirer/prompts` | Console output |
| Python | Typer | `questionary` + `rich` | Rich tables/panels |

---

## 12. Extensibility

### 12.1 Adding a New Blockchain

1. Create `NewChainAdapter` implementing `Wallet` + `Eip712Capable`
2. Add network identifier parsing to `parseNetworkFamily()` (e.g., `"solana" | "solana:*"`)
3. Add adapter instantiation to `createAdapter()` factory
4. Add BIP-44 derivation path for mnemonic support

### 12.2 Adding a New Provider

1. Implement `WalletProvider` interface (`getActiveWallet()`)
2. Add resolution logic to `resolveWalletProvider()` with appropriate priority
3. No changes needed in adapter or storage layers

### 12.3 Custom Secret Backend

`ConfigWalletProvider` accepts a `secretLoader` parameter, allowing injection of custom secret loading logic (e.g., cloud KMS, hardware security module) without modifying the provider itself.

---

## 13. Cross-Language Compatibility

### 13.1 Guarantees

| Aspect | Guarantee |
|--------|-----------|
| Config files | Same JSON format, snake_case keys, readable by both languages |
| Signatures | Identical output for same private key + same input |
| Encryption | Same Keystore V3 format, cross-decryptable |
| Network IDs | Same string format (`eip155:*`, `tron:*`) |
| CLI commands | Same command names and argument structure |
| Env vars | Same variable names |

### 13.2 Implementation Mapping

| Component | TypeScript | Python |
|-----------|-----------|--------|
| EVM signing | viem | eth-account |
| TRON signing | tronweb + @noble/curves | tronpy |
| Schema validation | Zod | Pydantic |
| CLI framework | Custom readline | Typer |
| Interactive prompts | @inquirer/prompts | questionary |
| Output formatting | Console | Rich |
| Encryption | Node.js crypto | pycryptodome |

---

## 14. Security Architecture

### 14.1 Key Protection Layers

```
Layer 1: File permissions (chmod 600)
Layer 2: Keystore V3 encryption (scrypt + AES-128-CTR)
Layer 3: MAC verification (Keccak256)
Layer 4: Password strength enforcement
Layer 5: Master sentinel verification
```

### 14.2 Zero Network Principle

The SDK makes **zero** outbound network calls. All operations are purely local:
- Private keys never leave the process
- No telemetry, no analytics, no remote key storage
- Transaction building and broadcasting are the caller's responsibility

### 14.3 Password Strength Rules

- Minimum 8 characters
- At least 1 uppercase, 1 lowercase, 1 digit, 1 special character
- Auto-generated passwords: 16 random characters from mixed character set
