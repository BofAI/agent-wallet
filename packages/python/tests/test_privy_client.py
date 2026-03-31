"""Tests for Privy HTTP client."""

from __future__ import annotations

import json
from typing import Any

import pytest

from agent_wallet.core.clients.privy import PrivyClient
from agent_wallet.core.errors import PrivyRateLimitError, PrivyRequestError


class _FakeResponse:
    def __init__(self, status: int, payload: dict[str, Any]):
        self.status = status
        self._payload = payload

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return None


def test_includes_required_headers(monkeypatch):
    calls = []

    def fake_urlopen(req):
        calls.append(req)
        return _FakeResponse(200, {"data": {"signature": "0xabc"}})

    monkeypatch.setattr("agent_wallet.core.clients.privy.urlopen", fake_urlopen)

    client = PrivyClient(
        app_id="app-id",
        app_secret="app-secret",
    )

    client.rpc("wallet-1", "personal_sign", {"message": "0x01"})

    headers = {key.lower(): value for key, value in dict(calls[0].headers).items()}
    assert headers.get("privy-app-id") == "app-id"
    assert headers.get("authorization", "").startswith("Basic ")


def test_calls_raw_sign_endpoint(monkeypatch):
    calls = []

    def fake_urlopen(req):
        calls.append(req)
        return _FakeResponse(200, {"data": {"signature": "0xabc"}})

    monkeypatch.setattr("agent_wallet.core.clients.privy.urlopen", fake_urlopen)

    client = PrivyClient(
        app_id="app-id",
        app_secret="app-secret",
    )

    client.raw_sign("wallet-1", {"hash": "0x01"})
    assert calls[0].full_url.endswith("/v1/wallets/wallet-1/raw_sign")


def test_retries_on_rate_limit(monkeypatch):
    responses = [
        _FakeResponse(429, {"error": {"message": "rate limit"}}),
        _FakeResponse(200, {"data": {"signature": "0xabc"}}),
    ]

    def fake_urlopen(_):
        return responses.pop(0)

    monkeypatch.setattr("agent_wallet.core.clients.privy.urlopen", fake_urlopen)

    client = PrivyClient(
        app_id="app-id",
        app_secret="app-secret",
        retries=1,
        sleep=lambda _: None,
    )

    result = client.rpc("wallet-1", "personal_sign", {"message": "0x01"})
    assert result["data"]["signature"] == "0xabc"


def test_raises_on_non_retryable_errors(monkeypatch):
    def fake_urlopen(_):
        return _FakeResponse(500, {"error": {"message": "oops"}})

    monkeypatch.setattr("agent_wallet.core.clients.privy.urlopen", fake_urlopen)

    client = PrivyClient(
        app_id="app-id",
        app_secret="app-secret",
        retries=0,
        sleep=lambda _: None,
    )

    with pytest.raises(PrivyRequestError):
        client.rpc("wallet-1", "personal_sign", {"message": "0x01"})


def test_raises_when_rate_limit_exhausted(monkeypatch):
    def fake_urlopen(_):
        return _FakeResponse(429, {"error": {"message": "rate limit"}})

    monkeypatch.setattr("agent_wallet.core.clients.privy.urlopen", fake_urlopen)

    client = PrivyClient(
        app_id="app-id",
        app_secret="app-secret",
        retries=0,
        sleep=lambda _: None,
    )

    with pytest.raises(PrivyRateLimitError):
        client.rpc("wallet-1", "personal_sign", {"message": "0x01"})
