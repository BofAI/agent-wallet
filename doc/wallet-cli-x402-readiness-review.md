# wallet-cli 對接 x402 就緒度評估

## 結論（2026-09-07 驗證）

本評估列出的 P0 與本期 P1 已在 `agent-wallet` 完成：`wallet_cli` 現在具備嚴格
network/account identity、每次簽章 one-shot `SecretLease`、穩定版
`>=4.13.0 <5.0.0` capability handshake、bounded `shell:false` runner，以及 TRON/EVM
transaction 與 typed-data 完整簽章路徑。wallet-cli 本身的 message signing 未暴露為
agent-wallet 能力。選用的 build/broadcast/status
integration 仍明確維持 TRON-only。

因此可將這個 backend 視為 x402 TRON/EVM 的 production candidate；正式環境仍應以實際
wallet-cli entrypoint、帳戶與 password provider 執行 opt-in 契約測試。本次一般測試使用
deterministic fixture；沒有提供 opt-in secrets 時，不把真實 signing 宣稱為通過。

高吞吐 sidecar/session 不在本期範圍。這不阻塞
目前低至中頻的外部 signer，但 registry 擴充與高併發 facilitator 仍需另立規格。

唯一需求、設計與完成清單分別位於
[requirements.md](../.kiro/specs/wallet-cli-integration/requirements.md)、
[design.md](../.kiro/specs/wallet-cli-integration/design.md) 與
[tasks.md](../.kiro/specs/wallet-cli-integration/tasks.md)；使用方式集中在
[wallet-cli 操作指南](./how-to-add-wallet-cli-wallet.md)。

架構結論維持不變：由 `agent-wallet` 承擔 wallet-cli、SecretProvider、平台憑證來源及
簽名生命週期的複雜度。x402 SDK 應維持結構化 Wallet interface，不直接承擔密碼、
Keychain、Vault 或子程序管理。

```text
x402 SDK
  只依賴 Wallet interface
        ▲
        │
agent-wallet
  帳戶解析、SecretProvider、簽名後端
        ▲
        │
wallet-cli / Keychain / Vault / Ledger / Privy
```

## 評估範圍

本次檢查涵蓋：

- `resolveWallet`、`ConfigWalletProvider` 與 wallet builder 的解析流程。
- `WalletCliAdapter`、`WalletCliClient` 和 wallet-cli integration。
- wallet-cli 密碼解析及 exec-script 憑證模型。
- wallet-cli 4.13.0 的版本與命令 schema。
- x402 對 TRON/EVM 地址、typed-data 簽名和交易簽名的需求。
- 相關單元測試與 TypeScript 類型檢查。

## 已滿足的能力

### 完整的 adapter 呼叫鏈

目前已具備：

```text
resolveWallet
  → ConfigWalletProvider
  → WalletCliConfigResolver
  → WalletCliAdapter
  → WalletCliClient
  → wallet-cli 子程序
```

呼叫端可以繼續使用 `resolveWallet({ network })`，不必直接知道 wallet-cli 的子程序協議。

### 清楚的模組 seam

- `WalletCliAdapter` 負責符合 Wallet interface 及格式正規化。
- `WalletCliClient` 負責子程序、timeout、JSON envelope 和退出碼。
- `WalletCliConfigResolver` 負責驗證與正規化 credential 設定；`SecretProvider` 負責每次
  簽章的 credential acquisition 與 one-shot lease lifecycle。
- 廣播與交易追蹤放在選用的 `integrations/wallet-cli`，沒有污染簽名核心。

這個分層具備良好 locality：wallet-cli 契約改動可以集中在 agent-wallet 修正，不需要散落到每個 x402 呼叫端。

### 私鑰隔離

agent-wallet 不直接讀取或解密 wallet-cli keystore，也不取得明文私鑰。交易和 typed-data 都委派給 wallet-cli 簽名。

### 基本安全傳輸

- wallet-cli 密碼透過 `--password-stdin` 傳入。
- 密碼不放入 argv。
- 已有 timeout、ENOENT、exit code 1/2 和 `error.code` 分類。
- wallet-cli 是 optional peer dependency，不影響未使用此後端的使用者。

### 修復後驗證範圍

- deterministic fixture 會真實 spawn Node entrypoint，解析 argv/stdin，覆蓋
  version/catalog/networks/current、TRON/EVM transaction、typed-data、startup migration、
  warning、exit 1/2、timeout、超限與 malformed envelope；見
  [wallet-cli-process-integration.test.ts](../packages/typescript/tests/wallet-cli-process-integration.test.ts)。
- secret lifecycle、client、adapter、resolver、CLI 與 TRON-only integration 各有分層測試；
  真實 executable 測試則由
  [wallet-cli-real-integration.test.ts](../packages/typescript/tests/wallet-cli-real-integration.test.ts)
  依明確環境變數 opt-in。
- npm 正式發布的 `@tron-walletcli/wallet-cli@4.13.0` artifact 要求 Node >=20；agent-wallet
  handshake 明確要求 TRON/EVM 的 `tx.sign` 與 `typed-data.sign`。opt-in probe 以顯式
  executable path 驗證 version/catalog/networks，不依賴 PATH 或 sibling 開發連結猜測。
- 2026-09-07 最終品質命令結果為 22 test files / 280 tests 通過、1 file / 2 個需真實
  executable 或 account 的 opt-in tests skipped；另以 npm 正式 4.13.0 artifact 執行 real
  probe，1 test 通過、1 test 因未提供 account/network 跳過。`tsc`、examples typecheck、
  ESLint、Prettier 與 ESM/CJS/DTS build 全部通過。

## 原始關鍵缺口與修復狀態

### P0：簽名命令未綁定 network（已修復）

修復：adapter 強制完整 network，client 每次傳 canonical `--network`，並交叉檢查
envelope chain context；缺值、裸 family 與 alias 在 acquire/spawn 前 fail-fast。

修復前，`WalletCliAdapter` 雖然收到 x402 傳入的 network，但只在 `getAddress()` 用它選擇地址 family。`WalletCliClient.signTransaction()` 和 `signTypedData()` 都沒有向 wallet-cli 傳遞：

```text
--network tron:3448148188
```

因此修復前的真正簽名仍依賴 wallet-cli 全域預設 network，可能造成：

- x402 指定 Nile，但 wallet-cli 使用另一個 network。
- wallet-cli 預設為 EVM family 時，TRON `--transaction` 簽名失敗。
- typed-data 使用錯誤的 EVM/TRON signing strategy。

修正要求：

1. `WalletCliClient.signTransaction` 和 `signTypedData` 必須接收 canonical network。
2. 每次呼叫都顯式傳入 `--network`。
3. 校驗成功 envelope 的 `chain.network` 與請求一致。
4. 沒有 network 時應 fail-fast，不能默認 mainnet。

### P0：active account 存在身分漂移（已修復）

修復：並行首次 `current` 共用 Promise，成功後固定 canonical accountId 與雙 family
addresses；所有 signing 都傳 accountId 並驗證 signer，外部切換 active account 不會換 signer。

修復前，wallet-cli config 的 `account` 可以省略。此時：

1. `getAddress()` 取得當時的 active account 地址並快取。
2. 後續簽名仍不傳 account，由 wallet-cli 再次解析 active account。
3. 如果期間執行過 `wallet-cli use`，實際簽名者可能已變更。

可能出現：

```text
x402 payload.from = 已快取的 A 地址
實際 signer       = 新 active 的 B 地址
```

修正要求：

- 第一次解析 wallet 時固定 `accountId`。
- 所有簽名命令顯式傳入已固定的 accountId。
- 校驗 wallet-cli 回傳的 signer address 與 adapter 預期地址一致。
- 多個並行 `getAddress()` 應共用同一個解析 Promise。

### P0：SecretRef 不是串流 SecretProvider（已修復）

修復：config 保留 `SecretValue`，每次 signing 才 `acquire()` one-shot lease；lease 直接寫
stdin 並在 `finally` dispose。exec provider 每次重新執行，具獨立 timeout/輸出界線與脫敏錯誤。

修復前，`SecretRef.exec` 在解析 wallet 時立即執行，stdout 被轉為 JS `string`，然後保存在：

```ts
WalletCliConfig.password: string
```

其生命週期實際是：

```text
secret script
  → JS string
  → adapter 長期保存
  → 每次簽名寫入 wallet-cli stdin
```

而 production 需求應為：

```text
SecretProvider / SecretLease
  → 簽名時取得
  → 直接寫入 wallet-cli stdin
  → 立即釋放
```

修復前 Keychain、Vault 或密碼管理器雖可透過 exec script 接入，但密碼仍會進入並長期停留在 agent-wallet 記憶體。

修正要求：

- config 保存 `SecretRef` 或 provider config，不保存解析後密碼。
- adapter 在每次需要簽名時取得短生命週期 `SecretLease`。
- `WalletCliClient` 接受可串流/可消費的秘密來源，而不是 `password: string`。
- 可選 TTL cache 應由 provider 自己實作，默認不快取。
- 不應在錯誤、日誌或 crash context 中包含 secret provider 的 stdout/stderr。

建議的小型 interface：

```ts
interface SecretProvider {
  acquire(context: SecretContext): Promise<SecretLease>;
}

interface SecretLease {
  writeTo(destination: NodeJS.WritableStream): Promise<void>;
  dispose(): Promise<void>;
}
```

### P0：wallet-cli 版本契約過寬（已修復）

修復：optional peer 與 runtime 都限制穩定版 `>=4.13.0 <5.0.0`，首次呼叫共用
version/catalog/networks handshake；版本、catalog 或 target family 能力漂移會 fail-fast。

修復前 optional peer dependency 為：

```json
"@tron-walletcli/wallet-cli": ">=0.1.1"
```

但實作依賴固定命令、參數和 `wallet-cli.result.v1` envelope。如此寬鬆的範圍無法保證相容。

修正要求：

- 固定支援 `@tron-walletcli/wallet-cli@4.13.0`，或採經驗證的窄版本範圍。
- 第一次使用時執行 `wallet-cli --version` 並快取結果。
- 版本不符時 fail-fast，不應在簽名階段才以 schema error 失敗。

### P0：wallet-cli 4.13.0 warning schema 已發生漂移（已修復）

修復：warnings 公開型別與 schema 接受 string/structured union，未知 code 與加法欄位保留。

修復前 agent-wallet 將 warnings 定義為：

```ts
warnings: string[]
```

wallet-cli 4.13.0 實際允許：

```ts
(string | { code: string; message: string })[]
```

一旦 wallet-cli 回傳結構化 warning，agent-wallet 會將原本成功的結果誤判成 invalid output。

修正要求：

- envelope schema 接受 string 和結構化 warning。
- 呼叫端只根據 warning object 的 `code` 分派，不解析 message。
- 未知 warning code 必須保持 forward-compatible。

### P1：尚未完整支援 EVM（已修復）

修復：EVM transaction 以 viem 支援 legacy/EIP-2930/EIP-1559 unsigned serialization，
使用 `tx sign --hex` 並 recovery 驗證 signer，回傳不含 `0x` 的 signed raw；typed-data 與
EIP-4844/EIP-7702 明確拒絕。

wallet-cli 4.13.0 已提供 EVM typed-data 和交易簽名，但修復前的 agent-wallet adapter 仍按 TRON 模型實作：

- 交易固定使用 `tx sign --transaction <TRON JSON>`。
- EVM 交易需要先序列化為 unsigned transaction hex，再使用 `tx sign --hex`。
- EVM 簽名結果需要取出 serialized raw transaction。

因此修復前只能視為 TRON adapter，不能用同一個 wallet-cli wallet 完整支援 x402 EVM client/facilitator。

建議明確二選一：

1. 實作完整 EVM wallet-cli adapter；或
2. 公開契約嚴格標為 TRON-only，EVM 繼續使用 raw-secret/Privy/其他 Wallet adapter。

若選擇支援 EVM，應按 family 分派：

```text
TRON transaction object
  → tx sign --transaction
  → data.signed JSON

EVM transaction fields
  → unsigned serialized hex
  → tx sign --hex
  → data.signed.raw
```

### P1：Windows shell 模式需要加固（已修復）

修復：所有 wallet-cli spawn 使用 `shell:false`；JavaScript entrypoint 由 Node 啟動，
Windows `.cmd/.bat` wallet-cli shim 拒絕並要求實際 JS entrypoint。secret `.cmd/.bat` 則只
使用固定 ComSpec argv。runner 具 timeout、TERM→KILL 與 stdout/stderr 上限。

修復前 Windows 子程序使用 `shell: true`，而 typed-data 和 transaction JSON 又作為 argv 傳入。這增加 shell quoting 和注入風險。

修正要求：

- 優先解析實際 executable/cmd shim，使用 `shell: false`。
- 不把未驗證的 binary path 當作 shell command。
- 對 stdout/stderr 設置最大大小，避免無界記憶體累積。
- invalid-output 錯誤不得直接拼接完整 stderr；應截斷並脫敏。

### P1：標準 resolveWallet 路徑缺少依賴注入（已修復）

修復：公開 `WalletDependencies` / `WalletCliDependencies` 已接通 resolver → provider →
builder，可注入 client 與 secret provider factory；地址解析不建立 signing adapter 或取得秘密。

修復前 registry builder 直接建立 `new WalletCliClient()`，標準 `resolveWallet()` 無法注入：

- 自訂 SecretProvider。
- 測試 client。
- binary resolver。
- timeout/retry policy。
- 受限 subprocess environment。

直接建立 `WalletCliAdapter` 可以注入 client，但會繞開正常 resolver 流程。

建議讓 resolver/provider context 接受外部依賴，避免把平台實作硬編碼進 builder。

### P2：外部 signer registry 與 config schema 不一致（已修復）

registry 已收斂為模組內部的封閉分派，不再公開只有 builder、沒有 config schema 的半套動態註冊 API。新增 signer 必須同步更新中央 schema 與內部 builder 登錄，兩者不會在 runtime 脫鉤。

`WalletConfigSchema` 也已改為真正的 Zod discriminated union，TypeScript 可依 `type` 自然縮窄 params；root entry point 僅保留穩定 API，具體 adapter/client 移至 `@bankofai/agent-wallet/advanced`。

## x402 場景相容性

| 場景                               | 修復後狀態              | 說明                                                                  |
| ---------------------------------- | ----------------------- | --------------------------------------------------------------------- |
| TRON EIP-3009 typed-data 支付      | 可用候選                | canonical network/account/signer 已固定；仍需 deployment opt-in probe |
| TRON Permit2 typed-data            | 可用候選                | TIP-712 路徑與 signer 驗證已完成                                      |
| TRON Permit2 首次 approve          | 可用候選                | 完整 signed TRON JSON artifact，network/account 已固定                |
| TRON facilitator settlement        | 低至中頻可用            | TRON-only integration 維持每筆子程序與 mainnet guard                  |
| EVM typed-data 支付                | 可用候選                | EVM network、domain.chainId 與 signer 都會驗證                        |
| EVM approve/settlement transaction | 可用候選                | legacy/EIP-2930/EIP-1559 unsigned codec 與 raw signed output 已完成   |
| macOS Keychain                     | 可透過 exec script 接入 | 每次 acquire，不再長期保存 exec 輸出的 JS string                      |
| Linux/Vault/Secret Service         | 可透過 exec script 接入 | 同上；native provider 可由 dependency injection 擴充                  |
| Windows Credential Manager         | 可透過固定 script 接入  | `shell:false` 與固定 launcher 已加固                                  |
| 高吞吐 facilitator                 | 仍不建議直接使用        | 每筆啟動 CLI；sidecar/session/nonce ordering 留待後續規格             |

## 原始整改順序與結案

下列第一至第三階段的本期項目均已落實；native OS provider 與第四階段高吞吐 sidecar
仍屬後續工作。完成證據以 [tasks.md](../.kiro/specs/wallet-cli-integration/tasks.md) 為準。

### 第一階段：確保 TRON x402 正確性

1. 簽名顯式綁定 canonical network。
2. 固定 accountId 並校驗 signer address。
3. 修正 wallet-cli 4.13.0 warnings schema。
4. 增加首次版本檢查。
5. 增加真實 wallet-cli binary 的 Nile integration test。

完成後可將 TRON wallet-cli backend 定義為 production candidate。

### 第二階段：改善認證與跨平台安全

1. 引入延遲 SecretProvider/SecretLease。
2. 提供 exec、macOS Keychain、Linux Secret Service/Vault、Windows Credential Manager adapter。
3. provider 自行決定是否採短 TTL cache。
4. 收緊 child-process env、stderr 和輸出大小。
5. 移除 Windows `shell: true`。

### 第三階段：決定 EVM 策略

1. 若需要單一 wallet-cli 同時支援 TRON/EVM，新增 family-specific transaction codec。
2. 否則將 wallet-cli 公開契約明確限定為 TRON，避免目前「地址預留但交易不能簽」的半支援狀態。

### 第四階段：高吞吐場景

facilitator 若需要高併發，應評估：

- wallet-cli signer sidecar / Unix socket。
- 解鎖 session 的 TTL、帳戶與 network scope。
- 請求併發上限與 nonce/transaction ordering。
- sidecar crash/restart 後的秘密清理。

在 sidecar 可用前，子程序 adapter 比較適合低至中頻的 agent/client，而不是高吞吐 facilitator。

## 最終判斷（修復後）

| 評估面向                            | 判斷                                                        |
| ----------------------------------- | ----------------------------------------------------------- |
| 模組 seam                           | 正確                                                        |
| TRON transaction/typed-data         | 已實作並有 deterministic process 測試                       |
| x402 TRON production readiness      | production candidate；部署前需真實 opt-in probe             |
| x402 EVM                            | legacy/EIP-2930/EIP-1559 與 typed-data 已滿足               |
| 跨平台秘密來源                      | bounded per-sign exec 已滿足；native OS provider 可後續注入 |
| 高吞吐 facilitator                  | 未納入；仍建議 sidecar/session 專案                         |
| 是否應搬進 x402 SDK                 | 不應                                                        |
| 是否值得繼續維護 agent-wallet       | 值得，且應在此集中整改                                      |

總結：`agent-wallet` 已將 wallet-cli 契約、帳戶解析、秘密生命週期、程序界線與格式
轉換集中在單一深模組。network、identity、secret lifecycle、版本/capability 與 EVM codec
缺口已修復；剩餘風險是 deployment-specific 真實 probe，以及高吞吐 sidecar/session
與高吞吐 sidecar。
