# agent-wallet (TypeScript)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
![Node](https://img.shields.io/badge/node-≥18-blue.svg)

Universal multi-chain signing SDK for AI agents — TypeScript implementation.

This README is written to match the current unified project model:

- `resolveWallet(...)`
- `resolveWalletProvider(...)`
- `ConfigWalletProvider`
- `EnvWalletProvider`
- config-backed wallet types `local_secure` and `raw_secret`

## Install

```bash
pnpm add @bankofai/agent-wallet
```

## Public API

```ts
import {
  ConfigWalletProvider,
  EnvWalletProvider,
  resolveWallet,
  resolveWalletProvider,
} from "@bankofai/agent-wallet";
```

### resolveWallet

```ts
const wallet = await resolveWallet({ network: "eip155:1" });
const signature = await wallet.signMessage(new TextEncoder().encode("hello"));
```

### resolveWalletProvider

```ts
const provider = resolveWalletProvider({
  dir: "~/.agent-wallet",
  network: "tron:nile",
});
```

Provider resolution should follow the same config-first model as Python:

1. If a password is available from `runtime_secrets.json` or `AGENT_WALLET_PASSWORD`, use `ConfigWalletProvider`
2. Otherwise, if `wallets_config.json` contains wallets, use `ConfigWalletProvider`
3. Otherwise, fall back to `EnvWalletProvider`

## Config Model

The TypeScript package is expected to align with the same config shape:

- `wallets_config.json`
- `runtime_secrets.json`
- `secret_*.json`
- `master.json`

Top-level wallet types:

- `local_secure`
- `raw_secret`

`raw_secret` material kinds:

- `private_key`
- `mnemonic`

## Environment Variables

| Variable | Description |
|---|---|
| `AGENT_WALLET_DIR` | Wallet directory, default `~/.agent-wallet` |
| `AGENT_WALLET_PASSWORD` | Password fallback for `local_secure` |
| `AGENT_WALLET_PRIVATE_KEY` | Env fallback private key |
| `AGENT_WALLET_MNEMONIC` | Env fallback mnemonic |
| `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX` | Optional mnemonic account index |

## CLI Model

The intended CLI model is the same as Python:

```bash
agent-wallet start local_secure -w default -p 'Abc12345!' -g
agent-wallet start raw_secret -w hot -k 0x...
agent-wallet add local_secure -w signer2 -g
agent-wallet add raw_secret -w seed -m "word1 word2 ..."
agent-wallet sign msg "Hello" --network eip155:1
agent-wallet use my-wallet
```

Important flags:

- `--wallet-id`, `-w`
- `--password`, `-p`
- `--network`, `-n`
- `--generate`, `-g`
- `--private-key`, `-k`
- `--mnemonic`, `-m`
- `--mnemonic-index`, `-mi`
- `--derive-as`
- `--save-runtime-secrets`

## Network Routing

- `tron` or `tron:<chain>` uses the TRON adapter
- `eip155` or `eip155:<chainId>` uses the EVM adapter
- TRON mnemonic derivation uses `m/44'/195'/0'/0/{index}`

## Wallet Interface

```ts
interface Wallet {
  getAddress(): Promise<string>;
  signRaw(rawTx: Uint8Array): Promise<string>;
  signTransaction(payload: Record<string, unknown>): Promise<string>;
  signMessage(msg: Uint8Array): Promise<string>;
}

interface Eip712Capable {
  signTypedData(data: Record<string, unknown>): Promise<string>;
}
```

## Examples

- [tron-sign-and-broadcast.ts](./examples/tron-sign-and-broadcast.ts)
- [bsc-sign-and-broadcast.ts](./examples/bsc-sign-and-broadcast.ts)
- [tron-x402-sign-typed-data.ts](./examples/tron-x402-sign-typed-data.ts)
- [bsc-x402-sign-typed-data.ts](./examples/bsc-x402-sign-typed-data.ts)
- [dual-sign-typed-data-from-private-key.ts](./examples/dual-sign-typed-data-from-private-key.ts)
- [switch-active-wallet.ts](./examples/switch-active-wallet.ts)

## Security

- `local_secure` uses encrypted local storage
- `raw_secret` stores secret material in plaintext config
- Signing is local-only

## Development

```bash
pnpm install
pnpm test
```

## License

[MIT](../../LICENSE) — BankOfAI
