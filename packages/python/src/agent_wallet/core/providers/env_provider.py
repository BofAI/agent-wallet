"""Provider for directly supplied secret material."""

from __future__ import annotations

from agent_wallet.core.adapters.raw_secret import RawSecretSigner
from agent_wallet.core.base import Wallet, WalletProvider
from agent_wallet.core.config import RawSecretMnemonicParams, RawSecretPrivateKeyParams


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
        resolved = _resolve_network(network, self._network)
        params = _build_params(
            private_key=self._private_key,
            mnemonic=self._mnemonic,
            account_index=self._account_index,
        )
        return RawSecretSigner(params=params, network=resolved)

    async def get_active_wallet(self, network: str | None = None) -> Wallet:
        return await self.get_wallet(network)


def _build_params(
    *,
    private_key: str | None,
    mnemonic: str | None,
    account_index: int,
) -> RawSecretPrivateKeyParams | RawSecretMnemonicParams:
    if private_key:
        return RawSecretPrivateKeyParams(source="private_key", private_key=private_key)
    if mnemonic:
        return RawSecretMnemonicParams(
            source="mnemonic", mnemonic=mnemonic, account_index=account_index,
        )
    raise ValueError(
        "resolve_wallet could not find a wallet source in config or env"
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
