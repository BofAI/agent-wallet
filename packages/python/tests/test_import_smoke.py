"""Import smoke tests to detect circular dependencies."""

from __future__ import annotations

import agent_wallet
from agent_wallet.core import base, providers, resolver, utils
from agent_wallet.core.providers import config_provider, env_provider
from agent_wallet.core.utils import env, keys, network
from agent_wallet.core.utils import hex as hex_utils


def test_import_core_modules():
    assert agent_wallet
    assert base
    assert providers
    assert resolver
    assert utils
    assert config_provider
    assert env_provider
    assert env
    assert hex_utils
    assert keys
    assert network
