# 實作任務

> 依賴順序排列：確認既有基線 → secret/config → bounded client/handshake → adapter codecs → resolver/CLI 接線 → fixture/真實驗證 → 文件與品質閘。
> 任務只處理 2026-08-24 核准需求相對於現行程式的差額；`[x]` 表示已由既有程式與基線測試確認，不重做。每項標註對應需求。

## 1. 既有基線（已確認，不重做）

- [x] 1.1 共享外部 signer 錯誤階層與 Privy 相容回填已存在
  - `ExternalSigner*` 與 `WalletCli*` 類別已保留開放式 `code`，`Privy*` 仍符合 `instanceof WalletError`
  - 後續只增加 `unsupported_version`、`capability_missing`、`network_mismatch`、`contract_mismatch`、`output_limit` 等穩定 code 的使用點，不新增 subclass
  - _Requirements: 5.1-5.6_

- [x] 1.2 config schema、共享 resolver、builder registry 與 `wallet_cli` 類型已存在
  - 保留中央靜態 Zod discriminated union；builder registry 收斂為不公開的封閉分派
  - `raw_secret` 維持原分支；Privy/wallet-cli 維持 registry 分派
  - _Requirements: 3.1, 6.1-6.7_

- [x] 1.3 TRON adapter/client、CLI config 流程與 optional integration 已有基線實作
  - 六組 wallet-cli 相關 agent-wallet 測試共 54 項已通過
  - `integrations/wallet-cli/` 保持 TRON-only；本期只做契約收緊與回歸，不重寫 RPC/編排功能
  - _Requirements: 8.1-8.9_

## 2. Secret lifecycle 與 config resolver

- [x] 2.1 新增 `SecretProvider` / one-shot `SecretLease` 契約與預設 factory（`core/secret-provider.ts`）
  - 實作 static provider：延續既有 trim/空值語意，adapter/client 不再保存額外 password string
  - 實作 exec provider：每次 `acquire()` 執行 `SecretRef.exec`，以 bounded Buffer 接收、`writeTo()` 一次、idempotent `dispose()` 清零
  - exec 維持檔案路徑限制、10 秒預設 timeout、stdout/stderr 上限、空輸出/非零/超限分類與錯誤脫敏
  - POSIX direct spawn；Windows executable 與 `.cmd/.bat` 固定 launch target 均使用 `shell: false`
  - 保留既有 `resolveSecret()` 與 Privy 行為，避免把 wallet-cli 安全修正擴散成無關重構
  - 新增 `secret-provider.test.ts` 覆蓋 acquire/write/dispose、每次重取、Buffer 清零、trim、timeout、EPIPE、超限及錯誤不含 secret output
  - _Requirements: 2.1-2.8, 9.1-9.4, 9.8-9.10, 11.2_

- [x] 2.2 將 `WalletCliConfigResolver` 改為延遲秘密解析
  - `WalletCliConfig.password` 改為 `SecretValue`；resolver 只校驗必填、正規化 account，不執行 `SecretRef.exec`
  - 缺少/空 password 在任何 wallet-cli 子程序前拋 `WalletCliConfigError`
  - 不新增 wallet-cli password 環境變數覆寫；`walletIsAvailableWithoutPassword` 對 wallet-cli 維持 `true`
  - 更新既有 config/schema/CLI 測試，證明舊明文字串與 `{ exec, timeout? }` config 仍可載入，且 resolve 階段不觸發 script
  - _Requirements: 2.1-2.8, 3.1-3.3_

## 3. Bounded subprocess client、schema 與 handshake

- [x] 3.1 重構安全 launch target 與 bounded runner
  - 新增 `WalletCliLaunchTarget { command, argsPrefix }`；保留 `binary` option，相依解析順序為 launchTarget → binary → env path → optional peer JS entrypoint → safe PATH executable
  - JavaScript entrypoint 由 `process.execPath` 啟動；所有 wallet-cli spawn 使用 `shell: false`，Windows unsafe `.cmd` shim 不回退 shell
  - 實作 60 秒 timeout、5 秒 TERM→KILL grace、2 MiB stdout、64 KiB stderr 預設上限與 settle-once/listener cleanup
  - invalid output/error 只暴露分類、exit code、byte count、truncated/timeout；合法 envelope message 移除控制字元並截斷
  - `wallet-cli-client.test.ts` 覆蓋 launch precedence、Node <20 JS target、ENOENT、EPIPE、timeout、超限、TERM/KILL 與 stdout/stderr 不洩漏
  - _Requirements: 4.1, 4.8-4.10, 5.4-5.6, 7.5-7.7, 9.4, 9.7, 9.9_

- [x] 3.2 收緊 result envelope、warnings 與 command data schema
  - success/error 使用 discriminated schemas；meta 必填，warnings 公開為 `string | { code, message }`
  - 為 networks、current、TRON tx、EVM tx、typed-data 建立必要欄位 schema，允許未知加法欄位/code
  - 交叉檢查 exit code、success、command、chain context 與 data shape；矛盾回 `contract_mismatch`
  - 保留 exit 1/2 的既有共享錯誤分類，未知 `error.code` 不拒絕解析
  - 測試 structured/unknown warning、malformed envelope、錯 command/chain/data/success 與 sanitized message
  - _Requirements: 4.2-4.9, 5.5-5.6, 10.6, 11.1_

- [x] 3.3 實作版本、catalog 與 network capability handshake
  - 以 bounded meta runner 依序解析 `-o json --version` 與 root `-o json --json-schema`；接受穩定 `>=4.13.0 <5.0.0`，catalog version 必須一致
  - 以 `networks -o json` 取得 canonical rows；驗證 current 及 target family 的 tx/typed-data commands
  - 同一 client 的並行首次呼叫共用 handshake promise；meta probes 固定串行，避免 wallet-cli 4.13 startup migration 競爭
  - 辨識 migration completion/cancellation/required envelope，不自動重送原命令；只對 migration 邊界解除 promise，其他 handshake 失敗仍快取
  - 測試版本上下界/prerelease、source/dist 同版能力漂移、缺 family command、未知額外 command/network、共享 promise 與 migration 重試邊界
  - _Requirements: 7.1, 7.3-7.4, 7.7, 11.1-11.2_

- [x] 3.4 實作窄 client 方法與 canonical context
  - 新增 `currentAccount`、`signTronTransaction`、`signEvmTransaction`、`signTypedData`
  - 所有 signing argv 明確包含 canonical `--account`、`--network`、`--password-stdin`；EVM 使用 `--hex`，TRON 使用 `--transaction`
  - client 接受 `SecretLease` 而非 password string；integration 用的 generic run 必須帶 command/context validator
  - 測試 argv/stdin 單一 consumer、lease write failure、各命令 data/context 驗證與無密碼查詢不 acquire lease
  - _Requirements: 1.3-1.9, 2.4-2.6, 4.3-4.6, 9.1_

## 4. 簽名適配器

- [x] 4.1 新增嚴格 network codec 與 account identity pinning
  - 共用 network codec 要求 canonical `tron:<positive integer>` 或 `eip155:<positive safe integer>`；同步拒絕裸 family/alias/大小寫/空白/非法值，且不改寫 namespace
  - handshake 確認 canonical network row；第一次 `current` 固定 canonical `accountId` 與 addresses，共用並行 promise
  - `getAddress()` 依 family 回固定地址；後續 active account 改變不得切換 signer
  - 所有簽章結果驗證 command、network row 與 pinned address；EVM checksum normalization、TRON exact compare
  - 測試缺 network、錯 family/address、並行 current 一次、第一次失敗重試及成功後固定
  - _Requirements: 1.2-1.5, 3.3, 4.4, 5.6, 11.2_

- [x] 4.2 將 TRON transaction / typed-data 改為 explicit context + per-sign lease
  - TRON transaction 維持 JSON input，output 改為 `family: "tron"` typed artifact；驗證 signature array
  - typed-data 維持去 `0x` public contract，改傳 pinned account/network
  - readiness/codec/identity 在 acquire 前完成；每次 signing `acquire()` 一次並在 success/error/timeout 的 `finally` dispose
  - 更新既有 TRON/x402 tests，驗證簽名結果相容且 exec secret 每次重取
  - _Requirements: 1.5-1.6, 1.8, 2.4-2.6, 9.1-9.3, 10.2-10.3, 10.5, 10.7_

- [x] 4.3 實作 EVM transaction codec
  - 驗證 payload chainId 等於 `eip155:<id>`，拒絕既有 signature 欄位及 TRON/EVM 欄位混用
  - 使用既有 viem `serializeTransaction` 支援 legacy、EIP-2930、EIP-1559 unsigned payload，呼叫 wallet-cli `tx sign --hex`
  - 驗證 `data.signed.{raw,hash}` 與 signer，回傳不含 `0x` 的 raw serialized transaction；EIP-4844 明確拒絕/不承諾
  - 以 viem recovery/serialization 驗證 EVM fixture 結果與既有 `EvmSigner`/x402 格式一致
  - _Requirements: 1.3, 1.5, 1.7, 10.2-10.4, 11.1_

- [x] 4.4 實作雙 family typed-data 完整路徑
  - EVM typed-data `domain.chainId` 存在時須匹配 target；TRON 由 wallet-cli TIP-712 family strategy 處理
  - 測試 TRON/EVM typed-data、x402 PaymentPermit（有/無 domain version）、chain mismatch 與 signer mismatch
  - _Requirements: 1.5, 1.8-1.9, 10.2, 11.1, 11.6_

## 5. 標準 resolver、地址、CLI 與公開契約

- [x] 5.1 將 typed dependencies 接通標準 wallet 建構路徑
  - 新增公開 `WalletDependencies` / `WalletCliDependencies`，由 `resolveWallet(options)` → `resolveWalletProvider` → `ConfigWalletProvider` → `createAdapter` → external signer builder context 傳遞
  - wallet-cli builder 以注入或預設 factory 建立 `SecretProvider` 與 `WalletCliClient`；不得在 builder 解析秘密
  - provider 保存不可變 dependencies snapshot，provider cache 與 wallet cache 隔離不同 dependencies；network 繼續納入 wallet cache key
  - 測試標準 resolver 路徑的注入、預設 fallback 與 cache 隔離，並確認 `raw_secret`、Privy 路徑及 `walletIsAvailableWithoutPassword` 行為未變
  - _Requirements: 2.2, 2.8, 3.4-3.5, 6.2-6.7, 11.3, 11.6_

- [x] 5.2 修正 wallet-cli 地址解析為 account descriptor 路徑
  - `resolveWalletAddresses(conf, options?)` 對 wallet-cli 使用注入的 client 直接執行 handshake/current，不建構缺少 signing network 的 adapter，也不取得 secret
  - descriptor 同時有 EVM/TRON 地址時回既有 `whitelist` 模式的兩個 entries；只有一個 family 時回 `single`
  - 測試雙地址、單地址、固定 account、client 注入、零 secret acquire，並確認 Privy 維持 `single`
  - _Requirements: 2.6, 3.3-3.6, 11.3, 11.6_

- [x] 5.3 完成 CLI wallet-cli 能力接線
  - 更新 `start/add wallet_cli` help，明示只連結既有 wallet-cli account、不建立或匯入 key；base probe 不取得密碼
  - onboarding 在密碼提示前以 `current [--account]` 驗證帳戶，保存 canonical `accountId`；不存在時提供 wallet-cli create/import 下一步
  - `sign tx` / `sign typed-data` 要求完整 network 並原樣呈現 adapter 的已分類錯誤
  - `resolve-address` 顯示 TRON/EVM whitelist entries；`inspect` 繼續 redact password、provider output 與 launch metadata
  - 更新 CLI 測試覆蓋 help、帳戶先驗驗證/canonicalization、完整 network、雙地址與 redaction
  - _Requirements: 1.2, 1.9, 2.6, 3.6, 3.8, 5.4, 9.3-9.4_

- [x] 5.4 更新公開 exports 與 optional peer 契約
  - 從 `@bankofai/agent-wallet/advanced` 匯出 `WalletCliAdapter`、`WalletCliClient`、`WalletCliConfigResolver`、`SecretProvider`/`SecretLease` 與 launch/network/warning 型別；root 保留穩定 SDK 契約
  - `@tron-walletcli/wallet-cli` optional peer 限制為 `>=4.13.0 <5.0.0`；不得新增硬 dependency 或依賴 CI 全域安裝
  - agent-wallet `engines` 維持 Node ≥18；以 import/module smoke test 驗證未安裝 peer 時非 wallet-cli 功能仍可載入
  - _Requirements: 3.7, 7.1-7.2, 7.6, 10.6_

## 6. TRON-only 選用鏈操作相容

- [x] 6.1 將既有 `chain-ops.ts` 對齊 bounded client 契約
  - 保留 `buildTransfer`、`broadcast`、`getTxStatus`、`getBalance`、`getTxInfo` 的現有公開行為與十進位字串金額
  - generic run 呼叫提供預期 command/context/data validator；`broadcast` 仍以 `--tx-stdin` 傳已簽交易
  - 在任何子程序前同步拒絕非 canonical `tron:<chainId>` network，不新增 EVM RPC、建交易、廣播或追蹤
  - 更新 mock 測試覆蓋四態、validator mismatch、stdin broadcast、無 secret acquire 與 EVM fail-fast
  - _Requirements: 4.4-4.5, 8.1-8.4, 8.9, 9.5, 10.1_

- [x] 6.2 回歸 `signAndBroadcast` 安全編排
  - 維持建交易 → agent-wallet 簽名 → 廣播 → 選用追蹤的順序，密碼只在 adapter 簽名階段取得
  - `wait: true` 保留 confirmed/failed/pending/timeout 分支；timeout 或狀態不明不得自動重簽/重廣播，回傳可用 `tx status` 複核的狀態
  - `tron:728126428` 仍要求顯式確認；預設測試使用 `tron:3448148188`
  - _Requirements: 4.9, 8.5-8.9, 9.6_

## 7. 程序整合與回歸測試

- [x] 7.1 建立 deterministic wallet-cli fixture 程序並納入一般 CI
  - 新增 `tests/fixtures/wallet-cli-fixture.mjs`，透過 Node launch target 真實解析 argv/stdin 並輸出單一 `wallet-cli.result.v1` frame
  - fixture 覆蓋 version、catalog、networks、current、TRON/EVM transaction、typed-data、migration completion/cancellation/required、structured warnings、exit 1/2、timeout、超限與 malformed envelope
  - 新增 `wallet-cli-process-integration.test.ts` 驗證串行 handshake、migration retry 邊界、identity、每簽章一個 lease、stdin ownership、Node JS target 與完整錯誤分類
  - _Requirements: 4.1-4.10, 7.3-7.7, 9.1, 9.7-9.10, 11.1-11.3_

- [x] 7.2 建立 opt-in 真實 wallet-cli 契約測試
  - `wallet-cli-real-integration.test.ts` 僅在 `AGENT_WALLET_TEST_WALLET_CLI_PATH` 明確指定時執行 version/catalog/networks/current probe，不 fallback 全域 binary
  - adapter address probe 另要求 `AGENT_WALLET_TEST_WALLET_CLI_ACCOUNT` 與 `AGENT_WALLET_TEST_WALLET_CLI_NETWORK`；缺任一項時列明原因並 skip
  - 測試及說明不得修改、安裝相依或建置 `../wallet-cli`；本地 source/dist/dependency 未就緒時如實報告
  - _Requirements: 7.3-7.5, 11.4-11.5_

- [x] 7.3 完成跨平台與完整回歸矩陣
  - 覆蓋 Linux/macOS PATH/package launch、Windows JS entrypoint、unsafe `.cmd` shim 拒絕及 SecretRef `.cmd/.bat` 固定 launcher
  - 執行 config/resolver/client/adapter/CLI/chain-ops/x402 測試，確認 `raw_secret`、Privy、TRON、EVM、optional integration 及公開輸出格式均相容
  - 驗證未引入動態 params schema plugin，內部 registry 與中央 schema 維持同步
  - _Requirements: 6.7, 7.2, 7.5-7.7, 10.2-10.6, 11.6_

- [x] 7.4 修復 PR #20 跨入口與恢復邊界
  - canonical network/mainnet guard 全面套用到所有 provider；CJS root/advanced/integration entry points 以共享錯誤品牌保持 `instanceof` 與 broadcast timeout recovery
  - 普通 stdin 非同步 EPIPE 收斂為 `stdin_write`；wallet-cli/secret exec 終止完整程序樹並在 grace 到期後銷毀 pipe、直接 settle
  - 非互動 start/add 省略 account 時解析 active account；typed-data bigint 遞迴轉十進位字串並驗證 digest 等價
  - build 明確綁定 injected Wallet address 並驗證 owner；提交後 status query 錯誤保留 txId/code/cause，且所有恢復路徑不重送
  - _Requirements: 1.2-1.5, 3.8, 4.9-4.11, 5.7, 8.2, 8.7-8.8, 10.8_

## 8. 品質閘與驗證摘要

- [x] 8.1 執行 wallet-cli 相關 targeted tests
  - 先執行 secret/config/client/adapter/resolver/CLI/integration/x402 的直接 Vitest 篩選，讓失敗能定位到單一層
  - 2026-08-25：目標矩陣 15 files，181 passed、2 opt-in skipped；後續邊界補強另逐層通過
  - _Requirements: 11.1-11.3, 11.6_

- [x] 8.2 執行專案完整品質閘
  - 執行 `pnpm test`、`pnpm lint`、`pnpm build`、`pnpm format:check`（若 package script 名稱不同則使用專案實際等價命令）
  - 若環境或既有問題使任一項無法執行，記錄精確命令、失敗原因及已完成的替代驗證，不把 skip 宣稱為通過
  - 2026-08-25：四個 pnpm scripts 都在執行前被 pnpm 11 modules-layout 檢查攔下（現有 node_modules 與新 `autoInstallPeers:false` 不同，非 TTY 禁止 purge，且 registry metadata fetch 失敗）；未重裝或修改 sibling
  - 2026-08-25 onboarding 補強後：Vitest 21 files passed、1 file skipped，263 tests passed、2 opt-in skipped；`tsc --noEmit`、ESLint、tsup build 與本次變更檔 Prettier check 均通過
  - 完整 `prettier --check src/ tests/` 另列出 11 個未由本期修改的既有格式檔案，未批次重排無關程式
  - 2026-08-26 架構收斂後：Vitest 22 files passed、1 file skipped，268 tests passed、2 opt-in skipped；src/examples TypeScript、ESLint、完整 Prettier check 與 ESM/CJS/DTS build 均通過
  - 2026-09-09 PR #20 修復後：coverage run 23 files / 325 tests 通過，1 file / 2 個 opt-in tests skipped；`pnpm test`、`pnpm test:coverage`、`pnpm lint`、`pnpm build`、`pnpm format:check`、build 後 CJS 多入口 probe 與 `git diff --check` 均通過
  - _Requirements: 全域品質閘_

- [x] 8.3 執行或明確 skip 上一級本地 wallet-cli 實測
  - 僅使用 7.2 的明確 entrypoint 與 opt-in 條件；不得使用 stale 全域版本冒充本地 source 能力
  - 摘要記錄版本、catalog/network probe、signing 是否執行，以及既有 artifact/dependency 阻礙；不修改 sibling repository
  - 2026-08-26：`../wallet-cli/ts` source package 與 build 已升為 4.13.0、Node >=20，source catalog 宣告 TRON/EVM 三種簽章能力；全域安裝連結至 sibling repo，opt-in test 必須以顯式 path 驗證
  - 2026-08-26 移除 agent-wallet message signing 後，以全域 sibling symlink 明確設定 `AGENT_WALLET_TEST_WALLET_CLI_PATH`：agent-wallet executable compatibility probe 1 test 通過；未提供 account/network，adapter address test 明確 skipped
  - 移除 message signing 後完整驗證：22 files / 275 tests 通過、1 file / 2 opt-in tests skipped；`tsc`、examples typecheck、ESLint、Prettier 與 ESM/CJS/DTS build 通過
  - _Requirements: 11.4-11.5_

- [x] 8.4 完成變更範圍與安全檢查
  - 執行 formatter、`git diff --check`，檢查沒有 secret/output 洩漏、沒有私鑰匯入/解密/二次簽名路徑、沒有公開半套 registry API、沒有意外變更 archive 或 sibling repository
  - 逐項核對本文件 checkbox 與 requirements trace，僅將實際完成且驗證過的任務標為 `[x]`
  - 2026-08-25：`git diff --check` 通過；`.kiro/steering/`、`doc/archive/` 與 `../wallet-cli` 無變更；使用者既有未追蹤 package-lock 檔案未修改
  - _Requirements: 1.10, 6.7, 9.1-9.10, 10.7, 11.5-11.6_

## 9. 使用者文件與 readiness 結案

- [x] 9.1 更新文件所有權範圍內的入口文件
  - 根 `README.md` 只補 wallet-cli 能力概覽；`packages/typescript/README.md` 記錄發布/optional peer/公開契約，連結詳細指南而不複製完整 API 清單
  - 保留 `.kiro/steering/` 的長期原則與 `doc/archive/` 歷史材料，不為本次實作同步改寫凍結文件
  - _Requirements: 3.7, 7.1-7.7, 8.1, 8.9_

- [x] 9.2 更新操作指南與 CLI 說明
  - 更新 `doc/how-to-add-wallet-cli-wallet.md`、`doc/getting-started.md` 與 CLI help，說明完整 network、TRON/EVM 簽章、每次 exec secret、Windows JavaScript entrypoint 與錯誤處理
  - 明示 optional integration 仍為 TRON-only、mainnet 確認、fixture/真實測試環境變數與本地 sibling 不會被修改
  - _Requirements: 1.1-1.9, 2.1-2.8, 7.1-7.7, 8.1-8.9, 9.1-9.10, 11.4-11.5_

- [x] 9.3 更新 readiness review 的修復與驗證狀態
  - 在 `doc/wallet-cli-x402-readiness-review.md` 將已修復項目連回唯一需求/設計/測試來源，記錄封閉 registry 與 discriminated union 的收斂結果
  - 記錄上一級 wallet-cli source 4.13.0、sibling dist／全域 symlink 狀態，以及最終 opt-in probe 結果；不得把未執行的實測標為通過
  - _Requirements: 6.7, 7.3-7.7, 11.4-11.6_
