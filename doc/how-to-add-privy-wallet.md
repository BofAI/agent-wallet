# How to Add a Privy Wallet

This guide shows how to add an existing Privy wallet to **agent-wallet CLI** (using your current Privy App + Wallet ID) and confirm it can sign.

## What You Need

- **Privy App ID**
- **Privy App Secret** (keep it safe)
- **Privy Wallet ID** (from your Privy dashboard)

> This project only signs. It does not create or manage Privy wallets.

---

## Quick Add (Recommended)

Use `add privy` to add a Privy wallet into `wallets_config.json`.

```bash
agent-wallet add privy 
```

The CLI will guide you depending on your situation:

### A) First time adding Privy

You will be prompted for:

- Privy app id
- Privy app secret (input hidden)
- Privy wallet id

### B) You already have Privy wallets

You will see a selection prompt:

```
Select existing Privy wallet or enter new credentials
```

- Pick an existing Privy wallet → **reuse app id / app secret**
- Then **enter only the new Privy wallet id**

This lets you add multiple Privy wallets without retyping your app secret.

---

## Sign With an Existing Privy Wallet

### 1) Sign a Message

```bash
agent-wallet sign msg "hello" --wallet-id <your_privy_wallet_id> --dir /path/to/wallet-dir
```

### 2) Sign a Transaction (EVM)

**EVM tx** can use a viem-style payload:

```bash
agent-wallet sign tx '{
  "to": "0x0000000000000000000000000000000000000001",
  "chainId": 1,
  "gas": 21000,
  "nonce": 0,
  "maxFeePerGas": 1000000000,
  "maxPriorityFeePerGas": 1000000,
  "value": 0
}' --wallet-id <privy_evm_wallet> --dir /path/to/wallet-dir
```

> Privy EVM does not require `--network`. It follows the `chainId` in the payload.

### 3) Sign a Transaction (TRON)

TRON requires `raw_data_hex` (from TronGrid/Tron API unsigned tx):

```bash
agent-wallet sign tx '{
  "raw_data_hex": "abcd"
}' --wallet-id <privy_tron_wallet> --dir /path/to/wallet-dir
```

---

## FAQ

### 1) Can I reuse the same App ID with different Wallet IDs?
Yes. The CLI lets you reuse app id/secret and enter a new wallet id.

### 2) Do Privy EVM / TRON need `--network`?
No. Privy uses the wallet’s chain type. EVM uses the payload `chainId`.

### 3) Where are the credentials stored?
The app secret is stored in `wallets_config.json` (config provider). `inspect` redacts it.

---

## Advanced: Verify TRON typed-data signatures

Use the verification scripts to recover the TRON address and compare:

```bash
AGENT_WALLET_DIR=/path/to/wallet-dir \
AGENT_WALLET_PASSWORD='<your_password>' \
python packages/python/examples/verify_tron_privy_typed_data.py
```

TypeScript version:

```bash
AGENT_WALLET_DIR=/path/to/wallet-dir \
AGENT_WALLET_PASSWORD='<your_password>' \
npx tsx packages/typescript/examples/verify-tron-privy-typed-data.ts
```

---

## Summary

- **First time**: enter app id / app secret / wallet id
- **Afterwards**: select existing app id/secret → enter only new wallet id
- **EVM / TRON**: Privy does not need `--network`; provide chain-specific payloads
