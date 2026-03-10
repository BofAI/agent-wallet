# Getting Started (TypeScript)

> This guide covers the **TypeScript CLI** installed via npm.
> For the Python version, see [Getting Started (Python)](./getting-started-python.md).

This guide walks you through every CLI command in `@bankofai/agent-wallet` — from installation to signing.

## Prerequisites

- Node.js >= 18.0.0
- npm or pnpm

## 1. Install

```bash
npm install -g @bankofai/agent-wallet
```

Verify the installation:

```bash
agent-wallet --help
```

Expected output:

```
Usage: agent-wallet <command> [options]

Commands:
  init              Initialize secrets directory and set master password
  add               Add a new wallet (interactive)
  list              List all configured wallets
  use <id>          Set the active wallet
  inspect <id>      Show wallet details
  remove <id>       Remove a wallet
  sign tx           Sign a transaction
  sign msg          Sign a message
  sign typed-data   Sign EIP-712 typed data
  change-password   Change master password
  serve             Start MCP / HTTP server

Options:
  --dir, -d         Secrets directory path (default: ~/.agent-wallet)
  --help, -h        Show this help message
```

Running `agent-wallet` with no arguments shows the same help output.

---

## 2. `init` — Initialize Secrets Directory

Create a secrets directory and set a master password. All private keys will be encrypted with this password.

```bash
agent-wallet init
```

Interactive prompts:

```
Master password: ********
Confirm password: ********
Initialized. Secrets directory: /home/you/.agent-wallet
```

**Password requirements:** At least 8 characters, with at least 1 uppercase letter, 1 lowercase letter, 1 digit, and 1 special character.

### Custom directory

```bash
agent-wallet init --dir ./my-secrets
```

Short form:

```bash
agent-wallet init -d ./my-secrets
```

### Error cases

| Scenario | Output |
|---|---|
| Directory already initialized | `Already initialized: /home/you/.agent-wallet` |
| Password too weak | `Password too weak. Requirements: at least 1 uppercase letter, ...` |
| Passwords don't match | `Passwords do not match.` |

### What it creates

```
~/.agent-wallet/          (mode 700)
├── master.json           # Encrypted sentinel for password verification
└── wallets_config.json   # Empty wallet config {"config_version":1,"wallets":{},"active_wallet":null}
```

---

## 3. `add` — Add a New Wallet

```bash
agent-wallet add
```

Interactive prompts:

```
Master password: ********
Wallet name: my-tron-wallet
> Wallet type: tron_local
> Private key: generate
Generated new private key.
  Address: TJRabPrwbZy45sbavfcjinPJC18kjpRTv8
  Saved:   id_my-tron-wallet.json
Wallet 'my-tron-wallet' added. Config updated.
  Active wallet set to 'my-tron-wallet'.
```

### Wallet types

| Type | Description |
|---|---|
| `evm_local` | Ethereum / EVM-compatible chain (BSC, Polygon, etc.) |
| `tron_local` | TRON network |

### Private key options

| Option | Description |
|---|---|
| `generate` | Generate a new random 32-byte private key |
| `import` | Paste an existing private key in hex format (with or without `0x` prefix) |

**Import example:**

```
> Private key: import
Paste private key (hex): ********
Imported private key.
  Address: 0x8c71...4fe3
  Saved:   id_my-evm-wallet.json
```

### Auto-active behavior

- The **first** wallet you add is automatically set as the active wallet.
- Subsequent `add` commands do **not** change the active wallet.

### Error cases

| Scenario | Output |
|---|---|
| Wrong password | `Error: Decryption failed` |
| Not initialized | `Error: ENOENT: no such file or directory ...master.json` |
| Duplicate wallet name | `Wallet 'my-tron-wallet' already exists.` |
| Invalid hex on import | `Invalid hex string.` |

---

## 4. `list` — List All Wallets

```bash
agent-wallet list
```

Expected output:

```
Wallets:
  Name                 Type            Address
  --------------------------------------------------------------------
* my-tron-wallet       tron_local      TJRabPrwbZy45sbavfcjinPJC18kjpRTv8
  my-evm-wallet        evm_local       0x8c71...4fe3
```

- `*` marks the active wallet.
- No password required for this command.

### Empty state

If no wallets are configured:

```
No wallets configured.
```

---

## 5. `use <id>` — Set Active Wallet

```bash
agent-wallet use my-evm-wallet
```

```
Active wallet: my-evm-wallet (evm_local)
```

The active wallet is used by default for all `sign` commands. You can always override it with `--wallet`.

### Error cases

| Scenario | Output |
|---|---|
| Wallet not found | `Wallet 'nonexistent' not found.` |
| No wallet ID given | `Usage: agent-wallet use <wallet-id>` |

---

## 6. `inspect <id>` — Show Wallet Details

```bash
agent-wallet inspect my-tron-wallet
```

```
Wallet      my-tron-wallet
Type        tron_local
Address     TJRabPrwbZy45sbavfcjinPJC18kjpRTv8
Identity    id_my-tron-wallet.json ✓
Credential  —
```

- `✓` means the encrypted key file exists on disk.
- `—` means no file is associated.
- No password required for this command.

### Error cases

| Scenario | Output |
|---|---|
| Wallet not found | `Wallet 'nonexistent' not found.` |
| No wallet ID given | `Usage: agent-wallet inspect <wallet-id>` |

---

## 7. `remove <id>` — Remove a Wallet

```bash
agent-wallet remove my-tron-wallet
```

Interactive confirmation:

```
Remove wallet 'my-tron-wallet'? (y/N): y
  Deleted: id_my-tron-wallet.json
Wallet 'my-tron-wallet' removed.
```

### Skip confirmation

```bash
agent-wallet remove my-tron-wallet --yes
```

Short form:

```bash
agent-wallet remove my-tron-wallet -y
```

### Active wallet behavior

If you remove the currently active wallet, `active_wallet` is automatically cleared to `null`.

### Error cases

| Scenario | Output |
|---|---|
| Wallet not found | `Wallet 'nonexistent' not found.` |
| User declines | `Cancelled.` |
| No wallet ID given | `Usage: agent-wallet remove <wallet-id>` |

---

## 8. `sign msg` — Sign a Message

### Using active wallet (no `--wallet` needed)

```bash
agent-wallet sign msg --message "Hello"
```

```
Master password: ********
Signature: 4a9c8f...e71b
```

### Specifying a wallet explicitly

```bash
agent-wallet sign msg --wallet my-tron-wallet --message "Hello"
```

Short forms:

```bash
agent-wallet sign msg -w my-tron-wallet -m "Hello"
```

### Error cases

| Scenario | Output |
|---|---|
| No active wallet and no `--wallet` | `No wallet specified and no active wallet set. Use '--wallet <id>' or 'agent-wallet use <id>'.` |
| Not initialized | `Wallet not initialized. Run 'agent-wallet init' first.` |
| Wallet not found | `Error: Wallet 'nonexistent' not found` |
| Wrong password | `Error: Decryption failed` |

---

## 9. `sign tx` — Sign a Transaction

```bash
agent-wallet sign tx --payload '{"txID":"abc123...","raw_data_hex":"0a02...","raw_data":{...}}'
```

Short forms:

```bash
agent-wallet sign tx -w my-tron-wallet -p '{"txID":"abc123..."}'
```

```
Master password: ********
Signed tx:
{
  "txID": "abc123...",
  "signature": ["..."]
}
```

If the signed result is valid JSON, it's pretty-printed. Otherwise it's printed as a raw string.

### Options

| Flag | Short | Description |
|---|---|---|
| `--wallet` | `-w` | Wallet ID (optional if active wallet is set) |
| `--payload` | `-p` | Transaction payload as JSON string |

---

## 10. `sign typed-data` — Sign EIP-712 Typed Data

```bash
agent-wallet sign typed-data --data '{
  "types": {
    "EIP712Domain": [
      {"name":"name","type":"string"},
      {"name":"chainId","type":"uint256"}
    ],
    "Transfer": [
      {"name":"to","type":"address"},
      {"name":"amount","type":"uint256"}
    ]
  },
  "primaryType": "Transfer",
  "domain": {"name":"MyDApp","chainId":728126428},
  "message": {"to":"0x7099...79C8","amount":1000000}
}'
```

```
Master password: ********
Signature: 22008ffd...0e1c
```

### Options

| Flag | Short | Description |
|---|---|---|
| `--wallet` | `-w` | Wallet ID (optional if active wallet is set) |
| `--data` | | EIP-712 typed data as JSON string |

### Error cases

| Scenario | Output |
|---|---|
| Wallet doesn't support EIP-712 | `This wallet does not support EIP-712 signing.` |
| Invalid JSON | `Error: Unexpected token ...` |

---

## 11. `change-password` — Change Master Password

```bash
agent-wallet change-password
```

```
Current password: ********
New password: ********
Confirm new password: ********
  ✓ master.json
  ✓ id_my-tron-wallet.json
  ✓ id_my-evm-wallet.json

Password changed. Re-encrypted 3 files.
```

Re-encrypts **all** key files (`master.json`, `id_*.json`, `cred_*.json`) with the new password.

### Error cases

| Scenario | Output |
|---|---|
| Wrong current password | `Error: Decryption failed` |
| New password too weak | `Password too weak. Requirements: ...` |
| Passwords don't match | `Passwords do not match.` |

---

## 12. Environment Variables

| Variable | Description | Default |
|---|---|---|
| `AGENT_WALLET_PASSWORD` | Skip interactive password prompt | (none) |
| `AGENT_WALLET_DIR` | Secrets directory path (supports `~`) | `~/.agent-wallet` |

### Non-interactive usage (CI/CD, scripts)

```bash
export AGENT_WALLET_PASSWORD="MyP@ssw0rd!"
export AGENT_WALLET_DIR="~/.agent-wallet"

# All commands will use these values without prompting
agent-wallet sign msg --message "Hello"
agent-wallet sign tx --wallet my-tron-wallet --payload '{"txID":"..."}'
```

Single-line usage:

```bash
AGENT_WALLET_PASSWORD="MyP@ssw0rd!" agent-wallet sign msg -m "Hello"
```

---

## 13. `--dir` / `-d` — Custom Directory

All commands accept `--dir` (or `-d`) to specify a custom secrets directory:

```bash
agent-wallet init --dir ./my-secrets
agent-wallet add --dir ./my-secrets
agent-wallet list --dir ./my-secrets
agent-wallet use my-wallet --dir ./my-secrets
agent-wallet inspect my-wallet --dir ./my-secrets
agent-wallet remove my-wallet --dir ./my-secrets
agent-wallet sign msg --message "Hello" --dir ./my-secrets
agent-wallet sign tx --payload '...' --dir ./my-secrets
agent-wallet sign typed-data --data '...' --dir ./my-secrets
agent-wallet change-password --dir ./my-secrets
```

Tilde expansion is supported:

```bash
agent-wallet list --dir ~/custom-wallets
```

---

## 14. File Structure

After setup with two wallets, your secrets directory looks like:

```
~/.agent-wallet/                 (mode 700)
├── master.json                  # Encrypted sentinel for password verification
├── wallets_config.json          # Wallet config (names, types, addresses, active_wallet)
├── id_my-tron-wallet.json       # Encrypted private key (Keystore V3)
├── id_my-evm-wallet.json        # Encrypted private key (Keystore V3)
└── cred_my-api-key.json         # Encrypted credential (optional)
```

All `id_*.json` and `cred_*.json` files are encrypted with Keystore V3 (scrypt + AES-128-CTR). The master password is never stored — `master.json` contains an encrypted sentinel value used to verify the password is correct.

### `wallets_config.json` structure

```json
{
  "config_version": 1,
  "active_wallet": "my-tron-wallet",
  "wallets": {
    "my-tron-wallet": {
      "type": "tron_local",
      "identity_file": "my-tron-wallet",
      "address": "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8"
    },
    "my-evm-wallet": {
      "type": "evm_local",
      "identity_file": "my-evm-wallet",
      "address": "0x8c71...4fe3"
    }
  }
}
```

---

## 15. Complete QA Test Checklist

### Installation

- [ ] `npm install -g @bankofai/agent-wallet` installs successfully
- [ ] `agent-wallet --help` shows help
- [ ] `agent-wallet -h` shows help
- [ ] `agent-wallet` (no args) shows help

### `init`

- [ ] `agent-wallet init` creates directory, prompts for password, prints success
- [ ] `agent-wallet init --dir ./test-dir` creates custom directory
- [ ] `agent-wallet init -d ./test-dir2` short form works
- [ ] Running `init` again on same dir prints `Already initialized: ...`
- [ ] Weak password is rejected with requirements list
- [ ] Mismatched confirm password prints `Passwords do not match.`
- [ ] `AGENT_WALLET_PASSWORD` env var skips password prompt
- [ ] Created directory has mode 700

### `add`

- [ ] `agent-wallet add` prompts for password, name, type, key action
- [ ] Generate: creates new key, prints address, saves `id_<name>.json`
- [ ] Import: accepts hex key (with and without `0x` prefix), saves correctly
- [ ] First wallet added is auto-set as active, prints `Active wallet set to '...'`
- [ ] Second wallet added does NOT change active wallet
- [ ] Duplicate wallet name prints `Wallet '...' already exists.`
- [ ] Invalid hex on import prints `Invalid hex string.`
- [ ] Wrong password prints `Error: Decryption failed`
- [ ] `evm_local` type derives correct `0x...` address
- [ ] `tron_local` type derives correct `T...` address (34 chars)

### `list`

- [ ] `agent-wallet list` shows all wallets with name, type, address
- [ ] Active wallet has `*` marker
- [ ] No wallets prints `No wallets configured.`
- [ ] Does not require password

### `use`

- [ ] `agent-wallet use <id>` sets active wallet, prints confirmation
- [ ] `agent-wallet use nonexistent` prints `Wallet '...' not found.`
- [ ] `agent-wallet use` (no id) prints usage
- [ ] After `use`, `list` shows `*` on the new active wallet

### `inspect`

- [ ] `agent-wallet inspect <id>` shows wallet details
- [ ] Shows `✓` when key file exists
- [ ] Shows `—` for missing credential
- [ ] `agent-wallet inspect nonexistent` prints not found
- [ ] `agent-wallet inspect` (no id) prints usage
- [ ] Does not require password

### `remove`

- [ ] `agent-wallet remove <id>` prompts for confirmation, deletes files
- [ ] `agent-wallet remove <id> --yes` skips confirmation
- [ ] `agent-wallet remove <id> -y` short form works
- [ ] Removing active wallet clears `active_wallet` to null
- [ ] After removal, `list` no longer shows the wallet
- [ ] `agent-wallet remove nonexistent` prints not found
- [ ] Declining confirmation prints `Cancelled.`

### `sign msg`

- [ ] `agent-wallet sign msg --message "Hello"` signs with active wallet
- [ ] `agent-wallet sign msg -m "Hello"` short form works
- [ ] `agent-wallet sign msg --wallet <id> --message "Hello"` uses specified wallet
- [ ] `agent-wallet sign msg -w <id> -m "Hello"` short forms work
- [ ] `--wallet` overrides active wallet
- [ ] No active wallet + no `--wallet` prints error message
- [ ] Not initialized prints `Wallet not initialized...`
- [ ] Wrong password prints error
- [ ] Wallet not found prints error
- [ ] `AGENT_WALLET_PASSWORD` env var skips password prompt
- [ ] Deterministic: same message + same key = same signature

### `sign tx`

- [ ] `agent-wallet sign tx --payload '{...}'` signs with active wallet
- [ ] `agent-wallet sign tx -p '{...}'` short form works
- [ ] `agent-wallet sign tx --wallet <id> --payload '{...}'` uses specified wallet
- [ ] JSON result is pretty-printed
- [ ] Invalid JSON payload prints error

### `sign typed-data`

- [ ] `agent-wallet sign typed-data --data '{...}'` signs with active wallet
- [ ] `agent-wallet sign typed-data --wallet <id> --data '{...}'` uses specified wallet
- [ ] Produces valid 65-byte signature (130 hex chars)
- [ ] Invalid JSON prints error
- [ ] EVM and TRON wallets both support EIP-712

### `change-password`

- [ ] Prompts for current, new, and confirm password
- [ ] Re-encrypts all files, prints each with `✓`
- [ ] Shows count of re-encrypted files
- [ ] Old password no longer works after change
- [ ] New password works after change
- [ ] Wrong current password prints error
- [ ] Weak new password is rejected
- [ ] Mismatched confirm prints `Passwords do not match.`

### `--dir` / `-d`

- [ ] All commands accept `--dir <path>`
- [ ] All commands accept `-d <path>`
- [ ] `~` in `--dir` is expanded correctly
- [ ] `AGENT_WALLET_DIR="~/custom"` env var is expanded correctly
- [ ] Different `--dir` values isolate wallet data completely

### Cross-cutting

- [ ] `AGENT_WALLET_PASSWORD` works for: `init`, `add`, `sign msg`, `sign tx`, `sign typed-data`
- [ ] `AGENT_WALLET_DIR` works for all commands
- [ ] Unknown command prints `Unknown command: ...`
- [ ] Unknown sign subcommand prints `Unknown sign subcommand: ...`
- [ ] `agent-wallet sign` (no subcommand) prints usage

---

## Next Steps

- Use the SDK programmatically — see [TypeScript README](../packages/typescript/README.md)
- Build and sign TRON transactions — see [examples/](../packages/typescript/examples/)
- Python version — see [Getting Started (Python)](./getting-started-python.md)
