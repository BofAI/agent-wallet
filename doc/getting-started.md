# Getting Started (From Source)

> This guide covers **local development setup** — installing from the cloned repository.
> For installing the published package via PyPI (`pip install agent-wallet`), see [Getting Started (PyPI)](./getting-started-pypi.md) (coming soon).

This guide walks you through setting up agent-wallet from source and using the CLI to manage wallets and sign transactions.

## Prerequisites

- Python ≥ 3.10
- Git

## 1. Clone and Install

```bash
git clone https://github.com/BofAI/agent-wallet.git
cd agent-wallet/packages/python

# Create a virtual environment (recommended)
python -m venv .venv
source .venv/bin/activate   # Linux/macOS
# .venv\Scripts\activate    # Windows

# Install with all extras (CLI + EVM + TRON)
pip install -e ".[all]"
```

Verify the installation:

```bash
agent-wallet --help
```

You should see:

```
Usage: agent-wallet [OPTIONS] COMMAND [ARGS]...

  Universal multi-chain secure signing SDK.

Commands:
  init             Initialize secrets directory and set master password.
  add              Add a new wallet (interactive).
  list             List all configured wallets.
  use              Set the active wallet.
  inspect          Show wallet details including address.
  remove           Remove a wallet and its associated files.
  sign             Sign transactions or messages.
  change-password  Change master password and re-encrypt all files.
```

## 2. Initialize

Create a secrets directory and set a master password. All private keys will be encrypted with this password.

```bash
agent-wallet init
```

```
Master password: ********
Confirm password: ********
Initialized. Secrets directory: /Users/you/.agent-wallet
```

> **Password requirements:** At least 8 characters, with uppercase, lowercase, digit, and special character.

You can specify a custom directory:

```bash
agent-wallet init --dir ./my-secrets
```

## 3. Add a Wallet

```bash
agent-wallet add
```

The interactive prompt will ask:

1. **Wallet name** — A unique identifier (e.g. `my-tron-wallet`)
2. **Wallet type** — `evm_local` or `tron_local`
3. **Private key** — Generate a new key or import an existing one (hex)

```
Master password: ********
Wallet name: my-tron-wallet
> Wallet type: tron_local
> Private key: import
Paste private key (hex): ********
Imported private key.
  Address: TJRabPrwbZy45sbavfcjinPJC18kjpRTv8
  Saved:   id_my-tron-wallet.json
Wallet 'my-tron-wallet' added. Config updated.
  Active wallet set to 'my-tron-wallet'.
```

The first wallet you add is automatically set as the **active wallet**. You can then sign without specifying `--wallet` each time.

## 4. Set Active Wallet

If you have multiple wallets, use the `use` command to switch the active wallet:

```bash
agent-wallet use my-evm-wallet
```

```
Active wallet: my-evm-wallet (evm_local)
```

The active wallet is used by default for all sign commands. You can always override it with `--wallet`.

## 5. List Wallets

```bash
agent-wallet list
```

```
              Wallets
┌───┬──────────────────┬────────────┬──────────────────┐
│   │ Name             │ Type       │ Address          │
├───┼──────────────────┼────────────┼──────────────────┤
│ * │ my-evm-wallet    │ evm_local  │ 0x8c71...4fe3    │
│   │ my-tron-wallet   │ tron_local │ TJRabPrw...RTv8  │
└───┴──────────────────┴────────────┴──────────────────┘
```

The `*` marker indicates the active wallet.

## 6. Inspect a Wallet

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

## 7. Sign

### Sign a message

The `--wallet` flag is optional if you have an active wallet set:

```bash
# Uses the active wallet
agent-wallet sign msg --message "Hello"

# Or specify a wallet explicitly
agent-wallet sign msg --wallet my-tron-wallet --message "Hello"
```

```
Signature: 4a9c8f...e71b
```

### Sign a transaction

Pass a JSON payload — for TRON, this is the unsigned transaction from TronGrid:

```bash
agent-wallet sign tx \
  --wallet my-tron-wallet \
  --payload '{"txID":"abc123...","raw_data_hex":"0a02...","raw_data":{...}}'
```

### Sign EIP-712 typed data

```bash
agent-wallet sign typed-data \
  --wallet my-tron-wallet \
  --data '{
    "types": {
      "EIP712Domain": [{"name":"name","type":"string"},{"name":"chainId","type":"uint256"}],
      "Transfer": [{"name":"to","type":"address"},{"name":"amount","type":"uint256"}]
    },
    "primaryType": "Transfer",
    "domain": {"name":"MyDApp","chainId":728126428},
    "message": {"to":"0x7099...79C8","amount":1000000}
  }'
```

## 8. Environment Variables

You can skip interactive password prompts by setting environment variables:

```bash
export AGENT_WALLET_PASSWORD="my-password"
export AGENT_WALLET_DIR="~/.agent-wallet"     # optional, this is the default
```

This is useful for scripts and CI/CD:

```bash
AGENT_WALLET_PASSWORD=my-password agent-wallet sign msg \
  --wallet my-tron-wallet \
  --message "Hello"
```

## 9. Other Commands

### Remove a wallet

```bash
agent-wallet remove my-tron-wallet
```

Deletes the encrypted key files and removes the wallet from config. Use `--yes` to skip confirmation.

### Change master password

```bash
agent-wallet change-password
```

Re-encrypts all key files with the new password.

## File Structure

After setup, your secrets directory looks like this:

```
~/.agent-wallet/
├── master.json              # Password verification sentinel
├── wallets_config.json      # Wallet configuration (names, types, addresses)
├── id_my-tron-wallet.json   # Encrypted private key (Keystore V3)
├── id_my-evm-wallet.json    # Encrypted private key (Keystore V3)
└── cred_my-tron-wallet.json # Encrypted API key (optional)
```

All `id_*.json` and `cred_*.json` files are encrypted with Keystore V3 (scrypt + AES-128-CTR). The master password is never stored — `master.json` contains an encrypted sentinel value used to verify the password is correct.

## Next Steps

- Use the SDK programmatically — see the [Python README](../packages/python/README.md#quick-start)
- Build and sign TRON transactions — see [tron_sign_and_broadcast.py](../packages/python/examples/tron_sign_and_broadcast.py)
- Build and sign BSC transactions — see [bsc_sign_and_broadcast.py](../packages/python/examples/bsc_sign_and_broadcast.py)
- Sign EIP-712 data for x402 — see [x402_sign_typed_data.py](../packages/python/examples/x402_sign_typed_data.py)
- Switch active wallet via SDK — see [switch_active_wallet.py](../packages/python/examples/switch_active_wallet.py)
