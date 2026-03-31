"""Tests for Privy config resolution."""

from __future__ import annotations

import pytest

from agent_wallet.core.errors import PrivyConfigError
from agent_wallet.core.providers.privy_config import PrivyConfigResolver


def test_resolves_required_config_values_from_source():
    resolver = PrivyConfigResolver(
        source={
            "app_id": " cfg-app ",
            "app_secret": "cfg-secret",
            "wallet_id": "cfg-wallet",
        },
    )

    resolved = resolver.resolve()
    assert resolved.app_id == "cfg-app"
    assert resolved.app_secret == "cfg-secret"
    assert resolved.wallet_id == "cfg-wallet"


def test_missing_required_fields_redacts_secrets():
    resolver = PrivyConfigResolver(
        source={
            "app_id": "cfg-app",
            "app_secret": "super-secret",
        }
    )

    assert resolver.is_enabled() is False
    with pytest.raises(PrivyConfigError) as excinfo:
        resolver.resolve()
    message = str(excinfo.value).lower()
    assert "missing required" in message
    assert "wallet_id" in message
    assert "super-secret" not in message
