# agent-wallet (Python)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
![Python](https://img.shields.io/badge/python-≥3.10-blue.svg)

Universal multi-chain secure signing SDK for AI agents — Python implementation.

Signing-only by design: handles key storage and signing locally, with no RPC or network dependencies. The caller builds and broadcasts transactions.

**Requires Python ≥ 3.10**

Python install and quick start instructions are intentionally omitted for now.
The package is not currently published for direct installation.

### CLI

```bash
# Initialize secrets directory with master password
agent-wallet init

# Add a wallet (interactive — choose type, enter private key)
agent-wallet add

# List all wallets
agent-wallet list

# Set active wallet (skip --wallet on subsequent commands)
agent-wallet use my-wallet

# Sign a message (uses active wallet)
agent-wallet sign msg "Hello"

# Override active wallet with explicit --wallet
agent-wallet sign msg "Hello" --wallet other

# Sign a transaction (JSON payload)
agent-wallet sign tx '{"txID": "...", "raw_data_hex": "..."}' --wallet my-wallet

# Sign EIP-712 typed data (JSON payload)
agent-wallet sign typed-data '{"domain": {...}, "types": {...}, ...}' --wallet my-wallet
```

Environment variables:
- `AGENT_WALLET_DIR` — Secrets directory (default: `~/.agent-wallet`)
- `AGENT_WALLET_PASSWORD` — Master password (avoids interactive prompt)

## API Reference

### WalletFactory

```python
from agent_wallet import WalletFactory

provider = WalletFactory()
```

`WalletFactory()` reads environment variables and returns:

- `LocalWalletProvider` when `AGENT_WALLET_PASSWORD` is set
- `StaticWalletProvider` with a `TronWallet` when `TRON_PRIVATE_KEY` or `TRON_MNEMONIC` is set
- `StaticWalletProvider` with an `EvmWallet` when `EVM_PRIVATE_KEY` or `EVM_MNEMONIC` is set

Environment variables:
- `AGENT_WALLET_DIR` — Secrets directory for local mode (default: `~/.agent-wallet`)
- `AGENT_WALLET_PASSWORD` — Master password for local mode
- `TRON_PRIVATE_KEY` / `TRON_MNEMONIC` — TRON single-wallet mode
- `EVM_PRIVATE_KEY` / `EVM_MNEMONIC` — EVM single-wallet mode

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
wallet = await provider.get_active_wallet()

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
wallet = await provider.get_active_wallet()

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
    wallet = await provider.get_active_wallet()
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

## Supported Wallet Types

| Type | Chains | Signing Library |
|---|---|---|
| `evm_local` | Ethereum, BSC, Polygon, Base, Arbitrum, any EVM | eth-account |
| `tron_local` | TRON Mainnet, Nile, Shasta | tronpy |

## Examples

- [tron_sign_and_broadcast.py](./examples/tron_sign_and_broadcast.py) — Build tx via TronGrid, sign with SDK, broadcast
- [bsc_sign_and_broadcast.py](./examples/bsc_sign_and_broadcast.py) — Build BSC testnet tx, sign with SDK, broadcast
- [tron_x402_sign_typed_data.py](./examples/tron_x402_sign_typed_data.py) — TRON x402 PaymentPermit signing
- [bsc_x402_sign_typed_data.py](./examples/bsc_x402_sign_typed_data.py) — BSC/EVM x402 PaymentPermit signing
- [switch_active_wallet.py](./examples/switch_active_wallet.py) — Set and switch active wallet via SDK

## Security

- **Keystore V3** — scrypt (N=262144, r=8, p=1) + AES-128-CTR + keccak256 MAC
- **Password strength enforced** — Minimum 8 characters with uppercase, lowercase, digit, and special character
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
