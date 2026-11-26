# 變更記錄

本文件記錄 `@bankofai/agent-wallet` 的使用者可見變更。版本遵循
[Semantic Versioning](https://semver.org/)。

## [Unreleased]

## [3.1.0] - 2026-10-30

### Changed

- 將 `3.1.0-beta.1` 的 Zod 4、WebSocket 安全修補與 ESM/CJS 型別修正納入正式版。
- 自訂 `WalletCliClient.run` 的 `dataSchema` 必須使用 Zod `>=4.6.6`；
  錢包設定格式與預設值維持不變。
- Node.js 需求為 `^22.23.4 || ^24.22.1 || >=26.12.1`。

## [3.1.0-beta.1] - 2026-10-29

### Breaking changes

- Upgrade to native Zod 4 (`>=4.6.6`). Caller-defined `WalletCliClient.run`
  `dataSchema` values must also use Zod 4. Wallet configuration formats and
  default values are preserved.
- 套件執行、開發環境與 wallet-cli JavaScript entrypoint 的 Node.js 版本要求提高為
  `^22.23.4 || ^24.22.1 || >=26.12.1`，排除已停止維護及尚未套用 2026 年 10 月安全修補的版本。
- CI 改用 Node.js 24.22.1；wallet-cli 執行前會檢查完整版本並拒絕預發布版。

### Fixed

- Upgrade viem and the TronWeb test dependency so both dependency chains use
  `ws@8.21.0`, addressing fragment/chunk memory exhaustion and TypedArray
  close-reason memory disclosure.
- Resolve matching ESM and CommonJS declarations for every public entry point.
- Reject oversized bounded schema collections before validating child elements.

## [4.0.0-beta.1] - 2026-10-29

- Deprecated prerelease. Use `3.1.0-beta.1` for the Zod 4 and WebSocket security updates.

## [3.0.0] - 2026-09-10

### Breaking changes

- 移除 `local_secure` wallet type、agent-wallet master password、
  `runtime_secrets.json` 與 `AGENT_WALLET_PASSWORD` 流程。
- `Wallet.signTransaction()` 不再回傳多態字串，改為以 `family` 區分的
  `SignedTransactionArtifact`：EVM 使用 `rawTransaction`，TRON 使用 `transaction`。
- 從公開契約移除 `signRaw()`、`signMessage()` 與 CLI `sign message`；agent-wallet
  目前只提供 transaction 與 typed-data 簽章。
- `ConfigWalletProvider` constructor 改為 `new ConfigWalletProvider(dir, options)`，
  不再接收 password 與 secret loader positional arguments。
- adapter、client、secret lifecycle 與 config resolver 等低階 API 移至
  `@bankofai/agent-wallet/advanced`；主入口只保留穩定的 wallet/provider API。
- 移除公開的 runtime external-signer registration API。wallet type 由封閉且可驗證的
  `WalletConfigSchema` 定義。
- 移除舊 TRON 環境變數 alias：`TRON_PRIVATE_KEY`、`TRON_MNEMONIC`、
  `TRON_ACCOUNT_INDEX`。請改用 `AGENT_WALLET_*` 變數。
- `@tron-walletcli/wallet-cli` 的相容範圍改為 `>=4.13.0 <5.0.0`；不相容 4.12.x。

### Added

- 新增 `wallet_cli` wallet type，支援委派 TRON/EVM transaction 與 typed-data 簽章。
- 新增 `@bankofai/agent-wallet/advanced` 與
  `@bankofai/agent-wallet/integrations/wallet-cli` subpath exports。
- 新增 typed transaction payload/artifact、可取消的 `SignOptions.signal`，以及
  wallet-cli protocol handshake、identity/network 驗證與受限子程序執行。
- Privy 與 wallet-cli credential 支援 `{ "exec": "/absolute/script" }` secret refs。

### Fixed

- 移除 wallet 後會正確驅逐該 ID 的所有 cached adapters，避免同 ID 重建時沿用舊 credential。
- wallet-cli compatibility handshake 會串行執行 metadata probes，辨識 startup migration
  完成、取消與需密碼狀態，並在 migration 邊界後允許 caller 明確重試。
- 將 `@inquirer/prompts` 固定於支援 Node.js 18 的 7.x 系列，使 CLI runtime dependency
  與 package 的 Node.js `>=18` 契約一致。
- Windows `.cmd`/`.bat` secret exec 使用固定 quoting，並拒絕可能觸發
  `cmd.exe` expansion/escaping 的不安全路徑。

完整升級步驟請見 [3.0 遷移指南](./doc/migration-v3.md)。
