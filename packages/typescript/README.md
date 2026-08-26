# agent-wallet (TypeScript)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
![Node](https://img.shields.io/badge/node-≥18-blue.svg)

Universal multi-chain signing SDK for AI agents — TypeScript implementation.

## Install

```bash
npm install @bankofai/agent-wallet
# or
pnpm add @bankofai/agent-wallet
```

包含 CLI（`agent-wallet`）、EVM 與 TRON 支援。`wallet_cli` wallet type 會將
TRON/EVM transaction、typed-data 與 UTF-8 message 簽章委派給外部
[`@tron-walletcli/wallet-cli`](https://www.npmjs.com/package/@tron-walletcli/wallet-cli)
程序；核心 SDK 不讀取或解密它的 keystore。

## Quick Start

```ts
import { resolveWallet } from '@bankofai/agent-wallet'

const wallet = await resolveWallet({ network: 'tron:nile' })
const signedTx = await wallet.signTransaction({ txID: '...', raw_data: {} })
```

`resolveWallet` automatically finds your wallet config in `~/.agent-wallet` (or `AGENT_WALLET_DIR`).

## Public API

```ts
import {
  resolveWallet, // → Wallet (one-shot)
  resolveWalletProvider, // → ConfigWalletProvider | EnvWalletProvider
  ConfigWalletProvider, // 檔案配置 provider（raw_secret / privy / wallet_cli）
  EnvWalletProvider, // env-var-backed provider (AGENT_WALLET_PRIVATE_KEY)
  WalletCliAdapter, // TRON/EVM signing via wallet-cli subprocess
  WalletCliClient, // bounded wallet-cli transport + contract handshake
  StaticSecretProvider,
  ExecSecretProvider,
  ExternalSignerConfigResolver, // base class for external signer config resolvers
} from '@bankofai/agent-wallet'
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

### resolveWallet

Returns a ready-to-sign `Wallet` for the given network:

```ts
const wallet = await resolveWallet({ network: 'eip155:1' })
const sig = await wallet.signTransaction({ to: '0x...', value: 0 })
```

### resolveWalletProvider

Returns either `ConfigWalletProvider` or `EnvWalletProvider` based on what's available:

```ts
const provider = resolveWalletProvider({ network: 'eip155:1' })

// Get the active wallet
const wallet = await provider.getActiveWallet()

// Or a specific wallet (ConfigWalletProvider only)
const wallet2 = await provider.getWallet('my_wallet', 'tron:nile')
```

### Provider resolution order

1. `wallets_config.json` 存在且至少包含一個 wallet → `ConfigWalletProvider`
2. 否則 → `EnvWalletProvider`（讀取 `AGENT_WALLET_PRIVATE_KEY` / `AGENT_WALLET_MNEMONIC`）

## Wallet Interface

```ts
interface Wallet {
  getAddress(): Promise<string>
  signTransaction(payload: Record<string, unknown>, options?: SignOptions): Promise<string>
}

interface Eip712Capable {
  signTypedData(data: Record<string, unknown>, options?: SignOptions): Promise<string>
}

interface MessageSigningCapable {
  signMessage(message: Uint8Array, options?: SignOptions): Promise<string>
}
```

需要 EIP-712 或 message 簽章的 adapter 分別實作加法性的 `Eip712Capable` 與
`MessageSigningCapable`；`signMessage` 沒有變成所有 `Wallet` 的必要方法。
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

| Network string                 | Adapter             | Mnemonic derivation       |
| ------------------------------ | ------------------- | ------------------------- |
| `eip155` or `eip155:<chainId>` | EVM                 | `m/44'/60'/0'/0/{index}`  |
| `tron` or `tron:<chain>`       | TRON (`raw_secret`) | `m/44'/195'/0'/0/{index}` |

`wallet_cli` 不使用本機 mnemonic routing，並且比其他 adapter 更嚴格：必須傳完整
`tron:<name>` 或 `eip155:<positive-chain-id>`。裸 `tron`、裸 `eip155`、alias 與預設
mainnet 都會在啟動子程序前被拒絕；EVM target 會映射成 wallet-cli 的 `evm:<chain-id>`。

## wallet-cli 發布契約

- `agent-wallet start/add wallet_cli` 只連結既有 account；在收集 password 前以
  `current [--account]` 驗證並保存 canonical accountId，不建立或匯入 wallet-cli key。
- optional peer 範圍為穩定版 `>=4.12.0 <5.0.0`，不會成為一般使用者的硬相依。
- 首次使用會共同執行 `--version`、`--json-schema`、`networks -o json` handshake，
  並驗證 target family 的 `tx.sign`、`message.sign`、`typed-data.sign` 能力。
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

`@tron-walletcli/wallet-cli` 是 **optional peer dependency**，只有使用
`wallet_cli` 時才需安裝相容的 4.x：

```bash
npm install '@tron-walletcli/wallet-cli@^4.12.0'
```

## Examples

- [tron-sign-and-broadcast.ts](./examples/tron-sign-and-broadcast.ts)
- [bsc-sign-and-broadcast.ts](./examples/bsc-sign-and-broadcast.ts)
- [tron-x402-sign-typed-data.ts](./examples/tron-x402-sign-typed-data.ts)
- [bsc-x402-sign-typed-data.ts](./examples/bsc-x402-sign-typed-data.ts)
- [dual-sign-typed-data-from-private-key.ts](./examples/dual-sign-typed-data-from-private-key.ts)
- [switch-active-wallet.ts](./examples/switch-active-wallet.ts)

## Development

```bash
pnpm install
pnpm test
```

## License

[MIT](../../LICENSE) — BankOfAI
