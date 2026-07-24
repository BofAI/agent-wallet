# agent-wallet

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-≥18-339933)

**Wallet signing for AI agents and apps** — store keys safely (or use env for quick tests), pick an active wallet, and **sign** transactions and typed data on **TRON** and **EVM** chains.

> This project **only signs**. Building and broadcasting transactions is done by your code or another tool (e.g. an RPC client).

## Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
   - [SDK Integrated](#sdk-integrated)
   - [CLI](#cli)
- [Exec Script Credentials](#exec-script-credentials)
- [Examples](#examples)
- [Documentation](#documentation)
- [Security](#security)
- [Packages & development](#packages--development)
- [License](#license)

## Overview

With **agent-wallet** you can:

- **Create or import** a wallet (plaintext-in-config for dev, or external signers for production).
- **Switch** which wallet is "active" when you have more than one.
- **Sign** from the CLI or from TypeScript code.
- **Integrate WaaS adapters** (e.g. Privy) for hosted signing without local keys.
- **Reference secrets via exec scripts** so credentials never appear in config files.

### Wallet Types

| Wallet Type | Source | Networks | Notes |
|-------------|--------|----------|-------|
| `raw_secret` | CLI config / env | EVM + TRON | Plaintext private key or mnemonic in config (dev only). |
| `privy` | CLI config | EVM + TRON | Uses Privy app credentials + wallet ID. See [doc/how-to-add-privy-wallet.md](./doc/how-to-add-privy-wallet.md). |
| `wallet_cli` | CLI config | TRON | Keys managed by wallet-cli; agent-wallet delegates signing via subprocess (TRON now, BSC planned). Requires `@tron-walletcli/wallet-cli` installed. See [doc/how-to-add-wallet-cli-wallet.md](./doc/how-to-add-wallet-cli-wallet.md). |

## Quick Start

Pick **one** path below. CLI data lives under `~/.agent-wallet` unless you set **`AGENT_WALLET_DIR`**.

### SDK Integrated

#### Wallet Setup Via CLI (Recommended)

Set up wallets with the [CLI](#cli) first, then let the SDK resolve from your local wallet config.

- Use [`agent-wallet start`](./doc/getting-started.md#3-quick-start-start) to create your wallet setup

#### Wallet Setup Via Env

If no usable CLI wallet config is available, the SDK can resolve directly from environment variables:

| Environment variable | Purpose |
|----------------------|---------|
| `AGENT_WALLET_PRIVATE_KEY` | Private key used for SDK wallet resolution. |
| `AGENT_WALLET_MNEMONIC` | Mnemonic used for SDK wallet resolution. |
| `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX` | Account index used when deriving from `AGENT_WALLET_MNEMONIC`. |

- The SDK also remains compatible with legacy `TRON_PRIVATE_KEY`, `TRON_MNEMONIC`, and `TRON_ACCOUNT_INDEX` environment variables.
- If CLI config resolution is unavailable, the SDK falls back to these environment variables.

### CLI

Install the CLI:

```bash
npm install -g @bankofai/agent-wallet
```

Create your first wallet:

```bash
agent-wallet start
```

```
? Quick start type: raw_secret  — Private key/mnemonic saved in plaintext config
Wallet ID (e.g. my_wallet_1) (default_raw):
? Import source: private_key  — Import an existing hex private key
Paste private key (hex) (input hidden)

Wallet 'default_raw' created:
┌───────────┬────────────┐
│ Wallet ID │ Type       │
├───────────┼────────────┤
│ default_raw │ raw_secret │
└───────────┴────────────┘

Active wallet: default_raw

Quick guide:
   agent-wallet list              -- View your wallets
   agent-wallet sign tx '{...}'   -- Sign a transaction
   agent-wallet start -h          -- See all options
```

Check your wallets:

```bash
agent-wallet list
```

```
                        Wallets
┌────┬───────────┬────────────┐
│    │ Wallet ID │ Type       │
├────┼───────────┼────────────┤
│ *  │ default_raw │ raw_secret │
└────┴───────────┴────────────┘
```

Resolve the wallet address output without signing:

```bash
agent-wallet resolve-address
```

If you omit the wallet id, the CLI prompts you to select a wallet interactively.

Example output:

```text
  Wallet    default_raw
  Type      raw_secret

Addresses
  EVM     0x53c4443Ec09b859A2FC09D46c464e268AE5E51a1
  TRON    THc8CpdxbSrtRKo1S8hStQL4iSVEjBXNnW
```

Sign typed data:

```bash
agent-wallet sign typed-data '{"types":{},"primaryType":"Message","domain":{},"message":{}}' -n eip155:1
```

```
Signature: d220de880cbc1c3f936bf8bbf363dfeb9490173dbbf8db435ad1ab746f7542f0319032808af046bcdca45327cfc75d105b50bc54f835d9682b6e49d7d1b282fc00
```

For mode-specific help, use hierarchical commands such as `agent-wallet start raw_secret --help` or `agent-wallet add privy --help`.

**Next steps:** `agent-wallet use <id>` to switch the active wallet, `agent-wallet resolve-address` to inspect addresses, `agent-wallet sign -h` for all sign options. Full walkthrough: [Getting started](./doc/getting-started.md).

## Exec Script Credentials

For `privy` and `wallet_cli` wallets, you can reference credentials via an **exec script** instead of storing the plaintext value in config. This lets you integrate with secret management tools like 1Password CLI.

### CLI Flags

| Flag | Wallet Type | Description |
|------|------------|-------------|
| `--app-secret-exec <path>` | privy | Privy app secret via exec script |
| `--cli-password-exec <path>` | wallet_cli | wallet-cli keystore password via exec script |

### Config Format

In `wallets_config.json`, credentials can be either a plaintext string or a `SecretRef` object:

```json
{
  "password": "my-plaintext-password"
}
```

```json
{
  "password": { "exec": "/path/to/fetch-password.sh" }
}
```

The exec script must be an executable file path. Its stdout (trimmed) is used as the secret value. The script inherits `process.env`, so tools like 1Password CLI (which rely on `OP_SESSION_*`) work automatically. Scripts time out after 10 seconds by default.

### Interactive Prompt

When adding a wallet interactively, you can choose between direct input and exec script:

```
? wallet-cli keystore password source
❯ direct   Enter value directly
  exec     Use exec script (e.g. 1Password CLI)
```

### Example: 1Password CLI

Create a script that fetches the secret from 1Password:

```bash
#!/bin/sh
op read 'op://Private/wallet-cli-password/password'
```

Then add the wallet:

```bash
agent-wallet start wallet_cli   --wallet-id my_tron_cli   --account main-1   --cli-password-exec /path/to/fetch-password.sh
```

## Examples

TypeScript samples under [`packages/typescript/examples/`](./packages/typescript/examples/).

| What | Example |
|------|---------|
| TRON sign & broadcast | [tron-sign-and-broadcast.ts](./packages/typescript/examples/tron-sign-and-broadcast.ts) |
| BSC sign & broadcast | [bsc-sign-and-broadcast.ts](./packages/typescript/examples/bsc-sign-and-broadcast.ts) |
| Switch active wallet | [switch-active-wallet.ts](./packages/typescript/examples/switch-active-wallet.ts) |
| x402 typed data (TRON / BSC) | [tron-x402-sign-typed-data.ts](./packages/typescript/examples/tron-x402-sign-typed-data.ts), [bsc-x402-sign-typed-data.ts](./packages/typescript/examples/bsc-x402-sign-typed-data.ts) |
| One env key → TRON + EVM typed data | [dual-sign-typed-data-from-private-key.ts](./packages/typescript/examples/dual-sign-typed-data-from-private-key.ts) |
| Privy sign consistency (EVM / TRON) | [compare-sign-consistency.ts](./packages/typescript/examples/compare-sign-consistency.ts) |
| Privy TRON typed-data verification | [verify-tron-privy-typed-data.ts](./packages/typescript/examples/verify-tron-privy-typed-data.ts) |

## Documentation

| Doc | Audience |
|-----|----------|
| [**Getting started (CLI)**](./doc/getting-started.md) | Step-by-step CLI walkthrough |
| [How to add a Privy wallet](./doc/how-to-add-privy-wallet.md) | Use existing Privy App + Wallet ID in the CLI |
| [How to add a wallet-cli wallet](./doc/how-to-add-wallet-cli-wallet.md) | Use wallet-cli managed TRON keys in the CLI |
| [TypeScript package](./packages/typescript/README.md) | `npm` / SDK usage |

Architecture, resolution order (`ConfigWalletProvider` / `EnvWalletProvider`), and flag reference live in **getting-started** and the package README — you don't need them for the first run.

## Security

- **`raw_secret`** — private key or mnemonic stored in **plaintext** inside config; **dev / low-value only**. For production signing, use `wallet_cli` (BSC support planned) or `privy`.
- **`privy` / `wallet_cli`** — credentials stored in config. Use [exec script credentials](#exec-script-credentials) to avoid storing secrets in plaintext.
- Secrets are **not** sent over the network by this SDK; still protect your machine, backups, and env files.

## Packages & development

| Package | Path |
|---------|------|
| TypeScript (`@bankofai/agent-wallet`) | [`packages/typescript/`](./packages/typescript/) |

```bash
# TypeScript tests
cd packages/typescript && pnpm test
```

## License

[MIT](./LICENSE) — BankOfAI
