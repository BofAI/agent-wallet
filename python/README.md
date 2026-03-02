# Agent Wallet SDK (Python)

Aligned with the TypeScript SDK: Provider abstraction, Keystore, CLI, and encryption. The keystore file is cross-language compatible — files written by TypeScript can be read by Python and vice versa.

## Provider abstraction

- **BaseProvider**: Abstract base class with a unified interface:
  - `get_account_info() -> AccountInfo` — returns `{"address": str}` (wallet address)
  - `sign_message(message: bytes) -> str` — signs message bytes (expects a 32-byte hash) and returns a signature hex string
  - `sign_tx(unsigned_tx) -> SignedTxResult` — accepts an unsigned transaction, signs it, and returns `{"signed_tx", "signature?"}`
- Providers depend on an abstract **KeystoreBase** type, so you can inject other keystore implementations if needed (default is the file-based `Keystore` at `~/.agent_wallet/Keystore`).
- **TronProvider**: Extends BaseProvider; uses tronpy with local private-key signing.
- **FlashProvider**: Extends TronProvider; supports Privy remote signing and Flash node.

```python
from wallet import TronProvider, FlashProvider

# Keystore file initialization is done via the keystore CLI.
# Providers read keystore data in the constructor.
tron = TronProvider(
    # Optional overrides. Recommended: write these into keystore via CLI.
    private_key=os.getenv("TRON_PRIVATE_KEY"),
    keystore_path=os.getenv("KEYSTORE_PATH"),    # optional custom path
)

info = await tron.get_account_info()   # {"address": "T..."}
result = await tron.sign_tx(unsigned_tx)
signed_tx = result["signed_tx"]
```

`FlashProvider` works the same way, and can also pull Privy credentials from the keystore:

```python
flash = FlashProvider(
    # Optionally override values that might also live in the keystore:
    privy_app_id=os.getenv("PRIVY_APP_ID"),
    privy_app_secret=os.getenv("PRIVY_APP_SECRET"),
    wallet_id=os.getenv("PRIVY_WALLET_ID"),
)
```

## Keystore

A fixed-path Protobuf file stores account info (privateKey, secretKey, etc.).

- **Path**: Default `~/.agent_wallet/Keystore`; override via `KEYSTORE_PATH` env var or the `file_path` argument.
- **Storage format**: Protobuf wire format (`map<string, string>`), NOT JSON.
- **Atomic writes**: All writes go through a `.tmp` file then `os.replace`, preventing data loss on crash.
- **Backward compatible**: Can still read legacy plain-JSON keystore files.

```python
from keystore import Keystore

ks = Keystore()  # defaults to ~/.agent_wallet/Keystore
ks.read()
private_key = ks.get("privateKey")
ks.set("note", "xxx")  # loads existing data first if not yet loaded
ks.write()

# Static helpers
data = Keystore.from_file(os.path.expanduser("~/.agent_wallet/Keystore"))
Keystore.to_file("/path/to/Keystore", {"privateKey": "abc"})
```

## Keystore CLI

Default path is `~/.agent_wallet/Keystore` (same as the library).

```bash
# From the python directory
python -m keystore_cli read [key]
python -m keystore_cli write <key> <value>
python -m keystore_cli delete <key>
python -m keystore_cli init

# After install, run directly
keystore read
keystore write privateKey "hex..."

# Options
--path /custom/path
```

## Tests

```bash
uv run pytest
# or
python -m pytest tests/ -v
```
