"""Structured error types for agent decision-making (retry vs abort)."""


class WalletError(Exception):
    """Base error for all wallet operations."""


class WalletNotFoundError(WalletError):
    """Wallet ID does not exist in config."""


class DecryptionError(WalletError):
    """Password incorrect or keystore file corrupted."""


class InsufficientBalanceError(WalletError):
    """Not enough balance for the transaction."""


class SigningError(WalletError):
    """Signing operation failed."""


class NetworkError(WalletError):
    """API or node unreachable (retryable)."""


class UnsupportedOperationError(WalletError):
    """This wallet does not support the requested operation."""


class PrivyConfigError(WalletError):
    """Privy configuration is missing or invalid."""


class PrivyRequestError(WalletError):
    """Privy request failed."""


class PrivyRateLimitError(WalletError):
    """Privy rate limit exceeded."""


class PrivyAuthError(WalletError):
    """Privy authorization failed."""
