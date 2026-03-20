# agent-wallet

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Python](https://img.shields.io/badge/Python-≥3.10-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-≥18-339933)

**Wallet signing for AI agents and apps** — store keys safely (or use env for quick tests), pick an active wallet, and **sign** transactions, messages, and typed data on **TRON** and **EVM** chains.

> This project **only signs**. Building and broadcasting transactions is done by your code or another tool (e.g. an RPC client).

## Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
  - [CLI (npm)](#cli-npm)
  - [Environment variables only (no wallet files)](#environment-variables-only-no-wallet-files)
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

It fits workflows where an **MCP server** or **agent** needs a consistent way to sign without putting private keys in chat logs — similar to how [SUN MCP Server](https://github.com/BofAI/sun-mcp-server) documents **Agent Wallet** as the recommended wallet option.

## Quick Start

Pick **one** path below. CLI data lives under `~/.agent-wallet` unless you set **`AGENT_WALLET_DIR`**.

### CLI (npm)

Install the CLI (Node.js 18+):

```bash
npm install -g @bankofai/agent-wallet
```

Create your first **encrypted** wallet (a strong master password is generated and shown once if you omit `-p` / `--password`):

```bash
agent-wallet start local_secure --generate
```

Check that it worked:

```bash
agent-wallet list
```

**Next steps:** `agent-wallet use <id>` for the active wallet, then `agent-wallet sign ... --network <chain>`. Full walkthrough: [Getting started](./doc/getting-started.md).

> **Python:** there is also a Typer-based CLI via `pip install 'bankofai-agent-wallet[evm,tron,cli]'` — flags and help text can differ; see [`packages/python/README.md`](./packages/python/README.md).

### Environment variables only (no wallet files)

For **quick tests** or minimal setups, you can point libraries at a key or mnemonic via env (no `wallets_config.json`):

```bash
export AGENT_WALLET_PRIVATE_KEY=0x...   # or AGENT_WALLET_MNEMONIC="word1 word2 ..."
```

Optional: `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX` (default `0`), `AGENT_WALLET_DIR` for file-based config when you use the CLI/SDK together.

> **Security:** keys in environment variables are easy to leak (shell history, `.env` files). Prefer **encrypted local storage** (`local_secure`) for real funds.

## Examples

TypeScript samples under [`packages/typescript/examples/`](./packages/typescript/examples/) (Python equivalents live in [`packages/python/examples/`](./packages/python/examples/) if you need them).

| What | Example |
|------|---------|
| TRON sign & broadcast | [tron-sign-and-broadcast.ts](./packages/typescript/examples/tron-sign-and-broadcast.ts) |
| BSC sign & broadcast | [bsc-sign-and-broadcast.ts](./packages/typescript/examples/bsc-sign-and-broadcast.ts) |
| Switch active wallet | [switch-active-wallet.ts](./packages/typescript/examples/switch-active-wallet.ts) |
| x402 typed data (TRON / BSC) | [tron-x402-sign-typed-data.ts](./packages/typescript/examples/tron-x402-sign-typed-data.ts), [bsc-x402-sign-typed-data.ts](./packages/typescript/examples/bsc-x402-sign-typed-data.ts) |
| One env key → TRON + EVM typed data | [dual-sign-typed-data-from-private-key.ts](./packages/typescript/examples/dual-sign-typed-data-from-private-key.ts) |

## Documentation

| Doc | Audience |
|-----|----------|
| [**Getting started (CLI)**](./doc/getting-started.md) | Step-by-step CLI (npm-focused intro; deeper detail also covers Python Typer) |
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
