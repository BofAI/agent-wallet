# 新增 wallet-cli 錢包

本指南說明如何把
**[`@tron-walletcli/wallet-cli`](https://www.npmjs.com/package/@tron-walletcli/wallet-cli)**
管理的 TRON/EVM 帳戶接到 agent-wallet，並驗證 transaction 與 typed-data 簽章。
agent-wallet 支援穩定版 `>=4.13.0 <5.0.0`，不支援 4.12.x。wallet-cli
本身雖提供 message signing，但 agent-wallet 目前不公開該能力。

## 事前準備

- 已安裝 wallet-cli，並已建立或匯入至少一個 account；keystore 與私鑰由它持有。
- wallet-cli keystore password。
- 選用的 account label（例如 `main-1`）；CLI 省略時會在密碼提示前解析 active account，並把 canonical accountId 寫入新 config。

> agent-wallet 不讀取或解密 wallet-cli keystore。每次簽章都會固定 canonical
> account/network，把 password 只寫入該次子程序 stdin，並核對回傳 signer。

---

## 安裝與初始化

### 1. 安裝相容的 wallet-cli

```bash
npm install -g '@tron-walletcli/wallet-cli@^4.13.0'
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

### 2. 建立或匯入 wallet-cli account

wallet-cli 4.13.0 沒有獨立的 `init` 命令。第一次建立或匯入 account 時會自動建立
`~/.wallet-cli`，並在互動終端中設定 master password。

建立全新的 HD wallet：

```bash
wallet-cli create --label main-1 -o json
```

`create` 會產生新的 BIP39 seed，不會要求匯入私鑰。若要恢復既有錢包，請由使用者在
本機互動終端中選擇其中一種匯入方式：

```bash
wallet-cli import mnemonic --label main-1 -o json
```

```bash
wallet-cli import private-key --label main-1 -o json
```

助記詞、私鑰與 master password 都透過隱藏提示輸入，不要放進 argv、環境變數、日誌或
聊天內容。`create` 不會把 recovery phrase 顯示到 stdout；建立後應由使用者在私人、非
Git 目錄中執行 `wallet-cli backup`，妥善保存離線備份。

### 3. 確認 account descriptor

相容版本可同時回傳 canonical account ID、TRON 地址與 EVM 地址：

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

互動模式也可用隱藏提示直接輸入 password，避免秘密出現在 argv：

```bash
agent-wallet add wallet_cli
```

選擇 `direct` 時，password 會以明文字串保存在權限為 `0600` 的
`wallets_config.json`；它不會顯示在 `inspect` 輸出，但能讀取該檔案的程序仍可取得。
需要避免落盤明文時，請選擇 `exec` 並使用上面的 `--cli-password-exec` 方式。

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
import { resolveWallet } from "@bankofai/agent-wallet";
import { WalletCliClient } from "@bankofai/agent-wallet/advanced";
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

- `unsupported_version`：不是穩定版 `>=4.13.0 <5.0.0`。
- `capability_missing`：catalog 缺目標 family 的簽章能力。
- `network_mismatch` / `contract_mismatch`：network 或 result envelope 不一致。
- `timeout` / `output_limit` / `aborted`：程序超時、輸出超限或 caller 取消。
- wallet-cli exit 1/2 的未知 `error.code` 仍會保留，以便 forward-compatible 處理。

不要對 timeout 的簽章或廣播自動重送。client 預設 60 秒 timeout、5 秒 TERM→KILL、
2 MiB stdout 與 64 KiB stderr 上限；錯誤不包含 argv payload、stdin 或原始程序輸出。

## agent-wallet 驗證策略

測試目標是確認 agent-wallet 的功能與外部程序邊界正確，不是替 wallet-cli 測試其內部
實作。一般 CI 使用 deterministic fixture 模擬 wallet-cli 的公開 machine contract，並驗證：

- `start/add wallet_cli` 會先解析 account，再收集 password source，並保存 canonical account ID。
- direct password 會寫入權限為 `0600` 的 config；全新 provider 重載後可完成簽章，而
  `inspect` 一律顯示 `[redacted]`。
- exec ref 可在全新 provider 重載後執行，且每次簽章都會重新取得一次 password。
- `resolve-address` 能回傳固定帳戶的 TRON/EVM 地址，且不取得 password。
- transaction 與 typed-data 會固定 account/network，正確傳遞 one-shot secret lease，並核對 signer。
- timeout、取消、錯誤 envelope、signer mismatch 與 capability drift 會被 agent-wallet 拒絕。

fixture 讓 CI 可重現 agent-wallet 的成功與失敗分支，不需要真實私鑰或外部網路。選用的
real-executable probe 只確認 agent-wallet 能與指定的 wallet-cli executable 對接，不將
wallet-cli 自身功能是否正確列為 agent-wallet 的測試責任：

```text
AGENT_WALLET_TEST_WALLET_CLI_PATH
AGENT_WALLET_TEST_WALLET_CLI_ACCOUNT
AGENT_WALLET_TEST_WALLET_CLI_NETWORK
```

只有 path 時會驗證 agent-wallet 的 executable resolution 與 compatibility handshake；
同時提供 account 與 network 時，會再經由 `WalletCliAdapter` 驗證 agent-wallet 的
canonical account 固定、network mapping 與地址解析。測試不會 fallback
到全域 binary，也不會修改、安裝依賴或建置上一級本機
`../wallet-cli`。

---

## 摘要

- 安裝穩定版 wallet-cli 4.x，建立或匯入 account；4.13.0 沒有獨立 `init`。
- 以互動輸入或 `--cli-password-exec` 設定秘密；不要使用明文 argv。
- 簽章一律指定完整 `tron:<name>` 或 `eip155:<chain-id>`。
- 核心簽章支援 TRON/EVM；選用 build/broadcast/status integration 仍為 TRON-only。
