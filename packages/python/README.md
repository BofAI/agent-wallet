# agent-wallet (Python)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
![Python](https://img.shields.io/badge/python-≥3.10-blue.svg)

Universal multi-chain signing SDK for AI agents — Python implementation.

## Install

```bash
pip install bankofai-agent-wallet
```

Includes CLI (`agent-wallet`), EVM and TRON support — no extras needed.

## Quick Start

```python
from agent_wallet import resolve_wallet

wallet = await resolve_wallet(network="tron:nile")
signature = await wallet.sign_message(b"hello")
```

`resolve_wallet` automatically finds your wallet config in `~/.agent-wallet` (or `AGENT_WALLET_DIR`).

## Public API

```python
from agent_wallet import (
    resolve_wallet,           # → Wallet (one-shot)
    resolve_wallet_provider,  # → ConfigWalletProvider | EnvWalletProvider
    ConfigWalletProvider,     # file-backed provider (local_secure / raw_secret)
    EnvWalletProvider,        # env-var-backed provider (AGENT_WALLET_PRIVATE_KEY)
)
```

### resolve_wallet

Returns a ready-to-sign `Wallet` for the given network:

```python
wallet = await resolve_wallet(network="eip155:1")
sig = await wallet.sign_transaction({"to": "0x...", "value": 0})
```

### resolve_wallet_provider

Returns either `ConfigWalletProvider` or `EnvWalletProvider` based on what's available:

```python
provider = resolve_wallet_provider(network="eip155:1")

# Get the active wallet
wallet = await provider.get_active_wallet()

# Or a specific wallet
wallet = await provider.get_wallet("my_wallet", network="tron:nile")
```

### Provider resolution order

1. Password available (from `runtime_secrets.json` or `AGENT_WALLET_PASSWORD`) → `ConfigWalletProvider`
2. `wallets_config.json` exists with wallets → `ConfigWalletProvider`
3. Otherwise → `EnvWalletProvider` (reads `AGENT_WALLET_PRIVATE_KEY` / `AGENT_WALLET_MNEMONIC`)

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

Both EVM and TRON network-specific signers implement `Wallet` + `Eip712Capable`.

## Network Routing

| Network string | Adapter | Mnemonic derivation |
|---|---|---|
| `eip155` or `eip155:<chainId>` | EVM | `m/44'/60'/0'/0/{index}` |
| `tron` or `tron:<chain>` | TRON | `m/44'/195'/0'/0/{index}` |

## Environment Variables

| Variable | Description |
|---|---|
| `AGENT_WALLET_DIR` | Wallet directory (default `~/.agent-wallet`) |
| `AGENT_WALLET_PASSWORD` | Password for `local_secure` wallets |
| `AGENT_WALLET_PRIVATE_KEY` | Env fallback private key (hex) |
| `AGENT_WALLET_MNEMONIC` | Env fallback mnemonic phrase |
| `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX` | Mnemonic account index (default `0`) |

## Examples

- [tron_sign_and_broadcast.py](./examples/tron_sign_and_broadcast.py)
- [bsc_sign_and_broadcast.py](./examples/bsc_sign_and_broadcast.py)
- [tron_x402_sign_typed_data.py](./examples/tron_x402_sign_typed_data.py)
- [bsc_x402_sign_typed_data.py](./examples/bsc_x402_sign_typed_data.py)
- [dual_sign_typed_data_from_private_key.py](./examples/dual_sign_typed_data_from_private_key.py)
- [switch_active_wallet.py](./examples/switch_active_wallet.py)

## Development

```bash
pip install -e ".[dev]"
pytest
```

## License

[MIT](../../LICENSE) — BankOfAI
