# agent-wallet (Python)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
![Python](https://img.shields.io/badge/python-≥3.10-blue.svg)

Universal multi-chain secure signing SDK for AI agents — Python implementation.

Signing-only by design: handles key storage and signing locally, with no RPC or network dependencies. The caller builds and broadcasts transactions.

## Install

```bash
pip install agent-wallet              # Core only (encryption, config)
pip install agent-wallet[evm]         # + EVM signing (eth-account)
pip install agent-wallet[tron]        # + TRON signing (tronpy)
pip install agent-wallet[cli]         # + CLI (typer, rich, questionary)
pip install agent-wallet[all]         # Everything
```

**Requires Python ≥ 3.10**

## Quick Start

### SDK

```python
import asyncio
from agent_wallet import WalletFactory

async def main():
    # Initialize provider (decrypts keys, then discards password)
    provider = WalletFactory(secrets_dir="~/.agent-wallet", password="my-password")

    # List available wallets
    wallets = await provider.list_wallets()
    for w in wallets:
        print(f"{w.id} ({w.type}, {w.chain_id})")

    # Get a wallet and sign
    wallet = await provider.get_wallet("my-wallet")
    address = await wallet.get_address()
    signature = await wallet.sign_message(b"Hello from agent-wallet!")

asyncio.run(main())
```

### CLI

```bash
# Initialize secrets directory with master password
agent-wallet init

# Add a wallet (interactive — choose type, chain, enter private key)
agent-wallet add

# List all wallets
agent-wallet list

# Sign a message
agent-wallet sign msg --wallet my-wallet --message "Hello"

# Sign a transaction (from JSON file)
agent-wallet sign tx --wallet my-wallet --payload '{"txID": "...", "raw_data_hex": "..."}'

# Sign EIP-712 typed data (from JSON file)
agent-wallet sign typed --wallet my-wallet --payload '{"domain": {...}, "types": {...}, ...}'
```

Environment variables:
- `AGENT_WALLET_DIR` — Secrets directory (default: `~/.agent-wallet`)
- `AGENT_WALLET_PASSWORD` — Master password (avoids interactive prompt)

## API Reference

### WalletFactory

```python
from agent_wallet import WalletFactory

# Local mode — keys stored on disk, encrypted with Keystore V3
provider = WalletFactory(secrets_dir="/path/to/secrets", password="master-pw")

# Remote mode — proxy signing to a remote agent-wallet server
provider = WalletFactory(remote_url="https://signer.example.com", token="bearer-token")
```

### BaseWallet

All wallet adapters (EVM, TRON) implement the same interface:

```python
class BaseWallet(ABC):
    async def get_address() -> str
    async def sign_raw(raw_tx: bytes) -> str
    async def sign_transaction(payload: dict) -> str
    async def sign_message(msg: bytes) -> str

class Eip712Capable(ABC):
    async def sign_typed_data(data: dict) -> str
```

All signing methods return hex-encoded signature strings (no `0x` prefix).

### EVM Signing

```python
wallet = await provider.get_wallet("my-evm-wallet")

# Sign arbitrary message (EIP-191 personal sign)
sig = await wallet.sign_message(b"Hello")

# Sign EIP-712 typed data
sig = await wallet.sign_typed_data({
    "types": {
        "EIP712Domain": [{"name": "name", "type": "string"}, ...],
        "Transfer": [{"name": "to", "type": "address"}, {"name": "amount", "type": "uint256"}],
    },
    "primaryType": "Transfer",
    "domain": {"name": "MyDApp", "version": "1", "chainId": 1, ...},
    "message": {"to": "0x...", "amount": 1000000},
})

# Sign a pre-built transaction dict
sig = await wallet.sign_transaction({"to": "0x...", "value": 0, "gas": 21000, ...})
```

### TRON Signing

```python
wallet = await provider.get_wallet("my-tron-wallet")

# Sign message (keccak256 + secp256k1, no Ethereum prefix)
sig = await wallet.sign_message(b"Hello")

# Sign a pre-built unsigned transaction from TronGrid
# The caller builds the tx via TronGrid API, SDK only signs
signed_json = await wallet.sign_transaction({
    "txID": "abc123...",
    "raw_data_hex": "0a02...",
    "raw_data": {...},
})

# Sign EIP-712 typed data (same secp256k1 curve as EVM)
sig = await wallet.sign_typed_data({...})
```

### Error Handling

```python
from agent_wallet import WalletNotFoundError, SigningError, DecryptionError

try:
    wallet = await provider.get_wallet("nonexistent")
except WalletNotFoundError:
    print("Wallet not found")

try:
    sig = await wallet.sign_message(b"data")
except SigningError as e:
    print(f"Signing failed: {e}")
```

Error hierarchy:

```
WalletError
├── WalletNotFoundError
├── DecryptionError
├── SigningError
├── NetworkError
├── InsufficientBalanceError
└── UnsupportedOperationError
```

## Supported Chains

| Chain | Type | Chain ID |
|---|---|---|
| Ethereum | `evm_local` | `eip155:1` |
| BSC | `evm_local` | `eip155:56` |
| Polygon | `evm_local` | `eip155:137` |
| Base | `evm_local` | `eip155:8453` |
| Arbitrum | `evm_local` | `eip155:42161` |
| TRON Mainnet | `tron_local` | `tron:mainnet` |
| TRON Nile | `tron_local` | `tron:nile` |
| TRON Shasta | `tron_local` | `tron:shasta` |

## Examples

- [tron_sign_and_broadcast.py](./examples/tron_sign_and_broadcast.py) — Build tx via TronGrid, sign with SDK, broadcast
- [x402_sign_typed_data.py](./examples/x402_sign_typed_data.py) — EIP-712 typed data signing for x402 PaymentPermit

## Security

- **Keystore V3** — scrypt (N=262144, r=8, p=1) + AES-128-CTR + keccak256 MAC
- **Password not retained** — Discarded after provider initialization
- **No network calls** — All signing is pure local computation
- **Sentinel verification** — Master password correctness verified before key decryption

## Development

```bash
# Install with all extras
pip install -e ".[all]"

# Run tests
pytest

# Run specific test file
pytest tests/test_tron_wallet.py -v
```

## Cross-Language Compatibility

This Python SDK is fully compatible with the [TypeScript implementation](../typescript/):
- Same keystore file format (files are interchangeable)
- Same signatures for same key + data
- Same address derivation

## License

[MIT](../../LICENSE) — BankOfAI
