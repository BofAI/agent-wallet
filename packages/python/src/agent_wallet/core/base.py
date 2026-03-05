"""BaseWallet abstract interface, capability mixins, and core enums."""

from abc import ABC, abstractmethod
from enum import StrEnum


class WalletType(StrEnum):
    """Supported wallet types."""

    EVM_LOCAL = "evm_local"
    TRON_LOCAL = "tron_local"

    # TODO: add more wallet types as needed, e.g.:
    # COINBASE_WAAS = "coinbase_waas"
    # PRIVY_WAAS = "privy_waas"
    # REMOTE = "remote"




class BaseWallet(ABC):
    """Minimal interface shared by all wallets."""

    @abstractmethod
    async def get_address(self) -> str:
        """Return the wallet's public address."""

    @abstractmethod
    async def sign_raw(self, raw_tx: bytes) -> str:
        """Sign pre-serialized transaction bytes, return signature hex."""

    @abstractmethod
    async def sign_transaction(self, payload: dict) -> str:
        """Build and sign a transaction from high-level intent (to, amount, etc.)."""

    @abstractmethod
    async def sign_message(self, msg: bytes) -> str:
        """Sign an arbitrary message, return signature hex."""


class Eip712Capable(ABC):
    """Mixin for wallets that support EIP-712 typed data signing."""

    @abstractmethod
    async def sign_typed_data(self, data: dict) -> str:
        """Sign EIP-712 typed data, return signature hex."""
