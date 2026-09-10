# 變更記錄

本文件記錄 `@bankofai/agent-wallet` 的使用者可見變更。版本遵循
[Semantic Versioning](https://semver.org/)。

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
