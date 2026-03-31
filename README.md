# agent-wallet

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Python](https://img.shields.io/badge/Python-≥3.11-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-≥18-339933)

**Wallet signing for AI agents and apps** — store keys safely (or use env for quick tests), pick an active wallet, and **sign** transactions, messages, and typed data on **TRON** and **EVM** chains.

> This project **only signs**. Building and broadcasting transactions is done by your code or another tool (e.g. an RPC client).

## Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
   - [SDK Integrated](#sdk-integrated)
   - [CLI](#cli)
- [Examples](#examples)
- [Documentation](#documentation)
- [Security](#security)
- [Packages & development](#packages--development)
- [License](#license)

## Overview

With **agent-wallet** you can:

- **Create or import** a wallet (encrypted “secure” mode, or plaintext-in-config for dev only).
- **Switch** which wallet is “active” when you have more than one.
- **Sign** from the CLI or from Python / TypeScript code.
- **Integrate WaaS adapters** (e.g. Privy) for hosted signing without local keys.

It fits workflows where an **MCP server** or **agent** needs a consistent way to sign without putting private keys in chat logs — similar to how [SUN MCP Server](https://github.com/BofAI/sun-mcp-server) documents **Agent Wallet** as the recommended wallet option.

### Wallet Types

| Wallet Type | Source | Networks | Password Required | Notes |
|-------------|--------|----------|-------------------|-------|
| `local_secure` | CLI config | EVM + TRON | Yes | Encrypted on disk; recommended for local use. |
| `raw_secret` | CLI config / env | EVM + TRON | No | Plaintext in config or env (dev only). |
| `privy` | CLI config | EVM + TRON | No | Uses Privy app credentials + wallet ID. See [doc/how-to-add-privy-wallet.md](./doc/how-to-add-privy-wallet.md). |

## Quick Start

Pick **one** path below. CLI data lives under `~/.agent-wallet` unless you set **`AGENT_WALLET_DIR`**.

### SDK Integrated

#### Wallet Setup Via CLI (Recommended)

Set up wallets with the [CLI](#cli) first, then let the SDK resolve from your local wallet config.

- Best for `local_secure`
- Supports encrypted key storage and active-wallet switching
- Use [`agent-wallet init`](./doc/getting-started.md#4-init) or [`agent-wallet start`](./doc/getting-started.md#3-quick-start-start) to create your wallet setup
- When your SDK process needs to unlock a `local_secure` wallet, provide [`AGENT_WALLET_PASSWORD`](./doc/getting-started.md#13-environment-variables) or use `--save-runtime-secrets`

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
#or
pip install bankofai-agent-wallet
```


Create your first **encrypted** wallet. If you omit `-p` / `--password`, the CLI shows the password requirements, lets you enter a new master password, or auto-generates one if you press Enter:

```bash
agent-wallet start
```

```
? Quick start type: local_secure  — Encrypted key stored locally (recommended)
Password requirements: at least 8 characters, with uppercase, lowercase, digit, and special character. e.g. Abc12345!@
? New Master Password (press Enter to auto-generate a strong password)
Wallet ID (e.g. my_wallet_1) (default_secure):

Wallet initialized!
? Import source: generate  — Generate a new random private key

Wallets:
┌──────────────────────┬──────────────────────┐
│ Wallet ID            │ Type                 │
├──────────────────────┼──────────────────────┤
│ default_secure       │ local_secure         │
└──────────────────────┴──────────────────────┘

🔑 Your master password: WiJxcI#t6@73K#OE
⚠️ Keep this password safe. You'll need it for signing and other operations.

Active wallet: default_secure

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
┌────┬──────────────────────┬──────────────────────┐
│    │ Wallet ID            │ Type                 │
├────┼──────────────────────┼──────────────────────┤
│ *  │ default_secure       │ local_secure         │
└────┴──────────────────────┴──────────────────────┘
```

Sign a message:

```bash
agent-wallet sign msg "MESSAGE" -n tron -p 'WiJxcI#t6@73K#OE'
```

```
Signature: d220de880cbc1c3f936bf8bbf363dfeb9490173dbbf8db435ad1ab746f7542f0319032808af046bcdca45327cfc75d105b50bc54f835d9682b6e49d7d1b282fc00
```

To skip the `-p` flag every time, set the password in your environment:

```bash
export AGENT_WALLET_PASSWORD='WiJxcI#t6@73K#OE'
agent-wallet sign msg "MESSAGE" -n tron   # no -p needed
```

Or use `--save-runtime-secrets` on any command to persist it to `~/.agent-wallet/runtime_secrets.json` (auto-detected on next run).

For mode-specific help, use hierarchical commands such as `agent-wallet start local_secure --help` or `agent-wallet add privy --help`.

**Next steps:** `agent-wallet use <id>` to switch the active wallet, `agent-wallet sign -h` for all sign options. Full walkthrough: [Getting started](./doc/getting-started.md).

## Examples

TypeScript samples under [`packages/typescript/examples/`](./packages/typescript/examples/) (Python equivalents live in [`packages/python/examples/`](./packages/python/examples/) if you need them).

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
| [**Getting started (CLI)**](./doc/getting-started.md) | Step-by-step CLI (npm-focused intro; deeper detail also covers Python Typer) |
| [How to add a Privy wallet](./doc/how-to-add-privy-wallet.md) | Use existing Privy App + Wallet ID in the CLI |
| [Python package](./packages/python/README.md) | `pip` install, SDK usage |
| [TypeScript package](./packages/typescript/README.md) | `npm` / SDK usage |

Architecture, resolution order (`ConfigWalletProvider` / `EnvWalletProvider`), and flag reference live in **getting-started** and package READMEs — you don’t need them for the first run.

## Security

- **`local_secure`** — keys encrypted on disk (Keystore-style); master password required to sign.
- **`raw_secret`** — private key or mnemonic stored in **plaintext** inside config; **dev / low-value only**.
- Secrets are **not** sent over the network by this SDK; still protect your machine, backups, and env files.

## Packages & development

| Package | Path |
|---------|------|
| Python (`bankofai-agent-wallet`) | [`packages/python/`](./packages/python/) |
| TypeScript (`@bankofai/agent-wallet`) | [`packages/typescript/`](./packages/typescript/) |

```bash
# Python tests
cd packages/python && pytest

# TypeScript tests
cd packages/typescript && pnpm test
```

## License

[MIT](./LICENSE) — BankOfAI
