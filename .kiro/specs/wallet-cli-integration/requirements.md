# 需求文件

## 簡介

本規格定義將 wallet-cli 整合為 agent-wallet 之 TRON 與 EVM 本地簽名後端的需求。agent-wallet 目前支援 `raw_secret`、`privy` 與 `wallet_cli`；wallet-cli 作為外部簽名來源，金鑰由其加密 keystore 單獨擁有。整合範圍涵蓋交易與 typed-data 簽名、明確網路選擇、帳戶身分固定、短生命週期秘密、子程序與回應驗證、標準 resolver 的依賴注入、地址解析，以及 x402 所需的 EVM 相容性。wallet-cli 本身的 message signing 不納入 agent-wallet 公開契約。

選用的 `integrations/wallet-cli/` 鏈操作層維持 TRON-only。動態 registry params schema（readiness review 的 P2）不在本次範圍，另案處理。本需求以 `../wallet-cli` 的 `feat/architecture-evm-extension` 本地原始碼與測試所呈現的命令契約作為評估基準，不以全域安裝版或陳舊 `dist` 判定能力。

## 需求

### 需求 1：TRON 與 EVM 簽名後端整合

**目標：** 作為整合者，我希望透過同一個 wallet-cli adapter 對 TRON 與 EVM 的交易及型別化資料簽名，以便 x402 與既有 Wallet 呼叫端無需採用 wallet-cli 專屬介面。

#### 驗收準則

1. 當使用者配置 `wallet_cli` 錢包類型時，agent-wallet 系統應透過 `WalletCliAdapter`（實作 `Wallet` 與 `Eip712Capable` 介面）提供簽名能力。
2. 建構 `WalletCliAdapter` 時應要求完整 network：TRON 使用 `tron:<name>`，EVM 使用 `eip155:<十進位 chainId>`；裸 `tron`、裸 `eip155`、格式錯誤或不存在的 network 應 fail-fast，且不得暗自回退主網。
3. 當 EVM network 傳給 wallet-cli 時，agent-wallet 系統應將 `eip155:<chainId>` 明確映射為 `evm:<chainId>`；TRON network 名稱應維持 `tron:<name>` 並以 wallet-cli network 清單確認存在。
4. 第一次需要帳戶身分時，adapter 應以共享的 in-flight promise 查詢一次 account descriptor，固定 canonical `accountId` 及可用的 TRON/EVM 地址；並行呼叫不得各自解析不同 active account。
5. 每次簽章應明確傳遞固定的 `accountId` 與 canonical wallet-cli network，並驗證回應中的 family、network、chainId 及 signer address 與固定身分一致。
6. 對 TRON 呼叫 `signTransaction(payload)` 時，應傳入 TRON 未簽交易 JSON，並回傳 `{ family: "tron", transaction: data.signed }`；EVM 應回傳 `{ family: "evm", rawTransaction }`，使呼叫端可用 discriminator 安全收窄。
7. 對 EVM 呼叫 `signTransaction(payload)` 時，應接受既有 Wallet/x402 使用的 viem 形狀交易物件，驗證 payload `chainId` 與選定 network 一致，序列化為 unsigned transaction 後交給 wallet-cli，並以既有 Wallet 慣例回傳不含 `0x` 前綴的 `data.signed.raw`。
8. 當呼叫 `signTypedData(data)` 時，應以 wallet-cli 的 typed-data 命令簽名，並依既有 Wallet 契約回傳不含 `0x` 前綴的簽名；輸入與選定 family 不相容時應拒絕簽名。
9. 當 `wallet_cli` 錢包類型被選用時，agent-wallet 系統不應自行解密或持有 wallet-cli 的明文私鑰；金鑰應全程留在 wallet-cli 進程內。

### 需求 2：密碼模型與短生命週期 SecretProvider

**目標：** 作為營運者，我希望既有密碼配置保持相容，同時避免把動態取得的 wallet-cli 密碼長期保存於 resolver、adapter 或 client 中。

#### 驗收準則

1. `wallets_config.json` 的 `wallet_cli.params.password` 應繼續接受明文字串或既有 `{ "exec": <script-path>, "timeout"?: <ms> }` 形式，且不得使用已移除的 agent-wallet 主密碼與加密 KV 路徑。
2. 當建構 `wallet_cli` adapter 時，`createAdapter` 應不使用 agent-wallet 主密碼參數（與 Privy 分支一致）。
3. `WalletCliConfigResolver` 應驗證 password config，但保留原始 `SecretValue` 或由其建立的 provider，不應在解析 wallet 時將 `SecretRef.exec` 提前解析成長期保存的字串。
4. adapter 應保存 `SecretProvider`，而非已解析的 password；每次簽章操作應取得獨立 `SecretLease`，將秘密寫入該次子程序 stdin，並在成功、失敗、timeout 或取消後釋放及盡可能清除其可變緩衝區。
5. 明文字串應透過向後相容的 static provider 提供；`SecretRef.exec` 應在每次簽章時重新執行，不得跨簽章快取解析結果。
6. 帳戶查詢、capability handshake 與 network 查詢不得取得或消費密碼。
7. 當 `wallet_cli` 條目缺少 `password` 時，系統應在 config 解析階段 fail-fast 拋出 `WalletCliConfigError`，早於任何 wallet-cli 子程序。
8. agent-wallet 系統不應為 wallet-cli 密碼提供環境變數覆寫；判斷錢包是否無需 agent-wallet 主密碼即可使用時，`wallet_cli` 應維持 `true`。

### 需求 3：錢包類型配置與解析器

**目標：** 作為整合者，我希望透過既有 resolver 使用 `wallet_cli`，並能在標準路徑注入測試或宿主提供的 client 與秘密來源。

#### 驗收準則

1. agent-wallet 系統應在 `WalletConfigSchema`（zod discriminated union）新增 `wallet_cli` 類型與 `WalletCliWalletParamsSchema`（含 `account` 選填、`password` 必填）。
2. 當配置 `wallet_cli` 條目時，`WalletCliConfigResolver` 應正規化 `account`、校驗 password config，並保留秘密的延遲取得語意。
3. 當 `account` 省略時，adapter 應在第一次帳戶解析時採用 wallet-cli 的 active account，隨後固定解析出的 canonical `accountId`；同一 adapter 生命週期內不得因 active account 改變而切換 signer。
4. `resolveWallet`、`resolveWalletProvider`、`ConfigWalletProvider` 與 `createAdapter` 的標準路徑應接受選用、具型別的 wallet-cli dependencies，其中至少包含 client factory 與 secret-provider factory；未注入時應使用正式預設實作。
5. wallet cache key 或等效隔離機制應納入會改變 wallet-cli 實例行為的 network 與 dependencies，避免跨 network 或測試注入誤用同一 adapter。
6. `resolveWalletAddresses` 對 wallet-cli 應直接查詢固定 account descriptor，不得以缺少 network 的 adapter 旁路建構；若 descriptor 同時提供 EVM 與 TRON 地址，應使用既有 `whitelist` 模式回傳兩個 entries。Privy 的 `single` 行為應保持不變。
7. agent-wallet 系統應從 `@bankofai/agent-wallet/advanced` 匯出 `WalletCliAdapter`、`WalletCliClient`、`WalletCliConfigResolver` 與 secret-provider 契約；root entry 僅保留 resolver、provider、config、穩定型別與錯誤。
8. 當 CLI 執行 `start/add wallet_cli` 時，應明示其只連結既有 wallet-cli account；在收集密碼前以無密碼的 `current [--account]` 確認 account descriptor，將 canonical `accountId` 寫入新 config，並在帳戶不存在時提示先以 wallet-cli 建立或匯入帳戶。

### 需求 4：子程序互動與信封解析

**目標：** 作為整合者，我希望 agent-wallet 能可靠地呼叫 wallet-cli 並解析其回應，以便簽名與查詢結果可程式化消費。

#### 驗收準則

1. 當 agent-wallet 呼叫 wallet-cli 時，應透過 `child_process.spawn` 啟動子程序，並以 `-o json` 取得單一終端 JSON frame（`wallet-cli.result.v1`）。
2. 當 wallet-cli 子程序回應時，`WalletCliClient` 應以 zod 嚴格校驗 `wallet-cli.result.v1` 的必要結構（`schema`/`success`/`command`/`data`/`error`/`chain`/`meta`），同時允許契約中的加法性未知欄位。
3. `meta.warnings` 應接受並保留 `string | { code: string; message: string }`，未知 warning code 不應造成解析失敗。
4. 每個高階 client 方法應驗證回應 command 及該命令的 data shape；簽章方法還應驗證預期的 family、network、chainId 與 signer address，不得只因 `success: true` 就接受結果。
5. 當傳遞密碼給 wallet-cli 時，應經 stdin（`--password-stdin`）傳遞；非秘密 payload 可使用 wallet-cli 支援的明確 argv/file/stdin channel，但不得與密碼爭用同一 stdin consumer。
6. 當子程序退出碼為 0 時，僅在 envelope、command、context 與 data 全部驗證成功後回傳結果。
7. 當子程序退出碼為 1 時，應拋出 `WalletCliExecutionError` 並附帶開放式 `error.code`；退出碼為 2 時應拋出 `WalletCliUsageError`，不自動重試。
8. 當 binary 或啟動目標不存在時，應拋出 `WalletCliNotFoundError` 並提供可採取行動的安裝或路徑提示。
9. 當操作 timeout、子程序狀態不明或交易可能仍在飛行時，系統不得自動重送簽章或廣播。
10. 子程序必須以 `shell: false` 啟動，並設置可配置且有界的 timeout、stdout/stderr 上限及終止升級；到達限制時應停止程序並回傳已分類、已脫敏的錯誤。

### 需求 5：錯誤處理與階層

**目標：** 作為營運者，我希望能以類別而非逐一列舉方式分派外部簽名器錯誤，以便錯誤處理邏輯可維護且可擴充。

#### 驗收準則

1. agent-wallet 系統應為外部簽名器引入共享錯誤階層（`ExternalSignerError` 基底，含 `ConfigError`/`ExecutionError`/`UsageError`/`NotFoundError` 子類）。
2. 當 wallet-cli 專屬錯誤發生時，應 extend 共享基底（如 `WalletCliConfigError extends ExternalSignerConfigError`）。
3. 當既有 `Privy*` 錯誤類別回填至共享基底時，所有 `instanceof WalletError` 檢查應保持向後相容（加法性，不破壞既有行為）。
4. agent-wallet 系統應對 binary 缺失、密碼缺失、旗標互斥等情況 fail-fast 產生明確錯誤。
5. 當遭遇未知 `error.code` 時，agent-wallet 系統應容忍並回退到其所屬退出碼類別（錯誤碼為開放非窮舉）。
6. 當 envelope、command、context、data shape、signer 或輸出限制驗證失敗時，應回傳穩定的 wallet-cli 錯誤類別及 code，不得把未經處理的 stdout/stderr 直接拼入錯誤訊息。

### 需求 6：擴充性——為後續外部錢包預留

**目標：** 作為維護者，我希望新增外部簽名器時不必改動 `createAdapter` 主幹或各造錯誤類別，以便後續整合成本最小化。

#### 驗收準則

1. agent-wallet 系統應提供 `ExternalSignerConfigResolver` 泛型基底，封裝 config-only 解析、正規化與必填校驗共用邏輯。
2. agent-wallet 系統應以內部 signer builder registry 集中管理受支援的外部簽名器，不公開只有 builder、沒有 config schema 的半套動態註冊 API。
3. 當 `createAdapter` 遇到外部簽名器類型時，應經註冊表分派（`externalSignerRegistry.get(conf.type)`），而非逐型 if-else。
4. 當 `raw_secret` 類型被使用時，應維持既有 if-else 分支；外部簽名器走註冊表。
5. 當新增外部錢包時，應可在保留中央靜態 config schema 的前提下，透過新增錢包型別、params schema、共享基底子類、builder 註冊與匯出完成，無需修改 `createAdapter` 主幹。
6. agent-wallet 系統不應引入犧牲 zod discriminated union 編譯期型別安全的完全動態 plugin 系統。
7. 外部 signer registry 應維持封閉且與中央靜態 config schema 同步；本次不引入動態 params schema plugin 系統。

### 需求 7：安裝與相依

**目標：** 作為使用者，我希望能按需安裝 wallet-cli 而不影響 agent-wallet 其他功能，以便相依足跡與 Node 版本要求最小化。

#### 驗收準則

1. agent-wallet 系統應將 wallet-cli 宣告為 optional peer dependency（非 `dependencies` 硬依賴），相容版本範圍應限制為 `>=4.13.0 <5.0.0`，且不接受 4.12.x。
2. 當未安裝 wallet-cli 時，agent-wallet 的 EVM 簽名、Privy 與 `raw_secret` 功能應完全不受影響（零感知）。僅建立或使用 `wallet_cli` 配置時才要求 binary。
3. 首次使用 wallet-cli 時，client 應依序驗證版本範圍、root `--json-schema` capability catalog 與 network 清單，再快取結果；同一 client 的並行首次呼叫應共用同一 handshake promise，不得並行啟動可能同時觸發 wallet-data migration 的 meta probes。若 startup gate 回傳 migration completion、cancellation 或 `migration_required`，原命令不得自動重送，且該 migration 邊界不得永久釘住 handshake cache，讓 caller 修正狀態後可明確重試。
4. handshake 應確認選定 family 所需的 current、transaction 與 typed-data 命令能力，以及 canonical network 確實存在。版本相符但缺少能力時仍應拒絕使用。
5. 啟動目標解析應依序尊重顯式 client 設定、`AGENT_WALLET_WALLET_CLI_PATH`、可解析 optional peer 的 JavaScript entrypoint，以及 PATH 上可在 `shell: false` 下直接啟動的 executable；JavaScript entrypoint 應由目前的 Node executable 啟動，不應依賴 Windows shell shim。
6. 當 wallet-cli 路徑被使用且目前 Node 版本低於 wallet-cli 要求時，應拋出明確的 unsupported runtime 錯誤；agent-wallet 本身的 `engines` 應維持 Node ≥18。
7. agent-wallet 系統不應硬編碼 `node_modules/.bin` 路徑猜測 binary，也不得以版本字串取代 capability 驗證。

### 需求 8：選用鏈操作編排

**目標：** 作為 TRON 整合者，我希望既有選用鏈操作層保持可用且邊界清楚，而不把 EVM RPC、廣播或追蹤納入本次簽名整合。

#### 驗收準則

1. agent-wallet 系統應在獨立 `integrations/wallet-cli/` 層提供廣播、查詢與編排能力，且此層應可安全移除、不為 `resolveWallet` 所依賴。
2. 當呼叫 `buildTransfer` 時，應以 `wallet-cli tx send --dry-run` 建未簽交易與估算手續費，且不需密碼。
3. 當呼叫 `broadcast(signedTx)` 時，應以 `wallet-cli tx broadcast --tx-stdin` 廣播已簽交易（經 stdin），且不需密碼。
4. 當呼叫 `getTxStatus(txid)` 時，應回傳四態（`confirmed`/`failed`/`pending`/`not_found`）。
5. 當呼叫 `signAndBroadcast` 時，應依序執行建交易 → agent-wallet 簽名 → 廣播 → （可選）追蹤，且密碼僅在簽名環節使用。
6. 當 `signAndBroadcast` 設 `wait: true` 時，應輪詢 `tx status` 至 `confirmed`/`failed` 或達 `waitTimeoutMs`。
7. 當 `signAndBroadcast` 遭遇 timeout（交易可能在飛）時，不應自動重送，而應回傳「以 `tx status` 複核」的狀態。
8. 當鏈操作涉及 `tron:mainnet`（動真錢）時，編排應要求顯式確認旗標。
9. `integrations/wallet-cli/` 應明確標示為 TRON-only；本次不得新增 EVM 建交易、RPC、廣播或交易追蹤能力，核心 resolver 與 x402 路徑也不得依賴此層。

### 需求 9：安全與機密保護

**目標：** 作為營運者，我希望確保密碼與金鑰不外洩，且危險操作有防護，以便整合符合安全規範。

#### 驗收準則

1. agent-wallet 系統不應將 wallet-cli 密碼經 argv、環境變數或日誌傳遞；密碼應僅經 stdin（`--password-stdin`）在 adapter 內部傳遞。
2. agent-wallet 系統不應解密、持有或記錄 wallet-cli keystore 的明文私鑰。
3. 當輸出 `wallet_cli` 錢包資訊（如 inspect 類操作）時，agent-wallet 系統應 redact 密碼（與 Privy `app_secret` 的 redaction 一致）。
4. 當錯誤或日誌產生時，不應 echo 密碼、SecretRef stdout、未經處理的 stderr 或其他敏感值；可安全記錄 command、exit code、`error.code`、`durationMs` 與輸出是否遭截斷。
5. 當廣播已簽交易時，應經 stdin（`--tx-stdin`）傳遞，而非 argv。
6. 當 `tron:mainnet` 操作發生時，預設測試應使用 `tron:nile`，且 mainnet 操作須顯式確認。
7. agent-wallet 系統應將 wallet-cli 子程序的 stderr 與未預期輸出視為不可信資料，不應解析為指令。
8. `SecretRef.exec` 應維持「可執行檔案路徑而非 inline shell command」的限制，並受獨立 timeout、stdout/stderr 上限、空輸出檢查與錯誤脫敏保護。
9. wallet-cli 與 secret-provider 子程序的輸出累積必須有硬上限；超限後不得繼續將資料保留於記憶體。
10. adapter 與 client 不得在操作完成後保留由 `SecretRef.exec` 取得的 password 字串或 Buffer；對無法清除的 JavaScript 明文字串應限制引用生命週期並不得複製至錯誤或 metadata。

### 需求 10：資料契約與一致性

**目標：** 作為整合者，我希望金額與簽名格式在跨工具間一致，以便無需格式轉換即可接合。

#### 驗收準則

1. 當處理鏈上金額時，agent-wallet 系統應一律以十進位字串處理，絕不轉為 JS number。
2. 當 `signTypedData` 或 EVM signing 回傳 hex 簽名/交易時，應依既有 Wallet 慣例去除 `0x` 前綴，且不得改變位元內容。
3. TRON `signTransaction` 應回傳帶 `family: "tron"` 的完整 transaction object，其中 `signature[]` 與既有 `TronSigner` 相容；EVM `signTransaction` 應回傳帶 `family: "evm"` 的 wallet-cli serialized raw transaction。
4. EVM transaction codec 應支援現有 x402/viem 交易欄位與交易型別，拒絕不完整、無法序列化、chainId 衝突或 TRON/EVM 欄位混用的 payload。
5. 當未簽/已簽 TRON 交易物件在 agent-wallet 與 wallet-cli 間傳遞時，應無需格式轉換即可接合。
6. `WalletCliWarning` 應作為公開的開放 union 型別保留 structured warning，不得只留下 message 而遺失 code。
7. 當 `wallet_cli` 錢包被使用時，金鑰的單一擁有者應為 wallet-cli keystore，agent-wallet 不應重複簽名或二次解鎖。

### 需求 11：相容性與驗證

**目標：** 作為維護者，我希望能以可重現的 fixture 與選用的本地實測驗證 wallet-cli 契約，以便 CI 穩定，同時能及早發現上一級本地 wallet-cli 的真實整合漂移。

#### 驗收準則

1. 測試應提供 deterministic fixture CLI，覆蓋版本、capability catalog、network 清單、account descriptor、TRON/EVM transaction、typed-data、structured warnings、退出碼、timeout、超限輸出及 malformed envelope。
2. 測試應驗證並行首次操作只執行一次 capability handshake 與 account identity resolution，且每次簽章各自取得並釋放一次 secret lease。
3. 測試應透過標準 `resolveWallet` / provider / builder 路徑注入 client factory 與 secret-provider factory，不得只測試直接建構 adapter 的旁路。
4. 專案應提供 opt-in 真實整合測試入口，以明確環境變數指定 wallet-cli 啟動目標；未指定或上一級本地產物尚未可執行時應清楚 skip/report，不得讓一般 CI 假通過或隱式使用全域版本。
5. 本次驗證不得修改、安裝依賴或建置 `../wallet-cli`；上一級專案未就緒時應回報其既有 artifact/dependency 狀態，而非改寫該專案。
6. 既有 `raw_secret`、Privy、TRON-only optional integration 與公開 Wallet/x402 行為應具回歸測試，且內部 registry 與靜態 schema 的封閉契約應受測試保護。

## 追溯對應

現行 `design.md` 仍描述舊的 TRON-only 與 eager password 模型，因此不得視為本版需求的有效設計依據。需求獲批後，Design 階段應更新下列對應，並重建精確章節追溯：

| 需求    | 預期設計範圍                                       |
| ------- | -------------------------------------------------- |
| 需求 1  | network codec、identity pinning、TRON/EVM adapter  |
| 需求 2  | `SecretProvider` / `SecretLease` 與 config 相容層  |
| 需求 3  | resolver dependencies、provider cache、地址解析    |
| 需求 4  | client transport、envelope/data/context validators |
| 需求 5  | 錯誤階層與脫敏分類                                 |
| 需求 6  | 封閉 builder registry；靜態 discriminated union    |
| 需求 7  | optional peer、launch target、capability handshake |
| 需求 8  | TRON-only optional integration 邊界                |
| 需求 9  | 秘密生命週期與子程序資源限制                       |
| 需求 10 | TRON/EVM/x402 資料契約                             |
| 需求 11 | fixture CLI 與 opt-in 本地整合測試                 |
