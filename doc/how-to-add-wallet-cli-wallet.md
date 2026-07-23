# How to Add a wallet-cli Wallet

This guide shows how to add a TRON wallet backed by the
**[`@tron-walletcli/wallet-cli`](https://www.npmjs.com/package/@tron-walletcli/wallet-cli)**
binary to **agent-wallet CLI**, and confirm it can sign.

## What You Need

- **wallet-cli** installed and initialized (it owns the TRON keystore)
- **wallet-cli keystore password** (the password you set when running `wallet-cli init`)
- **Optional:** wallet-cli account label (e.g. `main-1`); omit to use the active account

> agent-wallet only signs — it delegates to wallet-cli via subprocess. It does
> not read or decrypt the wallet-cli keystore directly.

---

## Prerequisites

### 1. Install wallet-cli

```bash
npm install -g @tron-walletcli/wallet-cli
```

Verify the installation:

```bash
wallet-cli --version
```

> If `wallet-cli` is not on `PATH`, set `AGENT_WALLET_WALLET_CLI_PATH` to the
> full binary path.

### 2. Initialize wallet-cli keystore

```bash
wallet-cli init
```

This creates the wallet-cli keystore and sets its master password. **Remember
this password** — you will pass it to agent-wallet as `--cli-password`.

### 3. Create a TRON account

```bash
wallet-cli account create --label main-1
```

Verify the account and note the TRON address:

```bash
wallet-cli current -o json
```

---

## Quick Add (Recommended)

Use `add wallet_cli` to register a wallet-cli backed wallet in
`wallets_config.json`:

```bash
agent-wallet add wallet_cli \
  --wallet-id my_tron_cli \
  --account main-1 \
  --cli-password '<your-wallet-cli-keystore-password>'
```

Or interactively (the CLI will prompt for account and password):

```bash
agent-wallet add wallet_cli
```

You can also use `start wallet_cli` for first-time setup (creates the config
directory if needed and sets the wallet as active):

```bash
agent-wallet start wallet_cli \
  --wallet-id my_tron_cli \
  --account main-1 \
  --cli-password '<your-wallet-cli-keystore-password>'
```

---

## Inspect and Resolve Address

Check the wallet details:

```bash
agent-wallet inspect my_tron_cli
```

```
  Wallet              my_tron_cli
  Type                wallet_cli
  Account             main-1
  Keystore Password   [redacted]
```

Resolve the TRON address (calls `wallet-cli current`):

```bash
agent-wallet resolve-address my_tron_cli
```

```
  Wallet    my_tron_cli
  Type      wallet_cli
  Address   TMSgJxtPw29AFEHMXsjGo4kWV7UwbCToHJ
```

---

## Sign

wallet-cli wallets sign on **TRON** networks only. Use `--network` / `-n`
with a `tron:` value.

### Sign a Message

```bash
agent-wallet sign msg "hello" -n tron:nile -w my_tron_cli
```

### Sign Typed Data (EIP-712)

```bash
agent-wallet sign typed-data '{
  "domain": {},
  "types": {},
  "primaryType": "Order",
  "message": {}
}' -n tron:nile -w my_tron_cli
```

### Sign a Transaction

Pass an unsigned TRON transaction object (e.g. from `wallet-cli tx send --dry-run`
or TronGrid):

```bash
agent-wallet sign tx '{"raw_data_hex":"..."}' -n tron:nile -w my_tron_cli
```

> The `wallet_cli` adapter does not support `signRaw` (raw digest signing).
> Use `signTransaction` with an unsigned tx object instead.

---

## End-to-End: Build, Sign, Broadcast (SDK)

The `integrations/wallet-cli` module provides an optional orchestration helper
that chains wallet-cli build → agent-wallet sign → wallet-cli broadcast:

```ts
import { WalletCliSigner, WalletCliClient } from "@bankofai/agent-wallet";
import { signAndBroadcast } from "@bankofai/agent-wallet/integrations/wallet-cli";

const client = new WalletCliClient();
const wallet = new WalletCliSigner({ password: "keystore-pw", account: "main-1" }, client);

const result = await signAndBroadcast(wallet, client, {
  to: "T...",
  amount: "1",
  network: "tron:nile",
  wait: true,
});
console.log(result);
// { txId: '...', stage: 'confirmed', confirmed: true, blockNumber: '...' }
```

> `signAndBroadcast` requires explicit `confirmMainnet: true` for
> `tron:mainnet` as a safety guard against accidental mainnet broadcasts.

---

## FAQ

### 1. Do I need the agent-wallet master password for wallet_cli?
No. The `--cli-password` is the **wallet-cli keystore password**, stored in
`wallets_config.json` params. The agent-wallet master password (used for
`local_secure`) is not involved.

### 2. What if wallet-cli is not on PATH?
Set `AGENT_WALLET_WALLET_CLI_PATH` to the full binary path, or pass
`binary` to `WalletCliClient` in SDK code.

### 3. Does wallet_cli support EVM?
Not yet. wallet-cli currently supports TRON only; BSC (EVM) is planned. For EVM signing use `local_secure`, `raw_secret`,
or `privy`.

### 4. Where is the keystore password stored?
In `wallets_config.json` under `params.password` (file mode `0600`).
`inspect` redacts it.

---

## Summary

- **Prerequisite:** install + init wallet-cli, create a TRON account
- **Add:** `agent-wallet add wallet_cli --account <label> --cli-password <pw>`
- **Sign:** `agent-wallet sign msg/typed-data/tx -n tron:<network> -w <id>`
- **Orchestrate:** `signAndBroadcast` helper for build → sign → broadcast
