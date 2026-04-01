"""Network parsing helpers."""

from __future__ import annotations

from agent_wallet.core.base import Network


def parse_network_family(network: str | None) -> Network:
    normalized = network.strip().lower() if network else None
    if not normalized:
        raise ValueError("network is required")
    if normalized == "tron" or normalized.startswith("tron:"):
        return Network.TRON
    if normalized == "eip155" or normalized.startswith("eip155:"):
        return Network.EVM
    raise ValueError("network must start with 'tron' or 'eip155'")


def resolve_network(explicit: str | None, provider_default: str | None) -> str | None:
    if explicit:
        return explicit
    if provider_default:
        return provider_default
    return None
