# 需求審查報告

審查範圍：`requirements.md` ↔ `design.md` ↔ 既有程式碼庫。目標：找出缺口、矛盾、不可行項，並驗證可追溯性。

## 審查結論

| 類別 | 結果 |
|------|------|
| 需求 ↔ 設計追溯性 | ✅ 通過——10 項需求逐一對應設計章節 |
| 需求 ↔ 程式碼可行性 | ✅ 通過——所有需求在既有架構下可實作 |
| 需求內部一致性 | ✅ 通過——無矛盾 |
| 缺口 | ⚠️ 3 項（2 已修正、1 已設計處理） |
| 已知取捨（非缺陷） | 1 項（已記錄） |

## 發現的缺口（已修正）

### GAP-1：需求 6.5 遺漏 `WalletType` enum 更新（嚴重度：低）

**問題**：需求 6.5 謂新增外部錢包可僅透過「config schema 新增 params schema + extend 共享基底 + 註冊 builder + 匯出」完成。但設計的擴充配方步驟 1 還包含「新型加入 `WalletType` enum」——需求遺漏此項，且 `WalletType` 常數位於 `core/base.ts`（非 `core/config.ts`）。

**驗證**：
- `core/base.ts`：`export const WalletType = { LOCAL_SECURE, RAW_SECRET, PRIVY }`——新增型須於此加 `WALLET_CLI`。
- `core/config.ts`：`z.enum(['local_secure','raw_secret','privy'])`——新增型須於此加 `'wallet_cli'`。
- 設計步驟 1 原標「`core/config.ts`」未涵蓋 `base.ts`。

**修正**：
- 需求 6.5 補述「新增 `WalletType` enum 值（`core/base.ts`）」。
- 設計擴充配方步驟 1 修正為「`core/base.ts` + `core/config.ts`」。

### GAP-2：設計擴充配方步驟 1 檔案標註不精確（嚴重度：低）

**問題**：設計步驟 1 原標「`core/config.ts`：新型加入 `WalletType` enum...」，但 `WalletType` 常數在 `core/base.ts`，不在 `core/config.ts`。zod enum/schema/refine 才在 `config.ts`。

**修正**：設計步驟 1 拆分為兩處：`core/base.ts`（`WalletType`）+ `core/config.ts`（params schema + union + refine）。

## 發現的缺口（已修正）

> 下方 GAP-1/GAP-2 已修正見前述。

### GAP-3：`signMessage` 的 `Uint8Array` → 文字轉換未明確（嚴重度：中）

**問題**：`Wallet.signMessage(msg: Uint8Array)` 介面收位元組，但 wallet-cli `message sign --message <text>` 收**文字字串**，文件未記載 hex/encoding 輸入。adapter 須將 `Uint8Array` 轉為文字才能走 argv，但轉換方式（UTF-8 解碼 vs hex）會影響簽名結果——若 wallet-cli 內部以 UTF-8 解碼文字再簽，則傳 hex 字串與傳解碼文字會產生**不同簽名**。

**既有模式**：`TronSigner.signMessage` 直接對 `Uint8Array` 做 `keccak256` 後簽（無文字解碼）；`EvmSigner.signMessage` 用 viem `{ message: { raw: msg } }`（位元組原樣）。兩者皆處理位元組，不經文字中介。wallet-cli 經文字中介，語意有別。

**影響**：純 ASCII 訊息（如 `"hello"`）無問題（UTF-8 與 ASCII 一致）。含非 UTF-8 位元組的訊息會簽名不一致。

**修正（設計處理）**：`WalletCliSigner.signMessage` 應以 UTF-8 解碼 `Uint8Array` 為文字字串傳 wallet-cli `--message`；並在文件/註解明確標示此語意差異（wallet-cli 的 personal_sign 簽的是「UTF-8 文字」，非任意位元組）。對需簽名任意位元組的場景，應改用 `signTransaction` 或另議 hex 輸入（若 wallet-cli 未來支援）。

**建議**：需求 1.4 與設計 1.4 補述此轉換與語意限制。

## 已知取捨（非缺陷，已記錄）

### TRADE-OFF-1：keystore 密碼明文存於 config

**現況**：需求 2.1 謂 wallet-cli keystore 密碼存於 `wallets_config.json` 的 `params.password`（明文，檔案 `0600`），鏡像 Privy `app_secret`。此為使用者明確指定之設計方向。

**張力**：wallet-cli 自身將金鑰加密於 keystore，但解密所需的密碼卻以明文存於另一個 config 檔。若主機被攻陷，攻擊者可同時取得 config 與 keystore，加密形同虛設。然而此張力與 Privy `app_secret` 完全一致（API secret 亦明文存於 config），且使用者已確認採此方向。

**建議（未來增強，非本期）**：可引入 `password_ref` 模式（如 `local_secure` 的 `secret_ref`），將密碼存於 agent-wallet 的加密 KV store，config 僅存參照。此為加法性增強，不影響現有 `params.password` 路徑。

## 程式碼可行性驗證

| 需求宣稱 | 程式碼驗證 | 結果 |
|----------|-----------|------|
| 2.5: `wallet_cli` 無需 agent-wallet 主密碼即可用 | `walletIsAvailableWithoutPassword` = `conf.type !== 'local_secure'`；`wallet_cli` 回 `true` | ✅ 無需改動 |
| 3.4: 既有 resolver 自動套用、無需改動 | `resolveNetwork` 不拋錯（無 network 時回 `undefined`）；`getWallet` 呼叫 `createAdapter`，加分支/註冊表即可 | ✅ 無需改動 `resolveWallet` |
| 5.3: Privy 回填保持 `instanceof WalletError` 相容 | 全庫 `instanceof` 僅查 `WalletError`（`cli.ts:1415` 等），無 `instanceof Privy*` | ✅ 加法性安全 |
| 1.4: `signTypedData` 回傳去 `0x` 前綴簽名字串 | `Wallet.signTypedData` 回傳 `Promise<string>`（僅簽名）；wallet-cli 額外回傳的 `digest`/`primaryType` 正確丟棄 | ✅ 介面相容 |
| 4.3: payload 走 argv、密碼走 stdin（fd0 單一消費者） | wallet-cli 文件確認：`--transaction`/`--message`/`--typed-data` 走 argv，`--password-stdin` 走 stdin | ✅ 符合 wallet-cli 規範 |

## 追溯性驗證

所有設計章節皆有對應需求：

| 設計章節 | 對應需求 |
|----------|----------|
| Component Design Part 1（簽名後端） | 需求 1, 2, 3 |
| Component Design 1.3（WalletCliClient） | 需求 4 |
| Component Design Part 2（編排） | 需求 8 |
| Extensibility | 需求 6 |
| Installation & Dependency | 需求 7 |
| System Flows | 需求 4（互動細節） |
| Error Handling | 需求 5 |
| Data Models / Contracts | 需求 10 |
| Security Considerations | 需求 9 |

## 無矛盾驗證

逐一交叉檢查需求間與設計間的一致性，未發現矛盾：
- 需求 2.4（無 env 覆寫密碼）↔ 設計 config-only — 一致 ✅
- 需求 7.1（optional peer）↔ 設計 Installation — 一致 ✅
- 需求 1.5（signRaw 拋 UnsupportedOperationError）↔ 設計 adapter — 一致 ✅
- 需求 6.6（不引入動態 plugin）↔ 設計取捨 — 一致 ✅
- 需求 4.8（timeout 不自動重送）↔ 設計 Error Handling — 一致 ✅
