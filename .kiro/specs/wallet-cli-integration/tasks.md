# 實作任務

> 依賴順序排列：共享抽象 → config → client/adapter → 接線/相依 → 編排 → 測試。
> (P) = 高優先/關鍵路徑。每項標註對應需求。

## 1. 共享抽象（為外部簽名器與後續擴充奠基）

- [ ] 1.1 (P) 新增外部簽名器共享錯誤階層（`core/errors.ts`）
  - 新增 `ExternalSignerError`（基底，extends `WalletError`）與 `ExternalSignerConfigError`/`ExternalSignerExecutionError`/`ExternalSignerUsageError`/`ExternalSignerNotFoundError` 子類
  - 錯誤類別可攜帶 `code`（機器可讀，對應 wallet-cli `error.code`）
  - 加法性：不影響既有錯誤類別與 `instanceof WalletError` 行為
  - _Requirements: 5.1, 5.2_

- [ ] 1.2 (P) 新增共享 config resolver 基底（`core/providers/external-signer-config.ts`）
  - 泛型 `ExternalSignerConfigResolver<TConfig, TSource>`，封裝 config-only 解析、`normalizeValue`（trim）、`requireFields`（偵測缺失必填）
  - 不 merge env（與 Privy 一致）
  - _Requirements: 6.1_

- [ ] 1.3 (P) 新增註冊表分派機制（`core/providers/wallet-builder.ts`）
  - 新增 `externalSignerRegistry`（`Map<string, ExternalSignerBuilder>`）與 `registerExternalSigner(type, builder)`
  - `createAdapter` 對外部簽名器走 `externalSignerRegistry.get(conf.type)`；`local_secure`/`raw_secret` 維持既有 if-else
  - `ExternalSignerBuilder` 簽章：`(params: unknown, ctx: { network?: string }) => Wallet`
  - _Requirements: 6.2, 6.3, 6.4_

- [ ] 1.4 將既有 Privy 錯誤類別回填至共享基底（加法性）
  - `PrivyConfigError`/`PrivyRequestError`/`PrivyAuthError`/`PrivyRateLimitError` 改 extend 對應 `ExternalSigner*` 基底
  - 確認全庫 `instanceof WalletError` 與 `instanceof Privy*` 檢查保持向後相容（已查證僅 `cli.ts` 查 `WalletError`）
  - _Requirements: 5.3_

## 2. Config 模型與 resolver

- [ ] 2.1 (P) 擴充 config schema 新增 `wallet_cli` 類型（`core/base.ts` + `core/config.ts`）
  - `core/base.ts`：`WalletType` 新增 `WALLET_CLI: 'wallet_cli'`
  - `core/config.ts`：`WalletConfigSchema` 的 type zod enum 新增 `'wallet_cli'`；新增 `WalletCliWalletParamsSchema`（`account` 選填、`password` 必填）；加入 params union；refine 補 `wallet_cli` 分支
  - 匯出 `WalletCliWalletParams` 型別
  - _Requirements: 3.1, 6.5_

- [ ] 2.2 (P) 實作 `WalletCliConfigResolver`（`core/providers/wallet-cli-config.ts`）
  - extends `ExternalSignerConfigResolver<WalletCliConfig, WalletCliConfigSource>`
  - `resolve()` 校驗 `password` 必填（缺失拋 `WalletCliConfigError`）；`account` 選填
  - config-only，正規化（trim）由基底提供
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.2, 3.3_

## 3. 子程序傳輸 client

- [ ] 3.1 (P) 實作 `WalletCliClient`（`core/clients/wallet-cli.ts`）
  - 以 `child_process.spawn` 啟動 `wallet-cli` 子程序，`-o json` 取單一終端 JSON frame
  - zod 校驗 `wallet-cli.result.v1` 信封（`schema`/`success`/`command`/`data`/`error`/`chain`/`meta`）
  - 退出碼分派：0 → 回 `data`；1 → `WalletCliExecutionError`（帶 `code`）；2 → `WalletCliUsageError`；ENOENT → `WalletCliNotFoundError`（提示 `npm i -g @tron-walletcli/wallet-cli`）
  - stdin 串流：供 `--password-stdin`（密碼）與 `--tx-stdin`（已簽 tx）寫入後關閉
  - `timeoutMs`（預設 60000）綁定每次呼叫
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [ ] 3.2 (P) 實作 binary 解析與 Node 版本守衛
  - 首次呼叫延遲解析：顯式 `binary` → `AGENT_WALLET_WALLET_CLI_PATH` → PATH `wallet-cli` → 皆無拋 `WalletCliNotFoundError`
  - 偵測 `process.version < 20` 時拋明確錯誤「wallet-cli requires Node.js ≥20」
  - 不硬編碼 `node_modules/.bin` 路徑猜測
  - _Requirements: 7.3, 7.4, 7.6_

- [ ] 3.3 實作簽名/位址相關方法
  - `currentAccount(accountRef?)` → `current`（無密碼）
  - `signTransaction(transactionJson, password, accountRef?)` → `tx sign --transaction <json> --password-stdin`
  - `signMessage(message, password, accountRef?)` → `message sign --message <text> --password-stdin`
  - `signTypedData(typedDataJson, password, accountRef?)` → `typed-data sign --typed-data <json> --password-stdin`
  - 通用 `run(args, stdinPayload?)` 供 `integrations/` 與未來擴充
  - _Requirements: 1.2, 1.3, 1.4, 4.3_

## 4. 簽名適配器

- [ ] 4.1 (P) 實作 `WalletCliSigner`（`core/adapters/wallet-cli.ts`）
  - `implements Wallet, Eip712Capable`；建構子接收 `WalletCliConfig`（含密碼）+ `WalletCliClient`
  - `getAddress()` → `client.currentAccount()`，回 `addresses.tron`，快取結果
  - `signTransaction(payload)` → `client.signTransaction` → `JSON.stringify(data.signed)`
  - `signMessage(msg)` → `Uint8Array` 以 UTF-8 解碼為文字 → `client.signMessage` → `data.signature.slice(2)` 去 `0x`
  - `signTypedData(data)` → `client.signTypedData` → `data.signature.slice(2)` 去 `0x`
  - `signRaw(_rawTx)` → 拋 `UnsupportedOperationError`（語意註明：wallet-cli 無對應指令，EIP-191 與 keccak256 raw 語意不同）
  - 密碼只在 adapter 內部經 stdin 傳 wallet-cli，不進 argv/env/日誌
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.2, 9.1, 9.2, 10.2, 10.3, 10.4, 10.5_

## 5. 接線與相依

- [ ] 5.1 (P) 接線 `createAdapter` 註冊 `wallet_cli`（`core/providers/wallet-builder.ts`）
  - `registerExternalSigner('wallet_cli', (params, _ctx) => { resolver.resolve() → new WalletCliSigner(resolved, new WalletCliClient()) })`
  - 不使用 `password`/`configDir`/`secretLoader`（與 Privy 分支一致）
  - 確認 `walletIsAvailableWithoutPassword` 對 `wallet_cli` 回 `true`（既有邏輯即正確）
  - _Requirements: 2.2, 2.5, 3.4_

- [ ] 5.2 (P) 匯出公開 API（`src/index.ts`）
  - 匯出 `WalletCliSigner`、`WalletCliClient`、`WalletCliConfigResolver`、相關型別、錯誤類別
  - _Requirements: 3.5_

- [ ] 5.3 (P) 宣告 wallet-cli 為 optional peer dependency（`packages/typescript/package.json`）
  - `peerDependencies`: `@tron-walletcli/wallet-cli: >=0.1.1`
  - `peerDependenciesMeta`: `{ "optional": true }`
  - `engines` 維持 Node ≥18（不抬升）
  - 開發/CI：`devDependency` 或 CI 預裝全域（供整合測試）
  - _Requirements: 7.1, 7.2, 7.5_

## 6. 選用鏈操作編排（`integrations/wallet-cli/`）

- [ ] 6.1 實作廣播/查詢方法（`integrations/wallet-cli/chain-ops.ts`）
  - `buildTransfer(opts)` → `tx send --dry-run`（無密碼，建未簽 tx + fee 估算）
  - `broadcast(signedTx, network)` → `tx broadcast --tx-stdin`（已簽 tx 走 stdin，無密碼）
  - `getTxStatus(txid, network)` → `tx status`（回四態）
  - `getBalance(address?, network)` → `account balance`
  - `getTxInfo(txid, network)` → `tx info`
  - 復用 `WalletCliClient.run`
  - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 6.2 實作 `signAndBroadcast` 編排助手（`integrations/wallet-cli/orchestrate.ts`）
  - 串接：`buildTransfer` → `wallet.signTransaction` → `broadcast` → （可選）`getTxStatus` 輪詢
  - 密碼僅在 `wallet.signTransaction` 內部使用（adapter 處理）
  - `wait:true` 輪詢至 `confirmed`/`failed` 或 `waitTimeoutMs`
  - timeout（交易可能在飛）不自動重送，回傳「以 `tx status` 複核」狀態
  - `tron:mainnet` 需顯式確認旗標
  - _Requirements: 8.1, 8.5, 8.6, 8.7, 8.8, 9.6_

## 7. 測試

- [ ] 7.1 (P) 單元測試：`WalletCliClient` 子程序互動與信封解析
  - stub `spawn` 模擬 exit 0/1/2 與 ENOENT，驗證信封解析與錯誤分派
  - stdin 餵密碼/tx 的串流行為驗證
  - zod 信封校驗：合法/缺欄/未知 schema fixture
  - binary 解析順序：顯式 → env → PATH → 皆無
  - Node 版本守衛：< 20 拋明確錯誤
  - _Requirements: 4.1-4.8, 7.3, 7.4, 7.6_

- [ ] 7.2 (P) 單元測試：`WalletCliSigner` 適配器
  - mock client，驗證 `getAddress` 快取、`signTransaction` 回 `JSON.stringify(data.signed)`、`signMessage`/`signTypedData` 去 `0x`、`signRaw` 拋 `UnsupportedOperationError`
  - `signMessage` 的 `Uint8Array` → UTF-8 文字轉換驗證
  - 密碼經 stdin 傳遞、不進 argv/env
  - _Requirements: 1.1-1.6, 9.1, 9.2, 10.2, 10.3, 10.4_

- [ ] 7.3 (P) 單元測試：config resolver 與 schema
  - `WalletCliConfigResolver`：密碼必填（缺失拋 `WalletCliConfigError`）、`account` 選填、正規化
  - zod schema：`wallet_cli` 條目校驗、params 形狀、refine 分支
  - _Requirements: 2.1-2.4, 3.1-3.3_

- [ ] 7.4 單元測試：擴充性抽象
  - `ExternalSignerConfigResolver` 基底行為
  - 註冊表：`registerExternalSigner` + `createAdapter` 分派（外部型走註冊表、`local_secure`/`raw_secret` 走既有 if-else）
  - Privy 錯誤回填後 `instanceof WalletError`/`instanceof Privy*` 相容
  - _Requirements: 5.1-5.3, 6.1-6.6_

- [ ] 7.5 單元測試：`signAndBroadcast` 編排
  - mock `Wallet` + mock `WalletCliClient`，驗證建→簽→廣→追蹤順序
  - 分支：confirmed/failed/pending/timeout
  - mainnet 確認旗標
  - _Requirements: 8.1-8.8_

- [ ] 7.6 整合測試（可跳過的網路測試）：真實 wallet-cli binary
  - 以真實 `wallet-cli`（CI 預裝）對 `tron:nile`：`current` 取位址（無密碼）→ `message sign`（密碼走 stdin）→ 驗證簽名
  - 標記為可跳過（離線/無 CI binary 時）
  - _Requirements: 1.1-1.4, 4.1-4.4_

- [ ] 7.7 跨平台測試
  - 子程序啟動、stdin 串流、PATH 解析在 macOS/Linux 明確測試
  - _Requirements: 4.1, 4.3, 7.3_

## 8. 變更後驗證（依 steering）

- [ ] 8.1 (P) 執行 `pnpm test`、`pnpm lint`、`pnpm build` 並確保通過
  - 若某項未跑，明述原因與後續計畫
  - _Requirements: 全域品質閘_

## 9. 文件（選用，後續）

- [ ] 9.1 補充 `structure.md` 說明 `integrations/` 層性質
  - 標示為選用編排膠水、可安全移除、不為簽名核心依賴
  - _Requirements: 8.1_
- [ ] 9.2 補充範例（`examples/wallet-cli-sign-and-broadcast.ts`）
  - 端到端範例：wallet-cli 建交易 → agent-wallet 簽名 → wallet-cli 廣播
  - _Requirements: 8.5_
- [ ] 9.3 CLI 支援（選用，後續階段）
  - 偵測 wallet-cli 是否在 PATH；mainnet 操作需互動確認；密碼寫入 config 遵循 `0600` 與 redaction
  - _Requirements: 非本期強制_
