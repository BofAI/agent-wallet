"""Address resolution helpers for CLI-facing wallet inspection."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from agent_wallet.core.adapters.evm import EvmSigner
from agent_wallet.core.adapters.privy import PrivyAdapter
from agent_wallet.core.adapters.tron import TronSigner
from agent_wallet.core.clients.privy import PrivyClient
from agent_wallet.core.config import (
    LocalSecureWalletParams,
    PrivyWalletParams,
    RawSecretMnemonicParams,
    RawSecretPrivateKeyParams,
    WalletConfig,
)
from agent_wallet.core.providers.privy_config import PrivyConfigResolver
from agent_wallet.core.utils.keys import decode_private_key, derive_key_from_mnemonic


@dataclass(frozen=True)
class AddressEntry:
    format: str
    label: str
    address: str


@dataclass(frozen=True)
class AddressResolutionResult:
    mode: str
    entries: tuple[AddressEntry, ...]


async def resolve_wallet_addresses(
    conf: WalletConfig,
    *,
    config_dir: str | Path,
    password: str | None = None,
    secret_loader: Callable[[str | Path, str, str], bytes] | None = None,
) -> AddressResolutionResult:
    if conf.type == "privy":
        return await _resolve_privy_address(conf.params)

    eip155_key, tron_key = _resolve_local_keys(
        conf,
        config_dir=config_dir,
        password=password,
        secret_loader=secret_loader,
    )
    evm_address = await EvmSigner(eip155_key, "eip155").get_address()
    tron_address = await TronSigner(tron_key, "tron").get_address()
    return AddressResolutionResult(
        mode="whitelist",
        entries=(
            AddressEntry(format="eip155", label="EVM", address=evm_address),
            AddressEntry(format="tron", label="TRON", address=tron_address),
        ),
    )


async def _resolve_privy_address(params: PrivyWalletParams) -> AddressResolutionResult:
    resolved = PrivyConfigResolver(source=params.model_dump()).resolve()
    wallet = PrivyAdapter(
        app_id=resolved.app_id,
        app_secret=resolved.app_secret,
        wallet_id=resolved.wallet_id,
        client=PrivyClient(
            app_id=resolved.app_id,
            app_secret=resolved.app_secret,
        ),
    )
    address = await wallet.get_address()
    return AddressResolutionResult(
        mode="single",
        entries=(AddressEntry(format="canonical", label="Address", address=address),),
    )


def _resolve_local_keys(
    conf: WalletConfig,
    *,
    config_dir: str | Path,
    password: str | None,
    secret_loader: Callable[[str | Path, str, str], bytes] | None,
) -> tuple[bytes, bytes]:
    if conf.type == "local_secure":
        params = conf.params
        if not isinstance(params, LocalSecureWalletParams):
            raise ValueError("local_secure wallets require LocalSecureWalletParams")
        if not password:
            raise ValueError("Password required for local_secure wallets")
        if secret_loader is None:
            raise ValueError("local_secure wallets require a configured secret loader")
        private_key = secret_loader(config_dir, password, params.secret_ref)
        return private_key, private_key

    params = conf.params
    if isinstance(params, RawSecretPrivateKeyParams):
        private_key = decode_private_key(params.private_key)
        return private_key, private_key
    if isinstance(params, RawSecretMnemonicParams):
        return (
            derive_key_from_mnemonic("eip155", params.mnemonic, params.account_index),
            derive_key_from_mnemonic("tron", params.mnemonic, params.account_index),
        )
    raise ValueError("raw_secret wallets require valid raw secret params")
