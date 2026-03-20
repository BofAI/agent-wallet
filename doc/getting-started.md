# Getting Started 

> This guide covers the **TypeScript CLI** installed via npm.

This guide walks you through every CLI command in `@bankofai/agent-wallet` — from installation to signing.

## Prerequisites

- Node.js >= 18.0.0
- npm or pnpm

## 1. Install

```bash
$ npm install -g @bankofai/agent-wallet
```

Verify the installation:

```bash
$ agent-wallet --help
```

Expected output:

```
Usage: agent-wallet <command> [options]

Commands:
  start             Quick setup: init + create default wallets
  init              Initialize secrets directory and set master password
  add               Add a new wallet (interactive)
  list              List all configured wallets
  use <id>          Set the active wallet
  inspect <id>      Show wallet details
  remove <id>       Remove a wallet
  sign tx <data>    Sign a transaction (JSON payload as argument)
  sign msg <data>   Sign a message (message as argument)
  sign typed-data <data>  Sign EIP-712 typed data (JSON as argument)
  change-password   Change master password
  reset             Delete all wallet data

Options:
  --password, -p <pw>   Master password (skip interactive prompt)
  --dir, -d <path>      Secrets directory path (default: ~/.agent-wallet)
  --help, -h            Show this help message

Run agent-wallet <command> --help for more info on a command.
```

Running `agent-wallet` with no arguments shows the same help output.

> Installing from **PyPI** (`pip install 'bankofai-agent-wallet[cli]'`) gives a **Typer** CLI — the banner, command names, and global options above will **not** match byte-for-byte; run `agent-wallet --help` locally.

---

> **Command reference (§2 onward)** matches the **Python** CLI (`bankofai-agent-wallet`, Typer).  
> Install: `pip install 'bankofai-agent-wallet[evm,tron,cli]'` — entry point is also `agent-wallet`.  
> The **npm** package may use different wallet types and flags; see `packages/typescript/README.md`.

## 2. Concepts

| Concept | Meaning |
|--------|---------|
| **Wallet types** | `local_secure` — keys in encrypted `secret_<id>.json`; `raw_secret` — key or mnemonic stored **in plaintext** inside `wallets_config.json` (dev only). |
| **Signing network** | Every `sign` subcommand requires `--network` / `-n` (e.g. `eip155:1`, `tron:nile`). The CLI picks EVM vs Tron **adapter** from this string. |
| **Active wallet** | Used when you omit `--wallet-id` / `-w` on `sign`. Set with `use <id>`. |
| **Master password** | Encrypts `master.json` and `local_secure` secrets. Not used for `raw_secret` wallets. |

## 3. Quick start (`start`)

Creates or continues setup for one wallet id.

```bash
agent-wallet start [local_secure|raw_secret] [options]
```

Common options:

| Option | Description |
|--------|-------------|
| `--wallet-id` | Wallet ID (default in prompts: `default` for `local_secure`, `raw_wallet` for `raw_secret`) |
| `-g` / `--generate` | Generate a new key (`local_secure` only) |
| `-k` / `--private-key` | Import hex private key |
| `-m` / `--mnemonic` | Import mnemonic |
| `-mi` / `--mnemonic-index` | Mnemonic account index (default `0`) |
| `--derive-as` | `eip155` or `tron` — mnemonic derivation when not prompted |
| `-p` / `--password` | Master password (`local_secure` only; invalid with `raw_secret`) |
| `--save-runtime-secrets` | If set **and** a master password is used, write `runtime_secrets.json` (plain JSON with password — sensitive) |
| `-d` / `--dir` | Secrets directory (default `~/.agent-wallet` or `AGENT_WALLET_DIR`) |

**`local_secure` (first time):** creates `master.json`, `wallets_config.json`, encrypts secrets. If you omit `-p`, a strong password is generated and printed once.

**`local_secure` (already initialized):** asks for master password (or env / runtime file), then adds or shows the wallet for `--wallet-id`.

**`raw_secret`:** warns about plaintext storage; cannot use `-p` or `--generate` (`--generate` is rejected for non–`local_secure` flows).

When **`start` creates a new wallet**, that wallet is set as **active** (`set_active`). Re-running `start` for an **existing** wallet id only lists it — active wallet is unchanged unless you use `use`.

## 4. `init`

Initialize directory and master password only (no wallet entry).

```bash
agent-wallet init [-d DIR] [-p PASSWORD] [--save-runtime-secrets]
```

- Fails if `master.json` already exists (`Already initialized`).
- New password is **strength-checked**; interactive flow asks for confirmation.

## 5. `add`

```bash
agent-wallet add <local_secure|raw_secret> [options]
```

Requires `wallets_config.json` to exist (`provider.is_initialized()`). Run `init` or `start` first.  
For **`local_secure`**, `master.json` must exist too (use `init` or `start local_secure`); otherwise keystore operations fail.

Same key options as `start` (`--wallet-id`, `-g`, `-k`, `-m`, `-mi`, `--derive-as`, `-p`, `--save-runtime-secrets`, `-d`).

- **`raw_secret`:** do not pass `-p` or `-g`.
- Mutually exclusive: only one of `--generate`, `--private-key`, `--mnemonic` for material source.
- **`add`** sets active only when there was no active wallet (`add_wallet` default); unlike `start`, it does **not** always call `set_active` on the new id.

## 6. `list`

```bash
agent-wallet list [-d DIR]
```

Table: active marker `*`, wallet id, type. No password.

## 7. `use`

```bash
agent-wallet use <wallet_id> [-d DIR]
```

## 8. `inspect`

```bash
agent-wallet inspect <wallet_id> [-d DIR]
```

Shows type, `secret_<ref>.json` status for `local_secure`, or redacted raw-secret metadata.

## 9. `remove`

```bash
agent-wallet remove <wallet_id> [-d DIR] [--yes|-y]
```

## 10. `sign`

All subcommands require **`--network` / `-n`**.

```bash
agent-wallet sign msg "<message>" -n eip155:1 [-w WALLET_ID] [-p PASSWORD] [-d DIR]
agent-wallet sign tx '<json>' -n eip155:1 [-w WALLET_ID] ...
agent-wallet sign typed-data '<json>' -n eip155:1 [-w WALLET_ID] ...
```

| Option | Short | Description |
|--------|-------|-------------|
| `--wallet-id` | `-w` | Wallet id (defaults to active) |
| `--network` | `-n` | **Required** — `eip155`, `eip155:1`, `tron:nile`, etc. |
| `--password` | `-p` | Master password (`local_secure`; skip prompts) |
| `--save-runtime-secrets` | | Only when this flag is set: save password to `runtime_secrets.json` |
| `--dir` | `-d` | Secrets directory |

- **`raw_secret` wallets:** no master password.
- **`local_secure` without password/env/runtime file:** exits with a CLI error (e.g. password required), not an uncaught traceback.

Signed tx: if the result parses as JSON it is pretty-printed; otherwise hex is printed as text.

## 11. `change-password`

```bash
agent-wallet change-password [-d DIR] [-p CURRENT] [--save-runtime-secrets]
```

Re-encrypts `master.json` and every `secret_*.json`. Updates `runtime_secrets.json` when `--save-runtime-secrets` is set **or** that file already exists.

## 12. `reset`

```bash
agent-wallet reset [-d DIR] [--yes|-y]
```

Deletes **only managed** JSON files: `master.json`, `wallets_config.json`, `runtime_secrets.json`, and `secret_*.json`. Other `*.json` in the directory are left intact.

Requires `master.json` to exist; otherwise prints that no wallet data was found.

## 13. Environment variables

| Variable | Role |
|----------|------|
| `AGENT_WALLET_DIR` | Default secrets directory |
| `AGENT_WALLET_PASSWORD` | Default master password when `-p` is not passed |

## 14. File layout (Python / `local_secure`)

```
~/.agent-wallet/          (mode 700)
├── master.json           # Encrypted sentinel (password check)
├── wallets_config.json   # active_wallet + wallet entries
├── runtime_secrets.json  # Optional; {"password": "..."} — sensitive
└── secret_<id>.json      # Encrypted key material per local_secure wallet
```

### Example `wallets_config.json`

```json
{
  "active_wallet": "my_wallet",
  "wallets": {
    "my_wallet": {
      "type": "local_secure",
      "secret_ref": "my_wallet"
    }
  }
}
```

## 15. Non-interactive tips

- Pass `-p`, `-k`, `-m`, `--derive-as`, `--wallet-id`, and `-n` so scripts never prompt.
- Invalid `runtime_secrets.json` yields a clear CLI error (`Invalid runtime secrets: …`).
- TTY-only prompts: use explicit flags in CI.

## Next steps

- **Python SDK** — `packages/python/README.md`, `examples/`
- **TypeScript** — `packages/typescript/README.md` (npm CLI)
- Resolver helpers — `resolve_wallet`, `resolve_wallet_provider` in Python package
