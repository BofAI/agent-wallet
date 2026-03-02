"""Common types for wallet providers."""
from typing import TypedDict, Any, Optional


class AccountInfo(TypedDict):
    """Account info returned by get_account_info."""
    address: str


class SignedTxResult(TypedDict):
    """Result of signing an unsigned transaction."""
    signed_tx: Any
    signature: Optional[str]
