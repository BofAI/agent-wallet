"""AgentWallet — Universal multi-chain secure signing SDK."""

from agent_wallet.core.base import Eip712Capable, Network, Wallet, WalletType
from agent_wallet.core.errors import (
    DecryptionError,
    NetworkError,
    SigningError,
    UnsupportedOperationError,
    WalletError,
    WalletNotFoundError,
)
from agent_wallet.core.providers import (
    ConfigWalletProvider,
    EnvWalletProvider,
)
from agent_wallet.core.resolver import resolve_wallet, resolve_wallet_provider

__all__ = [
    "ConfigWalletProvider",
    "DecryptionError",
    "Eip712Capable",
    "EnvWalletProvider",
    "EvmSigner",
    "LocalSigner",
    "LocalSecureSigner",
    "Network",
    "NetworkError",
    "RawSecretSigner",
    "SigningError",
    "TronSigner",
    "UnsupportedOperationError",
    "Wallet",
    "WalletError",
    "WalletNotFoundError",
    "WalletType",
    "resolve_wallet",
    "resolve_wallet_provider",
]


def __getattr__(name: str):
    if name == "LocalSigner":
        from agent_wallet.core.adapters.local import LocalSigner

        return LocalSigner
    if name == "LocalSecureSigner":
        from agent_wallet.core.adapters.local_secure import LocalSecureSigner

        return LocalSecureSigner
    if name == "RawSecretSigner":
        from agent_wallet.core.adapters.raw_secret import RawSecretSigner

        return RawSecretSigner
    if name == "EvmSigner":
        from agent_wallet.core.adapters.evm import EvmSigner

        return EvmSigner
    if name == "TronSigner":
        from agent_wallet.core.adapters.tron import TronSigner

        return TronSigner
    raise AttributeError(f"module 'agent_wallet' has no attribute {name!r}")
