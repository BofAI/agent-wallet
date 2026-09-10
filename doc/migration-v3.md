# 從 2.x 遷移到 3.0

3.0 將公開 API 收斂到 wallet resolution 與 signing，移除 agent-wallet 自有的加密
wallet storage，並為 transaction signing 引入穩定的 typed result。以下變更需要舊呼叫方
主動調整。

> **發布狀態：** `3.0.0` 已正式發布。以下 npm 升級命令可直接使用。

## 1. 升級套件

```bash
npm install @bankofai/agent-wallet@^3.0.0
```

只有使用 `wallet_cli` wallet type 時才需要安裝 optional peer dependency：

```bash
npm install '@tron-walletcli/wallet-cli@^4.13.0'
```

agent-wallet 需要 Node.js >=18；使用 wallet-cli 的 JavaScript entrypoint 時需要
Node.js >=20。

## 2. 遷移 wallet 設定

3.0 不再讀取 `local_secure`、agent-wallet master password 或 `runtime_secrets.json`。
升級前先備份 `~/.agent-wallet`，並在仍可使用 2.x 的環境中確認你能存取原始 key material。
接著選擇新的 wallet type：

- 開發或低價值環境：用 `agent-wallet start raw_secret` 重新匯入 private key 或 mnemonic。
- 本機生產簽章：先在 wallet-cli 建立或匯入 account，再用
  `agent-wallet start wallet_cli` 連結既有 account。
- Hosted signing：使用 `agent-wallet start privy`。

  3.0 不會自動把 encrypted `local_secure` secret 轉成明文 `raw_secret`。確認新 wallet 可解析
  地址與簽章後，再自行移除舊檔案。

## 3. 更新環境變數

| 2.x alias               | 3.0 變數                               |
| ----------------------- | -------------------------------------- |
| `TRON_PRIVATE_KEY`      | `AGENT_WALLET_PRIVATE_KEY`             |
| `TRON_MNEMONIC`         | `AGENT_WALLET_MNEMONIC`                |
| `TRON_ACCOUNT_INDEX`    | `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX`  |
| `AGENT_WALLET_PASSWORD` | 已移除；依 wallet type 設定 credential |

SDK env fallback 只讀取右欄的 `AGENT_WALLET_*` 名稱。CLI config 存在且至少包含一個
wallet 時，resolver 會優先使用 `ConfigWalletProvider`。

3.0 的所有 network 參數只接受精確 canonical CAIP-2：`eip155:<positive-chain-id>` 或
`tron:<positive-chain-id>`。請將 `eip155`、`tron`、`evm:1`、`tron:mainnet`、`tron:nile`
等舊值分別改為實際 chain ID（例如 `eip155:1`、`tron:728126428`、
`tron:3448148188`）。`AGENT_WALLET_PRIVATE_KEY` 與 Privy credential 本身不需變更；
只有傳入的 network 需要遷移。Privy 仍可省略 network，但提供時也必須 canonical。

## 4. 更新 transaction signing 結果

2.x 把 EVM raw transaction 或 JSON-encoded TRON transaction 都放在 `string` 中：

```ts
const signed = await wallet.signTransaction(payload);
```

3.0 回傳 discriminated union，呼叫方不應自行猜測或解析結果格式：

```ts
const signed = await wallet.signTransaction(payload);

if (signed.family === "evm") {
  await sendRawTransaction(signed.rawTransaction);
} else {
  await broadcastTronTransaction(signed.transaction);
}
```

相關型別為 `TransactionPayload`、`SignedTransactionArtifact`、
`EvmSignedTransactionArtifact` 與 `TronSignedTransactionArtifact`。

## 5. 按能力呼叫 typed-data signing

`signRaw()` 與 `signMessage()` 已從公開契約移除。`signTypedData()` 不是每個 wallet
backend 都必須具備；呼叫前應檢查 additive capability：

```ts
import type { Eip712Capable, Wallet } from "@bankofai/agent-wallet";

function supportsTypedData(wallet: Wallet): wallet is Wallet & Eip712Capable {
  return (
    "signTypedData" in wallet && typeof wallet.signTypedData === "function"
  );
}
```

## 6. 更新 `ConfigWalletProvider` 建立方式

```ts
// 2.x
const provider = new ConfigWalletProvider(dir, password, { network });

// 3.0
const provider = new ConfigWalletProvider(dir, { network });
```

一般呼叫方應優先使用 `resolveWallet()` 或 `resolveWalletProvider()`。測試或整合需要替換
wallet-cli transport/secret provider 時，透過 `dependencies` 注入：

```ts
const provider = resolveWalletProvider({
  dir,
  network: "tron:3448148188",
  dependencies: { walletCli: { clientFactory, secretProviderFactory } },
});
```

## 7. 更新低階 API import

穩定入口保留 `Wallet`、providers、resolver、config types 與 errors。直接操作 adapters、
clients、secret providers 或 config resolvers 的進階整合需改用 `advanced` subpath：

```ts
// 2.x
import { WalletCliClient, ExecSecretProvider } from "@bankofai/agent-wallet";

// 3.0
import {
  WalletCliClient,
  ExecSecretProvider,
} from "@bankofai/agent-wallet/advanced";
```

wallet-cli 的 TRON-only build/broadcast/status helpers 維持獨立入口：

```ts
import { signAndBroadcast } from "@bankofai/agent-wallet/integrations/wallet-cli";
```

公開的 `registerExternalSigner()` / `isRegisteredExternalSigner()` 已移除；3.0 不支援執行期
注入未經 schema 驗證的新 wallet type。

## 8. 驗證遷移

```bash
agent-wallet list
agent-wallet resolve-address
agent-wallet sign typed-data '<payload-json>' -n eip155:1
```

應用程式端建議至少執行 TypeScript typecheck，並分別測試實際使用的 EVM/TRON result
branch。可執行範例位於 [`packages/typescript/examples/`](../packages/typescript/examples/)。
