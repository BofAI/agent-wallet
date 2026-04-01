"""Privy HTTP client."""

from __future__ import annotations

import base64
import json
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from agent_wallet.core.errors import PrivyAuthError, PrivyRateLimitError, PrivyRequestError


class PrivyClient:
    def __init__(
        self,
        *,
        app_id: str,
        app_secret: str,
        retries: int = 2,
        sleep: callable | None = None,
    ) -> None:
        self._app_id = app_id
        self._app_secret = app_secret
        self._base_url = "https://api.privy.io"
        self._retries = retries
        self._sleep = sleep or (lambda seconds: time.sleep(seconds))

    def get_wallet(self, wallet_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/wallets/{wallet_id}")

    def rpc(
        self,
        wallet_id: str,
        method: str,
        params: dict[str, Any],
        authorization_signature: str | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/v1/wallets/{wallet_id}/rpc",
            {"method": method, "params": params},
            authorization_signature=authorization_signature,
        )

    def raw_sign(
        self, wallet_id: str, params: dict[str, Any], authorization_signature: str | None = None
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/v1/wallets/{wallet_id}/raw_sign",
            {"params": params},
            authorization_signature=authorization_signature,
        )

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        authorization_signature: str | None = None,
    ) -> dict[str, Any]:
        attempt = 0
        while True:
            req = Request(
                f"{self._base_url}{path}",
                method=method,
                headers=self._headers(authorization_signature),
                data=json.dumps(body).encode("utf-8") if body else None,
            )
            try:
                with urlopen(req) as response:
                    status = response.status
                    payload = _read_json(response)
            except HTTPError as exc:
                status = exc.code
                try:
                    payload = json.loads(exc.read().decode("utf-8"))
                except Exception:
                    payload = {}
            except URLError as exc:
                raise PrivyRequestError(f"Privy request network error: {exc}") from exc

            if status == 429:
                if attempt >= self._retries:
                    raise PrivyRateLimitError("Privy rate limit exceeded")
                attempt += 1
                self._sleep(_backoff_seconds(attempt))
                continue

            if status >= 400:
                message = _extract_error(payload) or f"Privy request failed with status {status}"
                if status in (401, 403):
                    raise PrivyAuthError(message)
                raise PrivyRequestError(message)

            return payload

    def _headers(self, authorization_signature: str | None) -> dict[str, str]:
        raw = f"{self._app_id}:{self._app_secret}".encode()
        auth = base64.b64encode(raw).decode("utf-8")
        headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": f"Basic {auth}",
            "privy-app-id": self._app_id,
            "user-agent": "agent-wallet-python",
        }
        if authorization_signature:
            headers["privy-authorization-signature"] = authorization_signature
        return headers


def _read_json(response) -> dict[str, Any]:
    try:
        return json.loads(response.read().decode("utf-8"))
    except Exception:
        return {}


def _extract_error(payload: dict[str, Any]) -> str | None:
    if "error" in payload and isinstance(payload["error"], dict):
        message = payload["error"].get("message")
        if isinstance(message, str):
            return message
    if isinstance(payload.get("message"), str):
        return payload["message"]
    return None


def _backoff_seconds(attempt: int) -> float:
    return min(1.0, 0.2 * attempt)
