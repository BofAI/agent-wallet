# Research Notes — wallet-cli 對接

## 1. 兩個專案的定位

| 維度 | agent-wallet（本專案） | wallet-cli（同級目錄 `../wallet-cli`） |
|------|------------------------|------------------------------------------|
| 語言 | TypeScript 5 / Node 18+ | TypeScript（`ts/`，Node 20+）另有 Java 版（`java/`，本次不涉） |
| 定位 | **簽名** SDK + CLI（sign-only），含跨來源錢包解析 | **TRON 鏈操作 + 金鑰管理**：建交易、簽名、廣播、查詢、質押、追蹤 |
| 網路 | EVM + TRON | 僅 TRON |
| 金鑰儲存 | `local_secure`（自有加密 KV）/ `raw_secret` / `privy`（WaaS） | 加密本地 keystore（自有）/ Ledger / watch-only |
| 廣播 | ❌ 不做 | ✅ `tx send` / `tx broadcast` / `tx status` |
| 建交易 | ❌ 不做 | ✅ `tx send --dry-run`（含手續費估算） |
| 對外契約 | SDK 匯出 `Wallet` 介面、`resolveWallet` | 穩定 JSON 信封 `wallet-cli.result.v1` + 退出碼 0/1/2 |

**核心方向（使用者確認）**：wallet-cli **後續將替代 `local_secure`** 成為 TRON 本地金鑰的簽名後端。亦即 wallet-cli 不只是廣播/查詢層，而是**簽名來源**——agent-wallet 透過 wallet-cli 的簽名指令取得 TRON 簽名，金鑰儲存交由 wallet-cli 的 keystore 擁有。

## 2. agent-wallet 既有架構（對接落點）

- `core/base.ts`：`Wallet` 介面（`getAddress` / `signRaw` / `signTransaction` / `signMessage`）+ `Eip712Capable`（`signTypedData`）。`WalletProvider.getActiveWallet()`。`WalletType` 列舉 `local_secure` / `raw_secret` / `privy`。
- `core/adapters/`：`tron.ts`、`evm.ts`、`local.ts`、`local-secure.ts`、`raw-secret.ts`、`privy.ts`。皆為**純簽名器**。
- `core/clients/privy.ts`：HTTP 傳輸 client（簽名委派），屬 core——**「外部簽名來源 client 置於 core」的先例**。
- `core/providers/privy-config.ts`：`PrivyConfigResolver` 從 config source 解析 `app_secret` 等，校驗必填，拋 `PrivyConfigError`。**config-only，無 env。**
- `core/providers/wallet-builder.ts`：`createAdapter(conf, configDir, password, network, secretLoader)`；Privy 分支為 `resolver → resolve → client → adapter`，**不使用 `password` 參數**。
- `core/providers/config-provider.ts`：`walletIsAvailableWithoutPassword` = `conf.type !== 'local_secure'`；即 privy 無需 agent-wallet 主密碼即可用。
- `core/resolver.ts`：config 優先、env 回退的解析順序。
- `core/config.ts`：`WalletConfigSchema`（zod discriminated union by `type` + `params`）；新增錢包類型即在此擴充。
- `delivery/cli.ts`：CLI 互動層；密碼策略 ≥8 字 + 大小寫+數字+特殊字元。

### TRON 簽名輸出格式（既有 adapter 慣例）
- `TronSigner.signTransaction(payload)` → `JSON.stringify({ ...payload, txID, signature: [sig] })`，`sig` 為 `r||s||v` hex（**無 0x 前綴**）。
- `signMessage` / `signTypedData` → `r||s||v` hex（**無 0x 前綴**，`signTypedData` 內部 `sig.slice(2)` 去前綴）。

## 3. wallet-cli 機器介面（對接的穩定契約）

來源：`wallet-cli/ts/docs/machine-interface.md` 與各 command 文件。

- 呼叫慣例：`wallet-cli <command> -o json [--network <id>] [--timeout <ms>] [--account <id|label>]`。
- stdout 恰為**一個**終端 frame（`wallet-cli.result.v1`）；診斷走 stderr。
- 退出碼：`0` 成功 / `1` 執行失敗 / `2` 用法錯誤。先判 exit code，再判 `error.code`。
- 金額在 JSON 中皆為十進位**字串**。
- 機密只走 stdin 旗標（`--password-stdin`、`--tx-stdin`、`--message-stdin`），**絕不**走 argv/env；每 run 僅一個 `*-stdin` 可吃 stdin。

## 4. wallet-cli 作為簽名後端的能力（關鍵）

wallet-cli 提供完整的 TRON 簽名能力，可替代 agent-wallet 的 `local_secure`/`local`/`raw_secret`（TRON 部分）：

| agent-wallet `Wallet` 方法 | wallet-cli 指令 | 回傳（result.v1 `data`） | 密碼需求 |
|----|----|----|----|
| `getAddress()` | `current`（或 `--account <ref>`） | `addresses.tron`（base58） | ❌ 無需（本地 metadata） |
| `signTransaction(payload)` | `tx sign --transaction <json> --password-stdin` | `signed`（完整已簽 TRON tx，含 `signature[]`） | ✅ `--password-stdin` |
| `signMessage(msg)` | `message sign --message <text> --password-stdin` | `signature`（`0x` 前綴 hex） | ✅ `--password-stdin` |
| `signTypedData(data)` | `typed-data sign --typed-data <json> --password-stdin` | `signature`（`0x` 前綴 hex）+ `digest` + `primaryType` | ✅ `--password-stdin` |
| `signRaw(rawTx)` | （無對應指令） | — | 拋 `UnsupportedOperationError` |

### stdin 單一消費者限制
所有軟體帳戶簽名皆以 `--password-stdin` 吃 stdin，而交易/訊息/typed-data 走 argv：
- `tx sign`：`--transaction <json>`（argv）+ `--password-stdin`（stdin）✓ 單一消費者
- `message sign`：`--message <text>`（argv）+ `--password-stdin`（stdin）✓
- `typed-data sign`：`--typed-data <json>`（argv）+ `--password-stdin`（stdin）✓

→ agent-wallet 把 wallet-cli 密碼經 stdin 餵給 wallet-cli，payload 走 argv，符合其限制。

### 密碼模型（關鍵設計決策，鏡像 Privy `app_secret`）

wallet-cli 的 keystore 主密碼是**外部憑證**（解鎖 wallet-cli keystore），概念上等同 Privy 的 `app_secret`（認證 Privy API）——兩者都是「存取外部簽名後端的憑證」，**都不是 agent-wallet 的主密碼**。

- agent-wallet 主密碼（`AGENT_WALLET_PASSWORD` / runtime secrets）用於解密 agent-wallet **自有**的加密 KV store（`local_secure` 的 `secret_<ref>.json`）。
- wallet-cli 密碼用於解鎖 **wallet-cli 的** keystore。
- 兩者保護不同對象，**不應強制相同**。

**Privy 先例**（`core/providers/privy-config.ts` + `core/config.ts`）：
- `PrivyWalletParams.app_secret` **直接存於 config params**（`wallets_config.json` 明文，檔案 `0600`）。
- `PrivyConfigResolver` 從 config source 解析、校驗必填，拋 `PrivyConfigError`；**config-only，不 merge env**（`EnvWalletProvider` 僅處理 `raw_secret`）。
- `createAdapter` Privy 分支：`resolver → resolve → client → adapter`，**不使用** `password` 參數。

→ **wallet-cli 密碼應完全沿用此先例**：存於 config params（如 `params.password`），由 `WalletCliConfigResolver` 解析，不涉 agent-wallet 主密碼。`createAdapter` 的 `wallet_cli` 分支鏡像 Privy 分支。`walletIsAvailableWithoutPassword` 對 `wallet_cli` 回 `true`（與 privy 一致）。

> 修正說明：先前研究曾提「單一主密碼慣例」（兩工具密碼策略一致即可共用），此為錯誤。密碼策略一致僅表示兩者對密碼強度的要求相同，不代表應共用同一密碼值或同一解析路徑。密碼應如 `app_secret` 般 config-stored。

### 簽名格式正規化（adapter 須處理）
- `signMessage` / `signTypedData`：wallet-cli 回 `0x` 前綴；agent-wallet 慣例**去前綴** → adapter 做 `signature.slice(2)`。
- `signTransaction`：wallet-cli 回 `data.signed`（完整已簽 tx 物件）；agent-wallet 慣例回 `JSON.stringify(signedTx)` → adapter 直接 `JSON.stringify(data.signed)`。兩者 `signature[]` 結構一致（皆 TRON r||s||v）。
- `signRaw`：wallet-cli 無「簽任意 32-byte digest」指令；其 `message sign` 為 EIP-191（含前綴），與 agent-wallet `signRaw`（keccak256 後簽、無前綴）**語意不同**，不可互換 → 拋 `UnsupportedOperationError`（與 `PrivyAdapter.signRaw` 非 tron 行為一致）。

### 金鑰擁有權
wallet-cli `security.md`：「All secrets stored encrypted under your master password; nothing usable on disk in the clear.」→ **wallet-cli 是金鑰的 source of truth**。agent-wallet 應**委派簽名**給 wallet-cli 子程序，而非直接讀取 wallet-cli 的 keystore 檔案（否則等於複製其加密格式、耦合內部實作）。

## 5. wallet-cli 鏈操作能力（編排層可用）

- `tx send --dry-run` → 建未簽交易 + 估手續費（`data.tx`、`data.fee`），不簽不廣播，**不需密碼**。
- `tx broadcast --tx-stdin` → 廣播已簽交易，回 `data.txId` + `data.stage: "submitted"`，不需密碼（已簽）。
- `tx status --txid <id>` → `data.state`：`confirmed` / `failed` / `pending` / `not_found`。
- `account balance` → `data.balance`（字串 SUN）、`address`、`symbol`。
- `account info` → 鏈上完整帳戶資料 + 正規化 `resources`（bandwidth/energy）。

### 形狀相容性
wallet-cli `tx send --sign-only` 的 `data.signed` 即 `tx broadcast` 所吃；agent-wallet `signTransaction` 輸出的 `{...payload, txID, signature:[sig]}` 結構一致。**未簽/已簽 TRON 交易物件是兩者自然接合點，無需格式轉換。**

## 6. wallet-cli 內部結構（判斷是否可程式化嵌入）

`wallet-cli/ts/src/` 為六角架構：`domain/`、`application/`（ports + use-cases）、`adapters/inbound/cli`、`adapters/outbound/chain/tron`。
- `application/ports/chain/broadcaster.ts`：`Broadcaster`；`application/services/signer/`：`Signer` + `SoftwareSigner`（注入式 `SignStrategy`）。
- **但** `package.json` 僅匯出 `bin`（`dist/index.js`），**未匯出程式庫 API**。→ 官方支援的整合面是 CLI 子程序 + JSON 信封，非 in-process 匯入。

## 7. EVM 不受影響
wallet-cli 僅支援 TRON。故「替代 `local_secure`」僅及於 **TRON 本地簽名**；EVM 仍由 agent-wallet 既有 adapter（`local_secure`/`raw_secret`/`evm`）與 Privy 負責。`wallet_cli` 錢包類型為 **TRON-only**。

## 8. 風險點
- agent-wallet steering（`structure.md`）明文：「Do not mix transaction broadcasting or RPC orchestration into this project; this project signs only.」→ 簽名委派（`WalletCliAdapter` 實作 `Wallet`）符合「signs only」（只簽不廣播）；廣播/查詢須置於獨立 `integrations/` 層並標示選用。
- 子程序往返成本：每次簽名 spawn 一次 wallet-cli。可接受（wallet-cli 本即 CLI；軟體簽名本地無網路，延遲低如 `message sign` ~15ms）。
- wallet-cli 需 Node ≥20、agent-wallet 承諾 ≥18；故以 **optional peer dependency** 而非硬依賴（避免抬升整體 Node 下限、避免重依賴足跡與 LGPL 授權灌入所有使用者）。binary 解析：顯式 path → `AGENT_WALLET_WALLET_CLI_PATH` → PATH；皆無拋 `WalletCliNotFoundError`。詳見 design.md Installation & Dependency。
- 密碼傳遞：wallet-cli 密碼存於 config params（鏡像 `app_secret`），經 stdin（`--password-stdin`）傳 wallet-cli；須確保密碼不進 argv/env/日誌；config 檔 `0600`，`inspect` 輸出須 redact。
- argv 長度：交易/typed-data JSON 走 argv；TRON 交易通常數 KB，遠低於 ARG_MAX，可接受。
- 跨工具帳戶對應：agent-wallet `wallet_cli` config 的 `account`（label/accountId）指向 wallet-cli 帳戶（`--account <label|accountId>`），或省略退用 wallet-cli 的 active account。
