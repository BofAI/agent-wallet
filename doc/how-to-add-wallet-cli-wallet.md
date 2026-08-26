# 新增 wallet-cli 錢包

本指南說明如何把
**[`@tron-walletcli/wallet-cli`](https://www.npmjs.com/package/@tron-walletcli/wallet-cli)**
管理的 TRON/EVM 帳戶接到 agent-wallet，並驗證 transaction、typed-data 與 UTF-8
message 簽章。agent-wallet 支援穩定版 `>=4.12.0 <5.0.0`。

## 事前準備

- 已安裝並初始化 wallet-cli；keystore 與私鑰由它持有。
- wallet-cli keystore password。
- 選用的 account label（例如 `main-1`）；CLI 省略時會在密碼提示前解析 active account，並把 canonical accountId 寫入新 config。

> agent-wallet 不讀取或解密 wallet-cli keystore。每次簽章都會固定 canonical
> account/network，把 password 只寫入該次子程序 stdin，並核對回傳 signer。

---

## 安裝與初始化

### 1. 安裝相容的 wallet-cli

```bash
npm install -g '@tron-walletcli/wallet-cli@^4.12.0'
```

驗證安裝：

```bash
wallet-cli --version
```

agent-wallet 首次使用時還會驗證 `--json-schema` 與 `networks -o json`。版本相符但
缺少目標 family 的簽章能力時仍會 fail-fast。

若 `wallet-cli` 不在 `PATH`，請設定 `AGENT_WALLET_WALLET_CLI_PATH`。JavaScript
entrypoint（`.js`/`.mjs`/`.cjs`）會由目前的 Node 執行且需要 Node.js >=20；Windows
請指定 package 的 JavaScript entrypoint，不要指定會經 shell 展開的 `.cmd`/`.bat` shim。

### 2. 初始化 wallet-cli keystore

```bash
wallet-cli init
```

這會建立 wallet-cli keystore 並設定 password。非互動使用時不要把 password 放進 argv；
以下範例會改用 `--cli-password-exec`。

### 3. 建立或選擇帳戶

```bash
wallet-cli account create --label main-1
```

確認 canonical account descriptor；相容版本可同時回傳 TRON 與 EVM 地址：

```bash
wallet-cli current -o json
```

---

## 新增設定（建議方式）

先建立只輸出 password 的 executable：

```bash
#!/bin/sh
op read 'op://Private/wallet-cli-password/password'
```

再註冊 wallet：

```bash
agent-wallet add wallet_cli \
  --wallet-id my_cli_wallet \
  --account main-1 \
  --cli-password-exec /absolute/path/to/fetch-password.sh
```

`add/start wallet_cli` 只連結既有 account，不會建立或匯入 key。CLI 會先執行不需密碼的
`current [--account]`；帳戶不存在時會停止，不收集 password，並提示先回 wallet-cli 建立
或匯入帳戶。成功時 config 保存 wallet-cli 回傳的 canonical accountId，而不是依賴日後可能
改變的 active account。

首次建立設定也可以使用 `start`：

```bash
agent-wallet start wallet_cli \
  --wallet-id my_cli_wallet \
  --account main-1 \
  --cli-password-exec /absolute/path/to/fetch-password.sh
```

互動模式可安全提示直接輸入 password：

```bash
agent-wallet add wallet_cli
```

CLI 會拒絕 `--cli-password <plaintext>`，避免秘密出現在 shell history 或 process argv。
既有 `wallets_config.json` 明文字串仍可載入，但新自動化應使用 exec ref：

```json
{
  "type": "wallet_cli",
  "params": {
    "account": "main-1",
    "password": {
      "exec": "/absolute/path/to/fetch-password.sh",
      "timeout": 10000
    }
  }
}
```

exec 必須是可執行檔案路徑，不是 inline shell command。它會在**每次簽章**重新執行；
stdout 會 trim 後形成 one-shot lease，寫入一次便不可重用，最後清除可變 Buffer。預設
timeout 10 秒，stdout 64 KiB、stderr 16 KiB，錯誤不附帶 script 輸出。

---

## Inspect 與地址解析

檢查 wallet 詳細資訊：

```bash
agent-wallet inspect my_cli_wallet
```

```
  Wallet              my_cli_wallet
  Type                wallet_cli
  Account             main-1
  Keystore Password   [redacted]
```

地址解析只執行 capability handshake 與 `current`，不取得 password。若 descriptor
同時有兩個 family，CLI 會顯示 whitelist：

```bash
agent-wallet resolve-address my_cli_wallet
```

```
  Wallet    my_cli_wallet
  Type      wallet_cli
  EVM       0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  TRON      TMSgJxtPw29AFEHMXsjGo4kWV7UwbCToHJ
```

---

## 簽章

`wallet_cli` 強制完整 network：TRON 使用 `tron:<name>`，EVM 使用
`eip155:<positive-chain-id>`。裸 `tron`、裸 `eip155`、alias 或省略 network 都會在
子程序與秘密取得前失敗，不會默認 mainnet。

### UTF-8 message

```bash
agent-wallet sign message --message 'hello 世界' -n tron:nile -w my_cli_wallet
```

### Typed data（TIP-712 / EIP-712）

```bash
agent-wallet sign typed-data '{
  "domain": {},
  "types": {},
  "primaryType": "Order",
  "message": {}
}' -n eip155:1 -w my_cli_wallet
```

### TRON transaction

傳入 unsigned TRON transaction object（例如來自 `wallet-cli tx send --dry-run`
或 TronGrid）：

```bash
agent-wallet sign tx '{"txID":"...","raw_data":{},"raw_data_hex":"..."}' \
  -n tron:nile -w my_cli_wallet
```

回傳值是包含 `signature` 的完整 JSON artifact。

### EVM transaction

傳入尚未簽章且 `chainId` 與 network 一致的 transaction fields：

```bash
agent-wallet sign tx \
  '{"chainId":1,"nonce":0,"gas":"0x5208","gasPrice":"0x3b9aca00","to":"0x...","value":"0x0"}' \
  -n eip155:1 -w my_cli_wallet
```

adapter 使用 viem 序列化 legacy、EIP-2930、EIP-1559，再交給 `tx sign --hex`；輸出為
不含 `0x` 的 signed raw transaction。已簽 payload、TRON/EVM 欄位混用、chainId
mismatch、EIP-4844 與 EIP-7702 會被明確拒絕。raw digest signing 不在公開契約內。

---

## 建立、簽章與廣播（TRON-only 選用 integration）

核心 adapter 支援 TRON/EVM 簽章；`integrations/wallet-cli` 的 build、broadcast、status
刻意只支援 TRON，不提供 EVM RPC。以下 helper 維持 build → sign → broadcast → status：

```ts
import { resolveWallet, WalletCliClient } from "@bankofai/agent-wallet";
import { signAndBroadcast } from "@bankofai/agent-wallet/integrations/wallet-cli";

const client = new WalletCliClient();
const wallet = await resolveWallet({
  network: "tron:nile",
  dependencies: { walletCli: { clientFactory: () => client } },
});

const result = await signAndBroadcast(wallet, client, {
  to: "T...",
  amount: "1",
  network: "tron:nile",
  wait: true,
});
console.log(result);
// { txId: '...', stage: 'confirmed', confirmed: true, blockNumber: '...' }
```

`tron:mainnet` 必須明確傳 `confirmMainnet: true`。broadcast timeout 或狀態不明時不會
自動重簽或重送；caller 應以 `tx status` 複核。

## 錯誤與程序界線

首次操作會固定 version/catalog/networks snapshot；`current` 成功後也會固定 accountId 與
兩個 family address。每次簽章結果的 command、chain context、data shape 與 signer 都必須
一致。常見分類包含：

- `unsupported_version`：不是穩定版 `>=4.12.0 <5.0.0`。
- `capability_missing`：catalog 缺目標 family 的簽章能力。
- `network_mismatch` / `contract_mismatch`：network 或 result envelope 不一致。
- `timeout` / `output_limit` / `aborted`：程序超時、輸出超限或 caller 取消。
- wallet-cli exit 1/2 的未知 `error.code` 仍會保留，以便 forward-compatible 處理。

不要對 timeout 的簽章或廣播自動重送。client 預設 60 秒 timeout、5 秒 TERM→KILL、
2 MiB stdout 與 64 KiB stderr 上限；錯誤不包含 argv payload、stdin 或原始程序輸出。

## 測試與本機 wallet-cli

一般 CI 使用 deterministic fixture，不需要安裝 wallet-cli。真實契約測試必須明確設定：

```text
AGENT_WALLET_TEST_WALLET_CLI_PATH
AGENT_WALLET_TEST_WALLET_CLI_ACCOUNT
AGENT_WALLET_TEST_WALLET_CLI_NETWORK
AGENT_WALLET_TEST_WALLET_CLI_PASSWORD_EXEC
```

只有 path 時會 probe version/catalog/networks/current；四個值都存在才會執行 message
signing。測試不會 fallback 到全域 binary，也不會修改、安裝依賴或建置上一級本機
`../wallet-cli`。

---

## 摘要

- 安裝穩定版 wallet-cli 4.x，初始化 keystore 與帳戶。
- 以互動輸入或 `--cli-password-exec` 設定秘密；不要使用明文 argv。
- 簽章一律指定完整 `tron:<name>` 或 `eip155:<chain-id>`。
- 核心簽章支援 TRON/EVM；選用 build/broadcast/status integration 仍為 TRON-only。
