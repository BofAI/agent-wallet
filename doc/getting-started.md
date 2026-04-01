# Getting Started

> This guide covers the `agent-wallet` CLI. The npm and PyPI distributions now share the same command structure, though help text formatting may differ slightly.

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

Typical output:

```
Usage: agent-wallet <command> [options]

Commands:
  start             Quick setup: init + create default wallets
  init              Initialize secrets directory and set master password
  add               Add a new wallet
  list              List all configured wallets
  use <id>          Set the active wallet
  inspect <id>      Show wallet details
  resolve-address   Resolve wallet address output
  remove <id>       Remove a wallet
  sign tx <data>    Sign a transaction
  sign msg <data>   Sign a message
  sign typed-data <data>  Sign EIP-712 typed data
  change-password   Change master password
  reset             Delete all wallet data

Options:
  --dir, -d <path>      Secrets directory path (default: ~/.agent-wallet)
  --help, -h            Show this help message

Run agent-wallet <command> --help for more info on a command.
```

Running `agent-wallet` with no arguments shows the same help output.

Use `agent-wallet start --help`, `agent-wallet start local_secure --help`, or `agent-wallet add privy --help` to inspect mode-specific flags locally.

---

## 2. Concepts

| Concept | Meaning |
|--------|---------|
| **Wallet types** | `local_secure` — keys in encrypted `secret_<id>.json`; `raw_secret` — key or mnemonic stored **in plaintext** inside `wallets_config.json` (dev only); `privy` — uses Privy app credentials plus wallet ID. |
| **Signing network** | Every `sign` subcommand requires `--network` / `-n` (e.g. `eip155:1`, `tron:nile`). The CLI picks EVM vs Tron **adapter** from this string. |
| **Active wallet** | Used when you omit `--wallet-id` / `-w` on `sign`. Set with `use <id>`. |
| **Master password** | Encrypts `master.json` and `local_secure` secrets. Not used for `raw_secret` wallets. |

## 3. Quick start (`start`)

Creates or continues setup for one wallet id.

```bash
agent-wallet start
agent-wallet start local_secure [options]
agent-wallet start raw_secret [options]
agent-wallet start privy [options]
```

`agent-wallet start` with no subcommand keeps the interactive quick-start flow.

Shared `start` options:

| Option | Description |
|--------|-------------|
| `--wallet-id` | Wallet config ID (default in prompts: `default_secure`, `default_raw`, `default_privy`) |
| `--save-runtime-secrets` | If set **and** this flow uses runtime secrets, write `runtime_secrets.json` (plain JSON; sensitive) |
| `-d` / `--dir` | Secrets directory (default `~/.agent-wallet` or `AGENT_WALLET_DIR`) |
| `--override` | Skip the "already initialized" confirmation when wallets already exist |

`start local_secure` options:

| Option | Description |
|--------|-------------|
| `-g` / `--generate` | Generate a new key (`local_secure` only) |
| `-k` / `--private-key` | Import hex private key |
| `-m` / `--mnemonic` | Import mnemonic |
| `-mi` / `--mnemonic-index` | Mnemonic account index (default `0`) |
| `--derive-as` | `eip155` or `tron` — mnemonic derivation when not prompted |
| `-p` / `--password` | Master password |

**`local_secure` (first time):** creates `master.json`, `wallets_config.json`, and encrypts secrets. If you omit `-p`, the CLI first prints the password requirements, then prompts for **New Master Password**; press Enter to auto-generate a strong password and print it once.

**`local_secure` (already initialized):** asks for the existing master password (or uses env / runtime file), then adds or shows the wallet for `--wallet-id`.

`start raw_secret` options:

| Option | Description |
|--------|-------------|
| `-k` / `--private-key` | Import hex private key |
| `-m` / `--mnemonic` | Import mnemonic |
| `-mi` / `--mnemonic-index` | Mnemonic account index (default `0`) |
| `--derive-as` | `eip155` or `tron` — mnemonic derivation when not prompted |

**`raw_secret`:** warns about plaintext storage.

`start privy` options:

| Option | Description |
|--------|-------------|
| `--app-id` | Privy app id |
| `--app-secret` | Privy app secret |
| `--privy-wallet-id` | Privy wallet id |

When **`start` creates a new wallet**, that wallet is set as **active** (`set_active`). Re-running `start` for an **existing** wallet id only lists it — active wallet is unchanged unless you use `use`.

## 4. `init`

Initialize directory and master password only (no wallet entry).

```bash
agent-wallet init [-d DIR] [-p PASSWORD] [--save-runtime-secrets]
```

- Fails if `master.json` already exists (`Already initialized`).
- New password is **strength-checked**; interactive flow prints the requirements hint and asks for confirmation.

## 5. `add`

```bash
agent-wallet add [options]
agent-wallet add local_secure [options]
agent-wallet add raw_secret [options]
agent-wallet add privy [options]
```

Requires `wallets_config.json` to exist (`provider.is_initialized()`). Run `init` or `start` first.  
For **`local_secure`**, `master.json` must exist too (use `init` or `start local_secure`); otherwise keystore operations fail.

`agent-wallet add` with no subcommand keeps the interactive wallet-type prompt.

Shared `add` options: `--wallet-id`, `--save-runtime-secrets`, `-d/--dir`.

`add local_secure` options: `-g/--generate`, `-k/--private-key`, `-m/--mnemonic`, `-mi/--mnemonic-index`, `--derive-as`, `-p/--password`.

`add raw_secret` options: `-k/--private-key`, `-m/--mnemonic`, `-mi/--mnemonic-index`, `--derive-as`.

`add privy` options: `--app-id`, `--app-secret`, `--privy-wallet-id`.

- Mutually exclusive: only one of `--generate`, `--private-key`, `--mnemonic` for secret material source.
- **`add`** sets active only when there was no active wallet (`add_wallet` default); unlike `start`, it does **not** always call `set_active` on the new id.

## 6. `list`

```bash
agent-wallet list [-d DIR]
```

Table: active marker `*`, wallet id, type. No password.

## 7. `use`

```bash
agent-wallet use [wallet_id] [-d DIR]
```

## 8. `inspect`

```bash
agent-wallet inspect <wallet_id> [-d DIR]
```

Shows type, `secret_<ref>.json` status for `local_secure`, or redacted raw-secret metadata.

## 9. `resolve-address`

```bash
agent-wallet resolve-address [wallet_id] [-d DIR] [-p PASSWORD]
```

Resolves and prints the wallet address or addresses without signing.

- If `wallet_id` is omitted, the CLI prompts you to select a wallet interactively.
- `local_secure` and `raw_secret` wallets print both EVM and TRON addresses derived from the same secret material.
- `privy` wallets print the hosted wallet address returned by Privy.
- `-p` / `--password` is only needed for `local_secure` wallets.

## 10. `remove`

```bash
agent-wallet remove [wallet_id] [-d DIR] [--yes|-y]
```

If `wallet_id` is omitted, the CLI prompts you to select a wallet interactively before confirmation.

If you remove the active wallet and other wallets still exist, the CLI can optionally prompt you to choose a new active wallet immediately.

## 11. `sign`

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

## 12. `change-password`

```bash
agent-wallet change-password [-d DIR] [-p CURRENT] [--save-runtime-secrets]
```

Re-encrypts `master.json` and every `secret_*.json`. Updates `runtime_secrets.json` when `--save-runtime-secrets` is set **or** that file already exists.

## 13. `reset`

```bash
agent-wallet reset [-d DIR] [--yes|-y]
```

Deletes **only managed** JSON files: `master.json`, `wallets_config.json`, `runtime_secrets.json`, and `secret_*.json`. Other `*.json` in the directory are left intact.

Requires `master.json` to exist; otherwise prints that no wallet data was found.

## 14. Environment variables

| Variable | Role |
|----------|------|
| `AGENT_WALLET_DIR` | Default secrets directory |
| `AGENT_WALLET_PASSWORD` | Default master password when `-p` is not passed |

## 15. File layout (Python / `local_secure`)

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
