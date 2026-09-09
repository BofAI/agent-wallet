# Getting Started

> This guide covers the TypeScript `agent-wallet` CLI distributed through npm.

> **Release status:** this branch targets `3.0.0`, which is not yet published. Until the 3.0.0
> release, unversioned npm install commands resolve to the current `2.4.0` release and do not
> include the v3 commands documented here.

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
  start             Quick setup: init + configure wallet
  add               Add a wallet configuration
  list              List all configured wallets
  use [id]          Set the active wallet
  inspect <id>      Show wallet details
  resolve-address [id]  Resolve wallet addresses
  remove <id>       Remove a wallet
  sign              Sign transactions or typed data
  reset             Delete all wallet data

  --dir, -d <path>      Secrets directory path (default: ~/.agent-wallet)
  --help, -h            Show this help message
```

Running `agent-wallet` with no arguments shows the same help output.

Use `agent-wallet start --help`, `agent-wallet start raw_secret --help`, or `agent-wallet add privy --help` to inspect mode-specific flags locally.

---

## 2. Concepts

| Concept                     | Meaning                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wallet types**            | `raw_secret` — private key or mnemonic stored in **plaintext** inside `wallets_config.json` (dev only); `privy` — uses Privy app credentials plus wallet ID; `wallet_cli` — 金鑰由相容的 `@tron-walletcli/wallet-cli` 4.x 管理，透過受限子程序委派 TRON/EVM 簽章（見 [how-to-add-wallet-cli-wallet.md](./how-to-add-wallet-cli-wallet.md)）。 |
| **Signing network**         | Every `sign` subcommand requires `--network` / `-n` (e.g. `eip155:1`, `tron:3448148188`). The CLI picks EVM vs Tron **adapter** from this string.                                                                                                                                                                                                   |
| **Active wallet**           | Used when you omit `--wallet-id` / `-w` on `sign`. Set with `use <id>`.                                                                                                                                                                                                                                                                       |
| **Exec script credentials** | For `privy` and `wallet_cli` wallets, credentials can reference an executable script instead of storing plaintext in config. See [Exec Script Credentials](#exec-script-credentials) below.                                                                                                                                                   |

## 3. Quick start (`start`)

Creates or continues setup for one wallet id. Storage is created automatically — no separate `init` step needed.

```bash
agent-wallet start
agent-wallet start privy [options]
agent-wallet start wallet_cli [options]
```

`agent-wallet start` with no subcommand keeps the interactive quick-start flow.

Shared `start` options:

| Option               | Description                                                                          |
| -------------------- | ------------------------------------------------------------------------------------ |
| `--wallet-id` / `-w` | Wallet config ID (default in prompts: `default_raw`, `default_privy`, `default_cli`) |
| `-d` / `--dir`       | Secrets directory (default `~/.agent-wallet` or `AGENT_WALLET_DIR`)                  |
| `--override`         | Skip the "already initialized" confirmation when wallets already exist               |

`start raw_secret` options:

| Option                     | Description                                                |
| -------------------------- | ---------------------------------------------------------- |
| `-k` / `--private-key`     | Import hex private key                                     |
| `-m` / `--mnemonic`        | Import mnemonic                                            |
| `-mi` / `--mnemonic-index` | Mnemonic account index (default `0`)                       |
| `--derive-as`              | `eip155` or `tron` — mnemonic derivation when not prompted |

**`raw_secret`:** warns about plaintext storage. Private key or mnemonic is stored directly in `wallets_config.json`.

`start privy` options:

| Option              | Description                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `--app-id`          | Privy app id                                                                               |
| `--app-secret`      | Privy app secret                                                                           |
| `--app-secret-exec` | Privy app secret via exec script (see [Exec Script Credentials](#exec-script-credentials)) |
| `--privy-wallet-id` | Existing Privy wallet id                                                                   |

`start wallet_cli` options:

| Option                | Description                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `--account`           | Existing wallet-cli account label/id (optional; resolves the active account if omitted)       |
| `--cli-password`      | 只供互動提示內部使用；CLI 會拒絕明文 argv                                                     |
| `--cli-password-exec` | wallet-cli password via exec script (see [Exec Script Credentials](#exec-script-credentials)) |

**`wallet_cli`：** 連結由 wallet-cli 持有金鑰的既有 TRON/EVM account；不建立或匯入
wallet-cli key。CLI 會在詢問 password 前驗證 account descriptor，並把 canonical accountId
寫入新 config。需要穩定版
`@tron-walletcli/wallet-cli >=4.13.0 <5.0.0` 位於 PATH，或設定
`AGENT_WALLET_WALLET_CLI_PATH`。Windows 建議指定 package JavaScript entrypoint；詳見
[how-to-add-wallet-cli-wallet.md](./how-to-add-wallet-cli-wallet.md)。

When **`start` creates a new wallet**, that wallet is set as **active** (`set_active`). Re-running `start` for an **existing** wallet id only lists it — active wallet is unchanged unless you use `use`.

## 4. `add`

```bash
agent-wallet add [options]
agent-wallet add <raw_secret|privy|wallet_cli> [options]
```

Adds a wallet configuration. `privy` and `wallet_cli` link existing external wallets; they do not
create wallets in those systems. Storage is created automatically if needed.

`add` shares the same subcommand options as `start` (see above), plus:

| Option               | Description       |
| -------------------- | ----------------- |
| `--wallet-id` / `-w` | Wallet config ID  |
| `-d` / `--dir`       | Secrets directory |

The added wallet becomes active if no active wallet was previously set.

## 5. `list`

```bash
agent-wallet list [-d DIR]
```

Table: active marker `*`, wallet id, type.

## 6. `use`

```bash
agent-wallet use [wallet_id] [-d DIR]
```

## 7. `inspect`

```bash
agent-wallet inspect <wallet_id> [-d DIR]
```

Shows type and redacted secret metadata.

## 8. `resolve-address`

```bash
agent-wallet resolve-address [wallet_id] [-d DIR]
```

Resolves and prints the wallet address or addresses without signing.

- If `wallet_id` is omitted, the CLI prompts you to select a wallet interactively.
- `raw_secret` wallets print both EVM and TRON addresses derived from the same secret material.
- `privy` wallets print the hosted wallet address returned by Privy.
- `wallet_cli` 直接透過 handshake/`current` 解析地址，不取得 password；descriptor 同時含
  EVM/TRON 時顯示兩個 whitelist entries，只有一個 family 時顯示單一地址。

## 9. `remove`

```bash
agent-wallet remove [wallet_id] [-d DIR] [--yes|-y]
```

If `wallet_id` is omitted, the CLI prompts you to select a wallet interactively before confirmation.

If you remove the active wallet and other wallets still exist, the CLI can optionally prompt you to choose a new active wallet immediately.

## 10. `sign`

簽章 subcommand 都接受 **`--network` / `-n`**；`raw_secret` 與 `wallet_cli` 需要此值，
Privy EVM 可依 payload chainId 運作。只接受精確的 canonical CAIP-2：
`eip155:<positive-chain-id>` 或 `tron:<positive-chain-id>`；不會正規化 alias、大小寫或空白。

```bash
agent-wallet sign tx '<json>' -n eip155:1 [-w WALLET_ID] ...
agent-wallet sign typed-data '<json>' -n eip155:1 [-w WALLET_ID] ...
```

| Option        | Short | Description                                                    |
| ------------- | ----- | -------------------------------------------------------------- |
| `--wallet-id` | `-w`  | Wallet id (defaults to active)                                 |
| `--network`   | `-n`  | `raw_secret` / `wallet_cli` 必填；例如 `eip155:1`、`tron:3448148188` |
| `--dir`       | `-d`  | Secrets directory                                              |

- **`raw_secret` wallets:** signs directly with the stored private key.
- **`privy` wallets:** delegates signing to the Privy API. EVM does not require `--network`; it follows the `chainId` in the payload. If supplied, `--network` must be canonical CAIP-2.
- **`wallet_cli` wallets：** 支援 TRON/EVM transaction 與 typed-data。
  必須使用 `tron:<positive-chain-id>` 或 `eip155:<positive-chain-id>`；裸 family、alias 與省略值會
  在子程序及 secret acquire 前 fail-fast。簽章結果會核對固定 account/network/signer。

Signed tx 使用 typed artifact：TRON transaction object 會 pretty-print，EVM
`rawTransaction` 會直接輸出 hex。

## 11. `reset`

```bash
agent-wallet reset [-d DIR] [--yes|-y]
```

Deletes **only managed** JSON files: `wallets_config.json`. Other `*.json` in the directory are left intact.

Requires config to exist; otherwise prints that no wallet data was found.

## 12. Environment variables

| Variable                              | Role                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AGENT_WALLET_DIR`                    | Default secrets directory                                                                |
| `AGENT_WALLET_WALLET_CLI_PATH`        | 覆寫 wallet-cli executable 或 JavaScript entrypoint；未設定時依 optional peer、PATH 解析 |
| `AGENT_WALLET_PRIVATE_KEY`            | Private key for SDK env fallback                                                         |
| `AGENT_WALLET_MNEMONIC`               | Mnemonic for SDK env fallback                                                            |
| `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX` | Account index for mnemonic derivation                                                    |

## 13. File layout

```
~/.agent-wallet/          (mode 700)
└── wallets_config.json   # active_wallet + wallet entries
```

### Example `wallets_config.json`

```json
{
  "active_wallet": "my_wallet",
  "wallets": {
    "my_wallet": {
      "type": "raw_secret",
      "params": {
        "source": "private_key",
        "private_key": "0x..."
      }
    }
  }
}
```

### Example with exec script credentials

```json
{
  "active_wallet": "my_cli_wallet",
  "wallets": {
    "my_cli_wallet": {
      "type": "wallet_cli",
      "params": {
        "account": "main-1",
        "password": { "exec": "/path/to/fetch-password.sh" }
      }
    }
  }
}
```

## Exec Script Credentials

For `privy` and `wallet_cli` wallets, credentials (app secret, keystore password) can be provided as either a plaintext string or a `SecretRef` object referencing an exec script.

### Why?

This lets you integrate with secret management tools (1Password CLI, etc.) without storing secrets in plaintext config files. The script inherits `process.env`, so session-based tools work automatically.

### How it works

1. Create an executable script that prints the secret to stdout.
2. Reference it in config via `{ "exec": "/path/to/script.sh" }` or pass it via CLI flags `--cli-password-exec` / `--app-secret-exec`.

script stdout 會 trim 後作為 credential。對 wallet-cli 而言，exec 在每次簽章時重新執行，
形成只可寫入一次的 secret lease；成功、失敗、timeout 或取消都會 dispose。預設 10 秒
timeout，並有 stdout/stderr 上限，錯誤不附原始輸出。

### Interactive prompt

When adding a wallet interactively, you can choose between direct input and exec script:

```
? wallet-cli keystore password source
❯ direct   Enter value directly
  exec     Use exec script (e.g. 1Password CLI)
```

### Example: 1Password CLI

```bash
#!/bin/sh
op read 'op://Private/wallet-cli-password/password'
```

```bash
agent-wallet start wallet_cli \
  --wallet-id my_cli_wallet \
  --account main-1 \
  --cli-password-exec /path/to/fetch-password.sh
```

## 14. Non-interactive tips

- Pass `-k`, `-m`, `--derive-as`, `--wallet-id`, and `-n` so scripts never prompt.
- CI 使用 `--cli-password-exec` / `--app-secret-exec`，不要把秘密放進 command line；
  `--cli-password <plaintext>` 會被拒絕。
- TTY-only prompts: use explicit flags in CI.

## Next steps

- **TypeScript** — `packages/typescript/README.md` (npm CLI)
- Resolver helpers — `resolveWallet`, `resolveWalletProvider` in the TypeScript package
