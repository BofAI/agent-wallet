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

---

## 2. Quick Start (`start`)

The `start` command is the fastest way to get up and running. It initializes the secrets directory and creates default wallets in one step.

### Option A: Auto-generate everything

```bash
$ agent-wallet start
```

The system generates a strong password and creates both a TRON and an EVM wallet:

```
🔐 Wallet initialized!

🪙 Wallets:
┌──────────────────────┬─────────────────┬──────────────────────────────────────────────┐
│ Wallet ID            │ Type            │ Address                                      │
├──────────────────────┼─────────────────┼──────────────────────────────────────────────┤
│ default_tron         │ tron_local      │ TB37CfKbRacD6TUBNPK7GirUheUJwbAGH5           │
│ default_evm          │ evm_local       │ 0xd679B660f6b331e1fdA877cee0aAd361A7f3b628   │
└──────────────────────┴─────────────────┴──────────────────────────────────────────────┘

⭐ Active wallet: default_tron

🔑 Your master password: E&LCi*KL1Sp4mg4!
   ⚠️  Save this password! You'll need it for signing and other operations.

💡 Quick guide:
   agent-wallet list              — View your wallets
   agent-wallet sign tx '{...}'   — Sign a transaction
   agent-wallet start -h          — See all options
```

> **Important:** Save the generated password! You will need it for signing and other operations.

### Option B: Choose your own password

```bash
$ agent-wallet start -p Abc12345!
```

```
🔐 Wallet initialized!

🪙 Wallets:
┌──────────────────────┬─────────────────┬──────────────────────────────────────────────┐
│ Wallet ID            │ Type            │ Address                                      │
├──────────────────────┼─────────────────┼──────────────────────────────────────────────┤
│ default_tron         │ tron_local      │ TDgDdhmGhUUbQyDwGGbwKpDs4yFCmnM4Ey           │
│ default_evm          │ evm_local       │ 0x46Fa9c2b9c8E693eF19ACfA5e85E1dF38d59CF24   │
└──────────────────────┴─────────────────┴──────────────────────────────────────────────┘

⭐ Active wallet: default_tron

💡 Quick guide:
   agent-wallet list              — View your wallets
   agent-wallet sign tx '{...}'   — Sign a transaction
   agent-wallet start -h          — See all options
```

No password is printed because you chose it yourself.

### Option C: Import an existing private key

```bash
$ agent-wallet start -p Abc12345! -i tron
```

You'll be prompted to paste your private key:

```
🔐 Wallet initialized!
✔ Paste private key (hex)

🪙 Imported wallet:
┌──────────────────────┬─────────────────┬──────────────────────────────────────────────┐
│ Wallet ID            │ Type            │ Address                                      │
├──────────────────────┼─────────────────┼──────────────────────────────────────────────┤
│ default_tron         │ tron_local      │ TNmoJ3Be59WFEq5dsW6eCkZjveiL3G8HVB           │
└──────────────────────┴─────────────────┴──────────────────────────────────────────────┘

⭐ Active wallet: default_tron

💡 Quick guide:
   agent-wallet list              — View your wallets
   agent-wallet sign tx '{...}'   — Sign a transaction
   agent-wallet start -h          — See all options
```

The `-i` flag accepts: `tron`, `evm`, `tron_local`, `evm_local`.

### Idempotent

Running `start` again is safe — it won't error or overwrite existing wallets. It will show your existing wallet info instead.

### Options

| Flag | Short | Description |
|---|---|---|
| `--password` | `-p` | Master password (auto-generated if omitted) |
| `--import` | `-i` | Import wallet type: `tron`, `evm`, `tron_local`, `evm_local` |
| `--dir` | `-d` | Secrets directory path (default: `~/.agent-wallet`) |

---

## 3. `init` — Initialize Secrets Directory

Create a secrets directory and set a master password. All private keys will be encrypted with this password.

```bash
$ agent-wallet init
```

Interactive prompts:

```
Master password: ********
Confirm password: ********
Initialized. Secrets directory: /home/you/.agent-wallet
```

**Password requirements:** At least 8 characters, with at least 1 uppercase letter, 1 lowercase letter, 1 digit, and 1 special character.

### Skip the password prompt

```bash
$ agent-wallet init -p "MyP@ssw0rd!"
```

### Custom directory

```bash
$ agent-wallet init -d ./my-secrets
```

### What it creates

```
~/.agent-wallet/          (mode 700)
├── master.json           # Encrypted sentinel for password verification
└── wallets_config.json   # Empty wallet config {"config_version":1,"wallets":{},"active_wallet":null}
```

> **Tip:** Most users should use `agent-wallet start` instead — it does `init` + creates default wallets in one step.

---

## 4. `add` — Add a New Wallet

```bash
$ agent-wallet add
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

### Skip the password prompt

```bash
$ agent-wallet add -p "MyP@ssw0rd!"
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

### Auto-active behavior

- The **first** wallet you add is automatically set as the active wallet.
- Subsequent `add` commands do **not** change the active wallet.

### Error cases

| Scenario | Output |
|---|---|
| Wrong password | `❌ Wrong password. Please try again.` |
| Duplicate wallet name | `Wallet 'my-tron-wallet' already exists.` |
| Invalid hex on import | `Invalid hex string.` |

---

## 5. `list` — List All Wallets

```bash
$ agent-wallet list
```

Expected output:

```
Wallets:
┌──────────────────────┬─────────────────┬──────────────────────────────────────────────┐
│ Wallet ID            │ Type            │ Address                                      │
├──────────────────────┼─────────────────┼──────────────────────────────────────────────┤
│* my-tron-wallet      │ tron_local      │ TJRabPrwbZy45sbavfcjinPJC18kjpRTv8           │
│  my-evm-wallet       │ evm_local       │ 0x8c714fe3...                                │
└──────────────────────┴─────────────────┴──────────────────────────────────────────────┘
```

- `*` marks the active wallet.
- No password required for this command.

### Empty state

If no wallets are configured:

```
No wallets configured.
```

---

## 6. `use <id>` — Set Active Wallet

```bash
$ agent-wallet use my-evm-wallet
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

## 7. `inspect <id>` — Show Wallet Details

```bash
$ agent-wallet inspect my-tron-wallet
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

---

## 8. `remove <id>` — Remove a Wallet

```bash
$ agent-wallet remove my-tron-wallet
```

Interactive confirmation:

```
Remove wallet 'my-tron-wallet'? (y/N): y
  Deleted: id_my-tron-wallet.json
Wallet 'my-tron-wallet' removed.
```

### Skip confirmation

```bash
$ agent-wallet remove my-tron-wallet --yes
# or
$ agent-wallet remove my-tron-wallet -y
```

### Active wallet behavior

If you remove the currently active wallet, `active_wallet` is automatically cleared to `null`.

---

## 9. `sign msg` — Sign a Message

Message is passed as a **positional argument**:

```bash
$ agent-wallet sign msg "Hello"
```

```
Master password: ********
Signature: 4a9c8f...e71b
```

### Skip the password prompt

```bash
$ agent-wallet sign msg "Hello" -p "MyP@ssw0rd!"
```

### Specifying a wallet explicitly

```bash
$ agent-wallet sign msg "Hello" -w my-tron-wallet
```

### Error cases

| Scenario | Output |
|---|---|
| No active wallet and no `--wallet` | `No wallet specified and no active wallet set.` |
| Not initialized | `Wallet not initialized. Run 'agent-wallet init' first.` |
| Wrong password | `❌ Wrong password. Please try again.` |

---

## 10. `sign tx` — Sign a Transaction

Transaction payload is passed as a **positional argument** (JSON string):

```bash
$ agent-wallet sign tx '{"txID":"abc123...","raw_data_hex":"0a02...","raw_data":{...}}'
```

```
Master password: ********
Signed tx:
{
  "txID": "abc123...",
  "signature": ["..."]
}
```

### Skip the password prompt

```bash
$ agent-wallet sign tx '{"txID":"abc123..."}' -p "MyP@ssw0rd!"
```

### Specifying a wallet

```bash
$ agent-wallet sign tx '{"txID":"abc123..."}' -w my-tron-wallet -p "MyP@ssw0rd!"
```

If the signed result is valid JSON, it's pretty-printed. Otherwise it's printed as a raw string.

### Options

| Flag | Short | Description |
|---|---|---|
| `--wallet` | `-w` | Wallet ID (uses active wallet if omitted) |
| `--password` | `-p` | Master password (skip interactive prompt) |

---

## 11. `sign typed-data` — Sign EIP-712 Typed Data

Typed data is passed as a **positional argument** (JSON string):

```bash
$ agent-wallet sign typed-data '{
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
| `--wallet` | `-w` | Wallet ID (uses active wallet if omitted) |
| `--password` | `-p` | Master password (skip interactive prompt) |

---

## 12. `change-password` — Change Master Password

```bash
$ agent-wallet change-password
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

### Skip the current password prompt

```bash
$ agent-wallet change-password -p "CurrentP@ss!"
```

---

## 13. `reset` — Delete All Wallet Data

```bash
$ agent-wallet reset
```

Interactive double-confirmation:

```
⚠️  This will delete ALL wallet data in: /home/you/.agent-wallet
   3 file(s): master.json, wallets_config.json, id_default_tron.json

Are you sure you want to reset? This cannot be undone. (y/N): y
Really delete everything? Last chance! (y/N): y
  🗑️  Deleted: master.json
  🗑️  Deleted: wallets_config.json
  🗑️  Deleted: id_default_tron.json

✅ Wallet data reset complete.
```

### Skip confirmation

```bash
$ agent-wallet reset --yes
# or
$ agent-wallet reset -y
```

### Error cases

| Scenario | Output |
|---|---|
| No wallet data found | `⚠️  No wallet data found in: ...` |

---

## 14. Environment Variables

| Variable | Description | Default |
|---|---|---|
| `AGENT_WALLET_PASSWORD` | Skip interactive password prompt | (none) |
| `AGENT_WALLET_DIR` | Secrets directory path (supports `~`) | `~/.agent-wallet` |

### Non-interactive usage (CI/CD, scripts)

```bash
$ export AGENT_WALLET_PASSWORD="MyP@ssw0rd!"
$ export AGENT_WALLET_DIR="~/.agent-wallet"

# All commands will use these values without prompting
$ agent-wallet sign msg "Hello"
$ agent-wallet sign tx '{"txID":"..."}'
```

Single-line usage:

```bash
$ AGENT_WALLET_PASSWORD="MyP@ssw0rd!" agent-wallet sign msg "Hello"
```

> **Tip:** You can also use the `-p` flag on any command instead of the environment variable:
> ```bash
> $ agent-wallet sign msg "Hello" -p "MyP@ssw0rd!"
> ```

---

## 15. `--dir` / `-d` — Custom Directory

All commands accept `--dir` (or `-d`) to specify a custom secrets directory:

```bash
$ agent-wallet start --dir ./my-secrets
$ agent-wallet init --dir ./my-secrets
$ agent-wallet add --dir ./my-secrets
$ agent-wallet list --dir ./my-secrets
$ agent-wallet use my-wallet --dir ./my-secrets
$ agent-wallet inspect my-wallet --dir ./my-secrets
$ agent-wallet remove my-wallet --dir ./my-secrets
$ agent-wallet sign msg "Hello" --dir ./my-secrets
$ agent-wallet sign tx '...' --dir ./my-secrets
$ agent-wallet sign typed-data '...' --dir ./my-secrets
$ agent-wallet change-password --dir ./my-secrets
$ agent-wallet reset --dir ./my-secrets
```

Tilde expansion is supported:

```bash
$ agent-wallet list --dir ~/custom-wallets
```

---

## 16. File Structure

After setup with two wallets, your secrets directory looks like:

```
~/.agent-wallet/                 (mode 700)
├── master.json                  # Encrypted sentinel for password verification
├── wallets_config.json          # Wallet config (names, types, addresses, active_wallet)
├── id_default_tron.json         # Encrypted private key (Keystore V3)
├── id_default_evm.json          # Encrypted private key (Keystore V3)
└── cred_my-api-key.json         # Encrypted credential (optional)
```

All `id_*.json` and `cred_*.json` files are encrypted with Keystore V3 (scrypt + AES-128-CTR). The master password is never stored — `master.json` contains an encrypted sentinel value used to verify the password is correct.

### `wallets_config.json` structure

```json
{
  "config_version": 1,
  "active_wallet": "default_tron",
  "wallets": {
    "default_tron": {
      "type": "tron_local",
      "identity_file": "default_tron",
      "address": "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8"
    },
    "default_evm": {
      "type": "evm_local",
      "identity_file": "default_evm",
      "address": "0x8c71...4fe3"
    }
  }
}
```

---

## Next Steps

- Use the SDK programmatically — see [TypeScript README](../packages/typescript/README.md)
- Build and sign TRON transactions — see [examples/](../packages/typescript/examples/)
- Python version — see [Getting Started (Python)](./getting-started-python.md)
