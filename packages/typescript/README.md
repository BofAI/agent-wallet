# agent-wallet (TypeScript)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
![Node](https://img.shields.io/badge/node-≥18-blue.svg)

Universal multi-chain signing SDK for AI agents — TypeScript implementation.

> **Current release:** `3.0.0`. This is a breaking upgrade from 2.x; review the
> [3.0 migration guide](https://github.com/BofAI/agent-wallet/blob/main/doc/migration-v3.md)
> before upgrading.

從 2.x 升級請先閱讀
[3.0 遷移指南](https://github.com/BofAI/agent-wallet/blob/main/doc/migration-v3.md)與
[變更記錄](https://github.com/BofAI/agent-wallet/blob/main/CHANGELOG.md)。

## Install

```bash
npm install @bankofai/agent-wallet
# or
pnpm add @bankofai/agent-wallet
```

包含 CLI（`agent-wallet`）、EVM 與 TRON 支援。`wallet_cli` wallet type 會將
TRON/EVM transaction 與 typed-data 簽章委派給外部
[`@tron-walletcli/wallet-cli`](https://www.npmjs.com/package/@tron-walletcli/wallet-cli)
程序；核心 SDK 不讀取或解密它的 keystore。

## Quick Start

```ts
import { resolveWallet } from '@bankofai/agent-wallet'

const wallet = await resolveWallet({ network: 'tron:3448148188' })
const signedTx = await wallet.signTransaction({ txID: '...', raw_data: {} })
if (signedTx.family === 'tron') console.log(signedTx.transaction)
```

`resolveWallet` automatically finds your wallet config in `~/.agent-wallet` (or `AGENT_WALLET_DIR`).

## Public API

```ts
import {
  resolveWallet, // → Wallet (one-shot)
  resolveWalletProvider, // → ConfigWalletProvider | EnvWalletProvider
  ConfigWalletProvider, // 檔案配置 provider（raw_secret / privy / wallet_cli）
  EnvWalletProvider, // env-var-backed provider (AGENT_WALLET_PRIVATE_KEY)
} from '@bankofai/agent-wallet'

import {
  WalletCliAdapter, // TRON/EVM signing via wallet-cli subprocess
  WalletCliClient, // bounded wallet-cli transport + contract handshake
  StaticSecretProvider,
  ExecSecretProvider,
  ExternalSignerConfigResolver, // base class for external signer config resolvers
} from '@bankofai/agent-wallet/advanced'
```

wallet-cli 的選用鏈操作從獨立 subpath 匯出，而且刻意維持 **TRON-only**：

```ts
import {
  signAndBroadcast,
  buildTransfer,
  broadcast,
  getTxStatus,
} from '@bankofai/agent-wallet/integrations/wallet-cli'
```

直接呼叫 `buildTransfer` 時必須提供 `from`（TRON source address）；helper 會把它傳給
wallet-cli 的 `--account`，並拒絕 owner 不一致的未簽交易。`signAndBroadcast` 會自動使用
注入 `Wallet` 的 `getAddress()`。若 broadcast 已成功、後續 status query 失敗，會拋出
`WalletCliSubmittedTransactionError`，其中保留已知 `txId`、原始 `code` 與 `cause`，caller
應用該 txId 查詢，不應重送。

### resolveWallet

Returns a ready-to-sign `Wallet` for the given network:

```ts
const wallet = await resolveWallet({ network: 'eip155:1' })
const signed = await wallet.signTransaction({ to: '0x...', value: 0 })
if (signed.family === 'evm') console.log(signed.rawTransaction)
```

### resolveWalletProvider

Returns either `ConfigWalletProvider` or `EnvWalletProvider` based on what's available:

```ts
const provider = resolveWalletProvider({ network: 'eip155:1' })

// Get the active wallet
const wallet = await provider.getActiveWallet()

// Or a specific wallet (ConfigWalletProvider only)
const wallet2 = await provider.getWallet('my_wallet', 'tron:3448148188')
```

### Provider resolution order

1. `wallets_config.json` 存在且至少包含一個 wallet → `ConfigWalletProvider`
2. 否則 → `EnvWalletProvider`（讀取 `AGENT_WALLET_PRIVATE_KEY` / `AGENT_WALLET_MNEMONIC`）

## Wallet Interface

```ts
interface Wallet {
  getAddress(): Promise<string>
  signTransaction(
    payload: TransactionPayload,
    options?: SignOptions,
  ): Promise<SignedTransactionArtifact>
}

interface Eip712Capable {
  signTypedData(data: Record<string, unknown>, options?: SignOptions): Promise<string>
}

```

`SignedTransactionArtifact` 以 `family` 作為 discriminator：EVM 結果位於
`rawTransaction`，TRON 結果位於 `transaction`，呼叫端不需解析多態字串。

需要 EIP-712 簽章的 adapter 實作加法性的 `Eip712Capable`。agent-wallet 不公開
message signing；wallet-cli 本身的 message command 不在本 package 契約內。
`SignOptions.signal` 可取消 wallet-cli 子程序，取消與 timeout 都會釋放該次 secret lease。

## Wallet Types

| Type         | Networks   | Key source                               | Needs agent-wallet password |
| ------------ | ---------- | ---------------------------------------- | --------------------------- |
| `raw_secret` | EVM + TRON | Plaintext key/mnemonic in config or env  | No                          |
| `privy`      | EVM + TRON | Privy WaaS (app credentials + wallet ID) | No                          |
| `wallet_cli` | TRON + EVM | wallet-cli keystore（子程序委派）        | No                          |

`wallet_cli` password 是 **wallet-cli keystore credential**，不是 agent-wallet
master password。設定可保存明文字串以維持相容，但建議使用
`{ "exec": "/absolute/path/to/secret-script" }`；exec script 在每次簽章時重新執行，
取得的 one-shot secret 只寫入該次子程序 stdin。CLI 不接受 `--cli-password` 明文 argv，
請使用互動輸入或 `--cli-password-exec`。

## Network Routing

agent-wallet 的所有 network 入口只接受精確的 canonical CAIP-2 字串，不做 trim、
大小寫正規化、alias 展開或 namespace 改寫。

| Network string                   | Adapter             | Mnemonic derivation       |
| -------------------------------- | ------------------- | ------------------------- |
| `eip155:<positive-chain-id>`     | EVM                 | `m/44'/60'/0'/0/{index}`  |
| `tron:<positive-chain-id>`       | TRON (`raw_secret`) | `m/44'/195'/0'/0/{index}` |

例如 Ethereum mainnet 為 `eip155:1`，TRON mainnet 為 `tron:728126428`，Nile 為
`tron:3448148188`。裸 `eip155` / `tron`、`evm:1`、`tron:mainnet`、前後空白與
大小寫變體都會被拒絕。Privy 可依既有契約省略 network；一旦提供也適用相同規則。

Privy wallet 會以遠端 `chain_type` 驗證呼叫端要求的 network family；例如 EVM Privy
wallet 不可透過 `network: 'tron:728126428'` 使用。

`wallet_cli` 不使用本機 mnemonic routing，會把相同 canonical ID 原樣傳給 wallet-cli，
並以 network registry 與每次回應的 chain context 驗證 family、network 與 chainId。

## wallet-cli 發布契約

- `agent-wallet start/add wallet_cli` 只連結既有 account；在收集 password 前以
  `current [--account]` 驗證並保存 canonical accountId，不建立或匯入 wallet-cli key。
- optional peer 範圍為穩定版 `>=4.13.0 <5.0.0`，不會成為一般使用者的硬相依。
- 首次使用會依序執行 `-o json --version`、`-o json --json-schema`、
  `networks -o json` handshake，並驗證 target family 的 `tx.sign`、
  `typed-data.sign` 能力；meta probes 不並行，避免 wallet-cli 4.13 startup migration 競爭。
- startup migration 完成、取消或需密碼時，原命令不會自動重送；client 保留
  `migration_completed`、`migration_cancelled`、`migration_required` 分類並允許 caller
  在處理 migration 後重試。
- JavaScript entrypoint 使用目前的 Node 執行，需 Node.js >=20；一般 agent-wallet
  功能仍維持 package 的 Node.js >=18 契約。
- `WalletCliClient` 只接受 `wallet-cli.result.v1`，交叉檢查 exit status、command、
  chain context 與 command-specific data；未知加法欄位與 warning code 保持相容。
- 預設程序界線為 60 秒 timeout、5 秒 TERM→KILL grace、2 MiB stdout、64 KiB stderr；
  錯誤不回傳 argv payload、stdin 或原始 stdout/stderr。

詳細設定、Windows entrypoint、錯誤分類與 opt-in 真實測試請見
[wallet-cli 操作指南](../../doc/how-to-add-wallet-cli-wallet.md)。

## Environment Variables

| Variable                              | Description                                                       |
| ------------------------------------- | ----------------------------------------------------------------- |
| `AGENT_WALLET_DIR`                    | Wallet directory (default `~/.agent-wallet`)                      |
| `AGENT_WALLET_WALLET_CLI_PATH`        | Override wallet-cli binary path (default: auto-resolve from PATH) |
| `AGENT_WALLET_PRIVATE_KEY`            | Env fallback private key (hex)                                    |
| `AGENT_WALLET_MNEMONIC`               | Env fallback mnemonic phrase                                      |
| `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX` | Mnemonic account index (default `0`)                              |

`AGENT_WALLET_PRIVATE_KEY` 與 `AGENT_WALLET_MNEMONIC` 仍受支援；它們只定義秘密來源，
不隱含 network。解析錢包時仍須傳 canonical network，例如 `eip155:1` 或
`tron:728126428`。

`@tron-walletcli/wallet-cli` 是 **optional peer dependency**，只有使用
`wallet_cli` 時才需安裝相容的 4.x：

```bash
npm install '@tron-walletcli/wallet-cli@^4.13.0'
```

## Examples

- [tron-sign-and-broadcast.ts](./examples/tron-sign-and-broadcast.ts)
- [bsc-sign-and-broadcast.ts](./examples/bsc-sign-and-broadcast.ts)
- [tron-x402-sign-typed-data.ts](./examples/tron-x402-sign-typed-data.ts)
- [bsc-x402-sign-typed-data.ts](./examples/bsc-x402-sign-typed-data.ts)
- [dual-sign-typed-data-from-private-key.ts](./examples/dual-sign-typed-data-from-private-key.ts)
- [switch-active-wallet.ts](./examples/switch-active-wallet.ts)
- [wallet-cli-sign.ts](./examples/wallet-cli-sign.ts)

## Development

The published runtime supports Node.js >=18. Repository development uses ESLint 10 and therefore
requires Node.js `^20.19.0 || ^22.13.0 || >=24`.

```bash
pnpm install
pnpm test
```

## License

[MIT](../../LICENSE) — BankOfAI
