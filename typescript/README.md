# Agent Wallet SDK (TypeScript)

## Provider abstraction

- **BaseProvider**: Abstract base class with a unified interface:
  - `getAccountInfo(): Promise<AccountInfo>` — returns `{ address: string }` (wallet address)
  - `signMessage(message: Uint8Array): Promise<string>` — signs arbitrary bytes and returns a signature string
  - `signTx(unsignedTx: unknown): Promise<SignedTxResult>` — accepts an unsigned payload, signs it, and returns `{ signedTx, signature? }`
- Providers depend on an abstract **KeystoreBase** type, so you can inject other keystore implementations if needed (default is the file-based `Keystore` at `~/.agent_wallet/Keystore`).
- **TronProvider**: Extends BaseProvider; uses TronWeb with local private-key signing.
- **FlashProvider**: Extends TronProvider; supports Privy remote signing and Flash node.

### Keystore initialization is done via CLI

Create the keystore file and write credentials using the keystore CLI (recommended):

```bash
npx -p @bankofai/agent-wallet agent-wallet-keystore init
npx -p @bankofai/agent-wallet agent-wallet-keystore write privateKey "hex..."
```

### Provider usage

```ts
import { TronProvider } from '@bankofai/agent-wallet';

// Keystore file initialization is done via CLI.
// Providers read keystore data in the constructor.
const tron = new TronProvider({
  // Optional overrides. Recommended: write these into keystore via CLI.
  // privateKey: 'hex...',
});

const info = await tron.getAccountInfo(); // { address: 'T...' }
const signed = await tron.signTx(unsignedTx);
```

### Sign an arbitrary message

```ts
const sig = await tron.signMessage(Buffer.from('hello', 'utf8'));
console.log(sig);
```

## Keystore

A fixed-path Protobuf file stores account info (privateKey, apiKey, secretKey, etc.). The storage format is cross-language compatible with the Python SDK.

- **Path**: Default `~/.agent_wallet/Keystore`; override via `KEYSTORE_PATH` env var or the `filePath` option.
- **Storage format**: Protobuf wire format (`map<string, string>`), NOT JSON.
- **Atomic writes**: All writes go through a `.tmp` file then `rename`, preventing data loss on crash.
- **Backward compatible**: Can still read legacy plain-JSON keystore files.

## Tests

```bash
npm test
```

## Logging

Set `LOG_LEVEL` to control verbosity: `trace|debug|info|warn|error|fatal|silent`.

