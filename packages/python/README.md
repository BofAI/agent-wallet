# agent-wallet (Python)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
![Python](https://img.shields.io/badge/python-≥3.10-blue.svg)

Universal multi-chain signing SDK for AI agents — Python implementation.

The Python package is built around two public entry points:

- `resolve_wallet(...)`
- `resolve_wallet_provider(...)`

It supports two config-backed wallet types:

- `local_secure`
- `raw_secret`

## Public API

```python
from agent_wallet import (
    ConfigWalletProvider,
    EnvWalletProvider,
    resolve_wallet,
    resolve_wallet_provider,
)
```

### resolve_wallet

```python
from agent_wallet import resolve_wallet

wallet = await resolve_wallet(network="tron:nile")
signature = await wallet.sign_message(b"hello")
```

### resolve_wallet_provider

```python
from agent_wallet import ConfigWalletProvider, resolve_wallet_provider

provider = resolve_wallet_provider(dir="~/.agent-wallet", network="eip155:1")
if isinstance(provider, ConfigWalletProvider):
    print(provider.get_active_id())
```

Provider resolution is config-first:

1. If a password is available from `runtime_secrets.json` or `AGENT_WALLET_PASSWORD`, resolve `ConfigWalletProvider`
2. Otherwise, if `wallets_config.json` contains wallets, resolve `ConfigWalletProvider`
3. Otherwise, fall back to `EnvWalletProvider`

## Config Model

`wallets_config.json` stores:

- `active_wallet`
- `wallets`

Top-level wallet types:

- `local_secure`
  - config stores `secret_ref`
  - secret bytes live in `secret_<wallet-id>.json`
- `raw_secret`
  - config stores secret material directly
  - raw material may be:
    - `private_key`
    - `mnemonic`

Related files in the wallet directory:

- `wallets_config.json`
- `runtime_secrets.json`
- `secret_*.json`
- `master.json`

## Environment Variables

| Variable | Description |
|---|---|
| `AGENT_WALLET_DIR` | Wallet directory, default `~/.agent-wallet` |
| `AGENT_WALLET_PASSWORD` | Password fallback for `local_secure` |
| `AGENT_WALLET_PRIVATE_KEY` | Env fallback private key |
| `AGENT_WALLET_MNEMONIC` | Env fallback mnemonic |
| `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX` | Optional mnemonic account index |

`runtime_secrets.json` is an optional local fallback for secrets that cannot be passed via env. Today it stores:

```json
{
  "password": "..."
}
```

## CLI

### Quick start

```bash
# Create a secure local wallet
agent-wallet start local_secure -w default -p 'Abc12345!' -g

# Create a raw secret wallet from a private key
agent-wallet start raw_secret -w hot -k 0x...

# Create a raw secret wallet from a mnemonic
agent-wallet start raw_secret -w seed -m "word1 word2 ..." -mi 1
```

### Storage initialization

```bash
agent-wallet init -p 'Abc12345!'
```

### Add wallets

```bash
agent-wallet add local_secure -w signer2 -g
agent-wallet add local_secure -w signer3 -m "word1 ..." --derive-as eip155
agent-wallet add raw_secret -w hot2 -k 0x...
```

### Active wallet management

```bash
agent-wallet list
agent-wallet use my-wallet
agent-wallet inspect my-wallet
agent-wallet remove my-wallet
```

### Signing

```bash
agent-wallet sign msg "Hello" --network eip155:1
agent-wallet sign tx '{"to":"0x..."}' --network eip155:1 -w other-wallet
agent-wallet sign typed-data '{"types": {...}}' --network tron:nile
```

Important CLI flags:

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

```python
class Wallet(ABC):
    async def get_address() -> str
    async def sign_raw(raw_tx: bytes) -> str
    async def sign_transaction(payload: dict) -> str
    async def sign_message(msg: bytes) -> str

class Eip712Capable(ABC):
    async def sign_typed_data(data: dict) -> str
```

## Examples

- [tron_sign_and_broadcast.py](./examples/tron_sign_and_broadcast.py)
- [bsc_sign_and_broadcast.py](./examples/bsc_sign_and_broadcast.py)
- [tron_x402_sign_typed_data.py](./examples/tron_x402_sign_typed_data.py)
- [bsc_x402_sign_typed_data.py](./examples/bsc_x402_sign_typed_data.py)
- [dual_sign_typed_data_from_private_key.py](./examples/dual_sign_typed_data_from_private_key.py)
- [switch_active_wallet.py](./examples/switch_active_wallet.py)

## Security

- `local_secure` uses encrypted local storage
- `raw_secret` stores secret material in plaintext config
- Password strength is enforced for secure local setup
- Signing is local-only

## Development

```bash
pip install -e ".[all]"
pytest
```

## License

[MIT](../../LICENSE) — BankOfAI
