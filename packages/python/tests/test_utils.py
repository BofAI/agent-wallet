"""Tests for cross-platform utilities."""

from __future__ import annotations

import os
import stat
import warnings
from pathlib import Path
from unittest.mock import patch

from agent_wallet.core.utils import safe_chmod


def test_safe_chmod_sets_permissions(tmp_path: Path) -> None:
    f = tmp_path / "secret.json"
    f.write_text("{}")
    safe_chmod(f, stat.S_IRUSR | stat.S_IWUSR)
    if os.name == "nt":
        assert f.exists()
        return
    assert f.stat().st_mode & 0o777 == 0o600


def test_safe_chmod_warns_on_failure(tmp_path: Path) -> None:
    f = tmp_path / "secret.json"
    f.write_text("{}")
    with patch("agent_wallet.core.utils.os.chmod", side_effect=OSError("not supported")):
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            safe_chmod(f, stat.S_IRUSR | stat.S_IWUSR)
            assert len(w) == 1
            assert "Could not set file permissions" in str(w[0].message)
