"""Provider for directly supplied secret material."""

from __future__ import annotations

from agent_wallet.core.base import Wallet, WalletProvider
from agent_wallet.core.providers.wallet_builder import (
    create_adapter,
    decode_private_key,
    derive_key_from_mnemonic,
    parse_network_family,
)


class EnvWalletProvider(WalletProvider):
    """Create a wallet from direct secret inputs."""

    def __init__(
        self,
        *,
        network: str | None = None,
        private_key: str | None = None,
        mnemonic: str | None = None,
        account_index: int = 0,
    ) -> None:
        _assert_single_wallet_source(
            private_key=private_key,
            mnemonic=mnemonic,
        )
        self._network = network
        self._private_key = private_key
        self._mnemonic = mnemonic
        self._account_index = account_index

    async def get_wallet(self, network: str | None = None) -> Wallet:
        return _create_wallet(
            network=_resolve_network(network, self._network),
            private_key=self._private_key,
            mnemonic=self._mnemonic,
            account_index=self._account_index,
        )

    async def get_active_wallet(self, network: str | None = None) -> Wallet:
        return await self.get_wallet(network)


def _create_wallet(
    *,
    network: str,
    private_key: str | None,
    mnemonic: str | None,
    account_index: int,
) -> Wallet:
    if not private_key and not mnemonic:
        raise ValueError(
            "resolve_wallet could not find a wallet source in config or env"
        )

    family = parse_network_family(network)

    if private_key:
        return create_adapter(family, decode_private_key(private_key))

    assert mnemonic is not None
    return create_adapter(
        family,
        derive_key_from_mnemonic(family, mnemonic, account_index),
    )


def _assert_single_wallet_source(
    *,
    private_key: str | None,
    mnemonic: str | None,
) -> None:
    if private_key and mnemonic:
        raise ValueError(
            "Provide only one of AGENT_WALLET_PRIVATE_KEY or "
            "AGENT_WALLET_MNEMONIC"
        )


def _resolve_network(explicit: str | None, provider_default: str | None) -> str:
    if explicit:
        return explicit
    if provider_default:
        return provider_default
    raise ValueError("network is required")
