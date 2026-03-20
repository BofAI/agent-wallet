"""Wallet abstract interface, capability mixins, and core enums."""

from abc import ABC, abstractmethod
from enum import StrEnum


class Network(StrEnum):
    """Supported blockchain networks."""

    EVM = "evm"
    TRON = "tron"


class WalletType(StrEnum):
    """How private keys are managed."""

    LOCAL_SECURE = "local_secure"
    RAW_SECRET = "raw_secret"


class Wallet(ABC):
    """Minimal interface shared by all wallets."""

    @abstractmethod
    async def get_address(self) -> str:
        """Return the wallet's public address."""

    @abstractmethod
    async def sign_raw(self, raw_tx: bytes) -> str:
        """Sign pre-serialized transaction bytes, return signature hex."""

    @abstractmethod
    async def sign_transaction(self, payload: dict) -> str:
        """Build and sign a transaction from high-level intent."""

    @abstractmethod
    async def sign_message(self, msg: bytes) -> str:
        """Sign an arbitrary message, return signature hex."""


class Eip712Capable(ABC):
    """Mixin for wallets that support EIP-712 typed data signing."""

    @abstractmethod
    async def sign_typed_data(self, data: dict) -> str:
        """Sign EIP-712 typed data, return signature hex."""


class WalletProvider(ABC):
    """Abstract interface for resolving a signable wallet."""

    @abstractmethod
    async def get_active_wallet(self, network: str | None = None) -> Wallet:
        """Return the wallet instance that callers should use for signing."""
