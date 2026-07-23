# 需求文件

## 簡介

本規格定義將 wallet-cli 整合為 agent-wallet 之 TRON 本地簽名後端的需求。wallet-cli 後續將替代 agent-wallet 自有的 `local_secure`/`local`/`raw_secret`（TRON 部分），成為 TRON 金鑰的擁有者與簽名來源；agent-wallet 透過子程序委派簽名，金鑰儲存交由 wallet-cli 的加密 keystore 擁有。整合範圍涵蓋簽名適配器、配置模型、子程序互動、錯誤處理、擴充性（為後續外部錢包預留）、安裝與相依，以及選用的鏈操作編排。EVM 簽名與 Privy 不受影響。

需求聚焦於可驗證的行為，並與 `design.md` 之設計決策一一對應。

## 需求

### 需求 1：wallet-cli 簽名後端整合
**目標：** 作為整合者，我希望能透過 wallet-cli 對 TRON 交易、訊息與型別化資料進行簽名，以便 agent-wallet 能以 wallet-cli 作為 TRON 本地簽名來源。

#### 驗收準則
1. 當使用者配置 `wallet_cli` 錢包類型時，agent-wallet 系統應透過 `WalletCliAdapter`（實作 `Wallet` 與 `Eip712Capable` 介面）提供簽名能力。
2. 當呼叫 `getAddress()` 時，agent-wallet 系統應以 `wallet-cli current` 子程序取得 TRON base58 位址，並快取結果以避免重複呼叫。
3. 當呼叫 `signTransaction(payload)` 時，agent-wallet 系統應以 `wallet-cli tx sign` 子程序產生已簽名交易，並回傳 `JSON.stringify(data.signed)` 以符合既有 `TronSigner` 輸出慣例。
4. 當呼叫 `signMessage(msg)` 時，agent-wallet 系統應將 `Uint8Array` 以 UTF-8 解碼為文字，以 `wallet-cli message sign` 子程序簽名，並去除回傳簽名的 `0x` 前綴。當呼叫 `signTypedData(data)` 時，應以 `wallet-cli typed-data sign` 子程序簽名（標準 EIP-712 JSON，形狀相容），並去除回傳簽名的 `0x` 前綴。**語意注意**：`signMessage` 簽的是 UTF-8 文字（EIP-191 personal_sign），與 `TronSigner`（直接 keccak256 位元組）語意有別；純 ASCII 訊息一致，非 UTF-8 位元組簽名會不同。
5. 當呼叫 `signRaw(rawTx)` 時，agent-wallet 系統應拋出 `UnsupportedOperationError`，因 wallet-cli 無對應指令且其 `message sign`（EIP-191）與 `signRaw`（keccak256 後簽名）語意不同。
6. 當 `wallet_cli` 錢包類型被選用時，agent-wallet 系統不應自行解密或持有 wallet-cli 的明文私鑰；金鑰應全程留在 wallet-cli 進程內。

### 需求 2：密碼模型——config-stored 憑證
**目標：** 作為營運者，我希望能以與 Privy `app_secret` 一致的方式管理 wallet-cli keystore 密碼，以便密碼作為外部簽名後端憑證獨立於 agent-wallet 主密碼管理。

#### 驗收準則
1. agent-wallet 系統應將 wallet-cli keystore 密碼儲存於 `wallets_config.json` 的 `wallet_cli` 類型 params（`params.password`），而非經 agent-wallet 主密碼解析路徑（`AGENT_WALLET_PASSWORD` / runtime secrets / 加密 KV）。
2. 當建構 `wallet_cli` adapter 時，`createAdapter` 應不使用 agent-wallet 主密碼參數（與 Privy 分支一致）。
3. 當 `wallet_cli` 條目缺少 `password` 時，agent-wallet 系統應在 config 解析階段（resolver）fail-fast 拋出 `WalletCliConfigError`，早於任何簽名呼叫。
4. agent-wallet 系統不應為 wallet-cli 密碼提供環境變數覆寫（與 Privy `app_secret` 一致：`EnvWalletProvider` 僅處理 `raw_secret`）。
5. 當判斷錢包是否「無需 agent-wallet 主密碼即可用」時，`wallet_cli` 應回 `true`（與 `privy` 一致），即其密碼自含於 config params。

### 需求 3：錢包類型配置與解析器
**目標：** 作為整合者，我希望能將 `wallet_cli` 配置為錢包類型並透過既有解析機制使用，以便無需改動 `resolveWallet` 即可套用。

#### 驗收準則
1. agent-wallet 系統應在 `WalletConfigSchema`（zod discriminated union）新增 `wallet_cli` 類型與 `WalletCliWalletParamsSchema`（含 `account` 選填、`password` 必填）。
2. 當配置 `wallet_cli` 條目時，`WalletCliConfigResolver` 應從 config source 解析、正規化（trim）、校驗必填欄位。
3. 當 `account` 省略時，agent-wallet 系統應使用 wallet-cli 的 active account。
4. 當配置檔載入 `wallet_cli` 條目時，既有 `ConfigWalletProvider` / `resolveWallet` 解析順序應自動套用，無需修改其原始碼。
5. agent-wallet 系統應匯出 `WalletCliAdapter`、`WalletCliClient`、`WalletCliConfigResolver` 及相關型別與錯誤類別。

### 需求 4：子程序互動與信封解析
**目標：** 作為整合者，我希望 agent-wallet 能可靠地呼叫 wallet-cli 並解析其回應，以便簽名與查詢結果可程式化消費。

#### 驗收準則
1. 當 agent-wallet 呼叫 wallet-cli 時，應透過 `child_process.spawn` 啟動子程序，並以 `-o json` 取得單一終端 JSON frame（`wallet-cli.result.v1`）。
2. 當 wallet-cli 子程序回應時，`WalletCliClient` 應以 zod 校驗 `wallet-cli.result.v1` 信封結構（`schema`/`success`/`command`/`data`/`error`/`chain`/`meta`）。
3. 當傳遞密碼給 wallet-cli 時，agent-wallet 系統應經 stdin（`--password-stdin`）傳遞，且 payload（交易/訊息/型別化資料）應走 argv 以釋放 fd0 給密碼。
4. 當子程序退出碼為 0 時，agent-wallet 系統應回傳 `success: true` 與 `data`。
5. 當子程序退出碼為 1 時，agent-wallet 系統應拋出 `WalletCliExecutionError` 並附帶 `error.code`（如 `auth_failed`/`rpc_error`/`timeout`/`tx_integrity`）。
6. 當子程序退出碼為 2 時，agent-wallet 系統應拋出 `WalletCliUsageError`（呼叫端錯誤，重試無益）。
7. 當子程序因 binary 不在 PATH 而失敗（spawn ENOENT）時，agent-wallet 系統應拋出 `WalletCliNotFoundError` 並提示安裝指令。
8. 當退出碼 1 且 `error.code` 為 `timeout` 時，agent-wallet 系統應視交易可能仍在飛行，不應自動重送。

### 需求 5：錯誤處理與階層
**目標：** 作為營運者，我希望能以類別而非逐一列舉方式分派外部簽名器錯誤，以便錯誤處理邏輯可維護且可擴充。

#### 驗收準則
1. agent-wallet 系統應為外部簽名器引入共享錯誤階層（`ExternalSignerError` 基底，含 `ConfigError`/`ExecutionError`/`UsageError`/`NotFoundError` 子類）。
2. 當 wallet-cli 專屬錯誤發生時，應 extend 共享基底（如 `WalletCliConfigError extends ExternalSignerConfigError`）。
3. 當既有 `Privy*` 錯誤類別回填至共享基底時，所有 `instanceof WalletError` 檢查應保持向後相容（加法性，不破壞既有行為）。
4. agent-wallet 系統應對 binary 缺失、密碼缺失、旗標互斥等情況 fail-fast 產生明確錯誤。
5. 當遭遇未知 `error.code` 時，agent-wallet 系統應容忍並回退到其所屬退出碼類別（錯誤碼為開放非窮舉）。

### 需求 6：擴充性——為後續外部錢包預留
**目標：** 作為維護者，我希望新增外部簽名器時不必改動 `createAdapter` 主幹或各造錯誤類別，以便後續整合成本最小化。

#### 驗收準則
1. agent-wallet 系統應提供 `ExternalSignerConfigResolver` 泛型基底，封裝 config-only 解析、正規化與必填校驗共用邏輯。
2. agent-wallet 系統應提供 `registerExternalSigner(type, builder)` 註冊機制，使外部簽名器自行註冊 builder。
3. 當 `createAdapter` 遇到外部簽名器類型時，應經註冊表分派（`externalSignerRegistry.get(conf.type)`），而非逐型 if-else。
4. 當 `local_secure`/`raw_secret` 類型被使用時，應維持既有 if-else 分支（因其需 password/configDir/secretLoader，語意不同）。
5. 當新增外部錢包時，應可僅透過「`core/base.ts` 新增 `WalletType` enum 值 + `core/config.ts` 新增 params schema + extend 共享基底 + 註冊 builder + 匯出」完成，無需修改 `createAdapter` 主幹。
6. agent-wallet 系統不應引入犧牲 zod discriminated union 編譯期型別安全的完全動態 plugin 系統。

### 需求 7：安裝與相依
**目標：** 作為使用者，我希望能按需安裝 wallet-cli 而不影響 agent-wallet 其他功能，以便相依足跡與 Node 版本要求最小化。

#### 驗收準則
1. agent-wallet 系統應將 `@tron-walletcli/wallet-cli` 宣告為 optional peer dependency（非 `dependencies` 硬依賴）。
2. 當未安裝 wallet-cli 時，agent-wallet 的 EVM 簽名、Privy、`local_secure`/`raw_secret` 功能應完全不受影響（零感知）。
3. 當 `WalletCliClient` 首次呼叫解析 binary 時，應依序嘗試：顯式 `binary` 選項 → `AGENT_WALLET_WALLET_CLI_PATH` 環境變數 → PATH 上的 `wallet-cli` → 皆無拋 `WalletCliNotFoundError`。
4. 當 `WalletCliClient` 首次呼叫且偵測到 Node 版本 < 20 時，應拋出明確錯誤提示 wallet-cli 需 Node ≥20。
5. agent-wallet 系統的 `engines` 應維持 Node ≥18（不因 wallet-cli 相依而抬升整體下限）。
6. agent-wallet 系統不應硬編碼 `node_modules/.bin` 路徑猜測 binary 位置。

### 需求 8：選用鏈操作編排
**目標：** 作為整合者，我希望能串接建交易、簽名、廣播與追蹤的端到端流程，以便消除手寫 TronGrid REST 的樣板。

#### 驗收準則
1. agent-wallet 系統應在獨立 `integrations/wallet-cli/` 層提供廣播、查詢與編排能力，且此層應可安全移除、不為 `resolveWallet` 所依賴。
2. 當呼叫 `buildTransfer` 時，應以 `wallet-cli tx send --dry-run` 建未簽交易與估算手續費，且不需密碼。
3. 當呼叫 `broadcast(signedTx)` 時，應以 `wallet-cli tx broadcast --tx-stdin` 廣播已簽交易（經 stdin），且不需密碼。
4. 當呼叫 `getTxStatus(txid)` 時，應回傳四態（`confirmed`/`failed`/`pending`/`not_found`）。
5. 當呼叫 `signAndBroadcast` 時，應依序執行建交易 → agent-wallet 簽名 → 廣播 → （可選）追蹤，且密碼僅在簽名環節使用。
6. 當 `signAndBroadcast` 設 `wait: true` 時，應輪詢 `tx status` 至 `confirmed`/`failed` 或達 `waitTimeoutMs`。
7. 當 `signAndBroadcast` 遭遇 timeout（交易可能在飛）時，不應自動重送，而應回傳「以 `tx status` 複核」的狀態。
8. 當鏈操作涉及 `tron:mainnet`（動真錢）時，編排應要求顯式確認旗標。

### 需求 9：安全與機密保護
**目標：** 作為營運者，我希望確保密碼與金鑰不外洩，且危險操作有防護，以便整合符合安全規範。

#### 驗收準則
1. agent-wallet 系統不應將 wallet-cli 密碼經 argv、環境變數或日誌傳遞；密碼應僅經 stdin（`--password-stdin`）在 adapter 內部傳遞。
2. agent-wallet 系統不應解密、持有或記錄 wallet-cli keystore 的明文私鑰。
3. 當輸出 `wallet_cli` 錢包資訊（如 inspect 類操作）時，agent-wallet 系統應 redact 密碼（與 Privy `app_secret` 的 redaction 一致）。
4. 當錯誤或日誌產生時，不應 echo 密碼或簽明明文以外的敏感值；應記錄 command、exit code、`error.code`、`durationMs`。
5. 當廣播已簽交易時，應經 stdin（`--tx-stdin`）傳遞，而非 argv。
6. 當 `tron:mainnet` 操作發生時，預設測試應使用 `tron:nile`，且 mainnet 操作須顯式確認。
7. agent-wallet 系統應將 wallet-cli 子程序的 stderr 與未預期輸出視為不可信資料，不應解析為指令。

### 需求 10：資料契約與一致性
**目標：** 作為整合者，我希望金額與簽名格式在跨工具間一致，以便無需格式轉換即可接合。

#### 驗收準則
1. 當處理鏈上金額時，agent-wallet 系統應一律以十進位字串處理，絕不轉為 JS number。
2. 當 `signMessage`/`signTypedData` 回傳簽名時，應去除 `0x` 前綴以對齊既有 `TronSigner` 慣例。
3. 當 `signTransaction` 回傳已簽交易時，應為 `JSON.stringify(data.signed)`，且 `signature[]` 結構應與既有 `TronSigner` 一致（TRON `r||s||v`）。
4. 當未簽/已簽 TRON 交易物件在 agent-wallet 與 wallet-cli 間傳遞時，應無需格式轉換即可接合。
5. 當 `wallet_cli` 錢包被使用時，金鑰的單一擁有者應為 wallet-cli keystore，agent-wallet 不應重複簽名或二次解鎖。

## 追溯對應

| 需求 | 對應設計元件 | design.md 章節 |
|------|-------------|----------------|
| 需求 1 | `WalletCliAdapter` + `WalletCliClient` | Component Design Part 1 |
| 需求 2 | config params + `WalletCliConfigResolver` | Component Design 1.1/1.2 |
| 需求 3 | `core/config.ts` + `createAdapter` | Component Design 1.1/1.5 |
| 需求 4 | `WalletCliClient` 子程序互動 | Component Design 1.3 + System Flows |
| 需求 5 | 共享錯誤階層 | Error Handling + Extensibility |
| 需求 6 | 共享基底 + 註冊表 | Extensibility |
| 需求 7 | optional peer + binary 解析 | Installation & Dependency |
| 需求 8 | `integrations/wallet-cli/` | Component Design Part 2 |
| 需求 9 | 安全考量 | Security Considerations |
| 需求 10 | 資料模型 | Data Models / Contracts |
