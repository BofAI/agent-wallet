# Design Options — wallet-cli 對接

> **歷史文件註記（2026-08-01）**：選項比較保留當時背景；目前已移除 `local_secure`、公開 `signMessage`/`signRaw` 與 Python package，wallet-cli adapter 的現行能力為交易簽名與 typed-data 簽名。

前提（使用者確認）：wallet-cli **後續將替代 `local_secure`** 成為 TRON 本地金鑰的簽名後端。故選項評估聚焦於「wallet-cli 如何成為 agent-wallet 的簽名來源」，並兼顧廣播/查詢編排。評估軸：① 對「只簽名」核心的尊重；② 金鑰擁有權與耦合風險；③ 與既有 adapter/provider 模式的一致性。

## 選項 A：子程序簽名適配器 + 選用編排層（建議）

**摘要**
- 新增 `WalletCliAdapter`（`core/adapters/wallet-cli.ts`）實作 `Wallet` + `Eip712Capable`，把 TRON 簽名**委派**給 wallet-cli 子程序（`tx sign` / `message sign` / `typed-data sign`），`getAddress` 用 `current`。
- 新增 `WalletCliClient`（`core/clients/wallet-cli.ts`）為子程序傳輸 + `wallet-cli.result.v1` 信封解析（zod）+ 退出碼分派；對齊 `PrivyClient` 置於 core 的先例。
- 新增錢包類型 `wallet_cli`（`core/config.ts` 擴充 `WalletConfigSchema`），`params` 帶 `account`（label/accountId，可選）。
- 密碼：agent-wallet 既有解析機制（`AGENT_WALLET_PASSWORD` / runtime secrets）解析到的主密碼，經 `--password-stdin` 餵 wallet-cli（單一主密碼慣例；兩工具密碼策略一致）。
- 廣播/查詢/編排置於獨立 `integrations/wallet-cli/`（選用、非核心），復用同一 client。

**對核心職責的尊重**：高。`WalletCliAdapter` 只實作 `Wallet`（簽名介面），不廣播；廣播在 `integrations/`。agent-wallet 核心契約維持「signs only」。

**金鑰擁有權/耦合**：高。金鑰由 wallet-cli keystore 擁有，agent-wallet 不碰其加密格式；僅依賴文件保證的 `result.v1` 契約與簽名指令。wallet-cli 版更不影響 agent-wallet 內部。

**與既有模式一致性**：最高。完全沿用 Privy 先例（client 在 `core/clients/`、adapter 在 `core/adapters/`、config 類型在 `core/config.ts`、`createAdapter` 分派）。

**風險/取捨**
- 每次簽名 spawn 子程序；軟體簽名本地無網路，延遲低（如 message sign ~15ms），可接受。
- argv 傳交易/typed-data JSON（受 ARG_MAX 限制，TRON 交易通常遠低於上限）。
- 須在 `structure.md` 補述 `integrations/` 為選用編排膠水；簽名 client/adapter 屬 core（與 Privy 一致）。

## 選項 B：In-process 匯入 wallet-cli 的 `Signer` / keystore

**摘要**：直接 `import` wallet-cli 的 `application/services/signer` 或實作其 `Signer` port，同行程簽名。

**對核心職責的尊重**：中。把 wallet-cli 邏輯拉進行程，雖仍只簽名，但耦合其內部。

**金鑰擁有權/耦合**：低。wallet-cli `package.json` **未匯出程式庫 API**（僅 `bin`），依賴內部路徑等於耦合無穩定保證的內部結構；版更易碎；兩套依賴圖可能衝突。

**一致性**：低。違反 wallet-cli 公開介面邊界。

**風險**：不推薦。

## 選項 C：agent-wallet 直接讀取 wallet-cli 的 keystore 檔案

**摘要**：agent-wallet 解析 wallet-cli 的加密 keystore 檔案、自行解密（scrypt+AES）並在程式內簽名，仿其既有 `local_secure` 讀自有 KV 的方式。

**對核心職責的尊重**：高（仍只簽名）。

**金鑰擁有權/耦合**：低。等於複製 wallet-cli 的 keystore 加密格式與解密邏輯；wallet-cli 一旦改格式/加密參數，agent-wallet 即壞。且「替代 local_secure」的本意是讓 **wallet-cli 擁有金鑰**，若 agent-wallet 自行解密讀取，金鑰事實上被兩端各自解讀，違反單一擁有者原則，亦重複實作。

**一致性**：中。與 `local_secure` 讀自有 KV 表面相似，但 KV 是 agent-wallet 自有格式、可控；wallet-cli keystore 為外部格式、不可控。

**風險**：不推薦——耦合外部未公開格式、重複解密邏輯、違反「wallet-cli 為金鑰 source of truth」。

## 比較總表

| 軸 | A：子程序適配器 | B：In-process 匯入 | C：直接讀 keystore |
|----|----------------|--------------------|--------------------|
| 尊重「只簽名」核心 | ✅ 高 | 🟡 中 | ✅ 高 |
| 金鑰單一擁有者 | ✅ wallet-cli | ❌ 混亂 | ❌ agent-wallet 複製 |
| 依賴穩定公開契約 | ✅ `result.v1` | ❌ 內部路徑 | ❌ 未公開 keystore 格式 |
| 與 Privy 先例一致 | ✅ 最高 | ❌ 低 | 🟡 中 |
| 版更安全 | ✅ | ❌ | ❌ |
| 效能 | 🟡 spawn 成本 | ✅ 無 | ✅ 無 |

## 建議

**採用選項 A**。

**理由**
- 金鑰由 wallet-cli keystore 擁有、agent-wallet 委派簽名，符合「wallet-cli 替代 local_secure」的本意（wallet-cli 為 source of truth），且不耦合其內部加密格式。
- 完全沿用 Privy 先例（client/adapter/config 分層），與既有 adapter/provider 模式一致，學習與維護成本最低。
- `WalletCliAdapter` 只實作 `Wallet`（簽名），廣播/查詢置於獨立 `integrations/`，正面回應 steering「signs only」。
- 僅依賴文件保證的 `result.v1` + 退出碼，版更安全。

**明確排除**：B（匯入未公開內部）與 C（複製外部 keystore 格式）。

## Extensibility — 為後續外部錢包預留

前述選項 A 已確立「外部簽名來源 = client + adapter + config-resolver + config 型」的 Privy 先例。本節評估是否在本次即提取共享抽象，以利後續新增外部錢包（其他 WaaS、硬體錢包、其他 CLI）。

### 方案 1：共享基底 + 註冊表（建議）
提取三項共享抽象：外部簽名器錯誤階層（`ExternalSignerError` 系列）、config resolver 泛型基底、`createAdapter` 的註冊表分派。新外部錢包 extend 共享基底 + 註冊 builder，不必改 `createAdapter` 主幹。
- 優點：減少樣板、錯誤可分類捕捉、新增集中。Privy 可加法性回填（全庫 `instanceof` 僅查 `WalletError`，安全）。
- 風險：略有抽象成本；但皆為既有 Privy 模式的提取，非新發明。

### 方案 2：不抽象，沿用 Privy 各自實作
每個外部錢包自造 `XxxConfigError`、自寫 resolver、在 `createAdapter` 加 if 分支。
- 優點：零抽象成本。
- 風險：錯誤類別扁平增殖、`createAdapter` if-else 隨型成長、resolver 樣板重複。

### 方案 3：完全動態 plugin 系統
單一 `external` 型 + provider 字串 dispatch。
- 風險：犧牲 zod discriminated union 的編譯期型別安全（params 形狀各異）；過早抽象。不採。

**採用方案 1**。理由：以最小且皆源自既有模式的抽象，換取後續每新增一外部錢包的步驟從「改 schema + 改 createAdapter + 各造錯誤 + 重寫 resolver」收斂為「改 schema（型別安全必需）+ extend 共享基底 + 註冊 builder」。詳見 `design.md` Extensibility 章節。
